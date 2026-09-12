#!/usr/bin/env node
/**
 * Descarga los modelos de reconocimiento a `resources/models/`.
 *
 * Los modelos NO se versionan: pesan decenas de megas y no son código. Lo que sí
 * se versiona es `scripts/models.lock.json`, que fija de qué revisión exacta sale
 * cada fichero y con qué sha256 debe coincidir. Así la compilación es
 * reproducible y un fichero corrupto o cambiado se detecta aquí y no en medio de
 * una inferencia.
 *
 * Es idempotente: si el fichero ya está y su hash cuadra, no lo vuelve a bajar.
 *
 *   node scripts/fetch-models.mjs                 descarga y verifica
 *   node scripts/fetch-models.mjs --update-lock   recalcula los sha256 del lock
 *
 * `--update-lock` sólo se usa al cambiar de modelo o de revisión, y el cambio
 * del lock se revisa como cualquier otro código.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = path.join(ROOT, 'scripts', 'models.lock.json')
const OUT = path.join(ROOT, 'resources', 'models')
const HF = 'https://huggingface.co'

const updateLock = process.argv.includes('--update-lock')

/** sha256 en hexadecimal de un buffer. */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** URL de descarga de un fichero de Hugging Face fijado a una revisión. */
const urlFor = (model, file) =>
  `${HF}/${model.source.split('/').slice(-2).join('/')}/resolve/${model.revision}/${file.remote}`

/** Descarga con reintentos: la red falla, y bajarse 20 MB dos veces no es drama. */
async function download(url) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Cardex' },
        signal: AbortSignal.timeout(300_000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error(`No se ha podido descargar ${url}: ${lastError?.message ?? lastError}`)
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

async function main() {
  const lock = JSON.parse(await readFile(LOCK, 'utf8'))
  let lockChanged = false

  for (const model of lock.models) {
    const dir = path.join(OUT, model.dir)
    await mkdir(dir, { recursive: true })

    for (const file of model.files) {
      const dest = path.join(dir, file.path)
      const url = urlFor(model, file)

      // Ya está y cuadra: no se toca.
      if (existsSync(dest) && file.sha256) {
        const have = sha256(await readFile(dest))
        if (have === file.sha256) {
          console.log(`= ${model.id}/${file.path} (${mb((await stat(dest)).size)})`)
          continue
        }
        console.log(`! ${model.id}/${file.path} no coincide con el lock, se vuelve a descargar`)
      }

      console.log(`↓ ${model.id}/${file.path} <- ${url}`)
      const body = await download(url)
      const got = sha256(body)

      if (file.sha256 && got !== file.sha256) {
        if (!updateLock) {
          throw new Error(
            `El sha256 de ${model.id}/${file.path} no coincide.\n` +
              `  esperado ${file.sha256}\n  obtenido ${got}\n` +
              'Si el cambio es intencionado, ejecuta: node scripts/fetch-models.mjs --update-lock'
          )
        }
      }

      if (!file.sha256 || (updateLock && got !== file.sha256)) {
        file.sha256 = got
        file.bytes = body.length
        lockChanged = true
      }

      // Escritura atómica: un fichero a medias sería peor que no tenerlo.
      const tmp = `${dest}.tmp`
      await writeFile(tmp, body)
      await rename(tmp, dest)
      console.log(`✓ ${model.id}/${file.path} (${mb(body.length)}) ${got.slice(0, 12)}…`)
    }
  }

  if (lockChanged) {
    await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
    console.log(`\nActualizado ${path.relative(ROOT, LOCK)}. Revísalo y súbelo con el cambio.`)
  }

  console.log(`\nModelos en ${path.relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
