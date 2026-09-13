#!/usr/bin/env node
/**
 * Calibra los umbrales del escáner con fotos de verdad.
 *
 * Los números de `src/main/recognition/core/thresholds.ts` no son constantes de
 * diseño: son el resultado de medir. Y no se pueden medir con imágenes de
 * catálogo, porque el problema real son los reflejos, el desenfoque y la
 * perspectiva de una webcam. Este guión recorre un montón de capturas
 * etiquetadas y dice qué pasaría con cada juego de umbrales.
 *
 * El criterio no es «acertar más». Es que **no haya ni un solo acierto
 * automático equivocado**: una confirmación de más cuesta un clic, y una carta
 * mal metida en la colección cuesta encontrarla y arreglarla. Sólo una vez
 * garantizado eso se mira cuántas se aceptan solas.
 *
 * Cómo conseguir las capturas:
 *
 *   CARDEX_CAPTURES=./calib npm run dev
 *
 * Escanea tus cartas como lo harías normalmente. Cada fotograma se guarda con
 * el nombre de lo que se reconoció (`base1-4__en__<fecha>.jpg`). Repasa la
 * carpeta y corrige el prefijo de las que estén mal; ése es el trabajo de
 * etiquetado, y es poco. Los rechazos salen como `no_card__…`, `blurry__…` o
 * `unknown__…`, y también valen: son la mitad de la calibración.
 *
 *   npm run build && node scripts/recog-eval.mjs ./calib
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PIPELINE = path.join(ROOT, 'out', 'main', 'pipeline.js')
const MODEL = path.join(ROOT, 'resources', 'models', 'dinov2-small', 'model.onnx')
const CATALOG = path.join(ROOT, 'catalog')

const dir = path.resolve(process.argv[2] ?? 'calib')

function die(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

if (!existsSync(PIPELINE)) die(`Falta ${path.relative(ROOT, PIPELINE)}. Compila antes:\n  npm run build`)
if (!existsSync(MODEL)) die(`Falta el modelo. Descárgalo antes:\n  npm run models:fetch`)
if (!existsSync(dir)) die(`No existe ${dir}.\nGraba capturas con:  CARDEX_CAPTURES=${path.relative(ROOT, dir)} npm run dev`)

const require = createRequire(import.meta.url)
const P = require(PIPELINE)

/** Índice de referencia, leído de los ficheros publicados del catálogo. */
async function loadIndex() {
  const manifestPath = path.join(CATALOG, 'manifest.json')
  if (!existsSync(manifestPath)) {
    die(`Falta ${path.relative(ROOT, manifestPath)}.\nGenera el catálogo antes:\n  node scripts/build-catalog.mjs --sets base1,me05 --recognition`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const wanted = (manifest.recognition ?? []).filter((r) => r.model === P.RECOG_MODEL_ID)
  if (!wanted.length) {
    die(`El catálogo de ${path.relative(ROOT, CATALOG)} no trae vectores para ${P.RECOG_MODEL_ID}.\n  node scripts/build-catalog.mjs --sets ... --recognition`)
  }

  const entries = []
  const chunks = []
  for (const r of wanted) {
    const sidecar = P.decodeSidecar(await readFile(path.join(CATALOG, r.file)), r.id)
    for (const e of sidecar.entries) entries.push(e)
    chunks.push(sidecar.vectors)
  }
  const vectors = new Float32Array(entries.length * P.EMBED_DIMS)
  let row = 0
  for (const c of chunks) {
    vectors.set(c, row * P.EMBED_DIMS)
    row += c.length / P.EMBED_DIMS
  }
  return { entries, vectors }
}

/** La etiqueta es el prefijo del nombre: `base1-4__en__<fecha>.jpg`. */
function labelOf(file) {
  const [card = '', lang = ''] = path.basename(file).split('__')
  return { card, lang }
}

const REJECTS = new Set(['no_card', 'blurry', 'glare', 'unknown'])

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]
}

const fmt = (n, w = 6) => n.toFixed(3).padStart(w)

async function main() {
  P.configureSharp()
  await P.loadCv()
  const index = await loadIndex()
  const embedder = await P.createEmbedder(MODEL, 0)

  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  if (!files.length) die(`No hay imágenes en ${dir}.`)

  console.log(`${files.length} captura(s) contra ${index.entries.length} referencia(s) · ${P.RECOG_MODEL_ID}\n`)

  const rows = []
  for (const file of files) {
    const label = labelOf(file)
    const started = Date.now()
    const frame = await P.decodeToRgba(await readFile(path.join(dir, file)))
    const quad = await P.findCardQuad(frame)

    if (!quad) {
      rows.push({ file, label, outcome: 'no_card', ms: Date.now() - started })
      continue
    }
    const card = await P.warpCard(frame, quad)
    const quality = await P.measureQuality(card)

    // Los mismos filtros que aplica el escáner antes de gastar la inferencia.
    // Sin esto el informe enseñaría fallos que en la aplicación ni llegan al
    // comparador, y se calibrarían los umbrales contra un problema que no
    // existe.
    const gate =
      quality.sharpness < P.THRESHOLDS.minSharpness
        ? 'blurry'
        : quality.glare > P.THRESHOLDS.maxGlare
          ? 'glare'
          : null

    const vector = await embedder.embed(card)
    const hits = P.search(index, vector, 5)
    const best = hits[0]
    const second = hits[1]

    rows.push({
      file,
      label,
      outcome: gate ?? 'candidates',
      gate,
      top1: best?.cardId ?? '',
      lang: best?.lang ?? '',
      cos: best?.score ?? 0,
      margin: best && second ? best.score - second.score : 1,
      inTop3: hits.slice(0, 3).some((h) => h.cardId === label.card),
      sharpness: quality.sharpness,
      glare: quality.glare,
      ms: Date.now() - started
    })
  }
  await embedder.close()

  // ── Detalle ───────────────────────────────────────────────────────────────
  console.log('captura'.padEnd(34), 'esperada'.padEnd(12), 'obtenida'.padEnd(12), '  coseno  margen nitidez brillo')
  for (const r of rows) {
    if (r.outcome !== 'candidates') {
      const why = r.outcome === 'no_card' ? '(sin carta)' : `(descartada: ${r.outcome})`
      console.log(path.basename(r.file).slice(0, 33).padEnd(34), r.label.card.padEnd(12), why)
      continue
    }
    const ok = r.top1 === r.label.card
    const mark = REJECTS.has(r.label.card) ? '·' : ok ? ' ' : '✗'
    console.log(
      `${mark}${path.basename(r.file).slice(0, 32).padEnd(33)}`,
      r.label.card.padEnd(12),
      r.top1.padEnd(12),
      fmt(r.cos, 8),
      fmt(r.margin),
      String(Math.round(r.sharpness)).padStart(7),
      `${(r.glare * 100).toFixed(1)}%`.padStart(6)
    )
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  const real = rows.filter((r) => !REJECTS.has(r.label.card))
  const scored = real.filter((r) => r.outcome === 'candidates')
  const gated = real.filter((r) => r.gate)
  const right = scored.filter((r) => r.top1 === r.label.card)
  const wrong = scored.filter((r) => r.top1 !== r.label.card)

  console.log(`\n${'─'.repeat(78)}`)
  console.log(`cartas etiquetadas     ${real.length}`)
  console.log(`  acierto en la 1ª     ${right.length} (${((right.length / Math.max(1, real.length)) * 100).toFixed(1)}%)`)
  console.log(`  acierto en las 3     ${scored.filter((r) => r.inTop3).length}`)
  console.log(`  descartadas antes    ${real.length - scored.length} (sin cuadrilátero, movidas o con brillo)`)
  if (gated.length) {
    console.log(`    por calidad        ${gated.map((r) => r.gate).join(', ')}`)
  }
  console.log(`tiempo medio           ${Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length))} ms`)

  if (right.length) {
    console.log(`\naciertos   coseno  p05 ${fmt(percentile(right.map((r) => r.cos), 0.05))}  mediana ${fmt(percentile(right.map((r) => r.cos), 0.5))}`)
    console.log(`           margen  p05 ${fmt(percentile(right.map((r) => r.margin), 0.05))}  mediana ${fmt(percentile(right.map((r) => r.margin), 0.5))}`)
  }
  if (wrong.length) {
    console.log(`\nFALLOS     coseno  máx ${fmt(Math.max(...wrong.map((r) => r.cos)))}`)
    console.log(`           margen  máx ${fmt(Math.max(...wrong.map((r) => r.margin)))}`)
    console.log('\nEl umbral de aceptación automática tiene que quedar POR ENCIMA de estos máximos.')
  } else if (right.length) {
    console.log('\nSin fallos en este conjunto.')
  }

  // ── Qué harían los umbrales actuales ──────────────────────────────────────
  const T = P.THRESHOLDS
  const auto = (r) => r.cos >= T.autoCosine && r.margin >= T.autoMargin
  const autoRight = right.filter(auto).length
  const autoWrong = wrong.filter(auto).length
  console.log(`\numbrales actuales  coseno ≥ ${T.autoCosine}  margen ≥ ${T.autoMargin}`)
  console.log(`  se aceptarían solas   ${autoRight} correctas`)
  console.log(`  ${autoWrong > 0 ? '⚠ ENTRARÍAN MAL      ' : '  entrarían mal        '}${autoWrong}`)
  if (autoWrong > 0) {
    console.log('\n  Sube `autoCosine` o `autoMargin` en src/main/recognition/core/thresholds.ts')
    console.log('  hasta que ese número sea cero. Es la única regla que no se negocia.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
