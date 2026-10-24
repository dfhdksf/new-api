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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { resolvePelicanApiUrl } from '../api'
import {
  MAX_BATCH_REQUESTS,
  MAX_CONNECTIONS,
  MAX_CREDENTIALS,
  MAX_CONCURRENCY,
  MAX_REPEAT_COUNT,
} from '../constants'
import { REASONING_EFFORTS } from '../types'
import { getBatchSize, parseModels } from './batch-utils'

export const pelicanCredentialSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(100),
  enabled: z.boolean(),
  apiKey: z.string().max(8192),
  rememberKey: z.boolean(),
})

// Drafts may be incomplete. Validation for running a batch is added below.
export const pelicanDraftSchema = z.object({
  connections: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().max(100),
        enabled: z.boolean(),
        apiFormat: z.enum(['responses', 'chat-completions']),
        transport: z.enum(['server', 'direct']),
        baseUrl: z.string().max(2048),
        credentials: z
          .array(pelicanCredentialSchema)
          .min(1)
          .max(MAX_CREDENTIALS),
        modelsText: z.string().max(32000),
      })
    )
    .min(1)
    .max(MAX_CONNECTIONS),
  efforts: z.array(z.enum(REASONING_EFFORTS)).max(REASONING_EFFORTS.length),
  count: z.number().int().min(1).max(MAX_REPEAT_COUNT),
  concurrency: z.number().int().min(1).max(MAX_CONCURRENCY),
})

// Both saved settings and history used one key per connection before named keys.
export function migrateLegacyCredentials(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const connection = value as Record<string, unknown>
  if (connection.credentials !== undefined) return connection
  return {
    ...connection,
    credentials: [
      {
        id: 'legacy-key',
        name: '',
        enabled: true,
        apiKey: connection.apiKey ?? '',
        rememberKey: connection.rememberKey ?? false,
      },
    ],
  }
}

export function getPelicanTestConfigSchema(t: TFunction) {
  const countMessage = t('Count must be between {{min}} and {{max}}', {
    min: 1,
    max: MAX_REPEAT_COUNT,
  })
  const concurrencyMessage = t(
    'Concurrency must be between {{min}} and {{max}}.',
    { min: 1, max: MAX_CONCURRENCY }
  )
  return pelicanDraftSchema
    .extend({
      count: z
        .number({ error: countMessage })
        .int(countMessage)
        .min(1, countMessage)
        .max(MAX_REPEAT_COUNT, countMessage),
      concurrency: z
        .number({ error: concurrencyMessage })
        .int(concurrencyMessage)
        .min(1, concurrencyMessage)
        .max(MAX_CONCURRENCY, concurrencyMessage),
    })
    .superRefine((config, context) => {
      if (!config.connections.some((connection) => connection.enabled)) {
        context.addIssue({
          code: 'custom',
          path: ['root'],
          message: t('Enable at least one connection.'),
        })
      }
      const ids = new Set<string>()
      config.connections.forEach((connection, index) => {
        if (ids.has(connection.id)) {
          context.addIssue({
            code: 'custom',
            path: ['root'],
            message: t('Connection IDs must be unique.'),
          })
        }
        ids.add(connection.id)
        if (!connection.enabled) return
        if (!connection.baseUrl.trim()) {
          context.addIssue({
            code: 'custom',
            path: ['connections', index, 'baseUrl'],
            message: t('Enter a Base URL.'),
          })
        } else {
          try {
            resolvePelicanApiUrl(connection.baseUrl, connection.apiFormat)
          } catch {
            context.addIssue({
              code: 'custom',
              path: ['connections', index, 'baseUrl'],
              message: t('Enter a valid HTTP(S) Base URL.'),
            })
          }
        }
        if (!connection.credentials.some((credential) => credential.enabled)) {
          context.addIssue({
            code: 'custom',
            path: ['connections', index, 'credentials', 'root'],
            message: t('Enable at least one API key.'),
          })
        }
        const credentialIds = new Set<string>()
        connection.credentials.forEach((credential, keyIndex) => {
          if (credentialIds.has(credential.id)) {
            context.addIssue({
              code: 'custom',
              path: ['root'],
              message: t('API key IDs must be unique within a connection.'),
            })
          }
          credentialIds.add(credential.id)
          if (credential.enabled && !credential.apiKey.trim()) {
            context.addIssue({
              code: 'custom',
              path: ['connections', index, 'credentials', keyIndex, 'apiKey'],
              message: t('Enter an API key.'),
            })
          }
        })
        if (parseModels(connection.modelsText).length === 0) {
          context.addIssue({
            code: 'custom',
            path: ['connections', index, 'modelsText'],
            message: t('Enter at least one model ID.'),
          })
        }
      })
      if (config.efforts.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['efforts'],
          message: t('Select at least one reasoning strength.'),
        })
      }
      if (getBatchSize(config) > MAX_BATCH_REQUESTS) {
        context.addIssue({
          code: 'custom',
          path: ['root'],
          message: t('The batch cannot exceed {{count}} requests.', {
            count: MAX_BATCH_REQUESTS,
          }),
        })
      }
    })
}
