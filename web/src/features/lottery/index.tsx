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
import { Gift } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import {
  LOTTERY_ACTIVITIES_QUERY_KEY,
  drawLottery,
  getLotteryActivities,
} from './api'
import { LotteryActivityCard } from './components/lottery-activity-card'
import { LotteryResultDialog } from './components/lottery-result-dialog'
import { useNowSeconds } from './hooks/use-now-seconds'
import type { LotteryDrawResult, UserLotteryActivity } from './types'

const REWARD_CODES_QUERY_KEY = ['reward-codes'] as const
const EMPTY_ACTIVITIES: UserLotteryActivity[] = []

export function Lottery() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<LotteryDrawResult | null>(null)

  const activitiesQuery = useQuery({
    queryKey: LOTTERY_ACTIVITIES_QUERY_KEY,
    queryFn: async () => {
      const response = await getLotteryActivities()
      if (!response.success) {
        throw createServerError(response, t('Failed to load lottery rounds'))
      }
      return response.data ?? []
    },
    meta: { errorToast: false },
  })
  const activities = activitiesQuery.data ?? EMPTY_ACTIVITIES

  // Tick only while a round is waiting to start or still open.
  const ticking = activities.some(
    (activity) =>
      !activity.my_draw &&
      (activity.state === 'upcoming' || activity.state === 'ongoing')
  )
  const nowSeconds = useNowSeconds(ticking)

  // Refetch once when an upcoming round reaches its start time.
  const refetchedStartsRef = useRef(new Set<number>())
  useEffect(() => {
    const started = activities.find(
      (activity) =>
        activity.state === 'upcoming' &&
        nowSeconds >= activity.start_time &&
        !refetchedStartsRef.current.has(activity.id)
    )
    if (!started) return
    refetchedStartsRef.current.add(started.id)
    void queryClient.invalidateQueries({
      queryKey: LOTTERY_ACTIVITIES_QUERY_KEY,
    })
  }, [activities, nowSeconds, queryClient])

  const drawMutation = useMutation({
    mutationFn: async (activity: UserLotteryActivity) => {
      const response = await drawLottery(activity.id)
      if (!response.success || !response.data) {
        throw createServerError(response, t('Draw failed, please try again'))
      }
      return response.data
    },
    onSuccess: (data) => {
      setResult(data)
      if (data.won) {
        void queryClient.invalidateQueries({
          queryKey: REWARD_CODES_QUERY_KEY,
        })
      }
    },
    onError: (error: Error) =>
      handleServerError(error, t('Draw failed, please try again')),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: LOTTERY_ACTIVITIES_QUERY_KEY,
      })
    },
  })

  let content: ReactNode
  if (activitiesQuery.isLoading) {
    content = (
      <div className='grid gap-4'>
        {['lottery-skeleton-a', 'lottery-skeleton-b'].map((key) => (
          <Skeleton key={key} className='h-56 rounded-xl' />
        ))}
      </div>
    )
  } else if (activitiesQuery.isError) {
    content = (
      <EmptyState
        icon={Gift}
        title={t('Failed to load lottery rounds')}
        description={getServerErrorMessage(
          activitiesQuery.error,
          t('Please try again later.')
        )}
      />
    )
  } else if (activities.length === 0) {
    content = (
      <EmptyState icon={Gift} title={t('No lottery rounds yet. Stay tuned!')} />
    )
  } else {
    content = (
      <div className='grid gap-4'>
        {activities.map((activity) => (
          <LotteryActivityCard
            key={activity.id}
            activity={activity}
            nowSeconds={nowSeconds}
            drawing={
              drawMutation.isPending &&
              drawMutation.variables?.id === activity.id
            }
            drawLocked={drawMutation.isPending}
            onDraw={(target) => drawMutation.mutate(target)}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Lottery')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-4xl flex-col gap-4'>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Every registered user can draw once per round. Results are instant, and prizes are redemption codes you can redeem or share.'
              )}
            </p>
            {content}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <LotteryResultDialog result={result} onClose={() => setResult(null)} />
    </>
  )
}
