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

/**
 * Juego al que pertenece un set.
 *
 * Atraviesa el catálogo entero: de él dependen de dónde salen las imágenes, qué
 * fuente cotiza la carta y qué reverso tiene. Vive en `sets`, no en `cards`: un
 * set es de un juego y ya está.
 *
 * Los identificadores de Riftbound van con prefijo (`rb-ogn`, `rb-ogn-056-298`)
 * porque `card_keys.card_id` de la colección no tiene clave foránea al catálogo:
 * sin prefijo, un choque futuro de identificadores entre dos juegos apuntaría la
 * colección de alguien a otra carta sin dar ningún error.
 */
export type GameId = 'pokemon' | 'riftbound'
export const GAMES: readonly GameId[] = ['pokemon', 'riftbound']

export const isGameId = (v: unknown): v is GameId => (GAMES as readonly unknown[]).includes(v)

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

/**
 * Dominios de Riftbound, en la clave canónica en inglés de la galería de Riot.
 *
 * `Colorless` lo comparten los dos juegos y significa lo mismo en ambos: sin
 * color. No hace falta desambiguarlo.
 */
export type RiftboundDomain = 'Fury' | 'Calm' | 'Mind' | 'Body' | 'Chaos' | 'Order' | 'Colorless'

/**
 * La clave con la que se colorea una carta, venga del juego que venga.
 *
 * Va SIEMPRE en inglés canónico porque es el índice de la tabla `oklch` del
 * renderer: si se colara 'Planta' o 'Calma', el degradado se iría al color por
 * defecto sin avisar de nada.
 */
export type CardTypeKey = PokemonType | RiftboundDomain

// ── Catálogo ──────────────────────────────────────────────────────────────────

export interface CardSet {
  id: string
  game: GameId
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
  /** Pokemon | Trainer | Energy · Unit | Spell | Legend | Battlefield | Gear | Rune */
  category: string | null
  types: CardTypeKey[]
  hp: number | null
  /**
   * Cifras impresas que no son el PV.
   *
   * En Riftbound son `energy`, `might` y `power`; en Pokémon es nulo, porque su
   * única cifra es `hp`. Va como mapa y no como columnas para que el tercer
   * juego no obligue a otra migración.
   */
  stats: Record<string, number> | null
  illustrator: string | null
  /**
   * Ruta de la imagen, sin idioma ni calidad. La compone la aplicación en
   * tiempo de render, y cómo se compone depende del juego del set:
   * 'sv/sv03/125' en TCGdex, el identificador del recurso en Riftbound.
   */
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
  /** De qué juego es. Decide de dónde sale la imagen y qué reverso tiene. */
  game: GameId
  name: string
  localId: string
  /** '004/102', ya compuesto. */
  numberLabel: string
  setId: string
  setCode: string | null
  setName: string
  rarity: string | null
  category: string | null
  types: CardTypeKey[]
  hp: number | null
  stats: Record<string, number> | null
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
  /**
   * Quién cotiza ese precio.
   *
   * Con dos juegos deja de ser una obviedad: Pokémon sale de Cardmarket, en
   * euros y del mercado europeo, y Riftbound de TCGplayer, en dólares y
   * convertido. La ficha lo dice para que nadie compare una cifra con la de
   * Cardmarket y piense que la aplicación se equivoca.
   */
  priceSource: PriceSource | null
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
  /** Juego activo. 'all' mezcla los dos, que es como arranca. */
  game: GameId | 'all'
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

/**
 * Opciones que alimentan la barra lateral, calculadas desde el catálogo real.
 *
 * Todo salvo `games` llega ya acotado al juego activo: filtrar por un set del
 * otro juego dejaría la rejilla vacía sin que se entienda por qué. `games`, en
 * cambio, cuenta siempre el catálogo entero, porque es el control con el que se
 * cambia de juego.
 */
export interface FilterOptions {
  games: { value: GameId; count: number }[]
  sets: { id: string; game: GameId; name: string; code: string | null; count: number }[]
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
  game: GameId
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
  /** El escáner no pregunta de qué juego es la carta: lo deduce del catálogo. */
  game: GameId
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
  /**
   * Juego activo, el que gobierna las cinco vistas.
   *
   * Vive en los ajustes y no en los filtros de la rejilla porque manda también
   * sobre Sets, Escáner y Mercado, que no tienen barra lateral, y porque se
   * espera que siga puesto al volver a abrir.
   */
  game: GameId | 'all'
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiLang: 'es',
  game: 'all',
  theme: 'system',
  effect3d: 'prism',
  downloadImages: true,
  reduceMotion: false,
  cameraId: null,
  cameraLabel: null,
  scanLang: null,
  scanAutoCapture: true
}

// ── Estado de la actualización de la aplicación ───────────────────────────────

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
