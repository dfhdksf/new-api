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

import { parseQuotaFromDollars, quotaUnitsToEditableAmount } from '@/lib/format'
import { getWinRatePercent } from '@/lib/reward-code'

import type { LotteryActivity, LotteryActivityPayload } from '../types'

// Bounds mirror model/lottery.go.
export const LOTTERY_LIMITS = {
  NAME_MAX: 64,
  DESCRIPTION_MAX: 500,
  SLOTS_MAX: 1_000_000,
  TIERS_MAX: 20,
  QUOTA_MAX: 2_147_483_646,
} as const

// Validation messages are i18n keys; FormMessage renders them through t().
export const LOTTERY_FORM_ERRORS = {
  PERIOD: 'Round must be a positive whole number',
  NAME: 'Name must be 1 to 64 characters',
  DESCRIPTION: 'Description cannot exceed 500 characters',
  START_TIME: 'Select a start time',
  END_TIME: 'Select an end time',
  END_BEFORE_START: 'End time must be later than start time',
  END_PASSED: 'End time must be in the future',
  SLOTS: 'Slots must be a whole number from 1 to 1,000,000',
  TIER_AMOUNT: 'Enter an amount greater than 0',
  TIER_COUNT: 'Count must be a whole number from 1 to 1,000,000',
  TIERS_COUNT: 'Add 1 to 20 prize tiers',
  PRIZES_EXCEED_SLOTS: 'Total prizes cannot exceed the number of slots',
} as const

/** Code points, matching the server's utf8.RuneCountInString. */
export function countCharacters(value: string): number {
  return [...value].length
}

export type LotteryActivityState =
  | 'disabled'
  | 'upcoming'
  | 'ongoing'
  | 'sold_out'
  | 'ended'

/** Display state of a round for admins, mirroring the server's rules. */
export function getAdminActivityState(
  activity: Pick<
    LotteryActivity,
    'enabled' | 'start_time' | 'end_time' | 'remaining_slots'
  >,
  nowSeconds: number
): LotteryActivityState {
  if (!activity.enabled) return 'disabled'
  if (nowSeconds < activity.start_time) return 'upcoming'
  if (activity.remaining_slots <= 0) return 'sold_out'
  if (nowSeconds >= activity.end_time) return 'ended'
  return 'ongoing'
}

/**
 * Whether round, start time, slots and prizes are frozen. Matches the server:
 * once the start time passes or anyone has drawn, only cosmetic fields change.
 */
export function isActivityLocked(
  activity: Pick<
    LotteryActivity,
    'start_time' | 'remaining_slots' | 'total_slots'
  >,
  nowSeconds: number
): boolean {
  return (
    nowSeconds >= activity.start_time ||
    activity.remaining_slots !== activity.total_slots
  )
}

const tierSchema = z.object({
  amount: z
    .number(LOTTERY_FORM_ERRORS.TIER_AMOUNT)
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: LOTTERY_FORM_ERRORS.TIER_AMOUNT,
    })
    .refine(
      (value) => {
        const quota = parseQuotaFromDollars(value)
        return quota >= 1 && quota <= LOTTERY_LIMITS.QUOTA_MAX
      },
      { message: LOTTERY_FORM_ERRORS.TIER_AMOUNT }
    ),
  count: z
    .number(LOTTERY_FORM_ERRORS.TIER_COUNT)
    .int(LOTTERY_FORM_ERRORS.TIER_COUNT)
    .min(1, LOTTERY_FORM_ERRORS.TIER_COUNT)
    .max(LOTTERY_LIMITS.SLOTS_MAX, LOTTERY_FORM_ERRORS.TIER_COUNT),
})

/** Builds the form schema; nowSeconds is only checked for changed end times. */
export function getLotteryActivityFormSchema(options: {
  nowSeconds: number
  originalEndTime?: number
}) {
  return z
    .object({
      period: z
        .number(LOTTERY_FORM_ERRORS.PERIOD)
        .int(LOTTERY_FORM_ERRORS.PERIOD)
        .min(1, LOTTERY_FORM_ERRORS.PERIOD)
        .optional(),
      name: z
        .string()
        .trim()
        .refine(
          (value) =>
            countCharacters(value) >= 1 &&
            countCharacters(value) <= LOTTERY_LIMITS.NAME_MAX,
          { message: LOTTERY_FORM_ERRORS.NAME }
        ),
      description: z
        .string()
        .trim()
        .refine(
          (value) => countCharacters(value) <= LOTTERY_LIMITS.DESCRIPTION_MAX,
          { message: LOTTERY_FORM_ERRORS.DESCRIPTION }
        ),
      start_time: z.date(LOTTERY_FORM_ERRORS.START_TIME),
      end_time: z.date(LOTTERY_FORM_ERRORS.END_TIME),
      enabled: z.boolean(),
      total_slots: z
        .number(LOTTERY_FORM_ERRORS.SLOTS)
        .int(LOTTERY_FORM_ERRORS.SLOTS)
        .min(1, LOTTERY_FORM_ERRORS.SLOTS)
        .max(LOTTERY_LIMITS.SLOTS_MAX, LOTTERY_FORM_ERRORS.SLOTS),
      tiers: z
        .array(tierSchema)
        .min(1, LOTTERY_FORM_ERRORS.TIERS_COUNT)
        .max(LOTTERY_LIMITS.TIERS_MAX, LOTTERY_FORM_ERRORS.TIERS_COUNT),
    })
    .superRefine((values, ctx) => {
      const start = toUnixSeconds(values.start_time)
      const end = toUnixSeconds(values.end_time)
      if (end <= start) {
        ctx.addIssue({
          code: 'custom',
          message: LOTTERY_FORM_ERRORS.END_BEFORE_START,
          path: ['end_time'],
        })
      } else if (end !== options.originalEndTime && end <= options.nowSeconds) {
        ctx.addIssue({
          code: 'custom',
          message: LOTTERY_FORM_ERRORS.END_PASSED,
          path: ['end_time'],
        })
      }
      const prizes = values.tiers.reduce((sum, tier) => sum + tier.count, 0)
      if (prizes > values.total_slots) {
        ctx.addIssue({
          code: 'custom',
          message: LOTTERY_FORM_ERRORS.PRIZES_EXCEED_SLOTS,
          path: ['total_slots'],
        })
      }
    })
}

export type LotteryActivityFormValues = z.infer<
  ReturnType<typeof getLotteryActivityFormSchema>
>

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function getDefaultLotteryFormValues(
  nowSeconds: number
): LotteryActivityFormValues {
  const startOfNextHour = (Math.floor(nowSeconds / 3600) + 1) * 3600
  return {
    period: undefined,
    name: '',
    description: '',
    start_time: new Date(startOfNextHour * 1000),
    end_time: new Date((startOfNextHour + 7 * 86400) * 1000),
    enabled: true,
    total_slots: 100,
    tiers: [{ amount: 1, count: 10 }],
  }
}

export function activityToFormValues(
  activity: LotteryActivity
): LotteryActivityFormValues {
  return {
    period: activity.period,
    name: activity.name,
    description: activity.description,
    start_time: new Date(activity.start_time * 1000),
    end_time: new Date(activity.end_time * 1000),
    enabled: activity.enabled,
    total_slots: activity.total_slots,
    tiers: activity.tiers.map((tier) => ({
      amount: quotaUnitsToEditableAmount(tier.quota),
      count: tier.count,
    })),
  }
}

/**
 * Converts form values to the request body. For a locked activity the frozen
 * fields are sent exactly as stored, so currency rounding can never trip the
 * server's "cannot be changed after the lottery starts" check. Only creation
 * may leave the round empty (0 = auto-assign); an edit keeps the stored round.
 */
export function formValuesToPayload(
  values: LotteryActivityFormValues,
  options: { editing: LotteryActivity | null; locked: boolean }
): LotteryActivityPayload {
  const locked = options.locked ? options.editing : null
  const base = {
    name: values.name.trim(),
    description: values.description.trim(),
    end_time: toUnixSeconds(values.end_time),
    enabled: values.enabled,
  }
  if (locked) {
    return {
      ...base,
      period: locked.period,
      start_time: locked.start_time,
      total_slots: locked.total_slots,
      tiers: locked.tiers.map((tier) => ({
        quota: tier.quota,
        count: tier.count,
      })),
    }
  }
  return {
    ...base,
    period: values.period ?? options.editing?.period ?? 0,
    start_time: toUnixSeconds(values.start_time),
    total_slots: values.total_slots,
    tiers: values.tiers.map((tier) => ({
      quota: parseQuotaFromDollars(tier.amount),
      count: tier.count,
    })),
  }
}

/** Live summary shown under the tier editor. */
export function summarizePrizes(
  tiers: ReadonlyArray<{ amount: number; count: number }>,
  totalSlots: number
): { prizes: number; totalQuota: number; winRatePercent: number } {
  let prizes = 0
  let totalQuota = 0
  for (const tier of tiers) {
    const count = Number.isFinite(tier.count) ? tier.count : 0
    const amount = Number.isFinite(tier.amount) ? tier.amount : 0
    prizes += count
    totalQuota += parseQuotaFromDollars(amount) * count
  }
  return {
    prizes,
    totalQuota,
    winRatePercent: getWinRatePercent(prizes, totalSlots),
  }
}
