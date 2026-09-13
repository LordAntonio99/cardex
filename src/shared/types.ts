/**
 * Modelo de dominio compartido entre el proceso main y el renderer.
 *
 * Convenciones que se respetan en todo el proyecto:
 *  - El dinero viaja SIEMPRE en céntimos enteros. Nunca float.
 *  - Las fechas viajan como epoch en milisegundos, o como `day` (días desde epoch)
 *    cuando la granularidad es diaria (precios, snapshots de cartera).
 *  - `cardId` es el identificador de TCGdex (`sv03-125`) y es una referencia lógica:
 *    vive en catalogue.db, pero collection.db lo guarda sin clave foránea a propósito.
 */

// ── Enumerados ────────────────────────────────────────────────────────────────

/** Idioma de la carta física. */
export type CardLang = 'es' | 'en' | 'ja'
export const CARD_LANGS: readonly CardLang[] = ['es', 'en', 'ja']

/** Idioma de la interfaz. */
export type UiLang = 'es' | 'en'
export const UI_LANGS: readonly UiLang[] = ['es', 'en']

/** Variante de impresión. TCGdex las expone como booleanos por carta. */
export type Variant = 'normal' | 'holo' | 'reverse' | 'first_ed'
export const VARIANTS: readonly Variant[] = ['normal', 'holo', 'reverse', 'first_ed']

/** Máscara de bits de `cards.variant_mask`. */
export const VARIANT_BIT: Record<Variant, number> = {
  normal: 1 << 0,
  holo: 1 << 1,
  reverse: 1 << 2,
  first_ed: 1 << 3
}

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
export const CONDITIONS: readonly Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG']

/** Preajuste del efecto 3D, tal cual lo define el diseño. */
export type Effect3d = 'rainbow' | 'prism' | 'glitter'
export const EFFECTS_3D: readonly Effect3d[] = ['rainbow', 'prism', 'glitter']

export type ThemeSource = 'system' | 'light' | 'dark'

/** Las cinco vistas de la navegación 01-05. */
export type ViewId = 'collection' | 'explorer' | 'sets' | 'scan' | 'market'
export const VIEWS: readonly ViewId[] = ['collection', 'explorer', 'sets', 'scan', 'market']

export type SortId = 'value' | 'delta' | 'name' | 'date'

/** Tipos de Pokémon, en la clave canónica en inglés que usa TCGdex. */
export type PokemonType =
  | 'Fire'
  | 'Water'
  | 'Grass'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Dragon'
  | 'Colorless'
  | 'Fairy'

// ── Catálogo ──────────────────────────────────────────────────────────────────

export interface CardSet {
  id: string
  seriesId: string
  /** 'intl' | 'jp' */
  region: string
  /** Abreviatura impresa: OBF, BASE... */
  code: string | null
  name: string
  releasedOn: string | null
  /** Cartas numeradas: el denominador del porcentaje de completado. */
  totalOfficial: number
  /** Incluye secretas. */
  totalAll: number
  logoPath: string | null
  symbolPath: string | null
  sortKey: number
}

export interface Card {
  id: string
  setId: string
  /** Número impreso: '136', 'TG05', 'SV107'. */
  localId: string
  /** Parte numérica, para ordenar de verdad. */
  numberSort: number
  /** Sufijo alfabético, si lo hay. */
  numberSuffix: string
  name: string
  rarity: string | null
  category: string | null
  types: PokemonType[]
  hp: number | null
  illustrator: string | null
  /** Ruta base de TCGdex, sin idioma ni calidad: 'sv/sv03/125'. */
  imagePath: string | null
  variantMask: number
}

/** Sobre o producto de un set. El arte lo aporta el catálogo publicado a mano. */
export interface Pack {
  id: string
  setId: string
  name: string
  kind: 'booster' | 'etb' | 'bundle' | 'collection' | 'other'
  artworkPath: string | null
  logoPath: string | null
  sortKey: number
}

// ── Datos del usuario ─────────────────────────────────────────────────────────

/** Lo que un coleccionista posee de verdad: carta + variante + idioma. */
export interface CardKey {
  id: number
  cardId: string
  variant: Variant
  lang: CardLang
  /** Copia congelada, para que la ficha siga siendo legible si el catálogo cambia. */
  snapName: string
  snapSetId: string
  snapNumber: string
}

export interface CollectionItem {
  cardKeyId: number
  condition: Condition
  /** '' cuando no está gradeada. Nunca NULL: en SQLite los NULL son distintos entre sí. */
  grader: string
  /** -1 cuando no está gradeada. */
  grade: number
  qty: number
  qtyForTrade: number
  notes: string | null
  updatedAt: number
}

export type MovementKind =
  | 'buy'
  | 'sell'
  | 'pull'
  | 'trade_in'
  | 'trade_out'
  | 'gift'
  | 'loss'
  | 'grade'
  | 'adjust'

export interface Movement {
  id: number
  cardKeyId: number
  kind: MovementKind
  qtyDelta: number
  unitCents: number | null
  currency: string
  feesCents: number
  condition: Condition
  grader: string
  grade: number
  source: string | null
  occurredAt: number
  createdAt: number
  note: string | null
}

export type PriceSource = 'cardmarket' | 'tcgplayer'

export interface PricePoint {
  cardKeyId: number
  source: PriceSource
  /** Días desde epoch. */
  day: number
  lowCents: number | null
  trendCents: number
  avg7Cents: number | null
  avg30Cents: number | null
}

export interface PortfolioSnapshot {
  day: number
  totalCents: number
  costCents: number
  itemCount: number
  distinctKeys: number
  currency: string
}

// ── Vistas compuestas (lo que consume la interfaz) ────────────────────────────

/** Una carta lista para pintar en la rejilla: catálogo + tenencia + precio. */
export interface CardListItem {
  cardId: string
  name: string
  localId: string
  /** '004/102', ya compuesto. */
  numberLabel: string
  setId: string
  setCode: string | null
  setName: string
  rarity: string | null
  types: PokemonType[]
  hp: number | null
  imagePath: string | null
  variantMask: number
  /**
   * Idiomas en los que existe esta impresión.
   *
   * No es decorativo: el Set Base nunca se imprimió en español, así que pedir
   * su imagen en español devuelve un 404. La interfaz elige con esto.
   */
  langs: CardLang[]
  /** Suma de copias en todas las variantes e idiomas. 0 = no la tienes. */
  ownedQty: number
  /** Precio de mercado actual, en céntimos. null si no se conoce. */
  priceCents: number | null
  /** Variación a 7 días en porcentaje. null si no hay histórico. */
  delta7: number | null
}

export interface SetProgress {
  set: CardSet
  ownedCards: number
  pct: number
  valueCents: number
  packs: Pack[]
}

export interface PortfolioStats {
  totalCents: number
  costCents: number
  pnlCents: number
  copies: number
  distinctCards: number
}

// ── Filtros y consultas ───────────────────────────────────────────────────────

export interface CardQuery {
  /** 'collection' filtra a lo que posees; 'explorer' recorre el catálogo entero. */
  scope: 'collection' | 'explorer'
  search: string
  setId: string | 'all'
  lang: CardLang | 'all'
  rarity: string | 'all'
  minCents: number
  maxCents: number
  ownedOnly: boolean
  sort: SortId
  /** Paginación contra el rango visible del virtualizador. */
  offset: number
  limit: number
}

export interface CardPage {
  items: CardListItem[]
  /** Total de resultados del filtro, para el contador «N de M cartas». */
  total: number
  /** Total del ámbito sin filtrar. */
  scopeTotal: number
}

/** Opciones que alimentan la barra lateral, calculadas desde el catálogo real. */
export interface FilterOptions {
  sets: { id: string; name: string; code: string | null; count: number }[]
  rarities: { value: string; count: number }[]
  langs: { value: CardLang; count: number }[]
  maxCents: number
}

// ── Escáner ───────────────────────────────────────────────────────────────────

/**
 * Qué ha pasado con una captura.
 *
 * Los tres primeros son resultados del reconocimiento; los tres últimos son
 * problemas de la foto, y se distinguen a propósito: decirle a alguien «no he
 * reconocido la carta» cuando el problema es que la estaba moviendo no ayuda a
 * corregir nada.
 */
export type ScanStatus = 'match' | 'confirm' | 'unknown' | 'no_card' | 'blurry' | 'glare'

/** Una carta candidata, con lo justo para pintarla en el selector. */
export interface ScanCandidate {
  cardId: string
  name: string
  numberLabel: string
  setId: string
  setCode: string | null
  setName: string
  imagePath: string | null
  variantMask: number
  langs: CardLang[]
  priceCents: number | null
  /** Parecido con la captura, 0-100. */
  score: number
}

/** En qué se ha basado la decisión. Sirve para depurar y para calibrar. */
export interface ScanEvidence {
  /** Coseno con la mejor referencia, 0-1. */
  cosineTop1: number
  /** Distancia hasta la siguiente carta distinta. Es la señal fuerte. */
  cosineMargin: number
  /** Las mejores candidatas comparten ilustración. */
  ambiguous: boolean
  sharpness: number
  glare: number
  ms: number
}

export interface ScanDetection {
  id: string
  cardId: string
  name: string
  numberLabel: string
  lang: CardLang
  variant: Variant
  imagePath: string | null
  priceCents: number | null
  /** 0-100. */
  confidence: number
  /** Variantes que admite la carta, para las fichas del lote. */
  variantMask: number
  /** Idiomas en los que existe la impresión. */
  langs: CardLang[]
  /** `data:image/webp;base64,…` de la carta ya enderezada. */
  thumbnail: string | null
  /** 'confirm' = la candidata todavía necesita el visto bueno del usuario. */
  status: 'match' | 'confirm'
}

/** Respuesta completa de una captura. */
export interface ScanResult {
  status: ScanStatus
  detection: ScanDetection | null
  /** Alternativas ordenadas. Vacío salvo cuando hay algo que elegir. */
  alternatives: ScanCandidate[]
  thumbnail: string | null
  evidence: ScanEvidence | null
}

/** Lo único que necesita `scan:commit`; `ScanDetection` encaja aquí. */
export type ScanCommitItem = Pick<
  ScanDetection,
  'cardId' | 'variant' | 'lang' | 'name' | 'numberLabel'
>

export type ScanEngineState = 'off' | 'loading' | 'ready' | 'error' | 'unavailable'

export interface ScanEngineStatus {
  state: ScanEngineState
  /** Vectores cargados. 0 = el catálogo no trae reconocimiento para este modelo. */
  refCount: number
  model: string | null
  message?: string
}

// ── El móvil como cámara ──────────────────────────────────────────────────────

/**
 * Una dirección por la que el móvil podría llegar al PC.
 *
 * Se enseñan todas las candidatas porque desde dentro de la máquina no hay
 * forma de saber cuál es la buena: un PC con Ethernet al router y Wi-Fi a la
 * vez tiene dos, y sólo una está en la misma red que el móvil.
 */
export interface PhoneAddress {
  address: string
  /** Nombre de la interfaz tal cual lo da el sistema. */
  iface: string
  /** Es por la que sale el tráfico a internet. La mejor pista que hay. */
  isDefaultRoute: boolean
}

export type PhoneState = 'off' | 'starting' | 'listening' | 'error'

export interface PhoneSession {
  state: PhoneState
  /** Exactamente lo que va dentro del QR. Sólo en 'listening'. */
  url: string | null
  address: string | null
  candidates: PhoneAddress[]
  port: number | null
  /** Ha llegado algo del móvil hace poco. */
  connected: boolean
  lastSeenAt: number | null
  /** Capturas recibidas en esta sesión. */
  captureCount: number
  /** Sólo en 'error'. */
  message?: string
}

/**
 * Lo que el móvil recibe tras subir una captura.
 *
 * Deliberadamente flaco: el usuario está mirando el móvil, no el PC, así que
 * necesita saber si la carta ha entrado, pero el lote entero con sus
 * miniaturas y alternativas se queda en el ordenador, que es donde se revisa.
 */
export interface PhoneCaptureAck {
  status: ScanStatus
  name: string | null
  numberLabel: string | null
  /** Cartas que este móvil ha metido en el lote desde la última confirmación. */
  accepted: number
}

// ── Catálogo remoto ───────────────────────────────────────────────────────────

export interface CatalogManifestSet {
  id: string
  file: string
  sha256: string
  cardCount: number
}

/**
 * Fichero de vectores de reconocimiento de un set.
 *
 * Va aparte del JSON del set porque son datos binarios que cambian en otro
 * ritmo: el JSON se republica cada vez que se mueven los precios, y los
 * vectores sólo cuando cambian las cartas o el modelo.
 */
export interface CatalogManifestRecognition {
  id: string
  file: string
  sha256: string
  /** Identificador de modelo y preproceso. Sólo se importa el que se entiende. */
  model: string
  dims: number
  dtype: 'f32'
  count: number
}

export interface CatalogManifest {
  schemaVersion: number
  catalogVersion: string
  generatedAt: string
  sets: CatalogManifestSet[]
  /** Ausente en catálogos anteriores al escáner. */
  recognition: CatalogManifestRecognition[]
}

export interface CatalogInstalled {
  version: string | null
  setCount: number
  cardCount: number
  lastCheckedAt: number | null
  lastSyncedAt: number | null
}

export type CatalogState = 'idle' | 'checking' | 'syncing' | 'error'

export interface CatalogStatus {
  state: CatalogState
  installed: CatalogInstalled
  /**
   * Sólo durante 'syncing'.
   *
   * `total` cuenta los ficheros que hay que traer, sets y huellas del escáner
   * juntos: son dos descargas distintas por set y el usuario no tiene por qué
   * saberlo, pero sí merece una barra que avance de verdad hasta el final.
   */
  progress?: {
    done: number
    total: number
    currentSet: string
    phase: 'sets' | 'recognition'
  }
  /** Sólo en 'error'. */
  message?: string
}

// ── Ajustes ───────────────────────────────────────────────────────────────────

export interface AppSettings {
  uiLang: UiLang
  theme: ThemeSource
  effect3d: Effect3d
  /** Descargar imágenes de carta bajo demanda. Apagado = sólo texto. */
  downloadImages: boolean
  reduceMotion: boolean
  /** Cámara elegida para el escáner. */
  cameraId: string | null
  /**
   * Nombre de esa cámara.
   *
   * El identificador de dispositivo no es estable entre arranques ni al
   * cambiar de puerto USB; con el nombre se puede recuperar la elección del
   * usuario cuando el identificador ya no vale.
   */
  cameraLabel: string | null
  /** Idioma de las cartas que se escanean. null = el de la interfaz. */
  scanLang: CardLang | null
  /** Disparar solo al detectar una carta quieta en el marco. */
  scanAutoCapture: boolean
  /**
   * Puerto del servidor que sirve la página del móvil.
   *
   * Fijo y recordado, no efímero: tanto la excepción de certificado como el
   * permiso de cámara los guarda el navegador por host Y puerto. Con un puerto
   * distinto cada sesión, el móvil volvería a preguntar las dos cosas cada vez.
   */
  phonePort: number
  /** IP elegida a mano para el QR. null = la que se decida sola. */
  phoneAddress: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiLang: 'es',
  theme: 'system',
  effect3d: 'prism',
  downloadImages: true,
  reduceMotion: false,
  cameraId: null,
  cameraLabel: null,
  scanLang: null,
  scanAutoCapture: true,
  phonePort: 8770,
  phoneAddress: null
}

// ── Estado de la actualización de la aplicación ───────────────────────────────

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
