#!/usr/bin/env node
/**
 * Sirve el catálogo generado por `build-catalog.mjs` en local, para poder
 * probar la importación sin publicar nada en GitHub.
 *
 *   npm run catalog:sample      genera un catálogo pequeño en ./catalog
 *   npm run catalog:serve       lo sirve en http://localhost:8787
 *
 * Y en otra terminal, la aplicación apuntando ahí:
 *
 *   CARDEX_CATALOG_BASE=http://localhost:8787 npm run dev        (bash)
 *   $env:CARDEX_CATALOG_BASE="http://localhost:8787"; npm run dev (PowerShell)
 *
 * La variable sólo se atiende cuando la aplicación no está empaquetada.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? 'catalog')
const PORT = Number(process.argv[3] ?? 8787)

createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '').replace(/^\/+/, '')
  const abs = path.resolve(ROOT, rel)

  // Contención: nunca servir fuera del directorio del catálogo.
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end('fuera del directorio del catálogo')
    return
  }

  try {
    const body = await readFile(abs)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
    console.log(`200 ${rel}`)
  } catch {
    res.writeHead(404).end('no encontrado')
    console.log(`404 ${rel}`)
  }
}).listen(PORT, () => {
  console.log(`Catálogo servido en http://localhost:${PORT}`)
  console.log(`  desde ${ROOT}`)
  console.log(`\nArranca la aplicación con CARDEX_CATALOG_BASE=http://localhost:${PORT}`)
})
