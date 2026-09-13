import { copyFileSync, existsSync } from 'node:fs'
import type { Db } from './connection'

import catalogue001 from './migrations/catalogue/001_init.sql?raw'
import catalogue002 from './migrations/catalogue/002_printings.sql?raw'
import catalogue003 from './migrations/catalogue/003_variant_price.sql?raw'
import catalogue004 from './migrations/catalogue/004_recognition.sql?raw'
import catalogue005 from './migrations/catalogue/005_games.sql?raw'
import catalogue006 from './migrations/catalogue/006_price_source.sql?raw'
import catalogue007 from './migrations/catalogue/007_tags.sql?raw'
import collection001 from './migrations/collection/001_init.sql?raw'

export interface Migration {
  /** Número de versión al que lleva esta migración. Consecutivo desde 1. */
  version: number
  name: string
  sql: string
}

/**
 * Las migraciones del catálogo. Esta base es reemplazable, así que en el peor
 * caso siempre se puede borrar y volver a sincronizar.
 */
export const CATALOGUE_MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: catalogue001 },
  { version: 2, name: 'printings', sql: catalogue002 },
  { version: 3, name: 'variant_price', sql: catalogue003 },
  { version: 4, name: 'recognition', sql: catalogue004 },
  { version: 5, name: 'games', sql: catalogue005 },
  { version: 6, name: 'price_source', sql: catalogue006 },
  { version: 7, name: 'tags', sql: catalogue007 }
]

/**
 * Las migraciones de la colección. Aquí no hay red de seguridad: se hace copia
 * antes de tocar nada.
 */
export const COLLECTION_MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: collection001 }
]

export interface MigrateResult {
  from: number
  to: number
  applied: string[]
}

/**
 * Aplica las migraciones pendientes usando `PRAGMA user_version` como contador.
 *
 * Cada migración va en su propia transacción: si la 3 falla, la 2 queda
 * aplicada y el contador refleja la realidad, en vez de dejar la base en un
 * estado que no corresponde a ninguna versión.
 */
export function migrate(db: Db, migrations: Migration[]): MigrateResult {
  const current = Number(db.pragma('user_version', { simple: true }))
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  const applied: string[] = []

  for (const m of pending) {
    const run = db.transaction(() => {
      db.exec(m.sql)
      // user_version no admite parámetros enlazados.
      db.pragma(`user_version = ${m.version}`)
    })
    run()
    applied.push(`${m.version}_${m.name}`)
  }

  return { from: current, to: current + applied.length, applied }
}

/**
 * Copia de seguridad antes de migrar la base del usuario.
 *
 * Se usa copyFileSync sobre un fichero que todavía no se ha abierto: en ese
 * momento no hay WAL pendiente. Para copiar una base ya abierta hay que usar
 * `db.backup()`, porque con WAL una copia ingenua de los tres ficheros produce
 * un respaldo corrupto.
 */
export function backupBeforeMigration(dbPath: string, targetVersion: number): string | null {
  if (!existsSync(dbPath)) return null
  const dest = `${dbPath}.bak-v${targetVersion}`
  try {
    copyFileSync(dbPath, dest)
    return dest
  } catch {
    return null
  }
}
