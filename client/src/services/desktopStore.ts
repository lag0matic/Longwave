import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from './desktop'

export async function desktopStoreGet<T>(key: string): Promise<T | null> {
  if (!isDesktopRuntime()) {
    return null
  }

  const value = await invoke<T | null>('desktop_store_get', { key })
  return value ?? null
}

export async function desktopStoreSet<T>(key: string, value: T): Promise<void> {
  if (!isDesktopRuntime()) {
    return
  }

  await invoke('desktop_store_set', { key, value })
}
