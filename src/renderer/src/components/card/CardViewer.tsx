import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CardLang, CardListItem, GameId, UiLang } from '@shared/types'
import { imageLang, useAssetImage, useCardImage } from '../../lib/api'
import { deltaColor, money, pct } from '../../lib/format'
import { artGradient, frameGradient } from '../../lib/holo'
import type { Strings } from '../../i18n'
import { useStore } from '../../state/store'

/**
 * Visor de carta a tamaño grande.
 *
 * Sin efecto holográfico: se quitó porque ensuciaba la ilustración en lugar de
 * realzarla. Queda la carta limpia, grande y girable.
 *
 * Se gira arrastrando. El giro en Y es continuo a propósito, sin tope: pasando
 * de los 90° se ve el reverso, que es como se mira una carta de verdad, en vez
 * de tener un botón de «voltear».
 *
 * Ojo con card.css: el nodo con `preserve-3d` no puede recibir ninguna
 * propiedad de agrupación o el giro colapsa a 2D sin avisar.
 */

/**
 * El reverso de la carta.
 *
 * No lo publica ninguna API de cartas, así que se referencia igual que el arte
 * de sobres: una URL https que se descarga una vez a la caché local de cada
 * usuario, en vez de republicar material ajeno en el repositorio.
 *
 * En Pokémon hay uno solo y vale para todo; se referencia desde Bulbagarden
 * Archives. En Riftbound hay TRES, según a qué mazo pertenece la carta: azul el
 * mazo principal, negro las leyendas y los campos de batalla, y blanco las
 * runas.
 *
 * De los tres **sólo se ha encontrado publicado el azul**, en el artículo de
 * Riftbound de la Wikipedia en inglés (obra de Riot Games, alojada allí con su
 * justificación de uso legítimo). Las otras dos categorías se quedan con el
 * hueco que el visor ya dibuja: enseñar un reverso que no es el suyo sería
 * peor que no enseñar ninguno.
 */
const CARD_BACKS: Record<GameId, Record<string, string> & { default?: string }> = {
  pokemon: {
    default: 'https://archives.bulbagarden.net/media/upload/thumb/1/17/Cardback.jpg/600px-Cardback.jpg'
  },
  riftbound: {
    // Mazo principal: unidades, hechizos y equipo.
    Unit: 'https://upload.wikimedia.org/wikipedia/en/0/0a/Riftbound_blue_card_back.png',
    Spell: 'https://upload.wikimedia.org/wikipedia/en/0/0a/Riftbound_blue_card_back.png',
    Gear: 'https://upload.wikimedia.org/wikipedia/en/0/0a/Riftbound_blue_card_back.png'
    // Legend y Battlefield (negro) y Rune (blanco) siguen sin imagen.
  }
}

function cardBack(game: GameId, category: string | null): string | null {
  const backs = CARD_BACKS[game]
  return (category ? backs[category] : null) ?? backs.default ?? null
}

/** Grados de giro por píxel arrastrado. */
const DRAG_SENSITIVITY = 0.42
/** Tope de inclinación vertical: más que esto y la carta se ve de canto. */
const MAX_TILT_X = 32

interface Props {
  card: CardListItem
  lang: UiLang
  cardLang: CardLang
  strings: Strings
}

export function CardViewer({ card, lang, cardLang, strings }: Props): React.JSX.Element {
  const close = useStore((s) => s.viewCard)
  const reduceMotion = useStore((s) => s.settings.reduceMotion)

  const stageRef = useRef<HTMLDivElement>(null)
  const rot = useRef({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef(0)

  // Calidad alta: aquí la carta ocupa media pantalla.
  const front = useCardImage(card.imagePath, imageLang(card.langs, cardLang), 'high', card.game)
  const back = useAssetImage('external', cardBack(card.game, card.category))

  /**
   * Si la carta se imprime apaisada.
   *
   * Los campos de batalla de Riftbound lo son. El escenario del visor es
   * vertical, así que hay que darle la vuelta a la relación de aspecto o la
   * carta saldría recortada por los lados. Se mide sobre la imagen ya cargada,
   * que es quien lo sabe, en vez de guardarlo como un campo más del catálogo.
   */
  const [wide, setWide] = useState(false)

  const apply = useCallback(() => {
    frame.current = 0
    const el = stageRef.current
    if (!el) return
    el.style.setProperty('--rx', `${rot.current.x.toFixed(2)}deg`)
    el.style.setProperty('--ry', `${rot.current.y.toFixed(2)}deg`)

    // Qué cara mira al observador se decide aquí y no sólo con
    // `backface-visibility`: esa propiedad depende de que el contexto 3D llegue
    // intacto, y basta una propiedad de agrupación en cualquier ancestro —el
    // `backdrop-filter` del fondo del visor, por ejemplo— para que deje de
    // cumplirse. Con el ángulo en la mano no hay ambigüedad.
    const turn = (((rot.current.y % 360) + 360) % 360)
    el.classList.toggle('is-back', turn > 90 && turn < 270)
  }, [])

  const schedule = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(apply)
  }, [apply])

  // ── Arrastre ───────────────────────────────────────────────────────────────

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (reduceMotion) return
    drag.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    stageRef.current?.classList.add('is-dragging')
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current || reduceMotion) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }

    // Y sin tope: se puede dar la vuelta completa y ver el reverso.
    rot.current.y += dx * DRAG_SENSITIVITY
    rot.current.x = Math.max(
      -MAX_TILT_X,
      Math.min(MAX_TILT_X, rot.current.x - dy * DRAG_SENSITIVITY)
    )
    schedule()
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    stageRef.current?.classList.remove('is-dragging')
  }

  /** Media vuelta, para quien prefiera un clic a arrastrar. */
  const flip = (): void => {
    rot.current.y += 180
    schedule()
  }

  const reset = (): void => {
    rot.current = { x: 0, y: 0 }
    schedule()
  }

  // ── Teclado ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(null)
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        flip()
      } else if (e.key === 'ArrowLeft') {
        rot.current.y -= 15
        schedule()
      } else if (e.key === 'ArrowRight') {
        rot.current.y += 15
        schedule()
      } else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, schedule])

  // Arranca siempre de frente y sin inclinación: sin fijarlo a mano, la carta
  // hereda lo que hubiera en las variables CSS del nodo y puede abrirse girada.
  useLayoutEffect(() => {
    rot.current = { x: 0, y: 0 }
    // También la orientación: si la carta nueva no llega a cargar imagen, sin
    // esto se quedaría con el escenario apaisado de la anterior.
    setWide(false)
    apply()
  }, [card.cardId, apply])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return (
    <div
      className="card-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      onPointerDown={(e) => {
        // Pinchar fuera de la carta cierra.
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="card-viewer-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span
            className="font-brand text-ink ellipsis"
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.02em' }}
          >
            {card.name}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className="font-code text-faint tabular" style={{ fontSize: 10, letterSpacing: '.1em' }}>
              {card.setCode ?? card.setId.toUpperCase()} · {card.numberLabel}
            </span>
            <span className="font-code text-ink tabular" style={{ fontSize: 13, fontWeight: 700 }}>
              {money(card.priceCents, lang)}
            </span>
            <span className="font-code tabular" style={{ fontSize: 11, color: deltaColor(card.delta7) }}>
              {pct(card.delta7)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => close(null)}
          className="font-code text-soft no-drag"
          style={{
            background: 'none',
            border: '1px solid var(--rule)',
            padding: '8px 12px',
            cursor: 'pointer',
            flex: '0 0 auto'
          }}
        >
          <span style={{ fontSize: 9.5, letterSpacing: '.16em' }}>{strings.close}</span>
        </button>
      </div>

      <div
        className="card-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div ref={stageRef} className={`card-viewer-card${wide ? ' is-wide' : ''}`}>
          {/* ── Anverso ── */}
          <div
            className="card-face card-viewer-face card-viewer-front"
            style={{ background: frameGradient(card.types) }}
          >
            <div className="card-viewer-art" style={{ background: artGradient(card.types) }}>
              {front.data ? (
                <img
                  src={front.data}
                  alt={card.name}
                  draggable={false}
                  onLoad={(e) =>
                    setWide(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)
                  }
                />
              ) : null}
              {!front.data ? (
                <span
                  className="font-brand"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 120,
                    fontWeight: 700,
                    color: 'rgba(255,255,255,.13)'
                  }}
                >
                  {card.name.slice(0, 1)}
                </span>
              ) : null}
            </div>
          </div>

          {/* ── Reverso ── */}
          <div className="card-face card-viewer-face card-viewer-back">
            {back.data ? (
              <img src={back.data} alt={strings.cardBack} draggable={false} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <span className="font-code text-faint" style={{ fontSize: 10, letterSpacing: '.16em' }}>
                  {strings.cardBack}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card-viewer-foot">
        <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.14em' }}>
          {reduceMotion ? strings.viewerReduced : strings.viewerHint}
        </span>
        <div style={{ display: 'flex', gap: 14 }}>
          <button type="button" onClick={flip} className="font-code" style={footBtn}>
            {strings.viewerFlip}
          </button>
          <button type="button" onClick={reset} className="font-code" style={footBtn}>
            {strings.viewerReset}
          </button>
        </div>
      </div>
    </div>
  )
}

const footBtn: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  cursor: 'pointer',
  color: 'var(--ac)',
  fontSize: 9.5,
  letterSpacing: '.14em'
}
