import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { IpcChannel, IpcEventName, IpcEvents, IpcReq, IpcRes } from '@shared/ipc-contract'
import type {
  AppSettings,
  CardListItem,
  CardPage,
  CardQuery,
  CatalogStatus,
  FilterOptions,
  PortfolioSnapshot,
  PortfolioStats,
  PhoneSession,
  ScanEngineStatus,
  SetProgress,
  UpdateStatus
} from '@shared/types'

/** Envoltorio tipado sobre el puente del preload. */
export function call<C extends IpcChannel>(channel: C, req: IpcReq<C>): Promise<IpcRes<C>> {
  return window.api.invoke(channel, req)
}

/** Suscripción a un evento del proceso main, con baja automática. */
export function useIpcEvent<E extends IpcEventName>(
  event: E,
  handler: (payload: IpcEvents[E]) => void
): void {
  useEffect(() => window.api.on(event, handler), [event, handler])
}

// ── Consultas ────────────────────────────────────────────────────────────────

export const keys = {
  settings: ['settings'] as const,
  system: ['system'] as const,
  catalog: ['catalog'] as const,
  filters: ['catalog', 'filters'] as const,
  cards: ['cards'] as const,
  cardPage: (q: CardQuery) => ['cards', 'page', q] as const,
  card: (id: string) => ['cards', 'byId', id] as const,
  cardCopies: (id: string) => ['cards', 'copies', id] as const,
  cardMovements: (id: string) => ['cards', 'movements', id] as const,
  cardPacks: (id: string) => ['cards', 'packs', id] as const,
  cardHistory: (id: string) => ['cards', 'history', id] as const,
  sets: ['sets'] as const,
  collection: ['collection'] as const,
  scanEngine: ['scan', 'engine'] as const,
  phone: ['phone'] as const,
  update: ['update'] as const
}

export const useSettings = (): UseQueryResult<AppSettings> =>
  useQuery({ queryKey: keys.settings, queryFn: () => call('settings:get', undefined) })

export const useSystemInfo = (): UseQueryResult<IpcRes<'system:info'>> =>
  useQuery({ queryKey: keys.system, queryFn: () => call('system:info', undefined), staleTime: Infinity })

export const useCatalogStatus = (): UseQueryResult<CatalogStatus> =>
  useQuery({ queryKey: keys.catalog, queryFn: () => call('catalog:status', undefined) })

export const useFilterOptions = (): UseQueryResult<FilterOptions> =>
  useQuery({ queryKey: keys.filters, queryFn: () => call('catalog:filters', undefined) })

/**
 * Estado del motor de reconocimiento.
 *
 * Se consulta al montar la vista y se refresca con el evento `scan:engine`: los
 * eventos que llegan antes de montar se pierden, así que hace falta pedirlo una
 * vez además de escucharlo.
 */
export const useScanEngine = (): UseQueryResult<ScanEngineStatus> =>
  useQuery({ queryKey: keys.scanEngine, queryFn: () => call('scan:engineStatus', undefined) })

/**
 * Estado del servidor del móvil.
 *
 * Igual que el motor: se pide al montar porque los eventos anteriores se
 * pierden, y a partir de ahí lo refresca `phone:session`.
 */
export const usePhoneSession = (): UseQueryResult<PhoneSession> =>
  useQuery({ queryKey: keys.phone, queryFn: () => call('phone:status', undefined) })

export const useCardPage = (query: CardQuery, enabled = true): UseQueryResult<CardPage> =>
  useQuery({
    queryKey: keys.cardPage(query),
    queryFn: () => call('cards:page', query),
    enabled,
    // Al desplazar, mantener la página anterior visible evita el parpadeo de la
    // rejilla entre lote y lote.
    placeholderData: (prev) => prev
  })

export const useCard = (cardId: string | null): UseQueryResult<CardListItem | null> =>
  useQuery({
    queryKey: keys.card(cardId ?? ''),
    queryFn: () => call('cards:byId', { cardId: cardId as string }),
    enabled: Boolean(cardId)
  })

export const useSetProgress = (): UseQueryResult<SetProgress[]> =>
  useQuery({ queryKey: keys.sets, queryFn: () => call('sets:progress', undefined) })

export const useCollectionStats = (): UseQueryResult<PortfolioStats> =>
  useQuery({ queryKey: keys.collection, queryFn: () => call('collection:stats', undefined) })

export const useCollectionHistory = (days: number): UseQueryResult<PortfolioSnapshot[]> =>
  useQuery({
    queryKey: [...keys.collection, 'history', days],
    queryFn: () => call('collection:history', { days })
  })

export const useTopMovers = (
  limit: number
): UseQueryResult<{ gainers: CardListItem[]; losers: CardListItem[] }> =>
  useQuery({
    queryKey: [...keys.collection, 'movers', limit],
    queryFn: () => call('collection:topMovers', { limit })
  })

export const useUpdateStatus = (): UseQueryResult<UpdateStatus> =>
  useQuery({ queryKey: keys.update, queryFn: () => call('update:status', undefined) })

/**
 * Idioma en el que pedir la imagen de una carta.
 *
 * Se respeta el idioma elegido sólo si la carta existe en él. El Set Base, por
 * ejemplo, nunca se imprimió en español: pedirlo así devuelve un 404 y la carta
 * se quedaría con el marcador de posición para siempre.
 */
export function imageLang(available: readonly string[] | undefined, preferred: string): string {
  // `available` puede llegar vacío o sin definir si el proceso main todavía no
  // se ha reiniciado tras un cambio de esquema. Mejor caer al inglés, que es el
  // idioma en el que existen prácticamente todas las cartas, que reventar.
  if (available?.includes(preferred)) return preferred
  return available?.[0] ?? 'en'
}

/**
 * URL local de una imagen.
 *
 * El proceso main la descarga a la caché la primera vez y luego la sirve desde
 * disco por el esquema `cardimg://`. Se cachea para siempre: la ilustración de
 * una carta no cambia nunca.
 */
export function useAssetImage(
  kind: 'card' | 'setAsset' | 'external',
  assetPath: string | null | undefined,
  opts: { lang?: string; quality?: 'low' | 'high' } = {}
): UseQueryResult<string | null> {
  return useQuery({
    queryKey: ['image', kind, assetPath, opts.lang, opts.quality],
    queryFn: () =>
      call('images:resolve', {
        kind,
        path: assetPath as string,
        ...(opts.lang ? { lang: opts.lang } : {}),
        ...(opts.quality ? { quality: opts.quality } : {})
      }),
    enabled: Boolean(assetPath),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false
  })
}

/** Atajo para la ilustración de una carta. */
export function useCardImage(
  imagePath: string | null,
  lang: string,
  quality: 'low' | 'high'
): UseQueryResult<string | null> {
  return useAssetImage('card', imagePath, { lang, quality })
}

/**
 * Conecta el aviso `db:changed` del proceso main con la invalidación de
 * consultas.
 *
 * Se invalida por prefijo, no todo: tras una sincronización de catálogo no hay
 * motivo para volver a pedir los ajustes.
 */
export function useDbInvalidation(): void {
  const qc = useQueryClient()
  useIpcEvent('db:changed', ({ scopes }) => {
    for (const scope of scopes) {
      if (scope === 'cards' || scope === 'catalog') void qc.invalidateQueries({ queryKey: keys.cards })
      if (scope === 'sets' || scope === 'catalog') void qc.invalidateQueries({ queryKey: keys.sets })
      if (scope === 'collection') void qc.invalidateQueries({ queryKey: keys.collection })
      if (scope === 'prices') {
        void qc.invalidateQueries({ queryKey: keys.cards })
        void qc.invalidateQueries({ queryKey: keys.collection })
      }
      if (scope === 'catalog') void qc.invalidateQueries({ queryKey: keys.filters })
    }
  })
}
