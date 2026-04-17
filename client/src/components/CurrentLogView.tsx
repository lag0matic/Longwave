import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ContactMap } from './ContactMap'
import { draftFromSpot } from '../data/mockData'
import type { CallsignLookup, ClientConnectionSettings, Contact, ContactDraft, Logbook, PendingMutation, RigConnectionSettings, RigState, Spot } from '../types'
import { bandFromFrequencyKhz, type LogbookSubTab } from '../App'

type CurrentLogViewProps = {
  connection: ClientConnectionSettings
  currentLogbook: Logbook
  logbookTab: LogbookSubTab
  setLogbookTab: Dispatch<SetStateAction<LogbookSubTab>>
  contacts: Contact[]
  spots: Spot[]
  selectedSpot: Spot
  setSelectedSpot: Dispatch<SetStateAction<Spot>>
  draft: ContactDraft
  setDraft: Dispatch<SetStateAction<ContactDraft>>
  lookupResult: CallsignLookup | null
  rigConnection: RigConnectionSettings
  rigState: RigState | null
  isOnline: boolean
  queuedSyncItems: PendingMutation[]
  busy: string | null
  setBusy: Dispatch<SetStateAction<string | null>>
  setStatusMessage: Dispatch<SetStateAction<string>>
  refreshCurrentLogContacts: (logbookId: string) => Promise<void>
  refreshLogbooks: () => Promise<void>
  handleLookupCallsign: () => Promise<void>
  handleSaveContact: () => Promise<void>
  handleDeleteContact: (contact: Contact) => Promise<void>
  handleReadRig: () => Promise<void>
  handleTuneRig: (spot?: Spot) => Promise<void>
  handleExportAdif: () => Promise<void>
  handleUploadQrz: () => Promise<void>
  handlePostSpot: (selfSpot: boolean, comment: string) => Promise<void>
  readLogbookMeta: (logbook: Logbook) => { kind: 'standard' | 'pota'; potaMode: 'hunting' | 'activating' }
}

function buildContactPins(contacts: Contact[]) {
  return contacts.flatMap((contact) => {
    const derived = contactCoordinates(contact)
    if (!derived) {
      return []
    }

    return [{
      id: contact.id,
      callsign: contact.stationCallsign,
      lat: derived.lat,
      lon: derived.lon,
      label: contact.country ?? contact.state ?? contact.parkReference ?? contact.gridSquare ?? 'Worked contact',
    }]
  })
}

function contactCoordinates(contact: Contact) {
  if (typeof contact.lat === 'number' && typeof contact.lon === 'number') {
    return {
      lat: contact.lat,
      lon: contact.lon,
    }
  }

  return maidenheadToLatLon(contact.gridSquare)
}

function maidenheadToLatLon(gridSquare?: string) {
  if (!gridSquare) {
    return null
  }

  const grid = gridSquare.trim().toUpperCase()
  if (grid.length < 4) {
    return null
  }

  const first = grid.charCodeAt(0) - 65
  const second = grid.charCodeAt(1) - 65
  const third = Number.parseInt(grid[2] ?? '', 10)
  const fourth = Number.parseInt(grid[3] ?? '', 10)

  if (
    first < 0 || first > 17
    || second < 0 || second > 17
    || Number.isNaN(third) || third < 0 || third > 9
    || Number.isNaN(fourth) || fourth < 0 || fourth > 9
  ) {
    return null
  }

  let lon = -180 + first * 20 + third * 2
  let lat = -90 + second * 10 + fourth
  let lonWidth = 2
  let latHeight = 1

  if (grid.length >= 6) {
    const fifth = grid.charCodeAt(4) - 65
    const sixth = grid.charCodeAt(5) - 65
    if (fifth < 0 || fifth > 23 || sixth < 0 || sixth > 23) {
      return null
    }
    lon += fifth * (2 / 24)
    lat += sixth * (1 / 24)
    lonWidth = 2 / 24
    latHeight = 1 / 24
  }

  return {
    lat: lat + latHeight / 2,
    lon: lon + lonWidth / 2,
  }
}

function formatLocalDateTime(qsoDate: string, timeOn: string) {
  if (qsoDate.length !== 8 || timeOn.length < 4) {
    return `${qsoDate} ${timeOn}`
  }

  const year = Number(qsoDate.slice(0, 4))
  const month = Number(qsoDate.slice(4, 6))
  const day = Number(qsoDate.slice(6, 8))
  const hour = Number(timeOn.slice(0, 2))
  const minute = Number(timeOn.slice(2, 4))
  const second = timeOn.length >= 6 ? Number(timeOn.slice(4, 6)) : 0
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  if (Number.isNaN(utcDate.getTime())) {
    return `${qsoDate} ${timeOn}`
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(utcDate)
}

function formatLocation(contact: Contact) {
  if (contact.state && contact.country) {
    return `${contact.state}, ${contact.country}`
  }
  return contact.state || contact.country || contact.gridSquare || '--'
}

function spotUtcDate(spot: Spot) {
  const spotDate = new Date(spot.spottedAt)
  if (Number.isNaN(spotDate.getTime())) {
    return ''
  }

  return spotDate.toISOString().slice(0, 10).replace(/-/g, '')
}

export function CurrentLogView(props: CurrentLogViewProps) {
  const [spotComment, setSpotComment] = useState('')
  const [spotBandFilter, setSpotBandFilter] = useState('ALL')
  const [spotModeFilter, setSpotModeFilter] = useState('ALL')
  const meta = props.readLogbookMeta(props.currentLogbook)
  const bandOptions = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m']

  const availableBands = useMemo(() => {
    return Array.from(new Set(props.spots.map((spot) => spot.band).filter(Boolean))).sort((left, right) => left.localeCompare(right))
  }, [props.spots])

  const availableModes = useMemo(() => {
    return Array.from(new Set(props.spots.map((spot) => spot.mode).filter(Boolean))).sort((left, right) => left.localeCompare(right))
  }, [props.spots])

  const filteredSpots = useMemo(() => {
    return props.spots.filter((spot) => {
      const bandMatches = spotBandFilter === 'ALL' || spot.band === spotBandFilter
      const modeMatches = spotModeFilter === 'ALL' || spot.mode === spotModeFilter
      return bandMatches && modeMatches
    })
  }, [props.spots, spotBandFilter, spotModeFilter])

  function wasWorkedToday(spot: Spot) {
    const loggedDate = spotUtcDate(spot)
    if (!loggedDate) {
      return false
    }

    return props.contacts.some((contact) => {
      return (
        contact.stationCallsign.toUpperCase() === spot.activatorCallsign.toUpperCase()
        && (contact.parkReference ?? '').toUpperCase() === spot.parkReference.toUpperCase()
        && contact.qsoDate === loggedDate
      )
    })
  }

  function useSpot(spot: Spot, announce = true) {
    props.setSelectedSpot(spot)
    props.setDraft((current) => ({
      ...draftFromSpot(spot, current.operatorCallsign, props.currentLogbook.id),
      stationCallsign: spot.activatorCallsign,
      operatorCallsign: current.operatorCallsign,
    }))
    if (announce) {
      props.setStatusMessage(`Loaded ${spot.activatorCallsign} ${spot.parkReference} into the QSO form.`)
    }
  }

  async function tuneToSpot(spot: Spot) {
    useSpot(spot, false)
    await props.handleTuneRig(spot)
  }

  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{props.currentLogbook.name}</p>
            <h2>New QSO</h2>
          </div>
          <div className="inline-actions">
            <span className="pill">{meta.kind === 'pota' ? `POTA ${meta.potaMode}` : 'Standard'}</span>
            {meta.kind === 'pota' ? <span className="pill">{props.currentLogbook.parkReference ?? 'No park'}</span> : null}
            <span className="pill">{props.isOnline ? 'Online' : 'Offline'}</span>
            <span className="pill">{props.queuedSyncItems.length} queued</span>
          </div>
        </div>

        <div className="qso-grid">
          <label><span>Callsign</span><input value={props.draft.stationCallsign} onChange={(event) => props.setDraft((current) => ({ ...current, stationCallsign: event.target.value.toUpperCase() }))} /></label>
          <label><span>My Call</span><input value={props.draft.operatorCallsign} onChange={(event) => props.setDraft((current) => ({ ...current, operatorCallsign: event.target.value.toUpperCase() }))} /></label>
          <label><span>RST Sent</span><input value={props.draft.rstSent ?? ''} onChange={(event) => props.setDraft((current) => ({ ...current, rstSent: event.target.value.toUpperCase() }))} /></label>
          <label><span>RST Received</span><input value={props.draft.rstRcvd ?? ''} onChange={(event) => props.setDraft((current) => ({ ...current, rstRcvd: event.target.value.toUpperCase() }))} /></label>
          <label><span>UTC Date</span><input value={props.draft.qsoDate} onChange={(event) => props.setDraft((current) => ({ ...current, qsoDate: event.target.value.replace(/\D/g, '').slice(0, 8) }))} placeholder="YYYYMMDD" /></label>
          <label><span>UTC Time</span><input value={props.draft.timeOn} onChange={(event) => props.setDraft((current) => ({ ...current, timeOn: event.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="HHMM or HHMMSS" /></label>
          <label>
            <span>Frequency MHz</span>
            <input
              type="number"
              step="0.001"
              value={(props.draft.frequencyKhz / 1000).toFixed(3)}
              onChange={(event) => {
                const frequencyMhz = Number.parseFloat(event.target.value)
                props.setDraft((current) => ({
                  ...current,
                  frequencyKhz: Number.isFinite(frequencyMhz) ? frequencyMhz * 1000 : current.frequencyKhz,
                }))
              }}
            />
          </label>
          <label><span>Mode</span><input value={props.draft.mode} onChange={(event) => props.setDraft((current) => ({ ...current, mode: event.target.value.toUpperCase() }))} /></label>
          <label><span>TX Power</span><input value={props.draft.txPower ?? ''} onChange={(event) => props.setDraft((current) => ({ ...current, txPower: event.target.value }))} placeholder="Watts" /></label>
          <label>
            <span>Band</span>
            <select
              value={bandFromFrequencyKhz(props.draft.frequencyKhz) || props.draft.band || ''}
              onChange={(event) => props.setDraft((current) => ({ ...current, band: event.target.value }))}
            >
              <option value="">Select band</option>
              {bandOptions.map((band) => <option key={band} value={band}>{band}</option>)}
            </select>
          </label>
          {meta.kind === 'pota' ? (
            <label>
              <span>{meta.potaMode === 'hunting' ? 'Their Park' : 'Park Reference'}</span>
              <input
                value={props.draft.parkReference ?? ''}
                onChange={(event) => props.setDraft((current) => ({ ...current, parkReference: event.target.value.toUpperCase() }))}
                placeholder="US-1234"
              />
            </label>
          ) : null}
        </div>

        <div className="qso-actions">
          <button onClick={() => void props.handleReadRig()} disabled={props.busy === 'Reading Rig'}>{props.busy === 'Reading Rig' ? 'Reading rig...' : 'Read Rig'}</button>
          <button onClick={() => void props.handleTuneRig()}>Tune Rig</button>
          <button onClick={() => void props.handleExportAdif()} disabled={props.busy === 'Exporting ADIF'}>{props.busy === 'Exporting ADIF' ? 'Exporting...' : 'Export ADIF'}</button>
          <button onClick={() => void props.handleUploadQrz()} disabled={props.busy === 'Uploading QRZ'}>{props.busy === 'Uploading QRZ' ? 'Uploading...' : 'Upload QRZ'}</button>
          <button className="primary" onClick={() => void props.handleSaveContact()} disabled={props.busy === 'Saving QSO'}>{props.busy === 'Saving QSO' ? 'Saving...' : 'Save QSO'}</button>
        </div>

        {props.lookupResult ? (
          <div className="lookup-card">
            <div className="lookup-card-header">
              <div>
                <p className="eyebrow">QRZ Result</p>
                <h3>{props.lookupResult.callsign}</h3>
              </div>
              {props.lookupResult.qrzUrl ? (
                <a className="lookup-link" href={props.lookupResult.qrzUrl} target="_blank" rel="noreferrer">
                  Open on QRZ
                </a>
              ) : null}
            </div>
            <div className="lookup-grid">
              <div>
                <span>Name</span>
                <strong>{props.lookupResult.name ?? '--'}</strong>
              </div>
              <div>
                <span>Grid</span>
                <strong>{props.lookupResult.gridSquare ?? '--'}</strong>
              </div>
              <div>
                <span>State</span>
                <strong>{props.lookupResult.state ?? '--'}</strong>
              </div>
              <div>
                <span>Country</span>
                <strong>{props.lookupResult.country ?? '--'}</strong>
              </div>
              <div>
                <span>Latitude</span>
                <strong>{typeof props.lookupResult.lat === 'number' ? props.lookupResult.lat.toFixed(5) : '--'}</strong>
              </div>
              <div>
                <span>Longitude</span>
                <strong>{typeof props.lookupResult.lon === 'number' ? props.lookupResult.lon.toFixed(5) : '--'}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="subtabs">
          <button className={props.logbookTab === 'qsos' ? 'active' : ''} onClick={() => props.setLogbookTab('qsos')}>Past QSOs</button>
          <button className={props.logbookTab === 'map' ? 'active' : ''} onClick={() => props.setLogbookTab('map')}>World Map</button>
          <button className={props.logbookTab === 'pota' ? 'active' : ''} onClick={() => props.setLogbookTab('pota')}>{meta.kind === 'pota' ? 'POTA Spots' : 'Later View'}</button>
        </div>

        {props.logbookTab === 'qsos' ? (
          <div className="entries-table">
            <div className="entries-header">
              <span>Local Time</span><span>Call</span><span>RST</span><span>Mode</span><span>Freq</span>{meta.kind === 'pota' ? <span>Park</span> : null}<span>Location</span><span>Action</span>
            </div>
            {props.contacts.map((contact) => (
              <div key={contact.id} className="entries-row">
                <span>{formatLocalDateTime(contact.qsoDate, contact.timeOn)}</span>
                <strong>{contact.stationCallsign}</strong>
                <span>{contact.rstSent ?? '--'} / {contact.rstRcvd ?? '--'}</span>
                <span>{contact.mode}</span>
                <span>{contact.frequencyKhz.toFixed(3)}</span>
                {meta.kind === 'pota' ? <span>{contact.parkReference ?? '--'}</span> : null}
                <span>{formatLocation(contact)}</span>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm(`Delete QSO with ${contact.stationCallsign} on ${contact.qsoDate} ${contact.timeOn}?`)) {
                      void props.handleDeleteContact(contact)
                    }
                  }}
                  disabled={props.busy === 'Deleting QSO'}
                >
                  {props.busy === 'Deleting QSO' ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {props.logbookTab === 'map' ? <ContactMap pins={buildContactPins(props.contacts)} /> : null}

        {props.logbookTab === 'pota' ? (
          meta.kind === 'pota' ? (
            <div className="spots-pane">
              <div className="spot-controls">
                <input value={spotComment} onChange={(event) => setSpotComment(event.target.value)} placeholder="Spot comment" />
                <select value={spotBandFilter} onChange={(event) => setSpotBandFilter(event.target.value)}>
                  <option value="ALL">All bands</option>
                  {availableBands.map((band) => <option key={band} value={band}>{band}</option>)}
                </select>
                <select value={spotModeFilter} onChange={(event) => setSpotModeFilter(event.target.value)}>
                  <option value="ALL">All modes</option>
                  {availableModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
                <button className="primary" onClick={() => void props.handlePostSpot(meta.potaMode === 'activating', spotComment)} disabled={props.busy === 'Posting Spot'}>
                  {props.busy === 'Posting Spot' ? 'Posting...' : meta.potaMode === 'activating' ? 'Post Self Spot' : 'Spot Selected Activator'}
                </button>
              </div>
              <div className="spot-summary">
                <span>{filteredSpots.length} spots</span>
                <span>{filteredSpots.filter((spot) => wasWorkedToday(spot)).length} worked today</span>
              </div>
              <div className="spot-list">
                {filteredSpots.map((spot) => {
                  const workedToday = wasWorkedToday(spot)
                  return (
                    <article key={spot.id} className={`spot-card ${spot.id === props.selectedSpot.id ? 'selected' : ''} ${workedToday ? 'worked-today' : ''}`}>
                      <div className="spot-card-header">
                        <strong>{spot.activatorCallsign}</strong>
                        <small>{spot.parkReference}</small>
                      </div>
                      <div className="spot-metadata">
                        <span>{spot.frequencyKhz.toFixed(3)} MHz</span>
                        <span>{spot.mode}</span>
                        <span>{spot.band}</span>
                      </div>
                      <p>{spot.comments ?? 'No comment'}</p>
                      <small>{workedToday ? 'Logged already today' : `Spotted by ${spot.spotterCallsign ?? 'Unknown'}`}</small>
                      <div className="spot-card-actions">
                        <button className="primary" onClick={() => useSpot(spot)}>Use Spot</button>
                        <button onClick={() => void tuneToSpot(spot)}>Tune</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="empty-state">A future standard-log view can go here, such as DX or statistics.</div>
          )
        ) : null}
      </section>

      <section className="panel compact-panel">
        <div className="inline-actions">
          <span className="pill">{props.lookupResult?.country ?? props.lookupResult?.state ?? 'QRZ idle'}</span>
          <span className="pill">{props.rigState?.radioName ?? props.rigConnection.endpoint}</span>
          {meta.kind === 'pota' ? <span className="pill">{props.selectedSpot.parkReference}</span> : null}
        </div>
      </section>
    </>
  )
}
