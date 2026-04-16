import { useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AppSettings, ClientConnectionSettings, Logbook, OperatorProfile } from '../types'
import { defaultNewLogbook, encodeLogbookNotes, type MainTab, type NewLogbookForm } from '../App'

type LogsViewProps = {
  connection: ClientConnectionSettings
  isOnline: boolean
  operator: OperatorProfile | null
  appSettings: AppSettings | null
  logbooks: Logbook[]
  currentLogbookId: string | null
  setCurrentLogbookId: Dispatch<SetStateAction<string | null>>
  setMainTab: Dispatch<SetStateAction<MainTab>>
  busy: string | null
  setBusy: Dispatch<SetStateAction<string | null>>
  statusMessage: string
  setStatusMessage: Dispatch<SetStateAction<string>>
  createLogbook: typeof import('../services/api').createLogbook
  createOfflineLogbook: (draft: NewLogbookForm) => void
  setLogbooks: Dispatch<SetStateAction<Logbook[]>>
  deleteLogbook: typeof import('../services/api').deleteLogbook
  importLogbookAdif: typeof import('../services/api').importLogbookAdif
  defaultNewLogbook: NewLogbookForm
}

function readLogbookMeta(logbook: Logbook) {
  const notes = logbook.notes ?? ''
  const kind = notes.includes('LONGWAVE_KIND=pota') || logbook.parkReference ? 'pota' : 'standard'
  const potaMode = notes.includes('POTA_MODE=activating') ? 'activating' : 'hunting'
  return { kind, potaMode }
}

export function LogsView(props: LogsViewProps) {
  const [newLogbook, setNewLogbook] = useState<NewLogbookForm>(defaultNewLogbook)
  const [importLogbook, setImportLogbook] = useState<NewLogbookForm>({ ...defaultNewLogbook })
  const importInputRef = useRef<HTMLInputElement | null>(null)

  async function handleCreateLogbook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!props.isOnline) {
      props.createOfflineLogbook(newLogbook)
      setNewLogbook(defaultNewLogbook)
      return
    }
    props.setBusy('Creating Logbook')
    try {
      const operatorCallsign = props.operator?.callsign ?? props.appSettings?.stationCallsign ?? 'N0CALL'
      const created = await props.createLogbook(props.connection, {
        name: newLogbook.name,
        operatorCallsign,
        parkReference: newLogbook.kind === 'pota' ? newLogbook.parkReference : undefined,
        activationDate: newLogbook.activationDate || undefined,
        notes: encodeLogbookNotes(newLogbook.kind, newLogbook.potaMode),
      })
      props.setLogbooks((current) => [created, ...current])
      props.setCurrentLogbookId(created.id)
      props.setMainTab('current')
      setNewLogbook(defaultNewLogbook)
      props.setStatusMessage(`Created logbook ${created.name}.`)
    } catch (error) {
      props.setStatusMessage(`Logbook creation failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      props.setBusy(null)
    }
  }

  async function handleDeleteLogbook(logbook: Logbook) {
    if (!props.isOnline) {
      props.setStatusMessage('Offline logbook deletion is not available. Reconnect to delete a whole logbook.')
      return
    }
    props.setBusy('Deleting Logbook')
    try {
      await props.deleteLogbook(props.connection, logbook.id)
      props.setLogbooks((current) => current.filter((item) => item.id !== logbook.id))
      props.setCurrentLogbookId((current) => (current === logbook.id ? null : current))
      props.setMainTab('logs')
      props.setStatusMessage(`Deleted logbook ${logbook.name}.`)
    } catch (error) {
      props.setStatusMessage(`Logbook delete failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      props.setBusy(null)
    }
  }

  async function handleImportLogbook(file: File) {
    if (!props.isOnline) {
      props.setStatusMessage('Offline ADIF import is not available. Reconnect and import into the server-backed logbook list.')
      return
    }
    props.setBusy('Importing Logbook')
    try {
      const operatorCallsign = props.operator?.callsign ?? props.appSettings?.stationCallsign ?? 'N0CALL'
      const created = await props.createLogbook(props.connection, {
        name: importLogbook.name || file.name.replace(/\.(adi|adif)$/i, ''),
        operatorCallsign,
        parkReference: importLogbook.kind === 'pota' ? importLogbook.parkReference : undefined,
        activationDate: importLogbook.activationDate || undefined,
        notes: encodeLogbookNotes(importLogbook.kind, importLogbook.potaMode),
      })
      await props.importLogbookAdif(props.connection, created.id, created.operatorCallsign, file)
      props.setLogbooks((current) => [created, ...current])
      props.setCurrentLogbookId(created.id)
      props.setMainTab('current')
      setImportLogbook({ ...defaultNewLogbook })
      props.setStatusMessage(`Imported ${file.name} into new logbook ${created.name}.`)
    } catch (error) {
      props.setStatusMessage(`Logbook import failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      props.setBusy(null)
    }
  }

  return (
    <div className="page-grid logs-grid logs-grid-expanded">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Logs</p>
            <h2>Choose a logbook</h2>
          </div>
        </div>
        <div className="logbook-list">
          {props.logbooks.map((logbook) => {
            const meta = readLogbookMeta(logbook)
            return (
              <div key={logbook.id} className={`logbook-item ${props.currentLogbookId === logbook.id ? 'selected' : ''}`}>
                <button className="logbook-open" onClick={() => { props.setCurrentLogbookId(logbook.id); props.setMainTab('current') }}>
                  <div className="logbook-item-header">
                    <strong>{logbook.name}</strong>
                    <span className="pill">{meta.kind === 'pota' ? `POTA ${meta.potaMode}` : 'Standard'}</span>
                  </div>
                  <p>{logbook.parkReference ?? 'General purpose logbook'}</p>
                  <small>{logbook.contactCount} QSO(s)</small>
                </button>
                <div className="logbook-item-actions">
                  <button
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Delete the entire logbook "${logbook.name}" and all of its QSOs?`)) {
                        void handleDeleteLogbook(logbook)
                      }
                    }}
                    disabled={props.busy === 'Deleting Logbook'}
                  >
                    {props.busy === 'Deleting Logbook' ? 'Deleting...' : 'Delete Log'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">New Logbook</p>
            <h2>Start a new one</h2>
          </div>
        </div>
        <form className="settings-form" onSubmit={handleCreateLogbook}>
          <label>
            <span>Name</span>
            <input value={newLogbook.name} onChange={(event) => setNewLogbook((current) => ({ ...current, name: event.target.value }))} placeholder="Saturday Hunt, US-1234 Activation" />
          </label>
          <label>
            <span>Type</span>
            <select value={newLogbook.kind} onChange={(event) => setNewLogbook((current) => ({ ...current, kind: event.target.value as NewLogbookForm['kind'] }))}>
              <option value="standard">Standard</option>
              <option value="pota">POTA</option>
            </select>
          </label>
          {newLogbook.kind === 'pota' ? (
            <>
              <label>
                <span>POTA Mode</span>
                <select value={newLogbook.potaMode} onChange={(event) => setNewLogbook((current) => ({ ...current, potaMode: event.target.value as NewLogbookForm['potaMode'] }))}>
                  <option value="hunting">Hunting</option>
                  <option value="activating">Activating</option>
                </select>
              </label>
              <label>
                <span>Park Reference</span>
                <input value={newLogbook.parkReference} onChange={(event) => setNewLogbook((current) => ({ ...current, parkReference: event.target.value.toUpperCase() }))} placeholder="US-1234" />
              </label>
            </>
          ) : null}
          <label>
            <span>Date</span>
            <input type="date" value={newLogbook.activationDate} onChange={(event) => setNewLogbook((current) => ({ ...current, activationDate: event.target.value }))} />
          </label>
          <button className="primary" type="submit" disabled={props.busy === 'Creating Logbook'}>
            {props.busy === 'Creating Logbook' ? 'Creating...' : 'Create Logbook'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Import Logbook</p>
            <h2>Create a new log from ADIF</h2>
          </div>
        </div>
        <form className="settings-form" onSubmit={(event) => { event.preventDefault(); importInputRef.current?.click() }}>
          <label>
            <span>Name</span>
            <input value={importLogbook.name} onChange={(event) => setImportLogbook((current) => ({ ...current, name: event.target.value }))} placeholder="Imported POTA Hunt, Vacation Activation" />
          </label>
          <label>
            <span>Type</span>
            <select value={importLogbook.kind} onChange={(event) => setImportLogbook((current) => ({ ...current, kind: event.target.value as NewLogbookForm['kind'] }))}>
              <option value="standard">Standard</option>
              <option value="pota">POTA</option>
            </select>
          </label>
          {importLogbook.kind === 'pota' ? (
            <>
              <label>
                <span>POTA Mode</span>
                <select value={importLogbook.potaMode} onChange={(event) => setImportLogbook((current) => ({ ...current, potaMode: event.target.value as NewLogbookForm['potaMode'] }))}>
                  <option value="hunting">Hunting</option>
                  <option value="activating">Activating</option>
                </select>
              </label>
              <label>
                <span>Park Reference</span>
                <input value={importLogbook.parkReference} onChange={(event) => setImportLogbook((current) => ({ ...current, parkReference: event.target.value.toUpperCase() }))} placeholder="US-1234" />
              </label>
            </>
          ) : null}
          <label>
            <span>Date</span>
            <input type="date" value={importLogbook.activationDate} onChange={(event) => setImportLogbook((current) => ({ ...current, activationDate: event.target.value }))} />
          </label>
          <button className="primary" type="submit" disabled={props.busy === 'Importing Logbook'}>
            {props.busy === 'Importing Logbook' ? 'Importing...' : 'Choose ADIF File'}
          </button>
        </form>
        <input
          ref={importInputRef}
          type="file"
          accept=".adi,.adif,text/plain"
          className="hidden-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void handleImportLogbook(file)
            }
            event.currentTarget.value = ''
          }}
        />
      </section>
    </div>
  )
}
