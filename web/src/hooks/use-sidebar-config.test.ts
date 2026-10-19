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
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  parseSidebarModulesAdmin,
  serializeSidebarModulesAdmin,
} from '@/features/system-settings/maintenance/config'

import { useSidebarConfig } from './use-sidebar-config'
import { useSidebarData } from './use-sidebar-data'

const state = vi.hoisted(() => ({
  adminConfig: '',
  userConfig: '',
  canConfigure: true,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { SidebarModulesAdmin: state.adminConfig } }),
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    auth: {
      user: {
        sidebar_modules: state.userConfig,
        permissions: { sidebar_settings: state.canConfigure },
      },
    },
  }),
}))

describe('Pelican Test sidebar entries', () => {
  beforeEach(() => {
    state.adminConfig = ''
    state.userConfig = ''
    state.canConfigure = true
  })

  it.each([
    {
      name: 'defaults show both entries',
      admin: {},
      user: {},
      expected: ['chat', 'admin'],
    },
    {
      name: 'legacy settings gain the admin entry',
      admin: {
        chat: { enabled: true, pelicanTest: false },
        admin: { enabled: true },
      },
      user: {},
      expected: ['admin'],
    },
    {
      name: 'the admin switch only hides the admin entry',
      admin: { admin: { enabled: true, pelicanTest: false } },
      user: {},
      expected: ['chat'],
    },
    {
      name: 'disabling the chat section preserves the admin entry',
      admin: { chat: { enabled: false } },
      user: {},
      expected: ['admin'],
    },
    {
      name: 'disabling the admin section preserves the chat entry',
      admin: { admin: { enabled: false } },
      user: {},
      expected: ['chat'],
    },
    {
      name: 'user preferences can independently hide the admin entry',
      admin: {},
      user: { admin: { enabled: true, pelicanTest: false } },
      expected: ['chat'],
    },
    {
      name: 'user preferences cannot restore an entry disabled by the administrator',
      admin: { admin: { enabled: true, pelicanTest: false } },
      user: { admin: { enabled: true, pelicanTest: true } },
      expected: ['chat'],
    },
  ])('$name', ({ admin, user, expected }) => {
    // Exercise the same default merge and serialization used by the settings form.
    state.adminConfig = serializeSidebarModulesAdmin(
      parseSidebarModulesAdmin(JSON.stringify(admin))
    )
    state.userConfig = JSON.stringify(user)

    const { result } = renderHook(() => {
      const { navGroups } = useSidebarData()
      return useSidebarConfig(navGroups)
    })

    expect(
      result.current
        .filter((group) =>
          group.items.some((item) => item.url === '/pelican-test')
        )
        .map((group) => group.id)
    ).toEqual(expected)
  })

  it('ignores stale user preferences when sidebar customization is disabled', () => {
    state.canConfigure = false
    state.userConfig = JSON.stringify({ admin: { enabled: false } })

    const { result } = renderHook(() => {
      const { navGroups } = useSidebarData()
      return useSidebarConfig(navGroups)
    })

    expect(
      result.current
        .find((group) => group.id === 'admin')
        ?.items.some((item) => item.url === '/pelican-test')
    ).toBe(true)
  })
})
