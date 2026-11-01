package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// configureTopUpGiftForTest sets the gift switch and weight table for one test
// and restores the previous configuration afterwards.
func configureTopUpGiftForTest(t *testing.T, enabled bool, weightsJSON string) {
	t.Helper()
	setting := operation_setting.GetTopUpGiftSetting()
	previousEnabled := setting.Enabled
	previousWeights, err := common.Marshal(setting.Weights)
	require.NoError(t, err)
	t.Cleanup(func() {
		setting.Enabled = previousEnabled
		operation_setting.LoadTopUpGiftWeightsFromJSONString(string(previousWeights))
	})
	setting.Enabled = enabled
	operation_setting.LoadTopUpGiftWeightsFromJSONString(weightsJSON)
}

func useQuotaPerUnitForTest(t *testing.T, quotaPerUnit float64) {
	t.Helper()
	previous := common.QuotaPerUnit
	common.QuotaPerUnit = quotaPerUnit
	t.Cleanup(func() { common.QuotaPerUnit = previous })
}

func findTopUpGiftsForTest(t *testing.T, topUpId int) []RewardCode {
	t.Helper()
	var gifts []RewardCode
	require.NoError(t, DB.Where("source = ? AND source_id = ?", RewardCodeSourceTopUpGift, topUpId).Find(&gifts).Error)
	return gifts
}

func TestTopUpGiftQuotaFloorsPercentAndRaisesToTenCents(t *testing.T) {
	useQuotaPerUnitForTest(t, 500000)

	tests := []struct {
		name          string
		creditedQuota int
		percent       int
		want          int
	}{
		{name: "1% of the $10 minimum top-up is exactly $0.1", creditedQuota: 5_000_000, percent: 1, want: 50_000},
		{name: "10% of $10", creditedQuota: 5_000_000, percent: 10, want: 500_000},
		{name: "fractional quota is floored", creditedQuota: 10_000_001, percent: 3, want: 300_000},
		{name: "gift below $0.1 is raised to $0.1", creditedQuota: 500_000, percent: 1, want: 50_000},
		{name: "tiny credit still gets $0.1", creditedQuota: 1, percent: 100, want: 50_000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := topUpGiftQuota(tt.creditedQuota, tt.percent)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

// A paid order yields exactly one transferable, never-expiring code, and a
// retried payment callback must not issue a second one.
func TestRechargeEpayIssuesOneGiftCodePerOrder(t *testing.T) {
	truncateTables(t)
	useQuotaPerUnitForTest(t, 500000)
	configureTopUpGiftForTest(t, true, `[{"percent":10,"weight":1}]`)

	buyer := insertUserForPaymentGuardTest(t, 601, 0)
	order := createEpayTestOrder(t, buyer.Id, "EPAYGIFTONCE", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	require.False(t, alreadyDone)
	assert.Equal(t, 1_000_000, getUserQuotaForPaymentGuardTest(t, buyer.Id), "the gift is a code, not extra wallet quota")

	gifts := findTopUpGiftsForTest(t, order.Id)
	require.Len(t, gifts, 1)
	gift := gifts[0]
	assert.Equal(t, buyer.Id, gift.UserId)
	assert.Equal(t, 10, gift.Percent)
	assert.Equal(t, 100_000, gift.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, gift.RedemptionId).Error)
	assert.Equal(t, gift.Code, redemption.Key)
	assert.Equal(t, gift.Quota, redemption.Quota)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, redemption.Status)
	assert.Zero(t, redemption.ExpiredTime, "gift codes never expire")

	alreadyDone, err = RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	assert.Len(t, findTopUpGiftsForTest(t, order.Id), 1)
	var redemptionCount int64
	require.NoError(t, DB.Model(&Redemption{}).Count(&redemptionCount).Error)
	assert.EqualValues(t, 1, redemptionCount)
}

// The gift is computed from the quota actually credited, which for Stripe
// includes the top-up group ratio baked into Money.
func TestStripeTopUpGiftUsesCreditedQuota(t *testing.T) {
	truncateTables(t)
	useQuotaPerUnitForTest(t, 500000)
	configureTopUpGiftForTest(t, true, `[{"percent":10,"weight":1}]`)

	buyer := insertUserForPaymentGuardTest(t, 602, 0)
	order := &TopUp{
		UserId:          buyer.Id,
		Amount:          2,
		Money:           12.5,
		TradeNo:         "STRIPEGIFT",
		PaymentMethod:   PaymentMethodStripe,
		PaymentProvider: PaymentProviderStripe,
		CreateTime:      common.GetTimestamp(),
		Status:          common.TopUpStatusPending,
	}
	require.NoError(t, DB.Create(order).Error)

	require.NoError(t, Recharge(order.TradeNo, "cus_gift", "127.0.0.1"))
	assert.Equal(t, 6_250_000, getUserQuotaForPaymentGuardTest(t, buyer.Id))

	gifts := findTopUpGiftsForTest(t, order.Id)
	require.Len(t, gifts, 1)
	assert.Equal(t, 625_000, gifts[0].Quota)
}

func TestTopUpGiftNotIssuedForDisabledSettingOrManualCompletion(t *testing.T) {
	truncateTables(t)
	useQuotaPerUnitForTest(t, 500000)

	configureTopUpGiftForTest(t, false, `[{"percent":10,"weight":1}]`)
	buyer := insertUserForPaymentGuardTest(t, 603, 0)
	paid := createEpayTestOrder(t, buyer.Id, "EPAYGIFTDISABLED", PaymentProviderEpay, common.TopUpStatusPending)
	_, err := RechargeEpay(paid.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.Empty(t, findTopUpGiftsForTest(t, paid.Id), "no gift while the feature is off")

	operation_setting.GetTopUpGiftSetting().Enabled = true
	manual := createEpayTestOrder(t, buyer.Id, "EPAYGIFTMANUAL", PaymentProviderEpay, common.TopUpStatusPending)
	require.NoError(t, ManualCompleteTopUp(manual.TradeNo, "127.0.0.1"))
	assert.Equal(t, 2_000_000, getUserQuotaForPaymentGuardTest(t, buyer.Id))
	assert.Empty(t, findTopUpGiftsForTest(t, manual.Id), "admin manual completion never issues a gift")
}

// Anyone may redeem a gift code, and the buyer's history keeps showing it as
// used even after an admin purges used redemption codes.
func TestTopUpGiftIsTransferableAndHistorySurvivesCleanup(t *testing.T) {
	truncateTables(t)
	useQuotaPerUnitForTest(t, 500000)
	configureTopUpGiftForTest(t, true, `[{"percent":10,"weight":1}]`)

	buyer := insertUserForPaymentGuardTest(t, 604, 0)
	friend := &User{Id: 605, Username: "gift_friend", Status: common.UserStatusEnabled, AffCode: "giftfriend"}
	require.NoError(t, DB.Create(friend).Error)
	order := createEpayTestOrder(t, buyer.Id, "EPAYGIFTSHARE", PaymentProviderEpay, common.TopUpStatusPending)
	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	topUps := []*TopUp{GetTopUpByTradeNo(order.TradeNo)}
	require.NoError(t, AttachTopUpGifts(topUps))
	require.NotNil(t, topUps[0].Gift)
	assert.Equal(t, RewardCodeStatusUnused, topUps[0].Gift.Status)

	redeemed, err := Redeem(topUps[0].Gift.Code, friend.Id)
	require.NoError(t, err)
	assert.Equal(t, 100_000, redeemed)
	assert.Equal(t, 100_000, getUserQuotaForPaymentGuardTest(t, friend.Id))

	_, err = DeleteInvalidRedemptions()
	require.NoError(t, err)

	rewards, total, err := GetUserRewardCodes(buyer.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, rewards, 1)
	assert.Equal(t, RewardCodeStatusUsed, rewards[0].Status)
	assert.Equal(t, topUps[0].Gift.Code, rewards[0].Code)
}

// After a hard delete, the user's codes and draws must not follow a reused id
// (SQLite hands the next registration the deleted maximum id).
func TestHardDeleteDetachesRewardCodesAndDraws(t *testing.T) {
	truncateTables(t)
	useQuotaPerUnitForTest(t, 500000)
	configureTopUpGiftForTest(t, true, `[{"percent":10,"weight":1}]`)

	buyer := insertUserForPaymentGuardTest(t, 606, 0)
	order := createEpayTestOrder(t, buyer.Id, "EPAYGIFTHARDDELETE", PaymentProviderEpay, common.TopUpStatusPending)
	_, err := RechargeEpay(order.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	activity := newOngoingLotteryForTest(30, 1, &LotteryPrizeTier{Quota: 200_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(activity))
	result, err := DrawLottery(activity.Id, buyer.Id)
	require.NoError(t, err)
	require.True(t, result.Won)

	_, err = HardDeleteUserById(buyer.Id)
	require.NoError(t, err)
	successor := &User{Id: buyer.Id, Username: "reused_id_user", Status: common.UserStatusEnabled, AffCode: "reusedid"}
	require.NoError(t, DB.Create(successor).Error)

	rewards, total, err := GetUserRewardCodes(successor.Id, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Zero(t, total)
	assert.Empty(t, rewards)

	topUps := []*TopUp{GetTopUpByTradeNo(order.TradeNo)}
	require.NoError(t, AttachTopUpGifts(topUps))
	assert.Nil(t, topUps[0].Gift, "a leftover order row must not expose the old gift code")

	views, err := GetUserLotteryActivities(successor.Id)
	require.NoError(t, err)
	require.Len(t, views, 1)
	assert.Nil(t, views[0].MyDraw)

	reopened := newOngoingLotteryForTest(31, 5, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(reopened))
	_, err = DrawLottery(reopened.Id, successor.Id)
	assert.NoError(t, err, "the successor can still draw in new rounds")

	var codes int64
	require.NoError(t, DB.Model(&RewardCode{}).Count(&codes).Error)
	assert.GreaterOrEqual(t, codes, int64(2), "issued codes are kept, only detached from the deleted user")
}
