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
import { Clock, Gift, Loader2, PartyPopper, Ticket } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { RewardCodeValue } from '@/components/reward-code-value'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import {
  splitCountdown,
  getLotteryAction,
  getLotteryPhase,
  getWinRatePercent,
} from '../lib/lottery-state'
import type { LotteryState, UserLotteryActivity } from '../types'

const PHASE_BADGES: Record<
  LotteryState,
  { labelKey: string; variant: StatusVariant }
> = {
  upcoming: { labelKey: 'Upcoming', variant: 'info' },
  ongoing: { labelKey: 'Ongoing', variant: 'success' },
  sold_out: { labelKey: 'Sold out', variant: 'warning' },
  ended: { labelKey: 'Ended', variant: 'neutral' },
}

interface LotteryActivityCardProps {
  activity: UserLotteryActivity
  nowSeconds: number
  drawing: boolean
  /** True while any draw request is in flight, to block double submits. */
  drawLocked: boolean
  onDraw: (activity: UserLotteryActivity) => void
}

export function LotteryActivityCard(props: LotteryActivityCardProps) {
  const { t } = useTranslation()
  const { activity } = props
  const phase = getLotteryPhase(activity, props.nowSeconds)
  const action = getLotteryAction(activity, props.nowSeconds)
  const badge = PHASE_BADGES[phase]
  let countdown = ''
  if (action.kind === 'upcoming') {
    const { days, clock } = splitCountdown(action.secondsLeft)
    countdown =
      days > 0 ? t('{{days}}d {{time}}', { days, time: clock }) : clock
  }
  const usedSlots = activity.total_slots - activity.remaining_slots
  const usedPercent =
    activity.total_slots > 0 ? (usedSlots / activity.total_slots) * 100 : 0

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='flex flex-col gap-4 p-4 sm:p-5'>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='min-w-0 space-y-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='bg-primary/10 text-primary rounded-md px-2 py-0.5 text-xs font-semibold'>
                {t('Round {{period}}', { period: activity.period })}
              </span>
              <h3 className='truncate text-base font-semibold'>
                {activity.name}
              </h3>
            </div>
            <p className='text-muted-foreground flex items-center gap-1 text-xs'>
              <Clock className='size-3.5' aria-hidden='true' />
              {formatTimestampToDate(activity.start_time)} –{' '}
              {formatTimestampToDate(activity.end_time)}
            </p>
          </div>
          <StatusBadge
            label={t(badge.labelKey)}
            variant={badge.variant}
            copyable={false}
          />
        </div>

        {activity.description && (
          <p className='text-muted-foreground text-sm whitespace-pre-line'>
            {activity.description}
          </p>
        )}

        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Prizes')}
            </div>
            <ul className='flex flex-wrap gap-1.5'>
              {activity.prizes.map((prize) => (
                <li
                  key={prize.id}
                  className='bg-muted flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium'
                >
                  <Gift className='size-3' aria-hidden='true' />
                  {formatQuota(prize.quota)} × {prize.count}
                </li>
              ))}
            </ul>
          </div>
          <div className='space-y-1.5'>
            <div className='text-muted-foreground flex justify-between text-xs font-medium'>
              <span>
                {t('Win rate {{rate}}%', {
                  rate: getWinRatePercent(
                    activity.prize_slots,
                    activity.total_slots
                  ),
                })}
              </span>
              <span className='tabular-nums'>
                {t('{{remaining}} of {{total}} slots left', {
                  remaining: activity.remaining_slots,
                  total: activity.total_slots,
                })}
              </span>
            </div>
            <Progress
              value={usedPercent}
              aria-label={t('{{remaining}} of {{total}} slots left', {
                remaining: activity.remaining_slots,
                total: activity.total_slots,
              })}
            />
          </div>
        </div>

        <div className='border-t pt-4'>
          {action.kind === 'won' && (
            <div className='space-y-2'>
              <p className='flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400'>
                <PartyPopper className='size-4' aria-hidden='true' />
                {t('You won {{amount}}!', {
                  amount: formatQuota(action.quota),
                })}
              </p>
              {action.code && (
                <RewardCodeValue
                  code={action.code}
                  status={activity.my_draw?.code_status}
                />
              )}
            </div>
          )}
          {action.kind === 'lost' && (
            <p className='text-muted-foreground text-sm'>
              {t('So close! Better luck next round～')}
            </p>
          )}
          {action.kind === 'upcoming' && (
            <Button type='button' disabled className='w-full sm:w-auto'>
              <Clock className='size-4' aria-hidden='true' />
              {t('Starts in {{time}}', {
                time: countdown,
              })}
            </Button>
          )}
          {action.kind === 'sold_out' && (
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3'>
              <Button type='button' disabled className='w-full sm:w-auto'>
                {t('No slots left')}
              </Button>
              <p className='text-muted-foreground text-sm'>
                {t('All slots for this round are taken. See you next time!')}
              </p>
            </div>
          )}
          {action.kind === 'ended' && (
            <Button type='button' disabled className='w-full sm:w-auto'>
              {t('This round has ended')}
            </Button>
          )}
          {action.kind === 'draw' && (
            <Button
              type='button'
              className='w-full sm:w-auto'
              disabled={props.drawLocked}
              onClick={() => props.onDraw(activity)}
            >
              {props.drawing ? (
                <Loader2 className='size-4 animate-spin' aria-hidden='true' />
              ) : (
                <Ticket className='size-4' aria-hidden='true' />
              )}
              {props.drawing ? t('Drawing...') : t('Draw now')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
