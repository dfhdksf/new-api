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
import type {
  PelicanCredential,
  PelicanConnection,
  PelicanTestConfig,
} from './types'

export const PELICAN_TEST_PROMPT =
  'Generate an SVG of a pelican riding a bicycle.'
export const PELICAN_TEST_SYSTEM_PROMPT =
  'Respond only with a complete, self-contained SVG document. Do not include Markdown fences or commentary.'

export const MAX_BATCH_REQUESTS = 64
export const MAX_CONNECTIONS = 8
export const MAX_CREDENTIALS = 16
export const MAX_CONCURRENCY = 4
export const MAX_REPEAT_COUNT = 5

export function createPelicanCredential(): PelicanCredential {
  return {
    id:
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `key-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    enabled: true,
    apiKey: '',
    rememberKey: false,
  }
}

export function createPelicanConnection(): PelicanConnection {
  return {
    id:
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    enabled: true,
    apiFormat: 'responses',
    transport: 'server',
    baseUrl: '',
    credentials: [createPelicanCredential()],
    modelsText: '',
  }
}

export const DEFAULT_PELICAN_TEST_CONFIG: PelicanTestConfig = {
  connections: [],
  efforts: ['auto'],
  count: 1,
  concurrency: 2,
}
