import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { LogsView } from './components/LogsView'
import { CurrentLogView } from './components/CurrentLogView'
import { SettingsView } from './components/SettingsView'
import { draftFromSpot } from './data/mockData'
import { spots as fallbackSpots } from './data/mockData'
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
  getPreferredEndpoint,
  importLogbookAdif,
  probeServerCertificate,
  lookupCallsign,
  updateContact,
  uploadLogbookToQrz,
  updateAppSettings,
} from './services/api'
import { isDesktopRuntime } from './services/desktop'
import { desktopStoreGet, desktopStoreSet } from './services/desktopStore'
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

export const defaultConnection: ClientConnectionSettings = { serverUrl: 'http://127.0.0.1:8000/api/v1', additionalServerUrls: '', apiToken: '', adminToken: '', pinnedFingerprint: '' }
export const defaultRigConnection: RigConnectionSettings = { endpoint: 'http://127.0.0.1:12345' }
export const defaultNewLogbook: NewLogbookForm = { name: '', kind: 'standard', potaMode: 'hunting', parkReference: '', activationDate: '' }

export function loadStored<T>(key: string, fallback: T) {
  const saved = window.localStorage.getItem(key)
  return saved ? (JSON.parse(saved) as T) : fallback
}

export function createMutationId() {
  return `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cacheScope(connection: ClientConnectionSettings) {
  return connection.serverUrl.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
}

function logbooksCacheKey(connection: ClientConnectionSettings) {
  return `longwave-logbooks-cache:${cacheScope(connection)}`
}

function operatorCacheKey(connection: ClientConnectionSettings) {
  return `longwave-operator-cache:${cacheScope(connection)}`
}

function settingsCacheKey(connection: ClientConnectionSettings) {
  return `longwave-settings-cache:${cacheScope(connection)}`
}

function contactsCacheKey(connection: ClientConnectionSettings, logbookId: string) {
  return `longwave-contacts-cache:${cacheScope(connection)}:${logbookId}`
}

function currentLogbookStorageKey(connection: ClientConnectionSettings) {
  return `longwave-current-logbook:${cacheScope(connection)}`
}

async function getStoredValue<T>(key: string, fallback: T, desktopRuntime: boolean) {
  if (desktopRuntime) {
    const desktopValue = await desktopStoreGet<T>(key)
    if (desktopValue !== null) {
      return desktopValue
    }
  }
  return loadStored<T>(key, fallback)
}

function applyPendingMutationsToContacts(
  contacts: Contact[],
  queuedSyncItems: PendingMutation[],
  logbookId: string,
) {
  let nextContacts = [...contacts]

  for (const mutation of queuedSyncItems) {
    if (mutation.entityType !== 'contact') {
      continue
    }

    if (mutation.action === 'create' && mutation.payload.logbookId === logbookId) {
      const queuedContact = createQueuedContact(mutation.payload, mutation.id)
      if (!nextContacts.some((contact) => contact.id === queuedContact.id)) {
        nextContacts = [queuedContact, ...nextContacts]
      }
    }

    if (mutation.action === 'delete' && mutation.payload.logbookId === logbookId) {
      nextContacts = nextContacts.filter((contact) => contact.id !== mutation.payload.contactId)
    }
  }

  return nextContacts
}

function remapQueuedMutationsLogbookId(
  queuedSyncItems: PendingMutation[],
  fromLogbookId: string,
  toLogbookId: string,
) {
  return queuedSyncItems.map((mutation) => {
    if (mutation.entityType === 'logbook' && mutation.action === 'create' && mutation.payload.localLogbookId === fromLogbookId) {
      return mutation
    }

    if (mutation.entityType === 'contact' && mutation.action === 'create' && mutation.payload.logbookId === fromLogbookId) {
      return {
        ...mutation,
        payload: {
          ...mutation.payload,
          logbookId: toLogbookId,
        },
      }
    }

    if (mutation.entityType === 'contact' && mutation.action === 'delete' && mutation.payload.logbookId === fromLogbookId) {
      return {
        ...mutation,
        payload: {
          ...mutation.payload,
          logbookId: toLogbookId,
        },
      }
    }

    return mutation
  })
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

function isMissingContactError(error: unknown) {
  return error instanceof Error && /contact not found/i.test(error.message)
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

function utcStampParts() {
  const now = new Date()
  const qsoDate = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`
  const timeOn = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`
  return { qsoDate, timeOn }
}

function createEmptyDraft(operatorCallsign = 'N0CALL', logbookId = ''): ContactDraft {
  const { qsoDate, timeOn } = utcStampParts()
  return {
    stationCallsign: '',
    operatorCallsign,
    logbookId,
    qsoDate,
    timeOn,
    mode: 'SSB',
    frequencyKhz: 14250,
    band: bandFromFrequencyKhz(14250),
    rstSent: '59',
    rstRcvd: '59',
    txPower: '',
    name: undefined,
    qth: undefined,
    county: undefined,
    parkReference: undefined,
    gridSquare: undefined,
    country: undefined,
    state: undefined,
    dxcc: undefined,
    lat: undefined,
    lon: undefined,
  }
}

function createQueuedContact(draft: ContactDraft, mutationId: string): Contact {
  return {
    id: `queued-${mutationId}`,
    logbookId: draft.logbookId,
    stationCallsign: draft.stationCallsign,
    operatorCallsign: draft.operatorCallsign,
    qsoDate: draft.qsoDate,
    timeOn: draft.timeOn,
    band: bandFromFrequencyKhz(draft.frequencyKhz) || draft.band,
    mode: draft.mode,
    frequencyKhz: draft.frequencyKhz,
    rstSent: draft.rstSent,
    rstRcvd: draft.rstRcvd,
    txPower: draft.txPower,
    name: draft.name,
    qth: draft.qth,
    county: draft.county,
    parkReference: draft.parkReference,
    gridSquare: draft.gridSquare,
    country: draft.country,
    state: draft.state,
    dxcc: draft.dxcc,
    lat: draft.lat,
    lon: draft.lon,
  }
}

function draftFromContact(contact: Contact): ContactDraft {
  return {
    stationCallsign: contact.stationCallsign,
    operatorCallsign: contact.operatorCallsign,
    logbookId: contact.logbookId,
    qsoDate: contact.qsoDate,
    timeOn: contact.timeOn,
    mode: contact.mode,
    frequencyKhz: contact.frequencyKhz,
    band: contact.band,
    rstSent: contact.rstSent,
    rstRcvd: contact.rstRcvd,
    txPower: contact.txPower,
    name: contact.name,
    qth: contact.qth,
    county: contact.county,
    parkReference: contact.parkReference,
    gridSquare: contact.gridSquare,
    country: contact.country,
    state: contact.state,
    dxcc: contact.dxcc,
    lat: contact.lat,
    lon: contact.lon,
  }
}

function createOfflineLogbookId() {
  return `offline-logbook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sameConnection(a: ClientConnectionSettings, b: ClientConnectionSettings) {
  return (
    a.serverUrl === b.serverUrl &&
    (a.additionalServerUrls ?? '') === (b.additionalServerUrls ?? '') &&
    a.apiToken === b.apiToken &&
    (a.adminToken ?? '') === (b.adminToken ?? '') &&
    (a.pinnedFingerprint ?? '') === (b.pinnedFingerprint ?? '')
  )
}

function App() {
  const initialConnection = { ...defaultConnection, ...loadStored(connectionStorageKey, defaultConnection) }
  const initialRigConnection = loadStored(rigStorageKey, defaultRigConnection)
  const desktopRuntime = isDesktopRuntime()
  const lastAutoLookupRef = useRef('')
  const syncInFlightRef = useRef(false)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [mainTab, setMainTab] = useState<MainTab>('logs')
  const [logbookTab, setLogbookTab] = useState<LogbookSubTab>('qsos')
  const [connection, setConnection] = useState<ClientConnectionSettings>(initialConnection)
  const [connectionDraft, setConnectionDraft] = useState<ClientConnectionSettings>(initialConnection)
  const [activeServerUrl, setActiveServerUrl] = useState(initialConnection.serverUrl)
  const [rigConnection, setRigConnection] = useState<RigConnectionSettings>(initialRigConnection)
  const [operator, setOperator] = useState<OperatorProfile | null>(() => loadStored(operatorCacheKey(initialConnection), null))
  const [appSettings, setAppSettings] = useState<AppSettings | null>(() => loadStored(settingsCacheKey(initialConnection), null))
  const [logbooks, setLogbooks] = useState<Logbook[]>(() => loadStored(logbooksCacheKey(initialConnection), []))
  const [currentLogbookId, setCurrentLogbookId] = useState<string | null>(() => loadStored(currentLogbookStorageKey(initialConnection), null))
  const [contacts, setContacts] = useState<Contact[]>([])
  const [spots, setSpots] = useState<Spot[]>(fallbackSpots)
  const [selectedSpot, setSelectedSpot] = useState<Spot>(fallbackSpots[0])
  const [draft, setDraft] = useState<ContactDraft>(() => createEmptyDraft())
  const [lookupResult, setLookupResult] = useState<CallsignLookup | null>(null)
  const [rigState, setRigState] = useState<RigState | null>(null)
  const [queuedSyncItems, setQueuedSyncItems] = useState<PendingMutation[]>(() => loadStored(queueStorageKey, []))
  const [statusMessage, setStatusMessage] = useState('Connect to your server and choose a logbook to begin.')
  const [busy, setBusy] = useState<string | null>(null)
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [settingsForm, setSettingsForm] = useState<ServerSettingsForm>({ stationCallsign: '', stationName: '', myGridSquare: '', myState: '', myCounty: '', qrzUsername: '', qrzPassword: '', qrzApiKey: '' })
  const [desktopCacheReady, setDesktopCacheReady] = useState(() => !desktopRuntime)

  const currentLogbook = useMemo(() => logbooks.find((logbook) => logbook.id === currentLogbookId) ?? null, [logbooks, currentLogbookId])

  function persistValue<T>(key: string, value: T) {
    window.localStorage.setItem(key, JSON.stringify(value))
    if (desktopCacheReady) {
      void desktopStoreSet(key, value)
    }
  }

  useEffect(() => {
    if (!desktopRuntime) {
      return
    }

    let cancelled = false

    async function hydrateDesktopState() {
      const [
        storedQueue,
        storedRig,
        storedOperator,
        storedSettings,
        storedLogbooks,
        storedCurrentLogbookId,
      ] = await Promise.all([
        desktopStoreGet<PendingMutation[]>(queueStorageKey),
        desktopStoreGet<RigConnectionSettings>(rigStorageKey),
        desktopStoreGet<OperatorProfile | null>(operatorCacheKey(initialConnection)),
        desktopStoreGet<AppSettings | null>(settingsCacheKey(initialConnection)),
        desktopStoreGet<Logbook[]>(logbooksCacheKey(initialConnection)),
        desktopStoreGet<string | null>(currentLogbookStorageKey(initialConnection)),
      ])

      if (cancelled) {
        return
      }

      if (storedQueue) setQueuedSyncItems(storedQueue)
      if (storedRig) setRigConnection(storedRig)
      if (storedOperator !== null) setOperator(storedOperator)
      if (storedSettings !== null) setAppSettings(storedSettings)
      if (storedLogbooks) setLogbooks(storedLogbooks)
      if (storedCurrentLogbookId) {
        setCurrentLogbookId(storedCurrentLogbookId)
        const storedContacts = await desktopStoreGet<Contact[]>(
          contactsCacheKey(initialConnection, storedCurrentLogbookId),
        )
        if (!cancelled && storedContacts) {
          setContacts(storedContacts)
        }
      }
      setDesktopCacheReady(true)
    }

    void hydrateDesktopState()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    persistValue(queueStorageKey, queuedSyncItems)
  }, [desktopCacheReady, queuedSyncItems])
  useEffect(() => {
    persistValue(rigStorageKey, rigConnection)
  }, [desktopCacheReady, rigConnection])
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  useEffect(() => {
    const key = logbooksCacheKey(connection)
    persistValue(key, logbooks)
  }, [connection, desktopCacheReady, logbooks])
  useEffect(() => {
    const key = operatorCacheKey(connection)
    persistValue(key, operator)
  }, [connection, desktopCacheReady, operator])
  useEffect(() => {
    const key = settingsCacheKey(connection)
    persistValue(key, appSettings)
  }, [appSettings, connection, desktopCacheReady])
  useEffect(() => {
    if (!currentLogbookId) return
    const key = currentLogbookStorageKey(connection)
    persistValue(key, currentLogbookId)
  }, [connection, currentLogbookId, desktopCacheReady])
  useEffect(() => { if (appSettings) setSettingsForm((current) => ({ ...current, stationCallsign: appSettings.stationCallsign, stationName: appSettings.stationName, myGridSquare: appSettings.myGridSquare ?? '', myState: appSettings.myState ?? '', myCounty: appSettings.myCounty ?? '', qrzUsername: appSettings.qrzUsername ?? '' })) }, [appSettings])
  useEffect(() => { if (connection.apiToken) void refreshServerState(connection) }, [])
  useEffect(() => {
    const preferredOperator = currentLogbook?.operatorCallsign || operator?.callsign || appSettings?.stationCallsign
    if (!preferredOperator) return
    const logbookMeta = currentLogbook ? readLogbookMeta(currentLogbook) : null
    setDraft((current) => {
      const nextLogbookId = currentLogbookId ?? current.logbookId
      const nextParkReference = logbookMeta?.kind === 'pota' ? current.parkReference : undefined
      if (
        current.operatorCallsign === preferredOperator
        && current.logbookId === nextLogbookId
        && current.parkReference === nextParkReference
      ) {
        return current
      }
      return {
        ...current,
        operatorCallsign: preferredOperator,
        logbookId: nextLogbookId,
        parkReference: nextParkReference,
      }
    })
  }, [currentLogbook, currentLogbookId, operator?.callsign, appSettings?.stationCallsign])
  useEffect(() => {
    if (!currentLogbookId) return
    const logbookId = currentLogbookId

    let cancelled = false

    async function hydrateCurrentLogbook() {
      const cachedContacts = await getStoredValue<Contact[]>(
        contactsCacheKey(connection, logbookId),
        [],
        desktopRuntime,
      )

      if (cancelled) {
        return
      }

      setContacts(applyPendingMutationsToContacts(cachedContacts, queuedSyncItems, logbookId))

      if (!connection.apiToken || !isOnline) {
        return
      }

      await refreshCurrentLogContacts(logbookId)
    }

    void hydrateCurrentLogbook()

    return () => {
      cancelled = true
    }
  }, [connection, connection.apiToken, currentLogbookId, desktopRuntime, isOnline, queuedSyncItems])
  useEffect(() => {
    if (!connection.apiToken || queuedSyncItems.length === 0 || syncInFlightRef.current || !isOnline) {
      return
    }

    const queuedMutation = queuedSyncItems[queuedSyncItems.length - 1]
    syncInFlightRef.current = true

    void (async () => {
      try {
        if (queuedMutation.entityType === 'logbook' && queuedMutation.action === 'create') {
          const created = await createLogbook(connection, queuedMutation.payload.draft)
          setLogbooks((current) => current.map((logbook) => (
            logbook.id === queuedMutation.payload.localLogbookId
              ? { ...created, syncState: 'synced' }
              : logbook
          )))
          if (currentLogbookId === queuedMutation.payload.localLogbookId) {
            setCurrentLogbookId(created.id)
          }
          if (draft.logbookId === queuedMutation.payload.localLogbookId) {
            setDraft((current) => ({ ...current, logbookId: created.id }))
          }
          const localContacts = await getStoredValue<Contact[]>(
            contactsCacheKey(connection, queuedMutation.payload.localLogbookId),
            [],
            desktopRuntime,
          )
          persistValue(contactsCacheKey(connection, created.id), localContacts.map((contact) => ({ ...contact, logbookId: created.id })))
          setQueuedSyncItems((current) =>
            remapQueuedMutationsLogbookId(
              current.filter((item) => item.id !== queuedMutation.id),
              queuedMutation.payload.localLogbookId,
              created.id,
            ),
          )
          setStatusMessage(`Synced offline logbook ${created.name}.`)
        } else if (queuedMutation.entityType === 'contact' && queuedMutation.action === 'create') {
          await createContact(connection, queuedMutation.payload)
          if (currentLogbookId === queuedMutation.payload.logbookId) {
            await refreshCurrentLogContacts(queuedMutation.payload.logbookId)
          }
          setLogbooks(await fetchLogbooks(connection))
          setQueuedSyncItems((current) => current.filter((item) => item.id !== queuedMutation.id))
          setStatusMessage(`Synced queued QSO with ${queuedMutation.payload.stationCallsign}.`)
        } else if (queuedMutation.entityType === 'contact' && queuedMutation.action === 'delete') {
          try {
            await deleteContact(connection, queuedMutation.payload.contactId)
          } catch (error) {
            if (!isMissingContactError(error)) {
              throw error
            }
          }
          if (currentLogbookId === queuedMutation.payload.logbookId) {
            await refreshCurrentLogContacts(queuedMutation.payload.logbookId)
          }
          setLogbooks(await fetchLogbooks(connection))
          setQueuedSyncItems((current) => current.filter((item) => item.id !== queuedMutation.id))
          setStatusMessage(`Synced queued delete for ${queuedMutation.payload.stationCallsign}.`)
        } else if (queuedMutation.entityType === 'spot' && queuedMutation.action === 'create') {
          await createPotaSpot(connection, queuedMutation.payload)
          setQueuedSyncItems((current) => current.filter((item) => item.id !== queuedMutation.id))
          setStatusMessage(`Synced queued spot for ${queuedMutation.payload.activatorCallsign}.`)
        }
      } catch (error) {
        if (!shouldQueueMutation(error)) {
          setStatusMessage(`Queued sync failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
        }
      } finally {
        syncInFlightRef.current = false
      }
    })()
  }, [connection, currentLogbookId, isOnline, queuedSyncItems])
  useEffect(() => {
    if (!isOnline || !connection.apiToken) {
      return
    }
    if (queuedSyncItems.length > 0) {
      return
    }
    void refreshServerState(connection)
  }, [connection, isOnline, queuedSyncItems.length])
  useEffect(() => {
    if (!connection.apiToken) {
      return
    }

    let cancelled = false

    async function syncWorkingCopySilently() {
      if (document.visibilityState === 'hidden' || !navigator.onLine || queuedSyncItems.length > 0) {
        return
      }

      try {
        await syncLocalMirror(connection, currentLogbookId, cancelled)
      } catch {
        // Keep background sync quiet; explicit actions still surface errors.
      }
    }

    const intervalId = window.setInterval(() => {
      void syncWorkingCopySilently()
    }, 60000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncWorkingCopySilently()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [connection, currentLogbookId, queuedSyncItems.length])
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
        {mainTab === 'logs' ? <LogsView {...{ connection, isOnline, operator, appSettings, logbooks, currentLogbookId, setCurrentLogbookId, setMainTab, busy, setBusy, statusMessage, setStatusMessage, createLogbook, createOfflineLogbook: handleCreateOfflineLogbook, setLogbooks, deleteLogbook, importLogbookAdif, defaultNewLogbook }} /> : null}
        {mainTab === 'current' && currentLogbook ? <CurrentLogView {...{ connection, currentLogbook, logbookTab, setLogbookTab, contacts, spots, selectedSpot, setSelectedSpot, draft, setDraft, lookupResult, rigConnection, rigState, isOnline, queuedSyncItems, busy, setBusy, setStatusMessage, refreshCurrentLogContacts, refreshLogbooks: () => fetchLogbooks(connection).then(setLogbooks), handleLookupCallsign, handleSaveContact, handleDeleteContact, handleReadRig, handleTuneRig, handleExportAdif, handleUploadQrz, handlePostSpot, readLogbookMeta, editingContactId, handleEditContact, handleCancelEdit }} /> : null}
        {mainTab === 'settings' ? <SettingsView {...{ connection, connectionDraft, activeServerUrl, setConnectionDraft, handleSaveLocalConnection, rigConnection, setRigConnection, settingsForm, setSettingsForm, appSettings, busy, setBusy, setStatusMessage, refreshServerState, handleSaveSettings, saveServerSettings, handleTrustServer, handleReadRig, rigState }} /> : null}
      </main>
    </div>
  )

  async function refreshServerState(targetConnection: ClientConnectionSettings) {
    setBusy('Connecting')
    try {
      const [nextOperator, nextLogbooks] = await Promise.all([fetchOperatorProfile(targetConnection), fetchLogbooks(targetConnection)])
      const activeEndpoint = getPreferredEndpoint(targetConnection)
      setOperator(nextOperator)
      setLogbooks(nextLogbooks)
      const storedCurrentLogbookId = loadStored<string | null>(currentLogbookStorageKey(targetConnection), null)
      setCurrentLogbookId((current) => {
        const preferredLogbookId = current ?? storedCurrentLogbookId
        if (preferredLogbookId && nextLogbooks.some((logbook) => logbook.id === preferredLogbookId)) {
          return preferredLogbookId
        }
        return nextLogbooks[0]?.id ?? null
      })
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
      setActiveServerUrl(activeEndpoint)
      setConnection(targetConnection)
      setConnectionDraft((current) => (sameConnection(current, targetConnection) ? current : targetConnection))
      persistValue(connectionStorageKey, targetConnection)
      await syncLocalMirror(targetConnection, storedCurrentLogbookId ?? nextLogbooks[0]?.id ?? null)
      setStatusMessage(`Connected to ${activeEndpoint} as ${nextOperator.callsign}.`)
    } catch (error) {
      const cachedOperator = await getStoredValue<OperatorProfile | null>(
        operatorCacheKey(targetConnection),
        null,
        desktopRuntime,
      )
      const cachedSettings = await getStoredValue<AppSettings | null>(
        settingsCacheKey(targetConnection),
        null,
        desktopRuntime,
      )
      const cachedLogbooks = await getStoredValue<Logbook[]>(
        logbooksCacheKey(targetConnection),
        [],
        desktopRuntime,
      )
      if (cachedOperator || cachedSettings || cachedLogbooks.length > 0) {
        setOperator(cachedOperator)
        setAppSettings(cachedSettings)
        setLogbooks(cachedLogbooks)
        const storedCurrentLogbookId = await getStoredValue<string | null>(
          currentLogbookStorageKey(targetConnection),
          null,
          desktopRuntime,
        )
        let nextLogbookId: string | null = null
        setCurrentLogbookId((current) => {
          const preferredLogbookId = current ?? storedCurrentLogbookId
          if (preferredLogbookId && cachedLogbooks.some((logbook) => logbook.id === preferredLogbookId)) {
            nextLogbookId = preferredLogbookId
            return preferredLogbookId
          }
          nextLogbookId = cachedLogbooks[0]?.id ?? null
          return nextLogbookId
        })
        if (nextLogbookId) {
          const cachedContacts = await getStoredValue<Contact[]>(
            contactsCacheKey(targetConnection, nextLogbookId),
            [],
            desktopRuntime,
          )
          setContacts(cachedContacts)
        }
        setConnection(targetConnection)
        setConnectionDraft((current) => (sameConnection(current, targetConnection) ? current : targetConnection))
        persistValue(connectionStorageKey, targetConnection)
        setStatusMessage(`Offline. Using cached data for ${cachedOperator?.callsign ?? cachedSettings?.stationCallsign ?? 'this server'}.`)
      } else {
        setStatusMessage(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function handleTrustServer() {
    setBusy('Trusting Server')
    try {
      const result = await probeServerCertificate(connectionDraft)
      const updatedConnection = {
        ...connectionDraft,
        pinnedFingerprint: result.fingerprint,
      }
      setActiveServerUrl(result.endpoint)
      setConnectionDraft(updatedConnection)
      persistValue(connectionStorageKey, updatedConnection)
      setStatusMessage(`Trusted server certificate from ${result.endpoint}.`)
    } catch (error) {
      setStatusMessage(`Server trust failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  function handleSaveLocalConnection() {
    setConnection(connectionDraft)
    persistValue(connectionStorageKey, connectionDraft)
    setActiveServerUrl(getPreferredEndpoint(connectionDraft))
    setStatusMessage('Saved local desktop settings.')
  }

  async function refreshCurrentLogContacts(logbookId: string) {
    try {
      const nextContacts = await fetchContacts(connection, logbookId)
      setContacts(applyPendingMutationsToContacts(nextContacts, queuedSyncItems, logbookId))
      persistValue(contactsCacheKey(connection, logbookId), nextContacts)
    } catch (error) {
      const cachedContacts = await getStoredValue<Contact[]>(
        contactsCacheKey(connection, logbookId),
        [],
        desktopRuntime,
      )
      setContacts(applyPendingMutationsToContacts(cachedContacts, queuedSyncItems, logbookId))
      if (cachedContacts.length > 0) {
        setStatusMessage(`Offline. Showing cached QSOs for ${currentLogbook?.name ?? 'this logbook'}.`)
        return
      }
      if (shouldQueueMutation(error)) {
        setStatusMessage(`Offline. No cached QSOs are stored yet for ${currentLogbook?.name ?? 'this logbook'}.`)
        return
      }
      throw error
    }
  }

  async function syncLocalMirror(targetConnection: ClientConnectionSettings, targetLogbookId: string | null, cancelled = false) {
    const [nextOperator, nextLogbooks] = await Promise.all([
      fetchOperatorProfile(targetConnection),
      fetchLogbooks(targetConnection),
    ])

    if (cancelled) {
      return
    }

    setOperator(nextOperator)
    setLogbooks(nextLogbooks)
    persistValue(operatorCacheKey(targetConnection), nextOperator)
    persistValue(logbooksCacheKey(targetConnection), nextLogbooks)

    try {
      const nextSettings = await fetchAppSettings(targetConnection)
      if (!cancelled) {
        setAppSettings(nextSettings)
        persistValue(settingsCacheKey(targetConnection), nextSettings)
      }
    } catch {
      // Admin settings may be unavailable; keep the last cached copy.
    }

    for (const logbook of nextLogbooks) {
      if (cancelled) {
        return
      }

      try {
        const nextContacts = await fetchContacts(targetConnection, logbook.id)
        persistValue(contactsCacheKey(targetConnection, logbook.id), nextContacts)
        if (logbook.id === targetLogbookId) {
          setContacts(nextContacts)
        }
      } catch {
        const cachedContacts = loadStored<Contact[]>(contactsCacheKey(targetConnection, logbook.id), [])
        if (logbook.id === targetLogbookId && cachedContacts.length > 0) {
          setContacts(cachedContacts)
        }
      }
    }

    if (targetLogbookId && !nextLogbooks.some((logbook) => logbook.id === targetLogbookId)) {
      setCurrentLogbookId(nextLogbooks[0]?.id ?? null)
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await saveServerSettings()
  }

  async function saveServerSettings() {
    setBusy('Saving Settings')
      try {
        const targetConnection = connectionDraft
        if (!sameConnection(connection, targetConnection)) {
          setConnection(targetConnection)
          persistValue(connectionStorageKey, targetConnection)
        }
        setActiveServerUrl(getPreferredEndpoint(targetConnection))

        const updated = await updateAppSettings(targetConnection, {
        station_callsign: settingsForm.stationCallsign,
        station_name: settingsForm.stationName,
        my_grid_square: settingsForm.myGridSquare,
        my_state: settingsForm.myState,
        my_county: settingsForm.myCounty,
        qrz_username: settingsForm.qrzUsername,
        qrz_password: settingsForm.qrzPassword || undefined,
        qrz_api_key: settingsForm.qrzApiKey || undefined,
      })
      const [nextOperator, nextLogbooks] = await Promise.all([
        fetchOperatorProfile(targetConnection),
        fetchLogbooks(targetConnection),
      ])
      setAppSettings(updated)
      setOperator(nextOperator)
      setLogbooks(nextLogbooks)
      setSettingsForm((current) => ({ ...current, qrzPassword: '', qrzApiKey: '' }))
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

  function handleCreateOfflineLogbook(newLogbook: NewLogbookForm) {
    const operatorCallsign = operator?.callsign ?? appSettings?.stationCallsign ?? 'N0CALL'
    const logbookId = createOfflineLogbookId()
    const created: Logbook = {
      id: logbookId,
      name: newLogbook.name || `Offline log ${new Date().toLocaleDateString()}`,
      operatorCallsign,
      parkReference: newLogbook.kind === 'pota' ? newLogbook.parkReference || undefined : undefined,
      activationDate: newLogbook.activationDate || undefined,
      notes: encodeLogbookNotes(newLogbook.kind, newLogbook.potaMode),
      contactCount: 0,
      syncState: 'pending',
    }

    setLogbooks((current) => [created, ...current])
    setCurrentLogbookId(created.id)
    setMainTab('current')
    persistValue(contactsCacheKey(connection, created.id), [] as Contact[])
    setQueuedSyncItems((current) => [{
      id: createMutationId(),
      entityType: 'logbook',
      action: 'create',
      createdAt: new Date().toISOString(),
      payloadSummary: `Queued logbook ${created.name}`,
      payload: {
        localLogbookId: created.id,
        draft: {
          name: created.name,
          operatorCallsign,
          parkReference: created.parkReference,
          activationDate: created.activationDate,
          notes: created.notes,
        },
      },
    }, ...current])
    setStatusMessage(`Created offline logbook ${created.name}. It will sync when the server is reachable.`)
  }

  async function handleSaveContact() {
    if (!currentLogbookId) return
    setBusy('Saving QSO')
    try {
      const currentMeta = currentLogbook ? readLogbookMeta(currentLogbook) : null
      const payload = {
        ...draft,
        logbookId: currentLogbookId,
        band: bandFromFrequencyKhz(draft.frequencyKhz) || draft.band,
        parkReference: currentMeta?.kind === 'pota' ? draft.parkReference : undefined,
      }
      if (editingContactId) {
        await updateContact(connection, editingContactId, payload)
      } else {
        await createContact(connection, payload)
      }
      await refreshCurrentLogContacts(currentLogbookId)
      setLogbooks(await fetchLogbooks(connection))
      const nextMeta = currentLogbook ? readLogbookMeta(currentLogbook) : null
      setDraft((current) => ({
        ...createEmptyDraft(current.operatorCallsign, currentLogbookId),
        txPower: current.txPower,
        parkReference: nextMeta?.kind === 'pota' ? current.parkReference : undefined,
      }))
      setEditingContactId(null)
      setLookupResult(null)
      lastAutoLookupRef.current = ''
      setStatusMessage(editingContactId ? 'Updated QSO.' : 'Saved QSO.')
    } catch (error) {
      if (editingContactId && shouldQueueMutation(error)) {
        setStatusMessage('Offline QSO editing is not supported yet. Reconnect and try again.')
      } else if (!editingContactId && shouldQueueMutation(error)) {
        const mutationId = createMutationId()
        const queuedDraft = { ...draft, logbookId: currentLogbookId }
        setQueuedSyncItems((current) => [{ id: mutationId, entityType: 'contact', action: 'create', createdAt: new Date().toISOString(), payloadSummary: `Queued QSO with ${draft.stationCallsign}`, payload: queuedDraft }, ...current])
        setContacts((current) => [createQueuedContact(queuedDraft, mutationId), ...current])
        setLogbooks((current) => current.map((logbook) => (
          logbook.id === currentLogbookId
            ? { ...logbook, contactCount: logbook.contactCount + 1, syncState: 'pending' }
            : logbook
        )))
        setStatusMessage(`Queued QSO with ${draft.stationCallsign}.`)
      } else {
        setStatusMessage(`Save failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  function handleEditContact(contact: Contact) {
    setDraft({
      ...draftFromContact(contact),
      logbookId: currentLogbookId ?? contact.logbookId,
    })
    setEditingContactId(contact.id)
    setLookupResult(null)
    lastAutoLookupRef.current = ''
    setStatusMessage(`Editing QSO with ${contact.stationCallsign}.`)
  }

  function handleCancelEdit() {
    const nextMeta = currentLogbook ? readLogbookMeta(currentLogbook) : null
    const operatorCallsign = draft.operatorCallsign || currentLogbook?.operatorCallsign || operator?.callsign || appSettings?.stationCallsign || 'N0CALL'
    setDraft((current) => ({
      ...createEmptyDraft(operatorCallsign, currentLogbookId ?? current.logbookId),
      txPower: current.txPower,
      parkReference: nextMeta?.kind === 'pota' ? current.parkReference : undefined,
    }))
    setEditingContactId(null)
    setLookupResult(null)
    lastAutoLookupRef.current = ''
    setStatusMessage('Canceled QSO edit.')
  }

  async function handleReadRig() {
    setBusy('Reading Rig')
    try {
      const state = await readFlrigState(rigConnection)
      setRigState(state)
      if (typeof state.frequencyHz === 'number' || state.mode) {
        setDraft((current) => {
          const nextFrequencyKhz = typeof state.frequencyHz === 'number' ? state.frequencyHz / 1000 : current.frequencyKhz
          const nextMode = state.mode ? state.mode.toUpperCase() : current.mode
          return {
            ...current,
            frequencyKhz: nextFrequencyKhz,
            band: bandFromFrequencyKhz(nextFrequencyKhz) || current.band,
            mode: nextMode,
          }
        })
      }
      setStatusMessage(`Read ${state.radioName ?? state.endpoint}${typeof state.frequencyHz === 'number' ? ` at ${(state.frequencyHz / 1000).toFixed(3)} MHz` : ''}${state.mode ? ` ${state.mode}` : ''}.`)
    } catch (error) {
      setStatusMessage(`Rig read failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleTuneRig(spot?: Spot) {
    setBusy('Tuning Rig')
    try {
      const targetSpot = spot ?? selectedSpot
      const targetFrequencyHz = spot ? targetSpot.frequencyKhz * 1000 : draft.frequencyKhz * 1000
      const targetMode = (spot ? targetSpot.mode : draft.mode).toUpperCase()
      if (spot) {
        setSelectedSpot(targetSpot)
        setDraft((current) => ({
          ...draftFromSpot(targetSpot, current.operatorCallsign, currentLogbookId ?? current.logbookId),
          stationCallsign: targetSpot.activatorCallsign,
          operatorCallsign: current.operatorCallsign,
        }))
      }
      const result = await tuneFlrig(rigConnection, { frequencyHz: targetFrequencyHz, mode: targetMode })
      setStatusMessage(result.message)
      if (result.ok) {
        const state = await readFlrigState(rigConnection)
        setRigState(state)
      }
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
      if (editingContactId === contact.id) {
        handleCancelEdit()
      }
      setStatusMessage(`Deleted QSO with ${contact.stationCallsign}.`)
    } catch (error) {
      if (shouldQueueMutation(error)) {
        if (contact.id.startsWith('queued-mutation-')) {
          const mutationId = contact.id.replace(/^queued-/, '')
          setQueuedSyncItems((current) => current.filter((item) => item.id !== mutationId))
          setContacts((current) => current.filter((item) => item.id !== contact.id))
          setLogbooks((current) => current.map((logbook) => (
            logbook.id === currentLogbookId
              ? { ...logbook, contactCount: Math.max(0, logbook.contactCount - 1), syncState: 'pending' }
              : logbook
          )))
          if (editingContactId === contact.id) {
            handleCancelEdit()
          }
          setStatusMessage(`Removed queued QSO with ${contact.stationCallsign}.`)
        } else {
          const mutationId = createMutationId()
          setQueuedSyncItems((current) => [{
            id: mutationId,
            entityType: 'contact',
            action: 'delete',
            createdAt: new Date().toISOString(),
            payloadSummary: `Queued delete for ${contact.stationCallsign}`,
            payload: {
              contactId: contact.id,
              logbookId: currentLogbookId,
              stationCallsign: contact.stationCallsign,
            },
          }, ...current])
          setContacts((current) => current.filter((item) => item.id !== contact.id))
          setLogbooks((current) => current.map((logbook) => (
            logbook.id === currentLogbookId
              ? { ...logbook, contactCount: Math.max(0, logbook.contactCount - 1), syncState: 'pending' }
              : logbook
          )))
          if (editingContactId === contact.id) {
            handleCancelEdit()
          }
          setStatusMessage(`Queued delete for ${contact.stationCallsign}.`)
        }
      } else {
        setStatusMessage(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function handlePostSpot(selfSpot: boolean, comment: string) {
    setBusy('Posting Spot')
    try {
      const currentMeta = currentLogbook ? readLogbookMeta(currentLogbook) : null
      const activatorCallsign = selfSpot
        ? (draft.operatorCallsign || operator?.callsign || appSettings?.stationCallsign)
        : (draft.stationCallsign || selectedSpot.activatorCallsign)
      const parkReference = selfSpot
        ? (currentLogbook?.parkReference || draft.parkReference || selectedSpot.parkReference)
        : (draft.parkReference || selectedSpot.parkReference)
      const frequencyKhz = draft.frequencyKhz || selectedSpot.frequencyKhz
      const mode = draft.mode || selectedSpot.mode
      const band = bandFromFrequencyKhz(frequencyKhz) || draft.band || selectedSpot.band

      if (!activatorCallsign || !parkReference) {
        throw new Error(
          selfSpot
            ? 'Self spots need your callsign and park reference.'
            : 'Spots for another activator need their callsign and park reference.',
        )
      }

      const created = await createPotaSpot(connection, {
        activatorCallsign,
        parkReference,
        frequencyKhz,
        mode,
        band,
        comments: comment,
        spotterCallsign: operator?.callsign ?? draft.operatorCallsign,
      })
      setSpots((current) => [created, ...current.filter((spot) => spot.id !== created.id)].slice(0, 20))
      setStatusMessage(
        selfSpot || currentMeta?.potaMode === 'activating'
          ? `Posted self spot for ${created.activatorCallsign} at ${created.parkReference}.`
          : `Posted spot for ${created.activatorCallsign} at ${created.parkReference}.`,
      )
    } catch (error) {
      setStatusMessage(`Spot post failed: ${error instanceof Error ? error.message : 'Unknown error.'}`)
    } finally {
      setBusy(null)
    }
  }
}

export default App
