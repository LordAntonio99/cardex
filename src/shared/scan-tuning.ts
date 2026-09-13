/**
 * Ajustes del disparo automático.
 *
 * Viven aquí, y no junto a cada cámara, porque hay dos disparadores con el
 * mismo esqueleto y números distintos: la webcam del PC, que está quieta sobre
 * la mesa, y el móvil, que va en la mano. Tenerlos juntos no ahorra líneas —
 * ahorra la pregunta de por qué difieren.
 *
 * Sin nada de DOM a propósito: lo compilan los dos proyectos de TypeScript, y
 * el servidor del móvil inyecta `HANDHELD` en la página como JSON.
 */

/** Lado del lienzo de trabajo. Con esto sobra para medir movimiento. */
export const WORK_W = 96
export const WORK_H = 132

/** Veces por segundo que se mira el fotograma. */
export const TICK_HZ = 8

/**
 * Webcam: cámara fija.
 *
 * `presenceOn` es cuánto tiene que cambiar el marco respecto al fondo vacío
 * para creer que hay algo; `motionStill`, cuánto puede cambiar entre fotogramas
 * para considerarlo quieto. Son generosos a propósito: equivocarse disparando
 * de más sólo cuesta 100 ms de reconocimiento, y el resultado malo se descarta
 * solo.
 */
export const WEBCAM = {
  presenceOn: 14,
  presenceOff: 7,
  motionStill: 3.2,
  stillTicks: 4,
  clearTicks: 6
} as const

/**
 * Móvil: cámara en la mano.
 *
 * No son los números de arriba retocados, es otro algoritmo, y conviene
 * entender por qué. La webcam mide «presencia» contra un fondo vacío aprendido
 * y se rearma esperando a que el marco vuelva a quedarse vacío. Las dos cosas
 * asumen que la cámara no se mueve. Con el móvil en la mano el fondo aprendido
 * caduca en el primer temblor: la presencia se queda alta para siempre, el
 * marco no vuelve a estar «vacío» nunca, y el disparo se queda desarmado
 * después de la primera carta.
 *
 * Así que aquí la presencia se sustituye por TEXTURA —el gradiente medio, que
 * no necesita ningún fondo de referencia— y el rearme es por MOVIMIENTO: se
 * entiende que hay carta nueva cuando el usuario mueve el móvil.
 *
 * `focusDelayMs` no es cosmético. Disparar en el instante en que la escena se
 * queda quieta captura el fotograma ANTES de que converja el autofoco, y el
 * reconocedor lo devuelve `blurry`. Se espera, se reconfirma la quietud y
 * entonces se dispara.
 */
export const HANDHELD = {
  /** Gradiente medio mínimo para creer que hay una carta en el marco. */
  detailMin: 6,
  /**
   * Holgura sobre el suelo de ruido, que se aprende solo.
   *
   * Aquí había un umbral fijo de movimiento y no servía: el pulso de cada
   * persona es distinto, y con el móvil en la mano nunca bajaba de él, así que
   * el disparo no saltaba jamás. Ahora se mide cuánto se mueve la imagen en su
   * momento MÁS quieto de los últimos segundos —eso es el suelo— y se considera
   * quieta cuando no se aleja de su propio suelo más que esto.
   */
  motionSlack: 2.2,
  /** Por firme que sea el pulso, por encima de esto hay movimiento de verdad. */
  motionCeiling: 14,
  /** Ticks sobre los que se aprende el suelo. A 8 Hz, unos tres segundos. */
  floorWindow: 24,
  stillTicks: 4,
  rearmTicks: 2,
  /**
   * Antes de disparar se espera a que converja el autofoco. Capturar en el
   * instante en que la escena se queda quieta devuelve `blurry`.
   */
  focusDelayMs: 350
} as const

/**
 * Lado largo al que el móvil reduce la foto antes de subirla.
 *
 * Una foto de 12 MP son cuatro megas y el Wi-Fi se convierte en el cuello de
 * botella. El reconocedor rectifica la carta a 600x825 y la incrusta a 224x224,
 * así que por encima de esto no hay ninguna ganancia: con 2048 px de lado, una
 * carta que ocupe un tercio del encuadre sigue llegando con holgura.
 */
export const PHONE_MAX_EDGE = 2048
export const PHONE_JPEG_QUALITY = 0.85

/** Tope del cuerpo de una captura. Muy por encima de lo anterior, a propósito. */
export const PHONE_MAX_UPLOAD = 12 * 1024 * 1024

/** Capturas simultáneas que el servidor acepta antes de responder 429. */
export const PHONE_MAX_INFLIGHT = 2

/** Dos capturas más juntas que esto son la misma carta contada dos veces. */
export const PHONE_DEBOUNCE_MS = 400

/** Cada cuánto late el móvil, y cuánto se espera antes de darlo por ido. */
export const PHONE_PING_MS = 3000
export const PHONE_STALE_MS = 8000
