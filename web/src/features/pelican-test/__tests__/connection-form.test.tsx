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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { ConnectionForm } from '../components/connection-form'
import {
  PELICAN_STORAGE_KEY,
  savePelicanConfig,
} from '../lib/connection-storage'
import { exampleConfig, exampleConnection } from './fixtures'

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('Pelican Test connection form', () => {
  test('shows field errors and does not start with missing details', async () => {
    const onStart = vi.fn()
    render(
      <ConnectionForm isRunning={false} onStart={onStart} onStop={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start batch test' }))
    expect(await screen.findByText('Enter a Base URL.')).toBeInTheDocument()
    expect(screen.getByText('Enter an API key.')).toBeInTheDocument()
    expect(screen.getByText('Enter at least one model ID.')).toBeInTheDocument()
    expect(onStart).not.toHaveBeenCalled()
  })
  test('submits selected strengths with native Responses and server proxy by default', async () => {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'tester', role: 1 })
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(
      <ConnectionForm isRunning={false} onStart={onStart} onStop={vi.fn()} />
    )
    await user.type(
      screen.getByLabelText('Base URL'),
      'https://api.example.com/v1'
    )
    await user.type(screen.getByLabelText('API Key'), 'secret-key')
    await user.type(
      screen.getByLabelText('Models (one per line)'),
      'model-a\nmodel-b'
    )
    await user.click(screen.getByRole('checkbox', { name: 'high' }))
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: [
            expect.objectContaining({
              baseUrl: 'https://api.example.com/v1',
              credentials: [
                expect.objectContaining({
                  apiKey: 'secret-key',
                  rememberKey: false,
                }),
              ],
              apiFormat: 'responses',
              transport: 'server',
              modelsText: 'model-a\nmodel-b',
            }),
          ],
          efforts: ['auto', 'high'],
          count: 1,
          concurrency: 2,
        })
      )
    )
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
  })
  test('blocks a signed-out proxy batch and allows an explicit direct batch', async () => {
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
      ],
    })
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(
      <ConnectionForm isRunning={false} onStart={onStart} onStop={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign in to use the Pelican test server proxy.'
    )
    expect(onStart).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText('Request method'), 'direct')
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: [expect.objectContaining({ transport: 'direct' })],
        })
      )
    )
  })
  test('fetches and searches models without losing manually selected IDs', async () => {
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
          modelsText: 'manual-model',
        },
      ],
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
        )
      )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <ConnectionForm isRunning={false} onStart={vi.fn()} onStop={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Fetch models' }))
    const models = await screen.findByRole('group', {
      name: 'Available models',
    })
    await user.click(within(models).getByRole('checkbox', { name: 'model-b' }))
    expect(screen.getByLabelText('Models (one per line)')).toHaveValue(
      'manual-model\nmodel-b'
    )
    await user.type(screen.getByLabelText('Search models'), 'model-b')
    expect(
      within(models).queryByRole('checkbox', { name: 'model-a' })
    ).not.toBeInTheDocument()
    expect(
      within(models).getByRole('checkbox', { name: 'model-b' })
    ).toBeChecked()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret-key' },
      })
    )
  })
  test('keeps model selections across pages and resets pagination when searching', async () => {
    savePelicanConfig({
      ...exampleConfig,
      connections: [
        {
          ...exampleConnection,
          credentials: [
            { ...exampleConnection.credentials[0], rememberKey: true },
          ],
          modelsText: '',
        },
      ],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: Array.from({ length: 12 }, (_, index) => ({
              id: `model-${String(index + 1).padStart(2, '0')}`,
            })),
          })
        )
      )
    )
    const user = userEvent.setup()
    render(
      <ConnectionForm isRunning={false} onStart={vi.fn()} onStop={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Fetch models' }))
    const models = await screen.findByRole('group', {
      name: 'Available models',
    })
    expect(within(models).getAllByRole('checkbox')).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await user.click(within(models).getByRole('checkbox', { name: 'model-01' }))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(within(models).getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await user.click(within(models).getByRole('checkbox', { name: 'model-12' }))
    expect(screen.getByLabelText('Models (one per line)')).toHaveValue(
      'model-01\nmodel-12'
    )
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(
      within(models).getByRole('checkbox', { name: 'model-01' })
    ).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.type(screen.getByLabelText('Search models'), 'model-01')
    expect(within(models).getAllByRole('checkbox')).toHaveLength(1)
    expect(
      within(models).getByRole('checkbox', { name: 'model-01' })
    ).toBeChecked()
    expect(
      screen.queryByRole('button', { name: 'Next page' })
    ).not.toBeInTheDocument()
  })
  test('restores saved keys, removes opted-out secrets, and preserves credentials when changing the address', async () => {
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
    const user = userEvent.setup()
    const first = render(
      <ConnectionForm isRunning={false} onStart={vi.fn()} onStop={vi.fn()} />
    )
    expect(screen.getByLabelText('API Key')).toHaveValue('secret-key')
    await user.click(screen.getByLabelText('Remember key on this browser'))
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
    first.unmount()
    render(
      <ConnectionForm isRunning={false} onStart={vi.fn()} onStop={vi.fn()} />
    )
    expect(screen.getByLabelText('API Key')).toHaveValue('')
    await user.type(screen.getByLabelText('API Key'), 'new-secret')
    await user.click(screen.getByLabelText('Remember key on this browser'))
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).toContain(
      'new-secret'
    )
    await user.clear(screen.getByLabelText('Base URL'))
    await user.type(
      screen.getByLabelText('Base URL'),
      'https://new.example.com/v1'
    )
    expect(screen.getByLabelText('API Key')).toHaveValue('new-secret')
    expect(screen.getByLabelText('Remember key on this browser')).toBeChecked()
    expect(screen.getByLabelText('Models (one per line)')).toHaveValue(
      exampleConnection.modelsText
    )
    expect(
      JSON.parse(window.localStorage.getItem(PELICAN_STORAGE_KEY) ?? '{}')
        .config.connections[0]
    ).toEqual(
      expect.objectContaining({
        baseUrl: 'https://new.example.com/v1',
        credentials: [
          {
            ...exampleConnection.credentials[0],
            apiKey: 'new-secret',
            rememberKey: true,
          },
        ],
        modelsText: exampleConnection.modelsText,
      })
    )
  })
  test('adds and removes independent profiles and displays model discovery errors', async () => {
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'Model listing is disabled.' },
          }),
          { status: 403 }
        )
      )
    )
    const user = userEvent.setup()
    render(
      <ConnectionForm isRunning={false} onStart={vi.fn()} onStop={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Fetch models' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Model listing is disabled.'
    )
    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    const second = screen.getByRole('region', { name: 'Connection 2' })
    expect(within(second).getByLabelText('API Key')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Remove Provider A' }))
    expect(window.localStorage.getItem(PELICAN_STORAGE_KEY)).not.toContain(
      'secret-key'
    )
    expect(screen.getAllByLabelText('Base URL')).toHaveLength(1)
  })
  test('adds named keys, selects a discovery key, and preserves remaining fields after removal', async () => {
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
        new Response(JSON.stringify({ data: [{ id: 'discovered-model' }] }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const onStart = vi.fn()
    const user = userEvent.setup()
    render(
      <ConnectionForm isRunning={false} onStart={onStart} onStop={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Add API key' }))
    const second = within(screen.getByRole('group', { name: 'Key 2' }))
    await user.type(second.getByLabelText('Key name'), 'Account B')
    await user.type(second.getByLabelText('API Key'), 'key-b-secret')
    await user.selectOptions(
      screen.getByLabelText('Key for model discovery'),
      screen.getByRole<HTMLOptionElement>('option', { name: 'Account B' }).value
    )
    await user.click(screen.getByRole('button', { name: 'Fetch models' }))
    expect(await screen.findByText('discovered-model')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer key-b-secret',
        }),
      })
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove key Account A' })
    )
    expect(screen.getByLabelText('API Key')).toHaveValue('key-b-secret')
    expect(screen.getByLabelText('Models (one per line)')).toHaveValue(
      'model-a'
    )
    await user.click(screen.getByRole('button', { name: 'Start batch test' }))
    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith(
        expect.objectContaining({
          connections: [
            expect.objectContaining({
              credentials: [
                expect.objectContaining({
                  name: 'Account B',
                  apiKey: 'key-b-secret',
                  rememberKey: false,
                }),
              ],
            }),
          ],
        })
      )
    )
  })
})
