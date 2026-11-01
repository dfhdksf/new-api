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
import { PartyPopper } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'

import type { LotteryDrawResult } from '../types'

interface LotteryResultDialogProps {
  result: LotteryDrawResult | null
  onClose: () => void
}

export function LotteryResultDialog(props: LotteryResultDialogProps) {
  const { t } = useTranslation()
  // Keep rendering the last result during the close animation; otherwise a
  // winner briefly sees the losing text while the dialog fades out.
  const [shown, setShown] = useState(props.result)
  if (props.result !== null && props.result !== shown) {
    setShown(props.result)
  }
  const result = shown
  const won = result?.won === true

  return (
    <Dialog
      open={props.result !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null)
      }}
      title={won ? t('Congratulations!') : t('Not this time')}
      description={
        result ? t('Round {{period}}', { period: result.period }) : undefined
      }
      contentClassName='sm:max-w-md'
      footer={
        <Button type='button' onClick={props.onClose}>
          {t('Got it')}
        </Button>
      }
    >
      {won && result ? (
        <div className='space-y-3 text-center'>
          <PartyPopper
            className='mx-auto size-10 text-amber-500'
            aria-hidden='true'
          />
          <p className='text-lg font-semibold'>
            {t('You won {{amount}}!', { amount: formatQuota(result.quota) })}
          </p>
          <div className='bg-muted flex items-center gap-2 rounded-md px-3 py-2'>
            <code className='min-w-0 flex-1 truncate text-left font-mono text-sm'>
              {result.code}
            </code>
            <CopyButton
              value={result.code}
              variant='outline'
              aria-label={t('Copy redemption code')}
              tooltip={t('Copy code')}
            />
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Redeem it in Wallet or share it with a friend. Find it anytime under My Codes.'
            )}
          </p>
        </div>
      ) : (
        <p className='text-muted-foreground py-4 text-center'>
          {t('So close! Better luck next round～')}
        </p>
      )}
    </Dialog>
  )
}
