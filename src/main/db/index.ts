import { log } from '../log'
import {
  attachCatalogue,
  cataloguePath,
  closeDatabases,
  collectionPath,
  dataDir,
  detectSyncRoot,
  openCatalogue,
  openCollection,
  type Db
} from './connection'
import { CATALOGUE_MIGRATIONS, COLLECTION_MIGRATIONS, backupBeforeMigration, migrate } from './migrate'

let db: Db | null = null

/**
 * Deja las dos bases listas y devuelve la conexión de trabajo.
 *
 * Orden importante:
 *  1. Se migra el catálogo sobre su propia conexión (las migraciones crean
 *     tablas sin prefijo, no valdría hacerlo a través de `cat.`).
 *  2. Se respalda y se migra la base del usuario.
 *  3. Sólo entonces se adjunta el catálogo.
 */
export function initDatabases(): Db {
  if (db) return db

  const dir = dataDir()
  const syncRoot = detectSyncRoot(dir)
  if (syncRoot) {
    log.warn(
      `La base de datos vive dentro de una carpeta de ${syncRoot}. ` +
        'SQLite y las carpetas sincronizadas se llevan mal: hay riesgo real de corrupción. ' +
        `Ruta: ${dir}`
    )
  }

  // 1. Catálogo
  const cat = openCatalogue()
  try {
    const r = migrate(cat, CATALOGUE_MIGRATIONS)
    if (r.applied.length) log.info(`catalogue.db migrado ${r.from} -> ${r.to}: ${r.applied.join(', ')}`)
  } finally {
    cat.close()
  }

  // 2. Colección, con copia previa si hay algo que migrar
  const target = Math.max(...COLLECTION_MIGRATIONS.map((m) => m.version))
  const probe = openCollection()
  const currentVersion = Number(probe.pragma('user_version', { simple: true }))
  probe.close()
  if (currentVersion > 0 && currentVersion < target) {
    const backup = backupBeforeMigration(collectionPath(), target)
    if (backup) log.info(`Copia previa a la migración: ${backup}`)
  }

  const conn = openCollection()
  const r = migrate(conn, COLLECTION_MIGRATIONS)
  if (r.applied.length) log.info(`collection.db migrado ${r.from} -> ${r.to}: ${r.applied.join(', ')}`)

  // 3. Adjuntar catálogo
  attachCatalogue(conn)

  log.info(`Bases abiertas: ${collectionPath()} + ${cataloguePath()}`)
  db = conn
  return db
}

/** La conexión ya inicializada. Falla ruidosamente si se pide antes de tiempo. */
export function getDb(): Db {
  if (!db) throw new Error('initDatabases() no se ha llamado todavía')
  return db
}

export function shutdownDatabases(): void {
  if (!db) return
  closeDatabases(db)
  db = null
}

export { cataloguePath, collectionPath, dataDir } from './connection'
export type { Db } from './connection'
