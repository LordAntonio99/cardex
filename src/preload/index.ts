import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcChannel,
  type IpcEventName,
  type IpcEvents,
  type IpcReq,
  type IpcRes
} from '@shared/ipc-contract'

/**
 * Único puente entre el renderer y el proceso main.
 *
 * No se expone `ipcRenderer` ni nada que se le parezca: sólo estas dos
 * funciones, y ambas comprueban el canal contra la lista del contrato. Así un
 * fallo en el renderer no puede convertirse en una llamada arbitraria al
 * proceso con acceso al sistema de ficheros.
 */

const CHANNELS = new Set<string>(IPC_CHANNELS)
const EVENTS = new Set<string>(IPC_EVENTS)

const api = {
  invoke<C extends IpcChannel>(channel: C, req: IpcReq<C>): Promise<IpcRes<C>> {
    if (!CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Canal IPC no permitido: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel, req) as Promise<IpcRes<C>>
  },

  /** Se suscribe a un evento. Devuelve la función para darse de baja. */
  on<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): () => void {
    if (!EVENTS.has(event)) throw new Error(`Evento IPC no permitido: ${String(event)}`)
    const listener = (_e: unknown, payload: IpcEvents[E]): void => cb(payload)
    ipcRenderer.on(event, listener)
    return () => {
      ipcRenderer.removeListener(event, listener)
    }
  }
}

export type CardexApi = typeof api

contextBridge.exposeInMainWorld('api', api)
