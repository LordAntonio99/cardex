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
    // Quedarse sin red no es un error que merezca molestar al usuario.
    log.warn(`[updater] ${err.message}`)
    set({ state: 'idle' })
  })

  setTimeout(() => void check(), 8000)
  setInterval(() => void check(), CHECK_INTERVAL_MS)
}

export async function check(): Promise<UpdateStatus> {
  if (!app.isPackaged) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    log.warn(`No se ha podido comprobar si hay actualizaciones: ${String(e)}`)
  }
  return state
}

export function install(): void {
  if (state.state !== 'ready') return
  autoUpdater.quitAndInstall(false, true)
}
