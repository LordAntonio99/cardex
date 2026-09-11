import type { CardListItem, PortfolioSnapshot, PortfolioStats } from '@shared/types'
import { getDb } from '../db'
import { byId } from './cards'

/**
 * Los cuatro contadores de la vista Mercado.
 *
 * El valor actual es la suma de copias por su último precio conocido; el coste
 * es lo realmente pagado, que sale del libro de movimientos y no de un campo
 * editable. Con la base vacía todo sale a cero, que es lo que debe verse.
 */
export function stats(): PortfolioStats {
  const db = getDb()
  const row = db
    .prepare<
      [],
      {
        total_cents: number | null
        cost_cents: number | null
        copies: number | null
        distinct_cards: number | null
      }
    >(
      `SELECT
         COALESCE(SUM(ci.qty * COALESCE(p.trend_cents, 0)), 0) AS total_cents,
         COALESCE((
           SELECT SUM(m.qty_delta * COALESCE(m.unit_cents, 0) + m.fees_cents)
           FROM movements m WHERE m.kind IN ('buy', 'trade_in')
         ), 0) AS cost_cents,
         COALESCE(SUM(ci.qty), 0) AS copies,
         COUNT(DISTINCT ck.card_id) AS distinct_cards
       FROM collection_items ci
       JOIN card_keys ck ON ck.id = ci.card_key_id
       LEFT JOIN (
         SELECT card_key_id, trend_cents,
                ROW_NUMBER() OVER (PARTITION BY card_key_id ORDER BY day DESC) AS rn
         FROM price_points WHERE source = 0
       ) p ON p.card_key_id = ck.id AND p.rn = 1
       WHERE ci.qty > 0`
    )
    .get()

  const totalCents = row?.total_cents ?? 0
  const costCents = row?.cost_cents ?? 0

  return {
    totalCents,
    costCents,
    pnlCents: totalCents - costCents,
    copies: row?.copies ?? 0,
    distinctCards: row?.distinct_cards ?? 0
  }
}

/** Serie de valor de la colección para la gráfica de 90 días. */
export function history(days: number): PortfolioSnapshot[] {
  const db = getDb()
  const since = Math.floor(Date.now() / 86400000) - days
  return db
    .prepare<
      { since: number },
      {
        day: number
        total_cents: number
        cost_cents: number
        item_count: number
        distinct_keys: number
        currency: string
      }
    >(
      `SELECT day, total_cents, cost_cents, item_count, distinct_keys, currency
       FROM portfolio_snapshots WHERE day >= @since ORDER BY day ASC`
    )
    .all({ since })
    .map((r) => ({
      day: r.day,
      totalCents: r.total_cents,
      costCents: r.cost_cents,
      itemCount: r.item_count,
      distinctKeys: r.distinct_keys,
      currency: r.currency
    }))
}

/**
 * Las que más suben y las que más bajan en siete días, entre las que se tienen.
 *
 * Sólo se consideran cartas en propiedad: el diseño lo enmarca como «tu»
 * cartera, no como un ranking del mercado entero.
 */
export function topMovers(limit: number): { gainers: CardListItem[]; losers: CardListItem[] } {
  const db = getDb()
  const rows = db
    .prepare<{ limit: number }, { card_id: string; delta: number }>(
      `WITH ranked AS (
         SELECT ck.card_id AS card_id, pp.trend_cents, pp.day,
                ROW_NUMBER() OVER (PARTITION BY ck.card_id ORDER BY pp.day DESC) AS rn
         FROM price_points pp
         JOIN card_keys ck ON ck.id = pp.card_key_id
         JOIN collection_items ci ON ci.card_key_id = ck.id AND ci.qty > 0
         WHERE pp.source = 0
       ),
       latest AS (SELECT card_id, trend_cents, day FROM ranked WHERE rn = 1),
       prev AS (
         SELECT r.card_id, MIN(r.rn) AS rn
         FROM ranked r JOIN latest l ON l.card_id = r.card_id
         WHERE r.day <= l.day - 7
         GROUP BY r.card_id
       )
       SELECT l.card_id AS card_id,
              ROUND((l.trend_cents - rp.trend_cents) * 100.0 / rp.trend_cents, 1) AS delta
       FROM latest l
       JOIN prev p ON p.card_id = l.card_id
       JOIN ranked rp ON rp.card_id = l.card_id AND rp.rn = p.rn
       WHERE rp.trend_cents > 0
       ORDER BY delta DESC`
    )
    .all({ limit })

  const hydrate = (ids: { card_id: string }[]): CardListItem[] =>
    ids.map((r) => byId(r.card_id)).filter((c): c is CardListItem => c !== null)

  return {
    gainers: hydrate(rows.slice(0, limit)),
    losers: hydrate(rows.slice(-limit).reverse())
  }
}
