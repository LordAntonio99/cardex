/**
 * Carga de OpenCV.js.
 *
 * El paquete es un único fichero UMD de 13 MB con el WASM embebido. Su
 * inicialización es asíncrona y, según la versión, se resuelve de dos formas
 * distintas: el módulo puede ser una promesa, o exponer `onRuntimeInitialized`.
 * Se contemplan ambas a propósito: es una dependencia que ha cambiado de forma
 * entre versiones y no merece la pena atarse a una.
 *
 * Sólo se carga en el proceso reconocedor. Nunca en el renderer: su CSP no
 * permite WebAssembly, y no se va a relajar por esto.
 */

import type cvType from '@techstark/opencv-js'

export type Cv = typeof cvType

let cached: Promise<Cv> | null = null

export function loadCv(): Promise<Cv> {
  cached ??= (async (): Promise<Cv> => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@techstark/opencv-js') as Cv & {
      then?: unknown
      onRuntimeInitialized?: () => void
    }
    if (typeof mod.then === 'function') return (await (mod as unknown as Promise<Cv>)) as Cv
    if (mod.Mat) return mod
    await new Promise<void>((resolve) => {
      mod.onRuntimeInitialized = resolve
    })
    return mod
  })()
  return cached
}

/**
 * Ejecuta `fn` y borra al salir todos los objetos registrados con `keep`.
 *
 * OpenCV.js vive en el montón de WebAssembly: cada `Mat` que no se borra es
 * memoria que no vuelve. Con un bucle de escaneo, olvidarse de un `delete` no
 * es una fuga lenta, es un aborto del WASM en cuestión de minutos.
 */
export function usingMats<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
  const pool: { delete(): void }[] = []
  const keep = <M extends { delete(): void }>(m: M): M => {
    pool.push(m)
    return m
  }
  try {
    return fn(keep)
  } finally {
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      try {
        pool[i]?.delete()
      } catch {
        // Un objeto ya borrado no debe impedir liberar los demás.
      }
    }
  }
}
