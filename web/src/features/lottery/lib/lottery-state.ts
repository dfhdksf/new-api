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
import type { LotteryState, UserLotteryActivity } from '../types'

/** What the action area of a round shows for the current user. */
export type LotteryAction =
  | { kind: 'won'; quota: number; code?: string }
  | { kind: 'lost' }
  | { kind: 'upcoming'; secondsLeft: number }
  | { kind: 'sold_out' }
  | { kind: 'ended' }
  | { kind: 'draw' }

type LotteryTiming = Pick<
  UserLotteryActivity,
  'state' | 'start_time' | 'end_time' | 'remaining_slots'
>

/**
 * Phase of a round at nowSeconds, mirroring the server's rule (upcoming, then
 * sold out, then ended). The live clock lets countdowns and end times flip
 * without a refetch; sold out comes from the server's remaining slots.
 */
export function getLotteryPhase(
  activity: LotteryTiming,
  nowSeconds: number
): LotteryState {
  if (nowSeconds < activity.start_time) return 'upcoming'
  if (activity.state === 'sold_out' || activity.remaining_slots <= 0) {
    return 'sold_out'
  }
  if (activity.state === 'ended' || nowSeconds >= activity.end_time) {
    return 'ended'
  }
  return 'ongoing'
}

/** Derives the action area of a round; the user's own result always wins. */
export function getLotteryAction(
  activity: LotteryTiming & Pick<UserLotteryActivity, 'my_draw'>,
  nowSeconds: number
): LotteryAction {
  if (activity.my_draw) {
    return activity.my_draw.won
      ? {
          kind: 'won',
          quota: activity.my_draw.quota,
          code: activity.my_draw.code,
        }
      : { kind: 'lost' }
  }
  const phase = getLotteryPhase(activity, nowSeconds)
  if (phase === 'upcoming') {
    return { kind: 'upcoming', secondsLeft: activity.start_time - nowSeconds }
  }
  if (phase === 'ongoing') return { kind: 'draw' }
  return { kind: phase }
}

export { getWinRatePercent } from '@/lib/reward-code'

/** Splits a countdown into whole days and an HH:MM:SS clock for the rest. */
export function splitCountdown(totalSeconds: number): {
  days: number
  clock: string
} {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return { days, clock: `${pad(hours)}:${pad(minutes)}:${pad(secs)}` }
}
