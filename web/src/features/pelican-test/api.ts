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
import { isAxiosError } from 'axios'
import i18next from 'i18next'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PELICAN_TEST_PROMPT, PELICAN_TEST_SYSTEM_PROMPT } from './constants'
import {
  isRecord,
  readResponsesContent,
  readCompletionContent,
  readTotalTokens,
  getPelicanProxyError,
} from './lib/response-utils'
import { consumePelicanStream } from './lib/stream-response'
import type {
  PelicanApiFormat,
  PelicanTestRequest,
  PelicanTestResponse,
  PelicanStreamProgress,
} from './types'

export function resolvePelicanApiUrl(
  baseUrl: string,
  apiFormat: PelicanApiFormat
): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Base URL must use HTTP or HTTPS.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Base URL must not contain embedded credentials.')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Base URL must not include query parameters or fragments.')
  }

  const endpoint =
    apiFormat === 'responses' ? '/responses' : '/chat/completions'
  const path = parsed.pathname.replace(
    /\/(?:responses|chat\/completions)$/i,
    ''
  )
  const suppliedEndpoint = /\/(?:responses|chat\/completions)$/i.test(
    parsed.pathname
  )
  parsed.pathname =
    suppliedEndpoint || /\/v1$/i.test(path)
      ? `${path}${endpoint}`
      : `${path.replace(/\/$/, '')}/v1${endpoint}`
  return parsed.toString()
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  if (!body) {
    return i18next.t('Request failed with HTTP {{status}}.', {
      status: response.status,
    })
  }

  try {
    const parsed: unknown = JSON.parse(body)
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = parsed.error.message
      if (typeof message === 'string' && message.trim()) return message.trim()
    }
  } catch {
    // Use the plain response body if this is not a JSON error response.
  }

  return body.slice(0, 1200)
}

async function requestPelicanApi(
  url: string,
  apiKey: string,
  signal: AbortSignal,
  body?: Record<string, unknown>
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body
        ? {
            'Content-Type': 'application/json',
            ...(body.stream === true ? { Accept: 'text/event-stream' } : {}),
            Authorization: `Bearer ${apiKey.trim()}`,
          }
        : { Authorization: `Bearer ${apiKey.trim()}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: 'omit',
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(
      i18next.t(
        'Could not reach the API. Check the Base URL and CORS settings on the API server.'
      )
    )
  }
  if (!response.ok) throw new Error(await readErrorMessage(response))
  if (body?.stream === true) return response
  try {
    return await response.json()
  } catch {
    throw new Error(i18next.t('The API returned an invalid JSON response.'))
  }
}

async function requestPelicanProxy(
  endpoint: 'models' | 'run',
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!useAuthStore.getState().auth.user) {
    throw new Error(i18next.t('Sign in to use the Pelican test server proxy.'))
  }
  try {
    const response = await api.post<unknown>(
      `/api/pelican-test/${endpoint}`,
      body,
      {
        signal,
        timeout: endpoint === 'run' ? 310000 : 30000,
        ...(endpoint === 'run'
          ? {
              adapter: 'fetch' as const,
              responseType: 'stream' as const,
              headers: { Accept: 'text/event-stream' },
            }
          : {}),
        skipBusinessError: true,
        skipErrorHandler: true,
      }
    )
    if (endpoint === 'run' && response.data instanceof ReadableStream) {
      return new Response(response.data, {
        headers: {
          'Content-Type': String(response.headers['content-type'] ?? ''),
        },
      })
    }
    return response.data
  } catch (error) {
    if (signal.aborted) throw error
    if (isAxiosError(error)) {
      let data: unknown = error.response?.data
      if (data instanceof ReadableStream) {
        data = await new Response(data).json().catch(() => null)
      }
      if (error.response?.status === 401) {
        throw new Error(
          i18next.t('Sign in to use the Pelican test server proxy.')
        )
      }
      if (error.response?.status === 429) {
        throw new Error(
          i18next.t('The proxy is busy or rate limited. Try again later.')
        )
      }
      if (isRecord(data) && isRecord(data.error)) {
        const failure = data.error
        throw getPelicanProxyError(failure)
      }
      if (error.code === 'ECONNABORTED' || !error.response) {
        throw new Error(
          i18next.t(
            'The proxy connection was interrupted. The upstream request may have started; check before retrying.'
          )
        )
      }
    }
    throw new Error(
      i18next.t(
        'The Pelican test proxy is unavailable. Start or update the backend and try again.'
      )
    )
  }
}

export async function fetchPelicanModels(
  connection: Pick<
    PelicanTestRequest,
    'baseUrl' | 'apiKey' | 'apiFormat' | 'transport'
  >,
  signal: AbortSignal
): Promise<string[]> {
  const url = new URL(
    resolvePelicanApiUrl(connection.baseUrl, connection.apiFormat)
  )
  url.pathname = url.pathname.replace(
    /(?:responses|chat\/completions)$/,
    'models'
  )
  const payload =
    connection.transport === 'server'
      ? await requestPelicanProxy(
          'models',
          { models_url: url.toString(), api_key: connection.apiKey.trim() },
          signal
        )
      : await requestPelicanApi(url.toString(), connection.apiKey, signal)
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error(
      i18next.t('The API response does not contain a model list.')
    )
  }
  const models: string[] = []
  for (const item of payload.data) {
    if (isRecord(item) && typeof item.id === 'string' && item.id.trim()) {
      models.push(item.id.trim())
    }
  }
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}

export async function runPelicanTestRequest(
  request: PelicanTestRequest,
  signal: AbortSignal,
  onProgress?: (progress: PelicanStreamProgress) => void
): Promise<PelicanTestResponse> {
  const url = resolvePelicanApiUrl(request.baseUrl, request.apiFormat)
  const body: Record<string, unknown> = {
    model: request.model.trim(),
    stream: true,
  }
  if (request.apiFormat === 'responses') {
    body.instructions = PELICAN_TEST_SYSTEM_PROMPT
    body.input = PELICAN_TEST_PROMPT
    body.store = false
    if (request.effort !== 'auto') body.reasoning = { effort: request.effort }
  } else {
    body.stream_options = { include_usage: true }
    body.messages = [
      { role: 'system', content: PELICAN_TEST_SYSTEM_PROMPT },
      { role: 'user', content: PELICAN_TEST_PROMPT },
    ]
    if (request.effort !== 'auto') body.reasoning_effort = request.effort
  }
  const payload =
    request.transport === 'server'
      ? await requestPelicanProxy(
          'run',
          {
            api_url: url,
            api_key: request.apiKey.trim(),
            api_format: request.apiFormat,
            model: request.model.trim(),
            effort: request.effort,
            stream: true,
          },
          signal
        )
      : await requestPelicanApi(url, request.apiKey, signal, body)
  if (payload instanceof Response) {
    return consumePelicanStream(payload, request.apiFormat, signal, onProgress)
  }
  return {
    content:
      request.apiFormat === 'responses'
        ? readResponsesContent(payload)
        : readCompletionContent(payload),
    totalTokens: readTotalTokens(payload),
  }
}
