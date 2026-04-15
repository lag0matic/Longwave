import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from './desktop'

type DesktopApiHeader = {
  name: string
  value: string
}

type DesktopApiResponse = {
  status: number
  body: string
  endpoint: string
}

type ServerCertificateInfo = {
  endpoint: string
  fingerprint: string
}

type DesktopImportAdifResponse = {
  importedCount: number
  endpoint: string
}

export function canUseDesktopApi() {
  return isDesktopRuntime()
}

export async function desktopApiRequest(input: {
  endpoints: string[]
  method: string
  path: string
  headers: DesktopApiHeader[]
  body?: string
  pinnedFingerprint?: string
}): Promise<DesktopApiResponse> {
  return invoke<DesktopApiResponse>('desktop_api_request', input)
}

export async function probeServerCertificate(endpoint: string): Promise<ServerCertificateInfo> {
  if (!isDesktopRuntime()) {
    throw new Error('Certificate probing is only available in the desktop app.')
  }
  return invoke<ServerCertificateInfo>('probe_server_certificate', { endpoint })
}

export async function desktopImportAdif(input: {
  endpoints: string[]
  logbookId: string
  operatorCallsign: string
  filename: string
  adifText: string
  apiToken: string
  pinnedFingerprint?: string
}): Promise<DesktopImportAdifResponse> {
  return invoke<DesktopImportAdifResponse>('desktop_import_adif', input)
}
