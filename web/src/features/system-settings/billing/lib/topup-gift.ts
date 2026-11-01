/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { z } from 'zod'

import { tryJsonParse } from '../../utils/json-parser'

/** One row of the gift table: `percent` is drawn with probability weight / sum(weight). */
export type TopUpGiftWeight = {
  percent: number
  weight: number
}

// Bounds mirror setting/operation_setting/topup_gift_setting.go.
const MIN_PERCENT = 1
const MAX_PERCENT = 100
const MAX_WEIGHT = 1_000_000
export const TOPUP_GIFT_MAX_ROWS = MAX_PERCENT - MIN_PERCENT + 1

// Validation messages are i18n keys; FormMessage renders them through t().
const PERCENT_ERROR = 'Enter a whole number from 1 to 100'
const WEIGHT_ERROR = 'Enter a whole number from 1 to 1,000,000'
const DUPLICATE_PERCENT_ERROR = 'This percent is already in the table'
const ROW_COUNT_ERROR = 'The table needs between 1 and 100 rows'

/**
 * The server default (weight = 22 - percent for 1%..10%) as a fresh table.
 * Larger gifts are rarer and the expected gift is exactly 5%.
 */
export function createDefaultTopUpGiftWeights(): TopUpGiftWeight[] {
  return Array.from({ length: 10 }, (_, index) => ({
    percent: index + 1,
    weight: 21 - index,
  }))
}

export function isValidTopUpGiftPercent(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PERCENT && value <= MAX_PERCENT
}

export function isValidTopUpGiftWeight(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_WEIGHT
}

/** Validates a weight table exactly like the server does before saving it. */
export const topUpGiftWeightsSchema = z
  .array(
    z.object({
      percent: z
        .number(PERCENT_ERROR)
        .refine(isValidTopUpGiftPercent, PERCENT_ERROR),
      weight: z
        .number(WEIGHT_ERROR)
        .refine(isValidTopUpGiftWeight, WEIGHT_ERROR),
    })
  )
  .min(1, ROW_COUNT_ERROR)
  .max(TOPUP_GIFT_MAX_ROWS, ROW_COUNT_ERROR)
  .superRefine((rows, ctx) => {
    // Flag every row of a duplicated percent so the editor marks all of them.
    const counts = new Map<number, number>()
    for (const row of rows) {
      counts.set(row.percent, (counts.get(row.percent) ?? 0) + 1)
    }
    rows.forEach((row, index) => {
      if ((counts.get(row.percent) ?? 0) < 2) return
      ctx.addIssue({
        code: 'custom',
        message: DUPLICATE_PERCENT_ERROR,
        path: [index, 'percent'],
      })
    })
  })

export const topUpGiftSettingsSchema = z.object({
  enabled: z.boolean(),
  weights: topUpGiftWeightsSchema,
})

export type TopUpGiftSettingsValues = z.infer<typeof topUpGiftSettingsSchema>

export function sortTopUpGiftWeights(
  rows: readonly TopUpGiftWeight[]
): TopUpGiftWeight[] {
  return [...rows].sort((a, b) => a.percent - b.percent)
}

/** Index at which a row with `percent` keeps the table sorted by percent. */
export function sortedTopUpGiftIndex(
  rows: readonly TopUpGiftWeight[],
  percent: number
): number {
  const index = rows.findIndex((row) => row.percent > percent)
  return index === -1 ? rows.length : index
}

/** Percent for a newly added row: one above the largest unused, else the smallest free one. */
export function nextTopUpGiftPercent(
  rows: readonly TopUpGiftWeight[]
): number | null {
  const used = new Set(
    rows.map((row) => row.percent).filter(isValidTopUpGiftPercent)
  )
  const largest = Math.max(MIN_PERCENT - 1, ...used)
  if (largest < MAX_PERCENT) return largest + 1
  for (let percent = MIN_PERCENT; percent <= MAX_PERCENT; percent++) {
    if (!used.has(percent)) return percent
  }
  return null
}

/**
 * Reads the stored `topup_gift_setting.weights` option. An empty value means
 * the server default is in force. A value the server would reject falls back
 * to the default table with `valid: false`: the server issues no gift codes
 * until a valid table is saved.
 */
export function parseStoredTopUpGiftWeights(raw: string): {
  rows: TopUpGiftWeight[]
  valid: boolean
} {
  if (raw.trim() === '') {
    return { rows: createDefaultTopUpGiftWeights(), valid: true }
  }
  const json = tryJsonParse(raw)
  const parsed = json.success
    ? topUpGiftWeightsSchema.safeParse(json.data)
    : null
  if (!parsed?.success) {
    return { rows: createDefaultTopUpGiftWeights(), valid: false }
  }
  return { rows: sortTopUpGiftWeights(parsed.data), valid: true }
}

/** Option value to save: rows sorted by percent, `{percent, weight}` only. */
export function serializeTopUpGiftWeights(
  rows: readonly TopUpGiftWeight[]
): string {
  return JSON.stringify(
    sortTopUpGiftWeights(rows).map((row) => ({
      percent: row.percent,
      weight: row.weight,
    }))
  )
}

export type TopUpGiftOdds = {
  /** Draw chance of each row in percent; null for a row that is not valid. */
  probabilities: Array<number | null>
  /** Expected gift as a percent of the credited quota; null without valid rows. */
  expectedPercent: number | null
}

/** Odds over the valid rows only, so a half-edited row never skews the preview. */
export function computeTopUpGiftOdds(
  rows: readonly TopUpGiftWeight[]
): TopUpGiftOdds {
  const counted = rows.map(
    (row) =>
      isValidTopUpGiftPercent(row.percent) && isValidTopUpGiftWeight(row.weight)
  )
  let totalWeight = 0
  let weightedPercent = 0
  rows.forEach((row, index) => {
    if (!counted[index]) return
    totalWeight += row.weight
    weightedPercent += row.percent * row.weight
  })

  if (totalWeight === 0) {
    return { probabilities: rows.map(() => null), expectedPercent: null }
  }
  return {
    probabilities: rows.map((row, index) =>
      counted[index] ? (row.weight / totalWeight) * 100 : null
    ),
    expectedPercent: weightedPercent / totalWeight,
  }
}
