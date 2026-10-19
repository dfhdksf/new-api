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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { runPelicanTestRequest } from '../api'
import { createBatchPlan } from '../lib/batch-utils'
import { getPelicanTestConfigSchema } from '../lib/config-schema'
import { createHistoryEntry } from '../lib/history-storage'
import { extractSvg } from '../lib/svg-utils'
import type {
  PelicanHistoryEntry,
  PelicanTestConfig,
  PelicanTestResult,
} from '../types'

export function usePelicanTestRunner(
  onBatchChange?: (entry: PelicanHistoryEntry) => void
) {
  const { t } = useTranslation()
  const [results, setResults] = useState<PelicanTestResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortControllerRef.current?.abort()
    }
  }, [])

  const start = async (config: PelicanTestConfig) => {
    if (abortControllerRef.current) return
    const parsed = getPelicanTestConfigSchema(t).safeParse(config)
    if (!parsed.success) return
    const connections = new Map(
      config.connections.map((connection) => [
        connection.id,
        {
          ...connection,
          credentials: connection.credentials.map((credential) => ({
            ...credential,
          })),
        },
      ])
    )
    const plan = createBatchPlan(config)
    const entry = createHistoryEntry(config, plan)
    onBatchChange?.(entry)
    const updateResult = (id: number, update: Partial<PelicanTestResult>) => {
      const index = plan.findIndex((result) => result.id === id)
      if (index === -1) return
      plan[index] = { ...plan[index], ...update }
      if (mountedRef.current) setResults([...plan])
      if (update.status !== 'running') {
        onBatchChange?.({ ...entry, results: [...plan] })
      }
    }
    const controller = new AbortController()
    abortControllerRef.current = controller
    setResults(plan)
    setIsRunning(true)
    let nextIndex = 0

    const worker = async () => {
      while (!controller.signal.aborted) {
        const resultIndex = nextIndex
        nextIndex += 1
        if (resultIndex >= plan.length) return

        const result = plan[resultIndex]
        const connection = connections.get(result.connectionId)
        const credential = connection?.credentials.find(
          (candidate) => candidate.id === result.credentialId
        )
        if (!connection || !credential) return
        updateResult(result.id, { status: 'running' })
        const startTime = performance.now()
        let firstTokenMs: number | null = null
        let lastRenderTime = 0
        let latestProgress = {
          content: result.content,
          totalTokens: result.totalTokens,
        }
        try {
          const completion = await runPelicanTestRequest(
            {
              apiFormat: connection.apiFormat,
              transport: connection.transport,
              baseUrl: connection.baseUrl,
              apiKey: credential.apiKey,
              model: result.model,
              effort: result.effort,
            },
            controller.signal,
            (progress) => {
              latestProgress = progress
              if (controller.signal.aborted) return
              const now = performance.now()
              if (firstTokenMs === null && progress.content) {
                firstTokenMs = Math.round(now - startTime)
              }
              if (lastRenderTime !== 0 && now - lastRenderTime < 100) return
              lastRenderTime = now
              updateResult(result.id, {
                status: 'running',
                content: progress.content,
                totalTokens: progress.totalTokens,
                firstTokenMs,
                durationMs: Math.round(now - startTime),
              })
            }
          )
          if (controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }
          updateResult(result.id, {
            status: 'success',
            firstTokenMs,
            content: completion.content,
            svg: extractSvg(completion.content),
            totalTokens: completion.totalTokens,
            durationMs: Math.round(performance.now() - startTime),
          })
        } catch (requestError) {
          let errorMessage: string | null = null
          if (!controller.signal.aborted) {
            errorMessage =
              requestError instanceof Error
                ? requestError.message
                : t('The request failed.')
          }
          updateResult(result.id, {
            status: controller.signal.aborted ? 'cancelled' : 'error',
            error: errorMessage,
            ...latestProgress,
            firstTokenMs,
            durationMs: Math.round(performance.now() - startTime),
          })
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(config.concurrency, plan.length) }, () =>
        worker()
      )
    )

    if (controller.signal.aborted) {
      for (const [index, result] of plan.entries()) {
        if (result.status === 'pending' || result.status === 'running') {
          plan[index] = { ...result, status: 'cancelled' }
        }
      }
      if (mountedRef.current) setResults([...plan])
    }
    onBatchChange?.({
      ...entry,
      results: [...plan],
      finishedAt: new Date().toISOString(),
    })
    if (abortControllerRef.current === controller) {
      abortControllerRef.current = null
    }
    if (mountedRef.current) setIsRunning(false)
  }

  const stop = () => {
    abortControllerRef.current?.abort()
  }

  const completedCount = results.filter(
    (result) =>
      result.status === 'success' ||
      result.status === 'error' ||
      result.status === 'cancelled'
  ).length
  const successCount = results.filter(
    (result) => result.status === 'success'
  ).length
  const failureCount = results.filter(
    (result) => result.status === 'error'
  ).length
  const progressValue =
    results.length === 0
      ? 0
      : Math.round((completedCount / results.length) * 100)

  return {
    results,
    isRunning,
    completedCount,
    successCount,
    failureCount,
    progressValue,
    start,
    stop,
  }
}
