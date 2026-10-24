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
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useFormContext } from 'react-hook-form'
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

import { createPelicanCredential, MAX_CREDENTIALS } from '../constants'
import { getCredentialName } from '../lib/batch-utils'
import type { PelicanConnection, PelicanTestConfig } from '../types'

type CredentialListProps = {
  connection: PelicanConnection
  index: number
  disabled: boolean
}

export function CredentialList(props: CredentialListProps) {
  const { t } = useTranslation()
  const form = useFormContext<PelicanTestConfig>()
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: `connections.${props.index}.credentials`,
    keyName: 'fieldId',
  })
  return (
    <div className='flex flex-col gap-3'>
      <div>
        <p className='text-sm font-medium'>{t('API keys')}</p>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'Each enabled key tests the same selected models at this Base URL.'
          )}
        </p>
      </div>
      {fields.map((field, keyIndex) => {
        const credential = props.connection.credentials[keyIndex]
        if (!credential) return null
        const title = getCredentialName(credential, keyIndex)
        const prefix =
          `connections.${props.index}.credentials.${keyIndex}` as const
        return (
          <fieldset
            key={field.fieldId}
            className='border-border/60 flex min-w-0 flex-col gap-3 rounded-lg border p-3'
          >
            <legend className='px-1 text-xs font-medium'>{title}</legend>
            <div className='flex items-center justify-between gap-2'>
              <FormField
                control={form.control}
                name={`${prefix}.enabled`}
                render={({ field: input }) => (
                  <FormItem className='flex flex-row items-center gap-2'>
                    <FormControl>
                      <input
                        type='checkbox'
                        className='accent-primary size-4 shrink-0'
                        checked={input.value}
                        onChange={(event) =>
                          input.onChange(event.target.checked)
                        }
                        disabled={props.disabled}
                      />
                    </FormControl>
                    <FormLabel className='text-xs font-normal'>
                      {t('Include key in batch')}
                    </FormLabel>
                  </FormItem>
                )}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                disabled={props.disabled || fields.length === 1}
                aria-label={t('Remove key {{name}}', { name: title })}
                onClick={() => remove(keyIndex)}
              >
                <Trash2 className='size-3.5' />
              </Button>
            </div>
            <FormField
              control={form.control}
              name={`${prefix}.name`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel>{t('Key name')}</FormLabel>
                  <FormControl>
                    <Input
                      {...input}
                      maxLength={100}
                      placeholder={t('Key {{number}}', {
                        number: keyIndex + 1,
                      })}
                      disabled={props.disabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`${prefix}.apiKey`}
              render={({ field: input }) => (
                <FormItem>
                  <FormLabel>{t('API Key')}</FormLabel>
                  <FormControl>
                    <Input
                      {...input}
                      type='password'
                      autoComplete='new-password'
                      maxLength={8192}
                      placeholder={t('Paste your API key')}
                      disabled={props.disabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`${prefix}.rememberKey`}
              render={({ field: input }) => (
                <FormItem className='flex flex-row items-center gap-2'>
                  <FormControl>
                    <input
                      type='checkbox'
                      className='accent-primary size-4 shrink-0'
                      checked={input.value}
                      onChange={(event) => input.onChange(event.target.checked)}
                      disabled={props.disabled}
                    />
                  </FormControl>
                  <FormLabel className='text-xs font-normal'>
                    {t('Remember key on this browser')}
                  </FormLabel>
                </FormItem>
              )}
            />
          </fieldset>
        )
      })}
      {form.formState.errors.connections?.[props.index]?.credentials?.root
        ?.message && (
        <p role='alert' className='text-destructive text-xs'>
          {
            form.formState.errors.connections[props.index]?.credentials?.root
              ?.message
          }
        </p>
      )}
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={props.disabled || fields.length >= MAX_CREDENTIALS}
        onClick={() => append(createPelicanCredential())}
      >
        <Plus className='size-4' />
        {t('Add API key')}
      </Button>
      <FormDescription>
        {t('Up to {{count}} keys per connection.', { count: MAX_CREDENTIALS })}
      </FormDescription>
    </div>
  )
}
