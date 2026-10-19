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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  fetchPelicanModels,
  resolvePelicanApiUrl,
  runPelicanTestRequest,
} from '../api'

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }))

const request = {
  apiFormat: 'chat-completions' as const,
  transport: 'direct' as const,
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'secret-key',
  model: 'example-model',
  effort: 'high' as const,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(api.post).mockReset()
  useAuthStore.getState().auth.reset()
})

describe('resolvePelicanApiUrl', () => {
  test('appends the OpenAI-compatible endpoint to a versioned base URL', () => {
    expect(
      resolvePelicanApiUrl('https://api.example.com/v1/', 'chat-completions')
    ).toBe('https://api.example.com/v1/chat/completions')
  })

  test('preserves a custom API prefix and an existing chat endpoint', () => {
    expect(
      resolvePelicanApiUrl(
        'https://gateway.example.com/custom/v1/chat/completions/',
        'chat-completions'
      )
    ).toBe('https://gateway.example.com/custom/v1/chat/completions')
  })

  test('preserves an explicitly supplied endpoint with a custom version or prefix', () => {
    expect(
      resolvePelicanApiUrl(
        'https://gateway.example.com/api/v2/responses',
        'responses'
      )
    ).toBe('https://gateway.example.com/api/v2/responses')
    expect(
      resolvePelicanApiUrl(
        'https://gateway.example.com/api/chat/completions',
        'responses'
      )
    ).toBe('https://gateway.example.com/api/responses')
  })

  test('rejects non-HTTP protocols and URLs with embedded credentials', () => {
    expect(() =>
      resolvePelicanApiUrl('file:///etc/passwd', 'chat-completions')
    ).toThrow('Base URL must use HTTP or HTTPS.')
    expect(() =>
      resolvePelicanApiUrl(
        'https://user:pass@api.example.com',
        'chat-completions'
      )
    ).toThrow('Base URL must not contain embedded credentials.')
  })
})

describe('runPelicanTestRequest', () => {
  test('sends the selected model and reasoning effort and reads SVG output metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '<svg viewBox="0 0 1 1"></svg>' } }],
          usage: { total_tokens: 84 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPelicanTestRequest(
      request,
      new AbortController().signal
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: 'Bearer secret-key',
        },
        body: expect.stringContaining('"reasoning_effort":"high"'),
      })
    )
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body as string).messages
    ).toContainEqual({
      role: 'user',
      content: 'Generate an SVG of a pelican riding a bicycle.',
    })
    expect(result).toEqual({
      content: '<svg viewBox="0 0 1 1"></svg>',
      totalTokens: 84,
    })
  })

  test('omits reasoning effort when automatic mode is selected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    await runPelicanTestRequest(
      { ...request, effort: 'auto' },
      new AbortController().signal
    )

    const body = JSON.parse(
      fetchMock.mock.calls[0][1].body as string
    ) as Record<string, unknown>
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  test('reads text-part responses and omits missing usage metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    { type: 'text', text: '<svg>' },
                    { type: 'text', text: '</svg>' },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
    )

    await expect(
      runPelicanTestRequest(request, new AbortController().signal)
    ).resolves.toEqual({
      content: '<svg>\n</svg>',
      totalTokens: null,
    })
  })

  test.each([
    [
      400,
      JSON.stringify({ error: { message: 'Unsupported reasoning effort' } }),
      'Unsupported reasoning effort',
    ],
    [502, 'Gateway unavailable', 'Gateway unavailable'],
    [200, 'not JSON', 'The API returned an invalid JSON response.'],
    [200, '{}', 'The API response does not contain chat completion choices.'],
  ])(
    'reports HTTP or response errors for status %s and body %s',
    async (status, body, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(body, { status }))
      )

      await expect(
        runPelicanTestRequest(request, new AbortController().signal)
      ).rejects.toThrow(message)
    }
  )
})

describe('Responses API and model discovery', () => {
  test('sends native reasoning options and extracts text after reasoning items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'reasoning',
              summary: [{ type: 'summary_text', text: 'private reasoning' }],
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: '<svg />' }],
            },
          ],
          usage: { total_tokens: 123 },
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await runPelicanTestRequest(
      { ...request, apiFormat: 'responses' },
      new AbortController().signal
    )
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/v1/responses'
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({
      model: 'example-model',
      reasoning: { effort: 'high' },
      store: false,
      input: 'Generate an SVG of a pelican riding a bicycle.',
    })
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('messages')
    expect(result).toEqual({ content: '<svg />', totalTokens: 123 })
  })
  test('omits native reasoning when using the provider default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '<svg />' }],
            },
          ],
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    await runPelicanTestRequest(
      { ...request, apiFormat: 'responses', effort: 'auto' },
      new AbortController().signal
    )
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body as string)
    ).not.toHaveProperty('reasoning')
  })
  test('does not report incomplete or refused native outputs as successful illustrations', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'incomplete', output: [] }))
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              output: [
                {
                  type: 'message',
                  content: [
                    { type: 'refusal', refusal: 'Cannot produce this output.' },
                  ],
                },
              ],
            })
          )
        )
    )
    await expect(
      runPelicanTestRequest(
        { ...request, apiFormat: 'responses' },
        new AbortController().signal
      )
    ).rejects.toThrow('The Responses API did not complete the output.')
    await expect(
      runPelicanTestRequest(
        { ...request, apiFormat: 'responses' },
        new AbortController().signal
      )
    ).rejects.toThrow('Cannot produce this output.')
  })
  test('switches full endpoint paths without duplicating version segments', () => {
    expect(
      resolvePelicanApiUrl(
        'https://gateway.example.com/proxy/v1/chat/completions/',
        'responses'
      )
    ).toBe('https://gateway.example.com/proxy/v1/responses')
    expect(
      resolvePelicanApiUrl(
        'https://gateway.example.com/proxy/v1/responses',
        'chat-completions'
      )
    ).toBe('https://gateway.example.com/proxy/v1/chat/completions')
    expect(resolvePelicanApiUrl('https://api.example.com', 'responses')).toBe(
      'https://api.example.com/v1/responses'
    )
  })
  test('loads unique model IDs from the correct endpoint with its own key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'model-b' },
            { id: 'model-a' },
            { id: 'model-b' },
            { object: 'invalid' },
          ],
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      fetchPelicanModels(
        {
          ...request,
          baseUrl: 'https://gateway.example.com/proxy/v1/responses',
        },
        new AbortController().signal
      )
    ).resolves.toEqual(['model-a', 'model-b'])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/proxy/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer secret-key' },
        credentials: 'omit',
      })
    )
  })
  test('reports invalid model lists and authentication failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}'))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { message: 'Invalid API key' } }),
            { status: 401 }
          )
        )
    )
    await expect(
      fetchPelicanModels(request, new AbortController().signal)
    ).rejects.toThrow('The API response does not contain a model list.')
    await expect(
      fetchPelicanModels(request, new AbortController().signal)
    ).rejects.toThrow('Invalid API key')
  })
})

describe('explicit proxy transport', () => {
  const proxyRequest = { ...request, transport: 'server' as const }
  const signIn = () =>
    useAuthStore.getState().auth.setUser({ id: 1, username: 'tester', role: 1 })

  test('fetches models through the server without a browser request', async () => {
    signIn()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(api.post).mockResolvedValue({
      data: { data: [{ id: 'model-b' }, { id: 'model-a' }] },
    })
    const signal = new AbortController().signal
    await expect(fetchPelicanModels(proxyRequest, signal)).resolves.toEqual([
      'model-a',
      'model-b',
    ])
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      '/api/pelican-test/models',
      {
        models_url: 'https://api.example.com/v1/models',
        api_key: 'secret-key',
      },
      expect.objectContaining({ signal })
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each(['responses', 'chat-completions'] as const)(
    'generates through the proxy using %s and reads native metadata',
    async (apiFormat) => {
      signIn()
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const content = '<svg viewBox="0 0 1 1"></svg>'
      vi.mocked(api.post).mockResolvedValue({
        data:
          apiFormat === 'responses'
            ? {
                output: [
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: content }],
                  },
                ],
                usage: { total_tokens: 84 },
              }
            : {
                choices: [{ message: { content } }],
                usage: { total_tokens: 84 },
              },
      })
      const signal = new AbortController().signal
      await expect(
        runPelicanTestRequest({ ...proxyRequest, apiFormat }, signal)
      ).resolves.toEqual({ content, totalTokens: 84 })
      expect(api.post).toHaveBeenCalledExactlyOnceWith(
        '/api/pelican-test/run',
        {
          api_url: `https://api.example.com/v1/${apiFormat === 'responses' ? 'responses' : 'chat/completions'}`,
          api_key: 'secret-key',
          api_format: apiFormat,
          model: 'example-model',
          effort: 'high',
          stream: true,
        },
        expect.objectContaining({ signal, timeout: 310000 })
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  test('requires login before model discovery or generation', async () => {
    await expect(
      fetchPelicanModels(proxyRequest, new AbortController().signal)
    ).rejects.toThrow('Sign in to use the Pelican test server proxy.')
    await expect(
      runPelicanTestRequest(proxyRequest, new AbortController().signal)
    ).rejects.toThrow('Sign in to use the Pelican test server proxy.')
    expect(api.post).not.toHaveBeenCalled()
  })

  test('never switches a direct network failure to the proxy', async () => {
    signIn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )
    await expect(
      fetchPelicanModels(request, new AbortController().signal)
    ).rejects.toThrow('Could not reach the API.')
    await expect(
      runPelicanTestRequest(request, new AbortController().signal)
    ).rejects.toThrow('Could not reach the API.')
    expect(api.post).not.toHaveBeenCalled()
  })

  test('does not submit a request that was already cancelled', async () => {
    signIn()
    const controller = new AbortController()
    controller.abort()
    await expect(
      runPelicanTestRequest(proxyRequest, controller.signal)
    ).rejects.toThrow('Aborted')
    expect(api.post).not.toHaveBeenCalled()
  })

  test.each([
    [
      502,
      {
        code: 'upstream_status',
        upstream_status: 401,
        message: 'Invalid upstream key',
      },
      'The upstream API returned HTTP 401. Invalid upstream key',
    ],
    [504, { code: 'timeout' }, 'The upstream request timed out.'],
    [
      502,
      { code: 'response_too_large' },
      'The upstream response exceeds the proxy size limit.',
    ],
    [
      502,
      { code: 'invalid_response' },
      'The API returned an invalid JSON response.',
    ],
    [403, { code: 'blocked_target' }, 'The server blocked this API address.'],
    [
      400,
      { code: 'invalid_request' },
      'The proxy rejected the request settings.',
    ],
    [429, { code: 'busy' }, 'The proxy is busy or rate limited.'],
  ])(
    'reports HTTP %i proxy errors without retrying or falling back',
    async (status, error, message) => {
      signIn()
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      vi.mocked(api.post).mockRejectedValue({
        isAxiosError: true,
        response: { status, data: { error } },
      })
      await expect(
        runPelicanTestRequest(proxyRequest, new AbortController().signal)
      ).rejects.toThrow(message)
      expect(api.post).toHaveBeenCalledTimes(1)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(useAuthStore.getState().auth.user?.id).toBe(1)
    }
  )

  test('warns that an interrupted request may have reached the upstream', async () => {
    signIn()
    vi.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      code: 'ECONNABORTED',
    })
    await expect(
      runPelicanTestRequest(proxyRequest, new AbortController().signal)
    ).rejects.toThrow(
      'The upstream request may have started; check before retrying.'
    )
    expect(api.post).toHaveBeenCalledTimes(1)
  })
})

describe('streaming API transport', () => {
  test.each(['direct', 'server'] as const)(
    'consumes SSE through %s transport and requests native streaming',
    async (transport) => {
      const wire =
        'data: {"choices":[{"index":0,"delta":{"content":"<svg/>"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":42}}\n\ndata: [DONE]\n\n'
      const response = new Response(wire, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
      const fetchMock = vi.fn().mockResolvedValue(response)
      vi.stubGlobal('fetch', fetchMock)
      useAuthStore
        .getState()
        .auth.setUser({ id: 1, username: 'tester', role: 1 })
      vi.mocked(api.post).mockResolvedValue({
        data: response.body,
        headers: { 'content-type': 'text/event-stream' },
      })
      const progress = vi.fn()
      await expect(
        runPelicanTestRequest(
          { ...request, transport },
          new AbortController().signal,
          progress
        )
      ).resolves.toEqual({ content: '<svg/>', totalTokens: 42 })
      expect(progress).toHaveBeenCalledWith({
        content: '<svg/>',
        totalTokens: null,
      })
      if (transport === 'direct') {
        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
        expect(body).toMatchObject({
          stream: true,
          stream_options: { include_usage: true },
        })
      } else {
        expect(api.post).toHaveBeenCalledWith(
          '/api/pelican-test/run',
          expect.objectContaining({ stream: true }),
          expect.objectContaining({ adapter: 'fetch', responseType: 'stream' })
        )
        expect(fetchMock).not.toHaveBeenCalled()
      }
    }
  )
})
