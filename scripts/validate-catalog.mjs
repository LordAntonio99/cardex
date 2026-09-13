/**
 * Comprueba un catálogo generado contra todo lo que el importador exige.
 *
 *   node scripts/validate-catalog.mjs                 (./catalog)
 *   node scripts/validate-catalog.mjs ../otro/catalog
 *
 * Existe porque la alternativa es importar y leer el log. Con diez sets eso era
 * asumible; con ciento cuarenta no, y además el importador salta el set roto y
 * sigue, así que el fallo se pierde entre cientos de líneas de éxito. Esto tarda
 * segundos y encuentra lo mismo.
 *
 * Lo que pasa por aquí, el importador lo acepta. Lo que no, lo habría tirado en
 * silencio: un set que no entra no rompe nada visible, simplemente no está.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? 'catalog')

/** Agrupa por tipo de fallo en vez de escupir una línea por set. */
const fallos = new Map()
const anota = (tipo, detalle) => {
  if (!fallos.has(tipo)) fallos.set(tipo, [])
  fallos.get(tipo).push(detalle)
}

const leer = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'))

if (!existsSync(path.join(ROOT, 'manifest.json'))) {
  console.error(`No hay manifest.json en ${ROOT}`)
  process.exit(1)
}

const manifest = leer('manifest.json')

if (manifest.schemaVersion !== 1) anota('manifiesto', `schemaVersion = ${manifest.schemaVersion}`)
if (typeof manifest.catalogVersion !== 'string') anota('manifiesto', 'sin catalogVersion')

const ids = new Set()
// En Windows dos ficheros que sólo difieren en mayúsculas son el mismo fichero,
// y el segundo se lleva por delante al primero sin decir nada.
const porNombre = new Map()

for (const entrada of manifest.sets ?? []) {
  const { id, file } = entrada
  ids.add(id)
  porNombre.set(file.toLowerCase(), (porNombre.get(file.toLowerCase()) ?? 0) + 1)

  if (!existsSync(path.join(ROOT, file))) {
    anota('fichero ausente', id)
    continue
  }

  const doc = leer(file)
  const set = doc.set ?? {}

  // El importador compara el id que declara la ficha con el del manifiesto y
  // rechaza el set entero si no casan.
  if (set.id !== id) anota('id desajustado', `${id} -> ${set.id}`)
  if (typeof set.name !== 'string') anota('sin nombre', id)
  if (typeof set.seriesId !== 'string') anota('sin seriesId', id)

  if (!Array.isArray(doc.cards)) {
    anota('sin lista de cartas', id)
    continue
  }

  const vistas = new Set()
  for (const c of doc.cards) {
    if (typeof c?.id !== 'string' || typeof c?.localId !== 'string' || typeof c?.name !== 'string') {
      // El importador las filtra en silencio: entrarían menos cartas de las que
      // dice el manifiesto y nadie se enteraría.
      anota('cartas que el importador descarta', `${id}/${c?.id ?? '¿?'}`)
      continue
    }
    if (vistas.has(c.id)) anota('cartas repetidas', `${id}/${c.id}`)
    vistas.add(c.id)

    // Dos impresiones con el mismo identificador revientan el UNIQUE de
    // `card_printings`, y eso tira la transacción del set completo.
    const pids = (c.printings ?? []).map((p) => p.id)
    if (new Set(pids).size !== pids.length) anota('impresiones repetidas', `${id}/${c.id}`)
  }

  if (doc.cards.length !== entrada.cardCount) {
    anota('cardCount no casa', `${id}: manifiesto ${entrada.cardCount}, fichero ${doc.cards.length}`)
  }
}

for (const [nombre, n] of porNombre) {
  if (n > 1) anota('ficheros que chocan al ignorar mayúsculas', nombre)
}

for (const r of manifest.recognition ?? []) {
  if (!ids.has(r.id)) anota('vectores de un set que no existe', r.id)
  if (!existsSync(path.join(ROOT, r.file))) anota('fichero de vectores ausente', r.id)
}

const cartas = (manifest.sets ?? []).reduce((a, e) => a + e.cardCount, 0)
const vectores = (manifest.recognition ?? []).reduce((a, r) => a + r.count, 0)
console.log(
  `${ROOT}\n  ${manifest.sets?.length ?? 0} set(s), ${cartas} cartas, ${vectores} vector(es)`
)

if (fallos.size === 0) {
  console.log('\nTodo lo que el importador exige, cumplido.')
  process.exit(0)
}

console.log()
for (const [tipo, lista] of fallos) {
  console.log(`${tipo} (${lista.length}):`)
  for (const d of lista.slice(0, 8)) console.log(`   ${d}`)
  if (lista.length > 8) console.log(`   … y ${lista.length - 8} más`)
}
process.exit(1)
