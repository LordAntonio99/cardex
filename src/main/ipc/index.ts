import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import type { IpcChannel, IpcReq, IpcRes } from '@shared/ipc-contract'
import type { ThemeSource } from '@shared/types'
import { dataDir, imagesDir } from '../db/connection'
import { broadcast } from '../events'
import { log } from '../log'
import { getSettings, patchSettings } from '../settings'
import { applyThemeToWindow } from '../window'

import * as cards from '../repositories/cards'
import * as sets from '../repositories/sets'
import * as collection from '../repositories/collection'
import * as catalog from '../catalog/sync'
import * as images from '../catalog/images'
import * as scan from '../repositories/scan'
import * as recognizer from '../recognition/service'
import * as updater from '../updater'

/**
 * Registra un canal con los tipos del contrato.
 *
 * Que el handler devuelva `IpcRes<C>` obliga a que main y renderer no se
 * puedan desincronizar sin que TypeScript se queje.
 */
function handle<C extends IpcChannel>(
  channel: C,
  fn: (req: IpcReq<C>) => IpcRes<C> | Promise<IpcRes<C>>
): void {
  ipcMain.handle(channel, async (_event, req: IpcReq<C>) => {
    try {
      return await fn(req)
    } catch (e) {
      log.error(`IPC ${channel} ha fallado`, e)
      throw e
    }
  })
}

export function registerIpc(): void {
  // ── Ajustes ────────────────────────────────────────────────────────────────
  handle('settings:get', () => getSettings())
  handle('settings:patch', (patch) => {
    const before = getSettings()
    const next = patchSettings(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    // El juego activo no viaja en cada consulta: `sets:progress`,
    // `catalog:filters` y las cifras de Mercado lo leen de los ajustes. Al
    // cambiarlo hay que decirle al renderer que lo que tiene cacheado ya no
    // vale, o se quedaría enseñando el juego anterior hasta cambiar de vista.
    if (next.game !== before.game) {
      broadcast('db:changed', { scopes: ['catalog', 'cards', 'sets', 'collection'] })
    }
    return next
  })

  // ── Sistema ────────────────────────────────────────────────────────────────
  handle('system:info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    resolvedTheme: nativeTheme.shouldUseDarkColors ? ('dark' as const) : ('light' as const)
  }))

  handle('system:setTheme', (theme: ThemeSource) => {
    nativeTheme.themeSource = theme
    patchSettings({ theme })
    const win = BrowserWindow.getAllWindows()[0]
    return win ? applyThemeToWindow(win) : nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  handle('system:openPath', async ({ what }) => {
    const target =
      what === 'images' ? imagesDir() : what === 'logs' ? log.logsDir() : dataDir()
    await shell.openPath(target)
  })

  handle('system:restart', () => {
    app.relaunch()
    app.quit()
  })
  handle('system:openExternal', async ({ url }) => {
    // Sólo https: nunca abrimos lo que nos pasen sin mirar el esquema.
    if (!url.startsWith('https://')) throw new Error(`Esquema no permitido: ${url}`)
    await shell.openExternal(url)
  })

  // ── Catálogo ───────────────────────────────────────────────────────────────
  handle('catalog:status', () => catalog.status())
  handle('catalog:sync', ({ force }) => catalog.sync({ force: force ?? false }))
  handle('catalog:filters', () => cards.filterOptions())

  // ── Cartas ─────────────────────────────────────────────────────────────────
  handle('cards:page', (query) => cards.page(query))
  handle('cards:byId', ({ cardId }) => cards.byId(cardId))
  handle('cards:priceHistory', ({ cardId, days }) => cards.priceHistory(cardId, days))
  handle('cards:copies', ({ cardId }) => cards.copies(cardId))
  handle('cards:movements', ({ cardId, limit }) => cards.movements(cardId, limit))
  handle('cards:packs', ({ cardId }) => cards.packs(cardId))

  // ── Sets ───────────────────────────────────────────────────────────────────
  handle('sets:progress', () => sets.progress())

  // ── Colección ──────────────────────────────────────────────────────────────
  handle('collection:stats', () => collection.stats())
  handle('collection:history', ({ days }) => collection.history(days))
  handle('collection:topMovers', ({ limit }) => collection.topMovers(limit))

  // ── Escáner ────────────────────────────────────────────────────────────────
  handle('scan:identify', ({ imageDataUrl }) => scan.identify(imageDataUrl))
  handle('scan:commit', ({ detections }) => scan.commit(detections))
  handle('scan:engineStatus', () => recognizer.engineStatus())
  handle('scan:warmup', async () => {
    // Un fallo al calentar no es un error que deba subir al renderer: el estado
    // ya lo cuenta, y la vista lo pinta.
    try {
      await recognizer.start()
    } catch (e) {
      log.warn(`No se ha podido arrancar el reconocedor: ${e instanceof Error ? e.message : e}`)
    }
    return recognizer.engineStatus()
  })
  handle('scan:release', () => recognizer.stop())

  // ── Imágenes ───────────────────────────────────────────────────────────────
  handle('images:resolve', ({ kind, path: assetPath, lang, quality, game }) =>
    images.resolve(kind, assetPath, lang, quality, game)
  )

  // ── Actualización ──────────────────────────────────────────────────────────
  handle('update:status', () => updater.status())
  handle('update:check', () => updater.check())
  handle('update:install', () => updater.install())

  log.info('Canales IPC registrados')
}
