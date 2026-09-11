import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'
import { imagesDir } from '../db/connection'
import { getDb } from '../db'
import { log } from '../log'
import { getSettings } from '../settings'
import { catalogBase } from './sync'

/**
 * Caché local de imágenes.
 *
 * Las imágenes NO se empaquetan nunca en el instalador: son propiedad de sus
 * titulares. Se descargan bajo demanda a userData, de modo que el instalable no
 * contiene material ajeno y la caché es contenido que genera cada usuario en su
 * máquina. Si algún día hay que cambiar de origen, es una línea.
 */
const ASSET_BASE = 'https://assets.tcgdex.net'

export const IMAGE_SCHEME = 'cardimg'

export type ImageKind = 'card' | 'setAsset' | 'packAsset'

/** Sólo estos caracteres en las rutas: nada de '..' ni rutas absolutas. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

function safeSegments(value: string): string[] | null {
  const parts = value.split('/').filter(Boolean)
  if (!parts.length || !parts.every((p) => SAFE_SEGMENT.test(p) && p !== '..' && p !== '.')) {
    return null
  }
  return parts
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

interface Candidate {
  /** Ruta dentro de la caché local. */
  relative: string
  /** De dónde se baja. */
  url: string
}

/**
 * Lista de intentos, en orden.
 *
 * Para las imágenes de TCGdex se prueba el idioma pedido y después el inglés:
 * hay sets que sólo existen en un idioma —el Set Base nunca se imprimió en
 * español— y sin este respaldo su logo no aparecería nunca.
 */
function candidates(
  kind: ImageKind,
  rawPath: string,
  lang: string,
  quality: string
): Candidate[] | null {
  const parts = safeSegments(rawPath)
  if (!parts) return null

  if (kind === 'packAsset') {
    // El arte de sobres viene del catálogo publicado, no de TCGdex, y no tiene
    // idioma: la ruta ya trae su extensión.
    return [
      {
        relative: path.join('packs', ...parts),
        url: `${catalogBase()}/${parts.join('/')}`
      }
    ]
  }

  if (!SAFE_SEGMENT.test(lang) || !SAFE_SEGMENT.test(quality)) return null

  const langs = lang === 'en' ? ['en'] : [lang, 'en']
  return langs.map((l) =>
    kind === 'card'
      ? {
          relative: path.join('cards', l, ...parts, `${quality}.webp`),
          url: `${ASSET_BASE}/${l}/${parts.join('/')}/${quality}.webp`
        }
      : {
          // Los logos y símbolos de set NO llevan segmento de calidad.
          relative: path.join('sets', l, `${parts.join('/')}.webp`),
          url: `${ASSET_BASE}/${l}/${parts.join('/')}.webp`
        }
  )
}

const localUrl = (relative: string): string =>
  `${IMAGE_SCHEME}://local/${relative.split(path.sep).join('/')}`

/**
 * Devuelve una URL que el renderer puede poner en un <img>, descargando la
 * imagen si todavía no está en la caché. `null` si no se puede.
 */
export async function resolve(
  kind: ImageKind,
  rawPath: string,
  lang = 'en',
  quality: 'low' | 'high' = 'low'
): Promise<string | null> {
  const list = candidates(kind, rawPath, lang, quality)
  if (!list) {
    log.warn(`Ruta de imagen rechazada: ${kind} ${rawPath} (${lang}/${quality})`)
    return null
  }

  // Si alguna ya está en disco, se sirve sin tocar la red.
  for (const c of list) {
    const abs = absoluteFor(c.relative)
    if (abs && existsSync(abs)) return localUrl(c.relative)
  }

  if (!getSettings().downloadImages) return null

  for (const c of list) {
    const abs = absoluteFor(c.relative)
    if (!abs) continue
    try {
      const res = await fetch(c.url, {
        headers: { 'User-Agent': 'Cardex' },
        signal: AbortSignal.timeout(20_000)
      })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      mkdirSync(path.dirname(abs), { recursive: true })
      await writeFile(abs, buf)
      touch(c.relative, buf.byteLength)
      return localUrl(c.relative)
    } catch (e) {
      log.warn(`No se ha podido descargar ${c.url}: ${String(e)}`)
    }
  }

  return null
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

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif'
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
      const type = CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000' }
      })
    } catch (e) {
      log.warn(`Fallo sirviendo imagen: ${String(e)}`)
      return new Response(null, { status: 500 })
    }
  })
}
