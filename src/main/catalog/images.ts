import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'
import type { GameId } from '@shared/types'
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
 * máquina.
 *
 * Cada juego tiene su origen y su forma de componer la URL, y por eso hay una
 * tabla y no una constante: TCGdex sirve la carta como una ruta con idioma y
 * calidad, y el CDN de Riot como un recurso con parámetros de transformación.
 * Cambiar de origen sigue siendo tocar una entrada de esta tabla.
 */
const TCGDEX_BASE = 'https://assets.tcgdex.net'
const RIOT_BASE = 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live'

export const IMAGE_SCHEME = 'cardimg'

export type ImageKind = 'card' | 'setAsset' | 'external'

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
 * URL externa aceptable para el arte de un sobre.
 *
 * Sólo https, y nada de direcciones internas. El contenido del catálogo llega
 * de la red, así que se trata como dato: aunque lo publiques tú, una URL de ahí
 * no debería poder apuntar a un servicio de la máquina o de la red local.
 */
const PRIVATE_HOST =
  /^(localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|::1$)/i

function externalUrl(value: string): URL | null {
  if (!/^https:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (PRIVATE_HOST.test(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

/**
 * De dónde saca cada juego sus imágenes.
 *
 * Devuelven la lista de intentos en orden de preferencia. Vacía significa «este
 * juego no publica eso»: Riot no tiene logos de set, y la vista de Sets ya sabe
 * dibujar el hueco con el nombre.
 */
interface GameImages {
  card(parts: string[], lang: string, quality: string): Candidate[]
  setAsset(parts: string[], lang: string): Candidate[]
}

/**
 * Para TCGdex se prueba el idioma pedido y después el inglés: hay sets que sólo
 * existen en un idioma —el Set Base nunca se imprimió en español— y sin este
 * respaldo ni su logo ni sus cartas aparecerían nunca.
 */
const langChain = (lang: string): string[] => (lang === 'en' ? ['en'] : [lang, 'en'])

/** Ancho y calidad con que el CDN de Riot sirve cada tamaño. */
const RIOT_QUALITY: Record<string, { w: number; q: number }> = {
  low: { w: 300, q: 80 },
  high: { w: 744, q: 85 }
}

const SOURCES: Record<GameId, GameImages> = {
  pokemon: {
    card: (parts, lang, quality) =>
      langChain(lang).map((l) => ({
        relative: path.join('cards', l, ...parts, `${quality}.webp`),
        url: `${TCGDEX_BASE}/${l}/${parts.join('/')}/${quality}.webp`
      })),
    // Los logos y símbolos de set NO llevan segmento de calidad.
    setAsset: (parts, lang) =>
      langChain(lang).map((l) => ({
        relative: path.join('sets', l, `${parts.join('/')}.webp`),
        url: `${TCGDEX_BASE}/${l}/${parts.join('/')}.webp`
      }))
  },

  riftbound: {
    /**
     * La ruta es el identificador del recurso en el CDN de Riot, y el tamaño va
     * en parámetros: `?w=300&fm=webp` devuelve 22 KB donde el PNG original pesa
     * 800. Riftbound sólo se imprime en inglés, así que el idioma no entra.
     */
    card: (parts, _lang, quality) => {
      const size = RIOT_QUALITY[quality]
      if (!size) return []
      const asset = parts.join('/')
      return [
        {
          relative: path.join('cards', 'riftbound', ...parts, `${quality}.webp`),
          url: `${RIOT_BASE}/${asset}?w=${size.w}&fm=webp&q=${size.q}`
        }
      ]
    },
    // Riot no publica logo ni símbolo de set en la galería.
    setAsset: () => []
  }
}

/**
 * Una imagen alojada fuera, dada como URL completa.
 *
 * El arte de sobres lo usa desde siempre: apunta a donde ya está la imagen en
 * vez de volver a publicarla. Las cartas y los logos de set lo admiten también,
 * y por un motivo concreto: un set recién salido existe antes de que el CDN de
 * su juego lo tenga, y sin esto se queda meses con el marcador de posición
 * aunque las ilustraciones estén disponibles en otro sitio.
 *
 * El catálogo puede pedir un tamaño u otro con `{pequeño|grande}`: se queda con
 * el primer término para la calidad baja y con el segundo para la alta, porque
 * cada CDN nombra sus tamaños a su manera —`small`/`large` en uno, `low`/`high`
 * en otro— y esa palabra es dato del catálogo, no del programa.
 *
 * Sigue sin publicarse ninguna imagen: esto es una ruta, y la descarga la hace
 * la máquina de cada usuario contra el origen, igual que el resto.
 */
function remoteCandidate(rawPath: string, quality: string, bucket: string): Candidate[] | null {
  const chosen = rawPath.replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_m, low, high) =>
    quality === 'high' ? high : low
  )
  const url = externalUrl(chosen)
  if (!url) return null
  const ext = path.extname(url.pathname).toLowerCase()
  const safeExt = /^\.(webp|png|jpe?g|gif|avif)$/.test(ext) ? ext : '.img'
  // El nombre en la caché sale de un hash de la URL: los nombres remotos traen
  // caracteres que no queremos escribir en disco. La calidad entra en el hash
  // porque dos tamaños de la misma carta son dos ficheros.
  const name = createHash('sha1').update(url.href).digest('hex').slice(0, 20)
  return [{ relative: path.join(bucket, 'ext', `${name}${safeExt}`), url: url.href }]
}

/** Lista de intentos, en orden. */
function candidates(
  kind: ImageKind,
  rawPath: string,
  lang: string,
  quality: string,
  game: GameId
): Candidate[] | null {
  // Una URL completa vale para cualquiera de los tres: el sobre que nunca tuvo
  // otro sitio donde estar, y la carta o el logo de un set que su CDN todavía
  // no sirve.
  if (/^https?:\/\//i.test(rawPath)) {
    return remoteCandidate(rawPath, quality, kind === 'external' ? 'packs' : 'cards')
  }

  const parts = safeSegments(rawPath)
  if (!parts) return null

  if (kind === 'external') {
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

  const source = SOURCES[game]
  return kind === 'card' ? source.card(parts, lang, quality) : source.setAsset(parts, lang)
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
  quality: 'low' | 'high' = 'low',
  game: GameId = 'pokemon'
): Promise<string | null> {
  const list = candidates(kind, rawPath, lang, quality, game)
  if (!list) {
    log.warn(`Ruta de imagen rechazada: ${game} ${kind} ${rawPath} (${lang}/${quality})`)
    return null
  }
  // Vacía no es un error: hay juegos que no publican según qué. Riot no tiene
  // logos de set, y la vista de Sets ya dibuja el hueco con el nombre.
  if (!list.length) return null

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
