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
}

// ── Catálogo remoto ───────────────────────────────────────────────────────────

export interface CatalogManifestSet {
  id: string
  file: string
  sha256: string
  cardCount: number
}

export interface CatalogManifest {
  schemaVersion: number
  catalogVersion: string
  generatedAt: string
  sets: CatalogManifestSet[]
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
  /** Sólo durante 'syncing'. */
  progress?: { done: number; total: number; currentSet: string }
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiLang: 'es',
  theme: 'system',
  effect3d: 'prism',
  downloadImages: true,
  reduceMotion: false
}

// ── Estado de la actualización de la aplicación ───────────────────────────────

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
