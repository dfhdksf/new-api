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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { ConfigurationLibrary } from '../components/configuration-library'
import {
  loadPelicanLibrary,
  savePelicanLibrary,
} from '../lib/configuration-library'
import { exampleConfig } from './fixtures'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

test('save, reload, load and delete a named configuration without submitting a batch', async () => {
  const user = userEvent.setup()
  const config = structuredClone(exampleConfig)
  config.connections[0].credentials[0].rememberKey = true
  const onLoad = vi.fn()
  const view = render(
    <ConfigurationLibrary
      disabled={false}
      getConfig={() => config}
      onLoad={onLoad}
    />
  )
  await user.type(screen.getByLabelText('Configuration name'), 'My sites')
  await user.click(screen.getByRole('button', { name: 'Save configuration' }))
  expect(screen.getByRole('status')).toHaveTextContent('Configuration saved.')
  view.unmount()
  render(
    <ConfigurationLibrary
      disabled={false}
      getConfig={() => exampleConfig}
      onLoad={onLoad}
    />
  )
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: 'My sites' }))
  await user.click(screen.getByRole('button', { name: 'Load configuration' }))
  expect(onLoad).toHaveBeenCalledWith(config)
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(loadPelicanLibrary()).toEqual([])
})

test('import rejects invalid data without replacing the current configuration', async () => {
  const onLoad = vi.fn()
  render(
    <ConfigurationLibrary
      disabled={false}
      getConfig={() => exampleConfig}
      onLoad={onLoad}
    />
  )
  const file = new File(['{broken'], 'invalid.json', {
    type: 'application/json',
  })
  Object.defineProperty(file, 'text', { value: async () => '{broken' })
  fireEvent.change(screen.getByLabelText('Import configuration'), {
    target: { files: [file] },
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not import')
  expect(onLoad).not.toHaveBeenCalled()
})

test('storage failures remain visible and do not claim that a configuration was saved', async () => {
  savePelicanLibrary([{ id: 'saved', name: 'Existing', config: exampleConfig }])
  const user = userEvent.setup()
  render(
    <ConfigurationLibrary
      disabled={false}
      getConfig={() => exampleConfig}
      onLoad={vi.fn()}
    />
  )
  await user.type(screen.getByLabelText('Configuration name'), 'New sites')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota')
  })
  await user.click(screen.getByRole('button', { name: 'Save configuration' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not save settings.'
    )
  )
  expect(loadPelicanLibrary().map((item) => item.name)).toEqual(['Existing'])
})
