import { memo } from 'react'
import type { CardLang, CardListItem, UiLang } from '@shared/types'
import { useCardImage } from '../../lib/api'
import { flipCard } from '../../lib/cardPointer'
import { deltaColor, money, pct } from '../../lib/format'
import { RARITY_HOLO, RARITY_TONE, artGradient, frameGradient, rarityTier } from '../../lib/holo'
import type { Strings } from '../../i18n'

/**
 * La carta.
 *
 * El orden de los elementos no es decorativo: ver la cabecera de card.css antes
 * de mover nada. En resumen, `.card-3d` no puede recibir NINGUNA propiedad de
 * agrupación (opacity, filter, mix-blend-mode, mask, clip-path…) o el volteo
 * deja de ser 3D sin avisar.
 */

interface Props {
  card: CardListItem
  lang: UiLang
  cardLang: CardLang
  strings: Strings
  onOpenDetail: (cardId: string) => void
}

function HoloCardImpl({ card, lang, cardLang, strings, onOpenDetail }: Props): React.JSX.Element {
  const tier = rarityTier(card.rarity)
  const holo = RARITY_HOLO[tier]
  const tone = RARITY_TONE[tier]
  const owned = card.ownedQty > 0
  // En la rejilla basta la calidad baja: 31 KB frente a 126 KB por carta.
  const image = useCardImage(card.imagePath, cardLang, 'low')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, opacity: owned ? 1 : 0.4 }}>
      <div
        className="card-persp"
        data-c3d
        onClick={flipCard}
        style={
          {
            '--rest': holo.rest,
            '--fa': holo.fa,
            '--fb': holo.fb,
            '--fc': holo.fc,
            '--wa': holo.wa,
            '--wb': holo.wb,
            '--wc': holo.wc
          } as React.CSSProperties
        }
      >
        <div className="card-3d">
          {/* ── Anverso ── */}
          <div
            className={`card-face card-front${owned ? '' : ' is-missing'}`}
            style={{ background: frameGradient(card.types) }}
          >
            <div className="card-art" style={{ background: artGradient(card.types) }}>
              {image.data ? <img src={image.data} alt={card.name} loading="lazy" /> : null}

              <div className="holo-layer holo-win holo-a" />
              <div className="holo-layer holo-win holo-b" />
              <div className="holo-layer holo-win holo-c" />

              {/* Inicial de relleno mientras no hay ilustración descargada. */}
              {!image.data ? (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                  <span
                    className="font-brand"
                    style={{
                      fontSize: 46,
                      fontWeight: 700,
                      color: 'rgba(255,255,255,.13)',
                      letterSpacing: '-.04em',
                      lineHeight: 1
                    }}
                  >
                    {card.name.slice(0, 1)}
                  </span>
                </div>
              ) : null}

              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '5px 7px',
                  background: 'linear-gradient(to top, rgba(0,0,0,.72), transparent)',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 6
                }}
              >
                <span
                  className="font-brand ellipsis"
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#fff',
                    letterSpacing: '-.01em',
                    lineHeight: 1.1
                  }}
                >
                  {card.name}
                </span>
                {card.hp ? (
                  <span
                    className="font-code"
                    style={{ fontSize: 9.5, color: 'rgba(255,255,255,.72)', lineHeight: 1 }}
                  >
                    HP {card.hp}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              style={{
                padding: '6px 9px 8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8
              }}
            >
              <span
                className="font-code"
                style={{ fontSize: 9.5, letterSpacing: '.1em', color: 'rgba(255,255,255,.66)' }}
              >
                {card.setCode ?? card.setId.toUpperCase()}
              </span>
              <span
                className="font-code"
                style={{ fontSize: 9.5, letterSpacing: '.04em', color: 'rgba(255,255,255,.5)' }}
              >
                {card.numberLabel}
              </span>
            </div>

            <div className="holo-layer holo-frame holo-a" />
            <div className="holo-layer holo-frame holo-b" />
            <div className="holo-layer holo-frame holo-c" />
            <div className="holo-glare" />
          </div>

          {/* ── Reverso ── */}
          <div className="card-face card-back">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                className="font-code"
                style={{ fontSize: 9.5, letterSpacing: '.18em', color: 'var(--on-deep-faint)' }}
              >
                {strings.backBoosters}
              </span>
              <span
                className="font-brand"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--on-deep)',
                  letterSpacing: '-.01em'
                }}
              >
                {card.setName}
              </span>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                className="font-code"
                style={{ fontSize: 9.5, letterSpacing: '.18em', color: 'var(--on-deep-faint)' }}
              >
                {strings.back90d}
              </span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  borderTop: '1px solid var(--on-deep-rule)',
                  paddingTop: 6
                }}
              >
                <span
                  className="font-code tabular"
                  style={{ fontSize: 11, fontWeight: 700, color: 'var(--on-deep)' }}
                >
                  {money(card.priceCents, lang)}
                </span>
                <span
                  className="font-code tabular"
                  style={{ fontSize: 9.5, color: deltaColor(card.delta7) }}
                >
                  {pct(card.delta7)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Pie: datos fuera de la carta ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span
            className="font-brand text-ink ellipsis"
            style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.01em' }}
          >
            {card.name}
          </span>
          <span className="font-code text-faint tabular" style={{ fontSize: 9, flex: '0 0 auto' }}>
            {card.numberLabel}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span className="font-code text-ink tabular" style={{ fontSize: 12.5, fontWeight: 700 }}>
            {money(card.priceCents, lang)}
          </span>
          <span className="font-code tabular" style={{ fontSize: 10, color: deltaColor(card.delta7) }}>
            {pct(card.delta7)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {card.rarity ? (
            <span
              className="font-code"
              style={{
                fontSize: 9.5,
                letterSpacing: '.06em',
                border: `1px solid ${tone.border}`,
                padding: '3px 5px',
                color: tone.color
              }}
            >
              {card.rarity}
            </span>
          ) : null}
          <span
            className="font-code"
            style={{
              fontSize: 9.5,
              letterSpacing: '.06em',
              padding: '3px 5px',
              background: owned ? 'var(--ac-brand-wash)' : 'transparent',
              color: owned ? 'var(--ac)' : 'var(--faint)'
            }}
          >
            {owned ? `×${card.ownedQty}` : strings.qtyNone}
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            data-nof
            onClick={() => onOpenDetail(card.cardId)}
            className="font-code"
            style={{
              background: 'none',
              border: 0,
              padding: '3px 0',
              cursor: 'pointer',
              color: 'var(--ac)'
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: '.14em' }}>{strings.detail}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Memoizado: al desplazar la rejilla virtualizada, React vuelve a renderizar
 * el contenedor constantemente y no hay motivo para repintar cartas cuyos datos
 * no han cambiado.
 */
export const HoloCard = memo(HoloCardImpl)
