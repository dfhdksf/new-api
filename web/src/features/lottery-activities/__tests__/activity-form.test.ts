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
import { beforeEach, describe, expect, test } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  LOTTERY_FORM_ERRORS,
  activityToFormValues,
  countCharacters,
  formValuesToPayload,
  getAdminActivityState,
  getLotteryActivityFormSchema,
  isActivityLocked,
  summarizePrizes,
  type LotteryActivityFormValues,
} from '../lib/activity-form'
import type { LotteryActivity } from '../types'

const NOW = 2_000_000_000

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      displayInCurrency: true,
      quotaDisplayType: 'USD',
      quotaPerUnit: 500000,
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    },
  })
})

function activity(overrides: Partial<LotteryActivity> = {}): LotteryActivity {
  return {
    id: 7,
    period: 4,
    name: 'stored',
    description: '',
    start_time: NOW - 600,
    end_time: NOW + 3600,
    enabled: true,
    total_slots: 10,
    prize_slots: 3,
    remaining_slots: 10,
    remaining_prizes: 3,
    created_time: NOW - 1000,
    updated_time: NOW - 1000,
    tiers: [
      { id: 1, activity_id: 7, quota: 1_000_001, count: 1, remaining: 1 },
      { id: 2, activity_id: 7, quota: 50_000, count: 2, remaining: 2 },
    ],
    ...overrides,
  }
}

function formValues(
  overrides: Partial<LotteryActivityFormValues> = {}
): LotteryActivityFormValues {
  return {
    period: undefined,
    name: 'Weekend',
    description: '',
    start_time: new Date((NOW + 60) * 1000),
    end_time: new Date((NOW + 7200) * 1000),
    enabled: true,
    total_slots: 10,
    tiers: [{ amount: 1, count: 2 }],
    ...overrides,
  }
}

function errorsFor(
  values: LotteryActivityFormValues,
  originalEndTime?: number
) {
  const result = getLotteryActivityFormSchema({
    nowSeconds: NOW,
    originalEndTime,
  }).safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('lottery activity form validation', () => {
  test('accepts a valid round', () => {
    expect(errorsFor(formValues())).toEqual([])
  })

  test.each([
    {
      name: 'more prizes than slots',
      values: formValues({ total_slots: 1, tiers: [{ amount: 1, count: 2 }] }),
      error: LOTTERY_FORM_ERRORS.PRIZES_EXCEED_SLOTS,
    },
    {
      name: 'end before start',
      values: formValues({ end_time: new Date((NOW + 30) * 1000) }),
      error: LOTTERY_FORM_ERRORS.END_BEFORE_START,
    },
    {
      name: 'end in the past',
      values: formValues({
        start_time: new Date((NOW - 7200) * 1000),
        end_time: new Date((NOW - 60) * 1000),
      }),
      error: LOTTERY_FORM_ERRORS.END_PASSED,
    },
    {
      name: 'blank name',
      values: formValues({ name: '   ' }),
      error: LOTTERY_FORM_ERRORS.NAME,
    },
    {
      name: 'prize amount that rounds to zero quota',
      values: formValues({ tiers: [{ amount: 0.0000001, count: 1 }] }),
      error: LOTTERY_FORM_ERRORS.TIER_AMOUNT,
    },
    {
      name: 'fractional prize count',
      values: formValues({ tiers: [{ amount: 1, count: 1.5 }] }),
      error: LOTTERY_FORM_ERRORS.TIER_COUNT,
    },
    {
      name: 'no prize tiers',
      values: formValues({ tiers: [] }),
      error: LOTTERY_FORM_ERRORS.TIERS_COUNT,
    },
  ])('rejects $name', ({ values, error }) => {
    expect(errorsFor(values)).toContain(error)
  })

  test('an unchanged past end time does not block saving other edits', () => {
    const ended = activity({ end_time: NOW - 60, start_time: NOW - 7200 })
    expect(errorsFor(activityToFormValues(ended), ended.end_time)).toEqual([])
  })

  test('counts code points like the server', () => {
    expect(countCharacters('抽奖😀')).toBe(3)
    expect(errorsFor(formValues({ name: '😀'.repeat(64) }))).toEqual([])
    expect(errorsFor(formValues({ name: '😀'.repeat(65) }))).toContain(
      LOTTERY_FORM_ERRORS.NAME
    )
  })
})

describe('formValuesToPayload', () => {
  test('a new round converts display amounts to quota and auto-assigns the round', () => {
    const payload = formValuesToPayload(
      formValues({ tiers: [{ amount: 2.5, count: 3 }] }),
      { editing: null, locked: false }
    )
    expect(payload.period).toBe(0)
    expect(payload.tiers).toEqual([{ quota: 1_250_000, count: 3 }])
    expect(payload.start_time).toBe(NOW + 60)
  })

  test('a locked round sends the stored frozen fields untouched', () => {
    const stored = activity()
    const edited = {
      ...activityToFormValues(stored),
      name: '  renamed  ',
      total_slots: 999,
      tiers: [{ amount: 9, count: 9 }],
      start_time: new Date((NOW + 999) * 1000),
    }
    const payload = formValuesToPayload(edited, {
      editing: stored,
      locked: true,
    })
    expect(payload.name).toBe('renamed')
    expect(payload.period).toBe(stored.period)
    expect(payload.start_time).toBe(stored.start_time)
    expect(payload.total_slots).toBe(stored.total_slots)
    expect(payload.tiers).toEqual([
      { quota: 1_000_001, count: 1 },
      { quota: 50_000, count: 2 },
    ])
  })
})

test('editing an unlocked round with the round field cleared keeps the stored round', () => {
  const stored = activity({ start_time: NOW + 600 })
  const payload = formValuesToPayload(
    { ...activityToFormValues(stored), period: undefined },
    { editing: stored, locked: false }
  )
  expect(payload.period).toBe(stored.period)
})

describe('activity state and locking', () => {
  test('a round locks once it starts or once anyone has drawn', () => {
    expect(isActivityLocked(activity({ start_time: NOW + 60 }), NOW)).toBe(
      false
    )
    expect(isActivityLocked(activity({ start_time: NOW }), NOW)).toBe(true)
    expect(
      isActivityLocked(
        activity({ start_time: NOW + 60, remaining_slots: 9 }),
        NOW
      )
    ).toBe(true)
  })

  test.each([
    {
      name: 'disabled',
      input: activity({ enabled: false }),
      expected: 'disabled',
    },
    {
      name: 'upcoming',
      input: activity({ start_time: NOW + 1 }),
      expected: 'upcoming',
    },
    {
      name: 'sold out',
      input: activity({ remaining_slots: 0 }),
      expected: 'sold_out',
    },
    { name: 'ended', input: activity({ end_time: NOW }), expected: 'ended' },
    { name: 'ongoing', input: activity(), expected: 'ongoing' },
  ])('$name', ({ input, expected }) => {
    expect(getAdminActivityState(input, NOW)).toBe(expected)
  })
})

test('summarizePrizes reports total prizes, win rate and prize value', () => {
  expect(
    summarizePrizes(
      [
        { amount: 5, count: 2 },
        { amount: 1, count: 10 },
      ],
      100
    )
  ).toEqual({ prizes: 12, totalQuota: 10_000_000, winRatePercent: 12 })
  expect(summarizePrizes([{ amount: Number.NaN, count: 1 }], 0)).toEqual({
    prizes: 1,
    totalQuota: 0,
    winRatePercent: 0,
  })
})
