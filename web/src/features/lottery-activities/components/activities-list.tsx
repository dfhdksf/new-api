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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Dices,
  Eye,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { queryErrorMessage, toastBusinessError } from '@/lib/mutation-errors'
import { getWinRatePercent } from '@/lib/reward-code'

import {
  LOTTERY_ADMIN_QUERY_KEY,
  deleteLotteryActivity,
  getAdminLotteryActivities,
  setLotteryActivityEnabled,
} from '../api'
import {
  getAdminActivityState,
  type LotteryActivityState,
} from '../lib/activity-form'
import type { LotteryActivity } from '../types'

const PAGE_SIZE = 10

const STATE_BADGES: Record<
  LotteryActivityState,
  { labelKey: string; variant: StatusVariant }
> = {
  disabled: { labelKey: 'Disabled', variant: 'neutral' },
  upcoming: { labelKey: 'Upcoming', variant: 'info' },
  ongoing: { labelKey: 'Ongoing', variant: 'success' },
  sold_out: { labelKey: 'Sold out', variant: 'warning' },
  ended: { labelKey: 'Ended', variant: 'neutral' },
}

interface ActivitiesListProps {
  onEdit: (activity: LotteryActivity) => void
  onViewDraws: (activity: LotteryActivity) => void
}

export function ActivitiesList(props: ActivitiesListProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState<LotteryActivity | null>(null)
  const nowSeconds = Math.floor(Date.now() / 1000)

  const activitiesQuery = useQuery({
    queryKey: [...LOTTERY_ADMIN_QUERY_KEY, page, PAGE_SIZE],
    queryFn: async () => {
      const response = await getAdminLotteryActivities(page, PAGE_SIZE)
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to load activities'))
      }
      return response.data
    },
    placeholderData: (previous) => previous,
  })

  const toggleMutation = useMutation({
    mutationFn: async (input: { id: number; enabled: boolean }) => {
      const response = await setLotteryActivityEnabled(input.id, input.enabled)
      if (!response.success) {
        throw new Error(response.message || t('Update failed'))
      }
      return input.enabled
    },
    onSuccess: async (enabled) => {
      toast.success(enabled ? t('Activity enabled') : t('Activity disabled'))
      await queryClient.invalidateQueries({ queryKey: LOTTERY_ADMIN_QUERY_KEY })
    },
    onError: (error: Error) => toastBusinessError(error, t('Update failed')),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await deleteLotteryActivity(id)
      if (!response.success) {
        throw new Error(response.message || t('Delete failed'))
      }
    },
    onSuccess: async () => {
      toast.success(t('Activity deleted'))
      setDeleteTarget(null)
      await queryClient.invalidateQueries({ queryKey: LOTTERY_ADMIN_QUERY_KEY })
    },
    onError: (error: Error) => toastBusinessError(error, t('Delete failed')),
  })

  const items = activitiesQuery.data?.items ?? []
  const total = activitiesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // A delete (here or by another admin) can leave the current page past the end.
  if (
    activitiesQuery.isSuccess &&
    !activitiesQuery.isPlaceholderData &&
    page > totalPages
  ) {
    setPage(totalPages)
  }

  let content: ReactNode
  if (activitiesQuery.isLoading) {
    content = (
      <div className='space-y-3'>
        {['admin-lottery-a', 'admin-lottery-b', 'admin-lottery-c'].map(
          (key) => (
            <Skeleton key={key} className='h-24 rounded-lg' />
          )
        )}
      </div>
    )
  } else if (activitiesQuery.isError) {
    content = (
      <EmptyState
        icon={Dices}
        title={t('Failed to load activities')}
        description={queryErrorMessage(
          activitiesQuery.error,
          t('Please try again later.')
        )}
      />
    )
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Dices}
        title={t('No lottery activities yet')}
        description={t('Create a round to let users draw prizes.')}
      />
    )
  } else {
    content = (
      <ul className='space-y-3'>
        {items.map((activity) => {
          const state = getAdminActivityState(activity, nowSeconds)
          const badge = STATE_BADGES[state]
          const usedSlots = activity.total_slots - activity.remaining_slots
          const awarded = activity.prize_slots - activity.remaining_prizes
          const winRate = getWinRatePercent(
            activity.prize_slots,
            activity.total_slots
          )
          const hasDraws = usedSlots > 0
          const togglePending =
            toggleMutation.isPending &&
            toggleMutation.variables?.id === activity.id
          return (
            <li
              key={activity.id}
              className='bg-card flex flex-col gap-3 rounded-lg border p-3 sm:p-4 lg:flex-row lg:items-center lg:gap-6'
            >
              <div className='min-w-0 flex-1 space-y-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='bg-primary/10 text-primary rounded-md px-2 py-0.5 text-xs font-semibold'>
                    {t('Round {{period}}', { period: activity.period })}
                  </span>
                  <span className='truncate font-medium'>{activity.name}</span>
                  <StatusBadge
                    label={t(badge.labelKey)}
                    variant={badge.variant}
                    copyable={false}
                    size='sm'
                  />
                </div>
                <div className='text-muted-foreground text-xs'>
                  {formatTimestampToDate(activity.start_time)} –{' '}
                  {formatTimestampToDate(activity.end_time)}
                </div>
                <div className='text-muted-foreground flex flex-wrap gap-1.5 text-xs'>
                  {activity.tiers.map((tier) => (
                    <span
                      key={tier.id}
                      className='bg-muted rounded px-1.5 py-0.5'
                    >
                      {formatQuota(tier.quota)} × {tier.count}
                    </span>
                  ))}
                </div>
              </div>
              <dl className='grid grid-cols-3 gap-3 text-sm lg:w-80'>
                <div>
                  <dt className='text-muted-foreground text-xs'>
                    {t('Slots used')}
                  </dt>
                  <dd className='font-semibold tabular-nums'>
                    {usedSlots} / {activity.total_slots}
                  </dd>
                </div>
                <div>
                  <dt className='text-muted-foreground text-xs'>
                    {t('Prizes awarded')}
                  </dt>
                  <dd className='font-semibold tabular-nums'>
                    {awarded} / {activity.prize_slots}
                  </dd>
                </div>
                <div>
                  <dt className='text-muted-foreground text-xs'>
                    {t('Win rate')}
                  </dt>
                  <dd className='font-semibold tabular-nums'>{winRate}%</dd>
                </div>
              </dl>
              <div className='flex items-center gap-1 self-end lg:self-center'>
                <Switch
                  checked={activity.enabled}
                  disabled={togglePending}
                  aria-label={activity.enabled ? t('Disable') : t('Enable')}
                  onCheckedChange={(enabled) =>
                    toggleMutation.mutate({ id: activity.id, enabled })
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label={t('View draws')}
                  onClick={() => props.onViewDraws(activity)}
                >
                  <Eye className='size-4' aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label={t('Edit')}
                  onClick={() => props.onEdit(activity)}
                >
                  <Pencil className='size-4' aria-hidden='true' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label={t('Delete')}
                  disabled={hasDraws}
                  title={
                    hasDraws
                      ? t('Rounds with draws cannot be deleted')
                      : undefined
                  }
                  onClick={() => setDeleteTarget(activity)}
                >
                  <Trash2 className='size-4' aria-hidden='true' />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {content}
      {total > PAGE_SIZE && (
        <div className='flex items-center justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='icon'
            className='size-8'
            aria-label={t('Previous page')}
            disabled={page <= 1 || activitiesQuery.isFetching}
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
            disabled={page >= totalPages || activitiesQuery.isFetching}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            <ChevronRight className='size-4' aria-hidden='true' />
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('Delete activity?')}
        desc={
          deleteTarget
            ? t(
                'Round {{period}} ({{name}}) will be deleted. This cannot be undone.',
                {
                  period: deleteTarget.period,
                  name: deleteTarget.name,
                }
              )
            : ''
        }
        destructive
        confirmText={t('Delete')}
        isLoading={deleteMutation.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
        }}
      />
    </div>
  )
}
