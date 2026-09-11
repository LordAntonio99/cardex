import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'

export type Db = Database.Database

/**
 * Pragmas que se aplican a TODA conexión nueva.
 *
 * `foreign_keys` merece una nota: en SQLite viene DESACTIVADO por defecto y es
 * por conexión, no por base. Ponerlo una sola vez al arrancar es el error más
 * repetido con esta biblioteca, así que vive aquí, en la factoría.
 */
function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL') // seguro bajo WAL y bastante más rápido
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -16000') // 16 MB
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456') // 256 MB
}

/** Carpetas de sincronización que corrompen SQLite si la base vive dentro. */
const SYNC_ROOTS = ['onedrive', 'dropbox', 'google drive', 'icloud', 'nextcloud', 'pcloud']

export function detectSyncRoot(dir: string): string | null {
  const low = dir.toLowerCase()
  return SYNC_ROOTS.find((r) => low.includes(r)) ?? null
}

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function imagesDir(): string {
  const dir = path.join(app.getPath('userData'), 'images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export const collectionPath = (): string => path.join(dataDir(), 'collection.db')
export const cataloguePath = (): string => path.join(dataDir(), 'catalogue.db')

/**
 * Conexión directa al catálogo, sin adjuntar.
 *
 * Se usa para migrarlo y para importar: las migraciones crean tablas sin
 * prefijo, así que tienen que correr sobre su propia conexión y no a través del
 * `cat.` de una base adjunta.
 */
export function openCatalogue(): Db {
  const db = new Database(cataloguePath())
  applyPragmas(db)
  return db
}

/** Conexión a la base del usuario, sin catálogo adjunto todavía. */
export function openCollection(): Db {
  const db = new Database(collectionPath())
  applyPragmas(db)
  return db
}

/**
 * Adjunta el catálogo como `cat` sobre una conexión de colección.
 *
 * Son dos ficheros a propósito. SQLite no admite claves foráneas entre bases
 * adjuntas, y eso convierte en imposible por construcción que una reimportación
 * de catálogo arrastre datos del usuario. Con un solo fichero, esa garantía
 * dependería de que nadie escriba nunca un ON DELETE CASCADE de más.
 */
export function attachCatalogue(db: Db): void {
  db.exec(`ATTACH DATABASE '${cataloguePath().replace(/'/g, "''")}' AS cat`)
}

export function detachCatalogue(db: Db): void {
  db.exec('DETACH DATABASE cat')
}

/** Deja el WAL recogido antes de cerrar, para no dejar ficheros sueltos. */
export function closeDatabases(db: Db): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Si falla el checkpoint no vale la pena impedir el cierre de la app.
  }
  db.close()
}
