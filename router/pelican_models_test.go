package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPelicanProxyRequiresLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetApiRouter(engine)
	for _, endpoint := range []string{"models", "run"} {
		t.Run(endpoint, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/pelican-test/"+endpoint, strings.NewReader(`{"models_url":"https://example.com/v1/models","api_key":"test-key"}`))
			req.Header.Set("Content-Type", "application/json")
			if endpoint == "run" {
				req.Header.Set("Accept-Encoding", "gzip")
			}
			recorder := httptest.NewRecorder()

			require.NotPanics(t, func() { engine.ServeHTTP(recorder, req) })
			assert.Equal(t, http.StatusUnauthorized, recorder.Code)
			if endpoint == "run" {
				assert.Empty(t, recorder.Header().Get("Content-Encoding"), "streaming route must bypass gzip buffering")
			}
			assert.NotContains(t, recorder.Body.String(), "test-key")
		})
	}
}
