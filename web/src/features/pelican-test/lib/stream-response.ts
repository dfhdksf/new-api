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

import type {
  PelicanApiFormat,
  PelicanStreamProgress,
  PelicanTestResponse,
} from '../types'
import {
  getPelicanProxyError,
  isRecord,
  readCompletionContent,
  readResponsesContent,
  readTotalTokens,
} from './response-utils'

const MAX_STREAM_BYTES = 4 * 1024 * 1024

// Track output parts separately: final text events replace their own deltas
// instead of duplicating text, even when Responses emits multiple messages.
class PelicanStreamAccumulator {
  private readonly parts = new Map<
    string,
    { output: number; part: number; text: string }
  >()
  private chatContent = ''
  totalTokens: number | null = null
  completed = false

  constructor(private readonly format: PelicanApiFormat) {}

  get progress(): PelicanStreamProgress {
    const content =
      this.format === 'responses'
        ? [...this.parts.values()]
            .sort((a, b) => a.output - b.output || a.part - b.part)
            .map((part) => part.text)
            .join('\n')
        : this.chatContent
    return { content, totalTokens: this.totalTokens }
  }

  accept(event: string, data: string): void {
    if (data === '[DONE]') {
      if (this.format === 'chat-completions') this.completed = true
      return
    }
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      throw new Error(i18next.t('The API returned an invalid JSON response.'))
    }
    if (!isRecord(value)) {
      throw new Error(i18next.t('The API returned an invalid JSON response.'))
    }
    if (event === 'pelican.error' && isRecord(value.error)) {
      throw getPelicanProxyError(value.error)
    }
    if (isRecord(value.error)) {
      throw new Error(
        typeof value.error.message === 'string'
          ? value.error.message
          : i18next.t('The request failed.')
      )
    }
    if (event === 'pelican.result') {
      this.chatContent =
        this.format === 'responses'
          ? readResponsesContent(value)
          : readCompletionContent(value)
      this.parts.clear()
      this.parts.set('final', { output: 0, part: 0, text: this.chatContent })
      this.totalTokens = readTotalTokens(value)
      this.completed = true
      return
    }
    if (this.format === 'chat-completions') {
      this.totalTokens = readTotalTokens(value) ?? this.totalTokens
      if (!Array.isArray(value.choices)) return
      const choice = value.choices.find(
        (item) =>
          isRecord(item) && (item.index === 0 || item.index === undefined)
      )
      if (!isRecord(choice)) return
      if (
        choice.finish_reason === 'length' ||
        choice.finish_reason === 'content_filter'
      ) {
        throw new Error(i18next.t('The model output was incomplete.'))
      }
      if (!isRecord(choice.delta)) return
      if (typeof choice.delta.refusal === 'string' && choice.delta.refusal) {
        throw new Error(choice.delta.refusal)
      }
      if (typeof choice.delta.content === 'string') {
        this.chatContent += choice.delta.content
      }
      return
    }
    const type = typeof value.type === 'string' ? value.type : event
    if (type === 'error') {
      throw new Error(
        typeof value.message === 'string'
          ? value.message
          : i18next.t('The request failed.')
      )
    }
    if (type === 'response.failed' || type === 'response.incomplete') {
      if (
        isRecord(value.response) &&
        isRecord(value.response.error) &&
        typeof value.response.error.message === 'string'
      ) {
        throw new Error(value.response.error.message)
      }
      throw new Error(
        i18next.t('The Responses API did not complete the output.')
      )
    }
    if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
      throw new Error(
        typeof value.refusal === 'string'
          ? value.refusal
          : i18next.t('The API response contains no text output.')
      )
    }
    if (type === 'response.completed') {
      if (!isRecord(value.response)) {
        throw new Error(i18next.t('The API returned an invalid JSON response.'))
      }
      const content = readResponsesContent(value.response)
      this.parts.clear()
      this.parts.set('final', { output: 0, part: 0, text: content })
      this.totalTokens = readTotalTokens(value.response)
      this.completed = true
      return
    }
    if (
      type !== 'response.output_text.delta' &&
      type !== 'response.output_text.done'
    ) {
      return
    }
    const output =
      typeof value.output_index === 'number' ? value.output_index : 0
    const part =
      typeof value.content_index === 'number' ? value.content_index : 0
    const key = `${output}:${part}`
    const previous = this.parts.get(key)?.text ?? ''
    let text = previous
    if (
      type === 'response.output_text.delta' &&
      typeof value.delta === 'string'
    ) {
      text += value.delta
    } else if (
      type === 'response.output_text.done' &&
      typeof value.text === 'string'
    ) {
      text = value.text
    }
    this.parts.set(key, { output, part, text })
  }
}

export async function consumePelicanStream(
  response: Response,
  format: PelicanApiFormat,
  signal: AbortSignal,
  onProgress?: (progress: PelicanStreamProgress) => void
): Promise<PelicanTestResponse> {
  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('text/event-stream')
  ) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new Error(i18next.t('The API returned an invalid JSON response.'))
    }
    return {
      content:
        format === 'responses'
          ? readResponsesContent(payload)
          : readCompletionContent(payload),
      totalTokens: readTotalTokens(payload),
    }
  }
  if (!response.body) {
    throw new Error(i18next.t('The API returned an invalid JSON response.'))
  }
  const reader = response.body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder()
  const accumulator = new PelicanStreamAccumulator(format)
  let buffer = ''
  let data: string[] = []
  let event = ''
  let bytes = 0
  let previousContent = ''
  let previousTokens: number | null = null
  try {
    while (!accumulator.completed) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const chunk = await reader.read()
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      bytes += chunk.value?.byteLength ?? 0
      if (bytes > MAX_STREAM_BYTES) {
        throw new Error(
          i18next.t('The upstream response exceeds the proxy size limit.')
        )
      }
      buffer += chunk.done
        ? decoder.decode()
        : decoder.decode(chunk.value, { stream: true })
      // Accept LF, CRLF, and CR, including CRLF split across network chunks.
      let lineEnd = buffer.search(/[\r\n]/)
      while (lineEnd >= 0) {
        if (
          !chunk.done &&
          buffer[lineEnd] === '\r' &&
          lineEnd === buffer.length - 1
        ) {
          break
        }
        const line = buffer.slice(0, lineEnd)
        const separatorLength =
          buffer[lineEnd] === '\r' && buffer[lineEnd + 1] === '\n' ? 2 : 1
        buffer = buffer.slice(lineEnd + separatorLength)
        if (line === '') {
          if (data.length > 0) {
            accumulator.accept(event, data.join('\n'))
            const progress = accumulator.progress
            if (
              progress.content !== previousContent ||
              progress.totalTokens !== previousTokens
            ) {
              onProgress?.(progress)
              previousContent = progress.content
              previousTokens = progress.totalTokens
            }
          }
          data = []
          event = ''
          if (accumulator.completed) break
        } else if (!line.startsWith(':')) {
          const separator = line.indexOf(':')
          const field = separator < 0 ? line : line.slice(0, separator)
          const value =
            separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
          if (field === 'data') data.push(value)
          if (field === 'event') event = value
        }
        lineEnd = buffer.search(/[\r\n]/)
      }
      if (chunk.done) break
    }
    if (!accumulator.completed) {
      throw new Error(
        i18next.t(
          'The stream ended before the model completed. Partial output was preserved; check before retrying.'
        )
      )
    }
    const result = accumulator.progress
    if (!result.content.trim()) {
      throw new Error(i18next.t('The API response contains no text output.'))
    }
    return result
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (error instanceof TypeError) {
      throw new Error(
        i18next.t(
          'The stream ended before the model completed. Partial output was preserved; check before retrying.'
        )
      )
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
