/**
 * ¿Vale esta captura?
 *
 * Reconocer una foto movida o velada por un reflejo no da un error: da una
 * carta equivocada con buena pinta, que es mucho peor. Se mide antes de gastar
 * la inferencia y se responde al usuario con la causa concreta, para que sepa
 * qué corregir.
 */

import { loadCv, usingMats } from './cv'
import { matFromRgba } from './geometry'
import type { Rgba } from './image'

export interface Quality {
  /** Varianza del laplaciano: cuanto más alta, más definida está la imagen. */
  sharpness: number
  /** Fracción de píxeles casi blancos: el brillo de una holográfica. */
  glare: number
}

/** Sobre la carta ya rectificada; los umbrales viven en `thresholds.ts`. */
export async function measureQuality(card: Rgba): Promise<Quality> {
  const cv = await loadCv()
  return usingMats((keep) => {
    const src = keep(matFromRgba(cv, card))
    const gray = keep(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    const lap = keep(new cv.Mat())
    cv.Laplacian(gray, lap, cv.CV_64F)
    const mean = keep(new cv.Mat())
    const stddev = keep(new cv.Mat())
    cv.meanStdDev(lap, mean, stddev)
    const sd = stddev.doubleAt(0, 0)

    let saturated = 0
    const px = gray.data
    for (let i = 0; i < px.length; i += 1) if (px[i]! >= 250) saturated += 1

    return { sharpness: sd * sd, glare: px.length ? saturated / px.length : 0 }
  })
}
