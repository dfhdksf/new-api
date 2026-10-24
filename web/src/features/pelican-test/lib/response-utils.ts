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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readResponsesContent(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error(i18next.t('The API response contains no text output.'))
  }
  if (isRecord(payload.error) && typeof payload.error.message === 'string') {
    throw new Error(payload.error.message)
  }
  if (payload.status === 'incomplete' || payload.status === 'failed') {
    throw new Error(i18next.t('The Responses API did not complete the output.'))
  }
  const texts: string[] = []
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (
        !isRecord(item) ||
        item.type !== 'message' ||
        !Array.isArray(item.content)
      ) {
        continue
      }
      for (const part of item.content) {
        if (!isRecord(part)) continue
        if (part.type === 'refusal' && typeof part.refusal === 'string') {
          throw new Error(part.refusal)
        }
        if (part.type === 'output_text' && typeof part.text === 'string') {
          texts.push(part.text)
        }
      }
    }
  }
  if (texts.length > 0) return texts.join('\n')
  throw new Error(i18next.t('The API response contains no text output.'))
}

export function readCompletionContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error(
      i18next.t('The API response does not contain chat completion choices.')
    )
  }

  const firstChoice: unknown = payload.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error(
      i18next.t('The API response does not contain a completion message.')
    )
  }

  const content = firstChoice.message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is Record<string, unknown> =>
          isRecord(part) && typeof part.text === 'string'
      )
      .map((part) => part.text as string)
      .join('\n')
  }
  throw new Error(i18next.t('The API response contains no text output.'))
}

export function readTotalTokens(payload: unknown): number | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null
  const value = payload.usage.total_tokens
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function getPelicanProxyError(failure: Record<string, unknown>): Error {
  if (failure.code === 'upstream_status') {
    const message = i18next.t('The upstream API returned HTTP {{status}}.', {
      status: failure.upstream_status,
    })
    return new Error(
      typeof failure.message === 'string' && failure.message
        ? `${message} ${failure.message}`
        : message
    )
  }
  if (failure.code === 'busy') {
    return new Error(
      i18next.t('The proxy is busy or rate limited. Try again later.')
    )
  }
  if (failure.code === 'timeout') {
    return new Error(
      i18next.t(
        'The upstream request timed out. It may already have incurred charges; check before retrying.'
      )
    )
  }
  if (failure.code === 'response_too_large') {
    return new Error(
      i18next.t('The upstream response exceeds the proxy size limit.')
    )
  }
  if (failure.code === 'invalid_response') {
    return new Error(i18next.t('The API returned an invalid JSON response.'))
  }
  if (failure.code === 'blocked_target') {
    return new Error(
      i18next.t(
        'The server blocked this API address. Check the server fetch policy.'
      )
    )
  }
  if (failure.code === 'invalid_request') {
    return new Error(
      i18next.t(
        'The proxy rejected the request settings. Check the API address, model, and reasoning effort.'
      )
    )
  }
  return new Error(i18next.t('The server could not reach the upstream API.'))
}
