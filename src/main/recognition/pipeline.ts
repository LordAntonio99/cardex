/**
 * Núcleo de reconocimiento. Node puro: aquí no entra `electron`.
 *
 * Esta restricción no es estética. El módulo lo cargan tres sitios distintos:
 *
 *  - el proceso reconocedor (`process.ts`), donde `require('electron')` sólo
 *    ofrece un puñado de cosas y `app` no es una de ellas;
 *  - el generador de catálogo (`scripts/build-catalog.mjs`), que calcula los
 *    vectores de referencia y corre en Node a secas;
 *  - el evaluador (`scripts/recog-eval.mjs`), que calibra los umbrales.
 *
 * Que los tres compartan ESTE código es lo que garantiza que la referencia y la
 * captura pasen por exactamente el mismo preproceso. Si se duplicara, el día
 * que alguien cambie un filtro de reescalado en un sitio y no en el otro, el
 * reconocimiento se degradaría en silencio y sin forma de notarlo.
 */

export { EMBED_SIZE, createEmbedder, l2Normalize, type Embedder } from './core/embed'
// El contrato (identificador de modelo, dimensiones, formato del fichero de
// vectores) vive aparte para que el proceso principal pueda importarlo sin
// arrastrar sharp ni OpenCV. Se reexporta aquí por comodidad de los scripts.
export {
  EMBED_DIMS,
  RECOG_MODEL_ID,
  decodeSidecar,
  encodeSidecar,
  type Sidecar,
  type SidecarEntry
} from './format'
export { CARD_W, CARD_H, findCardQuad, frameQuad, orderCorners, warpCard, type Quad, type Point } from './core/geometry'
export {
  configureSharp,
  decodeToRgba,
  downscaleRgba,
  resizeRgba,
  rotate180,
  toWebpDataUrl,
  type Rgba
} from './core/image'
export { loadCv } from './core/cv'
export { measureQuality, type Quality } from './core/quality'
export {
  dot,
  emptyIndex,
  matchCard,
  search,
  similarityBetween,
  type Hit,
  type MatchResult,
  type RefIndex,
  type RefIndexEntry
} from './core/match'
export { THRESHOLDS } from './core/thresholds'
