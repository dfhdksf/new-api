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

import type { PelicanTestConfig } from '../types'
import {
  getRememberedPelicanConfig,
  pelicanStoredConfigSchema,
} from './connection-storage'

export const PELICAN_LIBRARY_STORAGE_KEY = 'new-api:pelican-test:library:v1'
export const MAX_SAVED_CONFIGURATIONS = 20
export const MAX_CONFIGURATION_FILE_BYTES = 2 * 1024 * 1024

const configurationSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  config: pelicanStoredConfigSchema.shape.config,
})
const librarySchema = z.object({
  version: z.literal(1),
  configurations: z.array(configurationSchema).max(MAX_SAVED_CONFIGURATIONS),
})
export type SavedPelicanConfiguration = z.infer<typeof configurationSchema>

export function loadPelicanLibrary(): SavedPelicanConfiguration[] {
  const raw = window.localStorage.getItem(PELICAN_LIBRARY_STORAGE_KEY)
  if (!raw) return []
  return librarySchema.parse(JSON.parse(raw)).configurations
}

export function savePelicanLibrary(items: SavedPelicanConfiguration[]): void {
  const library = librarySchema.parse({
    version: 1,
    configurations: items.map((item) => ({
      ...item,
      config: getRememberedPelicanConfig(item.config),
    })),
  })
  window.localStorage.setItem(
    PELICAN_LIBRARY_STORAGE_KEY,
    JSON.stringify(library)
  )
}

export function exportPelicanConfiguration(config: PelicanTestConfig): string {
  return JSON.stringify(
    {
      version: 1,
      config: getRememberedPelicanConfig(config),
    },
    null,
    2
  )
}

export function importPelicanConfiguration(text: string): PelicanTestConfig {
  const parsed = pelicanStoredConfigSchema.parse(JSON.parse(text)).config
  if (
    new Set(parsed.connections.map((connection) => connection.id)).size !==
    parsed.connections.length
  ) {
    throw new Error('Duplicate connection IDs')
  }
  return getRememberedPelicanConfig(parsed)
}
