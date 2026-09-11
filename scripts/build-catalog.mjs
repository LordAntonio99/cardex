#!/usr/bin/env node
/**
 * Genera el catálogo de Cardex a partir de TCGdex.
 *
 *   node scripts/build-catalog.mjs --sets sv03,sv01
 *   node scripts/build-catalog.mjs --sets sv03 --limit 24        (prueba rápida)
 *   node scripts/build-catalog.mjs --series sv                   (una serie entera)
 *
 * Produce, bajo --out (por defecto ./catalog):
 *
 *   manifest.json        índice con la versión y el sha256 de cada fichero
 *   sets/<setId>.json    set + cartas + sobres
 *
 * Eso es exactamente lo que la aplicación espera encontrar en la rama `catalog`
 * del repositorio.
 *
 * Sobre los sobres: TCGdex no publica arte de sobres ni productos (su endpoint
 * /boosters no existe y el campo no aparece en cartas ni en sets). Por eso el
 * script respeta un fichero de superposición por set en `packs/<setId>.json`:
 * lo que pongas ahí a mano sobrevive a cada regeneración.
 *
 * Nota legal: esto genera METADATOS. Las imágenes de carta no se descargan ni
 * se publican: el fichero guarda la ruta y la aplicación las trae de
 * assets.tcgdex.net a la máquina de cada usuario cuando hacen falta.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const API = 'https://api.tcgdex.net/v2'
const SCHEMA_VERSION = 1

/**
 * Idioma preferido para la ficha completa.
 *
 * No siempre se puede usar: el Set Base, por ejemplo, nunca se imprimió en
 * español, así que TCGdex tiene el set traducido pero con cero cartas. Por eso
 * el idioma de origen se decide por set, no de forma global (ver `sourceLang`).
 */
const PREFERRED = 'es'

// ── Argumentos ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { sets: [], series: null, langs: ['es', 'en'], limit: 0, out: 'catalog', concurrency: 8 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--sets') args.sets = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--series') args.series = next()
    else if (a === '--langs') args.langs = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--limit') args.limit = Number(next()) || 0
    else if (a === '--out') args.out = next()
    else if (a === '--concurrency') args.concurrency = Number(next()) || 8
    else if (a === '--help' || a === '-h') args.help = true
  }
  if (!args.langs.includes(PREFERRED)) args.langs.unshift(PREFERRED)
  return args
}

// ── Red ──────────────────────────────────────────────────────────────────────

const cache = new Map()

async function get(url, tries = 3) {
  if (cache.has(url)) return cache.get(url)
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Cardex catalog builder' },
        signal: AbortSignal.timeout(30_000)
      })
      if (res.status === 404) {
        cache.set(url, null)
        return null
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json()
      cache.set(url, json)
      return json
    } catch (e) {
      if (attempt === tries) {
        console.warn(`  ! ${url} -> ${e.message}`)
        cache.set(url, null)
        return null
      }
      // La API de TCGdex devuelve 503 cuando va cargada; se espera y se repite.
      await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  return null
}

/** Ejecuta `worker` sobre `items` con un tope de tareas en vuelo. */
async function pool(items, limit, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

// ── Transformación ───────────────────────────────────────────────────────────

/** 'https://assets.tcgdex.net/es/sv/sv03/125' -> 'sv/sv03/125' */
function imagePath(url) {
  if (!url) return null
  const m = /assets\.tcgdex\.net\/[a-z-]+\/(.+)$/.exec(url)
  return m ? m[1] : null
}

function variantList(v) {
  if (!v) return ['normal']
  const out = []
  if (v.normal) out.push('normal')
  if (v.holo) out.push('holo')
  if (v.reverse) out.push('reverse')
  if (v.firstEdition) out.push('first_ed')
  return out.length ? out : ['normal']
}

/**
 * Clave de orden del set. La fecha de salida ordena mucho mejor que el id, que
 * en TCGdex mezcla convenciones de varias épocas.
 */
function sortKey(releaseDate) {
  if (!releaseDate) return 0
  return Number(releaseDate.replaceAll('-', '')) || 0
}

/**
 * Etiqueta legible de una impresión: 'Holo · Shadowless · 1ª edición'.
 */
const SUBTYPE_LABEL = {
  unlimited: 'Unlimited',
  shadowless: 'Shadowless',
  'shadowless-red-cheek': 'Shadowless (mejilla roja)',
  '1999-2000-copyright': 'Copyright 1999-2000',
  'first-edition': '1ª edición'
}
const STAMP_LABEL = {
  '1st-edition': '1ª edición',
  'poketour-99': 'Poké Tour 99',
  'prerelease': 'Prerelease',
  'staff': 'Staff'
}
const KIND_LABEL = { normal: 'Normal', holo: 'Holo', reverse: 'Reverse' }

function printingLabel(v) {
  const parts = [KIND_LABEL[v.type] ?? v.type]
  if (v.subtype) parts.push(SUBTYPE_LABEL[v.subtype] ?? v.subtype)
  for (const s of v.stamp ?? []) parts.push(STAMP_LABEL[s] ?? s)
  return parts.join(' · ')
}

/**
 * Eje grueso al que pertenece una impresión.
 *
 * La 1ª edición manda sobre todo lo demás: es lo que separa un Charizard de
 * 590 € de uno de 3.500 €.
 */
function coarseVariant(v) {
  if ((v.stamp ?? []).includes('1st-edition')) return 'first_ed'
  if (v.type === 'holo') return 'holo'
  if (v.type === 'reverse') return 'reverse'
  return 'normal'
}

const cents = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : null)

/** Extrae los precios de una impresión, en céntimos enteros. */
function printingPrices(v) {
  const out = []
  const cm = v.pricing?.cardmarket
  if (cm && typeof cm.trend === 'number') {
    out.push({
      source: 'cardmarket',
      currency: cm.unit ?? 'EUR',
      lowCents: cents(cm.low),
      trendCents: cents(cm.trend),
      avg7Cents: cents(cm.avg7),
      avg30Cents: cents(cm.avg30),
      updatedAt: cm.updated ?? null
    })
  }
  const tp = v.pricing?.tcgplayer
  // TCGplayer agrupa por acabado (normal, holofoil, reverseHolofoil...).
  for (const [finish, data] of Object.entries(tp ?? {})) {
    if (!data || typeof data !== 'object' || typeof data.marketPrice !== 'number') continue
    out.push({
      source: 'tcgplayer',
      currency: tp.unit ?? 'USD',
      finish,
      lowCents: cents(data.lowPrice),
      trendCents: cents(data.marketPrice),
      avg7Cents: null,
      avg30Cents: null,
      updatedAt: tp.updated ?? null
    })
    break // basta con el primer acabado: el desglose fino no se usa todavía
  }
  return out
}

/**
 * Decide de qué idioma sacar la ficha completa de un set.
 *
 * Se queda con el primero que traiga cartas de verdad. Sin esto, un set que
 * nunca se imprimió en español (el Set Base, sin ir más lejos) saldría vacío.
 */
function sourceLang(heads, langs) {
  const ordered = [PREFERRED, ...langs].filter((l, i, a) => a.indexOf(l) === i)
  for (const lang of ordered) {
    if ((heads[lang]?.cards ?? []).length > 0) return lang
  }
  return null
}

async function buildSet(setId, langs, limit, concurrency) {
  // Cabecera del set en cada idioma.
  const heads = {}
  for (const lang of langs) {
    heads[lang] = await get(`${API}/${lang}/sets/${setId}`)
  }

  const source = sourceLang(heads, langs)
  const head = (source && heads[source]) || Object.values(heads).find(Boolean)
  if (!head) {
    console.warn(`  ! set ${setId} no encontrado`)
    return null
  }
  if (!source) {
    console.warn(`  ! set ${setId}: ningún idioma de ${langs.join('/')} tiene cartas`)
    return null
  }
  if (source !== PREFERRED) {
    console.log(`    (${setId} no existe en ${PREFERRED}; se toma la ficha de '${source}')`)
  }

  const names = {}
  for (const [lang, h] of Object.entries(heads)) if (h?.name) names[lang] = h.name

  let briefs = head.cards ?? []
  if (limit > 0) briefs = briefs.slice(0, limit)

  process.stdout.write(`  ${setId}: ${briefs.length} cartas `)

  const cards = await pool(briefs, concurrency, async (brief) => {
    const full = await get(`${API}/${source}/cards/${brief.id}`)
    if (!full) return null

    // El resto de idiomas aportan el nombre traducido y dicen en qué idiomas
    // existe realmente la impresión.
    const cardNames = {}
    const availableLangs = []
    let english = null
    for (const lang of langs) {
      const localized = lang === source ? full : await get(`${API}/${lang}/cards/${brief.id}`)
      if (lang === 'en') english = localized
      if (localized?.name) {
        cardNames[lang] = localized.name
        availableLangs.push(lang)
      }
    }

    // Impresiones concretas, con su precio. Aquí está lo que separa una carta
    // del Set Base unlimited de la misma en shadowless de 1ª edición: pueden ir
    // seis veces de diferencia.
    const printings = (full.variants_detailed ?? []).map((v, i) => ({
      id: v.variantId ?? `${full.id}-p${i}`,
      kind: v.type ?? 'normal',
      subtype: v.subtype ?? '',
      stamp: v.stamp ?? [],
      label: printingLabel(v),
      variant: coarseVariant(v),
      sortKey: i,
      prices: printingPrices(v)
    }))

    process.stdout.write('.')
    return {
      id: full.id,
      localId: full.localId,
      name: cardNames['en'] ?? full.name,
      names: cardNames,
      // La rareza se guarda en el idioma principal porque es lo que se enseña
      // en la ficha. No pasa nada: el clasificador de rareza del renderer
      // entiende tanto 'Rara Doble' como 'Double Rare'.
      rarity: full.rarity ?? null,
      // Los tipos, en cambio, TIENEN que ir en su forma canónica en inglés:
      // son la clave de la tabla de colores oklch de cada carta. Si se colara
      // 'Planta' en vez de 'Grass', el degradado se iría al color por defecto.
      category: english?.category ?? full.category ?? null,
      types: english?.types ?? full.types ?? [],
      hp: full.hp ?? null,
      illustrator: full.illustrator ?? null,
      imagePath: imagePath(full.image),
      variants: variantList(full.variants),
      langs: availableLangs,
      printings
    }
  })

  process.stdout.write('\n')

  return {
    set: {
      id: head.id,
      seriesId: head.serie?.id ?? 'unknown',
      seriesName: head.serie?.name ?? head.serie?.id ?? 'unknown',
      region: 'intl',
      code: head.abbreviation?.official ?? head.abbreviation?.short ?? null,
      name: names['en'] ?? head.name,
      names,
      releasedOn: head.releaseDate ?? null,
      // `official` son las cartas numeradas: es el denominador del porcentaje
      // de completado. `total` incluye secretas.
      totalOfficial: head.cardCount?.official ?? 0,
      totalAll: head.cardCount?.total ?? 0,
      logoPath: imagePath(head.logo),
      symbolPath: imagePath(head.symbol),
      sortKey: sortKey(head.releaseDate),
      sourceLang: source
    },
    cards: cards.filter(Boolean),
    packs: []
  }
}

// ── Principal ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || (!args.sets.length && !args.series)) {
    console.log(`
Uso:
  node scripts/build-catalog.mjs --sets sv03,sv01
  node scripts/build-catalog.mjs --series sv
  node scripts/build-catalog.mjs --sets sv03 --limit 24

Opciones:
  --sets a,b        sets a generar
  --series id       todos los sets de una serie
  --langs es,en     idiomas; la ficha completa sale del primero que tenga cartas
  --limit N         sólo las N primeras cartas de cada set (para pruebas)
  --out dir         directorio de salida (por defecto: catalog)
  --concurrency N   peticiones en paralelo (por defecto: 8)
`)
    process.exit(args.help ? 0 : 1)
  }

  let setIds = args.sets
  if (args.series) {
    const serie = await get(`${API}/en/series/${args.series}`)
    if (!serie) {
      console.error(`Serie ${args.series} no encontrada`)
      process.exit(1)
    }
    setIds = serie.sets.map((s) => s.id)
    console.log(`Serie ${args.series}: ${setIds.length} sets`)
  }

  const outDir = path.resolve(args.out)
  const setsDir = path.join(outDir, 'sets')
  const packsDir = path.join(outDir, 'packs')
  await mkdir(setsDir, { recursive: true })
  await mkdir(packsDir, { recursive: true })

  console.log(`Generando ${setIds.length} set(s) en ${outDir}`)

  const entries = []
  for (const setId of setIds) {
    const built = await buildSet(setId, args.langs, args.limit, args.concurrency)
    if (!built) continue

    // Superposición de sobres hecha a mano: TCGdex no los tiene, así que lo
    // que haya en packs/<setId>.json manda y sobrevive a la regeneración.
    const overlay = path.join(packsDir, `${setId}.json`)
    if (existsSync(overlay)) {
      try {
        const packs = JSON.parse(await readFile(overlay, 'utf8'))
        if (Array.isArray(packs)) built.packs = packs
        console.log(`    + ${packs.length} sobre(s) de packs/${setId}.json`)
      } catch (e) {
        console.warn(`    ! packs/${setId}.json ilegible: ${e.message}`)
      }
    }

    // Sin saltos de línea al final y con claves estables: así el sha256 sólo
    // cambia cuando cambia el contenido de verdad.
    const body = JSON.stringify(built)
    const file = `sets/${setId}.json`
    await writeFile(path.join(outDir, file), body, 'utf8')

    entries.push({
      id: setId,
      file,
      sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
      cardCount: built.cards.length
    })
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    // Versión por fecha: legible y ordenable.
    catalogVersion: new Date().toISOString().slice(0, 10).replaceAll('-', '.'),
    generatedAt: new Date().toISOString(),
    sets: entries
  }
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  const cards = entries.reduce((a, e) => a + e.cardCount, 0)
  console.log(`\nListo: ${entries.length} set(s), ${cards} cartas -> ${outDir}/manifest.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
