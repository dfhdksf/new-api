package controller

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPelicanRunHTTPContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name     string
		status   int
		response string
		want     int
		stream   bool
	}{
		{"native response", 200, `{"output":[{"type":"message","content":[{"type":"output_text","text":"<svg/>"}]}],"usage":{"total_tokens":42}}`, 200, false},
		{"upstream unauthorized preserves app session", 401, `{"error":{"message":"Invalid test-key"}}`, 502, false},
		{"streaming upstream timeout", 504, `{"error":{"message":"Timeout test-key"}}`, 200, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/v1/responses", r.URL.Path)
				assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
				assert.Empty(t, r.Header.Get("Cookie"))
				assert.Empty(t, r.Header.Get("New-Api-User"))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, err := io.WriteString(w, tc.response)
				assert.NoError(t, err)
			}))
			defer upstream.Close()
			target, err := url.Parse(upstream.URL)
			require.NoError(t, err)
			fetch := system_setting.GetFetchSetting()
			original := *fetch
			t.Cleanup(func() { *fetch = original })
			// Allow only this fixture's loopback port; production retains its fetch policy.
			fetch.EnableSSRFProtection = true
			fetch.AllowPrivateIp = true
			fetch.DomainFilterMode = false
			fetch.IpFilterMode = false
			fetch.DomainList = nil
			fetch.IpList = nil
			fetch.AllowedPorts = []string{target.Port()}
			fetch.ApplyIPFilterForDomain = true
			service.InitHttpClient()
			engine := gin.New()
			engine.POST("/api/pelican-test/run", func(c *gin.Context) { c.Set("id", 1) }, RunPelicanTest)
			body, err := common.Marshal(service.PelicanRunRequest{APIURL: upstream.URL + "/v1/responses", APIKey: "test-key", APIFormat: "responses", Model: "test-model", Effort: "auto", Stream: &tc.stream})
			require.NoError(t, err)
			request := httptest.NewRequest(http.MethodPost, "/api/pelican-test/run", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Cookie", "session=dashboard-session")
			request.Header.Set("New-Api-User", "1")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			assert.Equal(t, tc.want, recorder.Code)
			if tc.stream {
				assert.Equal(t, "no-store, no-transform", recorder.Header().Get("Cache-Control"))
			} else {
				assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
			}
			assert.Equal(t, int32(1), calls.Load())
			assert.NotContains(t, recorder.Body.String(), "test-key")
			if tc.stream {
				assert.Contains(t, recorder.Body.String(), "event: pelican.error\ndata: ")
				assert.Contains(t, recorder.Body.String(), `"upstream_status":504`)
				assert.Contains(t, recorder.Body.String(), "Timeout [redacted]")
			} else if tc.want == 200 {
				assert.JSONEq(t, tc.response, recorder.Body.String())
			} else {
				assert.JSONEq(t, `{"error":{"code":"upstream_status","upstream_status":401,"message":"Invalid [redacted]"}}`, recorder.Body.String())
			}
		})
	}
}

func TestPelicanRunRejectsMalformedAndOversizedRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/pelican-test/run", RunPelicanTest)
	for _, body := range []string{`{`, `{}`, `{"api_key":"` + strings.Repeat("x", 17000) + `"}`} {
		request := httptest.NewRequest(http.MethodPost, "/api/pelican-test/run", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
		assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
		assert.JSONEq(t, `{"error":{"code":"invalid_request"}}`, recorder.Body.String())
	}
}

// A gated upstream proves that events reach the HTTP client before generation
// finishes, without depending on sleeps or an actual long model request.
func TestPelicanRunStreamsBeforeCompletionAndCancelsUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, cancelRun := range []bool{false, true} {
		name := "complete"
		if cancelRun {
			name = "cancel"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			finish := make(chan struct{})
			stopped := make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(stopped)
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"<svg/>\"}\n\n")
				w.(http.Flusher).Flush()
				select {
				case <-r.Context().Done():
					return
				case <-finish:
					_, _ = io.WriteString(w, "data: {\"type\":\"response.completed\",\"response\":{\"output\":[],\"usage\":{\"total_tokens\":42}}}\n\n")
				}
			}))
			t.Cleanup(upstream.Close)
			target, err := url.Parse(upstream.URL)
			require.NoError(t, err)
			fetch := system_setting.GetFetchSetting()
			original := *fetch
			t.Cleanup(func() { *fetch = original })
			fetch.EnableSSRFProtection = true
			fetch.AllowPrivateIp = true
			fetch.DomainFilterMode, fetch.IpFilterMode = false, false
			fetch.DomainList, fetch.IpList = nil, nil
			fetch.AllowedPorts = []string{target.Port()}
			fetch.ApplyIPFilterForDomain = true
			service.InitHttpClient()
			engine := gin.New()
			engine.POST("/api/pelican-test/run", func(c *gin.Context) { c.Set("id", 1) }, RunPelicanTest)
			proxy := httptest.NewServer(engine)
			t.Cleanup(proxy.Close)
			stream := true
			body, err := common.Marshal(service.PelicanRunRequest{APIURL: upstream.URL + "/v1/responses", APIKey: "test-key", APIFormat: "responses", Model: "test-model", Effort: "auto", Stream: &stream})
			require.NoError(t, err)
			request, err := http.NewRequestWithContext(ctx, http.MethodPost, proxy.URL+"/api/pelican-test/run", bytes.NewReader(body))
			require.NoError(t, err)
			request.Header.Set("Content-Type", "application/json")
			response, err := proxy.Client().Do(request)
			require.NoError(t, err)
			defer response.Body.Close()
			assert.Equal(t, "no", response.Header.Get("X-Accel-Buffering"))
			assert.Equal(t, "no-store, no-transform", response.Header.Get("Cache-Control"))
			reader := bufio.NewReader(response.Body)
			line, err := reader.ReadString('\n')
			require.NoError(t, err)
			assert.Equal(t, ": pelican-ready\n", line)
			for !strings.Contains(line, "response.output_text.delta") {
				line, err = reader.ReadString('\n')
				require.NoError(t, err)
			}
			select {
			case <-stopped:
				t.Fatal("upstream completed before the client received the delta")
			default:
			}
			if cancelRun {
				cancel()
				select {
				case <-stopped:
				case <-time.After(5 * time.Second):
					t.Fatal("upstream was not cancelled")
				}
				return
			}
			close(finish)
			remaining, err := io.ReadAll(reader)
			require.NoError(t, err)
			assert.Contains(t, string(remaining), "response.completed")
			assert.Contains(t, string(remaining), `"total_tokens":42`)
		})
	}
}

func TestPelicanRunReportsUpstreamFailureInStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/pelican-test/run", func(c *gin.Context) { c.Set("id", 1) }, RunPelicanTest)
	request := httptest.NewRequest(http.MethodPost, "/api/pelican-test/run", strings.NewReader(`{"stream":true,"api_url":"file:///v1/responses","api_key":"secret","api_format":"responses","model":"test","effort":"auto"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "event: pelican.error\ndata: {\"error\":{\"code\":\"invalid_request\"}}")
	assert.NotContains(t, recorder.Body.String(), "secret")
}
