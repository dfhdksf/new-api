/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RewardCodeValue } from '@/components/reward-code-value'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import { getLotteryDraws } from '../api'
import type { LotteryActivity } from '../types'

const PAGE_SIZE = 20

interface DrawsDialogProps {
  activity: LotteryActivity | null
  onClose: () => void
}

export function DrawsDialog(props: DrawsDialogProps) {
  const { t } = useTranslation()
  const activity = props.activity
  const [page, setPage] = useState(1)
  const [wonOnly, setWonOnly] = useState(false)
  // Reset paging when another activity is opened.
  const [shownActivityId, setShownActivityId] = useState<number | null>(null)
  if (activity && activity.id !== shownActivityId) {
    setShownActivityId(activity.id)
    setPage(1)
    setWonOnly(false)
  }

  const drawsQuery = useQuery({
    queryKey: ['lottery-admin-draws', activity?.id, page, wonOnly],
    queryFn: async () => {
      const response = await getLotteryDraws(
        activity?.id ?? 0,
        page,
        PAGE_SIZE,
        wonOnly
      )
      if (!response.success || !response.data) {
        throw createServerError(response, t('Failed to load draws'))
      }
      return response.data
    },
    enabled: activity !== null,
    meta: { errorToast: false },
    // Keep rows while paging or filtering the same round (and while closing),
    // but never show another round's draws under this round's title.
    placeholderData: (previous, previousQuery) =>
      activity === null || previousQuery?.queryKey[1] === activity.id
        ? previous
        : undefined,
  })
  const items = drawsQuery.data?.items ?? []
  const total = drawsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  let content: ReactNode
  if (drawsQuery.isLoading) {
    content = (
      <div className='space-y-2'>
        {['draws-skeleton-a', 'draws-skeleton-b', 'draws-skeleton-c'].map(
          (key) => (
            <Skeleton key={key} className='h-12 rounded-lg' />
          )
        )}
      </div>
    )
  } else if (drawsQuery.isError) {
    content = (
      <p className='text-destructive py-6 text-center text-sm'>
        {getServerErrorMessage(drawsQuery.error, t('Failed to load draws'))}
      </p>
    )
  } else if (items.length === 0) {
    content = (
      <p className='text-muted-foreground py-10 text-center text-sm'>
        {wonOnly ? t('No winners yet') : t('No one has drawn yet')}
      </p>
    )
  } else {
    content = (
      <ul className='divide-y rounded-lg border'>
        {items.map((draw) => (
          <li
            key={draw.id}
            className='grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] sm:items-center sm:gap-4'
          >
            <div className='min-w-0'>
              <div className='truncate text-sm font-medium'>
                {draw.username || t('Deleted user')}
                <span className='text-muted-foreground ml-1.5 text-xs'>
                  ID {draw.user_id > 0 ? draw.user_id : '-'}
                </span>
              </div>
              <div className='text-muted-foreground text-xs'>
                {formatTimestampToDate(draw.created_time)}
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <StatusBadge
                label={draw.won ? t('Won') : t('Not won')}
                variant={draw.won ? 'success' : 'neutral'}
                copyable={false}
                size='sm'
              />
              {draw.won && (
                <span className='text-sm font-semibold tabular-nums'>
                  {formatQuota(draw.quota)}
                </span>
              )}
            </div>
            <div className='min-w-0'>
              {draw.code && (
                <RewardCodeValue code={draw.code} status={draw.code_status} />
              )}
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Dialog
      open={activity !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Draw records')}
      description={
        activity
          ? `${t('Round {{period}}', { period: activity.period })} · ${activity.name}`
          : undefined
      }
      contentClassName='sm:max-w-3xl'
    >
      <div className='flex flex-col gap-3'>
        <label className='flex items-center gap-2 self-end text-sm'>
          <Switch
            checked={wonOnly}
            onCheckedChange={(checked) => {
              setWonOnly(checked)
              setPage(1)
            }}
          />
          {t('Winners only')}
        </label>
        <div className='max-h-[min(60vh,560px)] overflow-y-auto'>{content}</div>
        {total > PAGE_SIZE && (
          <div className='flex items-center justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-8'
              aria-label={t('Previous page')}
              disabled={page <= 1 || drawsQuery.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className='size-4' aria-hidden='true' />
            </Button>
            <span className='text-muted-foreground text-sm tabular-nums'>
              {t('Page {{page}} of {{total}}', { page, total: totalPages })}
            </span>
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-8'
              aria-label={t('Next page')}
              disabled={page >= totalPages || drawsQuery.isFetching}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
            >
              <ChevronRight className='size-4' aria-hidden='true' />
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
