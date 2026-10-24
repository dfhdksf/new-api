package service

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const pelicanRunTimeout = 5 * time.Minute
const pelicanMaxResponseBytes = 4 * 1024 * 1024
const pelicanPrompt = "Generate an SVG of a pelican riding a bicycle."
const pelicanInstructions = "Respond only with a complete, self-contained SVG document. Do not include Markdown fences or commentary."

type PelicanRunRequest struct {
	Stream    *bool  `json:"stream,omitempty"`
	APIURL    string `json:"api_url" binding:"required"`
	APIKey    string `json:"api_key" binding:"required"`
	APIFormat string `json:"api_format" binding:"required"`
	Model     string `json:"model" binding:"required"`
	Effort    string `json:"effort" binding:"required"`
}

type PelicanRunError struct {
	Code           string `json:"code"`
	UpstreamStatus int    `json:"upstream_status,omitempty"`
	Message        string `json:"message,omitempty"`
}

func (e *PelicanRunError) Error() string { return e.Code }

// Limits apply per process as well as per signed-in user, across browser tabs.
var pelicanRuns = struct {
	sync.Mutex
	users map[int]int
	total int
}{users: make(map[int]int)}

func acquirePelicanRun(userID int) (func(), bool) {
	pelicanRuns.Lock()
	defer pelicanRuns.Unlock()
	if pelicanRuns.users[userID] >= 4 || pelicanRuns.total >= 32 {
		return nil, false
	}
	pelicanRuns.users[userID]++
	pelicanRuns.total++
	return func() {
		pelicanRuns.Lock()
		defer pelicanRuns.Unlock()
		pelicanRuns.users[userID]--
		pelicanRuns.total--
		if pelicanRuns.users[userID] == 0 {
			delete(pelicanRuns.users, userID)
		}
	}, true
}

// RunPelicanTest retains the JSON contract for older dashboard clients.
func RunPelicanTest(ctx context.Context, userID int, input PelicanRunRequest) ([]byte, error) {
	var data []byte
	err := runPelicanTest(ctx, userID, input, func(response *http.Response) error {
		var err error
		data, err = readPelicanResponse(ctx, response.Body)
		if err != nil {
			return err
		}
		var payload map[string]any
		if common.Unmarshal(data, &payload) != nil || payload == nil || payload["error"] != nil {
			return &PelicanRunError{Code: "invalid_response"}
		}
		return nil
	})
	return data, err
}

// StreamPelicanTest forwards SSE as it arrives, without buffering a complete
// generation. A JSON-only compatible provider is returned as one result event.
func StreamPelicanTest(ctx context.Context, userID int, input PelicanRunRequest, emit func([]byte) error) error {
	stream := true
	input.Stream = &stream
	return runPelicanTest(ctx, userID, input, func(response *http.Response) error {
		mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if mediaType != "text/event-stream" {
			data, err := readPelicanResponse(ctx, response.Body)
			if err != nil {
				return err
			}
			var payload map[string]any
			if common.Unmarshal(data, &payload) != nil || payload == nil || payload["error"] != nil {
				return &PelicanRunError{Code: "invalid_response"}
			}
			// Re-encode JSON so multiline provider bodies cannot break SSE framing.
			encoded, err := common.Marshal(payload)
			if err != nil {
				return &PelicanRunError{Code: "invalid_response"}
			}
			return emit(append(append([]byte("event: pelican.result\ndata: "), encoded...), '\n', '\n'))
		}
		limited := &io.LimitedReader{R: response.Body, N: pelicanMaxResponseBytes + 1}
		scanner := bufio.NewScanner(limited)
		scanner.Buffer(make([]byte, 4096), pelicanMaxResponseBytes+1)
		var frame bytes.Buffer
		for scanner.Scan() {
			if limited.N == 0 {
				return &PelicanRunError{Code: "response_too_large"}
			}
			frame.Write(scanner.Bytes())
			frame.WriteByte('\n')
			if len(scanner.Bytes()) == 0 {
				// Emit complete events so controller heartbeats cannot terminate
				// an event while the upstream is still writing its data lines.
				if err := emit(bytes.Clone(frame.Bytes())); err != nil {
					return err
				}
				frame.Reset()
			}
		}
		if limited.N == 0 {
			return &PelicanRunError{Code: "response_too_large"}
		}
		if scanner.Err() != nil {
			return pelicanRequestFailure(ctx, "invalid_response")
		}
		return nil
	})
}

func readPelicanResponse(ctx context.Context, body io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, pelicanMaxResponseBytes+1))
	if err != nil {
		return nil, pelicanRequestFailure(ctx, "invalid_response")
	}
	if len(data) > pelicanMaxResponseBytes {
		return nil, &PelicanRunError{Code: "response_too_large"}
	}
	return data, nil
}

func pelicanRequestFailure(ctx context.Context, fallback string) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &PelicanRunError{Code: "timeout"}
	}
	if ctx.Err() != nil {
		return &PelicanRunError{Code: "cancelled"}
	}
	return &PelicanRunError{Code: fallback}
}

// Each call submits one fixed benchmark request. Never retry or follow redirects.
func runPelicanTest(ctx context.Context, userID int, input PelicanRunRequest, consume func(*http.Response) error) error {
	parsed, err := url.Parse(input.APIURL)
	input.APIKey = strings.TrimSpace(input.APIKey)
	input.Model = strings.TrimSpace(input.Model)
	expectedSuffix := "/responses"
	if input.APIFormat == "chat-completions" {
		expectedSuffix = "/chat/completions"
	}
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" ||
		len(input.APIURL) > 2048 || !strings.HasSuffix(parsed.Path, expectedSuffix) ||
		(input.APIFormat != "responses" && input.APIFormat != "chat-completions") ||
		input.APIKey == "" || len(input.APIKey) > 8192 || strings.ContainsAny(input.APIKey, "\r\n") ||
		input.Model == "" || len(input.Model) > 512 || userID <= 0 {
		return &PelicanRunError{Code: "invalid_request"}
	}
	switch input.Effort {
	case "auto", "minimal", "low", "medium", "high", "xhigh":
	default:
		return &PelicanRunError{Code: "invalid_request"}
	}
	if err := ValidateSSRFProtectedFetchURL(parsed.String()); err != nil {
		return &PelicanRunError{Code: "blocked_target"}
	}
	if err := ctx.Err(); err != nil {
		return &PelicanRunError{Code: "cancelled"}
	}
	release, ok := acquirePelicanRun(userID)
	if !ok {
		return &PelicanRunError{Code: "busy"}
	}
	defer release()

	stream := input.Stream != nil && *input.Stream
	body := map[string]any{"model": input.Model, "stream": stream}
	if input.APIFormat == "responses" {
		body["instructions"] = pelicanInstructions
		body["input"] = pelicanPrompt
		body["store"] = false
		if input.Effort != "auto" {
			body["reasoning"] = map[string]string{"effort": input.Effort}
		}
	} else {
		if stream {
			body["stream_options"] = map[string]bool{"include_usage": true}
		}
		body["messages"] = []map[string]string{
			{"role": "system", "content": pelicanInstructions},
			{"role": "user", "content": pelicanPrompt},
		}
		if input.Effort != "auto" {
			body["reasoning_effort"] = input.Effort
		}
	}
	encoded, err := common.Marshal(body)
	if err != nil {
		return &PelicanRunError{Code: "invalid_request"}
	}
	ctx, cancel := context.WithTimeout(ctx, pelicanRunTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), bytes.NewReader(encoded))
	if err != nil {
		return &PelicanRunError{Code: "invalid_request"}
	}
	req.Header.Set("Authorization", "Bearer "+input.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	sharedClient := GetSSRFProtectedHTTPClient()
	if sharedClient == nil {
		return &PelicanRunError{Code: "unreachable"}
	}
	client := *sharedClient
	client.Timeout = pelicanRunTimeout
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return pelicanRequestFailure(ctx, "unreachable")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, err := readPelicanResponse(ctx, response.Body)
		if err != nil {
			return err
		}
		failure := &PelicanRunError{Code: "upstream_status", UpstreamStatus: response.StatusCode}
		var payload struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if common.Unmarshal(data, &payload) == nil {
			message := strings.ReplaceAll(payload.Error.Message, input.APIKey, "[redacted]")
			if len(message) <= 512 {
				failure.Message = message
			}
		}
		return failure
	}
	return consume(response)
}
