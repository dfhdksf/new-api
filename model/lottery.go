package model

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

const (
	lotteryMaxSlots          = 1_000_000
	lotteryMaxTiers          = 20
	lotteryNameMaxLength     = 64
	lotteryDescMaxLength     = 500
	lotteryDrawMaxAttempts   = 3
	lotteryUserActivityLimit = 20
)

// 用户视角的活动状态，由服务端时间和剩余名额推导。
const (
	LotteryStateUpcoming = "upcoming"
	LotteryStateOngoing  = "ongoing"
	LotteryStateSoldOut  = "sold_out"
	LotteryStateEnded    = "ended"
)

// LotteryError 是可以直接展示给用户的抽奖业务错误，文本是英文原文，即前端语言包的键（common.Message）。
type LotteryError string

func (e LotteryError) Error() string { return string(e) }

const (
	ErrLotteryNotFound           LotteryError = "Lottery activity not found"
	ErrLotteryPaused             LotteryError = "This lottery is paused"
	ErrLotteryNotStarted         LotteryError = "This lottery has not started yet"
	ErrLotteryEnded              LotteryError = "This lottery has ended"
	ErrLotterySoldOut            LotteryError = "All slots for this round are taken. See you next time!"
	ErrLotteryAlreadyDrawn       LotteryError = "You have already drawn in this round"
	ErrLotteryBusy               LotteryError = "Too many people are drawing right now, please try again"
	ErrLotteryPeriodInvalid      LotteryError = "Round number must be a positive integer"
	ErrLotteryPeriodExists       LotteryError = "A lottery with this round number already exists"
	ErrLotteryNameInvalid        LotteryError = "Name must be 1 to 64 characters"
	ErrLotteryDescriptionTooLong LotteryError = "Description cannot exceed 500 characters"
	ErrLotteryTimeInvalid        LotteryError = "End time must be later than start time"
	ErrLotteryEndTimePassed      LotteryError = "End time must be in the future"
	ErrLotterySlotsInvalid       LotteryError = "Slots must be between 1 and 1000000"
	ErrLotteryTiersInvalid       LotteryError = "Add 1 to 20 prize tiers, each with a positive amount and count"
	ErrLotteryPrizesExceedSlots  LotteryError = "Total prizes cannot exceed the number of slots"
	ErrLotteryStarted            LotteryError = "Round, start time, slots and prizes cannot be changed after the lottery starts"
	ErrLotteryHasDraws           LotteryError = "Cannot delete a lottery that already has draws"
)

// errLotteryDrawConflict 表示抽奖期间活动计数被并发修改，整次抽奖回滚后重试。
var errLotteryDrawConflict = errors.New("lottery draw conflict")

// LotteryActivity 是一期抽奖：TotalSlots 个名额里有 PrizeSlots 份奖品，按名额无放回抽取，
// 每位用户每期只能抽一次。剩余名额为 R、剩余奖品为 P 时，抽中的概率为 P/R，
// 因此不论先后，每个名额的中奖概率都是 PrizeSlots/TotalSlots，名额抽完时奖品恰好发完。
type LotteryActivity struct {
	Id              int                 `json:"id"`
	Period          int                 `json:"period" gorm:"column:period_no;not null;uniqueIndex:idx_lottery_activities_period_no"`
	Name            string              `json:"name" gorm:"type:varchar(64);not null"`
	Description     string              `json:"description" gorm:"type:varchar(512)"`
	StartTime       int64               `json:"start_time" gorm:"bigint;not null"`
	EndTime         int64               `json:"end_time" gorm:"bigint;not null"`
	Enabled         bool                `json:"enabled"`
	TotalSlots      int                 `json:"total_slots" gorm:"not null"`
	PrizeSlots      int                 `json:"prize_slots" gorm:"not null"`
	RemainingSlots  int                 `json:"remaining_slots" gorm:"not null"`
	RemainingPrizes int                 `json:"remaining_prizes" gorm:"not null"`
	CreatedTime     int64               `json:"created_time" gorm:"bigint"`
	UpdatedTime     int64               `json:"updated_time" gorm:"bigint"`
	Tiers           []*LotteryPrizeTier `json:"tiers" gorm:"-:all"`
}

// LotteryPrizeTier 是一档奖品：Count 份、每份 Quota 额度。兑换码在中奖时才生成。
type LotteryPrizeTier struct {
	Id         int `json:"id"`
	ActivityId int `json:"activity_id" gorm:"not null;index"`
	Quota      int `json:"quota" gorm:"not null"`
	Count      int `json:"count" gorm:"not null"`
	Remaining  int `json:"remaining" gorm:"not null"`
}

// LotteryDraw 是一次参与记录，(activity_id, user_id) 唯一。
type LotteryDraw struct {
	Id          int   `json:"id"`
	ActivityId  int   `json:"activity_id" gorm:"not null;uniqueIndex:idx_lottery_draw_user,priority:1"`
	UserId      int   `json:"user_id" gorm:"not null;uniqueIndex:idx_lottery_draw_user,priority:2;index"`
	Won         bool  `json:"won"`
	TierId      int   `json:"tier_id"`
	Quota       int   `json:"quota"`
	CreatedTime int64 `json:"created_time" gorm:"bigint"`
}

// LotteryDrawResult 是一次抽奖的结果，中奖时带上兑换码。
type LotteryDrawResult struct {
	Won    bool   `json:"won"`
	Quota  int    `json:"quota"`
	Code   string `json:"code"`
	Period int    `json:"period"`
}

// UserLotteryActivity 是用户可见的活动信息，不暴露剩余奖品数，避免用户据此择时参与。
type UserLotteryActivity struct {
	Id             int                `json:"id"`
	Period         int                `json:"period"`
	Name           string             `json:"name"`
	Description    string             `json:"description"`
	StartTime      int64              `json:"start_time"`
	EndTime        int64              `json:"end_time"`
	TotalSlots     int                `json:"total_slots"`
	PrizeSlots     int                `json:"prize_slots"`
	RemainingSlots int                `json:"remaining_slots"`
	State          string             `json:"state"`
	Prizes         []UserLotteryPrize `json:"prizes"`
	MyDraw         *UserLotteryDraw   `json:"my_draw"`
}

type UserLotteryPrize struct {
	Id    int `json:"id"`
	Quota int `json:"quota"`
	Count int `json:"count"`
}

type UserLotteryDraw struct {
	Won         bool   `json:"won"`
	Quota       int    `json:"quota"`
	Code        string `json:"code,omitempty"`
	CodeStatus  string `json:"code_status,omitempty"`
	CreatedTime int64  `json:"created_time"`
}

// LotteryDrawRecord 是管理员查看的参与记录。
type LotteryDrawRecord struct {
	LotteryDraw
	Username   string `json:"username"`
	Code       string `json:"code,omitempty"`
	CodeStatus string `json:"code_status,omitempty"`
}

// LotteryActivityState 返回活动对用户呈现的状态。
func LotteryActivityState(activity *LotteryActivity, now int64) string {
	switch {
	case now < activity.StartTime:
		return LotteryStateUpcoming
	case activity.RemainingSlots <= 0:
		return LotteryStateSoldOut
	case now >= activity.EndTime:
		return LotteryStateEnded
	default:
		return LotteryStateOngoing
	}
}

// validateLotteryActivity 校验管理员提交的活动配置，并据奖品档位算出奖品总份数。
func validateLotteryActivity(activity *LotteryActivity) error {
	activity.Name = strings.TrimSpace(activity.Name)
	activity.Description = strings.TrimSpace(activity.Description)
	if activity.Period <= 0 {
		return ErrLotteryPeriodInvalid
	}
	nameLength := utf8.RuneCountInString(activity.Name)
	if nameLength == 0 || nameLength > lotteryNameMaxLength {
		return ErrLotteryNameInvalid
	}
	if utf8.RuneCountInString(activity.Description) > lotteryDescMaxLength {
		return ErrLotteryDescriptionTooLong
	}
	if activity.StartTime <= 0 || activity.EndTime <= activity.StartTime {
		return ErrLotteryTimeInvalid
	}
	if activity.TotalSlots <= 0 || activity.TotalSlots > lotteryMaxSlots {
		return ErrLotterySlotsInvalid
	}
	if len(activity.Tiers) == 0 || len(activity.Tiers) > lotteryMaxTiers {
		return ErrLotteryTiersInvalid
	}
	prizeSlots := 0
	for _, tier := range activity.Tiers {
		if tier == nil || tier.Quota <= 0 || tier.Quota >= common.MaxQuota || tier.Count <= 0 || tier.Count > lotteryMaxSlots {
			return ErrLotteryTiersInvalid
		}
		prizeSlots += tier.Count
	}
	if prizeSlots > activity.TotalSlots {
		return ErrLotteryPrizesExceedSlots
	}
	activity.PrizeSlots = prizeSlots
	return nil
}

func createLotteryTiersTx(tx *gorm.DB, activity *LotteryActivity) error {
	for _, tier := range activity.Tiers {
		tier.Id = 0
		tier.ActivityId = activity.Id
		tier.Remaining = tier.Count
	}
	return tx.Create(&activity.Tiers).Error
}

func attachLotteryTiers(activities []*LotteryActivity) error {
	if len(activities) == 0 {
		return nil
	}
	ids := make([]int, 0, len(activities))
	for _, activity := range activities {
		ids = append(ids, activity.Id)
	}
	var tiers []*LotteryPrizeTier
	if err := DB.Where("activity_id IN ?", ids).Order("id asc").Find(&tiers).Error; err != nil {
		return err
	}
	byActivity := make(map[int][]*LotteryPrizeTier, len(activities))
	for _, tier := range tiers {
		byActivity[tier.ActivityId] = append(byActivity[tier.ActivityId], tier)
	}
	for _, activity := range activities {
		activity.Tiers = byActivity[activity.Id]
		if activity.Tiers == nil {
			activity.Tiers = []*LotteryPrizeTier{}
		}
	}
	return nil
}

// CreateLotteryActivity 创建活动；Period 为 0 时自动取下一期（当前最大期数 + 1）。
func CreateLotteryActivity(activity *LotteryActivity) error {
	if activity.Period == 0 {
		var maxPeriod int
		if err := DB.Model(&LotteryActivity{}).Select("COALESCE(MAX(period_no), 0)").Scan(&maxPeriod).Error; err != nil {
			return err
		}
		activity.Period = maxPeriod + 1
	}
	if err := validateLotteryActivity(activity); err != nil {
		return err
	}
	now := common.GetTimestamp()
	if activity.EndTime <= now {
		return ErrLotteryEndTimePassed
	}
	activity.Id = 0
	activity.RemainingSlots = activity.TotalSlots
	activity.RemainingPrizes = activity.PrizeSlots
	activity.CreatedTime = now
	activity.UpdatedTime = now
	return DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&LotteryActivity{}).Where("period_no = ?", activity.Period).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrLotteryPeriodExists
		}
		if err := tx.Create(activity).Error; err != nil {
			return err
		}
		return createLotteryTiersTx(tx, activity)
	})
}

// UpdateLotteryActivity 修改活动。活动开始后只能改名称、描述、结束时间和启用状态；
// 期数、开始时间、名额和奖品保持不变，保证对已参与用户公平。
func UpdateLotteryActivity(input *LotteryActivity) error {
	if err := validateLotteryActivity(input); err != nil {
		return err
	}
	now := common.GetTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		existing := &LotteryActivity{}
		if err := lockForUpdate(tx).Where("id = ?", input.Id).First(existing).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLotteryNotFound
			}
			return err
		}
		if input.EndTime != existing.EndTime && input.EndTime <= now {
			return ErrLotteryEndTimePassed
		}

		started := now >= existing.StartTime || existing.RemainingSlots != existing.TotalSlots
		if started {
			var tiers []*LotteryPrizeTier
			if err := tx.Where("activity_id = ?", existing.Id).Order("id asc").Find(&tiers).Error; err != nil {
				return err
			}
			tiersChanged := len(tiers) != len(input.Tiers)
			for i := 0; !tiersChanged && i < len(tiers); i++ {
				tiersChanged = tiers[i].Quota != input.Tiers[i].Quota || tiers[i].Count != input.Tiers[i].Count
			}
			if tiersChanged || input.Period != existing.Period || input.StartTime != existing.StartTime || input.TotalSlots != existing.TotalSlots {
				return ErrLotteryStarted
			}
			return tx.Model(existing).Updates(map[string]interface{}{
				"name":         input.Name,
				"description":  input.Description,
				"end_time":     input.EndTime,
				"enabled":      input.Enabled,
				"updated_time": now,
			}).Error
		}

		if input.Period != existing.Period {
			var count int64
			if err := tx.Model(&LotteryActivity{}).Where("period_no = ? AND id <> ?", input.Period, existing.Id).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return ErrLotteryPeriodExists
			}
		}
		err := tx.Model(existing).Updates(map[string]interface{}{
			"period_no":        input.Period,
			"name":             input.Name,
			"description":      input.Description,
			"start_time":       input.StartTime,
			"end_time":         input.EndTime,
			"enabled":          input.Enabled,
			"total_slots":      input.TotalSlots,
			"prize_slots":      input.PrizeSlots,
			"remaining_slots":  input.TotalSlots,
			"remaining_prizes": input.PrizeSlots,
			"updated_time":     now,
		}).Error
		if err != nil {
			return err
		}
		if err := tx.Where("activity_id = ?", existing.Id).Delete(&LotteryPrizeTier{}).Error; err != nil {
			return err
		}
		return createLotteryTiersTx(tx, input)
	})
}

func SetLotteryActivityEnabled(id int, enabled bool) error {
	var count int64
	if err := DB.Model(&LotteryActivity{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrLotteryNotFound
	}
	return DB.Model(&LotteryActivity{}).Where("id = ?", id).Updates(map[string]interface{}{
		"enabled":      enabled,
		"updated_time": common.GetTimestamp(),
	}).Error
}

// DeleteLotteryActivity 删除尚无人参与的活动。
func DeleteLotteryActivity(id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		activity := &LotteryActivity{}
		if err := lockForUpdate(tx).Where("id = ?", id).First(activity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrLotteryNotFound
			}
			return err
		}
		var draws int64
		if err := tx.Model(&LotteryDraw{}).Where("activity_id = ?", id).Count(&draws).Error; err != nil {
			return err
		}
		if draws > 0 || activity.RemainingSlots != activity.TotalSlots {
			return ErrLotteryHasDraws
		}
		if err := tx.Where("activity_id = ?", id).Delete(&LotteryPrizeTier{}).Error; err != nil {
			return err
		}
		return tx.Delete(activity).Error
	})
}

// GetLotteryActivities 分页返回全部活动（期数倒序），供管理员使用。
func GetLotteryActivities(pageInfo *common.PageInfo) ([]*LotteryActivity, int64, error) {
	var total int64
	if err := DB.Model(&LotteryActivity{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	activities := make([]*LotteryActivity, 0)
	if err := DB.Order("period_no desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&activities).Error; err != nil {
		return nil, 0, err
	}
	if err := attachLotteryTiers(activities); err != nil {
		return nil, 0, err
	}
	return activities, total, nil
}

// GetLotteryDrawRecords 分页返回某期的参与记录（最新的在前），wonOnly 时只返回中奖记录。
func GetLotteryDrawRecords(activityId int, wonOnly bool, pageInfo *common.PageInfo) ([]*LotteryDrawRecord, int64, error) {
	query := DB.Model(&LotteryDraw{}).Where("activity_id = ?", activityId)
	if wonOnly {
		query = query.Where("won = ?", true)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var draws []LotteryDraw
	if err := query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&draws).Error; err != nil {
		return nil, 0, err
	}
	records := make([]*LotteryDrawRecord, 0, len(draws))
	if len(draws) == 0 {
		return records, total, nil
	}

	userIds := make([]int, 0, len(draws))
	drawIds := make([]int, 0, len(draws))
	for _, draw := range draws {
		userIds = append(userIds, draw.UserId)
		drawIds = append(drawIds, draw.Id)
	}
	var users []User
	if err := DB.Unscoped().Select("id", "username").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	usernames := make(map[int]string, len(users))
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	var rewards []*RewardCode
	if err := DB.Where("source = ? AND source_id IN ?", RewardCodeSourceLottery, drawIds).Find(&rewards).Error; err != nil {
		return nil, 0, err
	}
	if err := fillRewardCodeStatus(rewards); err != nil {
		return nil, 0, err
	}
	rewardsByDraw := make(map[int]*RewardCode, len(rewards))
	for _, reward := range rewards {
		rewardsByDraw[reward.SourceId] = reward
	}

	for _, draw := range draws {
		record := &LotteryDrawRecord{LotteryDraw: draw, Username: usernames[draw.UserId]}
		if reward := rewardsByDraw[draw.Id]; reward != nil {
			record.Code = reward.Code
			record.CodeStatus = reward.Status
		}
		records = append(records, record)
	}
	return records, total, nil
}

// GetUserLotteryActivities 返回已启用的最近几期活动，附带该用户的参与结果。
func GetUserLotteryActivities(userId int) ([]*UserLotteryActivity, error) {
	var activities []*LotteryActivity
	if err := DB.Where("enabled = ?", true).Order("period_no desc").Limit(lotteryUserActivityLimit).Find(&activities).Error; err != nil {
		return nil, err
	}
	views := make([]*UserLotteryActivity, 0, len(activities))
	if len(activities) == 0 {
		return views, nil
	}
	if err := attachLotteryTiers(activities); err != nil {
		return nil, err
	}

	activityIds := make([]int, 0, len(activities))
	for _, activity := range activities {
		activityIds = append(activityIds, activity.Id)
	}
	var draws []LotteryDraw
	if err := DB.Where("user_id = ? AND activity_id IN ?", userId, activityIds).Find(&draws).Error; err != nil {
		return nil, err
	}
	drawsByActivity := make(map[int]LotteryDraw, len(draws))
	wonDrawIds := make([]int, 0, len(draws))
	for _, draw := range draws {
		drawsByActivity[draw.ActivityId] = draw
		if draw.Won {
			wonDrawIds = append(wonDrawIds, draw.Id)
		}
	}
	rewardsByDraw := make(map[int]*RewardCode, len(wonDrawIds))
	if len(wonDrawIds) > 0 {
		var rewards []*RewardCode
		if err := DB.Where("source = ? AND source_id IN ?", RewardCodeSourceLottery, wonDrawIds).Find(&rewards).Error; err != nil {
			return nil, err
		}
		if err := fillRewardCodeStatus(rewards); err != nil {
			return nil, err
		}
		for _, reward := range rewards {
			rewardsByDraw[reward.SourceId] = reward
		}
	}

	now := common.GetTimestamp()
	for _, activity := range activities {
		view := &UserLotteryActivity{
			Id:             activity.Id,
			Period:         activity.Period,
			Name:           activity.Name,
			Description:    activity.Description,
			StartTime:      activity.StartTime,
			EndTime:        activity.EndTime,
			TotalSlots:     activity.TotalSlots,
			PrizeSlots:     activity.PrizeSlots,
			RemainingSlots: activity.RemainingSlots,
			State:          LotteryActivityState(activity, now),
			Prizes:         make([]UserLotteryPrize, 0, len(activity.Tiers)),
		}
		for _, tier := range activity.Tiers {
			view.Prizes = append(view.Prizes, UserLotteryPrize{Id: tier.Id, Quota: tier.Quota, Count: tier.Count})
		}
		if draw, ok := drawsByActivity[activity.Id]; ok {
			view.MyDraw = &UserLotteryDraw{Won: draw.Won, Quota: draw.Quota, CreatedTime: draw.CreatedTime}
			if reward := rewardsByDraw[draw.Id]; reward != nil {
				view.MyDraw.Code = reward.Code
				view.MyDraw.CodeStatus = reward.Status
			}
		}
		views = append(views, view)
	}
	return views, nil
}

// DrawLottery 为用户抽一次奖。活动行加锁，剩余名额/奖品用条件更新扣减；
// 条件更新落空（计数被并发修改）时整次抽奖回滚后重试。
func DrawLottery(activityId int, userId int) (*LotteryDrawResult, error) {
	var result *LotteryDrawResult
	var reward *RewardCode
	var err error
	for attempt := 0; attempt < lotteryDrawMaxAttempts; attempt++ {
		result, reward = nil, nil
		err = DB.Transaction(func(tx *gorm.DB) error {
			// SQLite 先读后写的事务在锁升级时会直接报 database is locked；先做一次空写拿到写锁，
			// 并发抽奖改为排队等待。MySQL/PostgreSQL 由下面的行锁串行化。
			if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
				if err := tx.Model(&LotteryActivity{}).Where("id = ?", activityId).Update("remaining_slots", gorm.Expr("remaining_slots")).Error; err != nil {
					return err
				}
			}
			activity := &LotteryActivity{}
			if err := lockForUpdate(tx).Where("id = ?", activityId).First(activity).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrLotteryNotFound
				}
				return err
			}
			now := common.GetTimestamp()
			if !activity.Enabled {
				return ErrLotteryPaused
			}
			if now < activity.StartTime {
				return ErrLotteryNotStarted
			}
			if now >= activity.EndTime {
				return ErrLotteryEnded
			}
			var drawn int64
			if err := tx.Model(&LotteryDraw{}).Where("activity_id = ? AND user_id = ?", activityId, userId).Count(&drawn).Error; err != nil {
				return err
			}
			if drawn > 0 {
				return ErrLotteryAlreadyDrawn
			}
			if activity.RemainingSlots <= 0 {
				return ErrLotterySoldOut
			}

			roll, err := common.GetSecureRandomInt(activity.RemainingSlots)
			if err != nil {
				return err
			}
			won := roll < activity.RemainingPrizes

			// 中奖时，roll 恰好落在剩余奖品的某一份上：按档位顺序依次扣除各档余量即可定位。
			var tier *LotteryPrizeTier
			prizeDelta := 0
			if won {
				var tiers []*LotteryPrizeTier
				if err := tx.Where("activity_id = ? AND remaining > 0", activityId).Order("id asc").Find(&tiers).Error; err != nil {
					return err
				}
				offset := roll
				for _, candidate := range tiers {
					if offset < candidate.Remaining {
						tier = candidate
						break
					}
					offset -= candidate.Remaining
				}
				if tier == nil {
					return errLotteryDrawConflict
				}
				prizeDelta = 1
			}

			update := tx.Model(&LotteryActivity{}).
				Where("id = ? AND remaining_slots = ? AND remaining_prizes = ?", activity.Id, activity.RemainingSlots, activity.RemainingPrizes).
				Updates(map[string]interface{}{
					"remaining_slots":  gorm.Expr("remaining_slots - 1"),
					"remaining_prizes": gorm.Expr("remaining_prizes - ?", prizeDelta),
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return errLotteryDrawConflict
			}

			draw := &LotteryDraw{ActivityId: activity.Id, UserId: userId, Won: won, CreatedTime: now}
			if won {
				tierUpdate := tx.Model(&LotteryPrizeTier{}).
					Where("id = ? AND remaining = ?", tier.Id, tier.Remaining).
					Update("remaining", gorm.Expr("remaining - 1"))
				if tierUpdate.Error != nil {
					return tierUpdate.Error
				}
				if tierUpdate.RowsAffected != 1 {
					return errLotteryDrawConflict
				}
				draw.TierId = tier.Id
				draw.Quota = tier.Quota
			}
			if err := tx.Create(draw).Error; err != nil {
				return err
			}

			result = &LotteryDrawResult{Won: won, Period: activity.Period}
			if !won {
				return nil
			}
			reward = &RewardCode{
				UserId:   userId,
				Source:   RewardCodeSourceLottery,
				SourceId: draw.Id,
				Period:   activity.Period,
				Quota:    tier.Quota,
			}
			if err := createRewardCodeTx(tx, reward, fmt.Sprintf("第%d期抽奖奖品", activity.Period)); err != nil {
				return err
			}
			result.Quota = reward.Quota
			result.Code = reward.Code
			return nil
		})
		if !errors.Is(err, errLotteryDrawConflict) {
			break
		}
	}
	if errors.Is(err, errLotteryDrawConflict) {
		return nil, ErrLotteryBusy
	}
	if err != nil {
		return nil, err
	}
	if reward != nil {
		RecordLog(userId, LogTypeSystem, common.NewMessage("Won a redemption code worth {{quota}} in lottery round {{period}}", map[string]any{"quota": logger.FormatQuota(reward.Quota), "period": result.Period}))
	}
	return result, nil
}
