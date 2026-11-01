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
import { api } from '@/lib/api'

import type {
  ApiEnvelope,
  LotteryDrawResult,
  UserLotteryActivity,
} from './types'

export const LOTTERY_ACTIVITIES_QUERY_KEY = ['lottery-activities'] as const

export async function getLotteryActivities(): Promise<
  ApiEnvelope<UserLotteryActivity[]>
> {
  const res = await api.get('/api/lottery/activities')
  return res.data
}

/**
 * Draws once in a round. Business failures (sold out, already drawn, ...) are
 * returned as success:false and toasted by the caller, so the interceptor's
 * generic toast is skipped.
 */
export async function drawLottery(
  activityId: number
): Promise<ApiEnvelope<LotteryDrawResult>> {
  const res = await api.post(
    `/api/lottery/activities/${activityId}/draw`,
    undefined,
    { skipBusinessError: true }
  )
  return res.data
}
