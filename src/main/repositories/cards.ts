import {
  GAMES,
  isGameId,
  type CardListItem,
  type CardPage,
  type CardQuery,
  type CardTypeKey,
  type FilterOptions,
  type GameId,
  type Movement,
  type PricePoint
} from '@shared/types'
import { getDb } from '../db'
import { getSettings } from '../settings'

/** Fila cruda tal y como sale del SELECT de la rejilla. */
interface CardRow {
  card_id: string
  game: string
  name: string
  local_id: string
  set_id: string
  set_code: string | null
  set_name: string
  total_official: number
  rarity: string | null
  category: string | null
  types: string
  hp: number | null
  stats: string | null
  tags: string | null
  image_path: string | null
  variant_mask: number
  langs: string | null
  owned_qty: number | null
  price_cents: number | null
  price_source: number | null
  delta7: number | null
}

/**
 * Compone el número impreso al estilo del diseño: '004/102'.
 *
 * Se rellena con ceros hasta la anchura del total del set, que es como está
 * impreso en la carta. Los números no numéricos (promos tipo 'SV107') se dejan
 * tal cual.
 */
function numberLabel(localId: string, totalOfficial: number): string {
  if (!totalOfficial) return localId
  const width = String(totalOfficial).length
  return /^\d+$/.test(localId)
    ? `${localId.padStart(width, '0')}/${totalOfficial}`
    : `${localId}/${totalOfficial}`
}

function parseTypes(json: string): CardTypeKey[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? (v as CardTypeKey[]) : []
  } catch {
    return []
  }
}

/** Las cifras impresas que no son el PV. Nulo cuando la carta no tiene ninguna. */
function parseStats(json: string | null): Record<string, number> | null {
  if (!json) return null
  try {
    const v: unknown = JSON.parse(json)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const out: Record<string, number> = {}
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number') out[k] = n
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** Las etiquetas de la carta. Lista vacía cuando no tiene, nunca nulo. */
function parseTags(json: string | null): string[] {
  if (!json) return []
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toItem(r: CardRow): CardListItem {
  return {
    cardId: r.card_id,
    game: isGameId(r.game) ? r.game : 'pokemon',
    name: r.name,
    localId: r.local_id,
    numberLabel: numberLabel(r.local_id, r.total_official),
    setId: r.set_id,
    setCode: r.set_code,
    setName: r.set_name,
    rarity: r.rarity,
    category: r.category,
    types: parseTypes(r.types),
    hp: r.hp,
    stats: parseStats(r.stats),
    tags: parseTags(r.tags),
    imagePath: r.image_path,
    variantMask: r.variant_mask,
    langs: (r.langs ?? 'en').split(',').filter(Boolean) as CardListItem['langs'],
    ownedQty: r.owned_qty ?? 0,
    priceCents: r.price_cents,
    priceSource: r.price_source === null ? null : r.price_source === 1 ? 'tcgplayer' : 'cardmarket',
    delta7: r.delta7
  }
}

/**
 * Subconsultas compartidas.
 *
 * `owned`       suma las copias de todas las variantes e idiomas de una carta.
 * `owned_price` vale lo que valen las impresiones que el usuario tiene de
 *               verdad. Importa: un Charizard del Set Base holo unlimited anda
 *               por 590 € y el mismo shadowless de 1ª edición pasa de 3.500.
 * El precio de referencia de la carta —el de su impresión corriente, para las
 * que no se tienen— llega por `cat.card_default_price`, que además resuelve de
 * qué fuente sale: Cardmarket cuando la hay y TCGplayer cuando no, que es el
 * caso de Riftbound.
 *
 * La variación a siete días sale de comparar la tendencia con la media de la
 * semana, ambas ya en el catálogo. Así hay variación desde el primer día, sin
 * esperar a acumular histórico local. Las fuentes que no publican media semanal
 * dejan `avg7_cents` a nulo y la carta sale sin variación, que es más honesto
 * que inventarla.
 */
const WITH_BLOCK = `
  WITH owned AS (
    SELECT ck.card_id AS card_id, SUM(ci.qty) AS qty
    FROM card_keys ck
    JOIN collection_items ci ON ci.card_key_id = ck.id
    GROUP BY ck.card_id
  ),
  owned_price AS (
    SELECT ck.card_id AS card_id, MAX(v.trend_cents) AS trend_cents
    FROM card_keys ck
    JOIN collection_items ci ON ci.card_key_id = ck.id AND ci.qty > 0
    JOIN cat.card_variant_price v ON v.card_id = ck.card_id AND v.variant = ck.variant
    GROUP BY ck.card_id
  )
`

const SELECT_COLS = `
  c.id            AS card_id,
  s.game          AS game,
  COALESCE(cn.name, c.name) AS name,
  c.local_id      AS local_id,
  c.set_id        AS set_id,
  s.code          AS set_code,
  COALESCE(sn.name, s.name) AS set_name,
  s.total_official AS total_official,
  c.rarity        AS rarity,
  c.category      AS category,
  c.types         AS types,
  c.hp            AS hp,
  c.stats         AS stats,
  c.tags          AS tags,
  c.image_path    AS image_path,
  c.variant_mask  AS variant_mask,
  (SELECT GROUP_CONCAT(cl.lang) FROM cat.card_langs cl WHERE cl.card_id = c.id) AS langs,
  owned.qty       AS owned_qty,
  COALESCE(owned_price.trend_cents, catalog.trend_cents) AS price_cents,
  catalog.source  AS price_source,
  CASE
    WHEN catalog.avg7_cents IS NULL OR catalog.avg7_cents = 0 THEN NULL
    ELSE ROUND((catalog.trend_cents - catalog.avg7_cents) * 100.0 / catalog.avg7_cents, 1)
  END AS delta7
`

const FROM_BLOCK = `
  FROM cat.cards c
  JOIN cat.sets s        ON s.id = c.set_id
  LEFT JOIN cat.card_names cn ON cn.card_id = c.id AND cn.lang = @uiLang
  LEFT JOIN cat.set_names  sn ON sn.set_id  = s.id AND sn.lang = @uiLang
  LEFT JOIN owned       ON owned.card_id       = c.id
  LEFT JOIN owned_price ON owned_price.card_id = c.id
  LEFT JOIN cat.card_default_price catalog ON catalog.card_id = c.id
`

interface Params {
  uiLang: string
  game?: string
  search?: string
  setId?: string
  lang?: string
  rarity?: string
  minCents?: number
  maxCents?: number
  limit?: number
  offset?: number
}

/** Construye el WHERE dinámico. Nunca se interpola valor alguno: todo va enlazado. */
function buildFilters(q: CardQuery): { sql: string; params: Params } {
  const params: Params = { uiLang: getSettings().uiLang }
  const where: string[] = []

  if (q.scope === 'collection') {
    where.push('COALESCE(owned.qty, 0) > 0')
  } else if (q.ownedOnly) {
    where.push('COALESCE(owned.qty, 0) > 0')
  }

  // El juego se filtra por el set, que es donde vive: una carta es del juego de
  // su set y no hay caso intermedio.
  if (q.game !== 'all') {
    where.push('s.game = @game')
    params.game = q.game
  }

  const search = q.search.trim()
  if (search) {
    // El buscador combina dos cosas a propósito: quien colecciona teclea
    // números exactos ('125/197') tan a menudo como nombres, y la relevancia
    // de FTS entierra la coincidencia exacta si no se trata aparte.
    where.push(`(
      c.local_id = @search
      OR c.local_id LIKE @searchPrefix
      OR c.id IN (
        -- El operando izquierdo de MATCH tiene que ser el nombre DESNUDO de la
        -- tabla FTS5. Ni cualificado con el esquema ('cat.cards_fts MATCH') ni
        -- por un alias ('f MATCH'): las dos formas fallan con «no such column»
        -- y tumban la consulta entera en cuanto hay algo escrito en el
        -- buscador. Por eso el MATCH va aislado en su propia subconsulta, donde
        -- la tabla no necesita ni prefijo ni alias.
        SELECT src.card_id FROM cat.card_search_src src
        WHERE src.rowid_ IN (SELECT rowid FROM cat.cards_fts WHERE cards_fts MATCH @ftsQuery)
      )
    )`)
    Object.assign(params, {
      search,
      searchPrefix: `${search}%`,
      // Se escapan las comillas y se busca por prefijo, que es lo que espera
      // quien teclea mientras mira.
      ftsQuery: `"${search.replace(/"/g, '""')}"*`
    })
  }

  if (q.setId !== 'all') {
    where.push('c.set_id = @setId')
    params.setId = q.setId
  }
  if (q.lang !== 'all') {
    where.push('EXISTS (SELECT 1 FROM cat.card_langs cl WHERE cl.card_id = c.id AND cl.lang = @lang)')
    params.lang = q.lang
  }
  if (q.rarity !== 'all') {
    where.push('c.rarity = @rarity')
    params.rarity = q.rarity
  }
  if (q.minCents > 0) {
    where.push('COALESCE(owned_price.trend_cents, catalog.trend_cents, 0) >= @minCents')
    params.minCents = q.minCents
  }
  if (q.maxCents > 0) {
    where.push('COALESCE(owned_price.trend_cents, catalog.trend_cents, 0) <= @maxCents')
    params.maxCents = q.maxCents
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

const ORDER: Record<CardQuery['sort'], string> = {
  value: 'COALESCE(owned_price.trend_cents, catalog.trend_cents, -1) DESC, name ASC',
  delta: 'COALESCE(delta7, -9999) DESC, name ASC',
  name: 'name COLLATE NOCASE ASC',
  date: 's.released_on DESC, s.sort_key DESC, c.number_sort ASC'
}

/**
 * Una página de cartas para la rejilla.
 *
 * Se pagina en SQL contra el rango visible del virtualizador: mandar miles de
 * filas por IPC las serializa con structured clone en cada llamada y es la
 * diferencia entre una rejilla fluida y una que da tirones.
 */
export function page(q: CardQuery): CardPage {
  const db = getDb()
  const { sql: whereSql, params } = buildFilters(q)

  const rows = db
    .prepare<Params, CardRow>(
      `${WITH_BLOCK}
       SELECT ${SELECT_COLS}
       ${FROM_BLOCK}
       ${whereSql}
       ORDER BY ${ORDER[q.sort]}
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: q.limit, offset: q.offset })

  const total = (
    db
      .prepare<Params, { n: number }>(
        `${WITH_BLOCK} SELECT COUNT(*) AS n ${FROM_BLOCK} ${whereSql}`
      )
      .get(params) ?? { n: 0 }
  ).n

  // El total del ámbito («N de M cartas») respeta el juego activo pero no los
  // filtros: con Riftbound seleccionado, M es el catálogo de Riftbound, no el
  // de los dos juegos juntos.
  const scopeConds = [
    ...(q.scope === 'collection' ? ['COALESCE(owned.qty, 0) > 0'] : []),
    ...(q.game !== 'all' ? ['s.game = @game'] : [])
  ]
  const scopeWhere = scopeConds.length ? `WHERE ${scopeConds.join(' AND ')}` : ''
  const scopeTotal = (
    db
      .prepare<Params, { n: number }>(
        `${WITH_BLOCK} SELECT COUNT(*) AS n ${FROM_BLOCK} ${scopeWhere}`
      )
      .get(params) ?? { n: 0 }
  ).n

  return { items: rows.map(toItem), total, scopeTotal }
}

export function byId(cardId: string): CardListItem | null {
  const db = getDb()
  const row = db
    .prepare<{ uiLang: string; cardId: string }, CardRow>(
      `${WITH_BLOCK} SELECT ${SELECT_COLS} ${FROM_BLOCK} WHERE c.id = @cardId`
    )
    .get({ uiLang: getSettings().uiLang, cardId })
  return row ? toItem(row) : null
}

/**
 * Alimenta la barra lateral con lo que realmente hay en el catálogo.
 *
 * Todo va acotado al juego activo salvo el recuento por juego, que es el
 * control con el que se cambia de juego y por tanto tiene que contarlos todos.
 * Ofrecer sets o rarezas del otro juego dejaría la rejilla vacía sin que se
 * entienda por qué.
 *
 * El juego se lee de los ajustes, igual que el idioma de la interfaz: son
 * estado del proceso main, no argumentos de la consulta.
 */
export function filterOptions(): FilterOptions {
  const db = getDb()
  const { uiLang, game } = getSettings()
  // El mismo predicado en todas las consultas de aquí abajo, escrito de forma
  // que el parámetro se enlaza siempre: así no hay una variante del SQL que
  // reciba un valor que no usa. Con cinco o diez sets, el coste es ninguno.
  const scope = " AND (@game = 'all' OR s.game = @game)"
  const params = { uiLang, game }

  // En el orden en que se declaran los juegos, no por número de cartas: es un
  // selector fijo de la cabecera, y que los botones cambien de sitio al
  // publicarse un set nuevo rompería la memoria muscular de quien lo usa a
  // diario.
  const games = db
    .prepare<[], { value: GameId; count: number }>(
      `SELECT s.game AS value, COUNT(c.id) AS count
       FROM cat.sets s
       LEFT JOIN cat.cards c ON c.set_id = s.id
       GROUP BY s.game`
    )
    .all()
    .sort((a, b) => GAMES.indexOf(a.value) - GAMES.indexOf(b.value))

  const sets = db
    .prepare<
      typeof params,
      { id: string; game: GameId; name: string; code: string | null; count: number }
    >(
      `SELECT s.id AS id,
              s.game AS game,
              COALESCE(sn.name, s.name) AS name,
              s.code AS code,
              COUNT(c.id) AS count
       FROM cat.sets s
       LEFT JOIN cat.set_names sn ON sn.set_id = s.id AND sn.lang = @uiLang
       LEFT JOIN cat.cards c ON c.set_id = s.id
       WHERE 1 = 1${scope}
       GROUP BY s.id
       ORDER BY s.sort_key DESC, s.id`
    )
    .all(params)

  const rarities = db
    .prepare<typeof params, { value: string; count: number }>(
      `SELECT c.rarity AS value, COUNT(*) AS count
       FROM cat.cards c
       JOIN cat.sets s ON s.id = c.set_id
       WHERE c.rarity IS NOT NULL AND c.rarity <> ''${scope}
       GROUP BY c.rarity ORDER BY count DESC`
    )
    .all(params)

  const langs = db
    .prepare<typeof params, { value: 'es' | 'en' | 'ja'; count: number }>(
      `SELECT cl.lang AS value, COUNT(*) AS count
       FROM cat.card_langs cl
       JOIN cat.cards c ON c.id = cl.card_id
       JOIN cat.sets s ON s.id = c.set_id
       WHERE 1 = 1${scope}
       GROUP BY cl.lang ORDER BY count DESC`
    )
    .all(params)

  // El máximo sale de la vista y no de `printing_prices` en crudo porque es la
  // que decide qué fuente cotiza cada carta. Contra la tabla se colaría el
  // precio de una fuente que la interfaz no llega a enseñar nunca.
  const maxRow = db
    .prepare<typeof params, { m: number | null }>(
      `SELECT MAX(v.trend_cents) AS m
       FROM cat.card_default_price v
       JOIN cat.cards c ON c.id = v.card_id
       JOIN cat.sets s ON s.id = c.set_id
       WHERE 1 = 1${scope}`
    )
    .get(params)

  return {
    games,
    sets,
    rarities,
    langs,
    // Tope del deslizador de precio: por encima del máximo real, redondeado.
    maxCents: Math.max(60000, Math.ceil(((maxRow?.m ?? 0) * 1.1) / 10000) * 10000)
  }
}

export function priceHistory(cardId: string, days: number): PricePoint[] {
  const db = getDb()
  const since = Math.floor(Date.now() / 86400000) - days
  return db
    .prepare<
      { cardId: string; since: number },
      {
        card_key_id: number
        source: number
        day: number
        low_cents: number | null
        trend_cents: number
        avg7_cents: number | null
        avg30_cents: number | null
      }
    >(
      `SELECT pp.* FROM price_points pp
       JOIN card_keys ck ON ck.id = pp.card_key_id
       WHERE ck.card_id = @cardId AND pp.day >= @since
       ORDER BY pp.day ASC`
    )
    .all({ cardId, since })
    .map((r) => ({
      cardKeyId: r.card_key_id,
      source: r.source === 1 ? ('tcgplayer' as const) : ('cardmarket' as const),
      day: r.day,
      lowCents: r.low_cents,
      trendCents: r.trend_cents,
      avg7Cents: r.avg7_cents,
      avg30Cents: r.avg30_cents
    }))
}

/** Las copias que el usuario tiene de esta carta, con lo pagado y su P&L. */
export function copies(cardId: string): {
  cardKeyId: number
  variant: string
  lang: string
  condition: string
  grader: string
  grade: number
  qty: number
  paidCents: number | null
  pnlCents: number | null
}[] {
  const db = getDb()
  return db
    .prepare<
      { cardId: string },
      {
        card_key_id: number
        variant: string
        lang: string
        condition: string
        grader: string
        grade: number
        qty: number
        paid_cents: number | null
        price_cents: number | null
      }
    >(
      `SELECT ci.card_key_id, ck.variant, ck.lang, ci.condition, ci.grader, ci.grade, ci.qty,
              (SELECT AVG(m.unit_cents) FROM movements m
               WHERE m.card_key_id = ck.id AND m.kind = 'buy' AND m.unit_cents IS NOT NULL)
                AS paid_cents,
              (SELECT pp.trend_cents FROM price_points pp
               WHERE pp.card_key_id = ck.id AND pp.source = 0
               ORDER BY pp.day DESC LIMIT 1) AS price_cents
       FROM collection_items ci
       JOIN card_keys ck ON ck.id = ci.card_key_id
       WHERE ck.card_id = @cardId AND ci.qty > 0
       ORDER BY ci.qty DESC`
    )
    .all({ cardId })
    .map((r) => ({
      cardKeyId: r.card_key_id,
      variant: r.variant,
      lang: r.lang,
      condition: r.condition,
      grader: r.grader,
      grade: r.grade,
      qty: r.qty,
      paidCents: r.paid_cents === null ? null : Math.round(r.paid_cents),
      pnlCents:
        r.paid_cents === null || r.price_cents === null
          ? null
          : Math.round(r.price_cents - r.paid_cents)
    }))
}

export function movements(cardId: string, limit: number): Movement[] {
  const db = getDb()
  return db
    .prepare<{ cardId: string; limit: number }, Record<string, never>>(
      `SELECT m.* FROM movements m
       JOIN card_keys ck ON ck.id = m.card_key_id
       WHERE ck.card_id = @cardId
       ORDER BY m.occurred_at DESC LIMIT @limit`
    )
    .all({ cardId, limit })
    .map((raw) => {
      const r = raw as unknown as {
        id: number
        card_key_id: number
        kind: Movement['kind']
        qty_delta: number
        unit_cents: number | null
        currency: string
        fees_cents: number
        condition: Movement['condition']
        grader: string
        grade: number
        source: string | null
        occurred_at: number
        created_at: number
        note: string | null
      }
      return {
        id: r.id,
        cardKeyId: r.card_key_id,
        kind: r.kind,
        qtyDelta: r.qty_delta,
        unitCents: r.unit_cents,
        currency: r.currency,
        feesCents: r.fees_cents,
        condition: r.condition,
        grader: r.grader,
        grade: r.grade,
        source: r.source,
        occurredAt: r.occurred_at,
        createdAt: r.created_at,
        note: r.note
      }
    })
}

/**
 * En qué sobres puede salir la carta.
 *
 * Sin filas en card_packs se entiende que puede salir en cualquier sobre de su
 * set, que es el caso habitual: sólo las cartas con distribución especial
 * necesitan la relación explícita.
 */
export function packs(cardId: string): { id: string; name: string }[] {
  const db = getDb()
  const explicit = db
    .prepare<{ cardId: string; uiLang: string }, { id: string; name: string }>(
      `SELECT p.id, COALESCE(pn.name, p.name) AS name
       FROM cat.card_packs cp
       JOIN cat.packs p ON p.id = cp.pack_id
       LEFT JOIN cat.pack_names pn ON pn.pack_id = p.id AND pn.lang = @uiLang
       WHERE cp.card_id = @cardId
       ORDER BY p.sort_key`
    )
    .all({ cardId, uiLang: getSettings().uiLang })

  if (explicit.length) return explicit

  return db
    .prepare<{ cardId: string; uiLang: string }, { id: string; name: string }>(
      `SELECT p.id, COALESCE(pn.name, p.name) AS name
       FROM cat.packs p
       LEFT JOIN cat.pack_names pn ON pn.pack_id = p.id AND pn.lang = @uiLang
       WHERE p.set_id = (SELECT set_id FROM cat.cards WHERE id = @cardId)
       ORDER BY p.sort_key`
    )
    .all({ cardId, uiLang: getSettings().uiLang })
}
