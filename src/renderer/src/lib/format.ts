import type { UiLang } from '@shared/types'

/**
 * Formato de cifras, portado del diseño.
 *
 * El dinero viaja en céntimos enteros desde la base de datos y sólo se
 * convierte a coma flotante aquí, en el último paso antes de pintarlo.
 */

/**
 * A partir de 100 se ocultan los decimales: en una rejilla de cartas, «486 €»
 * se lee mucho mejor que «486,00 €», y por debajo de esa cifra los céntimos sí
 * importan.
 */
export function money(cents: number | null | undefined, lang: UiLang): string {
  if (cents === null || cents === undefined) return '—'
  const v = cents / 100
  const whole = v >= 100 || v === 0
  const n = whole ? Math.round(v) : Math.round(v * 100) / 100
  const s = n.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2
  })
  return lang === 'es' ? `${s} €` : `€${s}`
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

/** Verde si sube, rojo si baja, apagado si no se mueve. */
export function deltaColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'var(--faint)'
  if (v > 0.05) return 'var(--ok)'
  if (v < -0.05) return 'oklch(.62 .17 25)'
  return 'var(--faint)'
}

/** Fecha corta para los movimientos: '04/2024'. */
export function monthYear(ms: number, lang: UiLang): string {
  return new Date(ms).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', {
    month: '2-digit',
    year: 'numeric'
  })
}

export function shortDate(ms: number, lang: UiLang): string {
  return new Date(ms).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

/** Días desde epoch -> fecha legible, para los ejes de las gráficas. */
export function dayToLabel(day: number, lang: UiLang): string {
  return new Date(day * 86400000)
    .toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
    .toUpperCase()
}

/**
 * Convierte una serie de valores en los puntos de un <polyline>.
 *
 * `pad` deja aire arriba y abajo para que la línea no se pegue al borde del
 * viewBox.
 */
export function polyline(values: number[], w: number, h: number, pad: number): string {
  if (values.length < 2) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - pad - ((v - lo) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** El mismo trazo, cerrado por abajo, para rellenar el área bajo la curva. */
export function polygonArea(values: number[], w: number, h: number, pad: number): string {
  const line = polyline(values, w, h, pad)
  return line ? `${line} ${w},${h} 0,${h}` : ''
}
