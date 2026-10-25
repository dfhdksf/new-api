package router

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newAuthRefreshTestRouter(t *testing.T, useRedis bool, globalLimit int) *gin.Engine {
	t.Helper()
	previousRedisEnabled, previousRDB := common.RedisEnabled, common.RDB
	previousGlobalEnabled, previousGlobalNum, previousGlobalDuration := common.GlobalApiRateLimitEnable, common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration
	previousCriticalEnabled, previousCriticalNum, previousCriticalDuration := common.CriticalRateLimitEnable, common.CriticalRateLimitNum, common.CriticalRateLimitDuration
	previousCookieSecure, previousTurnstile, previousPasswordLogin := common.SessionCookieSecure, common.TurnstileCheckEnabled, common.PasswordLoginEnabled
	t.Cleanup(func() {
		common.RedisEnabled, common.RDB = previousRedisEnabled, previousRDB
		common.GlobalApiRateLimitEnable, common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration = previousGlobalEnabled, previousGlobalNum, previousGlobalDuration
		common.CriticalRateLimitEnable, common.CriticalRateLimitNum, common.CriticalRateLimitDuration = previousCriticalEnabled, previousCriticalNum, previousCriticalDuration
		common.SessionCookieSecure, common.TurnstileCheckEnabled, common.PasswordLoginEnabled = previousCookieSecure, previousTurnstile, previousPasswordLogin
	})
	common.RedisEnabled = useRedis
	if useRedis {
		server := miniredis.RunT(t)
		client := redis.NewClient(&redis.Options{Addr: server.Addr()})
		t.Cleanup(func() { require.NoError(t, client.Close()) })
		require.NoError(t, client.Ping(context.Background()).Err())
		common.RDB = client
	}
	common.GlobalApiRateLimitEnable, common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration = true, globalLimit, 180
	common.CriticalRateLimitEnable, common.CriticalRateLimitNum, common.CriticalRateLimitDuration = true, 2, 1200
	common.SessionCookieSecure, common.TurnstileCheckEnabled, common.PasswordLoginEnabled = false, false, true
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	require.NoError(t, engine.SetTrustedProxies(nil))
	SetApiRouter(engine)
	return engine
}

func TestAuthRefreshDoesNotConsumeLoginRateLimit(t *testing.T) {
	for _, tc := range []struct {
		name  string
		redis bool
	}{{name: "memory"}, {name: "redis", redis: true}} {
		t.Run(tc.name, func(t *testing.T) {
			engine := newAuthRefreshTestRouter(t, tc.redis, 100)
			// A missing cookie must still reach authentication, even after more
			// refresh requests than the password-login budget permits.
			for attempt := 0; attempt < 3; attempt++ {
				request := httptest.NewRequest(http.MethodPost, "/api/user/auth/refresh", nil)
				request.RemoteAddr = "192.0.2.201:12345"
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				require.Equal(t, http.StatusUnauthorized, response.Code)
			}
			for attempt, expected := range []int{http.StatusOK, http.StatusOK, http.StatusTooManyRequests} {
				// Empty credentials stop before database access while still exercising
				// the real password-login middleware and request validation.
				request := httptest.NewRequest(http.MethodPost, "/api/user/login", strings.NewReader(`{}`))
				request.RemoteAddr = "192.0.2.201:12345"
				request.Header.Set("Content-Type", "application/json")
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				assert.Equal(t, expected, response.Code, "login attempt %d", attempt+1)
			}
		})
	}
}

func TestAuthRefreshRetainsGlobalAPIRateLimit(t *testing.T) {
	for _, tc := range []struct {
		name  string
		redis bool
	}{{name: "memory"}, {name: "redis", redis: true}} {
		t.Run(tc.name, func(t *testing.T) {
			engine := newAuthRefreshTestRouter(t, tc.redis, 2)
			for attempt, expected := range []int{http.StatusUnauthorized, http.StatusUnauthorized, http.StatusTooManyRequests} {
				request := httptest.NewRequest(http.MethodPost, "/api/user/auth/refresh", nil)
				request.RemoteAddr = "192.0.2.202:12345"
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				assert.Equal(t, expected, response.Code, "refresh attempt %d", attempt+1)
				if expected == http.StatusTooManyRequests {
					assert.NotEmpty(t, response.Header().Get("Retry-After"))
				}
			}
		})
	}
}
