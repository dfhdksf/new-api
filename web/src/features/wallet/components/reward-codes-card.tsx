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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Gift } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { RewardCodeValue } from '@/components/reward-code-value'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { rewardCodeSourceLabel } from '@/lib/reward-code'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

import { getUserRewardCodes } from '../api'
import { REWARD_CODES_PAGE_SIZE, REWARD_CODES_QUERY_KEY } from '../constants'

interface RewardCodesCardProps {
  /** Redeems a code into the current wallet; resolves true on success. */
  onRedeem: (code: string) => Promise<boolean>
  /** False when redemption is unavailable (payment compliance not confirmed). */
  redemptionEnabled: boolean
}

export function RewardCodesCard(props: RewardCodesCardProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [redeemingCode, setRedeemingCode] = useState<string | null>(null)

  const codesQuery = useQuery({
    queryKey: [...REWARD_CODES_QUERY_KEY, page, REWARD_CODES_PAGE_SIZE],
    queryFn: async () => {
      const response = await getUserRewardCodes(page, REWARD_CODES_PAGE_SIZE)
      if (!response.success || !response.data) {
        throw createServerError(response, t('Failed to load codes'))
      }
      return response.data
    },
    placeholderData: (previous) => previous,
    meta: { errorToast: false },
  })

  const items = codesQuery.data?.items ?? []
  const total = codesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / REWARD_CODES_PAGE_SIZE))
  if (
    codesQuery.isSuccess &&
    !codesQuery.isPlaceholderData &&
    page > totalPages
  ) {
    setPage(totalPages)
  }

  const handleRedeem = async (code: string) => {
    if (redeemingCode) return
    setRedeemingCode(code)
    try {
      const redeemed = await props.onRedeem(code)
      if (redeemed) {
        await queryClient.invalidateQueries({
          queryKey: REWARD_CODES_QUERY_KEY,
        })
      }
    } finally {
      setRedeemingCode(null)
    }
  }

  let content: ReactNode
  if (codesQuery.isLoading) {
    content = (
      <div className='space-y-2'>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton
            key={`reward-code-skeleton-${index}`}
            className='h-16 rounded-lg'
          />
        ))}
      </div>
    )
  } else if (codesQuery.isError) {
    content = (
      <EmptyState
        icon={Gift}
        title={t('Failed to load codes')}
        description={getServerErrorMessage(
          codesQuery.error,
          t('Please try again later.')
        )}
        className='min-h-[160px]'
      />
    )
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Gift}
        title={t('No codes yet')}
        description={t(
          'Codes from top-up gifts and lottery prizes will appear here.'
        )}
        className='min-h-[160px]'
      />
    )
  } else {
    content = (
      <ul className='divide-y rounded-lg border'>
        {items.map((reward) => (
          <li
            key={reward.id}
            className='flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4'
          >
            <div className='min-w-0 sm:w-56'>
              <div className='truncate text-sm font-medium'>
                {rewardCodeSourceLabel(reward, t)}
              </div>
              <div className='text-muted-foreground text-xs'>
                {formatTimestampToDate(reward.created_time)}
              </div>
            </div>
            <div className='text-sm font-semibold tabular-nums sm:w-28'>
              {formatQuota(reward.quota)}
            </div>
            <div className='min-w-0 flex-1'>
              <RewardCodeValue code={reward.code} status={reward.status} />
            </div>
            {reward.status === 'unused' && props.redemptionEnabled && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='shrink-0'
                disabled={redeemingCode !== null}
                onClick={() => handleRedeem(reward.code)}
              >
                {redeemingCode === reward.code
                  ? t('Redeeming...')
                  : t('Redeem')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <TitledCard
      title={t('My Codes')}
      description={t(
        'Top-up gifts and lottery prizes. Codes never expire and can be redeemed by anyone you share them with.'
      )}
      icon={<Gift aria-hidden='true' />}
      iconTone='chart-4'
      disableHoverEffect
      contentClassName='p-3 sm:p-5'
    >
      {content}
      {total > REWARD_CODES_PAGE_SIZE && (
        <div className='mt-3 flex items-center justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='icon'
            className='size-8'
            aria-label={t('Previous page')}
            disabled={page <= 1 || codesQuery.isFetching}
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
            disabled={page >= totalPages || codesQuery.isFetching}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            <ChevronRight className='size-4' aria-hidden='true' />
          </Button>
        </div>
      )}
    </TitledCard>
  )
}
