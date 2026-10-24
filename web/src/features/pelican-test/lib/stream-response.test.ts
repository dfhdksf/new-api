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
import { describe, expect, test, vi } from 'vitest'

import type { PelicanStreamProgress } from '../types'
import { consumePelicanStream } from './stream-response'

const signal = () => new AbortController().signal
const event = (value: unknown, name = '') =>
  `${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(value)}\n\n`
const sseResponse = (body: BodyInit) =>
  new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
const completedResponse = (content: string) => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    output: [
      { type: 'message', content: [{ type: 'output_text', text: content }] },
    ],
    usage: { total_tokens: 84 },
  },
})

describe('Pelican SSE consumption', () => {
  test('reports Responses text before completion and replaces deltas with final text without duplication', async () => {
    const source = new TransformStream<Uint8Array, Uint8Array>()
    const writer = source.writable.getWriter()
    const progress = vi.fn<(value: PelicanStreamProgress) => void>()
    const result = consumePelicanStream(
      sseResponse(source.readable),
      'responses',
      signal(),
      progress
    )
    const encoder = new TextEncoder()
    await writer.write(
      encoder.encode(
        `: keep-alive\n\n${event({
          type: 'response.output_text.delta',
          delta: '<svg>',
        })}`
      )
    )
    expect(progress).toHaveBeenLastCalledWith({
      content: '<svg>',
      totalTokens: null,
    })
    await writer.write(
      encoder.encode(
        event({ type: 'response.output_text.done', text: '<svg>鹈鹕</svg>' }) +
          event(completedResponse('<svg>鹈鹕</svg>'))
      )
    )
    await expect(result).resolves.toEqual({
      content: '<svg>鹈鹕</svg>',
      totalTokens: 84,
    })
  })

  test.each(['\n', '\r\n', '\r'])(
    'accepts UTF-8 split between bytes and %j event delimiters',
    async (newline) => {
      const encoded = new TextEncoder().encode(
        (
          event({
            type: 'response.output_text.delta',
            delta: '<svg>鹈鹕</svg>',
          }) + event(completedResponse('<svg>鹈鹕</svg>'))
        ).replaceAll('\n', newline)
      )
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of encoded) controller.enqueue(Uint8Array.of(byte))
          controller.close()
        },
      })
      await expect(
        consumePelicanStream(sseResponse(body), 'responses', signal())
      ).resolves.toEqual({ content: '<svg>鹈鹕</svg>', totalTokens: 84 })
    }
  )

  test('reads Chat Completions deltas and the separate usage chunk before DONE', async () => {
    const stream = `: heartbeat\n\n${event({
      choices: [{ index: 0, delta: { content: '<svg>' } }],
    })}${event({
      choices: [
        { index: 0, delta: { content: '</svg>' }, finish_reason: 'stop' },
      ],
    })}${event({ choices: [], usage: { total_tokens: 42 } })}data: [DONE]\n\n`
    await expect(
      consumePelicanStream(sseResponse(stream), 'chat-completions', signal())
    ).resolves.toEqual({ content: '<svg></svg>', totalTokens: 42 })
  })

  test('accepts multiline data fields and event names when the Responses type is absent', async () => {
    const stream = `event: response.output_text.delta\ndata: {"delta":\ndata: "<svg/>"}\n\n${event(
      completedResponse('<svg/>')
    )}`
    await expect(
      consumePelicanStream(sseResponse(stream), 'responses', signal())
    ).resolves.toEqual({ content: '<svg/>', totalTokens: 84 })
  })

  test.each(['responses', 'chat-completions'] as const)(
    'rejects truncated %s output while reporting the partial text',
    async (format) => {
      const payload =
        format === 'responses'
          ? { type: 'response.output_text.delta', delta: '<svg>' }
          : {
              choices: [
                {
                  index: 0,
                  delta: { content: '<svg>' },
                  finish_reason: 'stop',
                },
              ],
            }
      const progress = vi.fn()
      await expect(
        consumePelicanStream(
          sseResponse(event(payload)),
          format,
          signal(),
          progress
        )
      ).rejects.toThrow('The stream ended before the model completed.')
      expect(progress).toHaveBeenCalledWith({
        content: '<svg>',
        totalTokens: null,
      })
    }
  )

  test('does not dispatch a terminal event without its final blank line', async () => {
    await expect(
      consumePelicanStream(
        sseResponse(event(completedResponse('<svg/>')).trimEnd()),
        'responses',
        signal()
      )
    ).rejects.toThrow('The stream ended before the model completed.')
  })

  test.each([
    [
      event(
        { error: { code: 'upstream_status', upstream_status: 504 } },
        'pelican.error'
      ),
      'HTTP 504',
    ],
    [
      event({ error: { code: 'busy' } }, 'pelican.error'),
      'busy or rate limited',
    ],
    [
      event({
        type: 'response.failed',
        response: { error: { message: 'Provider failed' } },
      }),
      'Provider failed',
    ],
    [event({ type: 'response.incomplete', response: {} }), 'did not complete'],
    [
      event({ type: 'error', message: 'Provider stream error' }),
      'Provider stream error',
    ],
  ])('surfaces proxy and provider stream errors', async (stream, message) => {
    await expect(
      consumePelicanStream(sseResponse(stream), 'responses', signal())
    ).rejects.toThrow(message)
  })

  test('rejects Chat Completions token-limited output even if DONE follows', async () => {
    await expect(
      consumePelicanStream(
        sseResponse(
          `${event({
            choices: [
              {
                index: 0,
                delta: { content: '<svg>' },
                finish_reason: 'length',
              },
            ],
          })}data: [DONE]\n\n`
        ),
        'chat-completions',
        signal()
      )
    ).rejects.toThrow('The model output was incomplete.')
  })

  test('cancels the stream reader when the user aborts', async () => {
    const controller = new AbortController()
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const result = consumePelicanStream(
      sseResponse(body),
      'responses',
      controller.signal
    )
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancelled).toHaveBeenCalledOnce()
  })

  test('accepts a provider that ignores stream and returns a complete JSON response', async () => {
    const payload = completedResponse('<svg/>').response
    for (const response of [
      new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      }),
      sseResponse(event(payload, 'pelican.result')),
    ]) {
      await expect(
        consumePelicanStream(response, 'responses', signal())
      ).resolves.toEqual({ content: '<svg/>', totalTokens: 84 })
    }
  })
  test('reports a network interruption after delivering partial output', async () => {
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new TypeError('Connection reset'))
          return
        }
        sent = true
        controller.enqueue(
          new TextEncoder().encode(
            event({ type: 'response.output_text.delta', delta: '<svg>' })
          )
        )
      },
    })
    const progress = vi.fn()
    await expect(
      consumePelicanStream(sseResponse(body), 'responses', signal(), progress)
    ).rejects.toThrow('Partial output was preserved')
    expect(progress).toHaveBeenCalledWith({
      content: '<svg>',
      totalTokens: null,
    })
  })

  test('bounds direct SSE responses as well as server-proxied responses', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1))
        controller.close()
      },
    })
    await expect(
      consumePelicanStream(sseResponse(body), 'responses', signal())
    ).rejects.toThrow('exceeds the proxy size limit')
  })
})
