/**
 * Mensajes entre el proceso principal y el reconocedor.
 *
 * Sólo tipos: lo importan los dos lados y no debe arrastrar nada ejecutable.
 */

import type { CardLang } from '@shared/types'

/** main -> reconocedor */
export type ToRecognizer =
  | { type: 'init'; modelsDir: string; threads: number }
  /**
   * Los vectores llegan por tandas, una por set. `postMessage` de
   * `utilityProcess` COPIA los buffers (sólo transfiere puertos), así que
   * mandar el catálogo entero de golpe serían decenas de megas en un único
   * mensaje. Por tandas, la memoria pico es la de un set.
   */
  | { type: 'refs:chunk'; setId: string; entries: { cardId: string; lang: CardLang }[]; vectors: ArrayBuffer }
  | { type: 'refs:done'; model: string }
  | { type: 'identify'; id: number; jpeg: ArrayBuffer }
  | { type: 'shutdown' }

/** reconocedor -> main */
export type FromRecognizer =
  | { type: 'ready'; ms: number; detail: string }
  | { type: 'refs:ack'; total: number }
  | { type: 'identified'; id: number; result: RawResult }
  | { type: 'failed'; id: number; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }

/** Lo que sabe el reconocedor. El proceso principal lo completa con la base. */
export interface RawResult {
  outcome: 'candidates' | 'no_card' | 'blurry' | 'glare' | 'unknown'
  /** Candidatas ordenadas de mejor a peor. Vacío salvo en 'candidates'. */
  candidates: { cardId: string; lang: CardLang; score: number }[]
  /** Diferencia de coseno entre la mejor y la primera carta distinta. */
  margin: number
  /** Las mejores comparten ilustración: hay que mirar lo impreso. */
  ambiguous: boolean
  thumbnail: string | null
  sharpness: number
  glare: number
  ms: number
}
