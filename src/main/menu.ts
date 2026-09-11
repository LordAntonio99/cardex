import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { VIEWS, type ViewId } from '@shared/types'
import { dataDir } from './db'
import { log } from './log'

const isMac = process.platform === 'darwin'

/**
 * Etiquetas de las vistas. Se duplican del renderer a propósito: el menú
 * nativo lo pinta el sistema operativo antes de que exista el renderer, así
 * que no puede leer su i18n.
 */
const VIEW_LABELS: Record<ViewId, string> = {
  collection: 'Colección',
  explorer: 'Explorador',
  sets: 'Sets y sobres',
  scan: 'Escáner',
  market: 'Mercado'
}

/**
 * Aceleradores por menú, no con globalShortcut: éste último los registra a
 * nivel de sistema y se los robaría a cualquier otra aplicación abierta.
 */
export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const go = (view: ViewId) => (): void => {
    getWindow()?.webContents.send('nav:go', { view })
  }

  const viewItems: MenuItemConstructorOptions[] = VIEWS.map((v, i) => ({
    label: `${String(i + 1).padStart(2, '0')} · ${VIEW_LABELS[v]}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: go(v)
  }))

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir carpeta de datos',
          click: () => {
            try {
              void shell.openPath(dataDir())
            } catch (e) {
              log.error('No se ha podido abrir la carpeta de datos', e)
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    { label: 'Ir a', submenu: viewItems },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom original' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Repositorio del proyecto',
          click: () => void shell.openExternal('https://github.com/LordAntonio99/cardex')
        },
        {
          label: 'Informar de un problema',
          click: () => void shell.openExternal('https://github.com/LordAntonio99/cardex/issues')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
