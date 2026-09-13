import { createHash } from 'node:crypto'
import { app } from 'electron'
import type { CatalogInstalled, CatalogStatus } from '@shared/types'
import { getDb } from '../db'
import { broadcast, mainBus } from '../events'
import { log } from '../log'
import {
  SUPPORTED_SCHEMA,
  parseGame,
  parseManifest,
  parseSetFile,
  splitNumber,
  variantMask,
  type CatalogPrinting,
  type CatalogSetFile
} from './format'
import { RECOG_MODEL_ID, decodeSidecar, type Sidecar } from '../recognition/format'

/**
 * Canal de contenido: el catálogo se publica en el repositorio y la aplicación
 * lo sincroniza. Es independiente del autoactualizador del binario, para poder
 * añadir un set nuevo sin sacar una versión de la aplicación.
 */
const REPO = 'LordAntonio99/cardex'
const BRANCH = 'catalog'
const DEFAULT_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/catalog`

/**
 * Origen del catálogo.
 *
 * `CARDEX_CATALOG_BASE` permite apuntar a un servidor local para probar la
 * importación sin tener que publicar nada en GitHub. Sólo se atiende cuando la
 * aplicación no está empaquetada: en una instalación real el origen no es
 * negociable desde el entorno.
 */
const BASE =
  !app.isPackaged && process.env['CARDEX_CATALOG_BASE']
    ? process.env['CARDEX_CATALOG_BASE'].replace(/\/+$/, '')
    : DEFAULT_BASE

/** Base del catálogo publicado. El arte de sobres se sirve desde aquí. */
export function catalogBase(): string {
  return BASE
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

let current: CatalogStatus['state'] = 'idle'
let lastError: string | null = null

function meta(key: string): string | null {
  return (
    getDb().prepare<{ k: string }, { v: string }>('SELECT v FROM cat.cat_meta WHERE k = @k').get({
      k: key
    })?.v ?? null
  )
}

function setMeta(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO cat.cat_meta (k, v) VALUES (@k, @v) ON CONFLICT(k) DO UPDATE SET v = @v')
    .run({ k: key, v: value })
}

function installed(): CatalogInstalled {
  const db = getDb()
  const counts = db
    .prepare<[], { sets: number; cards: number }>(
      'SELECT (SELECT COUNT(*) FROM cat.sets) AS sets, (SELECT COUNT(*) FROM cat.cards) AS cards'
    )
    .get()
  const num = (k: string): number | null => {
    const v = meta(k)
    return v === null ? null : Number(v)
  }
  return {
    version: meta('catalogVersion'),
    setCount: counts?.sets ?? 0,
    cardCount: counts?.cards ?? 0,
    lastCheckedAt: num('lastCheckedAt'),
    lastSyncedAt: num('lastSyncedAt')
  }
}

export function status(): CatalogStatus {
  return {
    state: current,
    installed: installed(),
    ...(lastError && current === 'error' ? { message: lastError } : {})
  }
}

function emit(next: Partial<CatalogStatus> & { state: CatalogStatus['state'] }): void {
  current = next.state
  const payload: CatalogStatus = { ...next, installed: installed() }
  broadcast('catalog:progress', payload)
}

async function fetchJson(url: string): Promise<{ json: unknown; raw: string }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Cardex' },
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} al pedir ${url}`)
  const raw = await res.text()
  return { json: JSON.parse(raw) as unknown, raw }
}

/** Igual, para ficheros binarios: los vectores de reconocimiento. */
async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Cardex' },
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} al pedir ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const sha256Bytes = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/**
 * Importa los vectores de reconocimiento de un set.
 *
 * Va en su propia transacción y NO dentro de `importSet`, porque los dos
 * ficheros cambian a ritmos distintos: el JSON del set se republica cada vez que
 * se mueven los precios, y los vectores sólo cuando cambian las cartas o el
 * modelo. Meterlos juntos obligaría a rehacer el trabajo caro por un cambio de
 * céntimos.
 */
function importRecognition(sidecar: Sidecar, file: string, hash: string): number {
  const db = getDb()
  const now = Date.now()

  const del = db.prepare('DELETE FROM cat.card_recognition WHERE set_id = @setId AND model = @model')
  const ins = db.prepare(
    `INSERT INTO cat.card_recognition (set_id, card_id, lang, model, embedding)
     VALUES (@setId, @cardId, @lang, @model, @embedding)
     ON CONFLICT (card_id, lang, model) DO UPDATE SET
       set_id = excluded.set_id, embedding = excluded.embedding`
  )
  const source = db.prepare(
    `INSERT INTO cat.recognition_sources (set_id, model, file, sha256, count, imported_at)
     VALUES (@setId, @model, @file, @sha256, @count, @now)
     ON CONFLICT (set_id, model) DO UPDATE SET
       file = excluded.file, sha256 = excluded.sha256,
       count = excluded.count, imported_at = excluded.imported_at`
  )

  const run = db.transaction(() => {
    del.run({ setId: sidecar.setId, model: sidecar.model })
    let n = 0
    for (const [i, entry] of sidecar.entries.entries()) {
      const from = i * sidecar.dims
      const slice = sidecar.vectors.subarray(from, from + sidecar.dims)
      ins.run({
        setId: sidecar.setId,
        cardId: entry.cardId,
        lang: entry.lang,
        model: sidecar.model,
        embedding: Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength)
      })
      n += 1
    }
    source.run({
      setId: sidecar.setId,
      model: sidecar.model,
      file,
      sha256: hash,
      count: n,
      now
    })
    return n
  })

  return run()
}

/**
 * Importa un fichero de set. Se ejecuta entero dentro de una transacción: si
 * algo falla a mitad, ese set se queda exactamente como estaba.
 *
 * El fichero es autoritativo para su set: se borran sus cartas y se vuelven a
 * insertar. Eso sólo afecta a catalogue.db; la colección del usuario vive en
 * otro fichero y SQLite no permite claves foráneas entre bases adjuntas, así
 * que no hay forma de que esta operación la alcance.
 */
function importSet(file: CatalogSetFile, sourceFile: string, hash: string): number {
  const db = getDb()
  const now = Date.now()
  const s = file.set

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO cat.series (id, name, region) VALUES (@id, @name, @region)
       ON CONFLICT(id) DO UPDATE SET name = @name, region = @region`
    ).run({ id: s.seriesId, name: s.seriesName || s.seriesId, region: s.region ?? 'intl' })

    db.prepare(
      `INSERT INTO cat.sets
         (id, game, series_id, region, code, name, released_on, total_official, total_all,
          logo_path, symbol_path, sort_key)
       VALUES (@id, @game, @seriesId, @region, @code, @name, @releasedOn, @totalOfficial, @totalAll,
               @logoPath, @symbolPath, @sortKey)
       ON CONFLICT(id) DO UPDATE SET
         game = @game, series_id = @seriesId, region = @region, code = @code, name = @name,
         released_on = @releasedOn, total_official = @totalOfficial, total_all = @totalAll,
         logo_path = @logoPath, symbol_path = @symbolPath, sort_key = @sortKey`
    ).run({
      id: s.id,
      game: parseGame(s.game),
      seriesId: s.seriesId,
      region: s.region ?? 'intl',
      code: s.code ?? null,
      name: s.name,
      releasedOn: s.releasedOn ?? null,
      totalOfficial: s.totalOfficial ?? 0,
      totalAll: s.totalAll ?? 0,
      logoPath: s.logoPath ?? null,
      symbolPath: s.symbolPath ?? null,
      sortKey: s.sortKey ?? 0
    })

    db.prepare('DELETE FROM cat.set_names WHERE set_id = @id').run({ id: s.id })
    const insSetName = db.prepare(
      'INSERT INTO cat.set_names (set_id, lang, name) VALUES (@setId, @lang, @name)'
    )
    for (const [lang, name] of Object.entries(s.names ?? {})) {
      if (name) insSetName.run({ setId: s.id, lang, name })
    }

    // El borrado en cascada se lleva card_names, card_langs y card_packs.
    db.prepare('DELETE FROM cat.cards WHERE set_id = @id').run({ id: s.id })
    db.prepare('DELETE FROM cat.packs WHERE set_id = @id').run({ id: s.id })
    db.prepare('DELETE FROM cat.card_search_src WHERE card_id IN (SELECT id FROM cat.cards WHERE set_id = @id)').run(
      { id: s.id }
    )

    const insPack = db.prepare(
      `INSERT INTO cat.packs (id, set_id, name, kind, artwork_path, logo_path, sort_key)
       VALUES (@id, @setId, @name, @kind, @artworkPath, @logoPath, @sortKey)`
    )
    const insPackName = db.prepare(
      'INSERT INTO cat.pack_names (pack_id, lang, name) VALUES (@packId, @lang, @name)'
    )
    file.packs?.forEach((p, i) => {
      insPack.run({
        id: p.id,
        setId: s.id,
        name: p.name,
        kind: p.kind ?? 'booster',
        artworkPath: p.artworkPath ?? null,
        logoPath: p.logoPath ?? null,
        sortKey: i
      })
      for (const [lang, name] of Object.entries(p.names ?? {})) {
        if (name) insPackName.run({ packId: p.id, lang, name })
      }
    })

    const insCard = db.prepare(
      `INSERT INTO cat.cards
         (id, set_id, local_id, number_sort, number_suffix, name, rarity, category,
          types, hp, stats, illustrator, image_path, variant_mask)
       VALUES (@id, @setId, @localId, @numberSort, @numberSuffix, @name, @rarity, @category,
               @types, @hp, @stats, @illustrator, @imagePath, @variantMask)`
    )
    const insCardName = db.prepare(
      'INSERT INTO cat.card_names (card_id, lang, name) VALUES (@cardId, @lang, @name)'
    )
    const insCardLang = db.prepare(
      'INSERT INTO cat.card_langs (card_id, lang) VALUES (@cardId, @lang)'
    )
    const insCardPack = db.prepare(
      'INSERT OR IGNORE INTO cat.card_packs (card_id, pack_id) VALUES (@cardId, @packId)'
    )
    const insSearch = db.prepare(
      `INSERT INTO cat.card_search_src (card_id, lang, name, set_name, number)
       VALUES (@cardId, @lang, @name, @setName, @number)`
    )
    const insPrinting = db.prepare(
      `INSERT INTO cat.card_printings
         (card_id, printing_id, variant, kind, subtype, stamp, label, is_default, sort_key)
       VALUES (@cardId, @printingId, @variant, @kind, @subtype, @stamp, @label, @isDefault, @sortKey)`
    )
    const insPrice = db.prepare(
      `INSERT INTO cat.printing_prices
         (card_id, printing_id, source, currency, low_cents, trend_cents, avg7_cents, avg30_cents, updated_at)
       VALUES (@cardId, @printingId, @source, @currency, @low, @trend, @avg7, @avg30, @updatedAt)
       ON CONFLICT(card_id, printing_id, source) DO UPDATE SET
         currency = @currency, low_cents = @low, trend_cents = @trend,
         avg7_cents = @avg7, avg30_cents = @avg30, updated_at = @updatedAt`
    )

    for (const c of file.cards) {
      const n = splitNumber(c.localId)
      insCard.run({
        id: c.id,
        setId: s.id,
        localId: c.localId,
        numberSort: n.sort,
        numberSuffix: n.suffix,
        name: c.name,
        rarity: c.rarity ?? null,
        category: c.category ?? null,
        types: JSON.stringify(c.types ?? []),
        hp: c.hp ?? null,
        // Nulo y no '{}' cuando no hay ninguna: así la interfaz distingue «esta
        // carta no imprime cifras» de «tiene cifras y todas valen cero».
        stats: c.stats && Object.keys(c.stats).length ? JSON.stringify(c.stats) : null,
        illustrator: c.illustrator ?? null,
        imagePath: c.imagePath ?? null,
        variantMask: variantMask(c.variants)
      })

      const names = c.names ?? {}
      for (const [lang, name] of Object.entries(names)) {
        if (name) insCardName.run({ cardId: c.id, lang, name })
      }
      for (const lang of c.langs ?? Object.keys(names)) {
        insCardLang.run({ cardId: c.id, lang })
      }
      for (const packId of c.packs ?? []) {
        insCardPack.run({ cardId: c.id, packId })
      }

      // Una fila de búsqueda por idioma disponible, más la canónica.
      const searchNames = new Set<string>([c.name, ...Object.values(names)])
      for (const name of searchNames) {
        insSearch.run({
          cardId: c.id,
          lang: 'all',
          name,
          setName: s.names?.['es'] ?? s.name,
          number: c.localId
        })
      }

      // Impresiones concretas con su precio.
      const printings = c.printings ?? []
      const defaultId = pickDefaultPrinting(printings)
      for (const [i, p] of printings.entries()) {
        insPrinting.run({
          cardId: c.id,
          printingId: p.id,
          variant: p.variant ?? 'normal',
          kind: p.kind ?? 'normal',
          subtype: p.subtype ?? '',
          stamp: (p.stamp ?? []).join(','),
          label: p.label ?? p.subtype ?? p.kind ?? 'Normal',
          isDefault: p.id === defaultId ? 1 : 0,
          sortKey: p.sortKey ?? i
        })
        for (const price of p.prices ?? []) {
          if (typeof price.trendCents !== 'number') continue
          insPrice.run({
            cardId: c.id,
            printingId: p.id,
            source: price.source === 'tcgplayer' ? 1 : 0,
            currency: price.currency ?? 'EUR',
            low: price.lowCents ?? null,
            trend: price.trendCents,
            avg7: price.avg7Cents ?? null,
            avg30: price.avg30Cents ?? null,
            updatedAt: price.updatedAt ?? null
          })
        }
      }
    }

    db.prepare(
      `INSERT INTO cat.catalog_sources (set_id, file, sha256, card_count, imported_at)
       VALUES (@setId, @file, @sha256, @cardCount, @now)
       ON CONFLICT(set_id) DO UPDATE SET
         file = @file, sha256 = @sha256, card_count = @cardCount, imported_at = @now`
    ).run({ setId: s.id, file: sourceFile, sha256: hash, cardCount: file.cards.length, now })

    return file.cards.length
  })

  return run()
}

/**
 * Elige la impresión de referencia de una carta.
 *
 * Se busca la corriente, no la cara: enseñar el precio de 1ª edición en todas
 * las cartas del Set Base daría una idea completamente falsa de lo que vale el
 * set. Se prefiere una impresión con precio, sin sello y que no sea de primera
 * edición; si no hay, la primera que tenga precio.
 */
function pickDefaultPrinting(printings: CatalogPrinting[]): string | null {
  const withPrice = printings.filter((p) =>
    (p.prices ?? []).some((x) => typeof x.trendCents === 'number')
  )
  if (!withPrice.length) return printings[0]?.id ?? null

  const ordinary = withPrice.find(
    (p) => p.variant !== 'first_ed' && !(p.stamp ?? []).length
  )
  return (ordinary ?? withPrice[0])?.id ?? null
}

/**
 * Anota el precio de hoy para lo que el usuario tiene.
 *
 * El catálogo trae precio por impresión, pero el histórico de la colección vive
 * en la base del usuario y sólo crece para lo que posee o vigila. Así la tabla
 * grande no se dispara: no tiene sentido guardar 90 días de precio de 20.000
 * cartas que no son suyas.
 */
export function refreshOwnedPrices(): number {
  const db = getDb()
  const today = Math.floor(Date.now() / 86400000)
  const r = db
    .prepare(
      `INSERT INTO price_points (card_key_id, source, day, low_cents, trend_cents, avg7_cents, avg30_cents)
       SELECT ck.id, 0, @day, NULL, v.trend_cents, NULL, NULL
       FROM card_keys ck
       JOIN cat.card_variant_price v
         ON v.card_id = ck.card_id AND v.variant = ck.variant
       WHERE v.trend_cents IS NOT NULL
       ON CONFLICT(card_key_id, source, day) DO UPDATE SET trend_cents = excluded.trend_cents`
    )
    .run({ day: today })
  return r.changes
}

/**
 * Deja anotado el valor de la colección de hoy.
 *
 * Es lo que alimenta la gráfica de Mercado. Una fila al día: con diez años de
 * uso son 3.650 filas, nada.
 */
function writePortfolioSnapshot(): void {
  const db = getDb()
  const today = Math.floor(Date.now() / 86400000)
  db.prepare(
    `INSERT INTO portfolio_snapshots (day, total_cents, cost_cents, item_count, distinct_keys)
     SELECT @day,
            COALESCE(SUM(ci.qty * COALESCE(v.trend_cents, 0)), 0),
            COALESCE((SELECT SUM(m.qty_delta * COALESCE(m.unit_cents, 0) + m.fees_cents)
                      FROM movements m WHERE m.kind IN ('buy', 'trade_in')), 0),
            COALESCE(SUM(ci.qty), 0),
            COUNT(*)
     FROM collection_items ci
     JOIN card_keys ck ON ck.id = ci.card_key_id
     LEFT JOIN cat.card_variant_price v
       ON v.card_id = ck.card_id AND v.variant = ck.variant
     WHERE ci.qty > 0
     ON CONFLICT(day) DO UPDATE SET
       total_cents = excluded.total_cents,
       cost_cents = excluded.cost_cents,
       item_count = excluded.item_count,
       distinct_keys = excluded.distinct_keys`
  ).run({ day: today })
}

/** Marca huérfanas las claves del usuario cuya carta ya no existe en el catálogo. */
function reconcileOrphans(): number {
  const db = getDb()
  const now = Date.now()
  const found = db
    .prepare(
      `INSERT INTO orphan_keys (card_key_id, detected_at)
       SELECT ck.id, @now FROM card_keys ck
       WHERE NOT EXISTS (SELECT 1 FROM cat.cards c WHERE c.id = ck.card_id)
         AND ck.id NOT IN (SELECT card_key_id FROM orphan_keys WHERE resolved_at IS NULL)`
    )
    .run({ now })
  // Las que vuelven a encontrar su carta dejan de ser huérfanas.
  db.prepare(
    `UPDATE orphan_keys SET resolved_at = @now
     WHERE resolved_at IS NULL
       AND card_key_id IN (
         SELECT ck.id FROM card_keys ck
         JOIN cat.cards c ON c.id = ck.card_id
       )`
  ).run({ now })
  return found.changes
}

export async function sync(opts: { force: boolean }): Promise<CatalogStatus> {
  if (current === 'syncing' || current === 'checking') return status()

  lastError = null
  emit({ state: 'checking' })

  try {
    const { json } = await fetchJson(`${BASE}/manifest.json`)
    const manifest = parseManifest(json)
    setMeta('lastCheckedAt', String(Date.now()))

    const db = getDb()
    const known = new Map(
      db
        .prepare<[], { set_id: string; sha256: string }>(
          'SELECT set_id, sha256 FROM cat.catalog_sources'
        )
        .all()
        .map((r) => [r.set_id, r.sha256] as const)
    )

    const pending = opts.force
      ? manifest.sets
      : manifest.sets.filter((s) => known.get(s.id) !== s.sha256)

    // Los vectores de reconocimiento van por su cuenta: sólo interesan los del
    // modelo que entiende esta versión, y su fichero cambia mucho menos a
    // menudo que el del set.
    const knownRecog = new Map(
      db
        .prepare<{ model: string }, { set_id: string; sha256: string }>(
          'SELECT set_id, sha256 FROM cat.recognition_sources WHERE model = @model'
        )
        .all({ model: RECOG_MODEL_ID })
        .map((r) => [r.set_id, r.sha256] as const)
    )
    const pendingRecog = manifest.recognition
      .filter((r) => r.model === RECOG_MODEL_ID)
      .filter((r) => opts.force || knownRecog.get(r.id) !== r.sha256)

    if (!pending.length && !pendingRecog.length) {
      setMeta('catalogVersion', manifest.catalogVersion)
      emit({ state: 'idle' })
      log.info(`Catálogo ya al día (v${manifest.catalogVersion})`)
      return status()
    }

    log.info(`Catálogo v${manifest.catalogVersion}: ${pending.length} set(s) por importar`)

    // La barra cuenta las dos descargas: el fichero del set y el de sus huellas.
    const total = pending.length + pendingRecog.length
    let done = 0
    for (const entry of pending) {
      emit({
        state: 'syncing',
        progress: { done, total, currentSet: entry.id, phase: 'sets' }
      })
      try {
        const { json: setJson, raw } = await fetchJson(`${BASE}/${entry.file}`)
        const hash = sha256(raw)
        if (hash !== entry.sha256) {
          throw new Error(
            `El hash de ${entry.file} no coincide con el manifiesto (esperado ${entry.sha256.slice(0, 12)}…, obtenido ${hash.slice(0, 12)}…)`
          )
        }
        const parsed = parseSetFile(setJson, entry.id)
        const n = importSet(parsed, entry.file, hash)
        log.info(`  ${entry.id}: ${n} cartas`)
      } catch (e) {
        // Un set roto no debe tumbar la sincronización entera: se salta y se
        // reintentará la próxima vez, porque su hash no queda registrado.
        log.error(`No se ha podido importar el set ${entry.id}`, e)
      }
      done += 1
    }

    for (const entry of pendingRecog) {
      emit({
        state: 'syncing',
        progress: { done, total, currentSet: entry.id, phase: 'recognition' }
      })
      try {
        const bytes = await fetchBytes(`${BASE}/${entry.file}`)
        const hash = sha256Bytes(bytes)
        if (hash !== entry.sha256) {
          throw new Error(
            `El hash de ${entry.file} no coincide con el manifiesto (esperado ${entry.sha256.slice(0, 12)}…, obtenido ${hash.slice(0, 12)}…)`
          )
        }
        const sidecar: Sidecar = decodeSidecar(bytes, entry.id)
        if (sidecar.model !== RECOG_MODEL_ID) {
          throw new Error(`Los vectores son del modelo ${sidecar.model} y aquí se usa ${RECOG_MODEL_ID}`)
        }
        const n = importRecognition(sidecar, entry.file, hash)
        log.info(`  ${entry.id}: ${n} vector(es) de reconocimiento`)
      } catch (e) {
        // Igual que con los sets: uno roto no tumba la sincronización, y al no
        // registrar su hash se reintenta la próxima vez. El escáner funciona
        // con lo que haya; si no hay nada, lo dice.
        log.error(`No se han podido importar los vectores de ${entry.id}`, e)
      }
      done += 1
    }

    // Último aviso con la barra llena: si no, el salto de 'syncing' a 'idle'
    // deja la barra a medias justo en el momento en que ya ha terminado.
    emit({ state: 'syncing', progress: { done, total, currentSet: '', phase: 'recognition' } })

    // El índice de búsqueda se reconstruye una vez al final, no por set.
    getDb().exec("INSERT INTO cat.cards_fts(cards_fts) VALUES('rebuild')")
    getDb().exec("INSERT INTO cat.cards_fts_cjk(cards_fts_cjk) VALUES('rebuild')")

    const priced = refreshOwnedPrices()
    writePortfolioSnapshot()
    if (priced > 0) log.info(`Precio de hoy anotado para ${priced} carta(s) de tu colección`)

    const orphans = reconcileOrphans()
    if (orphans > 0) {
      log.warn(`${orphans} carta(s) de tu colección ya no encuentran su ficha en el catálogo`)
    }

    setMeta('catalogVersion', manifest.catalogVersion)
    setMeta('schemaVersion', String(SUPPORTED_SCHEMA))
    setMeta('lastSyncedAt', String(Date.now()))

    emit({ state: 'idle' })
    broadcast('db:changed', { scopes: ['catalog', 'cards', 'sets'] })
    // El reconocedor tiene sus vectores en memoria: hay que decirle que hay
    // material nuevo. No vale `broadcast`, que sólo llega al renderer.
    mainBus.emit('catalog:imported')
    return status()
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    log.error('La sincronización de catálogo ha fallado', e)
    emit({ state: 'error', message: lastError })
    return status()
  }
}

/**
 * Comprobación en segundo plano al arrancar y una vez al día.
 *
 * Si no hay red, no pasa nada: la aplicación funciona con lo que ya tenga en
 * local y la interfaz lo dice.
 */
export function scheduleBackgroundSync(): void {
  const last = Number(meta('lastCheckedAt') ?? 0)
  const due = Date.now() - last > CHECK_INTERVAL_MS

  // Se espera un poco para no competir con el arranque de la ventana.
  setTimeout(
    () => {
      void sync({ force: false })
    },
    due ? 4000 : 60_000
  )

  setInterval(() => {
    void sync({ force: false })
  }, CHECK_INTERVAL_MS)
}
