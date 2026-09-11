import type { Effect3d } from '@shared/types'
import { PRESETS, type Preset } from './holo'

/**
 * Inclinación y brillo de las cartas con el puntero.
 *
 * Un ÚNICO listener a nivel de documento para toda la rejilla, como en el
 * diseño original. Nada de esto pasa por React: se escriben las variables CSS
 * directamente en el nodo, así que mover el ratón sobre cien cartas no provoca
 * ni un renderizado.
 *
 * Tres cosas que importan para que esto vaya fino:
 *
 *  - El rectángulo de la carta se cachea al entrar. Llamar a
 *    getBoundingClientRect() en cada pointermove fuerza un reflujo sincrónico
 *    sesenta veces por segundo.
 *  - Las escrituras se agrupan en un requestAnimationFrame.
 *  - `will-change` se pone al entrar y se quita al salir. Dejarlo fijo en CSS
 *    reservaría una capa de compositor por carta visible y agotaría el
 *    presupuesto de memoria de Chromium.
 */

const CARD_SELECTOR = '[data-c3d]'

let preset: Preset = PRESETS.prism
let hot: HTMLElement | null = null
let rect: DOMRect | null = null
let frame = 0
let pointer: { x: number; y: number } | null = null
let reduceMotion = false

export function setPointerPreset(effect: Effect3d): void {
  preset = PRESETS[effect]
}

export function setPointerReducedMotion(value: boolean): void {
  reduceMotion = value
  if (value && hot) cool()
}

function cool(): void {
  if (!hot) return
  const s = hot.style
  s.setProperty('--ry', '0deg')
  s.setProperty('--rx', '0deg')
  s.setProperty('--lift', '0px')
  s.setProperty('--glow', '0')
  hot.querySelector('.card-3d')?.classList.remove('is-hot')
  hot = null
  rect = null
  pointer = null
}

function apply(): void {
  frame = 0
  if (!hot || !rect || !pointer) return

  const px = Math.min(1, Math.max(0, (pointer.x - rect.left) / rect.width))
  const py = Math.min(1, Math.max(0, (pointer.y - rect.top) / rect.height))
  const s = hot.style

  s.setProperty('--ry', `${((px - 0.5) * 2 * preset.tilt).toFixed(2)}deg`)
  s.setProperty('--rx', `${(-(py - 0.5) * 2 * preset.tilt).toFixed(2)}deg`)
  s.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
  s.setProperty('--my', `${(py * 100).toFixed(1)}%`)
  s.setProperty('--mxn', (px * 100).toFixed(1))
  s.setProperty('--myn', (py * 100).toFixed(1))
  s.setProperty('--lift', `${preset.lift}px`)
  s.setProperty('--glow', '1')
}

function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(apply)
}

function onPointerMove(e: PointerEvent): void {
  if (reduceMotion) return

  const target = e.target as Element | null
  const card = target?.closest?.(CARD_SELECTOR) as HTMLElement | null

  if (!card) {
    if (hot) cool()
    return
  }

  if (card !== hot) {
    cool()
    hot = card
    rect = card.getBoundingClientRect()
    card.querySelector('.card-3d')?.classList.add('is-hot')
  }

  pointer = { x: e.clientX, y: e.clientY }
  schedule()
}

/**
 * Al desplazar, el rectángulo cacheado deja de ser válido. En vez de
 * recalcularlo, se descarta: el siguiente movimiento del puntero lo vuelve a
 * medir, y mientras tanto la carta se queda quieta, que es lo natural.
 */
function onScroll(): void {
  if (hot) cool()
}

export function installCardPointer(): () => void {
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  document.addEventListener('pointerleave', onScroll, { capture: true, passive: true })
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('resize', onScroll, { passive: true })

  return () => {
    document.removeEventListener('pointermove', onPointerMove, { capture: true })
    document.removeEventListener('pointerleave', onScroll, { capture: true })
    window.removeEventListener('scroll', onScroll, { capture: true })
    window.removeEventListener('resize', onScroll)
    if (frame) cancelAnimationFrame(frame)
    cool()
  }
}

/**
 * Voltea la carta.
 *
 * Se hace sobre el DOM y no con estado de React para que voltear una carta no
 * vuelva a renderizar la rejilla entera. `data-nof` marca los elementos que no
 * deben provocar volteo, como el botón de la ficha.
 */
export function flipCard(event: React.MouseEvent<HTMLElement>): void {
  const target = event.target as Element | null
  if (target?.closest('[data-nof]')) return

  const card = event.currentTarget
  const flipped = card.dataset['flipped'] === '1'
  card.dataset['flipped'] = flipped ? '0' : '1'
  card.style.setProperty('--flip', flipped ? '0deg' : '180deg')
}
