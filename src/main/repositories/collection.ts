import type { CardListItem, PortfolioSnapshot, PortfolioStats } from '@shared/types'
import { getDb } from '../db'
import { getSettings } from '../settings'
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
  const game = getSettings().game
  const row = db
    .prepare<
      { game: string },
      {
        total_cents: number | null
        cost_cents: number | null
        copies: number | null
        distinct_cards: number | null
      }
    >(
      // El valor sale del precio de la IMPRESIÓN que se tiene, no de un precio
      // genérico por carta: en el Set Base la diferencia entre unlimited y
      // primera edición es de seis veces.
      //
      // El juego se resuelve cruzando hasta `cat.sets`. La colección no lo
      // guarda a propósito: es dato de catálogo, y duplicarlo en la base del
      // usuario sería una copia que se puede desincronizar.
      `SELECT
         COALESCE(SUM(ci.qty * COALESCE(v.trend_cents, 0)), 0) AS total_cents,
         COALESCE((
           SELECT SUM(m.qty_delta * COALESCE(m.unit_cents, 0) + m.fees_cents)
           FROM movements m
           JOIN card_keys mk ON mk.id = m.card_key_id
           LEFT JOIN cat.cards mc ON mc.id = mk.card_id
           LEFT JOIN cat.sets ms ON ms.id = mc.set_id
           WHERE m.kind IN ('buy', 'trade_in')
             AND (@game = 'all' OR ms.game = @game)
         ), 0) AS cost_cents,
         COALESCE(SUM(ci.qty), 0) AS copies,
         COUNT(DISTINCT ck.card_id) AS distinct_cards
       FROM collection_items ci
       JOIN card_keys ck ON ck.id = ci.card_key_id
       LEFT JOIN cat.cards c ON c.id = ck.card_id
       LEFT JOIN cat.sets s ON s.id = c.set_id
       LEFT JOIN cat.card_variant_price v
         ON v.card_id = ck.card_id AND v.variant = ck.variant
       WHERE ci.qty > 0 AND (@game = 'all' OR s.game = @game)`
    )
    .get({ game })

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

/**
 * Serie de valor de la colección para la gráfica de 90 días.
 *
 * Es la ÚNICA cifra de Mercado que no se acota al juego activo, y no por
 * descuido: `portfolio_snapshots` guarda una fila al día con el total de la
 * cartera entera. Partirla por juego obligaría a cambiar el esquema de
 * `collection.db` —la base irreemplazable— y a reescribir el histórico ya
 * anotado, que no se puede reconstruir. La vista lo dice con todas las letras
 * en vez de dar a entender que la curva es la del juego elegido.
 */
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
    .prepare<{ game: string }, { card_id: string; delta: number }>(
      // La variación sale de comparar la tendencia con la media de siete días,
      // ambas ya presentes en el catálogo. No hace falta esperar a acumular
      // histórico local para que esto tenga algo que decir.
      //
      // Las fuentes que no publican media semanal —TCGplayer, que es la que
      // cotiza Riftbound— dejan `avg7_cents` a nulo, así que esas cartas no
      // entran en el ranking. Es lo correcto: no se puede ordenar por una
      // variación que no se conoce.
      `SELECT ck.card_id AS card_id,
              ROUND((v.trend_cents - v.avg7_cents) * 100.0 / v.avg7_cents, 1) AS delta
       FROM card_keys ck
       JOIN collection_items ci ON ci.card_key_id = ck.id AND ci.qty > 0
       JOIN cat.card_default_price v ON v.card_id = ck.card_id
       JOIN cat.cards c ON c.id = ck.card_id
       JOIN cat.sets s ON s.id = c.set_id
       WHERE v.avg7_cents IS NOT NULL AND v.avg7_cents > 0
         AND (@game = 'all' OR s.game = @game)
       GROUP BY ck.card_id
       ORDER BY delta DESC`
    )
    .all({ game: getSettings().game })

  const hydrate = (ids: { card_id: string }[]): CardListItem[] =>
    ids.map((r) => byId(r.card_id)).filter((c): c is CardListItem => c !== null)

  return {
    gainers: hydrate(rows.slice(0, limit)),
    losers: hydrate(rows.slice(-limit).reverse())
  }
}
