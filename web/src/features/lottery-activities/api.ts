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
  LotteryActivity,
  LotteryActivityPayload,
  LotteryDrawRecord,
  PageData,
} from './types'

export const LOTTERY_ADMIN_QUERY_KEY = ['lottery-admin-activities'] as const

// Writes pass skipBusinessError: callers turn success:false into one toast.
const businessErrorsHandledByCaller = { skipBusinessError: true }

export async function getAdminLotteryActivities(
  page: number,
  pageSize: number
): Promise<ApiEnvelope<PageData<LotteryActivity>>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  const res = await api.get(
    `/api/lottery/admin/activities?${params.toString()}`
  )
  return res.data
}

export async function createLotteryActivity(
  payload: LotteryActivityPayload
): Promise<ApiEnvelope<LotteryActivity>> {
  const res = await api.post(
    '/api/lottery/admin/activities',
    payload,
    businessErrorsHandledByCaller
  )
  return res.data
}

export async function updateLotteryActivity(
  id: number,
  payload: LotteryActivityPayload
): Promise<ApiEnvelope<null>> {
  const res = await api.put(
    `/api/lottery/admin/activities/${id}`,
    payload,
    businessErrorsHandledByCaller
  )
  return res.data
}

export async function setLotteryActivityEnabled(
  id: number,
  enabled: boolean
): Promise<ApiEnvelope<null>> {
  const res = await api.patch(
    `/api/lottery/admin/activities/${id}`,
    { enabled },
    businessErrorsHandledByCaller
  )
  return res.data
}

export async function deleteLotteryActivity(
  id: number
): Promise<ApiEnvelope<null>> {
  const res = await api.delete(
    `/api/lottery/admin/activities/${id}`,
    businessErrorsHandledByCaller
  )
  return res.data
}

export async function getLotteryDraws(
  id: number,
  page: number,
  pageSize: number,
  wonOnly: boolean
): Promise<ApiEnvelope<PageData<LotteryDrawRecord>>> {
  const params = new URLSearchParams({
    p: page.toString(),
    page_size: pageSize.toString(),
  })
  if (wonOnly) {
    params.append('won', 'true')
  }
  const res = await api.get(
    `/api/lottery/admin/activities/${id}/draws?${params.toString()}`
  )
  return res.data
}
