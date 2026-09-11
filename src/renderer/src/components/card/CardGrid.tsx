import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CardLang, CardQuery, UiLang } from '@shared/types'
import { useCardPage } from '../../lib/api'
import type { Strings } from '../../i18n'
import { useStore } from '../../state/store'
import { CardTile } from './CardTile'

/**
 * Rejilla de cartas virtualizada.
 *
 * Dos mil cartas con seis capas mezcladas cada una no caben en el DOM: sólo se
 * monta lo visible más un margen. Y la página se pide a SQL contra ese mismo
 * rango, en vez de traerse el catálogo entero por IPC, que structured clone
 * serializaría en cada llamada.
 */

/** Tamaño de lote. Se piden dos por delante para que el desplazamiento no vea huecos. */
const PAGE = 120

const MIN_COL = 150
const GAP_X = 20
const GAP_Y = 26
const PAD = 26
/** Alto del bloque de datos bajo la carta, medido sobre el diseño. */
const FOOTER_H = 86
const CARD_RATIO = 88 / 63

interface Props {
  scope: 'collection' | 'explorer'
  scrollRef: RefObject<HTMLElement | null>
  lang: UiLang
  strings: Strings
  onEmpty: (info: { total: number; scopeTotal: number; loading: boolean }) => void
}

export function CardGrid({ scope, scrollRef, lang, strings, onEmpty }: Props): React.JSX.Element {
  const filters = useStore((s) => s.filters)
  const select = useStore((s) => s.select)

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [firstVisible, setFirstVisible] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)

  // Ancho disponible -> número de columnas. Reproduce el
  // `repeat(auto-fill, minmax(150px, 1fr))` del diseño, pero calculado, porque
  // el virtualizador necesita saber cuántas caben por fila.
  //
  // Y de paso se mide a qué altura empieza la rejilla dentro del contenedor que
  // hace scroll: encima van la cabecera de la vista y la línea de resultados.
  // El virtualizador cuenta desde el contenedor de scroll, así que sin ese
  // desfase (`scrollMargin`) coloca todas las filas desplazadas hacia arriba.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = (): void => {
      const scroller = scrollRef.current
      setWidth(el.getBoundingClientRect().width)
      if (scroller) {
        setScrollMargin(
          el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
        )
      }
    }

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (scrollRef.current) ro.observe(scrollRef.current)
    measure()
    return () => ro.disconnect()
  }, [scrollRef])

  const usable = Math.max(0, width - PAD * 2)
  const columns = Math.max(1, Math.floor((usable + GAP_X) / (MIN_COL + GAP_X)))
  const colWidth = columns > 0 ? (usable - GAP_X * (columns - 1)) / columns : MIN_COL
  const rowHeight = colWidth * CARD_RATIO + 11 + FOOTER_H + GAP_Y

  const offset = Math.max(0, Math.floor(firstVisible / PAGE) * PAGE)
  const query: CardQuery = {
    scope,
    search: filters.search,
    setId: filters.setId,
    lang: filters.lang,
    rarity: filters.rarity,
    minCents: filters.minCents,
    maxCents: filters.maxCents,
    ownedOnly: filters.ownedOnly,
    sort: filters.sort,
    offset,
    limit: PAGE * 2
  }

  const { data, isLoading } = useCardPage(query, width > 0)

  const total = data?.total ?? 0
  const rows = Math.ceil(total / columns)

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin
  })

  // El primer índice visible determina qué página se pide.
  const virtualRows = virtualizer.getVirtualItems()
  const firstRow = virtualRows[0]?.index ?? 0
  useEffect(() => {
    setFirstVisible(firstRow * columns)
  }, [firstRow, columns])

  // El estado vacío lo pinta la vista, que es quien sabe qué decir en cada caso.
  useEffect(() => {
    onEmpty({ total, scopeTotal: data?.scopeTotal ?? 0, loading: isLoading })
  }, [total, data?.scopeTotal, isLoading, onEmpty])

  // Cambiar de filtros vuelve al principio: quedarse en la fila 400 de un
  // resultado de 12 cartas no tiene sentido. Se mueve el contenedor de scroll
  // directamente, que es más predecible que pedirle un índice al virtualizador
  // cuando el número de filas acaba de cambiar.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setFirstVisible(0)
  }, [
    scrollRef,
    filters.search,
    filters.setId,
    filters.lang,
    filters.rarity,
    filters.sort,
    filters.ownedOnly
  ])

  const cardLang: CardLang = filters.lang === 'all' ? (lang === 'en' ? 'en' : 'es') : filters.lang

  return (
    <div ref={containerRef} style={{ padding: `${PAD}px`, paddingTop: PAD }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              // `start` viene medido desde el contenedor de scroll; hay que
              // restarle el desfase de la rejilla dentro de él.
              transform: `translateY(${row.start - scrollMargin}px)`,
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: `0 ${GAP_X}px`
            }}
          >
            {Array.from({ length: columns }, (_, col) => {
              const index = row.index * columns + col
              if (index >= total) return <div key={col} />
              const card = data?.items[index - offset]
              if (!card) {
                // Hueco mientras llega el lote: se reserva el espacio para que
                // la rejilla no dé saltos al aterrizar los datos.
                return (
                  <div
                    key={col}
                    style={{
                      aspectRatio: '63 / 88',
                      border: '1px solid var(--rule)',
                      borderRadius: 4,
                      opacity: 0.35
                    }}
                  />
                )
              }
              return (
                <CardTile
                  key={card.cardId}
                  card={card}
                  lang={lang}
                  cardLang={cardLang}
                  strings={strings}
                  onOpenDetail={select}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
