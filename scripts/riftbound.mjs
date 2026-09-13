/**
 * Riftbound (el JCC de League of Legends) para el catálogo de Cardex.
 *
 * Devuelve exactamente la misma forma que el constructor de TCGdex —
 * `{ set, cards, packs }`— para que `build-catalog.mjs` no tenga que saber de
 * qué juego viene cada set: lo escribe igual y lo mete en el mismo manifiesto.
 *
 * Hacen falta TRES orígenes porque no hay ninguno que lo traiga todo:
 *
 *  1. La **galería oficial de Riot** pone las cartas y las ilustraciones. Es una
 *     aplicación Next.js: se saca el `buildId` de la página y con él se pide el
 *     JSON de datos, que trae el listado entero ya resuelto. No hay API
 *     publicada, así que el `buildId` se lee en cada ejecución en vez de
 *     fijarlo: cuando Riot despliega, cambia.
 *  2. **TCGCSV**, espejo diario de TCGplayer, pone los precios y el arte de los
 *     productos sellados. Sin clave y sin registro.
 *  3. El **BCE** pone el tipo de cambio, porque TCGplayer cotiza en dólares y
 *     Cardex lleva los euros por dentro. La conversión queda anotada en cada
 *     precio publicado (`sourceCurrency`, `fxRate`, `fxOn`) para que la cifra se
 *     pueda auditar y no se confunda con un dato de Cardmarket.
 *
 * Igual que con Pokémon, aquí se generan METADATOS: las ilustraciones no se
 * descargan ni se publican, se guarda la ruta y cada usuario se la baja.
 */

const GALLERY = 'https://riftbound.leagueoflegends.com'
const TCGCSV = 'https://tcgcsv.com/tcgplayer'
/** Riftbound: League of Legends Trading Card Game, en el catálogo de TCGplayer. */
const TCG_CATEGORY = 89
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

/**
 * Prefijo de los identificadores.
 *
 * `card_keys.card_id` de la colección del usuario no tiene clave foránea al
 * catálogo —SQLite no las admite entre bases adjuntas, y esa limitación es la
 * garantía de que reimportar no puede tocar la colección—. El precio es que
 * nadie vigila que dos juegos no usen el mismo identificador: si algún día
 * TCGdex publicara un set 'ogn', las cartas de alguien apuntarían a otra carta
 * sin dar ningún error. El prefijo lo hace imposible.
 */
const PREFIX = 'rb'

// ── Red ──────────────────────────────────────────────────────────────────────

async function getJson(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Cardex catalog builder' },
        signal: AbortSignal.timeout(60_000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt === tries) throw new Error(`${url} -> ${e.message}`)
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  return null
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Cardex catalog builder' },
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${url}`)
  return res.text()
}

// ── Tipo de cambio ───────────────────────────────────────────────────────────

/**
 * Cuántos euros vale un dólar, según la referencia diaria del BCE.
 *
 * El BCE publica EUR -> divisa, así que se invierte. Se lee una vez por
 * ejecución y se reparte a todos los precios: un catálogo entero queda
 * convertido con un único tipo y una única fecha, porque mezclarlos daría
 * cifras que no cuadran entre sí sin que nadie pueda saber por qué.
 */
export async function usdToEur() {
  const xml = await getText(ECB)
  const usdPerEur = Number(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml)?.[1])
  const on = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] ?? null
  if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) {
    throw new Error('El BCE no ha devuelto un tipo USD utilizable')
  }
  return { rate: 1 / usdPerEur, on, usdPerEur }
}

// ── Galería de Riot ──────────────────────────────────────────────────────────

/**
 * Todas las cartas de la galería, de una vez.
 *
 * La página trae el listado entero incrustado (`prefetchAll`), así que una sola
 * descarga basta para los cinco sets. Se guarda la promesa porque el generador
 * la pide una vez por set.
 */
let galleryPromise = null

async function gallery() {
  if (galleryPromise) return galleryPromise
  galleryPromise = (async () => {
    const html = await getText(`${GALLERY}/en-us/card-gallery/`)
    const buildId = /"buildId":"([^"]+)"/.exec(html)?.[1]
    if (!buildId) {
      throw new Error(
        'No se ha encontrado el buildId en la galería de Riftbound. Es una página de Riot ' +
          'sin API publicada: si han cambiado cómo la sirven, hay que revisar este extractor.'
      )
    }
    const data = await getJson(`${GALLERY}/_next/data/${buildId}/en-us/card-gallery.json`)
    const blade = (data?.pageProps?.page?.blades ?? []).find(
      (b) => b?.type === 'riftboundCardGallery'
    )
    const cards = blade?.cards?.items ?? []
    const sets = blade?.sets?.items ?? []
    if (!cards.length || !sets.length) throw new Error('La galería de Riftbound ha venido vacía')
    return { cards, sets }
  })()
  return galleryPromise
}

/** '.../abc123-744x1039.png?accountingTag=RB' -> 'abc123-744x1039.png' */
function assetId(url) {
  if (!url) return null
  const clean = String(url).split('?')[0]
  const name = clean.slice(clean.lastIndexOf('/') + 1)
  // La aplicación compone la URL a partir de esto, y la ruta pasa por una
  // comprobación de segmento seguro: si trae algo raro, mejor sin imagen.
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : null
}

/** El número impreso, sin el prefijo del set ni el denominador. */
function localIdOf(publicCode, setCode, collectorNumber) {
  const rest = tcgNumberOf(publicCode, setCode)
  if (rest) return rest.split('/')[0]
  return String(collectorNumber ?? '')
}

/** El número tal y como TCGplayer lo indexa: '056/298'. */
function tcgNumberOf(publicCode, setCode) {
  return typeof publicCode === 'string' && publicCode.startsWith(`${setCode}-`)
    ? publicCode.slice(setCode.length + 1)
    : null
}

/**
 * Valor canónico de una taxonomía de la galería.
 *
 * Se usa el `id` y no el `label` porque el label viene traducido en cuanto se
 * cambia de idioma ('Calma (Calm)'), y estos valores son la clave de la tabla
 * de colores `oklch` del renderer. Con el label traducido, el degradado se iría
 * al color por defecto sin avisar. Es el mismo cuidado que ya se tiene con los
 * tipos de Pokémon.
 */
const titleCase = (id) => (id ? id.charAt(0).toUpperCase() + id.slice(1) : null)

/**
 * La cifra de un campo de la galería.
 *
 * Vienen envueltas igual que la rareza (`{ label, value: { id, label } }`), y
 * un cero es un valor legítimo —hay unidades con 0 de poderío—, así que se
 * comprueba que el número exista, no que sea distinto de cero.
 */
const numberOr = (field) => {
  const raw = field?.value?.id ?? field?.value?.label ?? field?.id ?? field?.label
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// ── TCGplayer, vía TCGCSV ────────────────────────────────────────────────────

let groupsPromise = null

async function groups() {
  if (!groupsPromise) groupsPromise = getJson(`${TCGCSV}/${TCG_CATEGORY}/groups`)
  return (await groupsPromise)?.results ?? []
}

const extended = (product, name) => product.extendedData?.find((e) => e.name === name)?.value ?? null

/**
 * Precios del set, indexados por número de coleccionista y por nombre.
 *
 * El cruce principal es por número, que es exacto: 352 de 352 en Origins. El de
 * por nombre es la reserva para los tokens, que TCGplayer numera de otra forma
 * ('UNL-T01' no lleva denominador) y que son nueve cartas en total.
 */
async function marketFor(setCode) {
  const group = (await groups()).find((g) => g.abbreviation === setCode)
  if (!group) return null

  const [products, prices] = await Promise.all([
    getJson(`${TCGCSV}/${TCG_CATEGORY}/${group.groupId}/products`),
    getJson(`${TCGCSV}/${TCG_CATEGORY}/${group.groupId}/prices`)
  ])

  const bySubtype = new Map()
  for (const p of prices?.results ?? []) {
    const entry = bySubtype.get(p.productId) ?? {}
    entry[p.subTypeName] = p
    bySubtype.set(p.productId, entry)
  }

  const byNumber = new Map()
  const byName = new Map()
  const sealed = []
  for (const product of products?.results ?? []) {
    const number = extended(product, 'Number')
    const row = { product, prices: bySubtype.get(product.productId) ?? {} }
    // El primero gana: si dos cartas comparten nombre, el cruce por número ya
    // habrá resuelto la que importa y esto sólo se usa como reserva.
    if (!byName.has(product.cleanName)) byName.set(product.cleanName, row)
    // Sin número no es necesariamente producto sellado: los tokens también
    // llegan así, porque TCGplayer no les pone número de coleccionista. Por eso
    // entran igualmente en el índice por nombre de arriba, que es justo la
    // reserva que los recoge.
    if (!number) sealed.push(product)
    else byNumber.set(number, row)
  }

  return { group, byNumber, byName, sealed }
}

const eurCents = (usd, fx) =>
  typeof usd === 'number' && Number.isFinite(usd) ? Math.round(usd * fx.rate * 100) : null

/**
 * Las impresiones de una carta, con su precio ya en euros.
 *
 * TCGplayer separa 'Normal' y 'Foil', que son exactamente los ejes `normal` y
 * `holo` que Cardex ya maneja. `sortKey` deja la normal primero, que es lo que
 * la vista `card_variant_price` mira para elegir el precio de referencia dentro
 * de un eje.
 *
 * No se publica `avg7Cents`: TCGplayer da precio de mercado pero no media
 * semanal. Dejarlo nulo hace que la carta salga sin variación a siete días, que
 * es la verdad; rellenarlo con el precio de hoy daría un 0,0 % permanente con
 * toda la pinta de ser un dato.
 */
function printingsFor(cardId, row, fx) {
  const out = []
  const axes = [
    { subtype: 'Normal', variant: 'normal', kind: 'normal', label: 'Normal' },
    { subtype: 'Foil', variant: 'holo', kind: 'holo', label: 'Foil' }
  ]
  for (const [i, axis] of axes.entries()) {
    const p = row?.prices?.[axis.subtype]
    if (!p) continue
    const trendCents = eurCents(p.marketPrice ?? p.midPrice, fx)
    out.push({
      id: `${cardId}-${axis.variant}`,
      kind: axis.kind,
      subtype: '',
      stamp: [],
      label: axis.label,
      variant: axis.variant,
      sortKey: i,
      prices:
        trendCents === null
          ? []
          : [
              {
                source: 'tcgplayer',
                currency: 'EUR',
                lowCents: eurCents(p.lowPrice, fx),
                trendCents,
                avg7Cents: null,
                avg30Cents: null,
                updatedAt: null,
                // El rastro de la conversión, para poder comprobar la cifra
                // contra la fuente sin adivinar con qué cambio salió.
                sourceCurrency: 'USD',
                fxRate: Math.round(fx.rate * 1e6) / 1e6,
                fxOn: fx.on
              }
            ]
    })
  }
  // Sin precio de ninguna de las dos: la carta existe igual y se colecciona
  // igual, así que entra al menos con su impresión normal.
  if (!out.length) {
    out.push({
      id: `${cardId}-normal`,
      kind: 'normal',
      subtype: '',
      stamp: [],
      label: 'Normal',
      variant: 'normal',
      sortKey: 0,
      prices: []
    })
  }
  return out
}

// ── Sobres y productos ───────────────────────────────────────────────────────

/**
 * A qué familia pertenece cada producto sellado.
 *
 * El orden importa: 'Booster Display Case' contiene 'Display' y 'Booster', y
 * queremos que gane el más específico. Lo que no encaja en ninguna se queda
 * fuera: en la lista de TCGplayer hay cosas que no son producto de este set
 * (runas a granel, lotes de tres sobres sueltos) y meterlas sólo ensucia la
 * vista.
 */
const PACK_KINDS = [
  [/sleeved booster pack$/i, 'booster'],
  [/booster pack$/i, 'booster'],
  [/booster display case$/i, 'bundle'],
  [/booster display$/i, 'bundle'],
  [/champion deck \([^)]+\) display$/i, 'bundle'],
  [/champion deck \([^)]+\)$/i, 'collection'],
  [/showdown decks.*display$/i, 'bundle'],
  [/showdown decks/i, 'collection'],
  [/vault bundle case$/i, 'bundle'],
  [/vault bundle$/i, 'bundle'],
  [/pre-rift (event )?kit$/i, 'collection'],
  [/nexus night promo pack$/i, 'other']
]

/**
 * Los sobres del set, sacados de los productos sellados de TCGplayer.
 *
 * En Pokémon esto se mantiene a mano porque ninguna fuente publica arte de
 * sobres; aquí TCGplayer sí lo trae, y se referencia igual que hace el Set Base
 * con Bulbagarden: una URL https que cada usuario se baja una vez a su caché,
 * en vez de republicar material ajeno en el repositorio.
 */
function packsFrom(setId, sealed) {
  const packs = []
  for (const product of sealed) {
    const match = PACK_KINDS.find(([re]) => re.test(product.name))
    if (!match) continue
    packs.push({
      id: `${setId}-${product.productId}`,
      name: product.name,
      names: { en: product.name },
      kind: match[1],
      // _400w pesa unos 20 KB y el hueco de la vista mide 138 px: de sobra.
      artworkPath: `https://tcgplayer-cdn.tcgplayer.com/product/${product.productId}_400w.jpg`
    })
  }
  // Los sobres primero, que es lo que se busca al abrir la vista; después mazos
  // y cajas, y dentro de cada familia por nombre para que el orden no baile de
  // una generación a otra.
  const order = { booster: 0, collection: 1, bundle: 2, other: 3 }
  return packs.sort(
    (a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name)
  )
}

// ── Set completo ─────────────────────────────────────────────────────────────

/** Riot no publica fecha de salida en la galería; TCGplayer sí, en el grupo. */
function releaseOf(group) {
  const raw = group?.publishedOn
  return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : null
}

const sortKeyOf = (date) => (date ? Number(date.replaceAll('-', '')) || 0 : 0)

/**
 * Construye un set de Riftbound.
 *
 * `code` es la abreviatura impresa: OGN, SFD, UNL, VEN. Devuelve `null` si no
 * existe, para que el generador siga con los demás en vez de plantarse.
 */
export async function buildSet(code, { limit = 0, fx }) {
  const setCode = String(code).toUpperCase()
  const { cards: allCards, sets } = await gallery()

  const head = sets.find((s) => s.id === setCode)
  if (!head) {
    console.warn(`  ! set ${setCode} no está en la galería de Riftbound`)
    return null
  }

  const all = allCards.filter((c) => c.set?.value?.id === setCode)
  if (!all.length) {
    console.warn(`  ! set ${setCode} no tiene cartas`)
    return null
  }

  let items = [...all].sort((a, b) => (a.collectorNumber ?? 0) - (b.collectorNumber ?? 0))
  if (limit > 0) items = items.slice(0, limit)

  const market = await marketFor(setCode)
  if (!market) console.warn(`  ! ${setCode}: sin datos de TCGplayer, el set irá sin precios`)

  process.stdout.write(`  ${setCode}: ${items.length} cartas `)

  const setId = `${PREFIX}-${setCode.toLowerCase()}`
  let unpriced = 0

  const cards = items.map((c) => {
    const localId = localIdOf(c.publicCode, setCode, c.collectorNumber)
    const tcgNumber = tcgNumberOf(c.publicCode, setCode)
    const row = (tcgNumber && market?.byNumber.get(tcgNumber)) || market?.byName.get(c.name) || null
    if (!row) unpriced += 1

    const cardId = `${PREFIX}-${c.id}`
    const printings = printingsFor(cardId, row, fx)

    // Energía, poderío y poder son las cifras impresas de Riftbound, donde
    // Pokémon imprime PV. Sólo se guardan las que la carta trae de verdad: un
    // hechizo no tiene poderío y un campo de batalla no tiene coste.
    const stats = {}
    const energy = numberOr(c.energy)
    const might = numberOr(c.might)
    const power = numberOr(c.power)
    if (energy !== null) stats.energy = energy
    if (might !== null) stats.might = might
    if (power !== null) stats.power = power

    process.stdout.write('.')
    return {
      id: cardId,
      localId,
      name: c.name,
      names: { en: c.name },
      rarity: c.rarity?.value?.label ?? null,
      // El tipo de carta ocupa el mismo sitio que Pokemon/Trainer/Energy, y el
      // visor lo usa para decidir el reverso: en Riftbound las leyendas, los
      // campos de batalla y las runas no comparten reverso con el mazo
      // principal.
      category: titleCase(c.cardType?.type?.[0]?.id),
      types: (c.domain?.values ?? []).map((d) => titleCase(d.id)).filter(Boolean),
      hp: null,
      ...(Object.keys(stats).length ? { stats } : {}),
      illustrator: c.illustrator?.values?.map((i) => i.label).join(', ') || null,
      imagePath: assetId(c.cardImage?.url),
      // Riftbound se imprime en normal y en foil; el foil ocupa el eje `holo`.
      variants: [...new Set(printings.map((p) => p.variant))],
      // Sólo inglés: la galería en español devuelve los mismos nombres, el
      // mismo texto y las mismas imágenes. Comprobado, no supuesto.
      langs: ['en'],
      printings
    }
  })

  process.stdout.write('\n')
  if (unpriced) console.log(`    (${unpriced} carta(s) sin precio en TCGplayer)`)

  const releasedOn = releaseOf(market?.group)

  return {
    set: {
      id: setId,
      game: 'riftbound',
      seriesId: `${PREFIX}-main`,
      seriesName: 'Riftbound',
      region: 'intl',
      code: setCode,
      name: head.name,
      names: { en: head.name },
      releasedOn,
      // `collectorNumberMax` son las cartas numeradas, que es el denominador del
      // porcentaje de completado. El recuento total incluye las showcase, que
      // van por encima de ese número igual que las secretas de Pokémon.
      totalOfficial: head.collectorNumberMax ?? 0,
      totalAll: all.length,
      // Riot no publica logo ni símbolo de set en la galería. La vista de Sets
      // dibuja el hueco con el nombre, que es lo que ya hace con los sobres sin
      // arte.
      logoPath: null,
      symbolPath: null,
      sortKey: sortKeyOf(releasedOn),
      sourceLang: 'en'
    },
    cards,
    packs: market ? packsFrom(setId, market.sealed) : []
  }
}
