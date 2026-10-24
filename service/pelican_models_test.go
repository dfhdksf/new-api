package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type pelicanModelTransport func(*http.Request) (*http.Response, error)

func (f pelicanModelTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFetchPelicanModelsSendsOnlyUpstreamCredentialsAndReturnsUniqueIDs(t *testing.T) {
	configureSSRFTestFetchSetting(t)
	originalClient := ssrfProtectedHTTPClient
	t.Cleanup(func() { ssrfProtectedHTTPClient = originalClient })
	ssrfProtectedHTTPClient = &http.Client{Transport: pelicanModelTransport(func(r *http.Request) (*http.Response, error) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "https://8.8.8.8/custom/v1/models", r.URL.String())
		assert.Equal(t, "Bearer test-upstream-key", r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"data":[{"id":"model-b"},{"id":" model-a "},{"id":"model-b"},{"id":""}]}`))}, nil
	})}

	models, err := FetchPelicanModels(context.Background(), "https://8.8.8.8/custom/v1/models", " test-upstream-key ")

	require.NoError(t, err)
	assert.Equal(t, []PelicanModel{{ID: "model-a"}, {ID: "model-b"}}, models)
}

func TestFetchPelicanModelsRejectsUnsafeTargetsBeforeSendingCredentials(t *testing.T) {
	configureSSRFTestFetchSetting(t)
	for _, target := range []string{
		"file:///v1/models", "https://user:pass@8.8.8.8/v1/models",
		"https://8.8.8.8/v1/models?key=hidden", "https://8.8.8.8/v1/models#fragment",
		"https://8.8.8.8/v1/responses", "http://127.0.0.1/v1/models",
		"http://169.254.169.254/v1/models",
	} {
		t.Run(target, func(t *testing.T) {
			models, err := FetchPelicanModels(context.Background(), target, "test-upstream-key")
			require.Error(t, err)
			assert.Nil(t, models)
			assert.NotContains(t, err.Error(), "test-upstream-key")
		})
	}
}

func TestFetchPelicanModelsHandlesUpstreamFailuresWithoutLeakingBodiesOrFollowingRedirects(t *testing.T) {
	configureSSRFTestFetchSetting(t)
	originalClient := ssrfProtectedHTTPClient
	t.Cleanup(func() { ssrfProtectedHTTPClient = originalClient })
	for _, tc := range []struct {
		name   string
		status int
		body   string
		code   string
	}{
		{name: "upstream authentication", status: 401, body: "test-upstream-key", code: "upstream_status"},
		{name: "redirect", status: 302, code: "upstream_status"},
		{name: "HTML instead of models", status: 200, body: "<html>test-upstream-key</html>", code: "invalid_response"},
		{name: "missing model list", status: 200, body: `{"models":[]}`, code: "invalid_response"},
		{name: "oversized response", status: 200, body: strings.Repeat(" ", 2*1024*1024+1), code: "invalid_response"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			ssrfProtectedHTTPClient = &http.Client{Transport: pelicanModelTransport(func(r *http.Request) (*http.Response, error) {
				requests++
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": {"https://8.8.4.4/v1/models"}}, Body: io.NopCloser(strings.NewReader(tc.body)), Request: r}, nil
			})}

			_, err := FetchPelicanModels(context.Background(), "https://8.8.8.8/v1/models", "test-upstream-key")

			var modelError *PelicanModelsError
			require.ErrorAs(t, err, &modelError)
			assert.Equal(t, tc.code, modelError.Code)
			if tc.code == "upstream_status" {
				assert.Equal(t, tc.status, modelError.UpstreamStatus)
			}
			assert.Equal(t, 1, requests)
			assert.NotContains(t, err.Error(), "test-upstream-key")
		})
	}
}

func TestFetchPelicanModelsAcceptsEmptyModelLists(t *testing.T) {
	configureSSRFTestFetchSetting(t)
	originalClient := ssrfProtectedHTTPClient
	t.Cleanup(func() { ssrfProtectedHTTPClient = originalClient })
	ssrfProtectedHTTPClient = &http.Client{Transport: pelicanModelTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[]}`))}, nil
	})}

	models, err := FetchPelicanModels(context.Background(), "https://8.8.8.8/v1/models", "test-upstream-key")

	require.NoError(t, err)
	assert.NotNil(t, models)
	assert.Empty(t, models)
}
