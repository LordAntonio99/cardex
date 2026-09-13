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
  GameId,
  Movement,
  PhoneSession,
  PortfolioSnapshot,
  PortfolioStats,
  PricePoint,
  ScanCommitItem,
  ScanEngineStatus,
  ScanResult,
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
  /**
   * Reinicia la aplicación.
   *
   * Lo pide la pantalla de actualización de catálogo: tras traer sets nuevos hay
   * consultas cacheadas, vectores cargados en el reconocedor y una rejilla
   * virtualizada a medio pintar. Invalidar todo eso pieza a pieza es más frágil
   * que arrancar limpio, y arrancar es cosa de segundos.
   */
  'system:restart': { req: void; res: void }

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
  /**
   * Reconoce una captura.
   *
   * No lanza porque no haya carta: eso es un resultado más, y viaja en
   * `status`. Sólo lanza si el motor falla de verdad.
   */
  'scan:identify': {
    req: { imageDataUrl: string }
    res: ScanResult
  }
  /** Confirma el lote: escribe las detecciones aceptadas en la colección. */
  'scan:commit': {
    req: { detections: ScanCommitItem[] }
    res: { added: number }
  }
  /** Estado del motor ahora mismo. Los eventos se pierden si llegan antes de montar. */
  'scan:engineStatus': { req: void; res: ScanEngineStatus }
  /**
   * Arranca el motor sin pedirle nada.
   *
   * Cargar modelo y librerías lleva un segundo largo. Si se hace al encender la
   * cámara, para cuando el usuario coloca la primera carta ya está listo.
   */
  'scan:warmup': { req: void; res: ScanEngineStatus }
  /** Suelta el motor y su memoria al salir de la vista. */
  'scan:release': { req: void; res: void }

  // El móvil como cámara ──────────────────────────────────────────────────────
  /** Estado del servidor del móvil ahora mismo. */
  'phone:status': { req: void; res: PhoneSession }
  /**
   * Levanta el servidor.
   *
   * Es la llamada que hace aparecer el diálogo del Firewall de Windows, así que
   * NUNCA se hace sola al montar una vista: siempre detrás de un botón, y
   * después de avisar de lo que va a pasar. Un diálogo esperado se acepta; uno
   * por sorpresa se cancela, y cancelarlo crea una regla de bloqueo que ya no
   * vuelve a preguntar.
   */
  'phone:start': { req: void; res: PhoneSession }
  'phone:stop': { req: void; res: void }
  /**
   * Cambia la dirección que se codifica en el QR.
   *
   * No reinicia nada: el servidor escucha en 0.0.0.0 y esto sólo decide qué IP
   * se le enseña al móvil. Así probar otra es instantáneo y no invalida la
   * excepción de certificado que el móvil ya haya aceptado.
   */
  'phone:useAddress': { req: { address: string }; res: PhoneSession }

  // Imágenes ──────────────────────────────────────────────────────────────────
  /**
   * Resuelve la URL local de una imagen, descargándola a la caché si hace
   * falta. Devuelve null si las descargas están desactivadas o si falla.
   *
   * Hay tres orígenes distintos y no se pueden tratar igual:
   *
   *  - `card`      la ilustración, con idioma y calidad. Cómo se compone la URL
   *                depende del juego: TCGdex sirve `{lang}/{path}/{quality}.webp`
   *                y el CDN de Riot `{path}?w=…&fm=webp`.
   *  - `setAsset`  logo o símbolo del set, con idioma pero SIN calidad. Sólo
   *                Pokémon: Riot no los publica.
   *  - `external`  una URL https completa, o una ruta dentro del catálogo
   *                publicado. Es lo que usan el arte de sobres y el reverso de
   *                las cartas, que no están en ninguna API de cartas.
   *
   * `game` sólo importa en `card` y `setAsset`; por defecto, Pokémon.
   */
  'images:resolve': {
    req: {
      kind: 'card' | 'setAsset' | 'external'
      path: string
      lang?: string
      quality?: 'low' | 'high'
      game?: GameId
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
  'system:restart',
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
  'scan:engineStatus',
  'scan:warmup',
  'scan:release',
  'phone:status',
  'phone:start',
  'phone:stop',
  'phone:useAddress',
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
  /** El motor de reconocimiento ha cambiado de estado. */
  'scan:engine': ScanEngineStatus
  /** Estado de la sesión del móvil: conexión, contador de capturas, error. */
  'phone:session': PhoneSession
  /**
   * Una captura del móvil, ya reconocida.
   *
   * Trae el mismo `ScanResult` que devolvería `scan:identify`, porque acaba en
   * el mismo lote. Se escucha en `App`, no en la vista del escáner: el lote
   * sobrevive al cambio de pantalla y lo que llegue mientras el usuario mira la
   * colección tiene que entrar igual.
   */
  'phone:scan': { result: ScanResult; source: 'live' | 'photo' }
}

export type IpcEventName = keyof IpcEvents

export const IPC_EVENTS = [
  'theme:changed',
  'catalog:progress',
  'update:changed',
  'db:changed',
  'nav:go',
  'scan:engine',
  'phone:session',
  'phone:scan'
] as const satisfies readonly IpcEventName[]
