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
import { Download, Save, Upload } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  exportPelicanConfiguration,
  importPelicanConfiguration,
  loadPelicanLibrary,
  MAX_CONFIGURATION_FILE_BYTES,
  MAX_SAVED_CONFIGURATIONS,
  savePelicanLibrary,
  type SavedPelicanConfiguration,
} from '../lib/configuration-library'
import {
  getRememberedPelicanConfig,
  savePelicanConfig,
} from '../lib/connection-storage'
import type { PelicanTestConfig } from '../types'

type ConfigurationLibraryProps = {
  disabled: boolean
  getConfig: () => PelicanTestConfig
  onLoad: (config: PelicanTestConfig) => void
}

export function ConfigurationLibrary({
  disabled,
  getConfig,
  onLoad,
}: ConfigurationLibraryProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const selectId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [library, setLibrary] = useState(() => {
    try {
      return { items: loadPelicanLibrary(), unavailable: false }
    } catch {
      return { items: [] as SavedPelicanConfiguration[], unavailable: true }
    }
  })
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [importing, setImporting] = useState(false)
  const selected = library.items.find((item) => item.id === selectedId)

  function saveConfiguration(event: React.FormEvent) {
    event.preventDefault()
    try {
      // Read again so saving from another tab does not discard newer entries.
      const current = loadPelicanLibrary()
      const existing = current.find((item) => item.name === name.trim())
      if (!existing && current.length >= MAX_SAVED_CONFIGURATIONS) {
        setFailed(true)
        setMessage(
          t(
            'Save up to {{count}} configurations. Delete one before adding another.',
            { count: MAX_SAVED_CONFIGURATIONS }
          )
        )
        return
      }
      const item = {
        id: existing?.id ?? crypto.randomUUID(),
        name: name.trim(),
        config: getRememberedPelicanConfig(getConfig()),
      }
      const items = [item, ...current.filter((entry) => entry.id !== item.id)]
      savePelicanLibrary(items)
      setLibrary({ items, unavailable: false })
      setSelectedId(item.id)
      setFailed(false)
      setMessage(t('Configuration saved.'))
    } catch {
      setFailed(true)
      setMessage(
        t(
          'Could not save settings. Check browser storage and configuration values.'
        )
      )
    }
  }

  function loadConfiguration() {
    if (!selected) return
    try {
      savePelicanConfig(selected.config)
      onLoad(selected.config)
      setName(selected.name)
      setFailed(false)
      setMessage(t('Configuration loaded.'))
    } catch {
      setFailed(true)
      setMessage(
        t(
          'Could not save settings. Check browser storage and configuration values.'
        )
      )
    }
  }

  function deleteConfiguration() {
    try {
      const items = loadPelicanLibrary().filter(
        (item) => item.id !== selectedId
      )
      savePelicanLibrary(items)
      setLibrary({ items, unavailable: false })
      setSelectedId('')
      setFailed(false)
      setMessage(null)
    } catch {
      setFailed(true)
      setMessage(
        t(
          'Could not save settings. Check browser storage and configuration values.'
        )
      )
    }
  }

  function exportConfiguration() {
    try {
      const content = exportPelicanConfiguration(getConfig())
      const url = URL.createObjectURL(
        new Blob([content], { type: 'application/json' })
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'new-api-pelican-configuration.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setFailed(false)
      setMessage(null)
    } catch {
      setFailed(true)
      setMessage(
        t(
          'Could not export this configuration. Check the configuration values.'
        )
      )
    }
  }

  async function importConfiguration(file: File) {
    setImporting(true)
    try {
      if (file.size > MAX_CONFIGURATION_FILE_BYTES) {
        throw new Error('File too large')
      }
      const config = importPelicanConfiguration(await file.text())
      savePelicanConfig(config)
      onLoad(config)
      setFailed(false)
      setMessage(t('Configuration imported. Save it with a name to reuse it.'))
    } catch {
      setFailed(true)
      setMessage(
        t(
          'Could not import the configuration. Use a valid Pelican JSON file up to 2 MiB and check browser storage.'
        )
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <section
      aria-label={t('Saved configurations')}
      className='bg-muted/30 flex flex-col gap-3 rounded-lg border p-3'
    >
      <h3 className='text-sm font-medium'>{t('Saved configurations')}</h3>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Save named configurations for later. Only keys marked “Remember key on this browser” are saved or exported.'
        )}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Browser settings are separate for each address and port. Export and import to move settings; files may contain saved API keys.'
        )}
      </p>
      <form onSubmit={saveConfiguration} className='flex flex-col gap-2'>
        <Label htmlFor={nameId}>{t('Configuration name')}</Label>
        <div className='flex flex-wrap gap-2'>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            disabled={disabled || importing}
            className='min-w-0 flex-1'
          />
          <Button
            type='submit'
            variant='outline'
            disabled={
              disabled || importing || !name.trim() || library.unavailable
            }
          >
            <Save className='size-4' />
            {t('Save configuration')}
          </Button>
        </div>
      </form>
      {library.items.length > 0 && (
        <div className='flex flex-col gap-2'>
          <Label htmlFor={selectId}>{t('Saved configurations')}</Label>
          <div className='flex flex-wrap gap-2'>
            <Select
              value={selectedId}
              onValueChange={(value) => setSelectedId(value ?? '')}
              disabled={disabled || importing}
            >
              <SelectTrigger id={selectId} className='min-w-0 flex-1'>
                <SelectValue placeholder={t('Select a saved configuration')}>
                  {selected?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {library.items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type='button'
              variant='outline'
              disabled={disabled || importing || !selected}
              onClick={loadConfiguration}
            >
              {t('Load configuration')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              disabled={disabled || importing || !selected}
              onClick={deleteConfiguration}
            >
              {t('Delete')}
            </Button>
          </div>
        </div>
      )}
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || importing}
          onClick={exportConfiguration}
        >
          <Download className='size-4' />
          {t('Export configuration')}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || importing}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className='size-4' />
          {t('Import configuration')}
        </Button>
        <input
          ref={fileRef}
          type='file'
          accept='.json,application/json'
          aria-label={t('Import configuration')}
          hidden
          disabled={disabled || importing}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importConfiguration(file)
          }}
        />
      </div>
      {library.unavailable && (
        <p role='alert' className='text-destructive text-xs'>
          {t(
            'Saved configurations could not be read. Existing data has been kept; export your current settings before reloading.'
          )}
        </p>
      )}
      {message && (
        <p
          role={failed ? 'alert' : 'status'}
          className={
            failed
              ? 'text-destructive text-xs'
              : 'text-muted-foreground text-xs'
          }
        >
          {message}
        </p>
      )}
    </section>
  )
}
