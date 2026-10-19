package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func FetchPelicanModels(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8*1024)
	var request struct {
		ModelsURL string `json:"models_url" binding:"required"`
		APIKey    string `json:"api_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": service.PelicanModelsError{Code: "invalid_request"}})
		return
	}
	models, err := service.FetchPelicanModels(c.Request.Context(), request.ModelsURL, request.APIKey)
	if err != nil {
		var modelError *service.PelicanModelsError
		if !errors.As(err, &modelError) {
			modelError = &service.PelicanModelsError{Code: "unreachable"}
		}
		status := http.StatusBadGateway
		if modelError.Code == "invalid_request" {
			status = http.StatusBadRequest
		} else if modelError.Code == "blocked_target" {
			status = http.StatusForbidden
		}
		// Upstream 401 responses are not application authentication failures.
		c.JSON(status, gin.H{"error": modelError})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}
