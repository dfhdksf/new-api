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
export const REASONING_EFFORTS = [
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export type PelicanApiFormat = 'responses' | 'chat-completions'

export type PelicanTransport = 'server' | 'direct'

export type PelicanCredential = {
  id: string
  name: string
  enabled: boolean
  apiKey: string
  rememberKey: boolean
}

export type PelicanConnection = {
  id: string
  name: string
  enabled: boolean
  apiFormat: PelicanApiFormat
  transport: PelicanTransport
  baseUrl: string
  credentials: PelicanCredential[]
  modelsText: string
}

export type PelicanTestConfig = {
  connections: PelicanConnection[]
  efforts: ReasoningEffort[]
  count: number
  concurrency: number
}

export type PelicanTestResult = {
  id: number
  connectionId: string
  connectionName: string
  credentialId: string
  credentialName: string
  baseUrl: string
  apiFormat: PelicanApiFormat
  transport: PelicanTransport
  model: string
  effort: ReasoningEffort
  runNumber: number
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
  content: string
  svg: string | null
  firstTokenMs?: number | null
  durationMs: number | null
  totalTokens: number | null
  error: string | null
}

export type PelicanTestRequest = {
  apiFormat: PelicanApiFormat
  transport: PelicanTransport
  baseUrl: string
  apiKey: string
  model: string
  effort: ReasoningEffort
}

export type PelicanTestResponse = {
  content: string
  totalTokens: number | null
}

export type PelicanHistoryConfig = Omit<PelicanTestConfig, 'connections'> & {
  connections: (Omit<PelicanConnection, 'credentials'> & {
    credentials: Omit<PelicanCredential, 'apiKey' | 'rememberKey'>[]
  })[]
}

export type PelicanHistoryEntry = {
  id: string
  startedAt: string
  finishedAt: string | null
  prompt: string
  config: PelicanHistoryConfig
  results: PelicanTestResult[]
}

export type PelicanRerunRequest = {
  id: number
  config: PelicanHistoryConfig
}

export type PelicanStreamProgress = {
  content: string
  totalTokens: number | null
}
