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
import type { PelicanConnection, PelicanTestConfig } from '../types'

export const exampleConnection: PelicanConnection = {
  id: 'provider-a',
  name: 'Provider A',
  enabled: true,
  apiFormat: 'responses',
  transport: 'direct',
  baseUrl: 'https://api.example.com/v1',
  credentials: [
    {
      id: 'key-a',
      name: 'Account A',
      enabled: true,
      apiKey: 'secret-key',
      rememberKey: false,
    },
  ],
  modelsText: 'model-a',
}
export const exampleConfig: PelicanTestConfig = {
  connections: [exampleConnection],
  efforts: ['auto'],
  count: 1,
  concurrency: 2,
}
