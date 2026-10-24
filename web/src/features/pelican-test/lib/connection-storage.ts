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
import { z } from 'zod'

import {
  createPelicanConnection,
  MAX_CONNECTIONS,
  DEFAULT_PELICAN_TEST_CONFIG,
} from '../constants'
import type { PelicanTestConfig } from '../types'
import { pelicanDraftSchema, migrateLegacyCredentials } from './config-schema'

export const PELICAN_STORAGE_KEY = 'new-api:pelican-test:connections:v1'
export const pelicanStoredConfigSchema = z.object({
  version: z.literal(1),
  config: pelicanDraftSchema.extend({
    connections: z
      .preprocess(
        migrateLegacyCredentials,
        pelicanDraftSchema.shape.connections.element.extend({
          transport: z.enum(['server', 'direct']).default('direct'),
        })
      )
      .array()
      .min(1)
      .max(MAX_CONNECTIONS),
  }),
})

export function loadPelicanConfig(): PelicanTestConfig {
  const fallback = {
    ...DEFAULT_PELICAN_TEST_CONFIG,
    connections: [createPelicanConnection()],
  }
  try {
    const saved = window.localStorage.getItem(PELICAN_STORAGE_KEY)
    if (!saved) return fallback
    const parsed = pelicanStoredConfigSchema.safeParse(JSON.parse(saved))
    if (!parsed.success) return fallback
    const ids = new Set(
      parsed.data.config.connections.map((connection) => connection.id)
    )
    if (ids.size !== parsed.data.config.connections.length) return fallback
    return {
      ...parsed.data.config,
      connections: parsed.data.config.connections.map((connection) => ({
        ...connection,
        credentials: connection.credentials.map((credential) => ({
          ...credential,
          apiKey: credential.rememberKey ? credential.apiKey : '',
        })),
      })),
    }
  } catch {
    return fallback
  }
}

export function getRememberedPelicanConfig(
  config: PelicanTestConfig
): PelicanTestConfig {
  // Persist only this allowlist. Unchecked keys never reach browser storage.
  const saved: PelicanTestConfig = {
    efforts: config.efforts,
    count: config.count,
    concurrency: config.concurrency,
    connections: config.connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      enabled: connection.enabled,
      apiFormat: connection.apiFormat,
      transport: connection.transport,
      baseUrl: connection.baseUrl,
      credentials: connection.credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        enabled: credential.enabled,
        apiKey: credential.rememberKey ? credential.apiKey : '',
        rememberKey: credential.rememberKey,
      })),
      modelsText: connection.modelsText,
    })),
  }
  return pelicanStoredConfigSchema.parse({ version: 1, config: saved }).config
}

export function savePelicanConfig(config: PelicanTestConfig): void {
  window.localStorage.setItem(
    PELICAN_STORAGE_KEY,
    JSON.stringify({ version: 1, config: getRememberedPelicanConfig(config) })
  )
}
