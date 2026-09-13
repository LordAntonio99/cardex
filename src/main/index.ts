import { app, BrowserWindow, nativeTheme } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerImageProtocol, registerImageScheme } from './catalog/images'
import { scheduleBackgroundSync } from './catalog/sync'
import { initDatabases, shutdownDatabases } from './db'
import { registerIpc } from './ipc'
import { registerCatalogWatch, stop as stopRecognizer } from './recognition/service'
import { stop as stopPhone } from './phone/server'
import { buildMenu } from './menu'
import { log } from './log'
import { initUpdater } from './updater'
import { applyStoredThemeSource, applyThemeToWindow, createWindow } from './window'

// Los esquemas privilegiados hay que declararlos ANTES de que la aplicación
// esté lista; después ya no surte efecto.
registerImageScheme()

/**
 * Dos procesos sobre el mismo fichero WAL no corrompen nada, pero cada uno
 * tendría su propia caché en memoria y servirían datos distintos al usuario.
 * Una sola instancia; la segunda trae al frente la que ya está abierta.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('es.lordantonio99.cardex')

    let dbReady = false
    try {
      initDatabases()
      dbReady = true
    } catch (e) {
      log.error('No se han podido abrir las bases de datos', e)
    }

    applyStoredThemeSource()
    registerImageProtocol()
    registerIpc()

    mainWindow = createWindow()
    buildMenu(() => mainWindow)

    if (dbReady) {
      scheduleBackgroundSync()
      // El reconocedor tiene que enterarse de que hay vectores nuevos cuando el
      // catálogo se reimporta; si no, seguiría comparando contra los antiguos.
      registerCatalogWatch()
    }
    initUpdater()

    // El tema del sistema puede cambiar con la aplicación abierta.
    nativeTheme.on('updated', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const theme = applyThemeToWindow(mainWindow)
      mainWindow.webContents.send('theme:changed', theme)
    })

    app.on('browser-window-created', (_e, win) => {
      optimizer.watchWindowShortcuts(win)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        buildMenu(() => mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    // Primero el proceso auxiliar: dejarlo huérfano mantendría vivo un proceso
    // con el modelo cargado después de cerrar la ventana.
    stopRecognizer()
    // Y el puerto del móvil, que si no se queda escuchando sin nadie al otro
    // lado hasta que el sistema operativo lo recoja.
    stopPhone()
    shutdownDatabases()
  })

  process.on('uncaughtException', (e) => log.error('Excepción no capturada en main', e))
  process.on('unhandledRejection', (e) => log.error('Promesa rechazada sin capturar en main', e))
}
