/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version).

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { usePelicanTestRunner } from '../hooks/use-pelican-test-runner'
import type { PelicanTestConfig } from '../types'
import { exampleConfig, exampleConnection } from './fixtures'

const config: PelicanTestConfig = {
  ...exampleConfig,
  connections: [
    { ...exampleConnection, modelsText: 'model-a,model-b,model-c' },
  ],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: content }] },
      ],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Pelican Test batch runner', () => {
  test('respects concurrency, continues after an error, and reports every result', async () => {
    const firstRequest = deferred<Response>()
    const secondRequest = deferred<Response>()
    const responses = new Map([
      ['model-a', firstRequest],
      ['model-b', secondRequest],
    ])
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const requestBody = JSON.parse(String(init?.body)) as { model: string }
      const pending = responses.get(requestBody.model)
      if (pending) return pending.promise
      return completion('<svg viewBox="0 0 1 1"><circle r=".5" /></svg>')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePelicanTestRunner())
    let batch: Promise<void> | undefined

    act(() => {
      batch = result.current.start(config)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    act(() => {
      void result.current.start(config)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstRequest.resolve(
        completion('<svg viewBox="0 0 1 1"><circle r=".5" /></svg>')
      )
      secondRequest.reject(new Error('provider unavailable'))
      await Promise.resolve()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => batch)

    expect(
      result.current.results.map(({ model, status }) => [model, status])
    ).toEqual([
      ['model-a', 'success'],
      ['model-b', 'error'],
      ['model-c', 'success'],
    ])
    expect(result.current.successCount).toBe(2)
    expect(result.current.failureCount).toBe(1)
    expect(result.current.progressValue).toBe(100)
  })

  test('stop aborts active requests and marks queued work as cancelled', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const onBatchChange = vi.fn()
    const { result } = renderHook(() => usePelicanTestRunner(onBatchChange))
    let batch: Promise<void> | undefined

    act(() => {
      batch = result.current.start(config)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(onBatchChange.mock.calls[0][0].finishedAt).toBeNull()
    act(() => result.current.stop())
    await act(async () => batch)

    expect(result.current.results.map(({ status }) => status)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ])
    expect(result.current.isRunning).toBe(false)
    expect(onBatchChange.mock.lastCall?.[0]).toMatchObject({
      finishedAt: expect.any(String),
      results: expect.arrayContaining([
        expect.objectContaining({ status: 'cancelled' }),
      ]),
    })
  })

  test('unmount aborts pending network requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result, unmount } = renderHook(() => usePelicanTestRunner())
    let batch: Promise<void> | undefined

    act(() => {
      batch = result.current.start(config)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const signals = fetchMock.mock.calls.map(([, init]) => init?.signal)

    unmount()
    await act(async () => batch)

    expect(signals.every((signal) => signal?.aborted)).toBe(true)
  })
})
