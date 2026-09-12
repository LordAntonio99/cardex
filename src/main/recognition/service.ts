/**
 * El lado del proceso principal: arranca, alimenta y vigila al reconocedor.
 *
 * Reparto de tareas. El reconocedor no toca la base de datos ni la red: sólo
 * sabe de píxeles y de vectores. Main es quien lee `cat.card_recognition`, le
 * pasa las referencias, y luego convierte el identificador que devuelve en una
 * carta con su nombre, su número y su precio. Así la regla de la casa — el SQL
 * vive en un único sitio — sigue en pie aunque haya un proceso más.
 */

import path from 'node:path'
import { availableParallelism } from 'node:os'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { CardLang, ScanEngineStatus } from '@shared/types'
import { getDb } from '../db'
import { broadcast, mainBus } from '../events'
import { log } from '../log'
import type { FromRecognizer, RawResult, ToRecognizer } from './protocol'
import { EMBED_DIMS, RECOG_MODEL_ID } from './format'

/** Se para solo tras este rato sin escanear; son cientos de megas. */
const IDLE_MS = 3 * 60 * 1000
/** Un reconocimiento que pase de aquí es que algo ha ido mal. */
const REQUEST_TIMEOUT_MS = 20_000
/** Tiempo máximo para que el proceso cargue modelo y librerías. */
const START_TIMEOUT_MS = 30_000
/** Más caídas que esto en la ventana de gracia y se deja de insistir. */
const MAX_CRASHES = 3
const CRASH_WINDOW_MS = 5 * 60 * 1000

interface Pending {
  resolve(result: RawResult): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

let child: UtilityProcess | null = null
let starting: Promise<void> | null = null
let status: ScanEngineStatus = { state: 'off', refCount: 0, model: null }
let nextId = 1
const pending = new Map<number, Pending>()
let idleTimer: NodeJS.Timeout | null = null
let crashes: number[] = []
let refsDirty = true

function setStatus(next: Partial<ScanEngineStatus>): void {
  status = { ...status, ...next }
  broadcast('scan:engine', status)
}

export function engineStatus(): ScanEngineStatus {
  return status
}

/**
 * Carpeta de modelos: dentro de `resources` al empaquetar, del proyecto en
 * desarrollo.
 *
 * En desarrollo se calcula desde `__dirname` (que es siempre `out/main`) y no
 * desde `app.getAppPath()`, porque eso último depende de cómo se haya lanzado
 * Electron: `electron .` y `electron out/main/index.js` devuelven cosas
 * distintas, y el segundo dejaba de encontrar los modelos.
 */
function modelsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'models')
    : path.join(__dirname, '..', '..', 'resources', 'models')
}

/**
 * Hilos para la inferencia.
 *
 * Se dejan dos libres: uno para el proceso principal, que atiende la interfaz,
 * y otro para el compositor. Saturar la máquina haría que la vista previa de la
 * cámara diera tirones justo mientras se escanea.
 */
function threadCount(): number {
  return Math.min(4, Math.max(1, availableParallelism() - 2))
}

function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (pending.size === 0) {
      log.info('Reconocedor parado por inactividad')
      stop()
    }
  }, IDLE_MS)
}

function handleMessage(message: FromRecognizer): void {
  switch (message.type) {
    case 'ready':
      log.info(`Reconocedor listo en ${message.ms} ms (${message.detail})`)
      break
    case 'refs:ack':
      if (message.total === 0) {
        setStatus({
          state: 'unavailable',
          refCount: 0,
          message: 'El catálogo instalado no trae datos de reconocimiento.'
        })
      } else {
        setStatus({ state: 'ready', refCount: message.total, model: RECOG_MODEL_ID, message: undefined })
      }
      break
    case 'identified': {
      const p = pending.get(message.id)
      if (!p) return
      pending.delete(message.id)
      clearTimeout(p.timer)
      p.resolve(message.result)
      break
    }
    case 'failed': {
      const p = pending.get(message.id)
      if (!p) return
      pending.delete(message.id)
      clearTimeout(p.timer)
      p.reject(new Error(message.message))
      break
    }
    case 'log':
      log[message.level](`[reconocedor] ${message.message}`)
      break
  }
}

function handleExit(code: number): void {
  const wasRunning = child !== null
  child = null
  starting = null
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error('El reconocedor se ha detenido'))
  }
  pending.clear()
  refsDirty = true

  if (!wasRunning || code === 0) {
    setStatus({ state: 'off', refCount: 0 })
    return
  }

  // Caída. Se reintenta, pero no indefinidamente: si el motor no arranca en
  // esta máquina, insistir sólo consume batería y llena el registro.
  const now = Date.now()
  crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now]
  log.error(`El reconocedor ha terminado con código ${code} (${crashes.length} en 5 min)`)
  if (crashes.length >= MAX_CRASHES) {
    setStatus({
      state: 'error',
      refCount: 0,
      message: 'El reconocimiento ha fallado varias veces seguidas. Revisa el registro.'
    })
    return
  }
  setStatus({ state: 'off', refCount: 0 })
}

/**
 * Lee los vectores publicados y se los pasa al reconocedor, una tanda por set.
 *
 * `postMessage` de `utilityProcess` COPIA los buffers — sólo transfiere
 * puertos —, así que mandar el catálogo entero en un mensaje sería duplicar
 * decenas de megas de golpe. Por tandas, el pico es el del set más grande.
 */
function sendReferences(target: UtilityProcess): void {
  const db = getDb()
  // El cruce con `cards` descarta vectores de cartas que ya no están en el
  // catálogo: la tabla no tiene clave foránea, a propósito.
  const rows = db
    .prepare<
      { model: string },
      { set_id: string; card_id: string; lang: string; embedding: Buffer }
    >(
      `SELECT r.set_id, r.card_id, r.lang, r.embedding
         FROM cat.card_recognition r
         JOIN cat.cards c ON c.id = r.card_id
        WHERE r.model = @model
        ORDER BY r.set_id`
    )
    .all({ model: RECOG_MODEL_ID })

  const bytes = EMBED_DIMS * 4
  let bySet: typeof rows = []

  const emit = (): void => {
    if (bySet.length === 0) return
    const vectors = new Float32Array(bySet.length * EMBED_DIMS)
    const entries = bySet.map((row, i) => {
      if (row.embedding.byteLength === bytes) {
        vectors.set(
          new Float32Array(row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + bytes)),
          i * EMBED_DIMS
        )
      }
      return { cardId: row.card_id, lang: row.lang as CardLang }
    })
    target.postMessage({
      type: 'refs:chunk',
      setId: bySet[0]!.set_id,
      entries,
      vectors: vectors.buffer as ArrayBuffer
    } satisfies ToRecognizer)
    bySet = []
  }

  for (const row of rows) {
    if (bySet.length > 0 && bySet[0]!.set_id !== row.set_id) emit()
    bySet.push(row)
  }
  emit()

  target.postMessage({ type: 'refs:done', model: RECOG_MODEL_ID } satisfies ToRecognizer)
  refsDirty = false
}

/** Arranca el proceso si hace falta. Varias llamadas a la vez comparten el arranque. */
export function start(): Promise<void> {
  if (child && !refsDirty) return Promise.resolve()
  if (starting) return starting
  if (status.state === 'error') return Promise.reject(new Error(status.message ?? 'Motor no disponible'))

  if (child && refsDirty) {
    sendReferences(child)
    return Promise.resolve()
  }

  starting = new Promise<void>((resolve, reject) => {
    setStatus({ state: 'loading', refCount: 0, model: RECOG_MODEL_ID, message: undefined })

    // `recognizer.js` es la segunda entrada del build de main: queda junto a
    // `index.js`, tanto en desarrollo como dentro del asar.
    const proc = utilityProcess.fork(path.join(__dirname, 'recognizer.js'), [], {
      serviceName: 'cardex-reconocedor',
      // onnxruntime escribe sus avisos en stderr; sin capturarlos se pierden
      // en una aplicación empaquetada, que es justo cuando hacen falta.
      stdio: 'pipe'
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) log.warn(`[reconocedor] ${text}`)
    })
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) log.info(`[reconocedor] ${text}`)
    })

    proc.on('message', (data: FromRecognizer) => {
      handleMessage(data)
      // Se considera arrancado cuando tiene los vectores dentro, no cuando ha
      // cargado el modelo: entre una cosa y otra no sabría reconocer nada, y
      // quien llame a `warmup` se llevaría un estado que no es el definitivo.
      if (data.type === 'ready') sendReferences(proc)
      else if (data.type === 'refs:ack') resolve()
    })
    proc.on('exit', (code) => {
      handleExit(code)
      reject(new Error('El reconocedor no ha llegado a arrancar'))
    })

    child = proc
    proc.postMessage({
      type: 'init',
      modelsDir: modelsDir(),
      threads: threadCount()
    } satisfies ToRecognizer)

    setTimeout(() => {
      if (status.state === 'loading') reject(new Error('El reconocedor no ha arrancado a tiempo'))
    }, START_TIMEOUT_MS)
  }).finally(() => {
    starting = null
  })

  return starting
}

/** Identifica una captura. Arranca el motor si estaba parado. */
export async function identify(jpeg: Buffer): Promise<RawResult> {
  await start()
  const target = child
  if (!target) throw new Error('El reconocedor no está disponible')

  touchIdle()
  const id = nextId
  nextId += 1

  return new Promise<RawResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('El reconocimiento ha tardado demasiado'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })

    const body = jpeg.buffer.slice(
      jpeg.byteOffset,
      jpeg.byteOffset + jpeg.byteLength
    ) as ArrayBuffer
    target.postMessage({ type: 'identify', id, jpeg: body } satisfies ToRecognizer)
  })
}

/** Para el proceso y libera su memoria. */
export function stop(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  const proc = child
  child = null
  if (!proc) {
    setStatus({ state: 'off', refCount: 0 })
    return
  }
  try {
    proc.postMessage({ type: 'shutdown' } satisfies ToRecognizer)
  } catch {
    // Ya se había ido.
  }
  // Si no se va por las buenas en un segundo, se le fuerza.
  setTimeout(() => {
    try {
      proc.kill()
    } catch {
      // Nada que hacer.
    }
  }, 1000)
  setStatus({ state: 'off', refCount: 0 })
}

/** Al reimportar catálogo hay vectores nuevos: hay que volver a mandarlos. */
export function registerCatalogWatch(): void {
  mainBus.on('catalog:imported', () => {
    refsDirty = true
    if (child) sendReferences(child)
  })
}
