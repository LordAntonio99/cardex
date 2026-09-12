/**
 * Encontrar la carta en el fotograma y enderezarla.
 *
 * Todo lo que viene después (huella visual y OCR) da por hecho una carta
 * rectificada de 600x825, exactamente el tamaño de las imágenes de referencia
 * de TCGdex. Si esta fase se equivoca, no hay modelo que lo arregle.
 *
 * Se busca sobre una copia reducida (barato) y se recorta del fotograma
 * completo (nítido): escalar las esquinas cuesta una multiplicación y conserva
 * toda la resolución justo donde hace falta, que es el número de coleccionista.
 */

import { loadCv, usingMats, type Cv } from './cv'
import { downscaleRgba, type Rgba } from './image'

/** Tamaño canónico de la carta rectificada: el de `high.webp` de TCGdex. */
export const CARD_W = 600
export const CARD_H = 825

/** 63x88 mm. Las proporciones de la imagen de referencia son 0,727. */
const ASPECT = CARD_W / CARD_H
const ASPECT_TOLERANCE = 0.1

/** Resolución de trabajo para buscar el contorno. */
const WORK_MAX = 1280

export interface Point {
  x: number
  y: number
}
/** Esquinas en orden: superior izquierda, superior derecha, inferior derecha, inferior izquierda. */
export type Quad = [Point, Point, Point, Point]

/**
 * Ordena cuatro puntos sueltos como un cuadrilátero en sentido horario.
 *
 * La suma x+y separa las esquinas de una diagonal y la diferencia y-x las de la
 * otra. Si el resultado sale apaisado, se rota un paso: una carta siempre se
 * escanea en vertical, y así el reverso de la lógica no tiene que dudar.
 */
export function orderCorners(points: Point[]): Quad {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y))
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x))
  let quad: Quad = [bySum[0]!, byDiff[0]!, bySum[3]!, byDiff[3]!]

  const width = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y)
  const height = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y)
  if (width > height) quad = [quad[1], quad[2], quad[3], quad[0]]
  return quad
}

/** Relación lado corto / lado largo del cuadrilátero, promediando lados opuestos. */
function aspectOf(q: Quad): number {
  const top = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y)
  const bottom = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)
  const left = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y)
  const right = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)
  const w = (top + bottom) / 2
  const h = (left + right) / 2
  return h === 0 ? 0 : w / h
}

function polygonArea(q: Quad): number {
  let area = 0
  for (let i = 0; i < 4; i += 1) {
    const a = q[i]!
    const b = q[(i + 1) % 4]!
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

/**
 * Busca el contorno de la carta.
 *
 * Dos pasadas con umbrales de Canny distintos: la primera es la normal, la
 * segunda perdona bordes flojos (carta oscura sobre tapete oscuro, luz pobre).
 * Se queda con el candidato de mayor área que cumpla forma de carta.
 */
export async function findCardQuad(frame: Rgba): Promise<Quad | null> {
  const cv = await loadCv()
  const { img: small, scale } = await downscaleRgba(frame, WORK_MAX)

  type Candidate = { quad: Quad; area: number }
  const found = usingMats<Candidate | null>((keep) => {
    const src = keep(matFromRgba(cv, small))
    const gray = keep(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    const blurred = keep(new cv.Mat())
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)

    const frameArea = small.width * small.height
    let best: Candidate | null = null

    for (const [lo, hi] of [
      [75, 200],
      [25, 90]
    ] as const) {
      const edges = keep(new cv.Mat())
      cv.Canny(blurred, edges, lo, hi)
      // Cierra los huecos del filo: una carta con el borde interrumpido no da
      // un contorno cerrado, y sin contorno cerrado no hay cuadrilátero.
      const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)))
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel)

      const contours = keep(new cv.MatVector())
      const hierarchy = keep(new cv.Mat())
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

      for (let i = 0; i < contours.size(); i += 1) {
        const contour = keep(contours.get(i))
        const area = cv.contourArea(contour, false)
        // Ni motas ni el fotograma entero.
        if (area < frameArea * 0.04 || area > frameArea * 0.98) continue

        const hull = keep(new cv.Mat())
        cv.convexHull(contour, hull, false, true)
        const approx = keep(new cv.Mat())
        // 2 % del perímetro: suficiente para que las esquinas redondeadas del
        // troquel colapsen en un vértice y no en un arco de puntos.
        cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true)
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue

        const pts: Point[] = []
        for (let p = 0; p < 4; p += 1) {
          pts.push({ x: approx.intAt(p, 0), y: approx.intAt(p, 1) })
        }
        const quad = orderCorners(pts)

        if (Math.abs(aspectOf(quad) - ASPECT) > ASPECT_TOLERANCE) continue
        // Área del polígono frente a la del contorno: descarta formas con
        // mordiscos, que es lo que produce una mano tapando un lado.
        if (polygonArea(quad) < area * 0.9) continue

        if (!best || area > best.area) best = { quad, area }
      }

      if (best) break
    }

    return best
  })

  if (!found) return null
  // De la copia reducida al fotograma original.
  return found.quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad
}

/** Rectángulo completo del fotograma, para cuando no se encuentra contorno. */
export function frameQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ]
}

/** Crea un `cv.Mat` RGBA copiando el mapa de bits al montón del WASM. */
export function matFromRgba(cv: Cv, img: Rgba): InstanceType<Cv['Mat']> {
  const mat = new cv.Mat(img.height, img.width, cv.CV_8UC4)
  mat.data.set(img.data)
  return mat
}

/** Extrae `cv.Mat` RGBA a un mapa de bits propio. */
export function rgbaFromMat(mat: { rows: number; cols: number; data: Uint8Array }): Rgba {
  return { data: new Uint8Array(mat.data), width: mat.cols, height: mat.rows }
}

/** Endereza el cuadrilátero a una carta de 600x825. */
export async function warpCard(frame: Rgba, quad: Quad): Promise<Rgba> {
  const cv = await loadCv()
  return usingMats((keep) => {
    const src = keep(matFromRgba(cv, frame))
    const dst = keep(new cv.Mat())
    const from = keep(
      cv.matFromArray(4, 1, cv.CV_32FC2, [
        quad[0].x, quad[0].y,
        quad[1].x, quad[1].y,
        quad[2].x, quad[2].y,
        quad[3].x, quad[3].y
      ])
    )
    const to = keep(
      cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CARD_W, 0, CARD_W, CARD_H, 0, CARD_H])
    )
    const transform = keep(cv.getPerspectiveTransform(from, to))
    cv.warpPerspective(
      src,
      dst,
      transform,
      new cv.Size(CARD_W, CARD_H),
      cv.INTER_LINEAR,
      cv.BORDER_REPLICATE,
      new cv.Scalar()
    )
    return rgbaFromMat(dst)
  })
}
