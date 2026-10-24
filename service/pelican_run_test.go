package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pelicanRunFixture(t *testing.T, transport pelicanModelTransport) PelicanRunRequest {
	t.Helper()
	configureSSRFTestFetchSetting(t)
	original := ssrfProtectedHTTPClient
	t.Cleanup(func() { ssrfProtectedHTTPClient = original })
	ssrfProtectedHTTPClient = &http.Client{Transport: transport}
	return PelicanRunRequest{APIURL: "https://8.8.8.8/custom/v1/responses", APIKey: "test-upstream-key", APIFormat: "responses", Model: "test-model", Effort: "high"}
}

func TestRunPelicanTestNativeContracts(t *testing.T) {
	for _, format := range []string{"responses", "chat-completions"} {
		for _, effort := range []string{"auto", "high"} {
			t.Run(format+"/"+effort, func(t *testing.T) {
				calls := 0
				nativeResponse := `{"output":[{"type":"message","content":[{"type":"output_text","text":"<svg/>"}]}],"usage":{"total_tokens":84}}`
				input := pelicanRunFixture(t, func(r *http.Request) (*http.Response, error) {
					calls++
					assert.Equal(t, http.MethodPost, r.Method)
					assert.Equal(t, "Bearer test-upstream-key", r.Header.Get("Authorization"))
					assert.Empty(t, r.Header.Get("Cookie"))
					assert.Empty(t, r.Header.Get("New-Api-User"))
					assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
					var body map[string]any
					require.NoError(t, common.DecodeJson(r.Body, &body))
					assert.Equal(t, "test-model", body["model"])
					assert.Equal(t, false, body["stream"])
					if format == "responses" {
						assert.Equal(t, "/custom/v1/responses", r.URL.Path)
						assert.Equal(t, "Generate an SVG of a pelican riding a bicycle.", body["input"])
						assert.Equal(t, pelicanInstructions, body["instructions"])
						assert.Equal(t, false, body["store"])
						assert.NotContains(t, body, "messages")
						if effort == "auto" {
							assert.NotContains(t, body, "reasoning")
						} else {
							assert.Equal(t, map[string]any{"effort": effort}, body["reasoning"])
						}
					} else {
						assert.Equal(t, "/custom/v1/chat/completions", r.URL.Path)
						assert.Equal(t, []any{map[string]any{"role": "system", "content": pelicanInstructions}, map[string]any{"role": "user", "content": "Generate an SVG of a pelican riding a bicycle."}}, body["messages"])
						assert.NotContains(t, body, "input")
						if effort == "auto" {
							assert.NotContains(t, body, "reasoning_effort")
						} else {
							assert.Equal(t, effort, body["reasoning_effort"])
						}
					}
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(nativeResponse))}, nil
				})
				input.APIFormat, input.Effort = format, effort
				if format == "chat-completions" {
					input.APIURL = "https://8.8.8.8/custom/v1/chat/completions"
				}
				output, err := RunPelicanTest(context.Background(), 1, input)
				require.NoError(t, err)
				assert.Equal(t, nativeResponse, string(output))
				assert.Equal(t, 1, calls)
			})
		}
	}
}

func TestRunPelicanTestRejectsInvalidSettingsBeforeNetwork(t *testing.T) {
	tests := []struct {
		name   string
		change func(*PelicanRunRequest)
		code   string
	}{
		{"private target", func(r *PelicanRunRequest) { r.APIURL = "http://127.0.0.1/v1/responses" }, "blocked_target"},
		{"metadata target", func(r *PelicanRunRequest) { r.APIURL = "http://169.254.169.254/v1/responses" }, "blocked_target"},
		{"embedded credentials", func(r *PelicanRunRequest) { r.APIURL = "https://user:pass@8.8.8.8/v1/responses" }, "invalid_request"},
		{"query", func(r *PelicanRunRequest) { r.APIURL += "?key=hidden" }, "invalid_request"},
		{"fragment", func(r *PelicanRunRequest) { r.APIURL += "#secret" }, "invalid_request"},
		{"wrong endpoint", func(r *PelicanRunRequest) { r.APIURL = "https://8.8.8.8/v1/models" }, "invalid_request"},
		{"wrong format", func(r *PelicanRunRequest) { r.APIFormat = "anything" }, "invalid_request"},
		{"wrong effort", func(r *PelicanRunRequest) { r.Effort = "maximum" }, "invalid_request"},
		{"empty model", func(r *PelicanRunRequest) { r.Model = " " }, "invalid_request"},
		{"model bound", func(r *PelicanRunRequest) { r.Model = strings.Repeat("a", 513) }, "invalid_request"},
		{"key injection", func(r *PelicanRunRequest) { r.APIKey = "key\r\nOther: header" }, "invalid_request"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			input := pelicanRunFixture(t, func(*http.Request) (*http.Response, error) { calls++; return nil, context.Canceled })
			tc.change(&input)
			_, err := RunPelicanTest(context.Background(), 1, input)
			var failure *PelicanRunError
			require.ErrorAs(t, err, &failure)
			assert.Equal(t, tc.code, failure.Code)
			assert.Zero(t, calls)
		})
	}
}

func TestRunPelicanTestDoesNotRetryOrForwardRedirectsAndRedactsErrors(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     int
		body, code string
	}{
		{"upstream auth", 401, `{"error":{"message":"Invalid test-upstream-key"}}`, "upstream_status"},
		{"redirect", 307, `test-upstream-key`, "upstream_status"},
		{"HTML", 200, `<html>test-upstream-key</html>`, "invalid_response"},
		{"error with success status", 200, `{"error":{"message":"test-upstream-key"}}`, "invalid_response"},
		{"oversize", 200, strings.Repeat(" ", pelicanMaxResponseBytes+1), "response_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			input := pelicanRunFixture(t, func(r *http.Request) (*http.Response, error) {
				calls++
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": {"https://8.8.4.4/v1/responses"}}, Request: r, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			_, err := RunPelicanTest(context.Background(), 1, input)
			var failure *PelicanRunError
			require.ErrorAs(t, err, &failure)
			assert.Equal(t, tc.code, failure.Code)
			assert.NotContains(t, failure.Message, "test-upstream-key")
			if tc.name == "upstream auth" {
				assert.Equal(t, "Invalid [redacted]", failure.Message)
				assert.Equal(t, 401, failure.UpstreamStatus)
			}
			assert.Equal(t, 1, calls)
		})
	}
}

func TestRunPelicanTestCancellationReleasesUserSlots(t *testing.T) {
	// Four held requests exhaust this user's allowance. Cancelling them must
	// propagate to the upstream and allow a later request without restarting.
	started := make(chan struct{}, 4)
	results := make(chan error, 4)
	input := pelicanRunFixture(t, func(r *http.Request) (*http.Response, error) {
		started <- struct{}{}
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for range 4 {
		go func() { _, err := RunPelicanTest(ctx, 77, input); results <- err }()
	}
	for range 4 {
		<-started
	}
	_, err := RunPelicanTest(context.Background(), 77, input)
	var failure *PelicanRunError
	require.ErrorAs(t, err, &failure)
	assert.Equal(t, "busy", failure.Code)
	cancel()
	for range 4 {
		require.ErrorAs(t, <-results, &failure)
		assert.Equal(t, "cancelled", failure.Code)
	}
	ssrfProtectedHTTPClient = &http.Client{Transport: pelicanModelTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"output":[]}`))}, nil
	})}
	_, err = RunPelicanTest(context.Background(), 77, input)
	require.NoError(t, err)
}

func TestRunPelicanTestDoesNotSubmitAnAlreadyCancelledRequest(t *testing.T) {
	calls := 0
	input := pelicanRunFixture(t, func(*http.Request) (*http.Response, error) { calls++; return nil, context.Canceled })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := RunPelicanTest(ctx, 1, input)
	var failure *PelicanRunError
	require.ErrorAs(t, err, &failure)
	assert.Equal(t, "cancelled", failure.Code)
	assert.Zero(t, calls)
}

func TestStreamPelicanTestNativeContracts(t *testing.T) {
	for _, format := range []string{"responses", "chat-completions"} {
		t.Run(format, func(t *testing.T) {
			wire := "event: response.output_text.delta\ndata: {\"delta\":\"<svg/>\"}\n\ndata: [DONE]\n\n"
			input := pelicanRunFixture(t, func(r *http.Request) (*http.Response, error) {
				assert.Equal(t, "text/event-stream", r.Header.Get("Accept"))
				var body map[string]any
				require.NoError(t, common.DecodeJson(r.Body, &body))
				assert.Equal(t, true, body["stream"])
				if format == "chat-completions" {
					assert.Equal(t, map[string]any{"include_usage": true}, body["stream_options"])
				} else {
					assert.NotContains(t, body, "stream_options")
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream; charset=utf-8"}}, Body: io.NopCloser(strings.NewReader(wire))}, nil
			})
			input.APIFormat = format
			if format == "chat-completions" {
				input.APIURL = "https://8.8.8.8/custom/v1/chat/completions"
			}
			var frames []string
			require.NoError(t, StreamPelicanTest(context.Background(), 1, input, func(chunk []byte) error { frames = append(frames, string(chunk)); return nil }))
			assert.Len(t, frames, 2)
			assert.Equal(t, wire, strings.Join(frames, ""))
		})
	}
}

func TestStreamPelicanTestBoundsAndJSONFallback(t *testing.T) {
	for _, tc := range []struct{ name, contentType, body, code string }{
		{"JSON provider", "application/json", "{\n\"output\": []\n}", ""},
		{"oversized event", "text/event-stream", "data: " + strings.Repeat("x", pelicanMaxResponseBytes), "response_too_large"},
		{"oversized many events", "text/event-stream", strings.Repeat("data: {}\n\n", pelicanMaxResponseBytes/10+2), "response_too_large"},
		{"truncated event is not committed", "text/event-stream", "data: {\"unfinished\":true}", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := pelicanRunFixture(t, func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {tc.contentType}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			var output strings.Builder
			err := StreamPelicanTest(context.Background(), 1, input, func(chunk []byte) error { _, err := output.Write(chunk); return err })
			if tc.code != "" {
				var failure *PelicanRunError
				require.ErrorAs(t, err, &failure)
				assert.Equal(t, tc.code, failure.Code)
				return
			}
			require.NoError(t, err)
			if tc.contentType == "application/json" {
				assert.Equal(t, "event: pelican.result\ndata: {\"output\":[]}\n\n", output.String())
			} else {
				assert.Empty(t, output.String())
			}
		})
	}
}
