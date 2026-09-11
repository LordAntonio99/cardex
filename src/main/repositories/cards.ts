import type {
  CardListItem,
  CardPage,
  CardQuery,
  FilterOptions,
  Movement,
  PokemonType,
  PricePoint
} from '@shared/types'
import { getDb } from '../db'
import { getSettings } from '../settings'

/** Fila cruda tal y como sale del SELECT de la rejilla. */
interface CardRow {
  card_id: string
  name: string
  local_id: string
  set_id: string
  set_code: string | null
  set_name: string
  total_official: number
  rarity: string | null
  types: string
  hp: number | null
  image_path: string | null
  variant_mask: number
  langs: string | null
  owned_qty: number | null
  price_cents: number | null
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

function parseTypes(json: string): PokemonType[] {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? (v as PokemonType[]) : []
  } catch {
    return []
  }
}

function toItem(r: CardRow): CardListItem {
  return {
    cardId: r.card_id,
    name: r.name,
    localId: r.local_id,
    numberLabel: numberLabel(r.local_id, r.total_official),
    setId: r.set_id,
    setCode: r.set_code,
    setName: r.set_name,
    rarity: r.rarity,
    types: parseTypes(r.types),
    hp: r.hp,
    imagePath: r.image_path,
    variantMask: r.variant_mask,
    langs: (r.langs ?? 'en').split(',').filter(Boolean) as CardListItem['langs'],
    ownedQty: r.owned_qty ?? 0,
    priceCents: r.price_cents,
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
 * `catalog`     el precio de referencia de la carta (su impresión corriente),
 *               para las que no se tienen.
 *
 * La variación a siete días sale de comparar la tendencia con la media de la
 * semana, ambas de Cardmarket y ya en el catálogo. Así hay variación desde el
 * primer día, sin esperar a acumular histórico local.
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
  ),
  catalog AS (
    SELECT p.card_id AS card_id, pr.trend_cents AS trend_cents, pr.avg7_cents AS avg7_cents
    FROM cat.card_printings p
    JOIN cat.printing_prices pr
      ON pr.card_id = p.card_id AND pr.printing_id = p.printing_id AND pr.source = 0
    WHERE p.is_default = 1
  )
`

const SELECT_COLS = `
  c.id            AS card_id,
  COALESCE(cn.name, c.name) AS name,
  c.local_id      AS local_id,
  c.set_id        AS set_id,
  s.code          AS set_code,
  COALESCE(sn.name, s.name) AS set_name,
  s.total_official AS total_official,
  c.rarity        AS rarity,
  c.types         AS types,
  c.hp            AS hp,
  c.image_path    AS image_path,
  c.variant_mask  AS variant_mask,
  (SELECT GROUP_CONCAT(cl.lang) FROM cat.card_langs cl WHERE cl.card_id = c.id) AS langs,
  owned.qty       AS owned_qty,
  COALESCE(owned_price.trend_cents, catalog.trend_cents) AS price_cents,
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
  LEFT JOIN catalog     ON catalog.card_id     = c.id
`

interface Params {
  uiLang: string
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

  const search = q.search.trim()
  if (search) {
    // El buscador combina dos cosas a propósito: quien colecciona teclea
    // números exactos ('125/197') tan a menudo como nombres, y la relevancia
    // de FTS entierra la coincidencia exacta si no se trata aparte.
    where.push(`(
      c.local_id = @search
      OR c.local_id LIKE @searchPrefix
      OR c.id IN (
        SELECT src.card_id FROM cat.cards_fts f
        JOIN cat.card_search_src src ON src.rowid_ = f.rowid
        WHERE cat.cards_fts MATCH @ftsQuery
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

  const scopeWhere = q.scope === 'collection' ? 'WHERE COALESCE(owned.qty, 0) > 0' : ''
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

/** Alimenta la barra lateral con lo que realmente hay en el catálogo. */
export function filterOptions(): FilterOptions {
  const db = getDb()
  const uiLang = getSettings().uiLang

  const sets = db
    .prepare<{ uiLang: string }, { id: string; name: string; code: string | null; count: number }>(
      `SELECT s.id AS id,
              COALESCE(sn.name, s.name) AS name,
              s.code AS code,
              COUNT(c.id) AS count
       FROM cat.sets s
       LEFT JOIN cat.set_names sn ON sn.set_id = s.id AND sn.lang = @uiLang
       LEFT JOIN cat.cards c ON c.set_id = s.id
       GROUP BY s.id
       ORDER BY s.sort_key DESC, s.id`
    )
    .all({ uiLang })

  const rarities = db
    .prepare<[], { value: string; count: number }>(
      `SELECT rarity AS value, COUNT(*) AS count
       FROM cat.cards WHERE rarity IS NOT NULL AND rarity <> ''
       GROUP BY rarity ORDER BY count DESC`
    )
    .all()

  const langs = db
    .prepare<[], { value: 'es' | 'en' | 'ja'; count: number }>(
      `SELECT lang AS value, COUNT(*) AS count
       FROM cat.card_langs GROUP BY lang ORDER BY count DESC`
    )
    .all()

  const maxRow = db
    .prepare<[], { m: number | null }>('SELECT MAX(trend_cents) AS m FROM cat.printing_prices WHERE source = 0')
    .get()

  return {
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
