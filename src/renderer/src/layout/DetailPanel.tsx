import { useQuery } from '@tanstack/react-query'
import type { CardLang, UiLang } from '@shared/types'
import { Eyebrow, Tag } from '../components/ds'
import { call, imageLang, keys, useCard, useCardImage } from '../lib/api'
import { deltaColor, money, monthYear, pct, polygonArea, polyline } from '../lib/format'
import { artGradient, frameGradient } from '../lib/holo'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'

/**
 * Ficha de carta, en un panel lateral fijo como en el diseño.
 *
 * Se abre sobre cualquier vista y no desplaza el contenido: se superpone a la
 * derecha por debajo de la cabecera.
 */
export function DetailPanel({
  strings,
  lang
}: {
  strings: Strings
  lang: UiLang
}): React.JSX.Element | null {
  const cardId = useStore((s) => s.selectedCardId)
  const close = useStore((s) => s.select)
  const view = useStore((s) => s.viewCard)
  const filters = useStore((s) => s.filters)
  const card = useCard(cardId)

  const cardLang: CardLang = filters.lang === 'all' ? (lang === 'en' ? 'en' : 'es') : filters.lang
  const shownLang = imageLang(card.data?.langs ?? [], cardLang)
  const image = useCardImage(card.data?.imagePath ?? null, shownLang, 'high')

  const copies = useQuery({
    queryKey: keys.cardCopies(cardId ?? ''),
    queryFn: () => call('cards:copies', { cardId: cardId as string }),
    enabled: Boolean(cardId)
  })
  const movements = useQuery({
    queryKey: keys.cardMovements(cardId ?? ''),
    queryFn: () => call('cards:movements', { cardId: cardId as string, limit: 10 }),
    enabled: Boolean(cardId)
  })
  const packs = useQuery({
    queryKey: keys.cardPacks(cardId ?? ''),
    queryFn: () => call('cards:packs', { cardId: cardId as string }),
    enabled: Boolean(cardId)
  })
  const history = useQuery({
    queryKey: keys.cardHistory(cardId ?? ''),
    queryFn: () => call('cards:priceHistory', { cardId: cardId as string, days: 90 }),
    enabled: Boolean(cardId)
  })

  if (!cardId || !card.data) return null
  const c = card.data
  const prices = (history.data ?? []).map((p) => p.trendCents)

  const section: React.CSSProperties = {
    padding: '20px 22px',
    borderBottom: '1px solid var(--rule)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14
  }

  return (
    <aside
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 30,
        width: 'min(430px, 92vw)',
        borderLeft: '1px solid var(--rule)',
        background: 'var(--card)',
        overflowY: 'auto'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 22px',
          borderBottom: '1px solid var(--rule)',
          position: 'sticky',
          top: 0,
          background: 'var(--card)',
          zIndex: 5
        }}
      >
        <Eyebrow tone="brand">{strings.detailPanel}</Eyebrow>
        <button
          type="button"
          onClick={() => close(null)}
          className="font-code text-soft"
          style={{ background: 'none', border: '1px solid var(--rule)', padding: '6px 9px', cursor: 'pointer' }}
        >
          <span style={{ fontSize: 9, letterSpacing: '.16em' }}>{strings.close}</span>
        </button>
      </div>

      {/* Cabecera: carta + precio */}
      <div
        style={{
          padding: 22,
          display: 'grid',
          gridTemplateColumns: '132px minmax(0, 1fr)',
          gap: 18,
          borderBottom: '1px solid var(--rule)'
        }}
      >
        {/*
          La miniatura abre el visor a tamaño grande, que es donde la carta se
          puede girar y donde el efecto holográfico luce. Aquí se deja plana: a
          132 px el foil sólo ensucia.
        */}
        <button
          type="button"
          onClick={() => view(c.cardId)}
          title={strings.viewerOpen}
          style={{
            position: 'relative',
            aspectRatio: '63 / 88',
            width: '100%',
            padding: 0,
            border: '1px solid rgba(237,234,227,.16)',
            borderRadius: 4,
            overflow: 'hidden',
            cursor: 'zoom-in',
            background: image.data ? 'var(--deep)' : frameGradient(c.types)
          }}
        >
          {image.data ? (
            <img
              src={image.data}
              alt={c.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, background: artGradient(c.types) }} />
          )}
          <span
            className="font-code"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '6px 4px',
              background: 'linear-gradient(to top, rgba(0,0,0,.8), transparent)',
              color: '#fff',
              fontSize: 8.5,
              letterSpacing: '.14em',
              textAlign: 'center'
            }}
          >
            {strings.viewerOpen}
          </span>
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <h2 className="type-h4 text-ink" style={{ margin: 0 }}>
            {c.name}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {c.rarity ? <Tag tone="brand">{c.rarity}</Tag> : null}
            {c.types[0] ? <Tag>{c.types[0]}</Tag> : null}
            <Tag>{shownLang.toUpperCase()}</Tag>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4 }}>
            <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.18em' }}>
              {strings.marketPrice}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span
                className="font-code text-ink tabular"
                style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}
              >
                {money(c.priceCents, lang)}
              </span>
              <span
                className="font-code tabular"
                style={{ fontSize: 12, fontWeight: 700, color: deltaColor(c.delta7) }}
              >
                {pct(c.delta7)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Datos */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 1,
          background: 'var(--rule)',
          borderBottom: '1px solid var(--rule)'
        }}
      >
        {[
          { k: strings.fSetK, v: c.setName },
          { k: strings.fNumK, v: c.numberLabel },
          { k: strings.fTypeK, v: c.types.join(', ') || '—' },
          { k: strings.fLangK, v: shownLang.toUpperCase() }
        ].map((f) => (
          <div
            key={f.k}
            style={{ background: 'var(--card)', padding: '13px 22px', display: 'flex', flexDirection: 'column', gap: 5 }}
          >
            <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.18em' }}>
              {f.k}
            </span>
            <span
              className="font-brand text-ink ellipsis"
              style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-.01em' }}
            >
              {f.v}
            </span>
          </div>
        ))}
      </div>

      {/* Histórico */}
      <div style={section}>
        <Eyebrow>{strings.priceHistory}</Eyebrow>
        {prices.length >= 2 ? (
          <svg viewBox="0 0 300 80" preserveAspectRatio="none" style={{ width: '100%', height: 90, display: 'block' }}>
            <polygon points={polygonArea(prices, 300, 80, 6)} fill="var(--ac-brand-wash)" />
            <polyline
              points={polyline(prices, 300, 80, 6)}
              fill="none"
              stroke="var(--ac)"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
            {strings.noPrices}
          </span>
        )}
      </div>

      {/* Inventario */}
      <div style={section}>
        <Eyebrow>{strings.inventory}</Eyebrow>
        {copies.data?.length ? (
          copies.data.map((cp) => (
            <div
              key={cp.cardKeyId}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                alignItems: 'center',
                gap: 14,
                borderTop: '1px solid var(--rule)',
                paddingTop: 11
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span className="font-brand text-ink" style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {cp.condition} · ×{cp.qty}
                </span>
                <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.06em' }}>
                  {cp.variant} · {cp.lang.toUpperCase()}
                </span>
              </div>
              <span className="font-code text-soft tabular" style={{ fontSize: 10.5 }}>
                {money(cp.paidCents, lang)}
              </span>
              <span
                className="font-code tabular"
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: deltaColor(cp.pnlCents),
                  minWidth: 56,
                  textAlign: 'right'
                }}
              >
                {cp.pnlCents === null ? '—' : `${cp.pnlCents >= 0 ? '+' : '−'}${money(Math.abs(cp.pnlCents), lang)}`}
              </span>
            </div>
          ))
        ) : (
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
            {strings.noCopies}
          </span>
        )}
      </div>

      {/* Sobres */}
      <div style={section}>
        <Eyebrow>{strings.foundIn}</Eyebrow>
        {packs.data?.length ? (
          packs.data.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                borderTop: '1px solid var(--rule)',
                paddingTop: 10
              }}
            >
              <span className="font-brand text-ink" style={{ fontSize: 12.5, fontWeight: 500 }}>
                {p.name}
              </span>
              <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.14em' }}>
                {strings.booster}
              </span>
            </div>
          ))
        ) : (
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
            {strings.noPacks}
          </span>
        )}
      </div>

      {/* Movimientos */}
      <div style={{ ...section, borderBottom: 0 }}>
        <Eyebrow>{strings.movements}</Eyebrow>
        {movements.data?.length ? (
          movements.data.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '58px minmax(0, 1fr) auto',
                alignItems: 'baseline',
                gap: 12,
                borderTop: '1px solid var(--rule)',
                paddingTop: 10
              }}
            >
              <span className="font-code text-faint tabular" style={{ fontSize: 9 }}>
                {monthYear(m.occurredAt, lang)}
              </span>
              <span className="font-brand text-soft" style={{ fontSize: 12 }}>
                {m.kind} ×{Math.abs(m.qtyDelta)}
              </span>
              <span className="font-code text-ink tabular" style={{ fontSize: 10.5, fontWeight: 600 }}>
                {money(m.unitCents, lang)}
              </span>
            </div>
          ))
        ) : (
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
            {strings.noMovements}
          </span>
        )}
      </div>
    </aside>
  )
}
