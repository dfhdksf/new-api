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
import { History, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'

import { MAX_HISTORY_ENTRIES } from '../lib/history-storage'
import type { PelicanHistoryEntry } from '../types'

type HistoryPanelProps = {
  entries: PelicanHistoryEntry[]
  selectedId: string | null
  isRunning: boolean
  storageFailed: boolean
  onView: (entry: PelicanHistoryEntry) => void
  onRerun: (entry: PelicanHistoryEntry) => void
  onDelete: (id: string) => void
}

export function HistoryPanel({
  entries,
  selectedId,
  isRunning,
  storageFailed,
  onView,
  onRerun,
  onDelete,
}: HistoryPanelProps) {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(0)
  const lastPage = Math.max(0, Math.ceil(entries.length / 5) - 1)
  const activePage = Math.min(page, lastPage)

  return (
    <Card
      id='pelican-history'
      className='scroll-mt-6'
      role='region'
      aria-label={t('Test history')}
    >
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <History className='size-4' aria-hidden='true' />
          {t('Test history')}
        </CardTitle>
        <CardDescription>
          {t(
            'Automatically saved in this browser, up to {{count}} recent batches within the storage limit. History does not store API keys.',
            { count: MAX_HISTORY_ENTRIES }
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {storageFailed && (
          <p role='alert' className='text-destructive text-sm'>
            {t(
              'History could not be saved. Browser storage may be full or unavailable; keep this page open to retain the current results.'
            )}
          </p>
        )}
        {entries.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No test history yet.')}
          </p>
        )}
        {entries.slice(activePage * 5, (activePage + 1) * 5).map((entry) => {
          const successes = entry.results.filter(
            (result) => result.status === 'success'
          ).length
          const failures = entry.results.filter(
            (result) => result.status === 'error'
          ).length
          const models = [
            ...new Set(entry.results.map((result) => result.model)),
          ].join(', ')
          const connectionNames = entry.config.connections
            .map((connection) => connection.name || connection.baseUrl)
            .join(' · ')
          let status = t('Completed')
          if (entry.results.some((result) => result.status === 'cancelled')) {
            status = t('Cancelled')
          }
          if (!entry.finishedAt) {
            status =
              isRunning && activePage === 0 && entry.id === entries[0].id
                ? t('Running')
                : t('Interrupted')
          }
          return (
            <article
              key={entry.id}
              className={`flex min-w-0 flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center ${selectedId === entry.id ? 'border-primary bg-primary/5' : 'border-border/70'}`}
            >
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <time
                    dateTime={entry.startedAt}
                    className='text-sm font-medium'
                  >
                    {new Date(entry.startedAt).toLocaleString(
                      toIntlLocale(i18n.language)
                    )}
                  </time>
                  <Badge variant='outline'>{status}</Badge>
                </div>
                <p className='mt-1 truncate text-sm' title={connectionNames}>
                  {connectionNames}
                </p>
                <p
                  className='text-muted-foreground mt-1 truncate font-mono text-xs'
                  title={models}
                >
                  {models} · {entry.config.efforts.join(', ')}
                </p>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('{{count}} requests', { count: entry.results.length })} ·{' '}
                  {t('{{count}} succeeded', { count: successes })} ·{' '}
                  {t('{{count}} failed', { count: failures })}
                </p>
              </div>
              <div className='flex shrink-0 flex-wrap gap-2'>
                <Button
                  type='button'
                  variant={selectedId === entry.id ? 'secondary' : 'outline'}
                  size='sm'
                  disabled={isRunning}
                  aria-label={t('View batch')}
                  onClick={() => onView(entry)}
                >
                  {t('View')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={isRunning}
                  aria-label={t('Rerun batch')}
                  onClick={() => onRerun(entry)}
                >
                  <Play className='size-3.5' aria-hidden='true' />
                  {t('Rerun')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={isRunning}
                  aria-label={t('Delete batch')}
                  onClick={() => onDelete(entry.id)}
                >
                  <Trash2 className='size-3.5' aria-hidden='true' />
                  <span className='sr-only'>{t('Delete batch')}</span>
                </Button>
              </div>
            </article>
          )
        })}
        {lastPage > 0 && (
          <div className='flex items-center justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              {t('Previous')}
            </Button>
            <span className='text-muted-foreground text-xs'>
              {activePage + 1} / {lastPage + 1}
            </span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={activePage === lastPage}
              onClick={() => setPage(activePage + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
