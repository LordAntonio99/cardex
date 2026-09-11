import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'
import { imagesDir } from '../db/connection'
import { getDb } from '../db'
import { log } from '../log'
import { getSettings } from '../settings'

/**
 * Caché local de imágenes de carta.
 *
 * Las imágenes NO se empaquetan nunca en el instalador: son propiedad de sus
 * titulares. Se descargan bajo demanda a userData, de modo que el instalable no
 * contiene material ajeno y la caché es contenido que genera cada usuario en su
 * máquina. Si algún día hay que cambiar de origen, es una línea.
 */
const ASSET_BASE = 'https://assets.tcgdex.net'

export const IMAGE_SCHEME = 'cardimg'

/** Sólo estos caracteres en las rutas: nada de '..' ni rutas absolutas. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

function safeRelative(imagePath: string, lang: string, quality: string): string | null {
  if (!SAFE_SEGMENT.test(lang) || !SAFE_SEGMENT.test(quality)) return null
  const parts = imagePath.split('/').filter(Boolean)
  if (!parts.length || !parts.every((p) => SAFE_SEGMENT.test(p) && p !== '..')) return null
  return path.join(lang, ...parts, `${quality}.webp`)
}

function absoluteFor(relative: string): string | null {
  const root = imagesDir()
  const abs = path.resolve(root, relative)
  // Comprobación de contención: nunca servir fuera de la carpeta de imágenes.
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return abs
}

function touch(relative: string, bytes: number): void {
  const now = Date.now()
  try {
    getDb()
      .prepare(
        `INSERT INTO image_cache (path, bytes, fetched_at, last_used_at)
         VALUES (@path, @bytes, @now, @now)
         ON CONFLICT(path) DO UPDATE SET last_used_at = @now`
      )
      .run({ path: relative, bytes, now })
  } catch {
    // La contabilidad de la caché no vale una excepción hacia arriba.
  }
}

/**
 * Devuelve una URL que el renderer puede poner en un <img>, descargando la
 * imagen si todavía no está en la caché. `null` si no se puede.
 */
export async function resolve(
  imagePath: string,
  lang: string,
  quality: 'low' | 'high'
): Promise<string | null> {
  const relative = safeRelative(imagePath, lang, quality)
  if (!relative) {
    log.warn(`Ruta de imagen rechazada: ${imagePath} (${lang}/${quality})`)
    return null
  }

  const abs = absoluteFor(relative)
  if (!abs) return null

  const url = `${IMAGE_SCHEME}://local/${relative.split(path.sep).join('/')}`
  if (existsSync(abs)) return url

  if (!getSettings().downloadImages) return null

  try {
    const remote = `${ASSET_BASE}/${lang}/${imagePath}/${quality}.webp`
    const res = await fetch(remote, {
      headers: { 'User-Agent': 'Cardex' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) {
      log.warn(`Imagen no disponible (${res.status}): ${remote}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    mkdirSync(path.dirname(abs), { recursive: true })
    await writeFile(abs, buf)
    touch(relative, buf.byteLength)
    return url
  } catch (e) {
    log.warn(`No se ha podido descargar la imagen ${imagePath}: ${String(e)}`)
    return null
  }
}

/**
 * Hay que declarar el esquema como privilegiado ANTES de que la aplicación
 * esté lista, o el renderer lo trata como no seguro y ni siquiera lo pide.
 */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false }
    }
  ])
}

/** Sirve la caché. Se llama con la aplicación ya lista. */
export function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = absoluteFor(relative)
      if (!abs || !existsSync(abs)) return new Response(null, { status: 404 })
      const data = await readFile(abs)
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000' }
      })
    } catch (e) {
      log.warn(`Fallo sirviendo imagen: ${String(e)}`)
      return new Response(null, { status: 500 })
    }
  })
}
