package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

type LotteryActivityRequest struct {
	Period      int                       `json:"period"`
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	StartTime   int64                     `json:"start_time"`
	EndTime     int64                     `json:"end_time"`
	Enabled     bool                      `json:"enabled"`
	TotalSlots  int                       `json:"total_slots"`
	Tiers       []LotteryPrizeTierRequest `json:"tiers"`
}

type LotteryPrizeTierRequest struct {
	Quota int `json:"quota"`
	Count int `json:"count"`
}

type LotteryStatusRequest struct {
	Enabled *bool `json:"enabled"`
}

func (req *LotteryActivityRequest) toActivity(id int) *model.LotteryActivity {
	activity := &model.LotteryActivity{
		Id:          id,
		Period:      req.Period,
		Name:        req.Name,
		Description: req.Description,
		StartTime:   req.StartTime,
		EndTime:     req.EndTime,
		Enabled:     req.Enabled,
		TotalSlots:  req.TotalSlots,
		Tiers:       make([]*model.LotteryPrizeTier, 0, len(req.Tiers)),
	}
	for _, tier := range req.Tiers {
		activity.Tiers = append(activity.Tiers, &model.LotteryPrizeTier{Quota: tier.Quota, Count: tier.Count})
	}
	return activity
}

// respondLotteryError 把抽奖业务错误翻译给用户，其余错误只记日志并返回通用提示。
func respondLotteryError(c *gin.Context, err error, fallbackKey string) {
	var lotteryErr model.LotteryError
	if errors.As(err, &lotteryErr) {
		common.ApiErrorI18n(c, string(lotteryErr))
		return
	}
	common.SysError("lottery operation failed: " + err.Error())
	common.ApiErrorI18n(c, fallbackKey)
}

func lotteryIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidId)
		return 0, false
	}
	return id, true
}

// ---- User APIs ----

func GetUserLotteryActivities(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiSuccess(c, []*model.UserLotteryActivity{})
		return
	}
	activities, err := model.GetUserLotteryActivities(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, activities)
}

func DrawLottery(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := lotteryIdParam(c)
	if !ok {
		return
	}
	result, err := model.DrawLottery(id, c.GetInt("id"))
	if err != nil {
		respondLotteryError(c, err, i18n.MsgLotteryDrawFailed)
		return
	}
	common.ApiSuccess(c, result)
}

func GetUserRewardCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	rewards, total, err := model.GetUserRewardCodes(c.GetInt("id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(rewards)
	common.ApiSuccess(c, pageInfo)
}

// ---- Admin APIs ----

func AdminListLotteryActivities(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	activities, total, err := model.GetLotteryActivities(pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(activities)
	common.ApiSuccess(c, pageInfo)
}

func AdminCreateLotteryActivity(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req LotteryActivityRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	activity := req.toActivity(0)
	if err := model.CreateLotteryActivity(activity); err != nil {
		respondLotteryError(c, err, i18n.MsgCreateFailed)
		return
	}
	recordManageAudit(c, "lottery.create", map[string]interface{}{
		"id":     activity.Id,
		"period": activity.Period,
		"name":   activity.Name,
	})
	common.ApiSuccess(c, activity)
}

func AdminUpdateLotteryActivity(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := lotteryIdParam(c)
	if !ok {
		return
	}
	var req LotteryActivityRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	activity := req.toActivity(id)
	if err := model.UpdateLotteryActivity(activity); err != nil {
		respondLotteryError(c, err, i18n.MsgUpdateFailed)
		return
	}
	recordManageAudit(c, "lottery.update", map[string]interface{}{
		"id":     id,
		"period": activity.Period,
		"name":   activity.Name,
	})
	common.ApiSuccess(c, nil)
}

func AdminUpdateLotteryActivityStatus(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	id, ok := lotteryIdParam(c)
	if !ok {
		return
	}
	var req LotteryStatusRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Enabled == nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.SetLotteryActivityEnabled(id, *req.Enabled); err != nil {
		respondLotteryError(c, err, i18n.MsgUpdateFailed)
		return
	}
	action := "lottery.disable"
	if *req.Enabled {
		action = "lottery.enable"
	}
	recordManageAudit(c, action, map[string]interface{}{"id": id})
	common.ApiSuccess(c, nil)
}

func AdminDeleteLotteryActivity(c *gin.Context) {
	id, ok := lotteryIdParam(c)
	if !ok {
		return
	}
	if err := model.DeleteLotteryActivity(id); err != nil {
		respondLotteryError(c, err, i18n.MsgDeleteFailed)
		return
	}
	recordManageAudit(c, "lottery.delete", map[string]interface{}{"id": id})
	common.ApiSuccess(c, nil)
}

func AdminListLotteryDraws(c *gin.Context) {
	id, ok := lotteryIdParam(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	records, total, err := model.GetLotteryDrawRecords(id, c.Query("won") == "true", pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}
