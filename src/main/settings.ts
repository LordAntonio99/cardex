import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  CARD_LANGS,
  DEFAULT_SETTINGS,
  EFFECTS_3D,
  GAMES,
  UI_LANGS,
  type AppSettings,
  type CardLang,
  type Effect3d,
  type GameId,
  type ThemeSource,
  type UiLang
} from '@shared/types'
import { log } from './log'

/**
 * Ajustes en un JSON dentro de userData.
 *
 * Se escribe a un temporal y se renombra encima: un renombrado es atómico en
 * el mismo volumen, así que un corte de luz a mitad no deja el fichero a
 * medias. Es la razón de no usar writeFileSync directo.
 */

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

interface Persisted {
  settings: AppSettings
  bounds: WindowBounds
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1380, height: 900, maximized: false }

let cache: Persisted | null = null

function file(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return path.join(dir, 'settings.json')
}

const THEMES: ThemeSource[] = ['system', 'light', 'dark']

/** Sólo para no guardar cualquier cosa como dirección del QR. */
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

/** Nunca confiamos en el JSON del disco: puede venir de una versión anterior. */
function coerce(raw: unknown): Persisted {
  const obj = (raw ?? {}) as Partial<Persisted>
  const s = (obj.settings ?? {}) as Partial<AppSettings>
  const b = (obj.bounds ?? {}) as Partial<WindowBounds>

  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback

  return {
    settings: {
      uiLang: pick<UiLang>(s.uiLang, UI_LANGS, DEFAULT_SETTINGS.uiLang),
      // Un juego que esta versión ya no conozca cae a 'all' en vez de dejar la
      // aplicación filtrando por algo que no existe y enseñando cero cartas.
      game: pick<GameId | 'all'>(s.game, ['all', ...GAMES], DEFAULT_SETTINGS.game),
      theme: pick<ThemeSource>(s.theme, THEMES, DEFAULT_SETTINGS.theme),
      effect3d: pick<Effect3d>(s.effect3d, EFFECTS_3D, DEFAULT_SETTINGS.effect3d),
      downloadImages:
        typeof s.downloadImages === 'boolean' ? s.downloadImages : DEFAULT_SETTINGS.downloadImages,
      reduceMotion:
        typeof s.reduceMotion === 'boolean' ? s.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
      cameraId: typeof s.cameraId === 'string' && s.cameraId ? s.cameraId : null,
      cameraLabel: typeof s.cameraLabel === 'string' && s.cameraLabel ? s.cameraLabel : null,
      scanLang: CARD_LANGS.includes(s.scanLang as CardLang) ? (s.scanLang as CardLang) : null,
      scanAutoCapture:
        typeof s.scanAutoCapture === 'boolean'
          ? s.scanAutoCapture
          : DEFAULT_SETTINGS.scanAutoCapture,
      phonePort:
        typeof s.phonePort === 'number' &&
        Number.isInteger(s.phonePort) &&
        s.phonePort >= 1024 &&
        s.phonePort <= 65535
          ? s.phonePort
          : DEFAULT_SETTINGS.phonePort,
      // No se comprueba que la dirección siga existiendo: puede ser la de una
      // red a la que el portátil todavía no se ha conectado hoy. El panel del
      // escáner ya avisa cuando la elegida no está entre las candidatas.
      phoneAddress:
        typeof s.phoneAddress === 'string' && IPV4.test(s.phoneAddress) ? s.phoneAddress : null
    },
    bounds: {
      x: typeof b.x === 'number' ? b.x : undefined,
      y: typeof b.y === 'number' ? b.y : undefined,
      width: typeof b.width === 'number' && b.width > 400 ? b.width : DEFAULT_BOUNDS.width,
      height: typeof b.height === 'number' && b.height > 300 ? b.height : DEFAULT_BOUNDS.height,
      maximized: typeof b.maximized === 'boolean' ? b.maximized : false
    }
  }
}

function load(): Persisted {
  if (cache) return cache
  try {
    const raw = readFileSync(file(), 'utf8')
    cache = coerce(JSON.parse(raw))
  } catch {
    // No existe todavía, o está corrupto: se arranca con los valores por defecto.
    cache = coerce({})
  }
  return cache
}

function persist(): void {
  if (!cache) return
  const target = file()
  const tmp = `${target}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
    renameSync(tmp, target)
  } catch (e) {
    log.error('No se han podido guardar los ajustes', e)
  }
}

export function getSettings(): AppSettings {
  return { ...load().settings }
}

export function patchSettings(patch: Partial<AppSettings>): AppSettings {
  const current = load()
  current.settings = coerce({ ...current, settings: { ...current.settings, ...patch } }).settings
  persist()
  return { ...current.settings }
}

export function getBounds(): WindowBounds {
  return { ...load().bounds }
}

export function setBounds(bounds: WindowBounds): void {
  load().bounds = bounds
  persist()
}
