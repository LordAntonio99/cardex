import { BrowserWindow } from 'electron'
import type { IpcEvents } from '@shared/ipc-contract'

/**
 * Avisos de main hacia el renderer.
 *
 * Vive en su propio módulo para romper el ciclo de importaciones: el registro
 * IPC necesita a los servicios y los servicios necesitan avisar, pero ninguno
 * debe importar al otro.
 */
export function broadcast<E extends keyof IpcEvents>(event: E, payload: IpcEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  }
}
