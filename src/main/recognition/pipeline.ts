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

export {
  EMBED_DIMS,
  EMBED_SIZE,
  createEmbedder,
  l2Normalize,
  type Embedder
} from './core/embed'
export { CARD_W, CARD_H, findCardQuad, frameQuad, orderCorners, warpCard, type Quad, type Point } from './core/geometry'
export { configureSharp, decodeToRgba, downscaleRgba, resizeRgba, toWebpDataUrl, type Rgba } from './core/image'
export { loadCv } from './core/cv'
export { measureQuality, type Quality } from './core/quality'
export { dot, emptyIndex, search, similarityBetween, type Hit, type RefIndex, type RefIndexEntry } from './core/match'
export { THRESHOLDS } from './core/thresholds'

/**
 * Identidad del modelo y su preproceso.
 *
 * Va escrita en cada fichero de vectores publicado y se compara al importarlo:
 * unos vectores calculados con otro modelo, u otro recorte, o otro tamaño de
 * entrada, no son comparables con los de la cámara. Al cambiar cualquiera de
 * esas tres cosas hay que subir este identificador y volver a publicar el
 * catálogo; las instalaciones antiguas seguirán usando los suyos hasta que se
 * actualicen, que es justo lo que se quiere.
 *
 *   dinov2s  modelo (DINOv2-small)
 *   u8       pesos cuantizados a entero de 8 bits
 *   224      lado de la entrada
 *   cls      se usa el token CLS como vector
 */
export const RECOG_MODEL_ID = 'dinov2s-u8-224-cls-v1'
