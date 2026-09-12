import {
  CARD_LANGS,
  VARIANTS,
  VARIANT_BIT,
  type CardLang,
  type ScanCandidate,
  type ScanCommitItem,
  type ScanEvidence,
  type ScanResult,
  type ScanStatus,
  type Variant
} from '@shared/types'
import { app } from 'electron'
import { getDb } from '../db'
import { broadcast } from '../events'
import { refreshOwnedPrices } from '../catalog/sync'
import { THRESHOLDS } from '../recognition/core/thresholds'
import type { RawResult } from '../recognition/protocol'
import * as recognizer from '../recognition/service'
import { getSettings } from '../settings'
import { log } from '../log'
import { byId } from './cards'

/**
 * Reconocimiento de carta.
 *
 * El trabajo de visión vive en el proceso reconocedor; aquí se hace lo que sólo
 * main puede hacer: convertir el identificador que devuelve en una carta de
 * verdad, con su nombre traducido, su número compuesto y su precio, y decidir
 * si el resultado es lo bastante sólido como para aceptarlo sin preguntar.
 */

/** Decodifica el `data:` que manda el renderer. */
function decodeDataUrl(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.startsWith('data:image/')) return null
  try {
    return Buffer.from(dataUrl.slice(comma + 1), 'base64')
  } catch {
    return null
  }
}

/** Convierte una carta del catálogo en candidata del escáner. */
function toCandidate(cardId: string, score: number): ScanCandidate | null {
  const card = byId(cardId)
  if (!card) return null
  return {
    cardId: card.cardId,
    name: card.name,
    numberLabel: card.numberLabel,
    setId: card.setId,
    setCode: card.setCode,
    setName: card.setName,
    imagePath: card.imagePath,
    variantMask: card.variantMask,
    langs: card.langs,
    priceCents: card.priceCents,
    score: Math.round(score * 1000) / 10
  }
}

/**
 * Variante que se propone al usuario.
 *
 * Ninguna imagen de referencia distingue una holográfica de su versión normal
 * —TCGdex publica una sola imagen por carta— y ningún proyecto conocido lo
 * resuelve de forma fiable desde una webcam. Así que no se adivina: se propone
 * la más probable entre las que la carta admite y el usuario la corrige con un
 * clic. La 1ª edición nunca se propone sola: es la que más cambia el precio.
 */
function suggestVariant(variantMask: number): Variant {
  if (variantMask & VARIANT_BIT.holo) return 'holo'
  if (variantMask & VARIANT_BIT.normal) return 'normal'
  if (variantMask & VARIANT_BIT.reverse) return 'reverse'
  return 'normal'
}

/** El idioma que el usuario dice escanear, o el de la interfaz. */
function preferredLang(): CardLang {
  const settings = getSettings()
  if (settings.scanLang) return settings.scanLang
  return settings.uiLang === 'en' ? 'en' : 'es'
}

/**
 * Idioma que se atribuye a la carta física.
 *
 * El parecido visual NO sirve para esto: la misma carta en español y en inglés
 * da un coseno de 0,98 entre sí, porque sólo cambian unas líneas de texto
 * pequeño. Así que se usa lo que el usuario ha declarado que está escaneando,
 * y si esa impresión no existe en ese idioma, el idioma en que sí existe.
 */
function resolveLang(langs: CardLang[], matched: CardLang): CardLang {
  const wanted = preferredLang()
  if (langs.includes(wanted)) return wanted
  if (langs.includes(matched)) return matched
  return langs[0] ?? matched
}

/**
 * De las señales del reconocedor a una decisión.
 *
 * La regla es asimétrica a propósito: aceptar una carta equivocada cuesta
 * encontrarla y corregirla más tarde; pedir una confirmación cuesta un clic.
 * Ante la duda, se pregunta.
 *
 * El coseno absoluto por sí solo no basta: dos cartas distintas del mismo set y
 * la misma época llegan a parecerse un 0,81. La señal que de verdad separa es
 * el MARGEN con la siguiente carta distinta.
 */
function decide(raw: RawResult): { status: ScanStatus; confidence: number } {
  if (raw.outcome !== 'candidates') {
    return { status: raw.outcome === 'unknown' ? 'unknown' : raw.outcome, confidence: 0 }
  }
  const best = raw.candidates[0]
  if (!best) return { status: 'unknown', confidence: 0 }

  // La confianza combina las dos señales y se queda con la peor: un parecido
  // altísimo con dos cartas a la vez no es confianza, es ambigüedad.
  const byCosine = (best.score - THRESHOLDS.minCosine) / (THRESHOLDS.autoCosine - THRESHOLDS.minCosine)
  const byMargin = raw.margin / THRESHOLDS.autoMargin
  const confidence = Math.max(0, Math.min(1, Math.min(byCosine, byMargin))) * 100

  const solid =
    best.score >= THRESHOLDS.autoCosine && raw.margin >= THRESHOLDS.autoMargin && !raw.ambiguous
  return {
    status: solid ? 'match' : 'confirm',
    confidence: Math.round(confidence * 10) / 10
  }
}

const emptyResult = (status: ScanStatus, thumbnail: string | null, evidence: ScanEvidence | null): ScanResult => ({
  status,
  detection: null,
  alternatives: [],
  thumbnail,
  evidence
})

/**
 * Guarda la captura para calibrar, si se ha pedido por entorno.
 *
 * `CARDEX_CAPTURES=<carpeta> npm run dev` deja ahí cada fotograma con el nombre
 * de la carta que se ha reconocido. Corregir a mano los pocos que fallen es
 * mucho menos trabajo que etiquetar cincuenta fotos desde cero, y de ahí salen
 * los umbrales de `thresholds.ts`, que no se pueden afinar sin fotos de verdad.
 *
 * Sólo en desarrollo: una aplicación instalada no escribe fotogramas a disco.
 */
async function saveForCalibration(jpeg: Buffer, result: ScanResult): Promise<void> {
  const dir = process.env['CARDEX_CAPTURES']
  if (!dir || app.isPackaged) return
  try {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    await mkdir(dir, { recursive: true })
    const card = result.detection?.cardId ?? result.status
    const lang = result.detection?.lang ?? 'xx'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await writeFile(nodePath.join(dir, `${card}__${lang}__${stamp}.jpg`), jpeg)
  } catch (e) {
    log.warn(`No se ha podido guardar la captura de calibración: ${e instanceof Error ? e.message : e}`)
  }
}

export async function identify(imageDataUrl: string): Promise<ScanResult> {
  const jpeg = decodeDataUrl(imageDataUrl)
  if (!jpeg || jpeg.byteLength === 0) return emptyResult('no_card', null, null)

  const raw = await recognizer.identify(jpeg)
  const evidence: ScanEvidence = {
    cosineTop1: raw.candidates[0]?.score ?? 0,
    cosineMargin: raw.margin,
    ambiguous: raw.ambiguous,
    sharpness: raw.sharpness,
    glare: raw.glare,
    ms: raw.ms
  }

  const { status, confidence } = decide(raw)
  if (status !== 'match' && status !== 'confirm') {
    const rejected = emptyResult(status, raw.thumbnail, evidence)
    await saveForCalibration(jpeg, rejected)
    return rejected
  }

  // Se hidratan todas las candidatas: el selector de confirmación las necesita,
  // y son como mucho cinco consultas por identificador primario.
  const alternatives = raw.candidates
    .map((c) => toCandidate(c.cardId, c.score))
    .filter((c): c is ScanCandidate => c !== null)

  const best = alternatives[0]
  const matchedLang = raw.candidates[0]?.lang ?? 'en'
  if (!best) return emptyResult('unknown', raw.thumbnail, evidence)

  const result: ScanResult = {
    status,
    detection: {
      id: `det_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      cardId: best.cardId,
      name: best.name,
      numberLabel: best.numberLabel,
      lang: resolveLang(best.langs, matchedLang),
      variant: suggestVariant(best.variantMask),
      imagePath: best.imagePath,
      priceCents: best.priceCents,
      confidence,
      variantMask: best.variantMask,
      langs: best.langs,
      thumbnail: raw.thumbnail,
      status
    },
    alternatives,
    thumbnail: raw.thumbnail,
    evidence
  }
  await saveForCalibration(jpeg, result)
  return result
}

/**
 * Confirma el lote: cada detección aceptada entra como un movimiento de tipo
 * 'pull'. El disparador de `movements` actualiza el inventario, así que aquí no
 * se toca `collection_items` a mano.
 *
 * Todo va en una transacción: o entra el lote entero o no entra nada.
 */
export function commit(detections: ScanCommitItem[]): { added: number } {
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

  const run = db.transaction((items: ScanCommitItem[]) => {
    let added = 0
    for (const d of items) {
      // El lote llega del renderer, y el renderer es cliente: se comprueba que
      // la carta existe y que variante e idioma son de los que hay, no vaya a
      // entrar en la colección una fila que luego no sepamos mostrar.
      const set = setOf.get({ cardId: d.cardId })
      if (!set) {
        log.warn(`Se descarta una detección de carta desconocida: ${d.cardId}`)
        continue
      }
      if (!VARIANTS.includes(d.variant) || !CARD_LANGS.includes(d.lang)) {
        log.warn(`Se descarta una detección con variante o idioma no válidos: ${d.cardId}`)
        continue
      }

      const existing = findKey.get({ cardId: d.cardId, variant: d.variant, lang: d.lang })
      const keyId =
        existing?.id ??
        Number(
          insertKey.run({
            cardId: d.cardId,
            variant: d.variant,
            lang: d.lang,
            snapName: d.name,
            snapSetId: set.set_id,
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
  if (added > 0) {
    // Sin esto, la colección sólo se enteraba porque la vista cambiaba y se
    // volvía a montar. Ahora el usuario puede quedarse escaneando.
    refreshOwnedPrices()
    broadcast('db:changed', { scopes: ['collection', 'prices'] })
  }
  log.info(`Lote de escaneo confirmado: ${added} cartas añadidas`)
  return { added }
}
