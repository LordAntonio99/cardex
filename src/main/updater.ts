import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { broadcast } from './events'
import { log } from './log'

const { autoUpdater } = electronUpdater

/**
 * Autoactualización contra las releases de GitHub.
 *
 * Los instaladores van sin firmar de momento: electron-updater sigue
 * funcionando (sólo verifica la firma si el `app-update.yml` empaquetado trae
 * `publisherName`, y una compilación sin firmar no lo trae), pero SmartScreen
 * avisará la primera vez. El día que se firme, pasar de sin firma a con firma
 * es seguro; al revés rompería el actualizador de quienes ya la tengan.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let state: UpdateStatus = { state: 'idle' }

/**
 * Si la comprobación en curso la ha pedido el usuario.
 *
 * Sólo sirve para decidir si un fallo se enseña o se traga: ver el manejador de
 * `error`.
 */
let manual = false

function set(next: UpdateStatus): void {
  state = next
  broadcast('update:changed', next)
}

export function status(): UpdateStatus {
  return state
}

export function initUpdater(): void {
  // En desarrollo no hay nada que actualizar y el updater sólo molestaría.
  if (!app.isPackaged) {
    log.info('Autoactualización desactivada: la aplicación no está empaquetada')
    return
  }

  autoUpdater.autoDownload = true
  // Instalar al salir sin preguntar sería una sorpresa desagradable: lo decide
  // el usuario desde el aviso de la cabecera.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = {
    info: (m: unknown) => log.info(`[updater] ${String(m)}`),
    warn: (m: unknown) => log.warn(`[updater] ${String(m)}`),
    error: (m: unknown) => log.error(`[updater] ${String(m)}`),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'idle' }))
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    log.warn(`[updater] ${err.message}`)
    // Que una comprobación AUTOMÁTICA falle no merece molestar a nadie: lo
    // normal es que sea no tener red. Pero si la ha pedido el usuario, callarse
    // es peor: se queda mirando un control que no reacciona, sin saber si es
    // que no hay versión nueva o que algo ha fallado.
    set(manual ? { state: 'error', message: err.message } : { state: 'idle' })
  })

  setTimeout(() => void check(), 8000)
  setInterval(() => void check(), CHECK_INTERVAL_MS)
}

/**
 * Comprueba si hay versión nueva.
 *
 * `byUser` marca las que salen de pulsar el control de la cabecera, que son las
 * únicas cuyo fallo se enseña.
 */
export async function check(byUser = false): Promise<UpdateStatus> {
  // En desarrollo no hay nada que comprobar, y devolver 'idle' sin más dejaba
  // pulsando un control que no hacía absolutamente nada. Se PUBLICA el estado,
  // no sólo se devuelve: la cabecera se entera por el evento, no por el valor
  // de retorno.
  if (!app.isPackaged) {
    if (byUser) {
      set({ state: 'error', message: 'La autoactualización sólo funciona en la aplicación instalada' })
    }
    return state
  }
  manual = byUser
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    log.warn(`No se ha podido comprobar si hay actualizaciones: ${String(e)}`)
    if (byUser) set({ state: 'error', message: String(e) })
  } finally {
    manual = false
  }
  return state
}

export function install(): void {
  if (state.state !== 'ready') return
  autoUpdater.quitAndInstall(false, true)
}
