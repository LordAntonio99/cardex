import { memo, useState } from 'react'
import type { CardLang, CardListItem, UiLang } from '@shared/types'
import { imageLang, useCardImage } from '../../lib/api'
import { deltaColor, money, pct } from '../../lib/format'
import { RARITY_TONE, artGradient, frameGradient, rarityTier } from '../../lib/holo'
import type { Strings } from '../../i18n'

/**
 * La carta en la rejilla. Plana.
 *
 * El efecto holográfico y la inclinación 3D vivían aquí, y a 150 px de ancho no
 * lucían: las capas en `screen` se comen el dibujo y el brillo no se lee. Ahora
 * el efecto está donde tiene sentido, en el visor a tamaño grande (CardViewer),
 * y la rejilla muestra la carta tal cual.
 *
 * Cuando hay ilustración descargada se enseña a sangre: la imagen YA es la
 * carta entera, con su marco y su nombre impresos. Meterla dentro de un marco
 * dibujado por nosotros daba una carta dentro de otra carta. El marco sintético
 * sólo se usa como respaldo mientras no hay imagen.
 */

interface Props {
  card: CardListItem
  lang: UiLang
  cardLang: CardLang
  strings: Strings
  onOpenDetail: (cardId: string) => void
}

/**
 * La cifra que se enseña sobre la ilustración.
 *
 * En Pokémon es el PV, que es lo que identifica a ojo una carta en la rejilla.
 * En Riftbound no hay PV: lo que se imprime es el coste de energía y el poderío,
 * así que se enseñan esos dos con los mismos símbolos que la carta. Un cero es
 * un valor real —hay unidades con 0 de poderío—, de ahí las comprobaciones
 * contra `undefined` y no contra un valor falsy.
 */
function statLine(card: CardListItem): string | null {
  if (card.hp) return `HP ${card.hp}`
  const stats = card.stats
  if (!stats) return null
  const parts: string[] = []
  if (stats['energy'] !== undefined) parts.push(`◈ ${stats['energy']}`)
  if (stats['might'] !== undefined) parts.push(`⚔ ${stats['might']}`)
  if (!parts.length && stats['power'] !== undefined) parts.push(`✦ ${stats['power']}`)
  return parts.length ? parts.join('  ') : null
}

function CardTileImpl({ card, lang, cardLang, strings, onOpenDetail }: Props): React.JSX.Element {
  const tone = RARITY_TONE[rarityTier(card.rarity)]
  const owned = card.ownedQty > 0
  // En la rejilla basta la calidad baja: 31 KB frente a 126 KB por carta.
  const image = useCardImage(card.imagePath, imageLang(card.langs, cardLang), 'low', card.game)

  /**
   * Si la carta es apaisada.
   *
   * Los campos de batalla de Riftbound se imprimen en horizontal, y el hueco de
   * la rejilla es vertical. Con `cover` se vería un recorte central del que no
   * se reconoce la carta, así que esas van con `contain`.
   *
   * Se mide en el `onLoad` en lugar de leerlo del catálogo porque la imagen ya
   * lo sabe: no hace falta un campo más que mantener, ni que el generador
   * acierte, ni que el renderer conozca qué categorías de qué juego son
   * apaisadas.
   */
  const [wide, setWide] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, opacity: owned ? 1 : 0.4 }}>
      <button
        type="button"
        onClick={() => onOpenDetail(card.cardId)}
        title={card.name}
        style={{
          position: 'relative',
          aspectRatio: '63 / 88',
          width: '100%',
          padding: 0,
          border: '1px solid rgba(237, 234, 227, .16)',
          borderRadius: 4,
          overflow: 'hidden',
          cursor: 'pointer',
          background: image.data ? 'var(--deep)' : frameGradient(card.types),
          // Las que no se tienen salen en gris, como marca el diseño.
          filter: owned ? 'none' : 'grayscale(1)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {image.data ? (
          <img
            src={image.data}
            alt={card.name}
            loading="lazy"
            onLoad={(e) => setWide(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: wide ? 'contain' : 'cover',
              display: 'block'
            }}
          />
        ) : (
          <>
            {/* Respaldo mientras no hay ilustración: marco sintético con la
                inicial, el nombre y el número, como en el diseño original. */}
            <div
              style={{
                position: 'relative',
                flex: '1 1 auto',
                margin: '7px 7px 0',
                border: '1px solid rgba(0, 0, 0, .45)',
                background: artGradient(card.types),
                overflow: 'hidden'
              }}
            >
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
                {statLine(card) ? (
                  <span
                    className="font-code"
                    style={{
                      fontSize: 9.5,
                      color: 'rgba(255,255,255,.72)',
                      lineHeight: 1,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {statLine(card)}
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
          </>
        )}
      </button>

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
export const CardTile = memo(CardTileImpl)
