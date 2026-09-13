import type { CardListItem, UiLang } from '@shared/types'
import { EmptyState, Eyebrow } from '../components/ds'
import { useCollectionHistory, useCollectionStats, useTopMovers } from '../lib/api'
import { dayToLabel, deltaColor, money, pct, polygonArea, polyline } from '../lib/format'
import { typeColors } from '../lib/holo'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'

/**
 * Mercado: valor de la cartera e histórico.
 *
 * Con la base vacía todo sale a cero y la gráfica se sustituye por un estado
 * vacío explicando que la descarga de precios llega más adelante. Preferible a
 * dibujar una línea plana que parezca un fallo.
 */
export function MarketView({ strings, lang }: { strings: Strings; lang: UiLang }): React.JSX.Element {
  const stats = useCollectionStats()
  const history = useCollectionHistory(90)
  const movers = useTopMovers(5)
  const select = useStore((s) => s.select)
  const setView = useStore((s) => s.setView)
  const game = useStore((s) => s.settings.game)

  const s = stats.data
  const series = history.data ?? []
  const values = series.map((p) => p.totalCents)
  const hasHistory = values.length >= 2

  const cells = [
    { label: strings.stTotal, value: money(s?.totalCents ?? 0, lang), color: 'var(--ink)', note: strings.stTotalNote },
    { label: strings.stCost, value: money(s?.costCents ?? 0, lang), color: 'var(--soft)', note: strings.stCostNote },
    {
      label: strings.stPnl,
      value: `${(s?.pnlCents ?? 0) >= 0 ? '+' : '−'}${money(Math.abs(s?.pnlCents ?? 0), lang)}`,
      color: deltaColor(s?.pnlCents ?? 0),
      note: strings.stPnlNote
    },
    { label: strings.stCards, value: String(s?.copies ?? 0), color: 'var(--ink)', note: strings.stCardsNote }
  ]

  const openCard = (cardId: string): void => {
    setView('collection')
    select(cardId)
  }

  return (
    <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          padding: 26,
          borderBottom: '1px solid var(--rule)'
        }}
      >
        <Eyebrow tone="brand">{strings.marketEyebrow}</Eyebrow>
        <h1 className="type-h3 text-ink" style={{ margin: 0 }}>
          {strings.marketTitle}
        </h1>
        <p className="type-body-sm text-soft" style={{ margin: 0, maxWidth: '60ch', textWrap: 'pretty' }}>
          {strings.marketSub}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          background: 'var(--paper)',
          borderBottom: '1px solid var(--rule)',
          marginLeft: -1
        }}
      >
        {cells.map((cell) => (
          <div
            key={cell.label}
            style={{
              background: 'var(--paper)',
              padding: '22px 26px',
              borderLeft: '1px solid var(--rule)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.2em' }}>
              {cell.label}
            </span>
            <span
              className="font-code tabular"
              style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', color: cell.color }}
            >
              {cell.value}
            </span>
            <span className="font-code text-soft" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
              {cell.note}
            </span>
          </div>
        ))}
      </div>

      {hasHistory ? (
        <div
          style={{
            padding: 26,
            borderBottom: '1px solid var(--rule)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <span className="font-brand text-ink" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.015em' }}>
              {strings.history}
            </span>
            <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.14em' }}>
              {/* La curva es la de la cartera ENTERA, también cuando arriba hay
                  un juego seleccionado: el histórico se anota una vez al día
                  con el total, y partirlo por juego a posteriori es imposible
                  sin reescribir un pasado que no se puede reconstruir. Se dice
                  en vez de dar a entender que la curva es la del juego. */}
              {game === 'all' ? strings.range90 : `${strings.range90} · ${strings.historyAllGames}`}
            </span>
          </div>
          <div style={{ border: '1px solid var(--rule)', background: 'var(--card)', padding: '18px 18px 10px' }}>
            <svg viewBox="0 0 700 200" preserveAspectRatio="none" style={{ width: '100%', height: 220, display: 'block' }}>
              {[50, 100, 150].map((y) => (
                <polyline
                  key={y}
                  points={`0,${y} 700,${y}`}
                  fill="none"
                  stroke="var(--rule)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <polygon points={polygonArea(values, 700, 200, 12)} fill="var(--ac-brand-wash)" />
              <polyline
                points={polyline(values, 700, 200, 12)}
                fill="none"
                stroke="var(--ac)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                paddingTop: 12,
                borderTop: '1px solid var(--rule)',
                marginTop: 10
              }}
            >
              <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.12em' }}>
                {series[0] ? dayToLabel(series[0].day, lang) : ''}
              </span>
              <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.12em' }}>
                {series.at(-1) ? dayToLabel(series[series.length - 1]!.day, lang) : ''}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState eyebrow={strings.history} title={strings.noPrices} description={strings.noPricesSub} />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          background: 'var(--paper)',
          marginLeft: -1
        }}
      >
        <MoverList
          title={strings.topUp}
          cards={movers.data?.gainers ?? []}
          lang={lang}
          onOpen={openCard}
        />
        <MoverList
          title={strings.topDown}
          cards={movers.data?.losers ?? []}
          lang={lang}
          onOpen={openCard}
        />
      </div>

      <div
        style={{
          padding: '18px 26px',
          borderTop: '1px solid var(--rule)',
          background: 'var(--card)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap'
        }}
      >
        <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.14em' }}>
          {strings.source}
        </span>
        <span className="font-code text-soft" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
          Cardmarket · TCGdex · TCGplayer · Riot Games
        </span>
      </div>
    </main>
  )
}

function MoverList({
  title,
  cards,
  lang,
  onOpen
}: {
  title: string
  cards: CardListItem[]
  lang: UiLang
  onOpen: (cardId: string) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        background: 'var(--paper)',
        padding: '24px 26px',
        borderLeft: '1px solid var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}
    >
      <Eyebrow>{title}</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {cards.length === 0 ? (
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em', paddingTop: 8 }}>
            —
          </span>
        ) : (
          cards.map((c) => {
            const [c1, c2] = typeColors(c.types)
            return (
              <button
                key={c.cardId}
                type="button"
                onClick={() => onOpen(c.cardId)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '26px minmax(0, 1fr) auto auto',
                  alignItems: 'center',
                  gap: 14,
                  background: 'none',
                  border: 0,
                  borderTop: '1px solid var(--rule)',
                  padding: '11px 0',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div
                  style={{
                    aspectRatio: '63 / 88',
                    borderRadius: 2,
                    background: `linear-gradient(160deg, ${c1}, ${c2})`
                  }}
                />
                <span
                  className="font-brand text-ink ellipsis"
                  style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-.01em' }}
                >
                  {c.name}
                </span>
                <span className="font-code text-soft tabular" style={{ fontSize: 11 }}>
                  {money(c.priceCents, lang)}
                </span>
                <span
                  className="font-code tabular"
                  style={{ fontSize: 11, fontWeight: 700, color: deltaColor(c.delta7), minWidth: 58, textAlign: 'right' }}
                >
                  {pct(c.delta7)}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
