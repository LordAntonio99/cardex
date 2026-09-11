import type { CardLang, ScanDetection, Variant } from '@shared/types'
import { getDb } from '../db'
import { getSettings } from '../settings'
import { log } from '../log'

/**
 * Reconocimiento de carta.
 *
 * De momento es una simulación: devuelve una carta al azar del catálogo con una
 * fiabilidad verosímil. Lo que importa aquí es la FORMA de la interfaz, no la
 * implementación: cuando entre el reconocimiento de verdad (hash perceptual
 * contra `cat.cards.phash`, y OCR del número después) sustituirá el cuerpo de
 * esta función sin que la vista del escáner se entere.
 *
 * `imageDataUrl` ya llega aquí y se ignora a propósito, para que la firma no
 * cambie el día que se use.
 */
export function identify(imageDataUrl: string): ScanDetection | null {
  void imageDataUrl

  const db = getDb()
  const uiLang = getSettings().uiLang

  const row = db
    .prepare<
      { uiLang: string },
      {
        card_id: string
        name: string
        local_id: string
        total_official: number
        image_path: string | null
        variant_mask: number
        price_cents: number | null
      }
    >(
      `SELECT c.id AS card_id,
              COALESCE(cn.name, c.name) AS name,
              c.local_id, s.total_official, c.image_path, c.variant_mask,
              (SELECT pp.trend_cents FROM price_points pp
               JOIN card_keys ck ON ck.id = pp.card_key_id
               WHERE ck.card_id = c.id AND pp.source = 0
               ORDER BY pp.day DESC LIMIT 1) AS price_cents
       FROM cat.cards c
       JOIN cat.sets s ON s.id = c.set_id
       LEFT JOIN cat.card_names cn ON cn.card_id = c.id AND cn.lang = @uiLang
       ORDER BY RANDOM() LIMIT 1`
    )
    .get({ uiLang })

  // Sin catálogo no hay nada que reconocer. La vista lo dice con todas las letras.
  if (!row) return null

  const width = String(row.total_official || '').length
  const numberLabel = row.total_official
    ? `${row.local_id.padStart(width, '0')}/${row.total_official}`
    : row.local_id

  return {
    id: `det_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    cardId: row.card_id,
    name: row.name,
    numberLabel,
    lang: (uiLang === 'en' ? 'en' : 'es') as CardLang,
    // bit1 = holo; si la carta lo admite se supone holo, que es lo que más se escanea.
    variant: (row.variant_mask & 2 ? 'holo' : 'normal') as Variant,
    imagePath: row.image_path,
    priceCents: row.price_cents,
    confidence: Math.round((72 + Math.random() * 27) * 10) / 10
  }
}

/**
 * Confirma el lote: cada detección aceptada entra como un movimiento de tipo
 * 'pull'. El disparador de `movements` actualiza el inventario, así que aquí no
 * se toca `collection_items` a mano.
 *
 * Todo va en una transacción: o entra el lote entero o no entra nada.
 */
export function commit(detections: ScanDetection[]): { added: number } {
  if (!detections.length) return { added: 0 }

  const db = getDb()
  const now = Date.now()

  const findKey = db.prepare<{ cardId: string; variant: string; lang: string }, { id: number }>(
    'SELECT id FROM card_keys WHERE card_id = @cardId AND variant = @variant AND lang = @lang'
  )
  const insertKey = db.prepare(
    `INSERT INTO card_keys (card_id, variant, lang, snap_name, snap_set_id, snap_number, created_at)
     VALUES (@cardId, @variant, @lang, @snapName, @snapSetId, @snapNumber, @now)`
  )
  const setOf = db.prepare<{ cardId: string }, { set_id: string }>(
    'SELECT set_id FROM cat.cards WHERE id = @cardId'
  )
  const insertMovement = db.prepare(
    `INSERT INTO movements (card_key_id, kind, qty_delta, unit_cents, condition, occurred_at, created_at, source)
     VALUES (@keyId, 'pull', 1, NULL, 'NM', @now, @now, 'scanner')`
  )

  const run = db.transaction((items: ScanDetection[]) => {
    let added = 0
    for (const d of items) {
      const existing = findKey.get({ cardId: d.cardId, variant: d.variant, lang: d.lang })
      const keyId =
        existing?.id ??
        Number(
          insertKey.run({
            cardId: d.cardId,
            variant: d.variant,
            lang: d.lang,
            snapName: d.name,
            snapSetId: setOf.get({ cardId: d.cardId })?.set_id ?? '',
            snapNumber: d.numberLabel,
            now
          }).lastInsertRowid
        )
      insertMovement.run({ keyId, now })
      added += 1
    }
    return added
  })

  const added = run(detections)
  log.info(`Lote de escaneo confirmado: ${added} cartas añadidas`)
  return { added }
}
