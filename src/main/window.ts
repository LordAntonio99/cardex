import path from 'node:path'
import { BrowserWindow, nativeTheme, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getBounds, getSettings, setBounds } from './settings'
import { log } from './log'

/**
 * Altura de la cabecera del diseño. La barra de título nativa se solapa con
 * ella, así que este número tiene que coincidir con el CSS del renderer.
 */
export const HEADER_HEIGHT = 62

/** Colores del design system, necesarios aquí para pintar la barra de título. */
const THEME_COLORS = {
  dark: { bg: '#17191d', symbol: '#a6aab1' },
  light: { bg: '#f4f1ea', symbol: '#4a4e57' }
} as const

export function resolvedTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * Los bounds guardados pueden apuntar a un monitor que ya no está conectado.
 * Si el rectángulo no toca ninguna pantalla, se descarta y se centra.
 */
function boundsAreVisible(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea
    return x < w.x + w.width && x + width > w.x && y < w.y + w.height && y + height > w.y
  })
}

export function createWindow(): BrowserWindow {
  const saved = getBounds()
  const theme = resolvedTheme()
  const colors = THEME_COLORS[theme]

  const usePosition =
    saved.x !== undefined &&
    saved.y !== undefined &&
    boundsAreVisible(saved.x, saved.y, saved.width, saved.height)

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(usePosition ? { x: saved.x, y: saved.y } : {}),
    minWidth: 1040,
    minHeight: 680,

    // Con titleBarOverlay, `ready-to-show` no llega si la ventana nace oculta.
    // El truco habitual de show:false para evitar el parpadeo no sirve aquí, así
    // que se compensa con backgroundColor al tono del diseño.
    show: true,
    backgroundColor: colors.bg,

    // La cabecera del diseño ES la barra de título.
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: colors.bg,
            symbolColor: colors.symbol,
            height: HEADER_HEIGHT
          }
        }
      : {}),
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 18, y: Math.round(HEADER_HEIGHT / 2) - 8 } }
      : {}),

    title: 'Cardex',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // El efecto holográfico depende de compositing acelerado.
      backgroundThrottling: false
    }
  })

  if (saved.maximized) win.maximize()

  // Nada de ventanas nuevas: los enlaces externos van al navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // La cámara del escáner. Todo lo demás se deniega.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  const persist = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    // Si está maximizada se guarda el tamaño "normal", no el de pantalla completa.
    const b = maximized ? win.getNormalBounds() : win.getBounds()
    setBounds({ x: b.x, y: b.y, width: b.width, height: b.height, maximized })
  }

  let timer: NodeJS.Timeout | null = null
  const persistSoon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, 400)
  }
  win.on('resize', persistSoon)
  win.on('move', persistSoon)
  win.on('maximize', persistSoon)
  win.on('unmaximize', persistSoon)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    persist()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`El proceso del renderer se ha caído: ${details.reason}`)
  })

  return win
}

/**
 * Repinta la barra de título nativa cuando cambia el tema.
 *
 * Hay que llamarlo en cada cambio: los colores del overlay no siguen al tema
 * por su cuenta. Y setTitleBarOverlay revienta en Windows si la ventana no se
 * creó con titleBarStyle 'hidden'.
 */
export function applyThemeToWindow(win: BrowserWindow): 'light' | 'dark' {
  const theme = resolvedTheme()
  const colors = THEME_COLORS[theme]
  win.setBackgroundColor(colors.bg)
  if (process.platform === 'win32' && !win.isDestroyed()) {
    try {
      win.setTitleBarOverlay({
        color: colors.bg,
        symbolColor: colors.symbol,
        height: HEADER_HEIGHT
      })
    } catch (e) {
      log.warn(`No se ha podido repintar la barra de título: ${String(e)}`)
    }
  }
  return theme
}

/** Aplica la preferencia de tema guardada al arrancar. */
export function applyStoredThemeSource(): void {
  nativeTheme.themeSource = getSettings().theme
}
