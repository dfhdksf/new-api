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
import { afterEach, describe, expect, test } from 'vitest'

import {
  exportPelicanConfiguration,
  importPelicanConfiguration,
  loadPelicanLibrary,
  savePelicanLibrary,
} from '../lib/configuration-library'
import { loadPelicanConfig, savePelicanConfig } from '../lib/connection-storage'
import { exampleConfig } from './fixtures'

afterEach(() => window.localStorage.clear())

describe('reusable Pelican configurations', () => {
  test('named configurations survive draft edits and only save opted-in keys', () => {
    const remembered = structuredClone(exampleConfig)
    remembered.connections[0].credentials[0].rememberKey = true
    savePelicanLibrary([
      { id: 'one', name: 'Remembered', config: remembered },
      { id: 'two', name: 'Temporary', config: exampleConfig },
    ])
    savePelicanConfig(exampleConfig)
    const items = loadPelicanLibrary()
    expect(items[0].config.connections[0].credentials[0].apiKey).toBe(
      'secret-key'
    )
    expect(items[1].config.connections[0].credentials[0].apiKey).toBe('')
    expect(loadPelicanConfig().connections[0].credentials[0].apiKey).toBe('')
    savePelicanLibrary(items.filter((item) => item.id !== 'one'))
    expect(loadPelicanLibrary().map((item) => item.name)).toEqual(['Temporary'])
    expect(JSON.stringify(loadPelicanLibrary())).not.toContain('secret-key')
  })

  test('export and import preserve endpoints and named keys without leaking unchecked keys', () => {
    const config = structuredClone(exampleConfig)
    config.connections[0].credentials.push({
      ...config.connections[0].credentials[0],
      id: 'saved',
      name: 'Saved account',
      rememberKey: true,
      apiKey: 'remembered-secret',
    })
    const exported = exportPelicanConfiguration(config)
    expect(exported).not.toContain('secret-key')
    const restored = importPelicanConfiguration(exported)
    expect(restored.connections[0]).toMatchObject({
      baseUrl: exampleConfig.connections[0].baseUrl,
      modelsText: 'model-a',
      credentials: [
        { apiKey: '' },
        { name: 'Saved account', apiKey: 'remembered-secret' },
      ],
    })
    expect(() => importPelicanConfiguration('{broken')).toThrow()
    expect(() =>
      importPelicanConfiguration(JSON.stringify({ version: 99, config }))
    ).toThrow()
  })

  test('invalid draft edits never overwrite the last saved settings', () => {
    savePelicanConfig(exampleConfig)
    expect(() =>
      savePelicanConfig({ ...exampleConfig, count: Number.NaN })
    ).toThrow()
    expect(loadPelicanConfig().count).toBe(1)
  })
})
