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
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

import { ActivitiesList } from './components/activities-list'
import { ActivityFormSheet } from './components/activity-form-sheet'
import { DrawsDialog } from './components/draws-dialog'
import type { LotteryActivity } from './types'

export function LotteryActivities() {
  const { t } = useTranslation()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LotteryActivity | null>(null)
  const [drawsFor, setDrawsFor] = useState<LotteryActivity | null>(null)

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Lottery Activities')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            type='button'
            size='sm'
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className='size-4' aria-hidden='true' />
            {t('Create Activity')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='mx-auto w-full max-w-6xl'>
            <ActivitiesList
              onEdit={(activity) => {
                setEditing(activity)
                setFormOpen(true)
              }}
              onViewDraws={setDrawsFor}
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ActivityFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        activity={editing}
      />
      <DrawsDialog activity={drawsFor} onClose={() => setDrawsFor(null)} />
    </>
  )
}
