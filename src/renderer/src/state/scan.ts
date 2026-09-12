import { create } from 'zustand'
import type { CardLang, ScanCandidate, ScanDetection, Variant } from '@shared/types'

/**
 * El lote del escáner.
 *
 * Vive en su propio store y no en el general por dos motivos. Uno, que el
 * general se documenta como «filtros, selección y ajustes espejados», y un lote
 * a medio confirmar no es ninguna de las tres cosas. Y dos, que `setView` limpia
 * la selección del general: el lote NO debe perderse al ir a mirar una carta en
 * la colección y volver.
 *
 * No se persiste a disco a propósito. Es un borrador: cerrar la aplicación con
 * cartas sin confirmar significa que no se confirmaron.
 */

/** Una carta en el lote, con lo que hace falta para revisarla antes de aceptar. */
export interface QueueItem extends ScanDetection {
  /** Otras candidatas, para el selector cuando el reconocimiento dudó. */
  alternatives: ScanCandidate[]
}

interface ScanState {
  queue: QueueItem[]
  enqueue(item: QueueItem): void
  /** Cambia la carta elegida por una de las alternativas. */
  choose(id: string, candidate: ScanCandidate): void
  setVariant(id: string, variant: Variant): void
  setLang(id: string, lang: CardLang): void
  remove(id: string): void
  clear(): void
}

export const useScanStore = create<ScanState>((set) => ({
  queue: [],

  enqueue: (item) => set((s) => ({ queue: [...s.queue, item] })),

  choose: (id, candidate) =>
    set((s) => ({
      queue: s.queue.map((it) =>
        it.id === id
          ? {
              ...it,
              cardId: candidate.cardId,
              name: candidate.name,
              numberLabel: candidate.numberLabel,
              imagePath: candidate.imagePath,
              priceCents: candidate.priceCents,
              variantMask: candidate.variantMask,
              langs: candidate.langs,
              // Elegir a mano resuelve la duda: deja de ser una propuesta.
              status: 'match',
              // La variante y el idioma anteriores pueden no existir en la
              // carta nueva, así que se recolocan a algo que sí exista.
              variant: fitVariant(it.variant, candidate.variantMask),
              lang: candidate.langs.includes(it.lang) ? it.lang : (candidate.langs[0] ?? it.lang)
            }
          : it
      )
    })),

  setVariant: (id, variant) =>
    set((s) => ({ queue: s.queue.map((it) => (it.id === id ? { ...it, variant } : it)) })),

  setLang: (id, lang) =>
    set((s) => ({ queue: s.queue.map((it) => (it.id === id ? { ...it, lang } : it)) })),

  remove: (id) => set((s) => ({ queue: s.queue.filter((it) => it.id !== id) })),

  clear: () => set({ queue: [] })
}))

/** La variante más parecida que la carta admita de verdad. */
function fitVariant(wanted: Variant, mask: number): Variant {
  const bits: Record<Variant, number> = { normal: 1, holo: 2, reverse: 4, first_ed: 8 }
  if (mask & bits[wanted]) return wanted
  if (mask & bits.holo) return 'holo'
  if (mask & bits.normal) return 'normal'
  if (mask & bits.reverse) return 'reverse'
  return 'normal'
}
