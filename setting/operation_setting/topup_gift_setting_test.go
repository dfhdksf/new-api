package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The approved default table makes larger gifts strictly rarer and pays out
// exactly 5% of the credited quota on average.
func TestDefaultTopUpGiftWeightsAverageFivePercentAndFavorSmallGifts(t *testing.T) {
	totalWeight, weightedPercent := 0, 0
	for i, row := range defaultTopUpGiftWeights {
		totalWeight += row.Weight
		weightedPercent += row.Percent * row.Weight
		if i > 0 {
			previous := defaultTopUpGiftWeights[i-1]
			assert.Greater(t, row.Percent, previous.Percent)
			assert.Less(t, row.Weight, previous.Weight, "percent %d must be rarer than %d", row.Percent, previous.Percent)
		}
	}
	assert.Equal(t, 1, defaultTopUpGiftWeights[0].Percent)
	assert.Equal(t, 10, defaultTopUpGiftWeights[len(defaultTopUpGiftWeights)-1].Percent)
	assert.Equal(t, 5*totalWeight, weightedPercent, "expected gift must be exactly 5%")

	encoded := `[{"percent":1,"weight":21},{"percent":2,"weight":20},{"percent":3,"weight":19},{"percent":4,"weight":18},{"percent":5,"weight":17},{"percent":6,"weight":16},{"percent":7,"weight":15},{"percent":8,"weight":14},{"percent":9,"weight":13},{"percent":10,"weight":12}]`
	require.NoError(t, ValidateTopUpGiftWeightsJSON(encoded))
}

func TestValidateTopUpGiftWeightsJSON(t *testing.T) {
	tests := []struct {
		name  string
		value string
		valid bool
	}{
		{name: "single row", value: `[{"percent":5,"weight":1}]`, valid: true},
		{name: "full percent range", value: `[{"percent":1,"weight":1},{"percent":100,"weight":1000000}]`, valid: true},
		{name: "empty string", value: ``},
		{name: "null", value: `null`},
		{name: "empty list", value: `[]`},
		{name: "object instead of list", value: `{"1":21}`},
		{name: "percent below range", value: `[{"percent":0,"weight":1}]`},
		{name: "percent above range", value: `[{"percent":101,"weight":1}]`},
		{name: "zero weight", value: `[{"percent":1,"weight":0}]`},
		{name: "negative weight", value: `[{"percent":1,"weight":-1}]`},
		{name: "weight above bound", value: `[{"percent":1,"weight":1000001}]`},
		{name: "fractional weight", value: `[{"percent":1,"weight":1.5}]`},
		{name: "duplicate percent", value: `[{"percent":3,"weight":1},{"percent":3,"weight":2}]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTopUpGiftWeightsJSON(tt.value)
			if tt.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

// Each row owns Weight consecutive tickets, so the draw probability of a
// percent is exactly Weight / totalWeight.
func TestTopUpGiftTableMapsTicketsToRowsByWeight(t *testing.T) {
	table := &topUpGiftTable{weights: []TopUpGiftWeight{
		{Percent: 1, Weight: 3},
		{Percent: 7, Weight: 1},
		{Percent: 10, Weight: 2},
	}}
	expected := []int{1, 1, 1, 7, 10, 10}
	for ticket, want := range expected {
		percent, ok := table.percentAt(ticket)
		require.True(t, ok, "ticket %d", ticket)
		assert.Equal(t, want, percent, "ticket %d", ticket)
	}
	_, ok := table.percentAt(len(expected))
	assert.False(t, ok, "tickets beyond the total weight belong to no row")
}

func TestLoadTopUpGiftWeightsReplacesActiveTable(t *testing.T) {
	t.Cleanup(func() {
		storeTopUpGiftWeights(defaultTopUpGiftWeights)
		topUpGiftSetting.Weights = defaultTopUpGiftWeights
	})

	LoadTopUpGiftWeightsFromJSONString(`[{"percent":42,"weight":7}]`)
	percent, ok, err := PickTopUpGiftPercent()
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, 42, percent)
	minPercent, maxPercent, ok := TopUpGiftPercentRange()
	require.True(t, ok)
	assert.Equal(t, 42, minPercent)
	assert.Equal(t, 42, maxPercent)

	// A corrupt stored value fails closed: nothing is drawn until it is fixed.
	LoadTopUpGiftWeightsFromJSONString(`[{"percent":0,"weight":1}]`)
	_, ok, err = PickTopUpGiftPercent()
	require.NoError(t, err)
	assert.False(t, ok)
	_, _, ok = TopUpGiftPercentRange()
	assert.False(t, ok)
}
