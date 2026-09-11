import type { Pack, SetProgress } from '@shared/types'
import { getDb } from '../db'
import { getSettings } from '../settings'

interface SetRow {
  id: string
  series_id: string
  region: string
  code: string | null
  name: string
  released_on: string | null
  total_official: number
  total_all: number
  logo_path: string | null
  symbol_path: string | null
  sort_key: number
  owned_cards: number
  value_cents: number
}

interface PackRow {
  id: string
  set_id: string
  name: string
  kind: string
  artwork_path: string | null
  logo_path: string | null
  sort_key: number
}

const PACK_KINDS = new Set(['booster', 'etb', 'bundle', 'collection', 'other'])

function toPack(r: PackRow): Pack {
  return {
    id: r.id,
    setId: r.set_id,
    name: r.name,
    kind: (PACK_KINDS.has(r.kind) ? r.kind : 'other') as Pack['kind'],
    artworkPath: r.artwork_path,
    logoPath: r.logo_path,
    sortKey: r.sort_key
  }
}

/**
 * Progreso por set para la vista «Sets y sobres».
 *
 * El porcentaje se calcula contra `total_official` (las cartas numeradas), no
 * contra el total con secretas: si no, un set nunca llegaría al 100 % y el
 * indicador mentiría.
 */
export function progress(): SetProgress[] {
  const db = getDb()
  const uiLang = getSettings().uiLang

  const sets = db
    .prepare<{ uiLang: string }, SetRow>(
      `SELECT s.id, s.series_id, s.region, s.code,
              COALESCE(sn.name, s.name) AS name,
              s.released_on, s.total_official, s.total_all,
              s.logo_path, s.symbol_path, s.sort_key,
              COALESCE((
                SELECT COUNT(DISTINCT ck.card_id)
                FROM card_keys ck
                JOIN collection_items ci ON ci.card_key_id = ck.id AND ci.qty > 0
                JOIN cat.cards c2 ON c2.id = ck.card_id
                WHERE c2.set_id = s.id
              ), 0) AS owned_cards,
              COALESCE((
                SELECT SUM(ci.qty * COALESCE((
                  SELECT pp.trend_cents FROM price_points pp
                  WHERE pp.card_key_id = ck.id AND pp.source = 0
                  ORDER BY pp.day DESC LIMIT 1
                ), 0))
                FROM card_keys ck
                JOIN collection_items ci ON ci.card_key_id = ck.id AND ci.qty > 0
                JOIN cat.cards c3 ON c3.id = ck.card_id
                WHERE c3.set_id = s.id
              ), 0) AS value_cents
       FROM cat.sets s
       LEFT JOIN cat.set_names sn ON sn.set_id = s.id AND sn.lang = @uiLang
       ORDER BY s.sort_key DESC, s.released_on DESC, s.id`
    )
    .all({ uiLang })

  if (!sets.length) return []

  const packs = db
    .prepare<{ uiLang: string }, PackRow>(
      `SELECT p.id, p.set_id, COALESCE(pn.name, p.name) AS name, p.kind,
              p.artwork_path, p.logo_path, p.sort_key
       FROM cat.packs p
       LEFT JOIN cat.pack_names pn ON pn.pack_id = p.id AND pn.lang = @uiLang
       ORDER BY p.set_id, p.sort_key`
    )
    .all({ uiLang })

  const bySet = new Map<string, Pack[]>()
  for (const p of packs) {
    const list = bySet.get(p.set_id)
    if (list) list.push(toPack(p))
    else bySet.set(p.set_id, [toPack(p)])
  }

  return sets.map((s) => ({
    set: {
      id: s.id,
      seriesId: s.series_id,
      region: s.region,
      code: s.code,
      name: s.name,
      releasedOn: s.released_on,
      totalOfficial: s.total_official,
      totalAll: s.total_all,
      logoPath: s.logo_path,
      symbolPath: s.symbol_path,
      sortKey: s.sort_key
    },
    ownedCards: s.owned_cards,
    pct: s.total_official > 0 ? Math.round((s.owned_cards / s.total_official) * 1000) / 10 : 0,
    valueCents: s.value_cents,
    packs: bySet.get(s.id) ?? []
  }))
}
