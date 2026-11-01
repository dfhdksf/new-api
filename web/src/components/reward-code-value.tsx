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
import { useTranslation } from 'react-i18next'

import { MaskedValueDisplay } from '@/components/masked-value-display'
import { StatusBadge } from '@/components/status-badge'
import {
  REWARD_CODE_STATUS_CONFIG,
  maskRewardCode,
  type RewardCodeStatus,
} from '@/lib/reward-code'

interface RewardCodeValueProps {
  code: string
  status?: RewardCodeStatus
}

/**
 * A reward redemption code shown masked (click to reveal and copy), with its
 * current status. Used by the wallet, the lottery page and the admin draws list.
 */
export function RewardCodeValue(props: RewardCodeValueProps) {
  const { t } = useTranslation()
  const statusConfig = props.status
    ? REWARD_CODE_STATUS_CONFIG[props.status]
    : undefined

  return (
    <div className='flex min-w-0 items-center gap-2'>
      <div className='min-w-0 flex-1'>
        <MaskedValueDisplay
          label={t('Full Code')}
          fullValue={props.code}
          maskedValue={maskRewardCode(props.code)}
          copyTooltip={t('Copy code')}
          copyAriaLabel={t('Copy redemption code')}
        />
      </div>
      {statusConfig && (
        <StatusBadge
          label={t(statusConfig.labelKey)}
          variant={statusConfig.variant}
          copyable={false}
          size='sm'
        />
      )}
    </div>
  )
}
