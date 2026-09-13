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
 * Se gira arrastrando. El giro en Y es continuo a propósito, sin tope: pasando
 * de los 90° se ve el reverso, que es como se mira una carta de verdad, en vez
 * de tener un botón de «voltear».
 *
 * **Sigue sin efecto holográfico**, que se quitó por ensuciar la ilustración en
 * vez de realzarla. Lo que sí hay es LUZ: un reflejo que barre la cara al
 * girarla, el borde que se aleja apagándose y una sombra que acompaña. Es otra
 * cosa que el foil: no pinta colores encima de la carta, sólo la ilumina, y por
 * eso de frente no se nota —que es cuando la carta hay que leerla— y aparece al
 * inclinarla, que es cuando una carta de verdad devuelve la luz. Los números
 * salen de `apply()` y los consume `card.css`.
 *
 * Ojo con card.css: el nodo con `preserve-3d` no puede recibir ninguna
 * propiedad de agrupación o el giro colapsa a 2D sin avisar. Por eso la luz vive
 * en un pseudoelemento de la CARA, que es hoja del árbol 3D.
 */

/**
 * El reverso de la carta.
 *
 * No lo publica ninguna API de cartas, así que se referencia igual que el arte
 * de sobres: una URL https que se descarga una vez a la caché local de cada
 * usuario, en vez de republicar material ajeno en el repositorio.
 *
 * El mapa es por categoría porque en Riftbound hay TRES reversos: azul el mazo
 * principal —unidades, hechizos y equipo—, negro las leyendas y los campos de
 * batalla, y blanco las runas. De los tres sólo se ha encontrado publicado el
 * azul, en el artículo de Riftbound de la Wikipedia en inglés (obra de Riot
 * Games, alojada allí con su justificación de uso legítimo).
 *
 * **Decisión del proyecto: el azul se usa para todas.** Es lo que se pidió
 * expresamente. Tiene un coste que conviene no olvidar: 209 de las 1.165 cartas
 * enseñan un reverso que no es el suyo. La alternativa era el hueco, y se
 * prefirió la uniformidad.
 *
 * En cuanto aparezcan las otras dos imágenes, esto se cierra bien añadiendo sus
 * entradas por categoría —`Legend`, `Battlefield` y `Rune`—, que mandan sobre
 * el `default`.
 */
const RIFTBOUND_BACK = 'https://upload.wikimedia.org/wikipedia/en/0/0a/Riftbound_blue_card_back.png'

const CARD_BACKS: Record<GameId, Record<string, string> & { default?: string }> = {
  pokemon: {
    default: 'https://archives.bulbagarden.net/media/upload/thumb/1/17/Cardback.jpg/600px-Cardback.jpg'
  },
  riftbound: {
    default: RIFTBOUND_BACK
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
    const back = turn > 90 && turn < 270
    el.classList.toggle('is-back', back)

    // ── La luz ──────────────────────────────────────────────────────────────
    //
    // El foco se considera fijo, arriba y a la izquierda, y es la carta la que
    // se mueve bajo él. De ahí sale todo: dónde cae el reflejo, qué borde se
    // apaga y hacia dónde se va la sombra.
    //
    // `facing` es lo inclinada que está la cara que se ve respecto al
    // observador, de -90 a 90. Se calcula aparte para la trasera porque esa
    // cara viene ya girada 180°.
    const facing = back ? turn - 180 : turn > 180 ? turn - 360 : turn
    const tiltX = rot.current.x

    // Cuánto se aparta de estar de frente, de 0 a 1. Una carta plana bajo una
    // luz difusa apenas brilla; es al inclinarla cuando devuelve el reflejo.
    const away = Math.min(1, Math.hypot(facing / 62, tiltX / 34))

    // El reflejo barre la cara: al girar hacia un lado, la luz corre hacia el
    // otro. Nunca llega a los bordes, que es donde delataría que es un
    // degradado y no una superficie.
    el.style.setProperty('--sheen-pos', `${(50 - facing * 0.42).toFixed(1)}%`)
    el.style.setProperty('--sheen', (0.05 + away * 0.26).toFixed(3))

    // El borde que se va hacia atrás se apaga. Con `rotateY` positivo el que se
    // aleja es el derecho, así que el degradado arranca por ahí.
    el.style.setProperty('--fall-angle', facing >= 0 ? '270deg' : '90deg')
    el.style.setProperty('--fall', (away * 0.3).toFixed(3))

    // Y la sombra acompaña: se desplaza al contrario que el reflejo y se abre
    // conforme la carta se separa de estar de frente.
    el.style.setProperty('--shadow-x', `${(facing * 0.5).toFixed(1)}px`)
    el.style.setProperty('--shadow-y', `${(30 - tiltX * 0.45).toFixed(1)}px`)
    el.style.setProperty('--shadow-blur', `${(70 + away * 26).toFixed(0)}px`)
    el.style.setProperty('--shadow-a', (0.6 - away * 0.14).toFixed(3))
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
