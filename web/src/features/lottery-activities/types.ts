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

export interface LotteryPrizeTier {
  id: number
  activity_id: number
  /** Face value of one prize in quota units. */
  quota: number
  count: number
  remaining: number
}

/** A lottery round as managed by admins. Times are unix seconds. */
export interface LotteryActivity {
  id: number
  period: number
  name: string
  description: string
  start_time: number
  end_time: number
  enabled: boolean
  total_slots: number
  prize_slots: number
  remaining_slots: number
  remaining_prizes: number
  created_time: number
  updated_time: number
  tiers: LotteryPrizeTier[]
}

/** Body of POST and PUT /api/lottery/admin/activities. */
export interface LotteryActivityPayload {
  /** 0 lets the server assign the next round number (create only). */
  period: number
  name: string
  description: string
  start_time: number
  end_time: number
  enabled: boolean
  total_slots: number
  tiers: Array<{ quota: number; count: number }>
}

export interface LotteryDrawRecord {
  id: number
  activity_id: number
  user_id: number
  username: string
  won: boolean
  tier_id: number
  quota: number
  created_time: number
  code?: string
  code_status?: RewardCodeStatus
}

export interface PageData<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}

export interface ApiEnvelope<T> {
  success: boolean
  message?: string
  data?: T
}
