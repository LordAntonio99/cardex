import { create } from 'zustand'
import type {
  CardLang,
  ScanCandidate,
  ScanDetection,
  ScanResult,
  ScanStatus,
  Variant
} from '@shared/types'

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

/**
 * La última captura del móvil, esperando el visto bueno en el ordenador.
 *
 * Cuando se escanea con el móvil, el panel de la webcam del ordenador se queda
 * vacío y la carta recién reconocida sólo aparece en la ficha diminuta del lote,
 * que es donde peor se juzga si el reconocimiento ha acertado. Esto es lo que
 * hace falta para poder pintarla en grande.
 *
 * Guarda también las capturas que NO entraron en el lote: saber por qué ha
 * fallado una —movida, con brillo, desconocida— vale tanto como ver un acierto.
 */
export interface PhoneReview {
  status: ScanStatus
  /** La carta ya recortada y enderezada, tal como la vio el reconocedor. */
  thumbnail: string | null
  /** Su identificador en el lote. null cuando la captura no llegó a entrar. */
  id: string | null
  at: number
}

interface ScanState {
  queue: QueueItem[]
  review: PhoneReview | null
  enqueue(item: QueueItem): void
  /** Da por buena la carta propuesta: deja de pedir revisión y cierra el panel. */
  acceptReview(): void
  /** La descarta del lote y cierra el panel. */
  rejectReview(): void
  /** Cierra el panel sin tocar el lote. */
  dismissReview(): void
  /** Cambia la carta elegida por una de las alternativas. */
  choose(id: string, candidate: ScanCandidate): void
  setVariant(id: string, variant: Variant): void
  setLang(id: string, lang: CardLang): void
  remove(id: string): void
  clear(): void
}

export const useScanStore = create<ScanState>((set) => ({
  queue: [],
  review: null,

  enqueue: (item) => set((s) => ({ queue: [...s.queue, item] })),

  acceptReview: () =>
    set((s) => ({
      review: null,
      queue: s.review?.id
        ? s.queue.map((it) => (it.id === s.review?.id ? { ...it, status: 'match' as const } : it))
        : s.queue
    })),

  rejectReview: () =>
    set((s) => ({
      review: null,
      queue: s.review?.id ? s.queue.filter((it) => it.id !== s.review?.id) : s.queue
    })),

  dismissReview: () => set({ review: null }),

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

/**
 * Encola el resultado de una captura, venga de donde venga.
 *
 * Existe porque hay dos cámaras y dos sitios que lo llaman: la vista del
 * escáner para la webcam, y `App` para lo que llega del móvil. Aplanar un
 * `ScanResult` en un `QueueItem` por duplicado es justo el tipo de detalle que
 * se desincroniza a la tercera vez que se toca.
 */
export function enqueueResult(result: ScanResult): void {
  if (!result.detection) return
  useScanStore.getState().enqueue({ ...result.detection, alternatives: result.alternatives })
}

/**
 * Lo mismo, pero dejando la captura a la vista para revisarla en grande.
 *
 * Sólo para lo que llega del móvil: con la webcam ya estás mirando la pantalla
 * del ordenador, y el lote a la derecha basta. Con el móvil en la mano, no.
 */
export function reviewFromPhone(result: ScanResult): void {
  enqueueResult(result)
  useScanStore.setState({
    review: {
      status: result.status,
      thumbnail: result.thumbnail ?? result.detection?.thumbnail ?? null,
      id: result.detection?.id ?? null,
      at: Date.now()
    }
  })
}

/** La variante más parecida que la carta admita de verdad. */
function fitVariant(wanted: Variant, mask: number): Variant {
  const bits: Record<Variant, number> = { normal: 1, holo: 2, reverse: 4, first_ed: 8 }
  if (mask & bits[wanted]) return wanted
  if (mask & bits.holo) return 'holo'
  if (mask & bits.normal) return 'normal'
  if (mask & bits.reverse) return 'reverse'
  return 'normal'
}
