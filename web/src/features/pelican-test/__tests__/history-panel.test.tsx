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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { describe, expect, test, vi } from 'vitest'

import { HistoryPanel } from '../components/history-panel'
import { createBatchPlan } from '../lib/batch-utils'
import { createHistoryEntry } from '../lib/history-storage'
import { exampleConfig } from './fixtures'

describe('Pelican history panel', () => {
  test('paginates recent batches and keeps view, rerun, and delete actions tied to the selected record', async () => {
    const entries = Array.from({ length: 6 }, () =>
      createHistoryEntry(exampleConfig, createBatchPlan(exampleConfig))
    )
    const onView = vi.fn()
    const onRerun = vi.fn()
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <HistoryPanel
        entries={entries}
        selectedId={null}
        isRunning={false}
        storageFailed={false}
        onView={onView}
        onRerun={onRerun}
        onDelete={onDelete}
      />
    )
    expect(screen.getAllByRole('article')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText('Interrupted')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View batch' }))
    await user.click(screen.getByRole('button', { name: 'Rerun batch' }))
    await user.click(screen.getByRole('button', { name: 'Delete batch' }))
    expect(onView).toHaveBeenCalledWith(entries[5])
    expect(onRerun).toHaveBeenCalledWith(entries[5])
    expect(onDelete).toHaveBeenCalledWith(entries[5].id)
  })

  test('protects the active batch from history actions and reports storage failures', () => {
    const entry = createHistoryEntry(
      exampleConfig,
      createBatchPlan(exampleConfig)
    )
    render(
      <HistoryPanel
        entries={[entry]}
        selectedId={null}
        isRunning
        storageFailed
        onView={vi.fn()}
        onRerun={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    const article = screen.getByRole('article')
    expect(within(article).getByText('Running')).toBeInTheDocument()
    for (const name of ['View batch', 'Rerun batch', 'Delete batch']) {
      expect(within(article).getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('alert')).toHaveTextContent(
      'History could not be saved.'
    )
  })
  test.each([
    ['zhCN', 'zh-CN'],
    ['zhTW', 'zh-TW'],
  ])(
    'formats saved dates with the %s interface language without crashing',
    async (language, locale) => {
      const entry = createHistoryEntry(
        exampleConfig,
        createBatchPlan(exampleConfig)
      )
      entry.startedAt = '2026-10-19T05:00:00.000Z'
      await i18next.changeLanguage(language)
      try {
        render(
          <HistoryPanel
            entries={[entry]}
            selectedId={null}
            isRunning={false}
            storageFailed={false}
            onView={vi.fn()}
            onRerun={vi.fn()}
            onDelete={vi.fn()}
          />
        )
        expect(
          screen.getByText(new Date(entry.startedAt).toLocaleString(locale), {
            normalizer: (text) => text,
          })
        ).toBeInTheDocument()
      } finally {
        await act(async () => {
          await i18next.changeLanguage('en')
        })
      }
    }
  )
})
