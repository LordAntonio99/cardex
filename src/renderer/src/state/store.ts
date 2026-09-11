import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CardLang,
  type SortId,
  type ViewId
} from '@shared/types'

/**
 * Estado de interfaz.
 *
 * Aquí sólo vive lo que no es un dato del servidor: qué vista está abierta, qué
 * filtros hay puestos, qué carta está seleccionada y los ajustes espejados del
 * proceso main. Los datos (cartas, sets, precios) los gestiona TanStack Query,
 * no este store.
 */

export interface Filters {
  search: string
  setId: string | 'all'
  lang: CardLang | 'all'
  rarity: string | 'all'
  minCents: number
  maxCents: number
  ownedOnly: boolean
  sort: SortId
}

export const DEFAULT_FILTERS: Filters = {
  search: '',
  setId: 'all',
  lang: 'all',
  rarity: 'all',
  minCents: 0,
  maxCents: 60000,
  // Apagado a propósito. Sólo tiene efecto en el Explorador, y encenderlo por
  // defecto haría que el Explorador enseñara lo mismo que la Colección, que es
  // justo lo contrario de para lo que está: ver el catálogo entero con las que
  // faltan en gris.
  ownedOnly: false,
  sort: 'value'
}

interface State {
  view: ViewId
  filters: Filters
  selectedCardId: string | null
  /** Carta abierta en el visor grande, si la hay. */
  viewCardId: string | null
  settings: AppSettings
  theme: 'light' | 'dark'
  /** Tope del deslizador de precio, que sale del catálogo real. */
  priceCeiling: number

  setView: (view: ViewId) => void
  setFilters: (patch: Partial<Filters>) => void
  resetFilters: () => void
  select: (cardId: string | null) => void
  viewCard: (cardId: string | null) => void
  setSettings: (settings: AppSettings) => void
  setTheme: (theme: 'light' | 'dark') => void
  setPriceCeiling: (cents: number) => void
}

export const useStore = create<State>((set) => ({
  view: 'collection',
  filters: DEFAULT_FILTERS,
  selectedCardId: null,
  viewCardId: null,
  settings: DEFAULT_SETTINGS,
  theme: 'dark',
  priceCeiling: 60000,

  // Cambiar de vista cierra la ficha: si no, queda una carta abierta sobre una
  // pantalla que ya no tiene nada que ver con ella.
  setView: (view) => set({ view, selectedCardId: null, viewCardId: null }),

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

  resetFilters: () =>
    set((s) => ({
      // `ownedOnly` y el orden no se tocan: son preferencias de lectura, no
      // filtros de búsqueda, y borrarlos sorprendería.
      filters: {
        ...DEFAULT_FILTERS,
        ownedOnly: s.filters.ownedOnly,
        sort: s.filters.sort,
        maxCents: s.priceCeiling
      }
    })),

  select: (selectedCardId) => set({ selectedCardId }),
  viewCard: (viewCardId) => set({ viewCardId }),
  setSettings: (settings) => set({ settings }),
  setTheme: (theme) => set({ theme }),
  setPriceCeiling: (priceCeiling) =>
    set((s) => ({
      priceCeiling,
      filters:
        s.filters.maxCents === DEFAULT_FILTERS.maxCents
          ? { ...s.filters, maxCents: priceCeiling }
          : s.filters
    }))
}))

/** Atajo muy usado: los textos en el idioma activo. */
export const useUiLang = (): AppSettings['uiLang'] => useStore((s) => s.settings.uiLang)
