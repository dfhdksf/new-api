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
import type { RewardCodeStatus } from '@/lib/reward-code'

/** Server-computed state of a round at request time. */
export type LotteryState = 'upcoming' | 'ongoing' | 'sold_out' | 'ended'

export interface LotteryPrize {
  /** Prize tier id; tiers may share the same amount and count. */
  id: number
  /** Face value of one prize in quota units. */
  quota: number
  count: number
}

export interface LotteryMyDraw {
  won: boolean
  quota: number
  code?: string
  code_status?: RewardCodeStatus
  created_time: number
}

/** One round as seen by a user (GET /api/lottery/activities). */
export interface UserLotteryActivity {
  id: number
  period: number
  name: string
  description: string
  /** Unix seconds. */
  start_time: number
  /** Unix seconds. */
  end_time: number
  total_slots: number
  prize_slots: number
  remaining_slots: number
  state: LotteryState
  prizes: LotteryPrize[]
  my_draw: LotteryMyDraw | null
}

/** Result of POST /api/lottery/activities/:id/draw. */
export interface LotteryDrawResult {
  won: boolean
  quota: number
  code: string
  period: number
}

export interface ApiEnvelope<T> {
  success: boolean
  message?: string
  data?: T
}
