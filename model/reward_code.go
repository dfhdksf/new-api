package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	RewardCodeSourceTopUpGift = "topup_gift"
	RewardCodeSourceLottery   = "lottery"
)

// 奖励兑换码的当前状态，由关联的 Redemption 推导，不落库。
const (
	RewardCodeStatusUnused   = "unused"
	RewardCodeStatusUsed     = "used"
	RewardCodeStatusDisabled = "disabled"
	RewardCodeStatusInvalid  = "invalid"
)

// topUpGiftMinUsd 是单张充值赠码的最低面额（美元）。
var topUpGiftMinUsd = decimal.New(1, -1)

// RewardCode 记录系统发给用户的兑换码（充值赠码、抽奖奖品）。兑换码本身是普通的
// Redemption，任何人都能兑换；这里另存码和额度，使管理员清理已使用的兑换码后，
// 用户仍能看到自己获得过的奖励。(source, source_id) 唯一，保证同一订单或同一次
// 抽奖最多发一张码。
type RewardCode struct {
	Id           int    `json:"id"`
	UserId       int    `json:"user_id" gorm:"not null;index"`
	Source       string `json:"source" gorm:"type:varchar(32);not null;uniqueIndex:idx_reward_code_source,priority:1"`
	SourceId     int    `json:"source_id" gorm:"not null;uniqueIndex:idx_reward_code_source,priority:2"`
	Percent      int    `json:"percent"`
	Period       int    `json:"period"`
	RedemptionId int    `json:"redemption_id" gorm:"not null"`
	Code         string `json:"code" gorm:"type:char(32);not null"`
	Quota        int    `json:"quota" gorm:"not null"`
	CreatedTime  int64  `json:"created_time" gorm:"bigint"`
	Status       string `json:"status" gorm:"-:all"`
}

// createRewardCodeTx 在调用方事务内生成一张永不过期的兑换码，并登记为该用户获得的奖励。
func createRewardCodeTx(tx *gorm.DB, reward *RewardCode, redemptionName string) error {
	if reward.Quota <= 0 || reward.Quota >= common.MaxQuota {
		return fmt.Errorf("invalid reward code quota %d", reward.Quota)
	}
	now := common.GetTimestamp()
	redemption := &Redemption{
		Key:         common.GetUUID(),
		Status:      common.RedemptionCodeStatusEnabled,
		Name:        redemptionName,
		Quota:       reward.Quota,
		CreatedTime: now,
	}
	if err := tx.Create(redemption).Error; err != nil {
		return err
	}
	reward.RedemptionId = redemption.Id
	reward.Code = redemption.Key
	reward.CreatedTime = now
	reward.Status = RewardCodeStatusUnused
	return tx.Create(reward).Error
}

// topUpGiftQuota 按赠送比例计算赠码额度：向下取整，且不低于 $0.1。
func topUpGiftQuota(creditedQuota int, percent int) (int, error) {
	gift := decimal.NewFromInt(int64(creditedQuota)).
		Mul(decimal.NewFromInt(int64(percent))).
		Div(decimal.NewFromInt(100)).
		Floor()
	minGift := decimal.NewFromFloat(common.QuotaPerUnit).Mul(topUpGiftMinUsd).Ceil()
	if gift.LessThan(minGift) {
		gift = minGift
	}
	quota, err := common.QuotaFromDecimalStrict(gift)
	if err != nil {
		return 0, err
	}
	if quota <= 0 {
		return 0, fmt.Errorf("top-up gift quota must be positive, got %d", quota)
	}
	return quota, nil
}

// issueTopUpGiftTx 在充值入账的同一事务内为订单生成赠码。
// 算不出有效额度时只记录错误并跳过，避免配置问题让支付回调反复失败；
// 写库失败则返回错误，整笔入账随之回滚，等待支付渠道重试回调。
func issueTopUpGiftTx(tx *gorm.DB, topUp *TopUp, creditedQuota int) (*RewardCode, error) {
	if !operation_setting.IsTopUpGiftEnabled() {
		return nil, nil
	}
	percent, ok, err := operation_setting.PickTopUpGiftPercent()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	giftQuota, err := topUpGiftQuota(creditedQuota, percent)
	if err != nil {
		common.SysError(common.LogText("skip top-up gift trade_no=%s credited_quota=%d percent=%d: %v", topUp.TradeNo, creditedQuota, percent, err))
		return nil, nil
	}
	gift := &RewardCode{
		UserId:   topUp.UserId,
		Source:   RewardCodeSourceTopUpGift,
		SourceId: topUp.Id,
		Percent:  percent,
		Quota:    giftQuota,
	}
	if err := createRewardCodeTx(tx, gift, fmt.Sprintf("充值赠送%d%%", percent)); err != nil {
		return nil, err
	}
	return gift, nil
}

// recordTopUpGiftLog 在充值事务提交后记录赠码日志。
func recordTopUpGiftLog(gift *RewardCode) {
	if gift == nil {
		return
	}
	RecordLog(gift.UserId, LogTypeSystem, common.NewMessage("Top-up gift code worth {{quota}} ({{percent}}% of the credited amount)", map[string]any{"quota": logger.FormatQuota(gift.Quota), "percent": gift.Percent}))
}

// fillRewardCodeStatus 根据关联的兑换码推导状态。需要包含已被软删除的兑换码：
// 管理员“清除无效兑换码”会删除已使用的码，此时仍应显示“已使用”。
func fillRewardCodeStatus(rewards []*RewardCode) error {
	if len(rewards) == 0 {
		return nil
	}
	ids := make([]int, 0, len(rewards))
	for _, reward := range rewards {
		ids = append(ids, reward.RedemptionId)
	}
	var redemptions []Redemption
	if err := DB.Unscoped().Select("id", "status", "expired_time", "deleted_at").Where("id IN ?", ids).Find(&redemptions).Error; err != nil {
		return err
	}
	byId := make(map[int]Redemption, len(redemptions))
	for _, redemption := range redemptions {
		byId[redemption.Id] = redemption
	}
	now := common.GetTimestamp()
	for _, reward := range rewards {
		redemption, ok := byId[reward.RedemptionId]
		switch {
		case !ok:
			reward.Status = RewardCodeStatusInvalid
		case redemption.Status == common.RedemptionCodeStatusUsed:
			reward.Status = RewardCodeStatusUsed
		case redemption.DeletedAt.Valid:
			reward.Status = RewardCodeStatusInvalid
		case redemption.Status == common.RedemptionCodeStatusDisabled:
			reward.Status = RewardCodeStatusDisabled
		case redemption.ExpiredTime != 0 && redemption.ExpiredTime < now:
			reward.Status = RewardCodeStatusInvalid
		default:
			reward.Status = RewardCodeStatusUnused
		}
	}
	return nil
}

// detachUserRewardsTx 在硬删除用户时解除其奖励码和抽奖记录的归属。SQLite 会复用被删除的最大用户 ID，
// 不解除的话新注册用户会看到并能兑换前一个用户的码，还会被判定为已参与过抽奖。
// 抽奖记录改为负的自身 ID，既不会与真实用户冲突，也保持 (activity_id, user_id) 唯一。
func detachUserRewardsTx(tx *gorm.DB, userId int) error {
	if err := tx.Model(&RewardCode{}).Where("user_id = ?", userId).Update("user_id", 0).Error; err != nil {
		return err
	}
	return tx.Model(&LotteryDraw{}).Where("user_id = ?", userId).Update("user_id", gorm.Expr("-id")).Error
}

// GetUserRewardCodes 分页返回用户获得的兑换码（最新的在前），带当前状态。
func GetUserRewardCodes(userId int, pageInfo *common.PageInfo) ([]*RewardCode, int64, error) {
	var total int64
	if err := DB.Model(&RewardCode{}).Where("user_id = ?", userId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rewards := make([]*RewardCode, 0)
	if err := DB.Where("user_id = ?", userId).Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&rewards).Error; err != nil {
		return nil, 0, err
	}
	if err := fillRewardCodeStatus(rewards); err != nil {
		return nil, 0, err
	}
	return rewards, total, nil
}

// AttachTopUpGifts 为充值记录附上该订单的赠码（没有赠码的订单保持 nil）。
func AttachTopUpGifts(topUps []*TopUp) error {
	if len(topUps) == 0 {
		return nil
	}
	ids := make([]int, 0, len(topUps))
	for _, topUp := range topUps {
		ids = append(ids, topUp.Id)
	}
	var gifts []*RewardCode
	if err := DB.Where("source = ? AND source_id IN ?", RewardCodeSourceTopUpGift, ids).Find(&gifts).Error; err != nil {
		return err
	}
	if err := fillRewardCodeStatus(gifts); err != nil {
		return err
	}
	byTopUpId := make(map[int]*RewardCode, len(gifts))
	for _, gift := range gifts {
		byTopUpId[gift.SourceId] = gift
	}
	for _, topUp := range topUps {
		// 归属已解除的赠码（原用户被硬删除）不再附到充值记录上。
		if gift := byTopUpId[topUp.Id]; gift != nil && gift.UserId == topUp.UserId {
			topUp.Gift = gift
		}
	}
	return nil
}
