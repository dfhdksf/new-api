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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { createBatchPlan } from '../lib/batch-utils'
import { savePelicanConfig } from '../lib/connection-storage'
import { createHistoryEntry, savePelicanHistory } from '../lib/history-storage'
import { PelicanTest } from '../pelican-test'
import { exampleConfig, exampleConnection } from './fixtures'

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(api.post).mockReset()
  useAuthStore.getState().auth.reset()
  window.localStorage.clear()
})

describe('Pelican Test page', () => {
  test('compares proxy and direct endpoints with isolated keys and formats, reports failures, and filters the gallery', async () => {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'tester', role: 1 })
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          transport: 'server',
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
        },
        {
          ...exampleConnection,
          id: 'b',
          name: 'Provider B',
          apiFormat: 'chat-completions',
          transport: 'direct',
          baseUrl: 'https://b.example.com/v1',
          credentials: [
            {
              ...exampleConnection.credentials[0],
              apiKey: 'key-b',
              rememberKey: true,
            },
          ],
        },
      ],
    })
    const svg =
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="gold" /></svg>'
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        reasoning_effort?: string
      }
      if (String(input).includes('b.example.com')) {
        if (body.reasoning_effort === 'high') {
          return new Response(
            JSON.stringify({
              error: { message: 'This model does not support high effort.' },
            }),
            { status: 400 }
          )
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: svg } }],
            usage: { total_tokens: 64 },
          })
        )
      }
      return new Response(
        JSON.stringify({
          output: [
            { type: 'message', content: [{ type: 'output_text', text: svg }] },
          ],
          usage: { total_tokens: 128 },
        })
      )
    })
    vi.mocked(api.post).mockResolvedValue({
      data: {
        output: [
          { type: 'message', content: [{ type: 'output_text', text: svg }] },
        ],
        usage: { total_tokens: 128 },
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<PelicanTest />)
    await user.click(screen.getByRole('checkbox', { name: 'high' }))
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    const results = screen.getByRole('region', { name: 'Results' })
    expect(
      await within(results).findByText('4 of 4 complete')
    ).toBeInTheDocument()
    expect(
      within(results).getAllByRole('img', {
        name: 'Generated pelican illustration',
      })
    ).toHaveLength(3)
    expect(
      within(results).getByText('This model does not support high effort.')
    ).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledTimes(2)
    expect(api.post).toHaveBeenCalledWith(
      '/api/pelican-test/run',
      expect.objectContaining({
        api_url: 'https://api.example.com/v1/responses',
        api_key: 'secret-key',
        api_format: 'responses',
      }),
      expect.any(Object)
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://b.example.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key-b' }),
      })
    )
    const first = within(results).getByRole('article', {
      name: 'Provider A · Account A · model-a · auto',
    })
    expect(within(first).getByText('128 tokens')).toBeInTheDocument()
    expect(
      within(first).getByRole('button', { name: 'Download SVG' })
    ).toBeEnabled()
    await user.click(within(first).getByText('Show model response'))
    expect(within(first).getByText(svg)).toBeVisible()
    await user.selectOptions(
      within(results).getByLabelText('Filter by connection'),
      'b'
    )
    expect(within(results).getAllByRole('article')).toHaveLength(2)
    expect(
      within(results).queryByRole('article', {
        name: 'Provider A · Account A · model-a · auto',
      })
    ).not.toBeInTheDocument()
  })
  test('labels preview fixtures clearly and never makes a request before starting', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<PelicanTest preview />)
    expect(
      screen.getByText(
        'Illustrative samples only. These are not model outputs and no API requests have been made.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('img', { name: 'Generated pelican illustration' })
    ).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test('automatically saves a batch, views it after remount, reruns with current keys, and deletes it', async () => {
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
        },
      ],
    })
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: '<svg><circle r="2" /></svg>' },
                ],
              },
            ],
          })
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    const first = render(<PelicanTest />)
    expect(screen.getByText('No test history yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start batch test' })
      ).toBeEnabled()
    )
    expect(
      await screen.findByRole('button', { name: 'View batch' })
    ).toBeEnabled()
    first.unmount()
    render(<PelicanTest />)
    await user.click(screen.getByRole('button', { name: 'View batch' }))
    expect(
      screen.getByRole('img', { name: 'Generated pelican illustration' })
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Rerun batch' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Delete batch' })
      ).toHaveLength(2)
    )
    await user.click(screen.getAllByRole('button', { name: 'Delete batch' })[0])
    expect(screen.getAllByRole('button', { name: 'View batch' })).toHaveLength(
      1
    )
  })

  test('restores history without sending requests when an API key was not remembered', async () => {
    savePelicanConfig(exampleConfig)
    savePelicanHistory([
      createHistoryEntry(exampleConfig, createBatchPlan(exampleConfig)),
    ])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<PelicanTest />)
    await user.click(screen.getByRole('button', { name: 'Rerun batch' }))
    expect(
      await screen.findByText(
        'Historical settings restored. Enter the missing API keys, then start the batch.'
      )
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test('opens an interrupted batch as cancelled results without issuing requests', async () => {
    const entry = createHistoryEntry(
      exampleConfig,
      createBatchPlan(exampleConfig)
    )
    savePelicanHistory([entry])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<PelicanTest />)
    await user.click(screen.getByRole('button', { name: 'View batch' }))
    const gallery = screen.getByRole('region', { name: 'Results' })
    expect(within(gallery).getByText('Cancelled')).toBeInTheDocument()
    expect(within(gallery).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test('tests a shared endpoint with named keys, isolates failures, and filters results by key', async () => {
    savePelicanConfig({
      ...exampleConfig,
      efforts: ['auto', 'high'],
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
            {
              ...exampleConnection.credentials[0],
              id: 'key-b',
              name: 'Account B',
              apiKey: 'key-b-secret',
              rememberKey: true,
            },
            {
              ...exampleConnection.credentials[0],
              id: 'disabled-key',
              enabled: false,
              apiKey: '',
              rememberKey: false,
            },
          ],
        },
      ],
    })
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (
        new Headers(init?.headers).get('Authorization') ===
        'Bearer key-b-secret'
      ) {
        return new Response(
          JSON.stringify({ error: { message: 'Key quota exceeded' } }),
          { status: 429 }
        )
      }
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: '<svg><circle r="2" /></svg>' },
              ],
            },
          ],
        })
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<PelicanTest />)
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    const results = screen.getByRole('region', { name: 'Results' })
    expect(
      await within(results).findByText('4 of 4 complete')
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const authorizations = fetchMock.mock.calls.map((call) =>
      new Headers(call[1]?.headers).get('Authorization')
    )
    expect(
      authorizations.filter((value) => value === 'Bearer secret-key')
    ).toHaveLength(2)
    expect(
      authorizations.filter((value) => value === 'Bearer key-b-secret')
    ).toHaveLength(2)
    expect(within(results).getAllByRole('article')).toHaveLength(4)
    const keyFilter = within(results).getByLabelText('Filter by API key')
    await user.selectOptions(keyFilter, JSON.stringify(['provider-a', 'key-b']))
    expect(within(results).getAllByRole('article')).toHaveLength(2)
    expect(within(results).getAllByText('Key quota exceeded')).toHaveLength(2)
    await user.selectOptions(keyFilter, JSON.stringify(['provider-a', 'key-a']))
    expect(
      within(results).getAllByRole('img', {
        name: 'Generated pelican illustration',
      })
    ).toHaveLength(2)
    expect(
      within(results).queryByText('Key quota exceeded')
    ).not.toBeInTheDocument()
  })
})
