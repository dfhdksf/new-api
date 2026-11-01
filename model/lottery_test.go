package model

import (
	"fmt"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newOngoingLotteryForTest builds an enabled activity that started a minute ago.
func newOngoingLotteryForTest(period int, totalSlots int, tiers ...*LotteryPrizeTier) *LotteryActivity {
	now := common.GetTimestamp()
	return &LotteryActivity{
		Period:     period,
		Name:       fmt.Sprintf("round %d", period),
		StartTime:  now - 60,
		EndTime:    now + 3600,
		Enabled:    true,
		TotalSlots: totalSlots,
		Tiers:      tiers,
	}
}

func reloadLotteryForTest(t *testing.T, id int) *LotteryActivity {
	t.Helper()
	activity := &LotteryActivity{}
	require.NoError(t, DB.First(activity, id).Error)
	require.NoError(t, attachLotteryTiers([]*LotteryActivity{activity}))
	return activity
}

// Drawing every slot hands out exactly the configured prizes: no more, no
// fewer, each as an enabled, never-expiring code of the tier's amount.
func TestDrawLotteryAwardsExactlyThePrizePool(t *testing.T) {
	truncateTables(t)
	activity := newOngoingLotteryForTest(1, 5,
		&LotteryPrizeTier{Quota: 500_000, Count: 1},
		&LotteryPrizeTier{Quota: 250_000, Count: 1},
	)
	require.NoError(t, CreateLotteryActivity(activity))

	wonQuotas := []int{}
	for userId := 1; userId <= 5; userId++ {
		result, err := DrawLottery(activity.Id, userId)
		require.NoError(t, err)
		assert.Equal(t, 1, result.Period)
		if !result.Won {
			assert.Empty(t, result.Code)
			continue
		}
		wonQuotas = append(wonQuotas, result.Quota)
		var redemption Redemption
		require.NoError(t, DB.Where(commonKeyCol+" = ?", result.Code).First(&redemption).Error)
		assert.Equal(t, result.Quota, redemption.Quota)
		assert.Equal(t, common.RedemptionCodeStatusEnabled, redemption.Status)
		assert.Zero(t, redemption.ExpiredTime)
	}
	assert.ElementsMatch(t, []int{500_000, 250_000}, wonQuotas)

	_, err := DrawLottery(activity.Id, 6)
	assert.ErrorIs(t, err, ErrLotterySoldOut)

	reloaded := reloadLotteryForTest(t, activity.Id)
	assert.Zero(t, reloaded.RemainingSlots)
	assert.Zero(t, reloaded.RemainingPrizes)
	for _, tier := range reloaded.Tiers {
		assert.Zero(t, tier.Remaining)
	}
	var rewardCount int64
	require.NoError(t, DB.Model(&RewardCode{}).Where("source = ? AND period = ?", RewardCodeSourceLottery, 1).Count(&rewardCount).Error)
	assert.EqualValues(t, 2, rewardCount)
}

func TestDrawLotteryAllowsOneDrawPerUserUnderConcurrency(t *testing.T) {
	truncateTables(t)
	activity := newOngoingLotteryForTest(2, 10, &LotteryPrizeTier{Quota: 100_000, Count: 5})
	require.NoError(t, CreateLotteryActivity(activity))

	const attempts = 5
	errs := make([]error, attempts)
	var wg sync.WaitGroup
	wg.Add(attempts)
	for i := 0; i < attempts; i++ {
		go func(idx int) {
			defer wg.Done()
			_, errs[idx] = DrawLottery(activity.Id, 42)
		}(i)
	}
	wg.Wait()

	successes := 0
	for _, err := range errs {
		if err == nil {
			successes++
			continue
		}
		assert.ErrorIs(t, err, ErrLotteryAlreadyDrawn)
	}
	assert.Equal(t, 1, successes)

	var drawCount int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Where("activity_id = ?", activity.Id).Count(&drawCount).Error)
	assert.EqualValues(t, 1, drawCount)
	assert.Equal(t, 9, reloadLotteryForTest(t, activity.Id).RemainingSlots)
}

func TestDrawLotteryRejectsInactiveActivities(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()

	paused := newOngoingLotteryForTest(3, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	paused.Enabled = false
	require.NoError(t, CreateLotteryActivity(paused))

	upcoming := newOngoingLotteryForTest(4, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	upcoming.StartTime = now + 600
	require.NoError(t, CreateLotteryActivity(upcoming))

	ended := newOngoingLotteryForTest(5, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(ended))
	require.NoError(t, DB.Model(&LotteryActivity{}).Where("id = ?", ended.Id).Update("end_time", now-1).Error)

	tests := []struct {
		name       string
		activityId int
		want       error
	}{
		{name: "paused", activityId: paused.Id, want: ErrLotteryPaused},
		{name: "not started", activityId: upcoming.Id, want: ErrLotteryNotStarted},
		{name: "ended", activityId: ended.Id, want: ErrLotteryEnded},
		{name: "missing", activityId: ended.Id + 1000, want: ErrLotteryNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DrawLottery(tt.activityId, 7)
			assert.ErrorIs(t, err, tt.want)
		})
	}
	var drawCount int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Count(&drawCount).Error)
	assert.Zero(t, drawCount)
}

func TestCreateLotteryActivityAssignsNextPeriodWhenOmitted(t *testing.T) {
	truncateTables(t)
	first := newOngoingLotteryForTest(0, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(first))
	assert.Equal(t, 1, first.Period)

	require.NoError(t, CreateLotteryActivity(newOngoingLotteryForTest(7, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})))
	next := newOngoingLotteryForTest(0, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(next))
	assert.Equal(t, 8, next.Period)
}

func TestCreateLotteryActivityRejectsInvalidConfiguration(t *testing.T) {
	truncateTables(t)
	require.NoError(t, CreateLotteryActivity(newOngoingLotteryForTest(6, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})))
	now := common.GetTimestamp()

	tests := []struct {
		name   string
		mutate func(activity *LotteryActivity)
		want   error
	}{
		{name: "more prizes than slots", mutate: func(a *LotteryActivity) { a.Tiers = []*LotteryPrizeTier{{Quota: 100_000, Count: 11}} }, want: ErrLotteryPrizesExceedSlots},
		{name: "duplicate period", mutate: func(a *LotteryActivity) { a.Period = 6 }, want: ErrLotteryPeriodExists},
		{name: "already over", mutate: func(a *LotteryActivity) { a.StartTime, a.EndTime = now-7200, now-3600 }, want: ErrLotteryEndTimePassed},
		{name: "no prize tiers", mutate: func(a *LotteryActivity) { a.Tiers = nil }, want: ErrLotteryTiersInvalid},
		{name: "non-positive prize amount", mutate: func(a *LotteryActivity) { a.Tiers = []*LotteryPrizeTier{{Quota: 0, Count: 1}} }, want: ErrLotteryTiersInvalid},
		{name: "prize amount beyond quota range", mutate: func(a *LotteryActivity) { a.Tiers = []*LotteryPrizeTier{{Quota: common.MaxQuota, Count: 1}} }, want: ErrLotteryTiersInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			activity := newOngoingLotteryForTest(7, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
			tt.mutate(activity)
			assert.ErrorIs(t, CreateLotteryActivity(activity), tt.want)
		})
	}
	var count int64
	require.NoError(t, DB.Model(&LotteryActivity{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

// Once an activity starts, slots and prizes are frozen so every participant
// keeps the advertised odds; cosmetic fields stay editable.
func TestUpdateLotteryActivityFreezesPrizesAfterStart(t *testing.T) {
	truncateTables(t)
	started := newOngoingLotteryForTest(8, 10, &LotteryPrizeTier{Quota: 100_000, Count: 2})
	require.NoError(t, CreateLotteryActivity(started))

	moreSlots := newOngoingLotteryForTest(8, 20, &LotteryPrizeTier{Quota: 100_000, Count: 2})
	moreSlots.Id, moreSlots.StartTime, moreSlots.EndTime = started.Id, started.StartTime, started.EndTime
	assert.ErrorIs(t, UpdateLotteryActivity(moreSlots), ErrLotteryStarted)

	richerPrize := newOngoingLotteryForTest(8, 10, &LotteryPrizeTier{Quota: 900_000, Count: 2})
	richerPrize.Id, richerPrize.StartTime, richerPrize.EndTime = started.Id, started.StartTime, started.EndTime
	assert.ErrorIs(t, UpdateLotteryActivity(richerPrize), ErrLotteryStarted)

	cosmetic := newOngoingLotteryForTest(8, 10, &LotteryPrizeTier{Quota: 100_000, Count: 2})
	cosmetic.Id, cosmetic.StartTime = started.Id, started.StartTime
	cosmetic.Name, cosmetic.Description, cosmetic.EndTime, cosmetic.Enabled = "renamed", "new text", started.EndTime+600, false
	require.NoError(t, UpdateLotteryActivity(cosmetic))
	reloaded := reloadLotteryForTest(t, started.Id)
	assert.Equal(t, "renamed", reloaded.Name)
	assert.Equal(t, "new text", reloaded.Description)
	assert.Equal(t, started.EndTime+600, reloaded.EndTime)
	assert.False(t, reloaded.Enabled)
	assert.Equal(t, 10, reloaded.TotalSlots)
	assert.Equal(t, 2, reloaded.PrizeSlots)

	upcoming := newOngoingLotteryForTest(9, 10, &LotteryPrizeTier{Quota: 100_000, Count: 2})
	upcoming.StartTime = common.GetTimestamp() + 600
	require.NoError(t, CreateLotteryActivity(upcoming))
	reconfigured := newOngoingLotteryForTest(9, 20, &LotteryPrizeTier{Quota: 200_000, Count: 5})
	reconfigured.Id, reconfigured.StartTime, reconfigured.EndTime = upcoming.Id, upcoming.StartTime, upcoming.EndTime
	require.NoError(t, UpdateLotteryActivity(reconfigured))
	reloaded = reloadLotteryForTest(t, upcoming.Id)
	assert.Equal(t, 20, reloaded.TotalSlots)
	assert.Equal(t, 20, reloaded.RemainingSlots)
	assert.Equal(t, 5, reloaded.PrizeSlots)
	assert.Equal(t, 5, reloaded.RemainingPrizes)
	require.Len(t, reloaded.Tiers, 1)
	assert.Equal(t, 200_000, reloaded.Tiers[0].Quota)
	assert.Equal(t, 5, reloaded.Tiers[0].Remaining)
}

func TestDeleteLotteryActivityOnlyBeforeAnyDraw(t *testing.T) {
	truncateTables(t)
	drawn := newOngoingLotteryForTest(10, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(drawn))
	_, err := DrawLottery(drawn.Id, 1)
	require.NoError(t, err)
	assert.ErrorIs(t, DeleteLotteryActivity(drawn.Id), ErrLotteryHasDraws)

	unused := newOngoingLotteryForTest(11, 10, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(unused))
	require.NoError(t, DeleteLotteryActivity(unused.Id))
	var tierCount int64
	require.NoError(t, DB.Model(&LotteryPrizeTier{}).Where("activity_id = ?", unused.Id).Count(&tierCount).Error)
	assert.Zero(t, tierCount)
}

// Users see their own result and prize code, the sold-out state once every
// slot is taken, and never another user's code.
func TestUserLotteryViewShowsOwnResultAndSoldOutState(t *testing.T) {
	truncateTables(t)
	activity := newOngoingLotteryForTest(12, 1, &LotteryPrizeTier{Quota: 300_000, Count: 1})
	require.NoError(t, CreateLotteryActivity(activity))
	hidden := newOngoingLotteryForTest(13, 5, &LotteryPrizeTier{Quota: 100_000, Count: 1})
	hidden.Enabled = false
	require.NoError(t, CreateLotteryActivity(hidden))

	result, err := DrawLottery(activity.Id, 21)
	require.NoError(t, err)
	require.True(t, result.Won, "the only slot holds the only prize")

	winnerView, err := GetUserLotteryActivities(21)
	require.NoError(t, err)
	require.Len(t, winnerView, 1, "disabled activities are hidden from users")
	assert.Equal(t, LotteryStateSoldOut, winnerView[0].State)
	require.NotNil(t, winnerView[0].MyDraw)
	assert.True(t, winnerView[0].MyDraw.Won)
	assert.Equal(t, result.Code, winnerView[0].MyDraw.Code)
	assert.Equal(t, RewardCodeStatusUnused, winnerView[0].MyDraw.CodeStatus)

	otherView, err := GetUserLotteryActivities(22)
	require.NoError(t, err)
	require.Len(t, otherView, 1)
	assert.Equal(t, LotteryStateSoldOut, otherView[0].State)
	assert.Nil(t, otherView[0].MyDraw)

	rewards, total, err := GetUserRewardCodes(21, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	assert.Equal(t, RewardCodeSourceLottery, rewards[0].Source)
	assert.Equal(t, 12, rewards[0].Period)
	assert.Equal(t, 300_000, rewards[0].Quota)
}
