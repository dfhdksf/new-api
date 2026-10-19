/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import i18next from 'i18next'

import type {
  PelicanCredential,
  PelicanTestConfig,
  PelicanTestResult,
} from '../types'

export function getCredentialName(
  credential: Pick<PelicanCredential, 'name'>,
  index: number
): string {
  return (
    credential.name.trim() || i18next.t('Key {{number}}', { number: index + 1 })
  )
}

export function parseModels(modelsText: string): string[] {
  return [
    ...new Set(
      modelsText
        .split(/[\n,]/)
        .map((model) => model.trim())
        .filter(Boolean)
    ),
  ]
}

export function getBatchSize(config: PelicanTestConfig): number {
  const modelCount = config.connections
    .filter((connection) => connection.enabled)
    .reduce(
      (total, connection) =>
        total +
        parseModels(connection.modelsText).length *
          connection.credentials.filter((credential) => credential.enabled)
            .length,
      0
    )
  return modelCount * config.efforts.length * config.count
}

export function createBatchPlan(
  config: PelicanTestConfig
): PelicanTestResult[] {
  const requests: PelicanTestResult[] = []
  for (const connection of config.connections) {
    if (!connection.enabled) continue
    for (const [
      credentialIndex,
      credential,
    ] of connection.credentials.entries()) {
      if (!credential.enabled) continue
      for (const model of parseModels(connection.modelsText)) {
        for (const effort of config.efforts) {
          for (let runNumber = 1; runNumber <= config.count; runNumber += 1) {
            requests.push({
              id: requests.length,
              connectionId: connection.id,
              credentialId: credential.id,
              credentialName: getCredentialName(credential, credentialIndex),
              connectionName:
                connection.name.trim() || new URL(connection.baseUrl).host,
              baseUrl: connection.baseUrl,
              apiFormat: connection.apiFormat,
              transport: connection.transport,
              model,
              effort,
              runNumber,
              status: 'pending',
              content: '',
              svg: null,
              durationMs: null,
              totalTokens: null,
              error: null,
            })
          }
        }
      }
    }
  }
  // Place the same model and effort from different endpoints next to each other.
  return requests.sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      config.efforts.indexOf(a.effort) - config.efforts.indexOf(b.effort) ||
      a.runNumber - b.runNumber
  )
}
