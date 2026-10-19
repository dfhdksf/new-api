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
import { Bird, CheckCircle2, Clock3, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'

import { ConnectionForm } from './components/connection-form'
import { HistoryPanel } from './components/history-panel'
import { ResultCard } from './components/result-card'
import { PELICAN_TEST_PROMPT } from './constants'
import { usePelicanHistory } from './hooks/use-pelican-history'
import { usePelicanTestRunner } from './hooks/use-pelican-test-runner'
import { PREVIEW_RESULTS } from './preview-results'
import type { PelicanRerunRequest, PelicanTestConfig } from './types'

export function PelicanTest({ preview = false }: { preview?: boolean }) {
  const { t, i18n } = useTranslation()
  const history = usePelicanHistory()
  const runner = usePelicanTestRunner(history.record)
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null
  )
  const [rerunRequest, setRerunRequest] = useState<PelicanRerunRequest | null>(
    null
  )
  const selectedHistory = history.entries.find(
    (entry) => entry.id === selectedHistoryId
  )
  const showingPreview =
    preview && !selectedHistory && runner.results.length === 0
  let results = runner.results
  if (showingPreview) results = PREVIEW_RESULTS
  if (selectedHistory) {
    results = selectedHistory.results.map((result) => ({
      ...result,
      status:
        result.status === 'pending' || result.status === 'running'
          ? ('cancelled' as const)
          : result.status,
    }))
  }
  const completedCount = results.filter(
    (result) => result.status !== 'pending' && result.status !== 'running'
  ).length
  const successCount = results.filter(
    (result) => result.status === 'success'
  ).length
  const failureCount = results.filter(
    (result) => result.status === 'error'
  ).length
  const [connectionFilter, setConnectionFilter] = useState('')
  const [credentialFilter, setCredentialFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const connections = [
    ...new Map(
      results.map((result) => [result.connectionId, result.connectionName])
    ).entries(),
  ]
  const models = [...new Set(results.map((result) => result.model))]
  const activeConnection = connections.some(([id]) => id === connectionFilter)
    ? connectionFilter
    : ''
  const credentials = [
    ...new Map(
      results
        .filter(
          (result) =>
            !activeConnection || result.connectionId === activeConnection
        )
        .map((result) => [
          JSON.stringify([result.connectionId, result.credentialId]),
          `${result.connectionName} · ${result.credentialName}`,
        ])
    ).entries(),
  ]
  const activeCredential = credentials.some(([id]) => id === credentialFilter)
    ? credentialFilter
    : ''
  const activeModel = models.includes(modelFilter) ? modelFilter : ''
  const visibleResults = results.filter(
    (result) =>
      (!activeConnection || result.connectionId === activeConnection) &&
      (!activeModel || result.model === activeModel) &&
      (!activeCredential ||
        JSON.stringify([result.connectionId, result.credentialId]) ===
          activeCredential)
  )

  const startBatch = (config: PelicanTestConfig) => {
    setSelectedHistoryId(null)
    setConnectionFilter('')
    setModelFilter('')
    setCredentialFilter('')
    return runner.start(config)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:gap-8 lg:px-8 lg:py-8'>
        <header className='border-border/70 from-primary/10 via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm sm:p-7'>
          <div className='bg-primary/10 absolute -top-20 -right-12 size-64 rounded-full blur-3xl' />
          <div className='relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between'>
            <div className='max-w-2xl'>
              <Badge
                variant='outline'
                className='border-primary/20 bg-background/70 mb-3 gap-1.5'
              >
                <Sparkles
                  className='text-primary size-3.5'
                  aria-hidden='true'
                />
                {t('Model benchmark')}
              </Badge>
              <h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>
                {t('Pelican Test')}
              </h1>
              <p className='text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed sm:text-base'>
                {t(
                  'Compare SVG illustrations across API endpoints, models, and reasoning strengths.'
                )}
              </p>
              <nav className='mt-4 flex flex-wrap gap-2'>
                <a
                  href='#pelican-connections'
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('Connections')}
                </a>
                <a
                  href='#pelican-results'
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('Results')}
                </a>
                <a
                  href='#pelican-history'
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('Test history')} ({history.entries.length})
                </a>
              </nav>
            </div>
            <div className='border-primary/15 bg-background/75 text-primary flex size-20 shrink-0 items-center justify-center self-end rounded-2xl border shadow-sm sm:size-24 sm:self-auto'>
              <Bird
                className='size-10 sm:size-12'
                strokeWidth={1.5}
                aria-hidden='true'
              />
            </div>
          </div>
        </header>

        <div className='grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]'>
          <div
            id='pelican-connections'
            className='flex scroll-mt-6 flex-col gap-5'
          >
            <ConnectionForm
              isRunning={runner.isRunning}
              onStart={startBatch}
              rerunRequest={rerunRequest}
              onStop={runner.stop}
            />
            <Card className='border-border/70 bg-card/90 shadow-sm'>
              <CardHeader>
                <CardTitle className='text-sm'>
                  {t('Benchmark prompt')}
                </CardTitle>
                <CardDescription>
                  {t(
                    'The same prompt is sent to every selected model and strength.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className='bg-muted/50 border-border/50 rounded-lg border p-3 font-mono text-sm leading-relaxed'>
                  {selectedHistory?.prompt ?? PELICAN_TEST_PROMPT}
                </div>
              </CardContent>
            </Card>
          </div>

          <div
            className={`flex min-w-0 flex-col gap-6 ${results.length > 0 ? 'order-first lg:order-none' : ''}`}
          >
            <section
              id='pelican-results'
              className='flex min-w-0 scroll-mt-6 flex-col gap-4'
              aria-label={t('Results')}
            >
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <h2 className='text-lg font-semibold'>{t('Results')}</h2>
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {results.length === 0
                      ? t('Outputs will appear here after you start a batch.')
                      : t('{{completed}} of {{total}} complete', {
                          completed: completedCount,
                          total: results.length,
                        })}
                  </p>
                </div>
                {results.length > 0 && (
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge variant='outline' className='gap-1.5'>
                      <Clock3 className='size-3.5' aria-hidden='true' />
                      {t('{{count}} total', { count: results.length })}
                    </Badge>
                    <Badge variant='outline' className='gap-1.5'>
                      <CheckCircle2
                        className='size-3.5 text-emerald-600 dark:text-emerald-400'
                        aria-hidden='true'
                      />
                      {t('{{count}} succeeded', {
                        count: successCount,
                      })}
                    </Badge>
                    {failureCount > 0 && (
                      <Badge variant='destructive'>
                        {t('{{count}} failed', { count: failureCount })}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {selectedHistory && (
                <div
                  role='status'
                  className='border-primary/20 bg-primary/5 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm'
                >
                  <span>
                    {t('Viewing saved batch: {{date}}', {
                      date: new Date(selectedHistory.startedAt).toLocaleString(
                        toIntlLocale(i18n.language)
                      ),
                    })}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setSelectedHistoryId(null)}
                  >
                    {t('Back to current results')}
                  </Button>
                </div>
              )}
              {results.length > 0 && (
                <div className='border-border/60 bg-card flex flex-wrap items-end gap-3 rounded-xl border p-3'>
                  <label className='text-muted-foreground flex min-w-0 flex-1 flex-col gap-1.5 text-xs'>
                    {t('Filter by connection')}
                    <NativeSelect
                      className='w-full'
                      value={activeConnection}
                      onChange={(event) => {
                        setConnectionFilter(event.target.value)
                        setCredentialFilter('')
                      }}
                    >
                      <option value=''>{t('All connections')}</option>
                      {connections.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className='text-muted-foreground flex min-w-0 flex-1 flex-col gap-1.5 text-xs'>
                    {t('Filter by API key')}
                    <NativeSelect
                      className='w-full'
                      value={activeCredential}
                      onChange={(event) =>
                        setCredentialFilter(event.target.value)
                      }
                    >
                      <option value=''>{t('All API keys')}</option>
                      {credentials.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className='text-muted-foreground flex min-w-0 flex-1 flex-col gap-1.5 text-xs'>
                    {t('Filter by model')}
                    <NativeSelect
                      className='w-full'
                      value={activeModel}
                      onChange={(event) => setModelFilter(event.target.value)}
                    >
                      <option value=''>{t('All models')}</option>
                      {models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <span className='text-muted-foreground pb-2 text-xs'>
                    {t('{{count}} results shown', {
                      count: visibleResults.length,
                    })}
                  </span>
                </div>
              )}

              {showingPreview && (
                <p
                  role='status'
                  className='border-primary/20 bg-primary/5 text-muted-foreground rounded-lg border px-4 py-3 text-sm'
                >
                  {t(
                    'Illustrative samples only. These are not model outputs and no API requests have been made.'
                  )}
                </p>
              )}

              {runner.isRunning && (
                <Progress
                  value={runner.progressValue}
                  aria-label={t('Batch progress')}
                  className='gap-0'
                />
              )}

              {results.length === 0 ? (
                <Card className='border-border/70 bg-card/70'>
                  <CardContent className='flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center'>
                    <div className='bg-primary/10 text-primary mb-4 flex size-14 items-center justify-center rounded-2xl'>
                      <Bird className='size-7' aria-hidden='true' />
                    </div>
                    <h3 className='font-medium'>{t('Ready to run')}</h3>
                    <p className='text-muted-foreground mt-2 max-w-md text-sm leading-relaxed'>
                      {t(
                        'Add connections, fetch or enter models, and start a batch to compare their illustrations side by side.'
                      )}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className='grid min-w-0 gap-4 md:grid-cols-2'>
                  {visibleResults.map((result) => (
                    <ResultCard key={result.id} result={result} />
                  ))}
                </div>
              )}
            </section>
            <HistoryPanel
              entries={history.entries}
              selectedId={selectedHistoryId}
              isRunning={runner.isRunning}
              storageFailed={history.storageFailed}
              onView={(entry) => {
                setSelectedHistoryId(entry.id)
                setConnectionFilter('')
                setModelFilter('')
                setCredentialFilter('')
                document
                  .querySelector('#pelican-results')
                  ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
              }}
              onRerun={(entry) => {
                setRerunRequest((current) => ({
                  id: (current?.id ?? 0) + 1,
                  config: entry.config,
                }))
              }}
              onDelete={(id) => {
                history.remove(id)
                if (selectedHistoryId === id) setSelectedHistoryId(null)
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
