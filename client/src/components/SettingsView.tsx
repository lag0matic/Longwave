import { useMemo, useState } from 'react'
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
  saveServerSettings: () => Promise<void>
  handleTrustServer: () => Promise<void>
  handleReadRig: () => Promise<void>
  rigState: RigState | null
}

export function SettingsView(props: SettingsViewProps) {
  const [wizardStep, setWizardStep] = useState(0)
  const additionalEndpoints = (props.connectionDraft.additionalServerUrls ?? '')
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean)
  const endpointReady = Boolean(props.connectionDraft.serverUrl.trim())
  const tokenReady = Boolean(props.connectionDraft.apiToken.trim())
  const trustReady = Boolean(props.connectionDraft.pinnedFingerprint?.trim())
  const adminReady = Boolean((props.connectionDraft.adminToken ?? props.connectionDraft.apiToken).trim())
  const stationReady = Boolean(props.settingsForm.stationCallsign.trim())
  const steps = useMemo(
    () => [
      {
        title: 'Choose Endpoints',
        description: 'Start with the fastest local address and add any remote fallbacks underneath it.',
        complete: endpointReady,
      },
      {
        title: 'Trust The Server',
        description: 'Pin the server identity once so both Windows and Linux can trust the same host cleanly.',
        complete: trustReady,
      },
      {
        title: 'Add Tokens',
        description: 'Use the client token for daily use and the admin token for station settings and maintenance.',
        complete: tokenReady && adminReady,
      },
      {
        title: 'Save Station',
        description: 'Set the operator identity that should appear across logs, QRZ, and ADIF export.',
        complete: stationReady,
      },
    ],
    [adminReady, endpointReady, stationReady, tokenReady, trustReady],
  )
  const activeStep = steps[wizardStep] ?? steps[0]

  function handleSaveLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.handleSaveLocalConnection()
    window.localStorage.setItem('longwave-rig-connection', JSON.stringify(props.rigConnection))
  }

  return (
    <div className="page-grid settings-grid">
      <section className="panel wizard-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Setup Wizard</p>
            <h2>Connect this desktop to your Longwave server</h2>
          </div>
        </div>
        <div className="wizard-step-list">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              className={`wizard-step ${wizardStep === index ? 'active' : ''} ${step.complete ? 'complete' : ''}`}
              onClick={() => setWizardStep(index)}
            >
              <strong>{index + 1}. {step.title}</strong>
              <span>{step.complete ? 'Ready' : 'Pending'}</span>
            </button>
          ))}
        </div>
        <div className="wizard-card">
          <p className="eyebrow">Current Step</p>
          <h3>{activeStep.title}</h3>
          <p className="muted">{activeStep.description}</p>

          {wizardStep === 0 ? (
            <div className="wizard-body">
              <label>
                <span>Primary Server URL</span>
                <input value={props.connectionDraft.serverUrl} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="Example: https://192.168.4.194/api/v1" />
              </label>
              <label>
                <span>Fallback Server URLs</span>
                <textarea rows={3} value={props.connectionDraft.additionalServerUrls ?? ''} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, additionalServerUrls: event.target.value }))} placeholder={'One per line.\nExample:\nhttps://thearkive.xyz/api/v1'} />
              </label>
              <div className="settings-summary endpoint-preview">
                <span className="pill">{props.connectionDraft.serverUrl || 'No primary endpoint yet'}</span>
                {additionalEndpoints.map((endpoint) => (
                  <span className="pill" key={endpoint}>{endpoint}</span>
                ))}
              </div>
              <div className="inline-actions">
                <button type="button" className="primary" onClick={props.handleSaveLocalConnection}>Save Endpoints</button>
                <button type="button" onClick={() => setWizardStep(1)} disabled={!endpointReady}>Continue</button>
              </div>
            </div>
          ) : null}

          {wizardStep === 1 ? (
            <div className="wizard-body">
              <label>
                <span>Pinned Server Fingerprint</span>
                <input value={props.connectionDraft.pinnedFingerprint ?? ''} readOnly placeholder="Trust a server to pin its identity here" />
              </label>
              <div className="inline-actions">
                <button type="button" className="primary" onClick={() => void props.handleTrustServer()} disabled={props.busy === 'Trusting Server' || !endpointReady}>
                  {props.busy === 'Trusting Server' ? 'Trusting...' : 'Trust Server'}
                </button>
                <button type="button" onClick={() => setWizardStep(2)} disabled={!trustReady}>Continue</button>
              </div>
            </div>
          ) : null}

          {wizardStep === 2 ? (
            <div className="wizard-body">
              <label>
                <span>Client API Token</span>
                <input value={props.connectionDraft.apiToken} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, apiToken: event.target.value }))} />
              </label>
              <label>
                <span>Admin Token</span>
                <input value={props.connectionDraft.adminToken ?? ''} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, adminToken: event.target.value }))} placeholder="Use the admin token from LongwaveServer.exe" />
              </label>
              <div className="inline-actions">
                <button type="button" onClick={props.handleSaveLocalConnection}>Save Tokens</button>
                <button className="primary" type="button" onClick={() => void props.refreshServerState(props.connectionDraft)} disabled={props.busy === 'Connecting' || !tokenReady}>
                  {props.busy === 'Connecting' ? 'Connecting...' : 'Test Server'}
                </button>
                <button type="button" onClick={() => setWizardStep(3)} disabled={!tokenReady || !adminReady}>Continue</button>
              </div>
            </div>
          ) : null}

          {wizardStep === 3 ? (
            <div className="wizard-body">
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
              <div className="inline-actions">
                <button className="primary" type="button" onClick={() => void props.saveServerSettings()} disabled={props.busy === 'Saving Settings' || !stationReady}>
                  {props.busy === 'Saving Settings' ? 'Saving...' : 'Save Station Settings'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

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
            <p className="muted">Use one server profile with a preferred endpoint and any number of fallbacks. Longwave will trust the pinned server identity rather than the hostname.</p>
          </div>
          <label>
            <span>Primary Server URL</span>
            <input value={props.connectionDraft.serverUrl} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="Example: https://192.168.4.194/api/v1" />
          </label>
          <label>
            <span>Fallback Server URLs</span>
            <textarea rows={3} value={props.connectionDraft.additionalServerUrls ?? ''} onChange={(event) => props.setConnectionDraft((current) => ({ ...current, additionalServerUrls: event.target.value }))} placeholder={'One per line.\nExample:\nhttps://thearkive.xyz/api/v1'} />
          </label>
          <div className="settings-summary endpoint-preview">
            <span className="pill">{props.connectionDraft.serverUrl || 'No primary endpoint yet'}</span>
            {additionalEndpoints.map((endpoint) => (
              <span className="pill" key={endpoint}>{endpoint}</span>
            ))}
          </div>
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
          {(props.connection.additionalServerUrls ?? '').split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean).map((endpoint) => (
            <span className="pill" key={endpoint}>{endpoint}</span>
          ))}
          <span className="pill">{props.appSettings?.adminAccess ? 'Admin ready' : 'Client-only access'}</span>
          <span className="pill">{props.connection.pinnedFingerprint ? 'Pinned trust ready' : 'Server not trusted yet'}</span>
          <span className="pill">{props.appSettings?.qrzConfigured ? 'QRZ ready' : 'QRZ not ready'}</span>
          <span className="pill">{props.appSettings?.potaConfigured ? 'POTA ready' : 'POTA not ready'}</span>
          <span className="pill">{props.rigState?.radioName ?? props.rigConnection.endpoint}</span>
        </div>
      </section>
    </div>
  )
}
