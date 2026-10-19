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
import i18next from 'i18next'
import { describe, expect, test } from 'vitest'

import { getPelicanTestConfigSchema } from '../lib/config-schema'
import { exampleConfig, exampleConnection } from './fixtures'

describe('Pelican Test configuration validation', () => {
  test('allows incomplete disabled connections but validates enabled ones', () => {
    const schema = getPelicanTestConfigSchema(i18next.t)
    expect(
      schema.safeParse({
        ...exampleConfig,
        connections: [
          exampleConnection,
          {
            ...exampleConnection,
            id: 'disabled',
            enabled: false,
            baseUrl: '',
            credentials: [{ ...exampleConnection.credentials[0], apiKey: '' }],
            modelsText: '',
          },
        ],
      }).success
    ).toBe(true)
    const invalid = schema.safeParse({
      ...exampleConfig,
      connections: [{ ...exampleConnection, baseUrl: 'file:///tmp/api' }],
    })
    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      expect(invalid.error.issues[0].path).toEqual([
        'connections',
        0,
        'baseUrl',
      ])
    }
  })
  test('requires an enabled connection, unique IDs, and a bounded total batch', () => {
    const schema = getPelicanTestConfigSchema(i18next.t)
    expect(
      schema.safeParse({
        ...exampleConfig,
        connections: [{ ...exampleConnection, enabled: false }],
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...exampleConfig,
        connections: [exampleConnection, exampleConnection],
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...exampleConfig,
        connections: [{ ...exampleConnection, modelsText: 'a,b,c,d,e' }],
        efforts: ['auto', 'minimal', 'low', 'medium', 'high'],
        count: 3,
      }).success
    ).toBe(false)
    expect(schema.safeParse({ ...exampleConfig, concurrency: 0 }).success).toBe(
      false
    )
    expect(schema.safeParse({ ...exampleConfig, count: 100000 }).success).toBe(
      false
    )
  })
  test('validates enabled keys independently and counts every key toward the batch limit', () => {
    const schema = getPelicanTestConfigSchema(i18next.t)
    const second = {
      ...exampleConnection.credentials[0],
      id: 'key-b',
      apiKey: '',
      enabled: false,
    }
    const config = {
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [exampleConnection.credentials[0], second],
        },
      ],
    }
    expect(schema.safeParse(config).success).toBe(true)
    second.enabled = true
    const missing = schema.safeParse(config)
    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues[0].path).toEqual([
        'connections',
        0,
        'credentials',
        1,
        'apiKey',
      ])
    }
    second.apiKey = 'key-b-secret'
    expect(schema.safeParse(config).success).toBe(true)
    second.id = 'key-a'
    expect(schema.safeParse(config).success).toBe(false)
    second.id = 'key-b'
    expect(
      schema.safeParse({
        ...config,
        count: 5,
        efforts: ['auto', 'low', 'medium', 'high'],
        connections: [{ ...config.connections[0], modelsText: 'a,b' }],
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        ...config,
        connections: [
          {
            ...exampleConnection,
            credentials: [{ ...second, enabled: false }],
          },
        ],
      }).success
    ).toBe(false)
  })
})
