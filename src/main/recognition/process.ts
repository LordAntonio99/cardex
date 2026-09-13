/**
 * El proceso reconocedor.
 *
 * Corre como `utilityProcess` de Electron, aparte del proceso principal. Tres
 * razones, todas prácticas:
 *
 *  - El principal ejecuta SQLite de forma síncrona. Un reconocimiento de uno a
 *    tres segundos ahí dentro congelaría la ventana entera.
 *  - onnxruntime es código nativo: si se cae, se lleva por delante su proceso.
 *    Aquí eso es un reinicio silencioso, no la aplicación cerrándose.
 *  - Cargar el modelo y OpenCV cuesta unos cientos de megas de memoria. Al
 *    terminar de escanear se mata el proceso y se recuperan de golpe.
 *
 * No habla con la base de datos ni con la red: recibe los vectores de
 * referencia y los fotogramas, y devuelve identificadores de carta.
 */

import path from 'node:path'
import type { CardLang } from '@shared/types'
import type { FromRecognizer, RawResult, ToRecognizer } from './protocol'
import {
  CARD_H,
  CARD_W,
  EMBED_DIMS,
  THRESHOLDS,
  configureSharp,
  createEmbedder,
  decodeToRgba,
  emptyIndex,
  findCardQuad,
  loadCv,
  matchCard,
  measureQuality,
  rotate180,
  toWebpDataUrl,
  warpCard,
  type Embedder,
  type RefIndex,
  type RefIndexEntry
} from './pipeline'

const port = process.parentPort

function send(message: FromRecognizer): void {
  port.postMessage(message)
}

const log = {
  info: (message: string): void => send({ type: 'log', level: 'info', message }),
  warn: (message: string): void => send({ type: 'log', level: 'warn', message }),
  error: (message: string): void => send({ type: 'log', level: 'error', message })
}

let embedder: Embedder | null = null
let index: RefIndex = emptyIndex()
/** Tandas recibidas mientras se sube el catálogo, antes de consolidarlas. */
let pending: { entries: RefIndexEntry[]; vectors: Float32Array }[] = []

async function init(modelsDir: string, threads: number): Promise<void> {
  const started = Date.now()
  configureSharp()
  await loadCv()
  embedder = await createEmbedder(path.join(modelsDir, 'dinov2-small', 'model.onnx'), threads)
  send({
    type: 'ready',
    ms: Date.now() - started,
    detail: `hilos=${threads}`
  })
}

/** Consolida las tandas en una única matriz contigua. */
function consolidate(): void {
  const entries: RefIndexEntry[] = []
  let total = 0
  for (const chunk of pending) total += chunk.entries.length
  const vectors = new Float32Array(total * EMBED_DIMS)
  let row = 0
  for (const chunk of pending) {
    vectors.set(chunk.vectors, row * EMBED_DIMS)
    for (const entry of chunk.entries) entries.push(entry)
    row += chunk.entries.length
  }
  index = { entries, vectors }
  pending = []
  send({ type: 'refs:ack', total: entries.length })
}

async function identify(jpeg: Buffer): Promise<RawResult> {
  const started = Date.now()
  const empty = (outcome: RawResult['outcome'], extra: Partial<RawResult> = {}): RawResult => ({
    outcome,
    candidates: [],
    margin: 0,
    ambiguous: false,
    thumbnail: null,
    sharpness: 0,
    glare: 0,
    ms: Date.now() - started,
    ...extra
  })

  const frame = await decodeToRgba(jpeg)
  const quad = await findCardQuad(frame)
  if (!quad) return empty('no_card')

  const card = await warpCard(frame, quad)
  const quality = await measureQuality(card)
  if (quality.sharpness < THRESHOLDS.minSharpness) {
    return empty('blurry', { sharpness: quality.sharpness, glare: quality.glare })
  }
  if (quality.glare > THRESHOLDS.maxGlare) {
    return empty('glare', { sharpness: quality.sharpness, glare: quality.glare })
  }

  if (!embedder || index.entries.length === 0) {
    return empty('unknown', { sharpness: quality.sharpness, glare: quality.glare })
  }

  const match = await matchCard(index, embedder, card)
  // La miniatura sale en la orientación que ha ganado: es la que el usuario
  // reconoce, aunque haya puesto la carta del revés.
  const thumbnail = await toWebpDataUrl(match.flipped ? rotate180(card) : card, 300)

  const best = match.hits[0]
  if (!best || best.score < THRESHOLDS.minCosine) {
    return empty('unknown', { thumbnail, sharpness: quality.sharpness, glare: quality.glare })
  }

  return {
    outcome: 'candidates',
    candidates: match.hits.map((h) => ({ cardId: h.cardId, lang: h.lang as CardLang, score: h.score })),
    margin: match.margin,
    ambiguous: match.ambiguous,
    thumbnail,
    sharpness: quality.sharpness,
    glare: quality.glare,
    ms: Date.now() - started
  }
}

port.on('message', (event: Electron.MessageEvent) => {
  const message = event.data as ToRecognizer
  void (async (): Promise<void> => {
    try {
      switch (message.type) {
        case 'init':
          await init(message.modelsDir, message.threads)
          break
        case 'refs:chunk':
          pending.push({
            entries: message.entries,
            vectors: new Float32Array(message.vectors)
          })
          break
        case 'refs:done':
          consolidate()
          break
        case 'identify':
          send({
            type: 'identified',
            id: message.id,
            result: await identify(Buffer.from(message.jpeg))
          })
          break
        case 'shutdown':
          await embedder?.close()
          process.exit(0)
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      if (message.type === 'identify') {
        send({ type: 'failed', id: message.id, message: detail })
      } else {
        log.error(`${message.type}: ${detail}`)
      }
    }
  })()
})

// Dimensiones canónicas, por si alguien lee el log y duda de qué se está midiendo.
log.info(`reconocedor arrancado (carta ${CARD_W}x${CARD_H})`)
