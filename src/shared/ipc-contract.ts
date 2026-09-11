/**
 * Contrato IPC único entre renderer y main.
 *
 * Regla: el renderer NUNCA habla con SQLite ni con la red. Todo pasa por aquí.
 * No se expone SQL libre: cada canal es una operación con nombre y tipos cerrados,
 * y el main valida los argumentos antes de tocar la base.
 *
 * `IpcRequests` define las llamadas petición/respuesta (invoke/handle).
 * `IpcEvents` define los avisos que el main empuja al renderer (send/on).
 */

import type {
  AppSettings,
  CardListItem,
  CardPage,
  CardQuery,
  CatalogStatus,
  FilterOptions,
  Movement,
  PortfolioSnapshot,
  PortfolioStats,
  PricePoint,
  ScanDetection,
  SetProgress,
  ThemeSource,
  UpdateStatus
} from './types'

// ── Petición / respuesta ──────────────────────────────────────────────────────

export interface IpcRequests {
  // Ajustes ───────────────────────────────────────────────────────────────────
  'settings:get': { req: void; res: AppSettings }
  'settings:patch': { req: Partial<AppSettings>; res: AppSettings }

  // Ventana y sistema ─────────────────────────────────────────────────────────
  'system:info': {
    req: void
    res: {
      appVersion: string
      electronVersion: string
      chromeVersion: string
      platform: NodeJS.Platform
      /** Resuelto, para poder mostrarlo en Ajustes. */
      userDataPath: string
      /** El tema efectivo ahora mismo, ya resuelto contra el del sistema. */
      resolvedTheme: 'light' | 'dark'
    }
  }
  'system:setTheme': { req: ThemeSource; res: 'light' | 'dark' }
  'system:openPath': { req: { what: 'userData' | 'images' | 'logs' }; res: void }
  'system:openExternal': { req: { url: string }; res: void }

  // Catálogo ──────────────────────────────────────────────────────────────────
  'catalog:status': { req: void; res: CatalogStatus }
  'catalog:sync': { req: { force?: boolean }; res: CatalogStatus }
  'catalog:filters': { req: void; res: FilterOptions }

  // Cartas ────────────────────────────────────────────────────────────────────
  'cards:page': { req: CardQuery; res: CardPage }
  'cards:byId': { req: { cardId: string }; res: CardListItem | null }
  'cards:priceHistory': {
    req: { cardId: string; days: number }
    res: PricePoint[]
  }
  /** Copias que el usuario tiene de esta carta, con su P&L. */
  'cards:copies': {
    req: { cardId: string }
    res: {
      cardKeyId: number
      variant: string
      lang: string
      condition: string
      grader: string
      grade: number
      qty: number
      paidCents: number | null
      pnlCents: number | null
    }[]
  }
  'cards:movements': { req: { cardId: string; limit: number }; res: Movement[] }
  /** En qué sobres puede salir la carta. */
  'cards:packs': { req: { cardId: string }; res: { id: string; name: string }[] }

  // Sets ──────────────────────────────────────────────────────────────────────
  'sets:progress': { req: void; res: SetProgress[] }

  // Colección ─────────────────────────────────────────────────────────────────
  'collection:stats': { req: void; res: PortfolioStats }
  'collection:history': { req: { days: number }; res: PortfolioSnapshot[] }
  'collection:topMovers': {
    req: { limit: number }
    res: { gainers: CardListItem[]; losers: CardListItem[] }
  }

  // Escáner ───────────────────────────────────────────────────────────────────
  /** Reconocimiento de una captura. De momento devuelve una detección simulada. */
  'scan:identify': {
    req: { imageDataUrl: string }
    res: ScanDetection | null
  }
  /** Confirma el lote: escribe las detecciones aceptadas en la colección. */
  'scan:commit': {
    req: { detections: ScanDetection[] }
    res: { added: number }
  }

  // Imágenes ──────────────────────────────────────────────────────────────────
  /**
   * Resuelve la URL local de una imagen, descargándola a la caché si hace
   * falta. Devuelve null si las descargas están desactivadas o si falla.
   *
   * Hay tres orígenes distintos y no se pueden tratar igual:
   *
   *  - `card`      TCGdex, con idioma y calidad: `{lang}/{path}/{quality}.webp`
   *  - `setAsset`  TCGdex, con idioma pero SIN calidad: `{lang}/{path}.webp`
   *                (los logos de set viven ahí, no bajo /high.webp)
   *  - `external`  una URL https completa, o una ruta dentro del catálogo
   *                publicado. Es lo que usan el arte de sobres y el reverso de
   *                las cartas, que no están en ninguna API de cartas.
   */
  'images:resolve': {
    req: {
      kind: 'card' | 'setAsset' | 'external'
      path: string
      lang?: string
      quality?: 'low' | 'high'
    }
    res: string | null
  }

  // Actualización de la aplicación ────────────────────────────────────────────
  'update:status': { req: void; res: UpdateStatus }
  'update:check': { req: void; res: UpdateStatus }
  'update:install': { req: void; res: void }
}

export type IpcChannel = keyof IpcRequests
export type IpcReq<C extends IpcChannel> = IpcRequests[C]['req']
export type IpcRes<C extends IpcChannel> = IpcRequests[C]['res']

export const IPC_CHANNELS = [
  'settings:get',
  'settings:patch',
  'system:info',
  'system:setTheme',
  'system:openPath',
  'system:openExternal',
  'catalog:status',
  'catalog:sync',
  'catalog:filters',
  'cards:page',
  'cards:byId',
  'cards:priceHistory',
  'cards:copies',
  'cards:movements',
  'cards:packs',
  'sets:progress',
  'collection:stats',
  'collection:history',
  'collection:topMovers',
  'scan:identify',
  'scan:commit',
  'images:resolve',
  'update:status',
  'update:check',
  'update:install'
] as const satisfies readonly IpcChannel[]

// ── Eventos main -> renderer ──────────────────────────────────────────────────

export interface IpcEvents {
  /** El tema efectivo ha cambiado (el usuario cambió el del sistema). */
  'theme:changed': 'light' | 'dark'
  /** Progreso de la sincronización de catálogo. */
  'catalog:progress': CatalogStatus
  /** Estado del autoactualizador. */
  'update:changed': UpdateStatus
  /**
   * Han cambiado datos en la base. El renderer invalida las consultas cuyo
   * prefijo coincida, en vez de recargarlo todo.
   */
  'db:changed': { scopes: ('cards' | 'collection' | 'sets' | 'prices' | 'catalog')[] }
  /** El menú nativo pide cambiar de vista (aceleradores Ctrl/Cmd+1..5). */
  'nav:go': { view: string }
}

export type IpcEventName = keyof IpcEvents

export const IPC_EVENTS = [
  'theme:changed',
  'catalog:progress',
  'update:changed',
  'db:changed',
  'nav:go'
] as const satisfies readonly IpcEventName[]
