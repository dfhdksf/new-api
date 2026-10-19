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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createBatchPlan } from '../lib/batch-utils'
import {
  createHistoryEntry,
  loadPelicanHistory,
  savePelicanHistory,
  restoreHistoryConfig,
} from '../lib/history-storage'
import { exampleConfig, exampleConnection } from './fixtures'

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('Pelican history persistence', () => {
  test('round trips results and settings without saving credentials, even when remember key is enabled', () => {
    const config = {
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
        },
      ],
    }
    const entry = createHistoryEntry(config, createBatchPlan(config))
    entry.results[0] = {
      ...entry.results[0],
      status: 'success',
      content: '<svg><circle r="1" /></svg>',
      svg: '<svg><circle r="1" /></svg>',
      totalTokens: 42,
      durationMs: 123,
    }
    entry.finishedAt = new Date().toISOString()
    savePelicanHistory([entry])
    const [loaded] = loadPelicanHistory()
    expect(loaded.results[0]).toMatchObject({
      status: 'success',
      totalTokens: 42,
      durationMs: 123,
    })
    expect(loaded.config.connections[0]).not.toHaveProperty('apiKey')
    expect(loaded.config.connections[0]).not.toHaveProperty('rememberKey')
    expect(JSON.stringify(window.localStorage)).not.toContain('secret-key')
  })

  test('retains mixed request methods when saving and rerunning and accepts legacy history', () => {
    const config = {
      ...exampleConfig,
      connections: [
        { ...exampleConnection, transport: 'server' as const },
        { ...exampleConnection, id: 'second', transport: 'direct' as const },
      ],
    }
    const entry = createHistoryEntry(config, createBatchPlan(config))
    savePelicanHistory([entry])
    const [loaded] = loadPelicanHistory()
    expect(loaded.results.map((result) => result.transport)).toEqual([
      'server',
      'direct',
    ])
    expect(
      restoreHistoryConfig(loaded.config, config).connections.map(
        (connection) => connection.transport
      )
    ).toEqual(['server', 'direct'])
    const key = 'new-api:pelican-test:history:v1'
    const legacy = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    for (const item of legacy.entries) {
      for (const connection of item.config.connections) {
        delete connection.transport
      }
      for (const result of item.results) delete result.transport
    }
    window.localStorage.setItem(key, JSON.stringify(legacy))
    expect(loadPelicanHistory()[0].results[0].transport).toBe('direct')
  })
  test('keeps recent batches, removes deleted entries, and sanitizes stored SVG when reading', () => {
    const entries = Array.from({ length: 21 }, () =>
      createHistoryEntry(exampleConfig, createBatchPlan(exampleConfig))
    )
    entries[0].results[0].svg =
      '<svg><script>alert(1)</script><circle r="1" /></svg>'
    const saved = savePelicanHistory(entries)
    expect(saved).toHaveLength(20)
    expect(loadPelicanHistory()[0].results[0].svg).not.toContain('<script>')
    savePelicanHistory(saved.filter((entry) => entry.id !== saved[0].id))
    expect(loadPelicanHistory().some((entry) => entry.id === saved[0].id)).toBe(
      false
    )
  })

  test('ignores corrupt history and reports write failures rather than silently losing records', () => {
    window.localStorage.setItem('new-api:pelican-test:history:v1', '{broken')
    expect(loadPelicanHistory()).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() =>
      savePelicanHistory([
        createHistoryEntry(exampleConfig, createBatchPlan(exampleConfig)),
      ])
    ).toThrow()
  })

  test('reuses current credentials only for the same connection and endpoint when restoring a batch', () => {
    const entry = createHistoryEntry(
      exampleConfig,
      createBatchPlan(exampleConfig)
    )
    expect(
      restoreHistoryConfig(entry.config, exampleConfig).connections[0]
        .credentials[0].apiKey
    ).toBe('secret-key')
    const changed = {
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          baseUrl: 'https://other.example.com/v1',
          credentials: [
            { ...exampleConnection.credentials[0], apiKey: 'other-secret' },
          ],
        },
      ],
    }
    expect(
      restoreHistoryConfig(entry.config, changed).connections[0].credentials[0]
        .apiKey
    ).toBe('')
    expect(
      restoreHistoryConfig(entry.config, changed).connections[0].baseUrl
    ).toBe(exampleConnection.baseUrl)
  })
  test('evicts older batches on quota pressure but preserves the newest result', () => {
    const latest = createHistoryEntry(
      exampleConfig,
      createBatchPlan(exampleConfig)
    )
    const older = createHistoryEntry(
      exampleConfig,
      createBatchPlan(exampleConfig)
    )
    const realSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(
      function (this: Storage, key, value) {
        const data = JSON.parse(value) as { entries: unknown[] }
        if (data.entries.length > 1) {
          throw new DOMException('full', 'QuotaExceededError')
        }
        realSetItem.call(this, key, value)
      }
    )
    expect(
      savePelicanHistory([latest, older]).map((entry) => entry.id)
    ).toEqual([latest.id])
    expect(loadPelicanHistory()[0].id).toBe(latest.id)
  })
  test('keeps key identities in history and restores secrets by ID after reordering', () => {
    const keyA = exampleConnection.credentials[0]
    const keyB = {
      ...keyA,
      id: 'key-b',
      name: 'Account B',
      apiKey: 'second-secret',
    }
    const config = {
      ...exampleConfig,
      connections: [{ ...exampleConnection, credentials: [keyA, keyB] }],
    }
    const entry = createHistoryEntry(config, createBatchPlan(config))
    savePelicanHistory([entry])
    const [loaded] = loadPelicanHistory()
    expect(loaded.results.map((result) => result.credentialName)).toEqual([
      'Account A',
      'Account B',
    ])
    expect(JSON.stringify(loaded)).not.toContain('secret')
    const reordered = {
      ...config,
      connections: [
        {
          ...config.connections[0],
          credentials: [
            { ...keyB, apiKey: 'updated-b' },
            { ...keyA, apiKey: 'updated-a' },
          ],
        },
      ],
    }
    expect(
      restoreHistoryConfig(
        loaded.config,
        reordered
      ).connections[0].credentials.map((key) => key.apiKey)
    ).toEqual(['updated-a', 'updated-b'])
    reordered.connections[0].credentials.pop()
    expect(
      restoreHistoryConfig(
        loaded.config,
        reordered
      ).connections[0].credentials.map((key) => key.apiKey)
    ).toEqual(['', 'updated-b'])
  })

  test('loads legacy single-key history with a stable key identity for reruns', () => {
    const entry = createHistoryEntry(
      exampleConfig,
      createBatchPlan(exampleConfig)
    )
    const legacy = structuredClone(entry)
    Reflect.deleteProperty(legacy.config.connections[0], 'credentials')
    Reflect.deleteProperty(legacy.results[0], 'credentialId')
    Reflect.deleteProperty(legacy.results[0], 'credentialName')
    window.localStorage.setItem(
      'new-api:pelican-test:history:v1',
      JSON.stringify({ version: 1, entries: [legacy] })
    )
    const [loaded] = loadPelicanHistory()
    expect(loaded.config.connections[0].credentials).toEqual([
      { id: 'legacy-key', name: '', enabled: true },
    ])
    expect(loaded.results[0]).toMatchObject({
      credentialId: 'legacy-key',
      credentialName: 'Key 1',
    })
    const current = {
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], id: 'legacy-key' },
          ],
        },
      ],
    }
    expect(
      restoreHistoryConfig(loaded.config, current).connections[0].credentials[0]
        .apiKey
    ).toBe('secret-key')
  })
})
