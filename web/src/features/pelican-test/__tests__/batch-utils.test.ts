/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version).

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import { createBatchPlan, getBatchSize, parseModels } from '../lib/batch-utils'
import { exampleConfig, exampleConnection } from './fixtures'

describe('Pelican test batch planning', () => {
  test('deduplicates model IDs within each endpoint', () => {
    expect(parseModels('model-a, model-b\nmodel-a')).toEqual([
      'model-a',
      'model-b',
    ])
  })
  test('compares the same model across endpoints and excludes disabled connections', () => {
    const config = {
      ...exampleConfig,
      efforts: ['auto', 'high'] as const,
      count: 2,
      connections: [
        { ...exampleConnection, modelsText: 'model-a,model-b' },
        {
          ...exampleConnection,
          id: 'b',
          name: 'Provider B',
          credentials: [
            { ...exampleConnection.credentials[0], apiKey: 'other-secret' },
          ],
          baseUrl: 'https://b.example.com/v1',
        },
        { ...exampleConnection, id: 'disabled', enabled: false },
      ],
    }
    const plan = createBatchPlan({ ...config, efforts: [...config.efforts] })
    expect(getBatchSize({ ...config, efforts: [...config.efforts] })).toBe(12)
    expect(plan).toHaveLength(12)
    expect(plan.slice(0, 2)).toMatchObject([
      {
        model: 'model-a',
        effort: 'auto',
        runNumber: 1,
        connectionId: 'provider-a',
      },
      { model: 'model-a', effort: 'auto', runNumber: 1, connectionId: 'b' },
    ])
    expect(new Set(plan.map((result) => result.id)).size).toBe(12)
    expect(plan.some((result) => result.connectionId === 'disabled')).toBe(
      false
    )
    expect(JSON.stringify(plan)).not.toContain('secret')
  })
  test('expands shared models and strengths across enabled named keys without leaking secrets', () => {
    const config = {
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          modelsText: 'a,b',
          credentials: [
            exampleConnection.credentials[0],
            {
              ...exampleConnection.credentials[0],
              id: 'key-b',
              name: 'Account B',
              apiKey: 'second-secret',
            },
            {
              ...exampleConnection.credentials[0],
              id: 'excluded',
              enabled: false,
              apiKey: '',
            },
          ],
        },
      ],
      efforts: ['auto', 'high'] as typeof exampleConfig.efforts,
      count: 2,
    }
    const plan = createBatchPlan(config)
    expect(getBatchSize(config)).toBe(16)
    expect(plan).toHaveLength(16)
    expect(
      plan.filter((result) => result.credentialId === 'key-a')
    ).toHaveLength(8)
    expect(
      plan.filter((result) => result.credentialId === 'key-b')
    ).toHaveLength(8)
    expect(new Set(plan.map((result) => result.credentialName))).toEqual(
      new Set(['Account A', 'Account B'])
    )
    expect(JSON.stringify(plan)).not.toContain('secret')
  })
})
