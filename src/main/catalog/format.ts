import type { CatalogManifest, CatalogManifestRecognition, CatalogManifestSet } from '@shared/types'

/**
 * Formato del catálogo publicado en GitHub.
 *
 * Se valida a mano en vez de con una biblioteca de esquemas: son cuatro formas
 * y así no hay una dependencia más en el proceso main. Lo que llega de la red
 * es dato, nunca instrucción, así que todo campo se comprueba antes de tocar la
 * base de datos.
 */

/**
 * Una impresión concreta de una carta, con su precio.
 *
 * Es lo que separa un Charizard del Set Base holo unlimited (unos 590 €) del
 * mismo holo shadowless de 1ª edición (más de 3.500 €). El eje grueso
 * (`variant`) es el que enlaza con la colección del usuario; el resto de campos
 * se guardan para poder enseñarlos sin volver a descargar el catálogo.
 */
export interface CatalogPrinting {
  id: string
  kind?: string
  subtype?: string
  stamp?: string[]
  label?: string
  variant?: string
  sortKey?: number
  prices?: {
    source?: string
    currency?: string
    lowCents?: number | null
    trendCents?: number | null
    avg7Cents?: number | null
    avg30Cents?: number | null
    updatedAt?: string | null
  }[]
}

export interface CatalogSetFile {
  set: {
    id: string
    seriesId: string
    seriesName: string
    region?: string
    code?: string | null
    name: string
    names?: Record<string, string>
    releasedOn?: string | null
    totalOfficial?: number
    totalAll?: number
    logoPath?: string | null
    symbolPath?: string | null
    sortKey?: number
  }
  cards: {
    id: string
    localId: string
    name: string
    names?: Record<string, string>
    rarity?: string | null
    category?: string | null
    types?: string[]
    hp?: number | null
    illustrator?: string | null
    imagePath?: string | null
    variants?: string[]
    langs?: string[]
    packs?: string[]
    printings?: CatalogPrinting[]
  }[]
  packs?: {
    id: string
    name: string
    names?: Record<string, string>
    kind?: string
    artworkPath?: string | null
    logoPath?: string | null
  }[]
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function parseManifest(raw: unknown): CatalogManifest {
  if (!isObj(raw)) throw new Error('El manifiesto no es un objeto')

  const schemaVersion = Number(raw['schemaVersion'])
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('schemaVersion ausente o no válido en el manifiesto')
  }
  if (schemaVersion > SUPPORTED_SCHEMA) {
    throw new Error(
      `El catálogo usa el formato v${schemaVersion} y esta versión de Cardex entiende hasta la v${SUPPORTED_SCHEMA}. Actualiza la aplicación.`
    )
  }
  if (!isStr(raw['catalogVersion'])) throw new Error('catalogVersion ausente en el manifiesto')
  if (!Array.isArray(raw['sets'])) throw new Error('El manifiesto no trae lista de sets')

  const sets: CatalogManifestSet[] = []
  for (const entry of raw['sets']) {
    if (!isObj(entry)) continue
    const id = entry['id']
    const file = entry['file']
    const sha256 = entry['sha256']
    if (!isStr(id) || !isStr(file) || !isStr(sha256)) continue
    assertSafePath(file)
    sets.push({
      id,
      file,
      sha256: sha256.toLowerCase(),
      cardCount: Number(entry['cardCount']) || 0
    })
  }

  // Los vectores de reconocimiento son opcionales: un catálogo publicado antes
  // del escáner simplemente no trae la clave, y eso no es un error.
  const recognition: CatalogManifestRecognition[] = []
  if (Array.isArray(raw['recognition'])) {
    for (const entry of raw['recognition']) {
      if (!isObj(entry)) continue
      const id = entry['id']
      const file = entry['file']
      const sha256 = entry['sha256']
      const model = entry['model']
      if (!isStr(id) || !isStr(file) || !isStr(sha256) || !isStr(model)) continue
      assertSafePath(file)
      const dims = Number(entry['dims'])
      if (!Number.isInteger(dims) || dims < 1 || dims > 4096) continue
      if (entry['dtype'] !== 'f32') continue
      recognition.push({
        id,
        file,
        sha256: sha256.toLowerCase(),
        model,
        dims,
        dtype: 'f32',
        count: Number(entry['count']) || 0
      })
    }
  }

  return {
    schemaVersion,
    catalogVersion: raw['catalogVersion'],
    generatedAt: isStr(raw['generatedAt']) ? raw['generatedAt'] : '',
    sets,
    recognition
  }
}

/** Nada de rutas que se escapen del directorio del catálogo. */
function assertSafePath(file: string): void {
  if (file.includes('..') || file.startsWith('/') || /^[a-z]+:/i.test(file)) {
    throw new Error(`Ruta no permitida en el manifiesto: ${file}`)
  }
}

export const SUPPORTED_SCHEMA = 1

export function parseSetFile(raw: unknown, expectedId: string): CatalogSetFile {
  if (!isObj(raw)) throw new Error('El fichero de set no es un objeto')
  const set = raw['set']
  if (!isObj(set) || !isStr(set['id'])) throw new Error('El fichero de set no trae `set.id`')
  if (set['id'] !== expectedId) {
    throw new Error(`El fichero declara el set ${String(set['id'])} pero el manifiesto decía ${expectedId}`)
  }
  if (!isStr(set['name'])) throw new Error(`El set ${expectedId} no trae nombre`)
  if (!isStr(set['seriesId'])) throw new Error(`El set ${expectedId} no trae seriesId`)
  if (!Array.isArray(raw['cards'])) throw new Error(`El set ${expectedId} no trae lista de cartas`)

  const cards = raw['cards'].filter(
    (c): c is CatalogSetFile['cards'][number] =>
      isObj(c) && isStr(c['id']) && isStr(c['localId']) && isStr(c['name'])
  )

  const packs = Array.isArray(raw['packs'])
    ? raw['packs'].filter(
        (p): p is NonNullable<CatalogSetFile['packs']>[number] =>
          isObj(p) && isStr(p['id']) && isStr(p['name'])
      )
    : []

  return { set: set as CatalogSetFile['set'], cards, packs }
}

/**
 * Parte el número impreso en algo ordenable.
 *
 * '125' -> 125 + ''; 'TG05' -> 5 + 'TG'; 'SV107' -> 107 + 'SV'. Sin esto, un
 * ORDER BY textual coloca el 10 antes del 9 y el listado del set no vale nada.
 */
export function splitNumber(localId: string): { sort: number; suffix: string } {
  const m = /^(\D*)(\d+)(\D*)$/.exec(localId)
  if (!m) return { sort: 0, suffix: localId }
  return { sort: Number(m[2]), suffix: `${m[1] ?? ''}${m[3] ?? ''}` }
}

/** Convierte la lista de variantes a la máscara de bits de `cards.variant_mask`. */
export function variantMask(variants: string[] | undefined): number {
  if (!variants?.length) return 1
  let mask = 0
  if (variants.includes('normal')) mask |= 1
  if (variants.includes('holo')) mask |= 2
  if (variants.includes('reverse')) mask |= 4
  if (variants.includes('first_ed') || variants.includes('firstEdition')) mask |= 8
  return mask || 1
}
