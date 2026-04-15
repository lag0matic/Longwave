import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from './desktop'

export type FlrigTuneRequest = {
  frequencyHz: number
  mode: string
}

export type FlrigConnection = {
  endpoint: string
}

export type FlrigState = {
  endpoint: string
  radioName?: string
  version?: string
  frequencyHz?: number
  mode?: string
}

type FlrigResult = {
  ok: boolean
  message: string
}

export async function readFlrigState(connection: FlrigConnection): Promise<FlrigState> {
  if (!connection.endpoint) {
    throw new Error('No FLrig endpoint configured on this client.')
  }

  if (!isDesktopRuntime()) {
    return {
      endpoint: connection.endpoint,
    }
  }

  return invoke<FlrigState>('read_flrig_state', {
    endpoint: connection.endpoint,
  })
}

export async function tuneFlrig(
  connection: FlrigConnection,
  request: FlrigTuneRequest,
): Promise<FlrigResult> {
  if (!connection.endpoint) {
    return { ok: false, message: 'No FLrig endpoint configured on this client.' }
  }

  if (isDesktopRuntime()) {
    return invoke<FlrigResult>('tune_flrig', {
      endpoint: connection.endpoint,
      frequencyHz: request.frequencyHz,
      mode: request.mode,
    })
  }

  return {
    ok: false,
    message: `Desktop rig control is only available in the Tauri app. Configure ${connection.endpoint} there to tune ${request.frequencyHz.toFixed(0)} Hz ${request.mode}.`,
  }
}
