package operation_setting

import (
	"fmt"
	"slices"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// ---------------------------------------------------------------------------
// Top-up gift codes: after a paid top-up is credited, the buyer receives one
// redemption code worth a weighted-random percent of the credited quota.
// DB keys: topup_gift_setting.enabled, topup_gift_setting.weights
//
// The weight table is read on the payment-callback path, so it is served from
// a validated, immutable snapshot swapped atomically on every option update
// (handled as a special case in model.handleConfigUpdate).
// ---------------------------------------------------------------------------

const TopUpGiftWeightsOptionKey = "topup_gift_setting.weights"

const (
	topUpGiftMinPercent  = 1
	topUpGiftMaxPercent  = 100
	topUpGiftMaxWeight   = 1_000_000
	topUpGiftMaxRowCount = topUpGiftMaxPercent - topUpGiftMinPercent + 1
)

// TopUpGiftWeight is one row of the weight table: Percent is drawn with
// probability Weight / sum(Weight).
type TopUpGiftWeight struct {
	Percent int `json:"percent"`
	Weight  int `json:"weight"`
}

type TopUpGiftSetting struct {
	Enabled bool              `json:"enabled"`
	Weights []TopUpGiftWeight `json:"weights"`
}

// defaultTopUpGiftWeights uses weight = 22 - percent: larger gifts are rarer,
// sum(weight) = 165 and sum(percent*weight) = 825, so the expected gift is
// exactly 5% of the credited quota.
var defaultTopUpGiftWeights = []TopUpGiftWeight{
	{Percent: 1, Weight: 21},
	{Percent: 2, Weight: 20},
	{Percent: 3, Weight: 19},
	{Percent: 4, Weight: 18},
	{Percent: 5, Weight: 17},
	{Percent: 6, Weight: 16},
	{Percent: 7, Weight: 15},
	{Percent: 8, Weight: 14},
	{Percent: 9, Weight: 13},
	{Percent: 10, Weight: 12},
}

var topUpGiftSetting = TopUpGiftSetting{
	Enabled: false,
	Weights: slices.Clone(defaultTopUpGiftWeights),
}

type topUpGiftTable struct {
	weights     []TopUpGiftWeight
	totalWeight int
}

var activeTopUpGiftTable atomic.Pointer[topUpGiftTable]

func init() {
	config.GlobalConfig.Register("topup_gift_setting", &topUpGiftSetting)
	storeTopUpGiftWeights(defaultTopUpGiftWeights)
}

func GetTopUpGiftSetting() *TopUpGiftSetting {
	return &topUpGiftSetting
}

func IsTopUpGiftEnabled() bool {
	return topUpGiftSetting.Enabled
}

func parseTopUpGiftWeights(value string) ([]TopUpGiftWeight, error) {
	var weights []TopUpGiftWeight
	if err := common.UnmarshalJsonStr(value, &weights); err != nil {
		return nil, fmt.Errorf("充值赠码权重必须是 [{percent, weight}] 格式的 JSON 数组: %w", err)
	}
	if len(weights) == 0 || len(weights) > topUpGiftMaxRowCount {
		return nil, fmt.Errorf("充值赠码权重表需要 1 到 %d 行", topUpGiftMaxRowCount)
	}
	seen := make(map[int]bool, len(weights))
	for i, row := range weights {
		if row.Percent < topUpGiftMinPercent || row.Percent > topUpGiftMaxPercent {
			return nil, fmt.Errorf("第 %d 行的赠送比例 %d%% 超出范围 %d%%~%d%%", i+1, row.Percent, topUpGiftMinPercent, topUpGiftMaxPercent)
		}
		if row.Weight < 1 || row.Weight > topUpGiftMaxWeight {
			return nil, fmt.Errorf("第 %d 行的权重 %d 超出范围 1~%d", i+1, row.Weight, topUpGiftMaxWeight)
		}
		if seen[row.Percent] {
			return nil, fmt.Errorf("赠送比例 %d%% 重复", row.Percent)
		}
		seen[row.Percent] = true
	}
	return weights, nil
}

// ValidateTopUpGiftWeightsJSON validates an operator-supplied weight table
// before it is persisted.
func ValidateTopUpGiftWeightsJSON(value string) error {
	_, err := parseTopUpGiftWeights(value)
	return err
}

// LoadTopUpGiftWeightsFromJSONString swaps the active weight table. An invalid
// stored value (only possible by editing the database directly) fails closed:
// no gift is issued until the table is fixed.
func LoadTopUpGiftWeightsFromJSONString(value string) {
	weights, err := parseTopUpGiftWeights(value)
	if err != nil {
		common.SysError("加载充值赠码权重失败，暂停发放赠码: " + err.Error())
	}
	topUpGiftSetting.Weights = weights
	storeTopUpGiftWeights(weights)
}

func storeTopUpGiftWeights(weights []TopUpGiftWeight) {
	table := &topUpGiftTable{weights: slices.Clone(weights)}
	for _, row := range table.weights {
		table.totalWeight += row.Weight
	}
	activeTopUpGiftTable.Store(table)
}

// percentAt maps a ticket n in [0, totalWeight) to its row: each row owns a
// run of Weight consecutive tickets, in table order.
func (table *topUpGiftTable) percentAt(n int) (int, bool) {
	for _, row := range table.weights {
		if n < row.Weight {
			return row.Percent, true
		}
		n -= row.Weight
	}
	return 0, false
}

// PickTopUpGiftPercent draws one percent from the active table using
// crypto/rand. ok is false when the table is empty.
func PickTopUpGiftPercent() (percent int, ok bool, err error) {
	table := activeTopUpGiftTable.Load()
	if table == nil || table.totalWeight <= 0 {
		return 0, false, nil
	}
	n, err := common.GetSecureRandomInt(table.totalWeight)
	if err != nil {
		return 0, false, err
	}
	percent, ok = table.percentAt(n)
	return percent, ok, nil
}

// TopUpGiftPercentRange reports the smallest and largest percent that can be
// drawn, for display on the top-up page. ok is false when the table is empty.
func TopUpGiftPercentRange() (minPercent int, maxPercent int, ok bool) {
	table := activeTopUpGiftTable.Load()
	if table == nil || len(table.weights) == 0 {
		return 0, 0, false
	}
	minPercent, maxPercent = table.weights[0].Percent, table.weights[0].Percent
	for _, row := range table.weights[1:] {
		minPercent = min(minPercent, row.Percent)
		maxPercent = max(maxPercent, row.Percent)
	}
	return minPercent, maxPercent, true
}
