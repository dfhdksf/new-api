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
import { describe, expect, test } from 'vitest'

import {
  getLotteryAction,
  getLotteryPhase,
  getWinRatePercent,
  splitCountdown,
} from '../lib/lottery-state'
import type { UserLotteryActivity } from '../types'

const START = 1_000_000
const END = START + 3600

function activity(
  overrides: Partial<UserLotteryActivity> = {}
): UserLotteryActivity {
  return {
    id: 1,
    period: 3,
    name: 'round',
    description: '',
    start_time: START,
    end_time: END,
    total_slots: 100,
    prize_slots: 10,
    remaining_slots: 50,
    state: 'ongoing',
    prizes: [{ id: 1, quota: 500_000, count: 10 }],
    my_draw: null,
    ...overrides,
  }
}

describe('getLotteryAction', () => {
  test.each([
    {
      name: 'before start shows a countdown to the start time',
      input: activity({ state: 'upcoming' }),
      now: START - 90,
      expected: { kind: 'upcoming', secondsLeft: 90 },
    },
    {
      name: 'an upcoming round opens on the client clock without a refetch',
      input: activity({ state: 'upcoming' }),
      now: START,
      expected: { kind: 'draw' },
    },
    {
      name: 'no remaining slots means sold out',
      input: activity({ state: 'sold_out', remaining_slots: 0 }),
      now: START + 10,
      expected: { kind: 'sold_out' },
    },
    {
      name: 'sold out wins over the end time',
      input: activity({ state: 'sold_out', remaining_slots: 0 }),
      now: END + 10,
      expected: { kind: 'sold_out' },
    },
    {
      name: 'the end time closes the round on the client clock',
      input: activity(),
      now: END,
      expected: { kind: 'ended' },
    },
    {
      name: 'an open round can be drawn',
      input: activity(),
      now: START + 10,
      expected: { kind: 'draw' },
    },
  ])('$name', ({ input, now, expected }) => {
    expect(getLotteryAction(input, now)).toEqual(expected)
  })

  test('the user own result always takes precedence over the round state', () => {
    const won = activity({
      state: 'sold_out',
      remaining_slots: 0,
      my_draw: {
        won: true,
        quota: 250_000,
        code: 'abc',
        code_status: 'unused',
        created_time: START,
      },
    })
    expect(getLotteryAction(won, END + 10)).toEqual({
      kind: 'won',
      quota: 250_000,
      code: 'abc',
    })

    const lost = activity({
      my_draw: { won: false, quota: 0, created_time: START },
    })
    expect(getLotteryAction(lost, START + 10)).toEqual({ kind: 'lost' })
  })
})

describe('getLotteryPhase', () => {
  test('matches the server order: upcoming, then sold out, then ended', () => {
    expect(getLotteryPhase(activity({ remaining_slots: 0 }), START - 1)).toBe(
      'upcoming'
    )
    expect(getLotteryPhase(activity({ remaining_slots: 0 }), END + 1)).toBe(
      'sold_out'
    )
    expect(getLotteryPhase(activity(), END + 1)).toBe('ended')
    expect(getLotteryPhase(activity(), START + 1)).toBe('ongoing')
  })
})

describe('getWinRatePercent', () => {
  test.each([
    { prizes: 10, slots: 100, expected: 10 },
    { prizes: 1, slots: 3, expected: 33.3 },
    { prizes: 2, slots: 3, expected: 66.7 },
    { prizes: 5, slots: 5, expected: 100 },
    { prizes: 0, slots: 0, expected: 0 },
    { prizes: 2, slots: Number.NaN, expected: 0 },
    { prizes: 10, slots: 10000, expected: 0.1 },
    { prizes: 5, slots: 10000, expected: 0.05 },
    { prizes: 3, slots: 10000, expected: 0.03 },
    { prizes: 1, slots: 100000, expected: 0.001 },
    { prizes: 1, slots: 1000000, expected: 0.0001 },
  ])('$prizes of $slots slots', ({ prizes, slots, expected }) => {
    expect(getWinRatePercent(prizes, slots)).toBe(expected)
  })
})

describe('splitCountdown', () => {
  test.each([
    { seconds: 0, expected: { days: 0, clock: '00:00:00' } },
    { seconds: 59, expected: { days: 0, clock: '00:00:59' } },
    { seconds: 3661, expected: { days: 0, clock: '01:01:01' } },
    { seconds: 90061, expected: { days: 1, clock: '01:01:01' } },
    { seconds: -5, expected: { days: 0, clock: '00:00:00' } },
  ])('$seconds seconds', ({ seconds, expected }) => {
    expect(splitCountdown(seconds)).toEqual(expected)
  })
})
