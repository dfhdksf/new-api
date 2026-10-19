package service

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type PelicanModel struct {
	ID string `json:"id"`
}

type PelicanModelsError struct {
	Code           string `json:"code"`
	UpstreamStatus int    `json:"upstream_status,omitempty"`
}

func (e *PelicanModelsError) Error() string { return e.Code }

// FetchPelicanModels fetches only model IDs; credentials and upstream bodies are
// never returned in errors. The shared client enforces the server's fetch policy.
func FetchPelicanModels(ctx context.Context, modelsURL, apiKey string) ([]PelicanModel, error) {
	parsed, err := url.Parse(modelsURL)
	apiKey = strings.TrimSpace(apiKey)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" ||
		!strings.HasSuffix(parsed.Path, "/models") || len(modelsURL) > 2048 ||
		apiKey == "" || len(apiKey) > 4096 || strings.ContainsAny(apiKey, "\r\n") {
		return nil, &PelicanModelsError{Code: "invalid_request"}
	}
	if err := ValidateSSRFProtectedFetchURL(parsed.String()); err != nil {
		return nil, &PelicanModelsError{Code: "blocked_target"}
	}

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, &PelicanModelsError{Code: "invalid_request"}
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	sharedClient := GetSSRFProtectedHTTPClient()
	if sharedClient == nil {
		return nil, &PelicanModelsError{Code: "unreachable"}
	}
	client := *sharedClient
	// An upstream redirect must never forward the API key to another endpoint.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return nil, &PelicanModelsError{Code: "unreachable"}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &PelicanModelsError{Code: "upstream_status", UpstreamStatus: response.StatusCode}
	}

	const maxBodyBytes = 2 * 1024 * 1024
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBodyBytes+1))
	if err != nil || len(body) > maxBodyBytes {
		return nil, &PelicanModelsError{Code: "invalid_response"}
	}
	var payload struct {
		Data []PelicanModel `json:"data"`
	}
	if err := common.Unmarshal(body, &payload); err != nil || payload.Data == nil {
		return nil, &PelicanModelsError{Code: "invalid_response"}
	}
	models := make([]PelicanModel, 0, len(payload.Data))
	seen := make(map[string]bool, len(payload.Data))
	for _, model := range payload.Data {
		id := strings.TrimSpace(model.ID)
		if id != "" && !seen[id] {
			seen[id] = true
			models = append(models, PelicanModel{ID: id})
		}
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}
