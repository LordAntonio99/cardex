import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Electron 44.3 -> Chromium 152 / Node 24.20.
// Fijamos los targets a mano: si no, Vite rebaja el CSS a "baseline" y transforma
// oklch(), el anidamiento y @property, que son justo las piezas que usa el diseño.
const CHROME = 'chrome152'
const NODE = 'node24'

const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      target: NODE,
      // electron-vite 5: sustituye al deprecado externalizeDepsPlugin().
      externalizeDeps: true,
      rollupOptions: {
        // Tres entradas, no una:
        //  - index      el proceso principal;
        //  - recognizer el proceso auxiliar de reconocimiento, que main lanza
        //               con utilityProcess.fork(join(__dirname, 'recognizer.js'));
        //  - pipeline   el núcleo de visión, sin `electron`, que comparten el
        //               reconocedor, el generador de catálogo y el evaluador.
        //               Que sea una entrada propia es lo que permite a los
        //               scripts de Node cargar EXACTAMENTE el mismo preproceso
        //               con el que se calcularon los vectores publicados.
        input: {
          index: resolve('src/main/index.ts'),
          recognizer: resolve('src/main/recognition/process.ts'),
          pipeline: resolve('src/main/recognition/pipeline.ts')
        },
        // Cargan binarios nativos o un WASM enorme: nunca se empaquetan.
        external: ['better-sqlite3', 'onnxruntime-node', 'sharp', '@techstark/opencv-js']
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      target: NODE,
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // El preload corre en sandbox: tiene que salir en CommonJS.
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      target: CHROME,
      cssTarget: CHROME,
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})
