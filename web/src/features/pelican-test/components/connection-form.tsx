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
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleCheck, Play, Plus, ShieldCheck, Square } from 'lucide-react'
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth-store'

import {
  createPelicanConnection,
  MAX_BATCH_REQUESTS,
  MAX_CONNECTIONS,
  MAX_CONCURRENCY,
  MAX_REPEAT_COUNT,
} from '../constants'
import { getBatchSize } from '../lib/batch-utils'
import { getPelicanTestConfigSchema } from '../lib/config-schema'
import { loadPelicanConfig, savePelicanConfig } from '../lib/connection-storage'
import { restoreHistoryConfig } from '../lib/history-storage'
import {
  REASONING_EFFORTS,
  type PelicanTestConfig,
  type PelicanRerunRequest,
} from '../types'
import { ConfigurationLibrary } from './configuration-library'
import { ConnectionCard } from './connection-card'

type ConnectionFormProps = {
  isRunning: boolean
  onStart: (config: PelicanTestConfig) => void | Promise<void>
  rerunRequest?: PelicanRerunRequest | null
  onStop: () => void
}

export function ConnectionForm({
  isRunning,
  onStart,
  onStop,
  rerunRequest,
}: ConnectionFormProps) {
  const { t } = useTranslation()
  const schema = useMemo(() => getPelicanTestConfigSchema(t), [t])
  const [initialConfig] = useState(loadPelicanConfig)
  const [storageFailed, setStorageFailed] = useState(false)
  const [restoredWithoutKeys, setRestoredWithoutKeys] = useState(false)
  const handledRequestRef = useRef<number | null>(null)
  const form = useForm<PelicanTestConfig>({
    resolver: zodResolver(schema),
    defaultValues: initialConfig,
  })
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'connections',
    keyName: 'fieldId',
  })
  const config = useWatch({ control: form.control }) as PelicanTestConfig
  const batchSize = getBatchSize(config)
  const enabledCount = config.connections.filter(
    (connection) => connection.enabled
  ).length
  const { watch, getValues } = form

  useEffect(() => {
    const persist = () => {
      try {
        savePelicanConfig(getValues())
        setStorageFailed(false)
      } catch {
        setStorageFailed(true)
      }
    }
    const subscription = watch(persist)
    return () => subscription.unsubscribe()
  }, [watch, getValues])

  const submitBatch = useCallback(
    (values: PelicanTestConfig) => {
      if (
        values.connections.some(
          (connection) =>
            connection.enabled && connection.transport === 'server'
        ) &&
        !useAuthStore.getState().auth.user
      ) {
        form.setError('root', {
          message: t('Sign in to use the Pelican test server proxy.'),
        })
        return
      }
      setRestoredWithoutKeys(false)
      return onStart(values)
    },
    [form, onStart, t]
  )

  useEffect(() => {
    if (
      !rerunRequest ||
      handledRequestRef.current === rerunRequest.id ||
      isRunning
    ) {
      return
    }
    handledRequestRef.current = rerunRequest.id
    const restored = restoreHistoryConfig(rerunRequest.config, form.getValues())
    form.reset(restored)
    const missingKeys = restored.connections.some(
      (connection) =>
        connection.enabled &&
        connection.credentials.some(
          (credential) => credential.enabled && !credential.apiKey.trim()
        )
    )
    setRestoredWithoutKeys(missingKeys)
    if (missingKeys) {
      void form.trigger()
      document
        .querySelector('#pelican-connections')
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      return
    }
    void form.handleSubmit(submitBatch)()
  }, [rerunRequest, isRunning, form, submitBatch])

  return (
    <Card className='border-border/70 bg-card/90 shadow-sm'>
      <CardHeader>
        <CardTitle>{t('Connections')}</CardTitle>
        <CardDescription>
          {t('Select connections to compare in one batch.')}
        </CardDescription>
        <p
          className='text-muted-foreground flex items-center gap-1.5 text-xs'
          role='status'
        >
          <CircleCheck className='size-3.5 shrink-0' />
          {storageFailed
            ? t(
                'Browser storage is unavailable. Your settings will not survive a reload.'
              )
            : t('Connection settings are saved automatically in this browser.')}
        </p>
      </CardHeader>
      <CardContent className='flex flex-col gap-5'>
        <ConfigurationLibrary
          disabled={isRunning}
          getConfig={getValues}
          onLoad={(saved) => {
            form.reset(saved)
            setRestoredWithoutKeys(false)
          }}
        />
        <Form {...form}>
          <form
            className='flex flex-col gap-5'
            noValidate
            onSubmit={form.handleSubmit(submitBatch)}
          >
            <div className='flex flex-col gap-3'>
              {fields.map((field, index) => (
                <ConnectionCard
                  key={field.fieldId}
                  connection={config.connections[index] ?? field}
                  index={index}
                  disabled={isRunning}
                  canRemove={fields.length > 1}
                  onRemove={() => remove(index)}
                />
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={isRunning || fields.length >= MAX_CONNECTIONS}
                onClick={() => append(createPelicanConnection())}
              >
                <Plus className='size-4' />
                {t('Add connection')}
              </Button>
            </div>
            <div className='bg-muted/40 flex items-start gap-2 rounded-lg p-3 text-xs'>
              <ShieldCheck className='text-primary mt-0.5 size-4 shrink-0' />
              <p className='text-muted-foreground'>
                {t(
                  'Saved keys are stored as plain text in this browser. Enable key saving only on a trusted device.'
                )}
              </p>
            </div>
            <FormField
              control={form.control}
              name='efforts'
              render={({ field }) => (
                <FormItem>
                  <fieldset
                    disabled={isRunning}
                    aria-describedby='pelican-efforts-error'
                  >
                    <legend className='mb-2 text-sm font-medium'>
                      {t('Reasoning strength')}
                    </legend>
                    <div className='grid grid-cols-2 gap-2'>
                      {REASONING_EFFORTS.map((effort) => (
                        <label
                          key={effort}
                          className='border-border/70 has-checked:border-primary/50 has-checked:bg-primary/5 flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs'
                        >
                          <input
                            type='checkbox'
                            className='accent-primary size-3.5'
                            checked={field.value.includes(effort)}
                            onChange={(event) =>
                              field.onChange(
                                event.target.checked
                                  ? [...field.value, effort]
                                  : field.value.filter(
                                      (value) => value !== effort
                                    )
                              )
                            }
                          />
                          {effort}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <FormMessage id='pelican-efforts-error' />
                </FormItem>
              )}
            />
            <div className='grid grid-cols-2 gap-3'>
              <FormField
                control={form.control}
                name='count'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Runs per combination')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        inputMode='numeric'
                        min={1}
                        max={MAX_REPEAT_COUNT}
                        step={1}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                        disabled={isRunning}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='concurrency'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Concurrency')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        inputMode='numeric'
                        min={1}
                        max={MAX_CONCURRENCY}
                        step={1}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                        disabled={isRunning}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className='bg-muted/50 border-border/60 flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm'>
              <span className='text-muted-foreground'>{t('Batch size')}</span>
              <span className='font-mono font-semibold tabular-nums'>
                {t('{{count}} requests', { count: batchSize })}
              </span>
            </div>
            {batchSize > MAX_BATCH_REQUESTS && (
              <p role='alert' className='text-destructive text-xs'>
                {t('The batch cannot exceed {{count}} requests.', {
                  count: MAX_BATCH_REQUESTS,
                })}
              </p>
            )}
            {restoredWithoutKeys && (
              <p role='status' className='text-muted-foreground text-sm'>
                {t(
                  'Historical settings restored. Enter the missing API keys, then start the batch.'
                )}
              </p>
            )}
            {form.formState.errors.root?.message && (
              <p role='alert' className='text-destructive text-xs'>
                {form.formState.errors.root.message}
              </p>
            )}
            <p className='text-muted-foreground text-xs'>
              {t(
                'API requests may incur charges. Server proxy mode requires sign-in; browser direct mode requires upstream CORS support.'
              )}
            </p>
            <div className='flex items-center justify-between gap-3'>
              <span className='text-muted-foreground text-xs'>
                {t('{{count}} connections selected', { count: enabledCount })}
              </span>
              {isRunning ? (
                <Button type='button' variant='destructive' onClick={onStop}>
                  <Square className='size-4 fill-current' />
                  {t('Stop test')}
                </Button>
              ) : (
                <Button type='submit'>
                  <Play className='size-4 fill-current' />
                  {t('Start batch test')}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
