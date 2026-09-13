/**
 * Decodificación y salida de imagen, con sharp (libvips).
 *
 * OpenCV.js se compila sin `imgcodecs`: no sabe leer un JPEG ni escribir un
 * WebP. La división es limpia y conviene: sharp hace los píxeles (decodificar,
 * redimensionar con buen filtro, codificar) y OpenCV la geometría.
 */

import sharp from 'sharp'

/** Mapa de bits en crudo, RGBA sin premultiplicar, tal y como lo quiere `cv.Mat`. */
export interface Rgba {
  data: Uint8Array
  width: number
  height: number
}

/**
 * Configura sharp para un proceso de vida larga.
 *
 * La caché de libvips guarda operaciones y ficheros recientes: en un servidor
 * de imágenes es una victoria, aquí sólo es memoria retenida entre escaneos.
 * La concurrencia se limita porque el paralelismo real lo queremos en la
 * inferencia, no compitiendo con ella.
 */
export function configureSharp(): void {
  sharp.cache(false)
  sharp.concurrency(1)
}

/** Decodifica cualquier formato que entienda libvips a RGBA plano. */
export async function decodeToRgba(input: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

/** Reduce el lado mayor a `max` píxeles. Devuelve la imagen tal cual si ya cabe. */
export async function downscaleRgba(img: Rgba, max: number): Promise<{ img: Rgba; scale: number }> {
  const longest = Math.max(img.width, img.height)
  if (longest <= max) return { img, scale: 1 }
  const scale = max / longest
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const { data } = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    img: { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height },
    scale: width / img.width
  }
}

/** Redimensiona a un tamaño exacto, deformando si hace falta. */
export async function resizeRgba(img: Rgba, width: number, height: number): Promise<Rgba> {
  const { data } = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height }
}

/** Miniatura WebP lista para `<img src>` en el renderer. */
export async function toWebpDataUrl(img: Rgba, width: number, quality = 72): Promise<string> {
  const height = Math.round((width * img.height) / img.width)
  const buf = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .webp({ quality })
    .toBuffer()
  return `data:image/webp;base64,${buf.toString('base64')}`
}

/**
 * Gira el mapa de bits media vuelta.
 *
 * Al pasar una pila de cartas es fácil que alguna caiga boca abajo. El
 * cuadrilátero sale igual de válido —una carta del revés sigue siendo un
 * rectángulo con las proporciones correctas—, pero su huella no se parece a
 * nada del catálogo. Probar las dos orientaciones cuesta una inferencia más y
 * ahorra un «no la reconozco» que despista.
 */
export function rotate180(img: Rgba): Rgba {
  const { data, width, height } = img
  const out = new Uint8Array(data.length)
  const pixels = width * height
  for (let i = 0; i < pixels; i += 1) {
    const from = i * 4
    const to = (pixels - 1 - i) * 4
    out[to] = data[from]!
    out[to + 1] = data[from + 1]!
    out[to + 2] = data[from + 2]!
    out[to + 3] = data[from + 3]!
  }
  return { data: out, width, height }
}
