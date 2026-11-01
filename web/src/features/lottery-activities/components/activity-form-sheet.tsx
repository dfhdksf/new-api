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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getCurrencyLabel } from '@/lib/currency'
import { formatQuota, getEditableQuotaStep } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  LOTTERY_ADMIN_QUERY_KEY,
  createLotteryActivity,
  updateLotteryActivity,
} from '../api'
import {
  LOTTERY_LIMITS,
  activityToFormValues,
  formValuesToPayload,
  getDefaultLotteryFormValues,
  getLotteryActivityFormSchema,
  isActivityLocked,
  summarizePrizes,
  type LotteryActivityFormValues,
} from '../lib/activity-form'
import type { LotteryActivity } from '../types'

interface ActivityFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The activity being edited; null to create a new one. */
  activity: LotteryActivity | null
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function parseNumberInput(value: string): number {
  return value === '' ? Number.NaN : Number(value)
}

export function ActivityFormSheet(props: ActivityFormSheetProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const editing = props.activity
  // Snapshot "now" whenever the sheet opens so validation and locking agree.
  const openedAt = useMemo(
    () => nowInSeconds(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.open, props.activity]
  )
  const locked = editing ? isActivityLocked(editing, openedAt) : false

  const schema = useMemo(
    () =>
      getLotteryActivityFormSchema({
        nowSeconds: openedAt,
        originalEndTime: editing?.end_time,
      }),
    [openedAt, editing?.end_time]
  )
  const form = useForm<LotteryActivityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: getDefaultLotteryFormValues(openedAt),
  })
  const tiers = useFieldArray({ control: form.control, name: 'tiers' })

  useEffect(() => {
    if (!props.open) return
    form.reset(
      editing
        ? activityToFormValues(editing)
        : getDefaultLotteryFormValues(openedAt)
    )
  }, [props.open, editing, openedAt, form])

  const watchedTiers = useWatch({ control: form.control, name: 'tiers' })
  const watchedSlots = useWatch({ control: form.control, name: 'total_slots' })
  const summary = summarizePrizes(watchedTiers ?? [], watchedSlots ?? 0)

  const saveMutation = useMutation({
    mutationFn: async (values: LotteryActivityFormValues) => {
      const payload = formValuesToPayload(values, {
        editing,
        locked,
      })
      const response = editing
        ? await updateLotteryActivity(editing.id, payload)
        : await createLotteryActivity(payload)
      if (!response.success) {
        throw createServerError(response, t('Save failed'))
      }
    },
    onSuccess: async () => {
      toast.success(editing ? t('Activity updated') : t('Activity created'))
      props.onOpenChange(false)
      await queryClient.invalidateQueries({
        queryKey: LOTTERY_ADMIN_QUERY_KEY,
      })
    },
    onError: (error: Error) => handleServerError(error, t('Save failed')),
  })

  const currencyLabel = getCurrencyLabel()
  const quotaStep = getEditableQuotaStep()

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[640px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {editing ? t('Edit Activity') : t('Create Activity')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Users draw once per round. Win rate = prizes / slots. Codes are generated only when someone wins.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='lottery-activity-form'
            onSubmit={form.handleSubmit((values) =>
              saveMutation.mutate(values)
            )}
            className={sideDrawerFormClassName()}
          >
            <fieldset disabled={saveMutation.isPending} className='contents'>
              {locked && (
                <Alert>
                  <Lock className='size-4' aria-hidden='true' />
                  <AlertDescription>
                    {t(
                      'This round has started, so its round number, start time, slots and prizes are locked to keep the odds fair. You can still change the name, description, end time and status.'
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <SideDrawerSection>
                <div className='grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]'>
                  <FormField
                    control={form.control}
                    name='period'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Round')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={1}
                            step={1}
                            disabled={locked}
                            placeholder={editing ? undefined : t('Auto')}
                            value={field.value ?? ''}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                            onChange={(event) =>
                              field.onChange(
                                event.target.value === ''
                                  ? undefined
                                  : Number(event.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Name')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            maxLength={LOTTERY_LIMITS.NAME_MAX}
                            placeholder={t('e.g. Weekend lucky draw')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name='description'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Description')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          maxLength={LOTTERY_LIMITS.DESCRIPTION_MAX}
                          placeholder={t('Optional, shown to users')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='start_time'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Start Time')}</FormLabel>
                        <FormControl>
                          <fieldset disabled={locked} className='contents'>
                            <DateTimePicker
                              value={field.value}
                              onChange={field.onChange}
                            />
                          </fieldset>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='end_time'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('End Time')}</FormLabel>
                        <FormControl>
                          <DateTimePicker
                            value={field.value}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name='enabled'
                  render={({ field }) => (
                    <FormItem className='flex flex-row items-center justify-between gap-3 rounded-lg border p-3'>
                      <div className='space-y-0.5'>
                        <FormLabel>{t('Enabled')}</FormLabel>
                        <FormDescription>
                          {t('Disabled rounds are hidden from users.')}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </SideDrawerSection>

              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='total_slots'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Slots')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          max={LOTTERY_LIMITS.SLOTS_MAX}
                          step={1}
                          disabled={locked}
                          value={Number.isNaN(field.value) ? '' : field.value}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          onChange={(event) =>
                            field.onChange(parseNumberInput(event.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'How many users can draw in this round. Each user draws at most once.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <span className='text-sm font-medium'>{t('Prizes')}</span>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={
                        locked ||
                        tiers.fields.length >= LOTTERY_LIMITS.TIERS_MAX
                      }
                      onClick={() => tiers.append({ amount: 1, count: 1 })}
                    >
                      <Plus className='size-4' aria-hidden='true' />
                      {t('Add tier')}
                    </Button>
                  </div>
                  <ul className='space-y-2'>
                    {tiers.fields.map((tierField, index) => (
                      <li
                        key={tierField.id}
                        className='grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] items-start gap-2'
                      >
                        <FormField
                          control={form.control}
                          name={`tiers.${index}.amount`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className='sr-only sm:not-sr-only sm:text-xs'>
                                {t('Amount ({{currency}})', {
                                  currency: currencyLabel,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type='number'
                                  min={0}
                                  step={quotaStep}
                                  disabled={locked}
                                  value={
                                    Number.isNaN(field.value) ? '' : field.value
                                  }
                                  onBlur={field.onBlur}
                                  name={field.name}
                                  ref={field.ref}
                                  onChange={(event) =>
                                    field.onChange(
                                      parseNumberInput(event.target.value)
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`tiers.${index}.count`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className='sr-only sm:not-sr-only sm:text-xs'>
                                {t('Count')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type='number'
                                  min={1}
                                  step={1}
                                  disabled={locked}
                                  value={
                                    Number.isNaN(field.value) ? '' : field.value
                                  }
                                  onBlur={field.onBlur}
                                  name={field.name}
                                  ref={field.ref}
                                  onChange={(event) =>
                                    field.onChange(
                                      parseNumberInput(event.target.value)
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='mt-0 sm:mt-6'
                          aria-label={t('Remove tier')}
                          disabled={locked || tiers.fields.length <= 1}
                          onClick={() => tiers.remove(index)}
                        >
                          <Trash2 className='size-4' aria-hidden='true' />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {form.formState.errors.tiers?.root?.message && (
                    <p className='text-destructive text-sm'>
                      {t(form.formState.errors.tiers.root.message)}
                    </p>
                  )}
                  <div className='bg-muted/50 grid grid-cols-3 gap-2 rounded-lg p-3 text-center text-sm'>
                    <div>
                      <div className='text-muted-foreground text-xs'>
                        {t('Total prizes')}
                      </div>
                      <div className='font-semibold tabular-nums'>
                        {summary.prizes}
                      </div>
                    </div>
                    <div>
                      <div className='text-muted-foreground text-xs'>
                        {t('Win rate')}
                      </div>
                      <div className='font-semibold tabular-nums'>
                        {summary.winRatePercent}%
                      </div>
                    </div>
                    <div>
                      <div className='text-muted-foreground text-xs'>
                        {t('Total prize value')}
                      </div>
                      <div className='font-semibold tabular-nums'>
                        {formatQuota(summary.totalQuota)}
                      </div>
                    </div>
                  </div>
                </div>
              </SideDrawerSection>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button type='button' variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='lottery-activity-form'
            type='submit'
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
