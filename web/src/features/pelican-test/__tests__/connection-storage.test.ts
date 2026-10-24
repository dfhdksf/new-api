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
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  loadPelicanConfig,
  PELICAN_STORAGE_KEY,
  savePelicanConfig,
} from '../lib/connection-storage'
import { exampleConfig, exampleConnection } from './fixtures'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('Pelican connection storage', () => {
  test('remembers endpoints and model choices without storing unchecked API keys', () => {
    savePelicanConfig(exampleConfig)
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
    expect(loadPelicanConfig()).toMatchObject({
      connections: [
        {
          baseUrl: exampleConnection.baseUrl,
          modelsText: 'model-a',
          credentials: [expect.objectContaining({ apiKey: '' })],
        },
      ],
    })
  })
  test('stores opted-in keys and removes them after opting out or deleting a connection', () => {
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
        },
      ],
    })
    expect(loadPelicanConfig().connections[0].credentials[0].apiKey).toBe(
      'secret-key'
    )
    savePelicanConfig(exampleConfig)
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          id: 'b',
          credentials: [
            {
              ...exampleConnection.credentials[0],
              apiKey: 'other-key',
              rememberKey: true,
            },
          ],
        },
      ],
    })
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
  })
  test('defaults new profiles to server and preserves transport for saved and legacy profiles', () => {
    expect(loadPelicanConfig().connections[0].transport).toBe('server')
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          transport: 'server',
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
        },
      ],
    })
    expect(loadPelicanConfig().connections[0]).toMatchObject({
      transport: 'server',
      credentials: [expect.objectContaining({ apiKey: 'secret-key' })],
    })
    const legacy = JSON.parse(
      window.localStorage.getItem(PELICAN_STORAGE_KEY) ?? '{}'
    )
    delete legacy.config.connections[0].transport
    window.localStorage.setItem(PELICAN_STORAGE_KEY, JSON.stringify(legacy))
    expect(loadPelicanConfig().connections[0]).toMatchObject({
      transport: 'direct',
      credentials: [expect.objectContaining({ apiKey: 'secret-key' })],
    })
  })
  test('recovers from corrupt or incompatible data and unavailable browser storage', () => {
    window.localStorage.setItem(PELICAN_STORAGE_KEY, '{broken')
    expect(loadPelicanConfig().connections).toHaveLength(1)
    window.localStorage.setItem(
      PELICAN_STORAGE_KEY,
      JSON.stringify({ version: 99, config: exampleConfig })
    )
    expect(loadPelicanConfig().connections[0].credentials[0].apiKey).toBe('')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadPelicanConfig().connections[0].baseUrl).toBe('')
  })
  test('migrates a single-key profile and independently remembers named keys', () => {
    const { credentials, ...legacyConnection } = exampleConnection
    window.localStorage.setItem(
      PELICAN_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        config: {
          ...exampleConfig,
          connections: [
            { ...legacyConnection, apiKey: 'legacy-secret', rememberKey: true },
          ],
        },
      })
    )
    const migrated = loadPelicanConfig()
    expect(migrated.connections[0].credentials).toEqual([
      {
        id: 'legacy-key',
        name: '',
        enabled: true,
        apiKey: 'legacy-secret',
        rememberKey: true,
      },
    ])
    const config = {
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...credentials[0], rememberKey: true },
            {
              ...credentials[0],
              id: 'key-b',
              name: 'Account B',
              apiKey: 'temporary-secret',
              rememberKey: false,
            },
          ],
        },
      ],
    }
    savePelicanConfig(config)
    expect(loadPelicanConfig().connections[0].credentials).toEqual([
      config.connections[0].credentials[0],
      { ...config.connections[0].credentials[1], apiKey: '' },
    ])
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'temporary-secret'
    )
    config.connections[0].credentials.shift()
    savePelicanConfig(config)
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
    expect(loadPelicanConfig().connections[0].credentials[0].name).toBe(
      'Account B'
    )
  })
})
