package controller

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func RunPelicanTest(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	var request service.PelicanRunRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": service.PelicanRunError{Code: "invalid_request"}})
		return
	}
	if request.Stream != nil && *request.Stream {
		streamPelicanTest(c, request)
		return
	}
	data, err := service.RunPelicanTest(c.Request.Context(), c.GetInt("id"), request)
	if err != nil {
		var failure *service.PelicanRunError
		if !errors.As(err, &failure) {
			failure = &service.PelicanRunError{Code: "unreachable"}
		}
		status := http.StatusBadGateway
		switch failure.Code {
		case "invalid_request":
			status = http.StatusBadRequest
		case "blocked_target":
			status = http.StatusForbidden
		case "busy":
			status = http.StatusTooManyRequests
		case "timeout":
			status = http.StatusGatewayTimeout
		case "cancelled":
			status = http.StatusRequestTimeout
		}
		// Upstream authentication failures must not expire the dashboard login.
		c.JSON(status, gin.H{"error": failure})
		return
	}
	c.Data(http.StatusOK, "application/json", data)
}

// Only this goroutine writes to the response; upstream reads and heartbeats
// share a channel so cancellation never races a Gin writer or leaks a run slot.
func streamPelicanTest(c *gin.Context, request service.PelicanRunRequest) {
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-store, no-transform")
	c.Header("X-Accel-Buffering", "no")
	if _, err := io.WriteString(c.Writer, ": pelican-ready\n\n"); err != nil {
		return
	}
	c.Writer.Flush()
	chunks := make(chan []byte)
	finished := make(chan error, 1)
	userID := c.GetInt("id")
	go func() {
		finished <- service.StreamPelicanTest(ctx, userID, request, func(chunk []byte) error {
			select {
			case chunks <- chunk:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case chunk := <-chunks:
			if _, err := c.Writer.Write(chunk); err != nil {
				return
			}
			c.Writer.Flush()
		case <-heartbeat.C:
			if _, err := io.WriteString(c.Writer, ": keep-alive\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		case err := <-finished:
			if err != nil && ctx.Err() == nil {
				var failure *service.PelicanRunError
				if !errors.As(err, &failure) {
					failure = &service.PelicanRunError{Code: "unreachable"}
				}
				data, marshalErr := common.Marshal(gin.H{"error": failure})
				if marshalErr == nil {
					// Terminate any incomplete upstream frame before our error event.
					_, _ = io.WriteString(c.Writer, "\n\nevent: pelican.error\ndata: ")
					_, _ = c.Writer.Write(data)
					_, _ = io.WriteString(c.Writer, "\n\n")
					c.Writer.Flush()
				}
			}
			return
		}
	}
}
