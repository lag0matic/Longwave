import type {
  AppSettings,
  CallsignLookup,
  ClientConnectionSettings,
  Contact,
  ContactDraft,
  Logbook,
  LogbookCreateDraft,
  OperatorProfile,
  PotaSpotDraft,
  Spot,
} from '../types'
import {
  canUseDesktopApi,
  desktopApiRequest,
  desktopImportAdif,
  probeServerCertificate as desktopProbeServerCertificate,
} from './desktopApi'

type RawLogbook = {
  id: string
  name: string
  operator_callsign: string
  park_reference?: string | null
  activation_date?: string | null
  notes?: string | null
  contact_count: number
}

type RawSettings = {
  station_callsign: string
  station_name: string
  my_grid_square?: string | null
  my_state?: string | null
  my_county?: string | null
  default_tx_power?: string | null
  api_token_enabled: boolean
  admin_access: boolean
  qrz_username?: string | null
  qrz_configured: boolean
}

type RawAdifExport = {
  adif: string
}

type RawQrzUpload = {
  logbook_id: string
  uploaded: boolean
  message: string
}

type RawAdifImport = {
  imported_contacts: RawContact[]
  adif_version: string
}

type RawOperator = {
  id: string
  username: string
  callsign: string
}

type RawContact = {
  id: string
  logbook_id: string
  station_callsign: string
  operator_callsign: string
  qso_date: string
  time_on: string
  band: string
  mode: string
  frequency_khz: number
  rst_sent?: string | null
  rst_recvd?: string | null
  tx_power?: string | null
  name?: string | null
  qth?: string | null
  county?: string | null
  park_reference?: string | null
  grid_square?: string | null
  country?: string | null
  state?: string | null
  dxcc?: string | null
  qrz_upload_status?: string | null
  qrz_upload_date?: string | null
  lat?: number | null
  lon?: number | null
}

type RawSpot = {
  id: string
  activator_callsign: string
  park_reference: string
  frequency_khz: number
  mode: string
  band: string
  comments?: string | null
  spotter_callsign?: string | null
  spotted_at: string
  lat?: number | null
  lon?: number | null
}

type RawLookup = {
  callsign: string
  name?: string | null
  qth?: string | null
  county?: string | null
  grid_square?: string | null
  country?: string | null
  state?: string | null
  dxcc?: string | null
  lat?: number | null
  lon?: number | null
  qrz_url?: string | null
}

function buildHeaders(connection: ClientConnectionSettings) {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': connection.apiToken,
  }
}

function buildAdminHeaders(connection: ClientConnectionSettings) {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Api-Key': connection.adminToken || connection.apiToken,
  }
}

function normalizeServerUrl(serverUrl: string) {
  return serverUrl.replace(/\/+$/, '')
}

const preferredEndpointByConnection = new Map<string, string>()

function connectionKey(connection: ClientConnectionSettings) {
  return [
    normalizeServerUrl(connection.serverUrl),
    ...(connection.additionalServerUrls ?? '')
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map(normalizeServerUrl),
  ].join('|')
}

function listServerEndpoints(connection: ClientConnectionSettings) {
  const endpoints = [
    connection.serverUrl,
    ...(connection.additionalServerUrls ?? '')
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean),
  ].map(normalizeServerUrl)

  const preferredEndpoint = preferredEndpointByConnection.get(connectionKey(connection))
  if (preferredEndpoint && endpoints.includes(preferredEndpoint)) {
    return [preferredEndpoint, ...endpoints.filter((endpoint) => endpoint !== preferredEndpoint)]
  }

  return endpoints
}

function rememberSuccessfulEndpoint(connection: ClientConnectionSettings, endpoint: string) {
  preferredEndpointByConnection.set(connectionKey(connection), normalizeServerUrl(endpoint))
}

async function requestJson<T>(connection: ClientConnectionSettings, path: string, init?: RequestInit): Promise<T> {
  if (canUseDesktopApi()) {
    const response = await desktopApiRequest({
      endpoints: listServerEndpoints(connection),
      method: init?.method ?? 'GET',
      path,
      headers: Object.entries({
        ...buildHeaders(connection),
        ...(init?.headers ?? {}),
      }).map(([name, value]) => ({ name, value: String(value) })),
      body: typeof init?.body === 'string' ? init.body : undefined,
      pinnedFingerprint: connection.pinnedFingerprint,
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.body || `Request failed with status ${response.status}`)
    }

    rememberSuccessfulEndpoint(connection, response.endpoint)
    return JSON.parse(response.body) as T
  }

  const response = await fetch(`${normalizeServerUrl(connection.serverUrl)}${path}`, {
    ...init,
    headers: {
      ...buildHeaders(connection),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

async function requestAdminJson<T>(connection: ClientConnectionSettings, path: string, init?: RequestInit): Promise<T> {
  if (canUseDesktopApi()) {
    const response = await desktopApiRequest({
      endpoints: listServerEndpoints(connection),
      method: init?.method ?? 'GET',
      path,
      headers: Object.entries({
        ...buildAdminHeaders(connection),
        ...(init?.headers ?? {}),
      }).map(([name, value]) => ({ name, value: String(value) })),
      body: typeof init?.body === 'string' ? init.body : undefined,
      pinnedFingerprint: connection.pinnedFingerprint,
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.body || `Request failed with status ${response.status}`)
    }

    rememberSuccessfulEndpoint(connection, response.endpoint)
    return JSON.parse(response.body) as T
  }

  const response = await fetch(`${normalizeServerUrl(connection.serverUrl)}${path}`, {
    ...init,
    headers: {
      ...buildAdminHeaders(connection),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

export async function probeServerCertificate(connection: ClientConnectionSettings): Promise<{ endpoint: string; fingerprint: string }> {
  const endpoints = listServerEndpoints(connection)
  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      const result = await desktopProbeServerCertificate(endpoint)
      rememberSuccessfulEndpoint(connection, result.endpoint)
      return result
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Certificate probe failed.')
    }
  }

  throw lastError ?? new Error('Certificate probe failed.')
}

export async function fetchOperatorProfile(connection: ClientConnectionSettings): Promise<OperatorProfile> {
  const raw = await requestJson<RawOperator>(connection, '/me')
  return raw
}

export async function fetchAppSettings(connection: ClientConnectionSettings): Promise<AppSettings> {
  const raw = await requestAdminJson<RawSettings>(connection, '/settings')
  return {
    stationCallsign: raw.station_callsign,
    stationName: raw.station_name,
    myGridSquare: raw.my_grid_square ?? undefined,
    myState: raw.my_state ?? undefined,
    myCounty: raw.my_county ?? undefined,
    apiTokenEnabled: raw.api_token_enabled,
    adminAccess: raw.admin_access,
    qrzUsername: raw.qrz_username ?? undefined,
    qrzConfigured: raw.qrz_configured,
  }
}

export async function updateAppSettings(
  connection: ClientConnectionSettings,
  payload: Partial<{
    station_callsign: string
    station_name: string
    my_grid_square: string
    my_state: string
    my_county: string
    qrz_username: string
    qrz_password: string
    qrz_api_key: string
  }>,
): Promise<AppSettings> {
  const raw = await requestAdminJson<RawSettings>(connection, '/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })

  return {
    stationCallsign: raw.station_callsign,
    stationName: raw.station_name,
    myGridSquare: raw.my_grid_square ?? undefined,
    myState: raw.my_state ?? undefined,
    myCounty: raw.my_county ?? undefined,
    apiTokenEnabled: raw.api_token_enabled,
    adminAccess: raw.admin_access,
    qrzUsername: raw.qrz_username ?? undefined,
    qrzConfigured: raw.qrz_configured,
  }
}

export async function fetchLogbooks(connection: ClientConnectionSettings): Promise<Logbook[]> {
  const raw = await requestJson<RawLogbook[]>(connection, '/logbooks')
  return raw.map((logbook) => ({
    id: logbook.id,
    name: logbook.name,
    operatorCallsign: logbook.operator_callsign,
    parkReference: logbook.park_reference ?? undefined,
    activationDate: logbook.activation_date ?? undefined,
    notes: logbook.notes ?? undefined,
    contactCount: logbook.contact_count,
    syncState: 'synced',
  }))
}

export async function createLogbook(
  connection: ClientConnectionSettings,
  draft: LogbookCreateDraft,
): Promise<Logbook> {
  const raw = await requestJson<RawLogbook>(connection, '/logbooks', {
    method: 'POST',
    body: JSON.stringify({
      name: draft.name,
      operator_callsign: draft.operatorCallsign,
      park_reference: draft.parkReference,
      activation_date: draft.activationDate,
      notes: draft.notes,
    }),
  })

  return {
    id: raw.id,
    name: raw.name,
    operatorCallsign: raw.operator_callsign,
    parkReference: raw.park_reference ?? undefined,
    activationDate: raw.activation_date ?? undefined,
    notes: raw.notes ?? undefined,
    contactCount: raw.contact_count,
    syncState: 'synced',
  }
}

export async function deleteLogbook(
  connection: ClientConnectionSettings,
  logbookId: string,
): Promise<void> {
  if (canUseDesktopApi()) {
    const response = await desktopApiRequest({
      endpoints: listServerEndpoints(connection),
      method: 'DELETE',
      path: `/logbooks/${encodeURIComponent(logbookId)}`,
      headers: [{ name: 'X-Api-Key', value: connection.apiToken }],
      pinnedFingerprint: connection.pinnedFingerprint,
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.body || `Request failed with status ${response.status}`)
    }
    return
  }

  const response = await fetch(`${normalizeServerUrl(connection.serverUrl)}/logbooks/${encodeURIComponent(logbookId)}`, {
    method: 'DELETE',
    headers: {
      'X-Api-Key': connection.apiToken,
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }
}

function mapContact(contact: RawContact): Contact {
  return {
    id: contact.id,
    logbookId: contact.logbook_id,
    stationCallsign: contact.station_callsign,
    operatorCallsign: contact.operator_callsign,
    qsoDate: contact.qso_date,
    timeOn: contact.time_on,
    band: contact.band,
    mode: contact.mode,
    frequencyKhz: contact.frequency_khz,
    rstSent: contact.rst_sent ?? undefined,
    rstRcvd: contact.rst_recvd ?? undefined,
    txPower: contact.tx_power ?? undefined,
    name: contact.name ?? undefined,
    qth: contact.qth ?? undefined,
    county: contact.county ?? undefined,
    parkReference: contact.park_reference ?? undefined,
    gridSquare: contact.grid_square ?? undefined,
    country: contact.country ?? undefined,
    state: contact.state ?? undefined,
    dxcc: contact.dxcc ?? undefined,
    qrzUploadStatus: contact.qrz_upload_status ?? undefined,
    qrzUploadDate: contact.qrz_upload_date ?? undefined,
    lat: contact.lat ?? undefined,
    lon: contact.lon ?? undefined,
  }
}

export async function fetchContacts(
  connection: ClientConnectionSettings,
  logbookId?: string,
): Promise<Contact[]> {
  const query = logbookId ? `?logbook_id=${encodeURIComponent(logbookId)}` : ''
  const raw = await requestJson<RawContact[]>(connection, `/contacts${query}`)
  return raw.map(mapContact)
}

export async function createContact(
  connection: ClientConnectionSettings,
  draft: ContactDraft,
): Promise<Contact> {
  const raw = await requestJson<RawContact>(connection, '/contacts', {
    method: 'POST',
    body: JSON.stringify({
      logbook_id: draft.logbookId,
      station_callsign: draft.stationCallsign,
      operator_callsign: draft.operatorCallsign,
      qso_date: draft.qsoDate,
      time_on: draft.timeOn,
      band: draft.band,
      mode: draft.mode,
      frequency_khz: draft.frequencyKhz,
      rst_sent: draft.rstSent,
      rst_recvd: draft.rstRcvd,
      tx_power: draft.txPower,
      name: draft.name,
      qth: draft.qth,
      county: draft.county,
      park_reference: draft.parkReference,
      grid_square: draft.gridSquare,
      country: draft.country,
      state: draft.state,
      dxcc: draft.dxcc,
      lat: draft.lat,
      lon: draft.lon,
    }),
  })
  return mapContact(raw)
}

export async function deleteContact(
  connection: ClientConnectionSettings,
  contactId: string,
): Promise<void> {
  if (canUseDesktopApi()) {
    const response = await desktopApiRequest({
      endpoints: listServerEndpoints(connection),
      method: 'DELETE',
      path: `/contacts/${encodeURIComponent(contactId)}`,
      headers: [{ name: 'X-Api-Key', value: connection.apiToken }],
      pinnedFingerprint: connection.pinnedFingerprint,
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.body || `Request failed with status ${response.status}`)
    }
    return
  }

  const response = await fetch(`${normalizeServerUrl(connection.serverUrl)}/contacts/${encodeURIComponent(contactId)}`, {
    method: 'DELETE',
    headers: {
      'X-Api-Key': connection.apiToken,
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }
}

export async function fetchPotaSpots(connection: ClientConnectionSettings): Promise<Spot[]> {
  const raw = await requestJson<RawSpot[]>(connection, '/spots/pota')
  return raw.map((spot) => ({
    id: spot.id,
    activatorCallsign: spot.activator_callsign,
    parkReference: spot.park_reference,
    frequencyKhz: spot.frequency_khz,
    mode: spot.mode,
    band: spot.band,
    comments: spot.comments ?? undefined,
    spotterCallsign: spot.spotter_callsign ?? undefined,
    spottedAt: spot.spotted_at,
    lat: spot.lat ?? undefined,
    lon: spot.lon ?? undefined,
  }))
}

export async function lookupCallsign(
  connection: ClientConnectionSettings,
  callsign: string,
): Promise<CallsignLookup> {
  const raw = await requestJson<RawLookup>(
    connection,
    `/lookups/qrz/${encodeURIComponent(callsign)}`,
  )
  return {
    callsign: raw.callsign,
    name: raw.name ?? undefined,
    qth: raw.qth ?? undefined,
    county: raw.county ?? undefined,
    gridSquare: raw.grid_square ?? undefined,
    country: raw.country ?? undefined,
    state: raw.state ?? undefined,
    dxcc: raw.dxcc ?? undefined,
    lat: raw.lat ?? undefined,
    lon: raw.lon ?? undefined,
    qrzUrl: raw.qrz_url ?? undefined,
  }
}

export async function createPotaSpot(
  connection: ClientConnectionSettings,
  payload: PotaSpotDraft,
): Promise<Spot> {
  const raw = await requestJson<RawSpot>(connection, '/spots/pota', {
    method: 'POST',
    body: JSON.stringify({
      activator_callsign: payload.activatorCallsign,
      park_reference: payload.parkReference,
      frequency_khz: payload.frequencyKhz,
      mode: payload.mode,
      band: payload.band,
      comments: payload.comments,
      spotter_callsign: payload.spotterCallsign,
    }),
  })

  return {
    id: raw.id,
    activatorCallsign: raw.activator_callsign,
    parkReference: raw.park_reference,
    frequencyKhz: raw.frequency_khz,
    mode: raw.mode,
    band: raw.band,
    comments: raw.comments ?? undefined,
    spotterCallsign: raw.spotter_callsign ?? undefined,
    spottedAt: raw.spotted_at,
    lat: raw.lat ?? undefined,
    lon: raw.lon ?? undefined,
  }
}

export async function exportLogbookAdif(
  connection: ClientConnectionSettings,
  logbookId: string,
): Promise<string> {
  const raw = await requestJson<RawAdifExport>(connection, `/logs/${encodeURIComponent(logbookId)}/adif`)
  return raw.adif
}

export async function uploadLogbookToQrz(
  connection: ClientConnectionSettings,
  logbookId: string,
): Promise<{ uploaded: boolean; message: string }> {
  const raw = await requestJson<RawQrzUpload>(connection, '/logs/qrz-upload', {
    method: 'POST',
    body: JSON.stringify({
      logbook_id: logbookId,
    }),
  })

  return {
    uploaded: raw.uploaded,
    message: raw.message,
  }
}

export async function importLogbookAdif(
  connection: ClientConnectionSettings,
  logbookId: string,
  operatorCallsign: string,
  file: File,
): Promise<{ importedCount: number }> {
  if (canUseDesktopApi()) {
    const adifText = await file.text()
    const result = await desktopImportAdif({
      endpoints: listServerEndpoints(connection),
      logbookId,
      operatorCallsign,
      filename: file.name,
      adifText,
      apiToken: connection.apiToken,
      pinnedFingerprint: connection.pinnedFingerprint,
    })
    rememberSuccessfulEndpoint(connection, result.endpoint)
    return { importedCount: result.importedCount }
  }

  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(
    `${normalizeServerUrl(connection.serverUrl)}/logs/import?logbook_id=${encodeURIComponent(logbookId)}&operator_callsign=${encodeURIComponent(operatorCallsign)}`,
    {
      method: 'POST',
      headers: {
        'X-Api-Key': connection.apiToken,
      },
      body: formData,
    },
  )

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  const raw = (await response.json()) as RawAdifImport
  return { importedCount: raw.imported_contacts.length }
}
