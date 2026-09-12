/**
 * Huella visual de una carta: un vector de 384 dimensiones con DINOv2-small.
 *
 * Por qué un embedding y no un hash perceptual: el hash exige un recorte casi
 * perfecto y se hunde con los reflejos de las cartas holográficas. Un embedding
 * auto-supervisado aguanta iluminación, desenfoque leve y error de perspectiva,
 * que es exactamente lo que da una webcam. DINOv2 está entrenado para
 * *instance retrieval* (distinguir ESTE objeto, no «un pájaro»), que es nuestro
 * problema; CLIP, pensado para semántica, rinde bastante peor en esa tarea.
 *
 * La regla de oro de este fichero: el preproceso de la referencia y el de la
 * captura tienen que ser EL MISMO CÓDIGO. Por eso el generador de catálogo
 * carga este módulo en vez de reimplementarlo. Cualquier cambio aquí invalida
 * los vectores publicados, y por eso va firmado en `RECOG_MODEL_ID`.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { resizeRgba, type Rgba } from './image'

/** Lado de la entrada del modelo. */
export const EMBED_SIZE = 224
/** Dimensiones del vector resultante. */
export const EMBED_DIMS = 384

/** Normalización de ImageNet, la que espera DINOv2 (su `preprocessor_config.json`). */
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

/**
 * Recorte hacia dentro antes de medir, en tanto por uno del lado.
 *
 * Se come las esquinas redondeadas y el filo del troquel. Ahí es donde más se
 * diferencian una imagen de catálogo (con transparencia) y una foto real (con
 * el tapete asomando), y no aporta nada para identificar la carta.
 */
const INSET = 0.02

export interface Embedder {
  /** Vector L2-normalizado de la carta ya rectificada. */
  embed(card: Rgba): Promise<Float32Array>
  close(): Promise<void>
}

/** Recorta el marco exterior sin reescalar. */
function inset(img: Rgba, fraction: number): Rgba {
  const dx = Math.round(img.width * fraction)
  const dy = Math.round(img.height * fraction)
  const width = img.width - dx * 2
  const height = img.height - dy * 2
  if (width <= 0 || height <= 0) return img
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = ((y + dy) * img.width + dx) * 4
    out.set(img.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { data: out, width, height }
}

/**
 * RGBA -> tensor NCHW normalizado.
 *
 * El alfa se aplana sobre gris medio: las imágenes de TCGdex traen las esquinas
 * transparentes y, sin aplanar, sharp dejaría ahí negro puro, que es un borde
 * falso que el modelo sí ve.
 */
function toTensorData(img: Rgba): Float32Array {
  const { data, width, height } = img
  const plane = width * height
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i += 1) {
    const o = i * 4
    const a = (data[o + 3] ?? 255) / 255
    for (let c = 0; c < 3; c += 1) {
      const raw = (data[o + c] ?? 0) / 255
      const flat = raw * a + 0.5 * (1 - a)
      out[c * plane + i] = (flat - MEAN[c]!) / STD[c]!
    }
  }
  return out
}

/** Normaliza en sitio para que el coseno sea un simple producto escalar. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i += 1) sum += v[i]! * v[i]!
  const norm = Math.sqrt(sum) || 1
  for (let i = 0; i < v.length; i += 1) v[i]! /= norm
  return v
}

/**
 * Crea el extractor de rasgos.
 *
 * El modelo sólo saca `last_hidden_state` [1, 257, 384]: no trae cabeza de
 * agrupación. Los 257 vectores son el token CLS y 256 parches (16x16). Se usa
 * el CLS, que es el que DINOv2 emplea para recuperación de instancias.
 */
export async function createEmbedder(modelPath: string, threads: number): Promise<Embedder> {
  // Import diferido: cargar onnxruntime abre sus DLL, y este módulo también lo
  // importan scripts que sólo usan los tipos.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ort = require('onnxruntime-node') as typeof import('onnxruntime-node')

  const session: InferenceSession = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all'
  })

  const inputName = session.inputNames[0]!
  const outputName = session.outputNames[0]!

  return {
    async embed(card: Rgba): Promise<Float32Array> {
      const square = await resizeRgba(inset(card, INSET), EMBED_SIZE, EMBED_SIZE)
      const tensor = new ort.Tensor('float32', toTensorData(square), [1, 3, EMBED_SIZE, EMBED_SIZE])
      const out = await session.run({ [inputName]: tensor })
      const hidden = out[outputName] as Tensor
      const raw = hidden.data as Float32Array
      // El token CLS es el primero de la secuencia.
      return l2Normalize(new Float32Array(raw.subarray(0, EMBED_DIMS)))
    },
    async close(): Promise<void> {
      await session.release()
    }
  }
}
