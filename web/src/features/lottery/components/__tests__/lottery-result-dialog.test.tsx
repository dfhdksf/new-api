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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

import type { LotteryDrawResult } from '../../types'
import { LotteryResultDialog } from '../lottery-result-dialog'

const WIN: LotteryDrawResult = {
  won: true,
  quota: 500_000,
  code: '0123456789abcdef0123456789abcdef',
  period: 2,
}

function Harness(props: { initial: LotteryDrawResult }) {
  const [result, setResult] = useState<LotteryDrawResult | null>(props.initial)
  return <LotteryResultDialog result={result} onClose={() => setResult(null)} />
}

describe('LotteryResultDialog', () => {
  test('shows the code for a win and the comforting line for a loss', () => {
    const { unmount } = render(<Harness initial={WIN} />)
    expect(screen.getByText('Congratulations!')).toBeInTheDocument()
    expect(screen.getByText(WIN.code)).toBeInTheDocument()
    unmount()

    render(<Harness initial={{ won: false, quota: 0, code: '', period: 2 }} />)
    expect(screen.getByText('Not this time')).toBeInTheDocument()
    expect(
      screen.getByText('So close! Better luck next round～')
    ).toBeInTheDocument()
  })

  test('a winner never sees the losing text while the dialog closes', async () => {
    // Emulate a running exit animation so the popup stays mounted while closing.
    let finishExit: (() => void) | undefined
    const exitFinished = new Promise<void>((resolve) => {
      finishExit = resolve
    })
    const original = Element.prototype.getAnimations
    Element.prototype.getAnimations = () =>
      [{ finished: exitFinished }] as unknown as Animation[]
    try {
      render(<Harness initial={WIN} />)
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
      const popup = await screen.findByRole('dialog', { hidden: true })
      await waitFor(() => expect(popup).toHaveAttribute('data-closed'))
      expect(popup).toHaveTextContent('Congratulations!')
      expect(popup).not.toHaveTextContent('Not this time')
      finishExit?.()
    } finally {
      Element.prototype.getAnimations = original
    }
  })
})
