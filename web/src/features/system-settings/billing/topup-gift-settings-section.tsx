/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatCurrencyFromUSD } from '@/lib/currency'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  TOPUP_GIFT_MAX_ROWS,
  computeTopUpGiftOdds,
  createDefaultTopUpGiftWeights,
  nextTopUpGiftPercent,
  parseStoredTopUpGiftWeights,
  serializeTopUpGiftWeights,
  topUpGiftSettingsSchema,
  type TopUpGiftSettingsValues,
} from './lib/topup-gift'

const ENABLED_KEY = 'topup_gift_setting.enabled'
const WEIGHTS_KEY = 'topup_gift_setting.weights'

interface TopUpGiftSettingsSectionProps {
  defaultValues: {
    enabled: boolean
    /** Stored JSON; empty means the server default table is in force. */
    weights: string
  }
}

function parseNumberInput(value: string): number {
  return value === '' ? Number.NaN : Number(value)
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function TopUpGiftSettingsSection(props: TopUpGiftSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const stored = parseStoredTopUpGiftWeights(props.defaultValues.weights)
  const initialWeightsJson = serializeTopUpGiftWeights(stored.rows)

  const form = useForm<TopUpGiftSettingsValues>({
    resolver: zodResolver(topUpGiftSettingsSchema),
    defaultValues: {
      enabled: props.defaultValues.enabled,
      weights: stored.rows,
    },
  })
  const rows = useFieldArray({ control: form.control, name: 'weights' })
  const watchedRows = useWatch({ control: form.control, name: 'weights' })
  const odds = computeTopUpGiftOdds(watchedRows ?? [])
  const { isDirty, isSubmitting } = form.formState

  async function onSubmit(values: TopUpGiftSettingsValues) {
    const weightsJson = serializeTopUpGiftWeights(values.weights)
    const updates: Array<{ key: string; value: string }> = []
    if (values.enabled !== props.defaultValues.enabled) {
      updates.push({ key: ENABLED_KEY, value: String(values.enabled) })
    }
    // A corrupt stored table must be rewritten even if the rows look unchanged.
    if (weightsJson !== initialWeightsJson || !stored.valid) {
      updates.push({ key: WEIGHTS_KEY, value: weightsJson })
    }
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const update of updates) {
      // useUpdateOption already toasts both outcomes; stop at the first failure.
      const response = await updateOption.mutateAsync(update)
      if (!response.success) return
    }
    form.reset({
      ...values,
      weights: [...values.weights].sort((a, b) => a.percent - b.percent),
    })
  }

  const handleAddRow = () => {
    const percent = nextTopUpGiftPercent(form.getValues('weights'))
    if (percent === null) return
    rows.append({ percent, weight: 1 })
  }

  const handleResetDefaults = () => {
    form.setValue('weights', createDefaultTopUpGiftWeights(), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const minimumGift = formatCurrencyFromUSD(0.1, {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: false,
  })

  return (
    <SettingsSection title={t('Top-up Gift Codes')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty && stored.valid}
            saveLabel='Save gift settings'
          />

          <Alert>
            <AlertDescription className='space-y-1'>
              <p>
                {t(
                  'After every paid online top-up (Epay, Stripe, Creem, Waffo, Waffo Pancake), the buyer receives one redemption code worth a random percent of the credited amount. The percent is drawn with probability weight / total weight.'
                )}
              </p>
              <p>
                {t(
                  'Codes never expire, can be shared with anyone, and are worth at least {{amount}}. Orders completed manually by an admin and subscription purchases do not earn a gift.',
                  { amount: minimumGift }
                )}
              </p>
            </AlertDescription>
          </Alert>

          {!stored.valid && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'The stored weight table is invalid, so no gift codes are being issued. Review the table below and save to fix it.'
                )}
              </AlertDescription>
            </Alert>
          )}

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable top-up gift codes')}</FormLabel>
                  <FormDescription>
                    {t('Issue a bonus redemption code after each paid top-up')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <div className='text-sm font-medium'>
                  {t('Gift weight table')}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {odds.expectedPercent === null
                    ? t('Add at least one valid row')
                    : t('Expected gift: {{percent}}% of each top-up', {
                        percent: formatPercent(odds.expectedPercent),
                      })}
                </div>
              </div>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={handleResetDefaults}
                >
                  <RotateCcw className='size-4' aria-hidden='true' />
                  {t('Reset to default')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={rows.fields.length >= TOPUP_GIFT_MAX_ROWS}
                  onClick={handleAddRow}
                >
                  <Plus className='size-4' aria-hidden='true' />
                  {t('Add row')}
                </Button>
              </div>
            </div>

            <div className='overflow-x-auto rounded-lg border'>
              <table className='w-full min-w-[420px] text-sm'>
                <thead className='bg-muted/50 text-muted-foreground text-xs'>
                  <tr>
                    <th scope='col' className='px-3 py-2 text-left font-medium'>
                      {t('Gift percent (%)')}
                    </th>
                    <th scope='col' className='px-3 py-2 text-left font-medium'>
                      {t('Weight')}
                    </th>
                    <th
                      scope='col'
                      className='px-3 py-2 text-right font-medium'
                    >
                      {t('Probability')}
                    </th>
                    <th scope='col' className='w-12 px-3 py-2'>
                      <span className='sr-only'>{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {rows.fields.map((row, index) => {
                    const probability = odds.probabilities[index]
                    return (
                      <tr key={row.id} className='align-top'>
                        <td className='px-3 py-2'>
                          <FormField
                            control={form.control}
                            name={`weights.${index}.percent`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    type='number'
                                    min={1}
                                    max={100}
                                    step={1}
                                    aria-label={t(
                                      'Gift percent for row {{row}}',
                                      { row: index + 1 }
                                    )}
                                    value={
                                      Number.isNaN(field.value)
                                        ? ''
                                        : field.value
                                    }
                                    name={field.name}
                                    ref={field.ref}
                                    onBlur={field.onBlur}
                                    onChange={(event) =>
                                      field.onChange(
                                        parseNumberInput(event.target.value)
                                      )
                                    }
                                    className='h-8 w-24'
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </td>
                        <td className='px-3 py-2'>
                          <FormField
                            control={form.control}
                            name={`weights.${index}.weight`}
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Input
                                    type='number'
                                    min={1}
                                    step={1}
                                    aria-label={t('Weight for row {{row}}', {
                                      row: index + 1,
                                    })}
                                    value={
                                      Number.isNaN(field.value)
                                        ? ''
                                        : field.value
                                    }
                                    name={field.name}
                                    ref={field.ref}
                                    onBlur={field.onBlur}
                                    onChange={(event) =>
                                      field.onChange(
                                        parseNumberInput(event.target.value)
                                      )
                                    }
                                    className='h-8 w-28'
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </td>
                        <td className='px-3 py-2 text-right tabular-nums'>
                          {probability === null
                            ? '-'
                            : `${probability.toFixed(1)}%`}
                        </td>
                        <td className='px-3 py-2'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            className='size-8'
                            aria-label={t('Remove row {{row}}', {
                              row: index + 1,
                            })}
                            disabled={rows.fields.length <= 1}
                            onClick={() => rows.remove(index)}
                          >
                            <Trash2 className='size-4' aria-hidden='true' />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {form.formState.errors.weights?.root?.message && (
              <p className='text-destructive text-sm'>
                {t(form.formState.errors.weights.root.message)}
              </p>
            )}
            {form.formState.errors.weights?.message && (
              <p className='text-destructive text-sm'>
                {t(form.formState.errors.weights.message)}
              </p>
            )}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
