import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { LogsView } from './components/LogsView'
import { CurrentLogView } from './components/CurrentLogView'
import { SettingsView } from './components/SettingsView'
import { draftFromSpot, spots as fallbackSpots } from './data/mockData'
import {
  createContact,
  createLogbook,
  createPotaSpot,
  deleteContact,
  deleteLogbook,
  exportLogbookAdif,
  fetchAppSettings,
  fetchContacts,
  fetchLogbooks,
  fetchOperatorProfile,
  fetchPotaSpots,
  importLogbookAdif,
  lookupCallsign,
  uploadLogbookToQrz,
  updateAppSettings,
} from './services/api'
import { isDesktopRuntime } from './services/desktop'
import { readFlrigState, tuneFlrig } from './services/flrig'
import type {
  AppSettings,
  CallsignLookup,
  ClientConnectionSettings,
  Contact,
  ContactDraft,
  Logbook,
  OperatorProfile,
  PendingMutation,
  RigConnectionSettings,
  RigState,
  ServerSettingsForm,
  Spot,
} from './types'

const queueStorageKey = 'longwave-sync-queue'
const connectionStorageKey = 'longwave-server-connection'
const rigStorageKey = 'longwave-rig-connection'

export type MainTab = 'logs' | 'current' | 'settings'
export type LogbookKind = 'standard' | 'pota'
export type PotaMode = 'hunting' | 'activating'
export type LogbookSubTab = 'qsos' | 'map' | 'pota'

export type NewLogbookForm = {
  name: string
  kind: LogbookKind
  potaMode: PotaMode
  parkReference: string
  activationDate: string
}

export const defaultConnection: ClientConnectionSettings = { serverUrl: 'http://127.0.0.1:8000/api/v1', apiToken: '', adminToken: '' }
export const defaultRigConnection: RigConnectionSettings = { endpoint: 'http://127.0.0.1:12345' }
export const defaultNewLogbook: NewLogbookForm = { name: '', kind: 'standard', potaMode: 'hunting', parkReference: '', activationDate: '' }

export function loadStored<T>(key: string, fallback: T) {
  const saved = window.localStorage.getItem(key)
  return saved ? (JSON.parse(saved) as T) : fallback
}

export function createMutationId() {
  return `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function bandFromFrequencyKhz(frequencyKhz: number): string {
  if (frequencyKhz >= 1800 && frequencyKhz < 2000) return '160m'
  if (frequencyKhz >= 3500 && frequencyKhz < 4000) return '80m'
  if (frequencyKhz >= 5330 && frequencyKhz < 5410) return '60m'
  if (frequencyKhz >= 7000 && frequencyKhz < 7300) return '40m'
  if (frequencyKhz >= 10100 && frequencyKhz < 10150) return '30m'
  if (frequencyKhz >= 14000 && frequencyKhz < 14350) return '20m'
  if (frequencyKhz >= 18068 && frequencyKhz < 18168) return '17m'
  if (frequencyKhz >= 21000 && frequencyKhz < 21450) return '15m'
  if (frequencyKhz >= 24890 && frequencyKhz < 24990) return '12m'
  if (frequencyKhz >= 28000 && frequencyKhz < 29700) return '10m'
  if (frequencyKhz >= 50000 && frequencyKhz < 54000) return '6m'
  if (frequencyKhz >= 144000 && frequencyKhz < 148000) return '2m'
  return ''
}

export function shouldQueueMutation(error: unknown) {
  return !navigator.onLine || (error instanceof Error && /failed to fetch|network/i.test(error.message))
}

export function encodeLogbookNotes(kind: LogbookKind, potaMode: PotaMode) {
  return `LONGWAVE_KIND=${kind};POTA_MODE=${potaMode}`
}

export function readLogbookMeta(logbook: Logbook) {
  const notes = logbook.notes ?? ''
  const kind: LogbookKind = notes.includes('LONGWAVE_KIND=pota') || logbook.parkReference ? 'pota' : 'standard'
  const potaMode: PotaMode = notes.includes('POTA_MODE=activating') ? 'activating' : 'hunting'
  return { kind, potaMode }
}

function App() {
  const desktopRuntime = isDesktopRuntime()
  const lastAutoLookupRef = useRef('')
  const [mainTab, setMainTab] = useState<MainTab>('logs')
  const [logbookTab, setLogbookTab] = useState<LogbookSubTab>('qsos')
  const [connection, setConnection] = useState<ClientConnectionSettings>(() => loadStored(connectionStorageKey, defaultConnection))
  const [connectionDraft, setConnectionDraft] = useState<ClientConnectionSettings>(() => loadStored(connectionStorageKey, defaultConnection))
  const [rigConnection, setRigConnection] = useState<RigConnectionSettings>(() => loadStored(rigStorageKey, defaultRigConnection))
  const [operator, setOperator] = useState<OperatorProfile | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [logbooks, setLogbooks] = useState<Logbook[]>([])
  const [currentLogbookId, setCurrentLogbookId] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [spots, setSpots] = useState<Spot[]>(fallbackSpots)
  const [selectedSpot, setSelectedSpot] = useState<Spot>(fallbackSpots[0])
  const [draft, setDraft] = useState<ContactDraft>(() => draftFromSpot(fallbackSpots[0]))
  const [lookupResult, setLookupResult] = useState<CallsignLookup | null>(null)
  const [rigState, setRigState] = useState<RigState | null>(null)
  const [queuedSyncItems, setQueuedSyncItems] = useState<PendingMutation[]>(() => loadStored(queueStorageKey, []))
  const [statusMessage, setStatusMessage] = useState('Connect to your server and choose a logbook to begin.')
  const [busy, setBusy] = useState<string | null>(null)
  const [settingsForm, setSettingsForm] = useState<ServerSettingsForm>({ stationCallsign: '', stationName: '', myGridSquare: '', myState: '', myCounty: '', qrzUsername: '', qrzPassword: '', qrzApiKey: '', potaApiKey: '' })

  const currentLogbook = useMemo(() => logbooks.find((logbook) => logbook.id === currentLogbookId) ?? null, [logbooks, currentLogbookId])

  useEffect(() => { window.localStorage.setItem(queueStorageKey, JSON.stringify(queuedSyncItems)) }, [queuedSyncItems])
  useEffect(() => { window.localStorage.setItem(rigStorageKey, JSON.stringify(rigConnection)) }, [rigConnection])
  useEffect(() => { if (appSettings) setSettingsForm((current) => ({ ...current, stationCallsign: appSettings.stationCallsign, stationName: appSettings.stationName, myGridSquare: appSettings.myGridSquare ?? '', myState: appSettings.myState ?? '', myCounty: appSettings.myCounty ?? '', qrzUsername: appSettings.qrzUsername ?? '' })) }, [appSettings])
  useEffect(() => { if (connection.apiToken) void refreshServerState(connection) }, [])
  useEffect(() => {
    const preferredOperator = currentLogbook?.operatorCallsign || operator?.callsign || appSettings?.stationCallsign
    if (!preferredOperator) return
    setDraft((current) => {
      if (current.operatorCallsign === preferredOperator && current.logbookId === (currentLogbookId ?? current.logbookId)) {
        return current
      }
      return {
        ...current,
        operatorCallsign: preferredOperator,
        logbookId: currentLogbookId ?? current.logbookId,
      }
    })
  }, [currentLogbook?.operatorCallsign, currentLogbookId, operator?.callsign, appSettings?.stationCallsign])
  useEffect(() => {
    if (!currentLogbookId || !connection.apiToken) return
    void refreshCurrentLogContacts(currentLogbookId)
  }, [currentLogbookId, connection.apiToken])
  useEffect(() => {
    const normalized = draft.stationCallsign.trim().toUpperCase()
    if (mainTab !== 'current') return
    if (!connection.apiToken) return
    if (normalized.length < 3) {
      lastAutoLookupRef.current = ''
      if (!normalized) {
        setLookupResult(null)
      }
      return
    }
    if (lookupResult?.callsign === normalized || lastAutoLookupRef.current === normalized) {
      return
    }

    const timer = window.setTimeout(() => {
      lastAutoLookupRef.current = normalized
      void handleLookupCallsign(normalized, false)
    }, 500)

    return () => window.clearTimeout(timer)
  }, [draft.stationCallsign, mainTab, connection.apiToken, lookupResult?.callsign])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">LW</span><div><strong>Longwave</strong><small>{operator?.callsign ?? appSettings?.stationCallsign ?? 'Not Connected'}</small></div></div>
        <nav className="main-tabs">
          <button className={mainTab === 'logs' ? 'active' : ''} onClick={() => setMainTab('logs')}>Logs</button>
          <button className={mainTab === 'current' ? 'active' : ''} onClick={() => setMainTab('current')} disabled={!currentLogbook}>{currentLogbook?.name ?? 'Current Log'}</button>
          <button className={mainTab === 'settings' ? 'active' : ''} onClick={() => setMainTab('settings')}>Settings</button>
        </nav>
        <div className="header-status"><span>{desktopRuntime ? 'Desktop' : 'Browser'}</span><span>{busy ?? 'Ready'}</span></div>
      </header>

      <main className="app-main">
        <div className="status-banner">{statusMessage}</div>
        {mainTab === 'logs' ? <LogsView {...{ connection, operator, appSettings, logbooks, currentLogbookId, setCurrentLogbookId, setMainTab, busy, setBusy, statusMessage, setStatusMessage, createLogbook, setLogbooks, deleteLogbook, importLogbookAdif, defaultNewLogbook }} /> : null}
        {mainTab === 'current' && currentLogbook ? <CurrentLogView {...{ connection, currentLogbook, logbookTab, setLogbookTab, contacts, spots, selectedSpot, setSelectedSpot, draft, setDraft, lookupResult, rigConnection, rigState, queuedSyncItems, busy, setBusy, setStatusMessage, refreshCurrentLogContacts, refreshLogbooks: () => fetchLogbooks(connection).then(setLogbooks), handleLookupCallsign, handleSaveContact, handleDeleteContact, handleReadRig, handleTuneRig, handleExportAdif, handleUploadQrz, handlePostSpot, readLogbookMeta }} /> : null}
        {mainTab === 'settings' ? <SettingsView {...{ connection, connectionDraft, setConnectionDraft, rigConnection, setRigConnection, settingsForm, setSettingsForm, appSettings, busy, setBusy, setStatusMessage, refreshServerState, handleSaveSettings, handleReadRig, rigState }} /> : null}
      </main>
    </div>
  )

  async function refreshServerState(targetConnection: ClientConnectionSettings) {
    setBusy('Connecting')
    try {
      const [nextOperator, nextLogbooks] = await Promise.all([fetchOperatorProfile(targetConnection), fetchLogbooks(targetConnection)])
      setOperator(nextOperator)
      setLogbooks(nextLogbooks)
      setCurrentLogbookId((current) => current ?? nextLogbooks[0]?.id ?? null)
      try {
        const nextSettings = await fetchAppSettings(targetConnection)
        setAppSettings(nextSettings)
      } catch {
        setAppSettings(null)
      }
      try {
        const nextSpots = await fetchPotaSpots(targetConnection)
        setSpots(nextSpots)
        if (nextSpots.length > 0) {
          setSelectedSpot(nextSpots[0])
        }
      } catch {
        setSpots(fallbackSpots)
      }
      setConnection(targetConnection)
      window.localStorage.setItem(connectionStorageKey, JSON.stringify(targetConnection))
      setStatusMessage(`Connected to ${targetConnection.serverUrl} as ${nextOperator.callsign}.`)
    } catch (error) {
      setStatusMessage(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function refreshCurrentLogContacts(logbookId: string) {
    setContacts(await fetchContacts(connection, logbookId))
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy('Saving Settings')
    try {
      const updated = await updateAppSettings(connection, {
        station_callsign: settingsForm.stationCallsign,
        station_name: settingsForm.stationName,
        my_grid_square: settingsForm.myGridSquare,
        my_state: settingsForm.myState,
        my_county: settingsForm.myCounty,
        qrz_username: settingsForm.qrzUsername,
        qrz_password: settingsForm.qrzPassword || undefined,
        qrz_api_key: settingsForm.qrzApiKey || undefined,
        pota_api_key: settingsForm.potaApiKey || undefined,
      })
      setAppSettings(updated)
      setSettingsForm((current) => ({ ...current, qrzPassword: '', qrzApiKey: '', potaApiKey: '' }))
      setStatusMessage(`Saved settings for ${updated.stationCallsign}.`)
    } catch (error) {
      setStatusMessage(`Settings save failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleLookupCallsign(callsign = draft.stationCallsign, announce = true) {
    setBusy('QRZ Lookup')
    try {
      const result = await lookupCallsign(connection, callsign)
      setLookupResult(result)
      setDraft((current) => ({
        ...current,
        stationCallsign: result.callsign,
        name: result.name ?? current.name,
        qth: result.qth ?? current.qth,
        county: result.county ?? current.county,
        gridSquare: result.gridSquare,
        country: result.country ?? current.country,
        state: result.state ?? current.state,
        dxcc: result.dxcc ?? current.dxcc,
        lat: result.lat ?? current.lat,
        lon: result.lon ?? current.lon,
      }))
      if (announce) {
        setStatusMessage(`QRZ lookup completed for ${result.callsign}.`)
      }
    } catch (error) {
      if (announce) {
        setStatusMessage(`QRZ lookup failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleSaveContact() {
    if (!currentLogbookId) return
    setBusy('Saving QSO')
    try {
      await createContact(connection, { ...draft, logbookId: currentLogbookId, band: bandFromFrequencyKhz(draft.frequencyKhz) || draft.band })
      await refreshCurrentLogContacts(currentLogbookId)
      setLogbooks(await fetchLogbooks(connection))
      setDraft((current) => ({ ...current, stationCallsign: '', rstSent: '59', rstRcvd: '59', name: undefined, qth: undefined, county: undefined, gridSquare: undefined, country: undefined, state: undefined, dxcc: undefined, lat: undefined, lon: undefined }))
      setLookupResult(null)
      lastAutoLookupRef.current = ''
      setStatusMessage('Saved QSO.')
    } catch (error) {
      if (shouldQueueMutation(error)) {
        setQueuedSyncItems((current) => [{ id: createMutationId(), entityType: 'contact', action: 'create', createdAt: new Date().toISOString(), payloadSummary: `Queued QSO with ${draft.stationCallsign}`, payload: { ...draft, logbookId: currentLogbookId } }, ...current])
        setStatusMessage(`Queued QSO with ${draft.stationCallsign}.`)
      } else {
        setStatusMessage(`Save failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleReadRig() {
    setBusy('Reading Rig')
    try {
      const state = await readFlrigState(rigConnection)
      setRigState(state)
      setStatusMessage(`Connected to ${state.radioName ?? state.endpoint}.`)
    } catch (error) {
      setStatusMessage(`Rig read failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleTuneRig() {
    setBusy('Tuning Rig')
    try {
      const result = await tuneFlrig(rigConnection, { frequencyHz: selectedSpot.frequencyKhz * 1000, mode: selectedSpot.mode })
      setStatusMessage(result.message)
      if (result.ok) setRigState(await readFlrigState(rigConnection))
    } catch (error) {
      setStatusMessage(`Rig tune failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleExportAdif() {
    if (!currentLogbookId || !currentLogbook) return
    setBusy('Exporting ADIF')
    try {
      const adif = await exportLogbookAdif(connection, currentLogbookId)
      const blob = new Blob([adif], { type: 'text/plain;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${currentLogbook.name.replace(/\s+/g, '-').toLowerCase()}.adi`
      link.click()
      window.URL.revokeObjectURL(url)
      setStatusMessage(`Exported ADIF for ${currentLogbook.name}.`)
    } finally {
      setBusy(null)
    }
  }

  async function handleUploadQrz() {
    if (!currentLogbookId) return
    setBusy('Uploading QRZ')
    try {
      const result = await uploadLogbookToQrz(connection, currentLogbookId)
      setStatusMessage(result.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleDeleteContact(contact: Contact) {
    if (!currentLogbookId) return
    setBusy('Deleting QSO')
    try {
      await deleteContact(connection, contact.id)
      await refreshCurrentLogContacts(currentLogbookId)
      setLogbooks(await fetchLogbooks(connection))
      setStatusMessage(`Deleted QSO with ${contact.stationCallsign}.`)
    } catch (error) {
      setStatusMessage(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function handlePostSpot(selfSpot: boolean, comment: string) {
    setBusy('Posting Spot')
    try {
      const created = await createPotaSpot(connection, { activatorCallsign: selfSpot ? (operator?.callsign ?? draft.operatorCallsign) : selectedSpot.activatorCallsign, parkReference: selectedSpot.parkReference, frequencyKhz: selectedSpot.frequencyKhz, mode: selectedSpot.mode, band: selectedSpot.band, comments: comment, spotterCallsign: operator?.callsign ?? draft.operatorCallsign })
      setSpots((current) => [created, ...current.filter((spot) => spot.id !== created.id)].slice(0, 20))
      setStatusMessage(`Posted spot for ${created.activatorCallsign}.`)
    } catch (error) {
      setStatusMessage(`Spot post failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }
}

export default App
