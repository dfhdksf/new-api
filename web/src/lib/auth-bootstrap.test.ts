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
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

import { bootstrapAuthentication } from './auth-session'

const { sendRefresh } = vi.hoisted(() => ({ sendRefresh: vi.fn() }))

// Keep the real Axios client and authentication code; replace only transport.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: Parameters<typeof actual.default.create>[0]) =>
        actual.default.create({ ...config, adapter: sendRefresh }),
    },
  }
})

const bundle: AuthBundle = {
  access_token: 'restored-access-token',
  token_type: 'Bearer',
  access_expires_at: Math.floor(Date.now() / 1000) + 600,
  user: { id: 42, username: 'test-user', role: 1 },
  session: {
    sid: 'bootstrap-session',
    current: true,
    login_method: 'password',
    ip: '192.0.2.201',
    user_agent: 'test',
    created_at: 100,
    last_active_at: 100,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  },
}

beforeEach(() => {
  sendRefresh.mockReset()
  useAuthStore.getState().auth.reset('idle')
})

afterEach(() => {
  useAuthStore.getState().auth.reset('idle')
})

describe('authentication bootstrap during page reload', () => {
  test.each([
    { status: 429, hasSession: false },
    { status: 503, hasSession: false },
    { status: 429, hasSession: true },
    { status: 503, hasSession: true },
  ])(
    'blocks protected navigation on $status with cached session=$hasSession and recovers on retry',
    async ({ status, hasSession }) => {
      if (hasSession) {
        useAuthStore.getState().auth.setBundle({
          ...bundle,
          access_expires_at: Math.floor(Date.now() / 1000) - 1,
        })
      }
      const failure = new AxiosError('Temporary refresh failure')
      sendRefresh.mockImplementationOnce(async (config) => {
        failure.response = {
          data: {},
          status,
          statusText: 'Temporary refresh failure',
          headers: { 'retry-after': '60' },
          config,
        }
        throw failure
      })

      // A rejected beforeLoad stops child guards from treating a temporary
      // refresh failure as a confirmed anonymous session and redirecting.
      await expect(bootstrapAuthentication()).rejects.toBe(failure)
      expect(useAuthStore.getState().auth.bootstrapState).toBe('idle')
      expect(useAuthStore.getState().auth.user).toEqual(
        hasSession ? bundle.user : null
      )

      sendRefresh.mockImplementationOnce(async (config) => ({
        data: { success: true, data: bundle },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }))
      await expect(bootstrapAuthentication()).resolves.toEqual({
        kind: 'authenticated',
        bundle,
      })
      expect(useAuthStore.getState().auth.user).toEqual(bundle.user)
      expect(useAuthStore.getState().auth.bootstrapState).toBe('complete')
    }
  )
})
