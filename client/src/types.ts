export type Logbook = {
  id: string
  name: string
  operatorCallsign: string
  parkReference?: string
  activationDate?: string
  notes?: string
  contactCount: number
  syncState: 'synced' | 'pending'
}

export type LogbookCreateDraft = {
  name: string
  operatorCallsign: string
  parkReference?: string
  activationDate?: string
  notes?: string
}

export type Spot = {
  id: string
  activatorCallsign: string
  parkReference: string
  frequencyKhz: number
  mode: string
  band: string
  comments?: string
  spotterCallsign?: string
  spottedAt: string
  lat?: number
  lon?: number
}

export type ContactDraft = {
  stationCallsign: string
  operatorCallsign: string
  logbookId: string
  qsoDate: string
  timeOn: string
  mode: string
  frequencyKhz: number
  band: string
  rstSent?: string
  rstRcvd?: string
  txPower?: string
  name?: string
  qth?: string
  county?: string
  parkReference?: string
  gridSquare?: string
  country?: string
  state?: string
  dxcc?: string
  lat?: number
  lon?: number
}

export type Contact = {
  id: string
  logbookId: string
  stationCallsign: string
  operatorCallsign: string
  qsoDate: string
  timeOn: string
  band: string
  mode: string
  frequencyKhz: number
  rstSent?: string
  rstRcvd?: string
  txPower?: string
  name?: string
  qth?: string
  county?: string
  parkReference?: string
  gridSquare?: string
  country?: string
  state?: string
  dxcc?: string
  qrzUploadStatus?: string
  qrzUploadDate?: string
  lat?: number
  lon?: number
}

export type ContactPin = {
  id: string
  callsign: string
  lat: number
  lon: number
  label: string
}

export type SyncItem = {
  id: string
  entityType: 'contact' | 'logbook' | 'spot'
  action: 'create' | 'update' | 'delete'
  createdAt: string
  payloadSummary: string
}

export type PotaSpotDraft = {
  activatorCallsign: string
  parkReference: string
  frequencyKhz: number
  mode: string
  band: string
  comments?: string
  spotterCallsign?: string
}

export type PendingMutation =
  | {
      id: string
      entityType: 'contact'
      action: 'create'
      createdAt: string
      payloadSummary: string
      payload: ContactDraft
    }
  | {
      id: string
      entityType: 'spot'
      action: 'create'
      createdAt: string
      payloadSummary: string
      payload: PotaSpotDraft
    }

export type OperatorProfile = {
  id: string
  username: string
  callsign: string
}

export type AppSettings = {
  stationCallsign: string
  stationName: string
  myGridSquare?: string
  myState?: string
  myCounty?: string
  apiTokenEnabled: boolean
  adminAccess: boolean
  qrzUsername?: string
  qrzConfigured: boolean
  potaConfigured: boolean
}

export type ServerSettingsForm = {
  stationCallsign: string
  stationName: string
  myGridSquare: string
  myState: string
  myCounty: string
  qrzUsername: string
  qrzPassword: string
  qrzApiKey: string
  potaApiKey: string
}

export type ClientConnectionSettings = {
  serverUrl: string
  apiToken: string
  adminToken?: string
}

export type RigConnectionSettings = {
  endpoint: string
}

export type RigState = {
  endpoint: string
  radioName?: string
  version?: string
  frequencyHz?: number
  mode?: string
}

export type CallsignLookup = {
  callsign: string
  name?: string
  qth?: string
  county?: string
  gridSquare?: string
  country?: string
  state?: string
  dxcc?: string
  lat?: number
  lon?: number
  qrzUrl?: string
}
