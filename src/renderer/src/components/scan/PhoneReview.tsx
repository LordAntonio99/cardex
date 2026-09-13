import { useState } from 'react'
import type { CardLang, ScanCandidate, UiLang } from '@shared/types'
import { Button, Eyebrow, GridTexture } from '../ds'
import { imageLang, useCardImage } from '../../lib/api'
import { money } from '../../lib/format'
import type { Strings } from '../../i18n'
import type { PhoneReview as Review, QueueItem } from '../../state/scan'

/**
 * La carta recién escaneada con el móvil, en grande.
 *
 * Escaneando con el móvil el panel de la webcam se queda a oscuras y la carta
 * sólo aparece en la ficha diminuta del lote, que es justo donde no se puede
 * juzgar si el reconocimiento ha acertado: dos cartas del mismo set y la misma
 * época se parecen bastante más de lo que sugiere una miniatura de 52 píxeles.
 *
 * Así que se pone al lado lo que ha visto la cámara y lo que propone el
 * catálogo, al mismo tamaño, y se decide de un vistazo.
 */
export function PhoneReview({
  review,
  item,
  strings,
  lang,
  onAccept,
  onReject,
  onChoose,
  onDismiss
}: {
  review: Review
  /** La carta en el lote, si la captura llegó a entrar. */
  item: QueueItem | undefined
  strings: Strings
  lang: UiLang
  onAccept: () => void
  onReject: () => void
  onChoose: (candidate: ScanCandidate) => void
  onDismiss: () => void
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)

  const cardLang: CardLang = item?.lang ?? (lang === 'en' ? 'en' : 'es')
  // El juego decide de qué CDN sale la imagen. Sin pasarlo, una carta de
  // Riftbound se le pedía a TCGdex, devolvía 404 y el hueco de «lo que propone
  // el catálogo» se quedaba vacío justo cuando hay que comparar las dos.
  const proposed = useCardImage(
    item?.imagePath ?? null,
    imageLang(item?.langs, cardLang),
    'high',
    item?.game ?? 'pokemon'
  )

  const failure = ((): string | null => {
    switch (review.status) {
      case 'no_card':
        return strings.seeNoCard
      case 'blurry':
        return strings.seeBlurry
      case 'glare':
        return strings.seeGlare
      case 'unknown':
        return strings.seeUnknown
      default:
        return null
    }
  })()

  const frame: React.CSSProperties = {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    border: '1px solid var(--on-deep-rule)',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    background: 'var(--deep)'
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--rule)',
        minHeight: 0
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
          padding: 26,
          borderBottom: '1px solid var(--rule)',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Eyebrow tone="brand">{strings.reviewEyebrow}</Eyebrow>
          <h1 className="type-h3 text-ink" style={{ margin: 0 }}>
            {item ? item.name : (failure ?? strings.reviewNothing)}
          </h1>
          {item ? (
            <p className="type-body-sm text-soft" style={{ margin: 0 }}>
              {item.numberLabel} · {money(item.priceCents, lang)} ·{' '}
              <span className="font-code" style={{ fontSize: 11 }}>
                {Math.round(item.confidence)}% {strings.reviewConfidence}
              </span>
            </p>
          ) : (
            <p className="type-body-sm text-soft" style={{ margin: 0, maxWidth: '52ch' }}>
              {strings.reviewNotInBatch}
            </p>
          )}
        </div>
        <Button variant="quiet" size="sm" onClick={onDismiss}>
          {strings.reviewClose}
        </Button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 26,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          background: 'var(--deep)',
          overflowY: 'auto'
        }}
      >
        <div style={{ flex: 1, minHeight: 240, display: 'flex', gap: 20, justifyContent: 'center' }}>
          <Pane label={strings.reviewSeen} style={frame}>
            {review.thumbnail ? (
              <img
                src={review.thumbnail}
                alt=""
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : (
              <GridTexture />
            )}
          </Pane>

          {item ? (
            <Pane label={strings.reviewProposed} style={frame}>
              {proposed.data ? (
                <img
                  src={proposed.data}
                  alt={item.name}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : (
                <GridTexture />
              )}
            </Pane>
          ) : null}
        </div>

        {/* Sin carta propuesta no hay nada que aceptar: la captura no entró en
            el lote y el único gesto útil es seguir escaneando. */}
        {item ? (
          picking ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span
                className="font-code"
                style={{ fontSize: 9.5, letterSpacing: '.14em', color: 'var(--on-deep-faint)' }}
              >
                {strings.reviewPick}
              </span>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {item.alternatives
                  .filter((c) => c.cardId !== item.cardId)
                  .map((c) => (
                    <button
                      key={c.cardId}
                      type="button"
                      onClick={() => onChoose(c)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 3,
                        padding: '9px 12px',
                        border: '1px solid var(--on-deep-rule)',
                        background: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <span className="font-brand" style={{ fontSize: 13, color: 'var(--on-deep)' }}>
                        {c.name}
                      </span>
                      <span
                        className="font-code"
                        style={{ fontSize: 9.5, color: 'var(--on-deep-faint)' }}
                      >
                        {c.numberLabel} · {c.setName} · {c.score}%
                      </span>
                    </button>
                  ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" size="sm" onClick={onReject}>
                  {strings.reviewDiscard}
                </Button>
                <Button variant="quiet" size="sm" onClick={() => setPicking(false)}>
                  {strings.reviewBack}
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Button variant="brand" onClick={onAccept}>
                {strings.reviewYes}
              </Button>
              <Button variant="ghost" onClick={() => setPicking(true)}>
                {strings.reviewNo}
              </Button>
              <span className="type-body-sm" style={{ color: 'var(--on-deep-faint)' }}>
                {strings.reviewNote}
              </span>
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

function Pane({
  label,
  style,
  children
}: {
  label: string
  style: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
        flex: 1,
        maxWidth: 420
      }}
    >
      <span
        className="font-code"
        style={{ fontSize: 9, letterSpacing: '.16em', color: 'var(--on-deep-faint)' }}
      >
        {label}
      </span>
      <div style={style}>{children}</div>
    </div>
  )
}
