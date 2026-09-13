import type { CardTypeKey, Effect3d } from '@shared/types'

/**
 * Constantes del efecto holográfico, portadas del diseño.
 *
 * Una diferencia respecto al mockup: allí las tablas van indexadas por el
 * nombre de la rareza en español ('Holo Rara'). Aquí no sirve, porque la rareza
 * llega del catálogo y cambia con el idioma ('Rara Doble' / 'Double Rare').
 * Se clasifica primero a un nivel interno y ese nivel es el que manda.
 */

// ── Preajustes del efecto 3D ─────────────────────────────────────────────────

export interface Preset {
  /** Grados máximos de inclinación con el puntero en el borde. */
  tilt: number
  /** Cuánto se levanta la carta, en px (negativo = hacia el observador). */
  lift: number
  /** Peso de cada uno de los tres patrones de foil. */
  holoA: number
  holoB: number
  holoC: number
  /** Intensidad del reflejo especular. */
  glare: number
  /** Sombra: desplazamiento, difuminado y opacidad. */
  shy: number
  shb: number
  sho: number
}

export const PRESETS: Record<Effect3d, Preset> = {
  rainbow: { tilt: 15, lift: -16, holoA: 1, holoB: 0.35, holoC: 0.45, glare: 0.26, shy: 22, shb: 44, sho: 0.34 },
  prism: { tilt: 23, lift: -26, holoA: 0.45, holoB: 1, holoC: 0.28, glare: 0.3, shy: 32, shb: 26, sho: 0.55 },
  glitter: { tilt: 10, lift: -12, holoA: 0.38, holoB: 0.22, holoC: 1, glare: 0.2, shy: 14, shb: 54, sho: 0.3 }
}

/** Escribe el preajuste activo en :root. Lo leen las capas desde CSS. */
export function applyPreset(preset: Effect3d): void {
  const p = PRESETS[preset]
  const s = document.documentElement.style
  s.setProperty('--pa', String(p.holoA))
  s.setProperty('--pb', String(p.holoB))
  s.setProperty('--pc', String(p.holoC))
  s.setProperty('--pglare', String(p.glare))
  s.setProperty('--shy', `${p.shy}px`)
  s.setProperty('--shb', `${p.shb}px`)
  s.setProperty('--sho', String(p.sho))
}

// ── Rareza ───────────────────────────────────────────────────────────────────

export type RarityTier = 'common' | 'rare' | 'holo' | 'ultra' | 'special'

/**
 * Cómo brilla cada nivel.
 *
 * `f*` afecta a toda la carta y `w*` sólo a la ventana de la ilustración: en
 * una holo clásica brilla el recuadro del dibujo, mientras que en una ultra o
 * una ilustración especial brilla la carta entera. `rest` es el brillo en
 * reposo, porque un foil de verdad no se apaga del todo.
 */
export interface HoloWeights {
  fa: number
  fb: number
  fc: number
  wa: number
  wb: number
  wc: number
  rest: number
}

export const RARITY_HOLO: Record<RarityTier, HoloWeights> = {
  common: { fa: 0, fb: 0, fc: 0, wa: 0, wb: 0, wc: 0, rest: 0 },
  rare: { fa: 0, fb: 0, fc: 0, wa: 0.24, wb: 0.18, wc: 0.18, rest: 0.05 },
  holo: { fa: 0, fb: 0, fc: 0, wa: 0.62, wb: 0.52, wc: 0.5, rest: 0.07 },
  ultra: { fa: 0.42, fb: 0.4, fc: 0.36, wa: 0, wb: 0, wc: 0, rest: 0.06 },
  special: { fa: 0.58, fb: 0.52, fc: 0.52, wa: 0, wb: 0, wc: 0, rest: 0.08 }
}

/** Color del borde y del texto de la etiqueta de rareza. */
export const RARITY_TONE: Record<RarityTier, { border: string; color: string }> = {
  common: { border: 'var(--rule)', color: 'var(--faint)' },
  rare: { border: 'var(--rule)', color: 'var(--soft)' },
  holo: { border: 'rgba(151,113,226,.5)', color: 'var(--ac)' },
  ultra: { border: 'rgba(151,113,226,.75)', color: 'var(--ac)' },
  special: { border: 'var(--ink)', color: 'var(--ink)' }
}

/**
 * Clasifica la rareza que venga del catálogo.
 *
 * Se hace por patrones y no por lista cerrada porque cada set nuevo estrena
 * nombres de rareza, y es preferible que una rareza desconocida caiga en un
 * nivel razonable a que la carta se quede sin brillo.
 */
export function rarityTier(rarity: string | null): RarityTier {
  if (!rarity) return 'common'
  const r = rarity
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

  // Riftbound: showcase es su rareza de vitrina y epic la de arriba del sobre.
  if (
    /ilustracion|illustration|hyper|hiper|rainbow|arcoiris|gold|oro|inmersiva|immersive|showcase/.test(
      r
    )
  ) {
    return 'special'
  }
  if (/ultra|doble|double|secret|secreta|shiny|brillante|ace spec|radiant|prisma|epic/.test(r)) {
    return 'ultra'
  }
  if (/holo|\bex\b|\bgx\b|\bv\b|vmax|vstar|estrella/.test(r)) return 'holo'
  // 'uncommon' NO entra aquí: contiene 'common' y no 'rare', así que cae sola
  // al nivel común, que es donde va.
  if (/rara|rare/.test(r)) return 'rare'
  return 'common'
}

// ── Tipos y dominios ─────────────────────────────────────────────────────────

/**
 * Par de colores por tipo, en oklch como el diseño. El primero es la luz de la
 * ilustración y el segundo el cuerpo del marco.
 *
 * La tabla mezcla los once tipos de Pokémon y los siete dominios de Riftbound
 * porque la clave es única: no hay ningún nombre que signifique cosas distintas
 * en los dos juegos, y `Colorless`, que sí comparten, significa lo mismo en
 * ambos. Los tonos de Riftbound salen de los que publica la propia galería de
 * Riot para cada dominio.
 *
 * La clave llega del catálogo SIEMPRE en inglés canónico. Si se colara un valor
 * traducido, la carta se iría al color por defecto sin dar ningún error: por eso
 * el generador los toma de la versión inglesa en los dos juegos.
 */
export const TYPE_COLORS: Record<CardTypeKey, [string, string]> = {
  // Pokémon
  Fire: ['oklch(.64 .17 42)', 'oklch(.32 .12 34)'],
  Water: ['oklch(.63 .13 235)', 'oklch(.3 .09 240)'],
  Grass: ['oklch(.64 .14 148)', 'oklch(.3 .09 152)'],
  Lightning: ['oklch(.79 .14 96)', 'oklch(.37 .1 92)'],
  Psychic: ['oklch(.63 .15 320)', 'oklch(.31 .1 314)'],
  Fighting: ['oklch(.58 .13 48)', 'oklch(.28 .08 42)'],
  Darkness: ['oklch(.46 .05 282)', 'oklch(.2 .03 282)'],
  Metal: ['oklch(.66 .02 240)', 'oklch(.33 .02 240)'],
  Dragon: ['oklch(.61 .12 72)', 'oklch(.28 .08 72)'],
  Fairy: ['oklch(.71 .12 350)', 'oklch(.36 .08 350)'],

  // Riftbound
  Fury: ['oklch(.62 .17 25)', 'oklch(.3 .11 22)'],
  Calm: ['oklch(.66 .14 140)', 'oklch(.31 .09 142)'],
  Mind: ['oklch(.66 .12 232)', 'oklch(.31 .08 236)'],
  Body: ['oklch(.68 .12 62)', 'oklch(.32 .08 58)'],
  Chaos: ['oklch(.6 .16 305)', 'oklch(.29 .11 305)'],
  Order: ['oklch(.78 .13 88)', 'oklch(.36 .09 86)'],

  // De los dos
  Colorless: ['oklch(.71 .02 92)', 'oklch(.36 .02 92)']
}

const FALLBACK: [string, string] = TYPE_COLORS.Colorless

export function typeColors(types: CardTypeKey[]): [string, string] {
  return (types[0] && TYPE_COLORS[types[0]]) || FALLBACK
}

/** Degradado de la ventana de ilustración cuando no hay imagen descargada. */
export function artGradient(types: CardTypeKey[]): string {
  const [c1, c2] = typeColors(types)
  return `radial-gradient(115% 85% at 28% 18%, ${c1}, ${c2} 62%, #0c0d0f)`
}

/** Degradado del marco de la carta. */
export function frameGradient(types: CardTypeKey[]): string {
  const [, c2] = typeColors(types)
  return `linear-gradient(160deg, ${c2}, #121316 78%)`
}
