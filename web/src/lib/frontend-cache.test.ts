/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version).

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { afterEach, expect, test } from 'vitest'

import { initializeFrontendCache } from './frontend-cache'

afterEach(() => window.localStorage.clear())

test('cache version changes preserve Pelican settings, remembered keys and history', () => {
  window.localStorage.setItem('newapi:default:cache-version', 'older-version')
  window.localStorage.setItem(
    'new-api:pelican-test:connections:v1',
    'remembered-config'
  )
  window.localStorage.setItem(
    'new-api:pelican-test:library:v1',
    'named-configurations'
  )
  window.localStorage.setItem('new-api:pelican-test:history:v1', 'results')
  window.localStorage.setItem('user', 'signed-in-user')
  window.localStorage.setItem('obsolete-ui-cache', 'discard')

  initializeFrontendCache()

  expect(
    window.localStorage.getItem('new-api:pelican-test:connections:v1')
  ).toBe('remembered-config')
  expect(window.localStorage.getItem('new-api:pelican-test:library:v1')).toBe(
    'named-configurations'
  )
  expect(window.localStorage.getItem('new-api:pelican-test:history:v1')).toBe(
    'results'
  )
  expect(window.localStorage.getItem('user')).toBe('signed-in-user')
  expect(window.localStorage.getItem('obsolete-ui-cache')).toBeNull()
})
