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
import { Check, Copy, Download, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

import { getSafeDownloadName } from '../lib/svg-utils'
import type { PelicanTestResult } from '../types'

type ResultCardProps = {
  result: PelicanTestResult
}

export function ResultCard(props: ResultCardProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.result.content)
      setCopied(true)
    } catch {
      toast.error(t('Failed to copy'))
    }
  }

  const handleDownload = () => {
    if (!props.result.svg) return
    const blob = new Blob([props.result.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = getSafeDownloadName(
      `${props.result.connectionName}-${props.result.credentialName}-${props.result.model}-${props.result.effort}`,
      props.result.id + 1
    )
    anchor.click()
    URL.revokeObjectURL(url)
  }

  let statusLabel = t('Waiting')
  let statusVariant: 'default' | 'secondary' | 'destructive' | 'outline' =
    'outline'
  if (props.result.status === 'running') {
    statusLabel = props.result.content ? t('Streaming') : t('Running')
    statusVariant = 'secondary'
  } else if (props.result.status === 'success') {
    statusLabel = t('Success')
    statusVariant = 'default'
  } else if (props.result.status === 'error') {
    statusLabel = t('Failed')
    statusVariant = 'destructive'
  } else if (props.result.status === 'cancelled') {
    statusLabel = t('Cancelled')
  }

  let preview: ReactNode
  if (props.result.svg) {
    preview = (
      <div className='bg-muted/40 border-border/50 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border p-3'>
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.result.svg)}`}
          alt={t('Generated pelican illustration')}
          className='size-full object-contain'
        />
      </div>
    )
  } else if (props.result.status === 'success') {
    preview = (
      <div className='bg-muted/40 text-muted-foreground flex min-h-48 items-center justify-center rounded-lg px-5 py-8 text-center text-sm'>
        {t('No SVG was found in the response.')}
      </div>
    )
  } else {
    const previewLabel =
      props.result.status === 'running'
        ? t('Generating illustration…')
        : t('Preview will appear here.')
    preview = (
      <div className='bg-muted/40 text-muted-foreground flex min-h-48 items-center justify-center rounded-lg px-5 py-8 text-center text-sm'>
        {previewLabel}
      </div>
    )
  }

  return (
    <Card
      role='article'
      aria-label={`${props.result.connectionName} · ${props.result.credentialName} · ${props.result.model} · ${props.result.effort}`}
      className='border-border/70 bg-card/90 min-w-0 shadow-sm'
    >
      <CardHeader className='gap-3'>
        <div className='flex min-w-0 items-start justify-between gap-3'>
          <div className='min-w-0'>
            <p
              className='text-primary mb-1 truncate text-xs font-medium'
              title={props.result.baseUrl}
            >
              {props.result.connectionName} · {props.result.credentialName}
            </p>
            <p
              className='truncate font-mono text-sm font-semibold'
              title={props.result.model}
            >
              {props.result.model}
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              {props.result.apiFormat === 'responses'
                ? 'Responses'
                : 'Chat Completions'}{' '}
              ·{' '}
              {props.result.transport === 'server'
                ? t('Server proxy')
                : t('Browser direct')}{' '}
              · {t('Run {{number}}', { number: props.result.runNumber })}
            </p>
          </div>
          <Badge variant={statusVariant} className='shrink-0'>
            {props.result.status === 'running' && (
              <LoaderCircle
                className='size-3 animate-spin'
                aria-hidden='true'
              />
            )}
            {props.result.status === 'success' && (
              <Check className='size-3' aria-hidden='true' />
            )}
            {props.result.status === 'error' && (
              <X className='size-3' aria-hidden='true' />
            )}
            {statusLabel}
          </Badge>
        </div>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-muted-foreground text-xs'>
            {t('Reasoning strength')}
          </span>
          <Badge variant='outline'>{props.result.effort}</Badge>
        </div>
      </CardHeader>

      <CardContent className='flex min-w-0 flex-col gap-3'>
        {preview}

        {props.result.error && (
          <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-xs break-words'>
            {props.result.error}
          </div>
        )}

        {props.result.content && (
          <details className='group border-border/60 rounded-lg border'>
            <summary className='text-muted-foreground hover:text-foreground cursor-pointer list-none px-3 py-2 text-xs font-medium'>
              {t('Show model response')}
            </summary>
            <pre className='border-border/60 bg-muted/40 max-h-64 overflow-auto border-t p-3 text-xs leading-relaxed break-all whitespace-pre-wrap'>
              {props.result.content}
            </pre>
          </details>
        )}

        <div className='text-muted-foreground flex min-h-8 items-center justify-between gap-2 text-xs tabular-nums'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            {props.result.firstTokenMs != null && (
              <span title={t('First token')}>
                {t('First token')}{' '}
                {t('{{value}} sec', {
                  value: (props.result.firstTokenMs / 1000).toFixed(1),
                })}
              </span>
            )}
            {props.result.durationMs !== null && (
              <span>
                {t('{{value}} sec', {
                  value: (props.result.durationMs / 1000).toFixed(1),
                })}
              </span>
            )}
            {props.result.totalTokens !== null && (
              <span>
                {t('{{count}} tokens', { count: props.result.totalTokens })}
              </span>
            )}
          </div>
          {props.result.content && (
            <div className='flex items-center gap-1'>
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                aria-label={copied ? t('Copied') : t('Copy response')}
                title={copied ? t('Copied') : t('Copy response')}
                onClick={() => void handleCopy()}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
              {props.result.svg && (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={t('Download SVG')}
                  title={t('Download SVG')}
                  onClick={handleDownload}
                >
                  <Download />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
