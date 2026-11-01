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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test } from 'vitest'

import { api } from '@/lib/api'

import type { LotteryActivity } from '../../types'
import { DrawsDialog } from '../draws-dialog'

type MockableApi = { get: (url: string) => Promise<{ data: unknown }> }
const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get

afterEach(() => {
  apiClient.get = originalGet
})

function activity(id: number, period: number): LotteryActivity {
  return {
    id,
    period,
    name: `round-${period}`,
    description: '',
    start_time: 1,
    end_time: 2,
    enabled: true,
    total_slots: 10,
    prize_slots: 1,
    remaining_slots: 9,
    remaining_prizes: 0,
    created_time: 1,
    updated_time: 1,
    tiers: [],
  }
}

function page(username: string) {
  return {
    data: {
      success: true,
      data: {
        page: 1,
        page_size: 20,
        total: 1,
        items: [
          {
            id: 1,
            activity_id: 1,
            user_id: 7,
            username,
            won: true,
            tier_id: 1,
            quota: 500_000,
            created_time: 1,
          },
        ],
      },
    },
  }
}

function withClient(client: QueryClient, node: ReactNode) {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

describe('DrawsDialog', () => {
  test('switching rounds never shows the previous round draws', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let releaseRoundTwo: (() => void) | undefined
    apiClient.get = (url: string) => {
      if (url.includes('/activities/1/')) {
        return Promise.resolve(page('round_one_winner'))
      }
      return new Promise((resolve) => {
        releaseRoundTwo = () => resolve(page('round_two_winner'))
      })
    }

    const view = render(
      withClient(
        client,
        <DrawsDialog activity={activity(1, 1)} onClose={() => {}} />
      )
    )
    expect(await screen.findByText('round_one_winner')).toBeInTheDocument()

    view.rerender(
      withClient(
        client,
        <DrawsDialog activity={activity(2, 2)} onClose={() => {}} />
      )
    )
    await waitFor(() => expect(releaseRoundTwo).toBeDefined())
    expect(screen.queryByText('round_one_winner')).not.toBeInTheDocument()

    releaseRoundTwo?.()
    expect(await screen.findByText('round_two_winner')).toBeInTheDocument()
  })
})
