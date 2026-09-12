/**
 * Búsqueda del vecino más cercano en el catálogo.
 *
 * Sin índice aproximado y sin dependencias: con los vectores normalizados, el
 * coseno es un producto escalar, y recorrer el catálogo entero son 384
 * multiplicaciones por referencia. Para las 20.000 cartas que llegará a tener
 * el catálogo (unas 40.000 referencias contando idiomas) eso son 15 millones de
 * operaciones: milisegundos. Un índice aproximado añadiría una dependencia, un
 * fichero que mantener sincronizado y la posibilidad de perder el verdadero
 * mejor resultado; a esta escala no compra nada.
 */

import { EMBED_DIMS } from '../format'

export interface RefIndexEntry {
  cardId: string
  lang: string
}

/** Matriz de referencias: `vectors` son `entries.length` vectores contiguos. */
export interface RefIndex {
  entries: RefIndexEntry[]
  vectors: Float32Array
}

export interface Hit {
  cardId: string
  lang: string
  /** Coseno con la captura, en [-1, 1]. */
  score: number
  /** Posición en la matriz, para poder comparar referencias entre sí. */
  row: number
}

export function emptyIndex(): RefIndex {
  return { entries: [], vectors: new Float32Array(0) }
}

/** Coseno entre dos vectores ya normalizados. */
export function dot(a: Float32Array, b: Float32Array, offsetB = 0): number {
  let sum = 0
  for (let i = 0; i < EMBED_DIMS; i += 1) sum += a[i]! * b[offsetB + i]!
  return sum
}

/**
 * Mejores `k` cartas.
 *
 * Se queda con el máximo por carta, no por referencia: una carta con imagen en
 * español y en inglés ocupa dos filas, y devolverla dos veces llenaría el
 * selector de duplicados en vez de alternativas. El idioma que gana es el que
 * mejor casa, que es además la mejor pista de en qué idioma está la carta
 * física.
 */
export function search(index: RefIndex, query: Float32Array, k: number): Hit[] {
  const best = new Map<string, Hit>()
  for (let row = 0; row < index.entries.length; row += 1) {
    const score = dot(query, index.vectors, row * EMBED_DIMS)
    const entry = index.entries[row]!
    const previous = best.get(entry.cardId)
    if (!previous || score > previous.score) {
      best.set(entry.cardId, { cardId: entry.cardId, lang: entry.lang, score, row })
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k)
}

/** Coseno entre dos referencias del índice: mide si comparten ilustración. */
export function similarityBetween(index: RefIndex, rowA: number, rowB: number): number {
  let sum = 0
  const offsetA = rowA * EMBED_DIMS
  const offsetB = rowB * EMBED_DIMS
  for (let i = 0; i < EMBED_DIMS; i += 1) {
    sum += index.vectors[offsetA + i]! * index.vectors[offsetB + i]!
  }
  return sum
}
