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
  computeTopUpGiftOdds,
  createDefaultTopUpGiftWeights,
  nextTopUpGiftPercent,
  parseStoredTopUpGiftWeights,
  serializeTopUpGiftWeights,
  topUpGiftWeightsSchema,
} from '../lib/topup-gift'

describe('default gift weights', () => {
  test('match the server default: weight = 22 - percent, expected gift exactly 5%', () => {
    const rows = createDefaultTopUpGiftWeights()
    expect(rows.map((row) => row.percent)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    expect(rows.every((row) => row.weight === 22 - row.percent)).toBe(true)
    expect(computeTopUpGiftOdds(rows).expectedPercent).toBe(5)
  })
})

describe('topUpGiftWeightsSchema mirrors the server validator', () => {
  test.each([
    { name: 'percent 0', rows: [{ percent: 0, weight: 1 }] },
    { name: 'percent 101', rows: [{ percent: 101, weight: 1 }] },
    { name: 'zero weight', rows: [{ percent: 1, weight: 0 }] },
    {
      name: 'weight above the bound',
      rows: [{ percent: 1, weight: 1_000_001 }],
    },
    { name: 'fractional weight', rows: [{ percent: 1, weight: 1.5 }] },
    { name: 'empty table', rows: [] },
    {
      name: 'duplicate percent',
      rows: [
        { percent: 3, weight: 1 },
        { percent: 3, weight: 2 },
      ],
    },
  ])('rejects $name', ({ rows }) => {
    expect(topUpGiftWeightsSchema.safeParse(rows).success).toBe(false)
  })

  test('accepts the full percent range', () => {
    const rows = [
      { percent: 1, weight: 1 },
      { percent: 100, weight: 1_000_000 },
    ]
    expect(topUpGiftWeightsSchema.safeParse(rows).success).toBe(true)
  })
})

describe('stored option parsing', () => {
  test('an empty option means the default table is in force', () => {
    expect(parseStoredTopUpGiftWeights('')).toEqual({
      rows: createDefaultTopUpGiftWeights(),
      valid: true,
    })
  })

  test('a stored table round-trips sorted by percent', () => {
    const parsed = parseStoredTopUpGiftWeights(
      '[{"percent":9,"weight":2},{"percent":2,"weight":5}]'
    )
    expect(parsed.valid).toBe(true)
    expect(parsed.rows).toEqual([
      { percent: 2, weight: 5 },
      { percent: 9, weight: 2 },
    ])
    expect(serializeTopUpGiftWeights(parsed.rows)).toBe(
      '[{"percent":2,"weight":5},{"percent":9,"weight":2}]'
    )
  })

  test.each(['not json', '{"1":21}', '[{"percent":0,"weight":1}]'])(
    'flags an invalid stored value %s',
    (raw) => {
      expect(parseStoredTopUpGiftWeights(raw).valid).toBe(false)
    }
  )
})

describe('computeTopUpGiftOdds', () => {
  test('probabilities follow weight / total weight over valid rows only', () => {
    const odds = computeTopUpGiftOdds([
      { percent: 1, weight: 3 },
      { percent: 10, weight: 1 },
      { percent: 0, weight: 5 },
    ])
    expect(odds.probabilities).toEqual([75, 25, null])
    expect(odds.expectedPercent).toBeCloseTo(3.25)
  })

  test('no valid rows gives no expected value', () => {
    expect(computeTopUpGiftOdds([{ percent: 0, weight: 0 }])).toEqual({
      probabilities: [null],
      expectedPercent: null,
    })
  })
})

test('nextTopUpGiftPercent picks the next free percent', () => {
  expect(nextTopUpGiftPercent([{ percent: 3, weight: 1 }])).toBe(4)
  expect(nextTopUpGiftPercent([{ percent: 100, weight: 1 }])).toBe(1)
  const full = Array.from({ length: 100 }, (_, index) => ({
    percent: index + 1,
    weight: 1,
  }))
  expect(nextTopUpGiftPercent(full)).toBeNull()
})
