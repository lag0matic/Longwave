import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AppSettings, ClientConnectionSettings, RigConnectionSettings, RigState, ServerSettingsForm } from '../types'

type SettingsViewProps = {
  connection: ClientConnectionSettings
  connectionDraft: ClientConnectionSettings
  setConnectionDraft: Dispatch<SetStateAction<ClientConnectionSettings>>
  handleSaveLocalConnection: () => void
  rigConnection: RigConnectionSettings
  setRigConnection: Dispatch<SetStateAction<RigConnectionSettings>>
  settingsForm: ServerSettingsForm
  setSettingsForm: Dispatch<SetStateAction<ServerSettingsForm>>
  appSettings: AppSettings | null
  busy: string | null
  setBusy: Dispatch<SetStateAction<string | null>>
  setStatusMessage: Dispatch<SetStateAction<string>>
  refreshServerState: (targetConnection: ClientConnectionSettings) => Promise<void>
  handleSaveSettings: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleTrustServer: () => Promise<void>
  handleReadRig: () => Promise<void>
  rigState: RigState | null
}

export function SettingsView(props: SettingsViewProps) {
  function handleSaveLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.handleSaveLocalConnection()
    window.localStorage.setItem('longwave-rig-connection', JSON.stringify(props.rigConnection))
  }

  return (
    <div className="page-grid settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Local Settings</p>
            <h2>Remote server and rig connection</h2>
          </div>
        </div>
        <form className="settings-form" onSubmit={handleSaveLocal}>
          <div className="settings-group">
            <p className="eyebrow">Server</p>
          </div>
          <label>
            <span>Primary Server URL</span>
            <input value={props.connectionDraft.serverUrl} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, serverUrl: event.target.value }))} />
          </label>
          <label>
            <span>Additional Server URLs</span>
            <textarea rows={3} value={props.connectionDraft.additionalServerUrls ?? ''} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, additionalServerUrls: event.target.value }))} placeholder="One per line. Example:&#10;https://192.168.4.194/api/v1&#10;https://thearkive.xyz/api/v1" />
          </label>
          <label>
            <span>Client API Token</span>
            <input value={props.connectionDraft.apiToken} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, apiToken: event.target.value }))} />
          </label>
          <label>
            <span>Admin Token</span>
            <input value={props.connectionDraft.adminToken ?? ''} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, adminToken: event.target.value }))} placeholder="Falls back to API token until split" />
          </label>
          <label>
            <span>Pinned Server Fingerprint</span>
            <input value={props.connectionDraft.pinnedFingerprint ?? ''} readOnly placeholder="Trust a server to pin its identity here" />
          </label>
          <div className="settings-group">
            <p className="eyebrow">FLrig / ShackStack</p>
            <p className="muted">Desktop rig control stays local on this machine. Point it at FLrig on Linux or ShackStack on Windows.</p>
          </div>
          <label>
            <span>FLrig / ShackStack Endpoint</span>
            <input value={props.rigConnection.endpoint} onChange={(event) => props.setRigConnection({ endpoint: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button type="submit">Save Local Settings</button>
            <button type="button" onClick={() => void props.handleTrustServer()} disabled={props.busy === 'Trusting Server'}>
              {props.busy === 'Trusting Server' ? 'Trusting...' : 'Trust Server'}
            </button>
            <button className="primary" type="button" onClick={() => void props.refreshServerState(props.connectionDraft)} disabled={props.busy === 'Connecting'}>
              {props.busy === 'Connecting' ? 'Connecting...' : 'Test Server'}
            </button>
            <button type="button" onClick={() => void props.handleReadRig()} disabled={props.busy === 'Reading Rig'}>
              {props.busy === 'Reading Rig' ? 'Reading...' : 'Test Rig'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Server Settings</p>
            <h2>QRZ, station identity, and POTA</h2>
          </div>
        </div>
        <form className="settings-form" onSubmit={(event) => void props.handleSaveSettings(event)}>
          <label>
            <span>Station Callsign</span>
            <input value={props.settingsForm.stationCallsign} onChange={(event) => props.setSettingsForm((current) => ({ ...current, stationCallsign: event.target.value }))} />
          </label>
          <label>
            <span>Station Name</span>
            <input value={props.settingsForm.stationName} onChange={(event) => props.setSettingsForm((current) => ({ ...current, stationName: event.target.value }))} />
          </label>
          <label>
            <span>My Grid Square</span>
            <input value={props.settingsForm.myGridSquare} onChange={(event) => props.setSettingsForm((current) => ({ ...current, myGridSquare: event.target.value }))} />
          </label>
          <label>
            <span>My State</span>
            <input value={props.settingsForm.myState} onChange={(event) => props.setSettingsForm((current) => ({ ...current, myState: event.target.value.toUpperCase() }))} />
          </label>
          <label>
            <span>My County</span>
            <input value={props.settingsForm.myCounty} onChange={(event) => props.setSettingsForm((current) => ({ ...current, myCounty: event.target.value }))} />
          </label>
          <label>
            <span>QRZ Username</span>
            <input value={props.settingsForm.qrzUsername} onChange={(event) => props.setSettingsForm((current) => ({ ...current, qrzUsername: event.target.value }))} />
          </label>
          <label>
            <span>QRZ Password</span>
            <input type="password" value={props.settingsForm.qrzPassword} onChange={(event) => props.setSettingsForm((current) => ({ ...current, qrzPassword: event.target.value }))} placeholder="Enter to update" />
          </label>
          <label>
            <span>QRZ Logbook API Key</span>
            <input value={props.settingsForm.qrzApiKey} onChange={(event) => props.setSettingsForm((current) => ({ ...current, qrzApiKey: event.target.value }))} placeholder="Enter to update" />
          </label>
          <label>
            <span>POTA API Key</span>
            <input value={props.settingsForm.potaApiKey} onChange={(event) => props.setSettingsForm((current) => ({ ...current, potaApiKey: event.target.value }))} placeholder="Enter to update" />
          </label>
          <button className="primary" type="submit">Save Server Settings</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Status</p>
            <h2>Current readiness</h2>
          </div>
        </div>
        <div className="settings-summary">
          <span className="pill">{props.connection.serverUrl}</span>
          <span className="pill">{props.appSettings?.adminAccess ? 'Admin ready' : 'Client-only access'}</span>
          <span className="pill">{props.appSettings?.qrzConfigured ? 'QRZ ready' : 'QRZ not ready'}</span>
          <span className="pill">{props.appSettings?.potaConfigured ? 'POTA ready' : 'POTA not ready'}</span>
          <span className="pill">{props.rigState?.radioName ?? props.rigConnection.endpoint}</span>
        </div>
      </section>
    </div>
  )
}
