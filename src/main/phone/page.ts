import { readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  HANDHELD,
  PHONE_JPEG_QUALITY,
  PHONE_MAX_EDGE,
  PHONE_PING_MS,
  TICK_HZ,
  WORK_H,
  WORK_W
} from '@shared/scan-tuning'
import type { UiLang } from '@shared/types'
import template from './page.html?raw'

/**
 * La página que ve el móvil.
 *
 * Es un único HTML autocontenido servido desde memoria, y no una entrada más de
 * Vite, porque convertirla en una entrada obligaría a resolver rutas distintas
 * en desarrollo y en producción y a hacer de intermediario con el servidor de
 * desarrollo, sin ganar nada: es una pantalla con un vídeo y dos botones.
 *
 * Los ajustes del disparo no están escritos dentro del HTML: se inyectan desde
 * `@shared/scan-tuning`, que es también de donde los lee la webcam del PC. El
 * algoritmo es distinto en cada sitio —y hay un comentario largo allí
 * explicando por qué— pero los números viven en un solo lugar.
 */

export interface PhonePageConfig {
  token: string
  lang: UiLang
  /** Disparo automático, espejo del mismo ajuste de la aplicación. */
  auto: boolean
  /** `?debug=1`: pinta textura y movimiento en pantalla para poder calibrar. */
  debug: boolean
}

/**
 * Ancho de la guía sobre el ancho de la imagen.
 *
 * Bastante mayor que el 38% de la webcam: con el móvil en la mano la carta se
 * acerca hasta llenar el encuadre, y una guía pequeña obligaría a alejarse justo
 * hasta donde se pierde el detalle que se ha venido a ganar.
 */
const GUIDE_WIDTH = 0.62

function source(): string {
  // En desarrollo se lee del disco en cada petición. Si no, cada retoque del
  // HTML reiniciaría el proceso principal y mataría la sesión del móvil, que es
  // justo lo que se está intentando probar.
  if (app.isPackaged) return template
  try {
    return readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'phone', 'page.html'), 'utf8')
  } catch {
    return template
  }
}

export function renderPhonePage(cfg: PhonePageConfig, nonce: string): string {
  const config = {
    token: cfg.token,
    lang: cfg.lang,
    auto: cfg.auto,
    debug: cfg.debug,
    workW: WORK_W,
    workH: WORK_H,
    tickHz: TICK_HZ,
    guideWidth: GUIDE_WIDTH,
    maxEdge: PHONE_MAX_EDGE,
    quality: PHONE_JPEG_QUALITY,
    pingMs: PHONE_PING_MS,
    ...HANDHELD
  }

  return source()
    .replace(
      '__CARDEX_CONFIG__',
      // Escapar `<` es un hábito de dos caracteres: dentro de un <script>, un
      // valor que contuviera `</script>` cerraría la etiqueta antes de tiempo.
      JSON.stringify(config).replace(/</g, '\\u003c')
    )
    .replaceAll('__NONCE__', nonce)
}
