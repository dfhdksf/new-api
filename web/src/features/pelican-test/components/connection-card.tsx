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
import {
  ChevronDown,
  ChevronUp,
  Download,
  LoaderCircle,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

import { fetchPelicanModels, resolvePelicanApiUrl } from '../api'
import { getCredentialName, parseModels } from '../lib/batch-utils'
import type { PelicanConnection, PelicanTestConfig } from '../types'
import { CredentialList } from './credential-list'

type ConnectionCardProps = {
  connection: PelicanConnection
  index: number
  disabled: boolean
  canRemove: boolean
  onRemove: () => void
}

export function ConnectionCard({
  connection,
  index,
  disabled,
  canRemove,
  onRemove,
}: ConnectionCardProps) {
  const { t } = useTranslation()
  const form = useFormContext<PelicanTestConfig>()
  const [discoveryCredentialId, setDiscoveryCredentialId] = useState('')
  const discoveryCredential =
    connection.credentials.find(
      (credential) =>
        credential.id === discoveryCredentialId && credential.enabled
    ) ?? connection.credentials.find((credential) => credential.enabled)
  const [expanded, setExpanded] = useState(true)
  const [models, setModels] = useState<string[] | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const title =
    connection.name.trim() || t('Connection {{number}}', { number: index + 1 })
  const selectedModels = parseModels(connection.modelsText)
  const matches = (models ?? []).filter((model) =>
    model.toLowerCase().includes(search.toLowerCase())
  )
  const pageCount = Math.max(1, Math.ceil(matches.length / 10))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleModels = matches.slice(currentPage * 10, (currentPage + 1) * 10)

  useEffect(() => {
    setModels(null)
    setError(null)
    setLoading(false)
    return () => controllerRef.current?.abort()
  }, [
    connection.baseUrl,
    discoveryCredential?.id,
    discoveryCredential?.apiKey,
    connection.apiFormat,
    connection.transport,
  ])

  const loadModels = async () => {
    if (
      controllerRef.current &&
      !controllerRef.current.signal.aborted &&
      loading
    ) {
      return
    }
    try {
      resolvePelicanApiUrl(connection.baseUrl, connection.apiFormat)
    } catch {
      form.setError(`connections.${index}.baseUrl`, {
        message: t('Enter a valid HTTP(S) Base URL.'),
      })
      return
    }
    if (!discoveryCredential) return
    const credentialIndex = connection.credentials.findIndex(
      (credential) => credential.id === discoveryCredential.id
    )
    const credentialPath =
      `connections.${index}.credentials.${credentialIndex}.apiKey` as const
    if (!discoveryCredential.apiKey.trim()) {
      form.setError(credentialPath, { message: t('Enter an API key.') })
      return
    }
    form.clearErrors([`connections.${index}.baseUrl`, credentialPath])
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const fetched = await fetchPelicanModels(
        { ...connection, apiKey: discoveryCredential.apiKey },
        controller.signal
      )
      if (!controller.signal.aborted) {
        setModels(fetched)
        setPage(0)
      }
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t('The request failed.')
        )
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return (
    <section
      aria-label={t('Connection {{number}}', { number: index + 1 })}
      className='border-border/70 bg-background overflow-hidden rounded-xl border'
    >
      <div className='bg-muted/40 flex items-center gap-2 px-3 py-2.5'>
        <FormField
          control={form.control}
          name={`connections.${index}.enabled`}
          render={({ field }) => (
            <FormItem className='gap-0'>
              <FormControl>
                <input
                  type='checkbox'
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                  disabled={disabled}
                  aria-label={t('Include {{name}} in the batch', {
                    name: title,
                  })}
                  className='accent-primary size-4 shrink-0'
                />
              </FormControl>
            </FormItem>
          )}
        />
        <button
          type='button'
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={`connection-${connection.id}`}
          className='flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm font-medium'
        >
          <span className='truncate'>{title}</span>
          {expanded ? (
            <ChevronUp className='size-4 shrink-0' />
          ) : (
            <ChevronDown className='size-4 shrink-0' />
          )}
        </button>
        <Button
          type='button'
          variant='ghost'
          size='icon-xs'
          disabled={disabled || !canRemove}
          onClick={onRemove}
          aria-label={t('Remove {{name}}', { name: title })}
        >
          <Trash2 />
        </Button>
      </div>
      <div
        id={`connection-${connection.id}`}
        hidden={!expanded}
        className={expanded ? 'flex flex-col gap-4 p-3' : 'hidden'}
      >
        <FormField
          control={form.control}
          name={`connections.${index}.name`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Connection name')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  maxLength={100}
                  placeholder={t('Connection {{number}}', {
                    number: index + 1,
                  })}
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`connections.${index}.transport`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Request method')}</FormLabel>
              <FormControl>
                <NativeSelect {...field} disabled={disabled} className='w-full'>
                  <option value='server'>{t('Server proxy')}</option>
                  <option value='direct'>{t('Browser direct')}</option>
                </NativeSelect>
              </FormControl>
              <FormDescription>
                {connection.transport === 'server'
                  ? t(
                      'Sign in to proxy model discovery and generation through this server. Your upstream key is used only for the request.'
                    )
                  : t(
                      'Requests go directly to the upstream API, which must allow CORS.'
                    )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`connections.${index}.apiFormat`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('API format')}</FormLabel>
              <FormControl>
                <NativeSelect {...field} disabled={disabled} className='w-full'>
                  <option value='responses'>Responses API</option>
                  <option value='chat-completions'>Chat Completions API</option>
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`connections.${index}.baseUrl`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Base URL')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='url'
                  inputMode='url'
                  autoComplete='url'
                  maxLength={2048}
                  placeholder='https://api.example.com/v1'
                  disabled={disabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <CredentialList
          connection={connection}
          index={index}
          disabled={disabled}
        />
        <FormField
          control={form.control}
          name={`connections.${index}.modelsText`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Models (one per line)')}</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={2}
                  maxLength={32000}
                  placeholder={'model-a\nmodel-b'}
                  disabled={disabled}
                  className='font-mono text-xs'
                />
              </FormControl>
              <FormDescription>
                {t('Select fetched models or enter model IDs manually.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='border-border/60 border-t pt-3'>
          <label className='mb-3 flex flex-col gap-1.5 text-xs'>
            <span id={`discovery-label-${connection.id}`}>
              {t('Key for model discovery')}
            </span>
            <NativeSelect
              aria-labelledby={`discovery-label-${connection.id}`}
              aria-describedby={`discovery-hint-${connection.id}`}
              className='w-full'
              value={discoveryCredential?.id ?? ''}
              disabled={disabled || !discoveryCredential}
              onChange={(event) => setDiscoveryCredentialId(event.target.value)}
            >
              {!discoveryCredential && (
                <option value=''>{t('Enable at least one API key.')}</option>
              )}
              {connection.credentials.map(
                (credential, keyIndex) =>
                  credential.enabled && (
                    <option key={credential.id} value={credential.id}>
                      {getCredentialName(credential, keyIndex)}
                    </option>
                  )
              )}
            </NativeSelect>
            <span
              id={`discovery-hint-${connection.id}`}
              className='text-muted-foreground'
            >
              {t(
                'Model lists can differ by key. This selection only controls model discovery.'
              )}
            </span>
          </label>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='w-full'
            disabled={disabled || loading || !discoveryCredential}
            onClick={() => void loadModels()}
          >
            {loading ? (
              <LoaderCircle className='size-4 animate-spin' />
            ) : (
              <Download className='size-4' />
            )}
            {loading ? t('Loading models…') : t('Fetch models')}
          </Button>
          {error && (
            <p
              role='alert'
              className='text-destructive mt-2 text-xs break-words'
            >
              {error}
            </p>
          )}
          {models !== null && (
            <div className='mt-3 flex flex-col gap-2'>
              <p className='text-muted-foreground text-xs' role='status'>
                {t('{{count}} models available', { count: models.length })}
              </p>
              {models.length > 0 && (
                <>
                  <Input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(0)
                    }}
                    placeholder={t('Search models')}
                    aria-label={t('Search models')}
                    disabled={disabled}
                  />
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='xs'
                      disabled={disabled || visibleModels.length === 0}
                      onClick={() =>
                        form.setValue(
                          `connections.${index}.modelsText`,
                          [
                            ...new Set([...selectedModels, ...visibleModels]),
                          ].join('\n'),
                          { shouldValidate: true }
                        )
                      }
                    >
                      {t('Select visible models')}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='xs'
                      disabled={disabled || selectedModels.length === 0}
                      onClick={() =>
                        form.setValue(`connections.${index}.modelsText`, '', {
                          shouldValidate: true,
                        })
                      }
                    >
                      {t('Clear selection')}
                    </Button>
                  </div>
                  <div
                    role='group'
                    aria-label={t('Available models')}
                    className='border-border/60 rounded-lg border p-2'
                  >
                    {visibleModels.map((model) => (
                      <label
                        key={model}
                        className='hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs'
                      >
                        <input
                          type='checkbox'
                          checked={selectedModels.includes(model)}
                          disabled={disabled}
                          className='accent-primary size-3.5 shrink-0'
                          onChange={(event) => {
                            const selected = event.target.checked
                              ? [...selectedModels, model]
                              : selectedModels.filter(
                                  (value) => value !== model
                                )
                            form.setValue(
                              `connections.${index}.modelsText`,
                              selected.join('\n'),
                              { shouldValidate: true }
                            )
                          }}
                        />
                        <span className='break-all'>{model}</span>
                      </label>
                    ))}
                    {matches.length === 0 && (
                      <p className='text-muted-foreground p-2 text-xs'>
                        {t('No matching models.')}
                      </p>
                    )}
                  </div>
                  {pageCount > 1 && (
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='xs'
                        disabled={disabled || currentPage === 0}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        {t('Previous page')}
                      </Button>
                      <span
                        className='text-muted-foreground text-xs'
                        role='status'
                      >
                        {t('Page {{current}} of {{total}}', {
                          current: currentPage + 1,
                          total: pageCount,
                        })}
                      </span>
                      <Button
                        type='button'
                        variant='outline'
                        size='xs'
                        disabled={disabled || currentPage === pageCount - 1}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        {t('Next page')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {!connection.enabled && (
          <p className='text-muted-foreground text-xs'>
            {t('This connection is excluded from the batch.')}
          </p>
        )}
      </div>
    </section>
  )
}
