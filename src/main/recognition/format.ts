/**
 * El contrato de los datos de reconocimiento: identificador de modelo y formato
 * del fichero de vectores que publica el catálogo.
 *
 * Este módulo no importa nada pesado a propósito. Lo usan el proceso principal
 * (para importar el catálogo y alimentar al reconocedor) y el generador de
 * catálogo; si arrastrase sharp o OpenCV, main cargaría decenas de megas de
 * código nativo sólo para leer una constante.
 */

/**
 * Identidad del modelo y su preproceso.
 *
 * Va escrita en cada fichero de vectores publicado y se compara al importarlo:
 * unos vectores calculados con otro modelo, u otro recorte, o otro tamaño de
 * entrada, no son comparables con los que saca la cámara. Al cambiar cualquiera
 * de esas cosas hay que subir este identificador y volver a publicar el
 * catálogo; las instalaciones antiguas seguirán usando los suyos hasta que se
 * actualicen, que es justo lo que se quiere.
 *
 *   dinov2s  modelo (DINOv2-small)
 *   u8       pesos cuantizados a entero de 8 bits
 *   224      lado de la entrada
 *   cls      se usa el token CLS como vector
 */
export const RECOG_MODEL_ID = 'dinov2s-u8-224-cls-v1'

/** Dimensiones del vector. */
export const EMBED_DIMS = 384

/** Los cuatro bytes con los que empieza un fichero de vectores. */
const MAGIC = 'CDXR'

export interface SidecarEntry {
  cardId: string
  lang: string
}

export interface Sidecar {
  model: string
  dims: number
  setId: string
  entries: SidecarEntry[]
  /** `entries.length * dims` valores, normalizados a longitud 1. */
  vectors: Float32Array
}

/**
 * Serializa los vectores de un set.
 *
 * Binario y no JSON porque son números en coma flotante: en JSON ocuparían el
 * triple y habría que preocuparse de perder precisión al imprimirlos. La
 * cabecera sí va en JSON, que es donde conviene poder leer qué hay dentro.
 *
 *   'CDXR' | longitud de la cabecera (uint32 LE) | cabecera JSON | matriz f32 LE
 */
export function encodeSidecar(sidecar: Sidecar): Buffer {
  const header = Buffer.from(
    JSON.stringify({
      model: sidecar.model,
      dims: sidecar.dims,
      dtype: 'f32',
      setId: sidecar.setId,
      count: sidecar.entries.length,
      entries: sidecar.entries
    }),
    'utf8'
  )
  const prefix = Buffer.alloc(8)
  prefix.write(MAGIC, 0, 'ascii')
  prefix.writeUInt32LE(header.length, 4)
  const body = Buffer.from(
    sidecar.vectors.buffer,
    sidecar.vectors.byteOffset,
    sidecar.vectors.byteLength
  )
  return Buffer.concat([prefix, header, body])
}

/**
 * Lee un fichero de vectores, comprobándolo todo.
 *
 * Llega de la red, así que se trata como dato hostil: se verifica el tamaño
 * declarado contra el real antes de reservar nada, y se rechaza cualquier
 * cabecera que no cuadre. Un fichero corrupto tiene que fallar aquí, no al
 * reconocer una carta.
 */
export function decodeSidecar(buffer: Buffer, expectedSetId: string): Sidecar {
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== MAGIC) {
    throw new Error('No es un fichero de vectores de Cardex')
  }
  const headerLength = buffer.readUInt32LE(4)
  if (headerLength <= 0 || headerLength > 8 * 1024 * 1024 || 8 + headerLength > buffer.length) {
    throw new Error('Cabecera de vectores con tamaño imposible')
  }

  let header: unknown
  try {
    header = JSON.parse(buffer.toString('utf8', 8, 8 + headerLength))
  } catch {
    throw new Error('Cabecera de vectores ilegible')
  }
  if (typeof header !== 'object' || header === null) throw new Error('Cabecera de vectores no válida')
  const h = header as Record<string, unknown>

  if (typeof h['model'] !== 'string') throw new Error('Los vectores no dicen de qué modelo salen')
  if (h['dtype'] !== 'f32') throw new Error(`Tipo de vector no soportado: ${String(h['dtype'])}`)
  const dims = Number(h['dims'])
  if (!Number.isInteger(dims) || dims < 1 || dims > 4096) throw new Error('Dimensiones no válidas')
  if (h['setId'] !== expectedSetId) {
    throw new Error(`Los vectores dicen ser de ${String(h['setId'])} y se esperaban de ${expectedSetId}`)
  }
  if (!Array.isArray(h['entries'])) throw new Error('Los vectores no traen índice de cartas')

  const entries: SidecarEntry[] = []
  for (const raw of h['entries']) {
    if (typeof raw !== 'object' || raw === null) throw new Error('Entrada de vector no válida')
    const e = raw as Record<string, unknown>
    if (typeof e['cardId'] !== 'string' || typeof e['lang'] !== 'string') {
      throw new Error('Entrada de vector incompleta')
    }
    entries.push({ cardId: e['cardId'], lang: e['lang'] })
  }

  const expectedBytes = entries.length * dims * 4
  const body = buffer.subarray(8 + headerLength)
  if (body.length !== expectedBytes) {
    throw new Error(`Los vectores ocupan ${body.length} bytes y deberían ocupar ${expectedBytes}`)
  }

  // Copia: el subarray comparte memoria con el buffer de la descarga, y ese
  // buffer se queda vivo entero mientras alguien conserve la vista.
  const vectors = new Float32Array(entries.length * dims)
  Buffer.from(vectors.buffer).set(body)

  return { model: h['model'], dims, setId: expectedSetId, entries, vectors }
}
