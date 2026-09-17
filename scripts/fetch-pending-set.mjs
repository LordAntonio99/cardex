#!/usr/bin/env node
/**
 * Congela un set que TCGdex todavía no sirve, leyéndolo de una rama sin
 * fusionar de `tcgdex/cards-database`.
 *
 *   node scripts/fetch-pending-set.mjs --set 30c \
 *     --repo KlausDerKleber/cards-database --ref feat/en-30c \
 *     --dir "data/Mega Evolution/30th Celebration" --series me
 *
 * Escribe `catalog-pending/<setId>.json` con la misma forma que produce
 * `build-catalog.mjs` (formato v2: el set declara su `game`), y ese fichero se
 * versiona en `main`.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Un set sale a la venta antes de que TCGdex lo publique en su API, pero los
 * datos ya están escritos: viven en una pull request del repositorio de datos.
 * Esto los toma de ahí y los deja cuajados en disco, de modo que:
 *
 *  - la generación del catálogo no depende de que esa rama siga viva ni de
 *    tener red contra GitHub cada vez que se regeneran setenta sets;
 *  - lo que se publica queda a la vista en el repositorio, revisable en un
 *    diff, en vez de salir de una llamada de red irrepetible.
 *
 * ── Lo que NO trae ──────────────────────────────────────────────────────────
 *
 * Precios e imágenes. Los precios de TCGdex se calculan en su servidor y no
 * están en los ficheros fuente. Las imágenes viven en assets.tcgdex.net, que
 * tampoco las tiene todavía: por eso `imagePath` apunta ya a la ruta definitiva
 * (`me/30c/001`), que hoy da 404 y la aplicación resuelve con el marcador de
 * posición. El día que TCGdex publique sus assets, las imágenes aparecen solas
 * sin tocar nada.
 *
 * ── La razón de acuñar los identificadores a mano ───────────────────────────
 *
 * `card_keys.card_id` de la colección del usuario apunta a estas cadenas. Si
 * publicáramos el set con los identificadores de otra fuente y luego llegara el
 * de TCGdex, cada carta que alguien hubiera marcado como suya se convertiría en
 * un huérfano. Por eso el identificador se compone igual que lo hará TCGdex
 * —`<setId>-<nombre del fichero>`, que es de donde sale su `localId`— y se
 * comprueba contra un set ya publicado antes de fiarse (ver `assertIdShape`).
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'

const GH_API = 'https://api.github.com'
const GH_RAW = 'https://raw.githubusercontent.com'
const TCGDEX = 'https://api.tcgdex.net/v2'
const UA = 'Cardex catalog builder'

// ── Argumentos ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { set: null, repo: null, ref: null, dir: null, series: null, out: 'catalog-pending', images: null, logo: null, symbol: null, names: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--set') args.set = next()
    else if (a === '--repo') args.repo = next()
    else if (a === '--ref') args.ref = next()
    else if (a === '--dir') args.dir = next()
    else if (a === '--series') args.series = next()
    else if (a === '--out') args.out = next()
    else if (a === '--images') args.images = next()
    else if (a === '--logo') args.logo = next()
    else if (a === '--symbol') args.symbol = next()
    else if (a === '--name') {
      const [lang, ...resto] = next().split('=')
      if (lang && resto.length) args.names[lang.trim()] = resto.join('=')
    } else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

// ── Red ──────────────────────────────────────────────────────────────────────

async function get(url, { json = true, tries = 5 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: json ? 'application/json' : 'text/plain', 'User-Agent': UA },
        signal: AbortSignal.timeout(30_000)
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return json ? await res.json() : await res.text()
    } catch (e) {
      if (attempt === tries) throw new Error(`${url} -> ${e.message}`)
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)))
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

// ── Lectura de los ficheros fuente ───────────────────────────────────────────

/**
 * Evalúa el literal de objeto de un fichero de datos de TCGdex.
 *
 * Son módulos TypeScript, pero su cuerpo es un literal estático: dos imports,
 * `const x: Tipo = { … }` y `export default x`. Se recortan las tres líneas de
 * envoltorio y se evalúa lo que queda.
 *
 * Se evalúa en un contexto de `node:vm` SIN globales —ni `require`, ni
 * `process`, ni `fetch`— porque el fichero viene de una bifurcación de terceros.
 * Es dato ajeno, y aquí se trata como tal: si algún día uno de esos ficheros
 * trajera algo que no fuese un literal, no tiene con qué hacer nada.
 */
function evalDataFile(src, what) {
  const body = src
    .replace(/^\s*import\s.*$/gm, '')
    .replace(/^\s*export\s+default\s.*$/gm, '')
    // `set: Set` y `serie: serie` son las únicas referencias a los imports que
    // acabamos de quitar, y no se necesitan: el set ya lo sabemos.
    .replace(/^\s*(set|serie)\s*:\s*\w+\s*,\s*$/gm, '')
    .replace(/const\s+\w+\s*:\s*\w+\s*=\s*/, 'RESULT = ')

  const context = vm.createContext(Object.create(null))
  try {
    vm.runInContext(body, context, { timeout: 2000, displayErrors: true })
  } catch (e) {
    throw new Error(`No se pudo leer ${what}: ${e.message}`)
  }
  const value = context.RESULT
  if (!value || typeof value !== 'object') throw new Error(`${what} no declara un objeto`)
  return value
}

// ── Transformación ───────────────────────────────────────────────────────────

/**
 * Variantes en la forma del catálogo.
 *
 * El formato fuente las da como lista de objetos (`[{ type: 'holo' }]`), no
 * como el mapa de banderas que devuelve la API. Es el mismo eje grueso con
 * otra ropa.
 */
function variantList(variants) {
  const out = []
  for (const v of variants ?? []) {
    const stamps = (v.stamp ?? []).map((s) => String(s).toLowerCase().trim().replace(/\s+/g, '-'))
    if (stamps.includes('1st-edition') || v.type === 'firstEdition') push(out, 'first_ed')
    else if (v.type === 'holo') push(out, 'holo')
    else if (v.type === 'reverse') push(out, 'reverse')
    else if (v.type === 'normal') push(out, 'normal')
  }
  return out.length ? out : ['normal']
}

const push = (arr, v) => {
  if (!arr.includes(v)) arr.push(v)
}

/**
 * Expande la plantilla de imagen de una carta.
 *
 * `{n}` es el número sin ceros a la izquierda, porque no todos los CDN los
 * escriben igual: TCGdex numera `001` y el de pokemontcg.io `1`. Los que no son
 * números —las Mew RGB de este set son `R`, `G` y `B`— pasan tal cual.
 *
 * `{pequeño|grande}` lo resuelve la aplicación, no esto: es la palabra que cada
 * CDN usa para cada tamaño, y viaja en el catálogo para no tener que enseñarle
 * al programa los nombres de nadie.
 */
function expandImage(template, localId) {
  const n = /^\d+$/.test(localId) ? String(Number(localId)) : localId
  return template.replaceAll('{n}', n).replaceAll('{localId}', localId)
}

function sortKey(releaseDate) {
  if (!releaseDate) return 0
  return Number(String(releaseDate).replaceAll('-', '')) || 0
}

/**
 * Comprueba que el identificador que vamos a acuñar se compone igual que los
 * que ya sirve TCGdex.
 *
 * Toda la seguridad de esta operación descansa en que `<setId>-<localId>`
 * coincida con lo que TCGdex publicará. En vez de darlo por supuesto, se mira
 * un set hermano ya publicado: si su primera carta no responde a esa forma, la
 * convención ha cambiado y más vale parar que publicar un set que dentro de dos
 * semanas dejará huérfana media colección.
 */
async function assertIdShape(seriesId, referenceSetId) {
  const head = await get(`${TCGDEX}/en/sets/${referenceSetId}`)
  if (!head?.cards?.length) {
    throw new Error(`No se pudo contrastar la convención de ids contra ${referenceSetId}`)
  }
  const card = head.cards[0]
  const esperado = `${referenceSetId}-${card.localId}`
  if (card.id !== esperado) {
    throw new Error(
      `TCGdex ya no compone los ids como <set>-<localId>: ${referenceSetId} da '${card.id}' ` +
        `y no '${esperado}'. Revisa la acuñación antes de publicar.`
    )
  }
  // El relleno con ceros importa tanto como la forma: '1' y '001' son
  // identificadores distintos y sólo uno casará con el de TCGdex.
  const padded = /^\d+$/.test(card.localId) && card.localId.length >= 3
  return { padded, referencia: `${card.id} (de ${referenceSetId})` }
}

// ── Principal ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || !args.set || !args.repo || !args.ref || !args.dir || !args.series) {
    console.log(`
Uso:
  node scripts/fetch-pending-set.mjs --set 30c \\
    --repo KlausDerKleber/cards-database --ref feat/en-30c \\
    --dir "data/Mega Evolution/30th Celebration" --series me

Opciones:
  --set id          identificador con el que se publicará el set (el de TCGdex)
  --repo owner/name repositorio de datos del que leer
  --ref rama        rama o commit
  --dir ruta        carpeta del set dentro del repositorio
  --series id       serie a la que pertenece (para la ruta de imagen)
  --out dir         dónde escribir (por defecto: catalog-pending)
  --images plantilla
                    URL de la ilustración, con {n} por el número sin ceros y
                    {pequeño|grande} por el nombre del tamaño en ese CDN. Sin
                    esto se apunta a la ruta de TCGdex, que llegará más tarde.
  --logo url        logo del set, si su CDN aún no lo tiene
  --symbol url      símbolo del set, igual
  --name es=Texto   nombre del set en un idioma que los datos fuente no traen
                    (repetible)

Ejemplo con ilustraciones ya disponibles en otro CDN:

  node scripts/fetch-pending-set.mjs --set 30c \\
    --repo KlausDerKleber/cards-database --ref feat/en-30c \\
    --dir "data/Mega Evolution/30th Celebration" --series me \\
    --images 'https://images.scrydex.com/pokemon/me55-{n}/{small|large}' \\
    --name 'es=Celebración 30.º Aniversario'
`)
    process.exit(args.help ? 0 : 1)
  }

  const { set: setId, repo, ref, dir, series: seriesId } = args

  console.log(`Set ${setId} <- ${repo}@${ref}`)
  console.log(`  ${dir}`)

  // ── La convención de identificadores, contrastada contra un set hermano ───
  const forma = await assertIdShape(seriesId, 'me05')
  console.log(`  Convención de ids confirmada: ${forma.referencia}`)
  if (!forma.padded) {
    console.warn('  ! El set de referencia no usa localId con ceros a la izquierda; revísalo')
  }

  // ── Ficha del set ─────────────────────────────────────────────────────────
  const rawBase = `${GH_RAW}/${repo}/${ref}/${dir.split('/').map(encodeURIComponent).join('/')}`
  const setFileUrl = `${GH_RAW}/${repo}/${ref}/${dir.split('/').map(encodeURIComponent).join('/')}.ts`
  const setSrc = await get(setFileUrl, { json: false })
  if (!setSrc) throw new Error(`No existe la ficha del set en ${setFileUrl}`)
  const setDef = evalDataFile(setSrc, `${dir}.ts`)

  if (setDef.id !== setId) {
    throw new Error(
      `La ficha declara el set '${setDef.id}' y se pidió '${setId}'. ` +
        `Publicar con un id distinto del que usará TCGdex dejaría huérfana la colección.`
    )
  }

  // El nombre de la serie sale de TCGdex para que case exactamente con el de
  // los sets hermanos ya publicados: la interfaz agrupa por ese texto.
  const serie = await get(`${TCGDEX}/es/series/${seriesId}`)
  const seriesName = serie?.name ?? seriesId

  // ── Cartas ────────────────────────────────────────────────────────────────
  const listUrl = `${GH_API}/repos/${repo}/contents/${dir.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
  const listado = await get(listUrl)
  if (!Array.isArray(listado)) throw new Error(`No se pudo listar ${dir}`)

  const localIds = listado
    .filter((f) => f.type === 'file' && f.name.endsWith('.ts'))
    .map((f) => f.name.replace(/\.ts$/, ''))

  console.log(`  ${localIds.length} carta(s) que leer`)

  const cards = await pool(localIds, 8, async (localId) => {
    const src = await get(`${rawBase}/${encodeURIComponent(localId)}.ts`, { json: false })
    if (!src) {
      console.warn(`  ! ${localId}.ts no se pudo leer`)
      return null
    }
    const c = evalDataFile(src, `${localId}.ts`)
    const name = c.name?.en ?? c.name?.es ?? null
    if (!name) {
      console.warn(`  ! ${localId}.ts sin nombre, se descarta`)
      return null
    }
    process.stdout.write('.')
    return {
      id: `${setId}-${localId}`,
      localId,
      name,
      names: { en: name },
      rarity: c.rarity ?? null,
      category: c.category ?? null,
      // Los tipos van SIEMPRE en su forma canónica en inglés: son la clave de
      // la tabla de colores del renderer. El formato fuente ya los guarda así.
      types: c.types ?? [],
      hp: typeof c.hp === 'number' ? c.hp : null,
      illustrator: c.illustrator ?? null,
      // Sin --images, la ruta definitiva de TCGdex, que hoy da 404 a propósito y
      // se encenderá sola cuando su CDN tenga el set. Con --images, una URL
      // completa a donde las ilustraciones ya estén.
      imagePath: args.images
        ? expandImage(args.images, localId)
        : `${seriesId}/${setId}/${localId}`,
      variants: variantList(c.variants),
      langs: ['en'],
      // Sin precios: los de TCGdex se calculan en su servidor y no están en los
      // ficheros fuente. Llegarán con la primera regeneración contra la API.
      printings: []
    }
  })

  process.stdout.write('\n')

  const limpias = cards.filter(Boolean)
  const oficiales = setDef.cardCount?.official ?? 0
  if (limpias.length !== localIds.length) {
    console.warn(`  ! ${localIds.length - limpias.length} carta(s) se quedaron fuera`)
  }

  const doc = {
    set: {
      id: setId,
      // El formato v2 pide que cada set diga de qué juego es. Sin esto entraría
      // como Pokémon igualmente, pero por omisión y no por haberlo dicho.
      game: 'pokemon',
      seriesId,
      seriesName,
      region: 'intl',
      code: setDef.abbreviations?.official ?? setDef.abbreviation?.official ?? null,
      name: setDef.name?.en ?? setId,
      // Los datos fuente sólo traen el inglés mientras el set es nuevo. El
      // nombre en otros idiomas, si se sabe, entra por --name es=…
      names: { ...(setDef.name ?? {}), ...args.names },
      releasedOn: setDef.releaseDate ?? null,
      totalOfficial: oficiales,
      totalAll: limpias.length,
      logoPath: args.logo ?? `${seriesId}/${setId}/logo`,
      symbolPath: args.symbol ?? `${seriesId}/${setId}/symbol`,
      sortKey: sortKey(setDef.releaseDate),
      sourceLang: 'en',
      // Deja constancia de que esto no salió de la API, y de dónde salió.
      pendingSource: { repo, ref, dir, fetchedAt: new Date().toISOString() }
    },
    cards: limpias,
    packs: []
  }

  const outDir = path.resolve(args.out)
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `${setId}.json`)
  await writeFile(file, JSON.stringify(doc, null, 2), 'utf8')

  console.log(`\n${setId}: ${limpias.length} cartas (${oficiales} oficiales) -> ${path.relative(process.cwd(), file)}`)
  console.log(`  ${doc.set.name}  ·  ${doc.set.releasedOn}  ·  código ${doc.set.code ?? '—'}`)
  const rarezas = {}
  for (const c of limpias) rarezas[c.rarity ?? '(sin rareza)'] = (rarezas[c.rarity ?? '(sin rareza)'] ?? 0) + 1
  for (const k of Object.keys(rarezas).sort()) console.log(`    ${String(rarezas[k]).padStart(3)}  ${k}`)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
