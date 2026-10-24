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

import { resolvePelicanApiUrl } from '../api'
import {
  MAX_BATCH_REQUESTS,
  MAX_CONNECTIONS,
  MAX_CREDENTIALS,
  PELICAN_TEST_PROMPT,
} from '../constants'
import {
  REASONING_EFFORTS,
  type PelicanHistoryConfig,
  type PelicanHistoryEntry,
  type PelicanTestConfig,
  type PelicanTestResult,
} from '../types'
import { getCredentialName } from './batch-utils'
import {
  pelicanDraftSchema,
  pelicanCredentialSchema,
  migrateLegacyCredentials,
} from './config-schema'
import { extractSvg } from './svg-utils'

export const PELICAN_HISTORY_KEY = 'new-api:pelican-test:history:v1'
export const MAX_HISTORY_ENTRIES = 20
const MAX_HISTORY_CHARS = 1_000_000
const historyConfigSchema = pelicanDraftSchema.extend({
  connections: z
    .preprocess(
      migrateLegacyCredentials,
      pelicanDraftSchema.shape.connections.element.extend({
        transport: z.enum(['server', 'direct']).default('direct'),
        credentials: z
          .array(
            pelicanCredentialSchema.omit({ apiKey: true, rememberKey: true })
          )
          .min(1)
          .max(MAX_CREDENTIALS),
      })
    )
    .array()
    .min(1)
    .max(MAX_CONNECTIONS),
})
const historyEntrySchema = z.object({
  id: z.string().min(1).max(100),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  prompt: z.string().max(4000),
  config: historyConfigSchema,
  results: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        connectionId: z.string().max(100),
        connectionName: z.string().max(100),
        credentialId: z.string().min(1).max(100).default('legacy-key'),
        credentialName: z.string().max(100).default(''),
        baseUrl: z.string().max(2048),
        apiFormat: z.enum(['responses', 'chat-completions']),
        transport: z.enum(['server', 'direct']).default('direct'),
        model: z.string().max(32000),
        effort: z.enum(REASONING_EFFORTS),
        runNumber: z.number().int().positive(),
        status: z.enum(['pending', 'running', 'success', 'error', 'cancelled']),
        content: z.string(),
        svg: z.string().nullable(),
        firstTokenMs: z.number().nonnegative().nullable().optional(),
        durationMs: z.number().nonnegative().nullable(),
        totalTokens: z.number().nonnegative().nullable(),
        error: z.string().nullable(),
      })
    )
    .min(1)
    .max(MAX_BATCH_REQUESTS),
})

export function createHistoryEntry(
  config: PelicanTestConfig,
  results: PelicanTestResult[]
): PelicanHistoryEntry {
  return {
    id:
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    prompt: PELICAN_TEST_PROMPT,
    config: {
      efforts: [...config.efforts],
      count: config.count,
      concurrency: config.concurrency,
      connections: config.connections
        .filter((connection) => connection.enabled)
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          enabled: true,
          apiFormat: connection.apiFormat,
          transport: connection.transport,
          baseUrl: connection.baseUrl,
          modelsText: connection.modelsText,
          credentials: connection.credentials
            .filter((credential) => credential.enabled)
            .map((credential) => ({
              id: credential.id,
              name: credential.name,
              enabled: true,
            })),
        })),
    },
    results: [...results],
  }
}

export function loadPelicanHistory(): PelicanHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(PELICAN_HISTORY_KEY)
    if (!raw || raw.length > MAX_HISTORY_CHARS) return []
    const parsed = z
      .object({
        version: z.literal(1),
        entries: z.array(z.unknown()).max(MAX_HISTORY_ENTRIES),
      })
      .safeParse(JSON.parse(raw))
    if (!parsed.success) return []
    const ids = new Set<string>()
    return parsed.data.entries.flatMap((value) => {
      const entry = historyEntrySchema.safeParse(value)
      if (!entry.success || ids.has(entry.data.id)) return []
      ids.add(entry.data.id)
      return [
        {
          ...entry.data,
          results: entry.data.results.map((result) => ({
            ...result,
            credentialName:
              result.credentialName || getCredentialName({ name: '' }, 0),
            svg: result.svg ? extractSvg(result.svg) : null,
          })),
        },
      ]
    })
  } catch {
    return []
  }
}

export function savePelicanHistory(
  entries: PelicanHistoryEntry[]
): PelicanHistoryEntry[] {
  // Schema parsing strips unknown fields, including credentials, before storage.
  const saved = entries
    .slice(0, MAX_HISTORY_ENTRIES)
    .map((entry) => historyEntrySchema.parse(entry))
  let serialized = JSON.stringify({ version: 1, entries: saved })
  while (serialized.length > MAX_HISTORY_CHARS && saved.length > 1) {
    saved.pop()
    serialized = JSON.stringify({ version: 1, entries: saved })
  }
  if (serialized.length > MAX_HISTORY_CHARS) {
    throw new Error('History entry exceeds the storage limit')
  }
  while (true) {
    try {
      window.localStorage.setItem(PELICAN_HISTORY_KEY, serialized)
      return saved
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== 'QuotaExceededError' ||
        saved.length <= 1
      ) {
        throw error
      }
      saved.pop()
      serialized = JSON.stringify({ version: 1, entries: saved })
    }
  }
}

export function restoreHistoryConfig(
  saved: PelicanHistoryConfig,
  current: PelicanTestConfig
): PelicanTestConfig {
  return {
    ...saved,
    connections: saved.connections.map((connection) => {
      const match = current.connections.find((candidate) => {
        if (candidate.id !== connection.id) return false
        try {
          return (
            resolvePelicanApiUrl(candidate.baseUrl, candidate.apiFormat) ===
            resolvePelicanApiUrl(connection.baseUrl, connection.apiFormat)
          )
        } catch {
          return false
        }
      })
      return {
        ...connection,
        credentials: connection.credentials.map((credential) => {
          const currentCredential = match?.credentials.find(
            (candidate) => candidate.id === credential.id
          )
          return {
            ...credential,
            apiKey: currentCredential?.apiKey ?? '',
            rememberKey: currentCredential?.rememberKey ?? false,
          }
        }),
      }
    }),
  }
}
