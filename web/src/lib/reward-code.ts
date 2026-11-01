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
import type { StatusVariant } from '@/components/status-badge'

/**
 * Shared types for reward codes: redemption codes the system issues to a user
 * (top-up gifts and lottery prizes). Backend: model.RewardCode.
 */

export type RewardCodeSource = 'topup_gift' | 'lottery'

export type RewardCodeStatus = 'unused' | 'used' | 'disabled' | 'invalid'

export interface RewardCode {
  id: number
  user_id: number
  source: RewardCodeSource
  /** Top-up order id (topup_gift) or lottery draw id (lottery). */
  source_id: number
  /** Gift percent of the credited quota; 0 for lottery prizes. */
  percent: number
  /** Lottery round number; 0 for top-up gifts. */
  period: number
  redemption_id: number
  /** 32-character redemption code anyone can redeem. */
  code: string
  /** Face value in quota units. */
  quota: number
  /** Unix seconds. */
  created_time: number
  status: RewardCodeStatus
}

/** labelKey values are i18n keys; render them with t(config.labelKey). */
export const REWARD_CODE_STATUS_CONFIG: Record<
  RewardCodeStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  unused: { labelKey: 'Unused', variant: 'success' },
  used: { labelKey: 'Used', variant: 'neutral' },
  disabled: { labelKey: 'Disabled', variant: 'neutral' },
  invalid: { labelKey: 'Invalid', variant: 'danger' },
}

/** Masks a code for list display: first and last 6 characters stay visible. */
export function maskRewardCode(code: string): string {
  if (code.length <= 12) {
    return code
  }
  return `${code.slice(0, 6)}${'*'.repeat(8)}${code.slice(-6)}`
}

/** Human-readable origin of a reward code. */
export function rewardCodeSourceLabel(
  reward: Pick<RewardCode, 'source' | 'percent' | 'period'>,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (reward.source === 'lottery') {
    return t('Round {{period}} lottery prize', { period: reward.period })
  }
  return t('Top-up gift {{percent}}%', { percent: reward.percent })
}

/**
 * Win rate in percent (prizes / slots). Rates of 0.1% and above keep one
 * decimal; smaller non-zero rates keep two significant digits so they never
 * read as 0%.
 */
export function getWinRatePercent(
  prizeSlots: number,
  totalSlots: number
): number {
  // Also covers NaN while a number input is being edited.
  if (!(totalSlots > 0) || !(prizeSlots > 0)) return 0
  const percent = (prizeSlots / totalSlots) * 100
  if (percent >= 0.1) return Math.round(percent * 10) / 10
  return Number(percent.toPrecision(2))
}
