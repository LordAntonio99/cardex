/**
 * Vectores de reconocimiento para el catálogo publicado.
 *
 * Calcula la huella visual de cada carta, en cada idioma en que existe, y la
 * escribe en un fichero binario por set. Es lo que el escáner compara con lo que
 * ve la cámara.
 *
 * Dos cosas que importan más de lo que parece:
 *
 *  - **Se carga `out/main/pipeline.js`**, el mismo código que usa el escáner, en
 *    vez de reimplementar el preproceso aquí. Si la referencia y la captura no
 *    pasan por exactamente el mismo redimensionado, recorte y normalización, el
 *    reconocimiento se degrada sin dar ningún error. Por eso hay que compilar
 *    (`npm run build`) antes de generar.
 *  - **Las imágenes no se publican.** Se descargan a `.cache/images/` para
 *    calcular el vector y se quedan ahí, en la máquina de quien genera el
 *    catálogo. Lo que se publica es el vector, que es un dato derivado del que
 *    no se puede reconstruir la ilustración.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PIPELINE = path.join(ROOT, 'out', 'main', 'pipeline.js')
const MODEL = path.join(ROOT, 'resources', 'models', 'dinov2-small', 'model.onnx')
const CACHE = path.join(ROOT, '.cache', 'images')

/**
 * De dónde baja la imagen de referencia cada juego.
 *
 * Tiene que ser la MISMA imagen que la aplicación enseña en calidad alta: el
 * vector se calcula sobre ella y la cámara se compara contra el vector. Si aquí
 * se pidiera un tamaño distinto del que sirve `images.ts`, no se rompería nada
 * de forma visible, simplemente reconocería algo peor.
 */
const IMAGE_SOURCES = {
  pokemon: {
    langs: (cardLangs) => (cardLangs?.length ? cardLangs : ['en']),
    url: (imagePath, lang) => `https://assets.tcgdex.net/${lang}/${imagePath}/high.webp`,
    // Sin prefijo de juego a propósito: es la ruta que ya usaba la caché, y
    // cambiarla obligaría a volver a bajar las 1.400 imágenes de Pokémon.
    file: (imagePath, lang) => path.join(lang, `${imagePath.replaceAll('/', '_')}.webp`)
  },
  riftbound: {
    // Riftbound sólo se imprime en inglés: un vector por carta y ya está.
    langs: () => ['en'],
    url: (imagePath) =>
      `https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/${imagePath}?w=744&fm=webp&q=85`,
    file: (imagePath) => path.join('riftbound', `${imagePath.replaceAll('/', '_')}.webp`)
  }
}

/** Carga el núcleo compilado, con un mensaje útil si falta. */
function loadPipeline() {
  if (!existsSync(PIPELINE)) {
    throw new Error(
      `Falta ${path.relative(ROOT, PIPELINE)}.\n` +
        'El generador usa el mismo código que el escáner, así que hay que compilarlo antes:\n' +
        '  npm run build'
    )
  }
  if (!existsSync(MODEL)) {
    throw new Error(
      `Falta el modelo en ${path.relative(ROOT, MODEL)}.\n  npm run models:fetch`
    )
  }
  return createRequire(import.meta.url)(PIPELINE)
}

/** Descarga la imagen de una carta, con caché en disco. */
async function fetchCardImage(source, imagePath, lang) {
  const file = path.join(CACHE, source.file(imagePath, lang))
  if (existsSync(file)) return readFile(file)

  const url = source.url(imagePath, lang)
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Cardex' },
        signal: AbortSignal.timeout(60_000)
      })
      // Un 404 no es un fallo: hay impresiones que TCGdex no tiene en ese
      // idioma aunque el set sí exista.
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, buf)
      return buf
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
  throw new Error(`No se ha podido descargar ${url}: ${lastError?.message ?? lastError}`)
}

/**
 * Calcula los vectores de un set ya construido.
 *
 * Devuelve `null` si no ha salido ni un vector, para no publicar un fichero
 * vacío que luego el importador tendría que saber ignorar.
 */
export async function buildRecognition(P, embedder, setId, cards, game = 'pokemon') {
  const source = IMAGE_SOURCES[game]
  if (!source) throw new Error(`No sé de dónde bajar las imágenes de ${game}`)

  const entries = []
  const vectors = []
  let missing = 0
  let turned = 0

  for (const card of cards) {
    if (!card.imagePath) continue
    // Un vector por idioma en que la carta existe de verdad. El Set Base nunca
    // se imprimió en español, y pedir su imagen ahí devuelve un 404.
    const langs = source.langs(card.langs)
    for (const lang of langs) {
      let bytes
      try {
        bytes = await fetchCardImage(source, card.imagePath, lang)
      } catch (e) {
        console.warn(`    ! ${card.id} (${lang}): ${e.message}`)
        continue
      }
      if (!bytes) {
        missing += 1
        continue
      }
      let img = await P.decodeToRgba(bytes)

      // Las cartas apaisadas —los campos de batalla de Riftbound— se giran a
      // vertical ANTES de reescalar. El escáner no puede entregarlas de otra
      // forma: `orderCorners` normaliza todo cuadrilátero a vertical, así que
      // la captura de una carta apaisada siempre llega girada. Sin esto la
      // referencia sería la única imagen del catálogo que no se parece a lo que
      // ve la cámara, y fallaría sin dar ningún error.
      if (img.width > img.height) {
        img = P.rotate90(img)
        turned += 1
      }

      const ref =
        img.width === P.CARD_W && img.height === P.CARD_H
          ? img
          : await P.resizeRgba(img, P.CARD_W, P.CARD_H)
      const vector = await embedder.embed(ref)
      entries.push({ cardId: card.id, lang })
      vectors.push(vector)
    }
  }

  if (turned) console.log(`    (${turned} carta(s) apaisada(s) giradas a vertical)`)

  if (!entries.length) return null
  if (missing) console.log(`    (${missing} imagen(es) sin publicar en su idioma)`)

  const flat = new Float32Array(entries.length * P.EMBED_DIMS)
  vectors.forEach((v, i) => flat.set(v, i * P.EMBED_DIMS))
  return { model: P.RECOG_MODEL_ID, dims: P.EMBED_DIMS, setId, entries, vectors: flat }
}

/** Abre el modelo una vez para todos los sets. */
export async function openEmbedder(P) {
  P.configureSharp()
  await P.loadCv()
  // Generar el catálogo es un trabajo por lotes y en una máquina de desarrollo:
  // aquí sí interesa usar todos los hilos.
  return P.createEmbedder(MODEL, 0)
}

export { loadPipeline }

/** Escribe el fichero de un set y devuelve su entrada de manifiesto. */
export async function writeSidecar(P, outDir, sidecar) {
  const body = P.encodeSidecar(sidecar)
  const file = `recog/${sidecar.setId}.${sidecar.model}.bin`
  const dest = path.join(outDir, file)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, body)
  return {
    id: sidecar.setId,
    file,
    sha256: createHash('sha256').update(body).digest('hex'),
    model: sidecar.model,
    dims: sidecar.dims,
    dtype: 'f32',
    count: sidecar.entries.length
  }
}
