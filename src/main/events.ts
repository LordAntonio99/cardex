import { EventEmitter } from 'node:events'
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

/**
 * Avisos internos del proceso principal, de un módulo a otro.
 *
 * `broadcast` sólo llega al renderer, y hay cosas que el renderer no tiene por
 * qué intermediar: cuando el catálogo termina de importar, el reconocedor debe
 * recargar sus vectores, y eso es asunto exclusivo de main. Sin este bus, el
 * sincronizador tendría que importar al reconocedor y se volvería a cerrar el
 * ciclo que este módulo existe para romper.
 */
export interface MainEvents {
  /** El catálogo ha cambiado en disco: sets, cartas o vectores de reconocimiento. */
  'catalog:imported': []
}

class MainBus extends EventEmitter<MainEvents> {}

export const mainBus = new MainBus()
