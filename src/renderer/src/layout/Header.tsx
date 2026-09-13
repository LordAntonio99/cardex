import { VIEWS, type GameId, type UiLang, type ViewId } from '@shared/types'
import { call, useCollectionStats, useFilterOptions, useUpdateStatus } from '../lib/api'
import { money } from '../lib/format'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'
import { OkDot } from '../components/ds'

/**
 * Cabecera. En Windows ES la barra de título: la ventana se crea con
 * `titleBarStyle: 'hidden'` y los botones de minimizar/maximizar/cerrar se
 * dibujan encima de estos 62 px.
 *
 * Dos cuidados que vienen de ahí:
 *
 *  - El desenfoque va en un hermano absoluto, no en el mismo elemento que la
 *    región de arrastre: juntos producen artefactos de repintado en Chromium.
 *  - La franja de los botones de ventana es opaca y el desenfoque no puede
 *    pasar por debajo, así que se reserva su anchura con `.titlebar-inset`
 *    (variable de entorno `titlebar-area-width`) para no meter contenido ahí.
 */

export const HEADER_HEIGHT = 62

const NAV_LABEL: Record<ViewId, keyof Strings> = {
  collection: 'navCollection',
  explorer: 'navExplorer',
  sets: 'navSets',
  scan: 'navScan',
  market: 'navMarket'
}

const GAME_LABEL: Record<GameId, keyof Strings> = {
  pokemon: 'gamePokemon',
  riftbound: 'gameRiftbound'
}

/**
 * Selector de juego.
 *
 * Manda sobre las cinco vistas y se guarda en los ajustes, así que sigue puesto
 * al volver a abrir. Vive junto a la marca porque no es un filtro más: es el
 * ámbito de todo lo que se ve debajo.
 *
 * **No aparece cuando el catálogo instalado tiene un solo juego.** Un control
 * de un único valor no decide nada y sólo ocupa cabecera; en cuanto se
 * sincroniza un catálogo con dos, aparece.
 */
function GameSwitch({ strings }: { strings: Strings }): React.JSX.Element | null {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setFilters = useStore((s) => s.setFilters)
  const options = useFilterOptions()

  const games = (options.data?.games ?? []).filter((g) => g.count > 0)
  if (games.length < 2) return null

  const choose = async (next: GameId | 'all'): Promise<void> => {
    if (next === settings.game) return
    // El set y la rareza se sueltan a la vez que el juego: los sets son de un
    // juego y las rarezas ni siquiera se llaman igual ('Rara Doble' frente a
    // 'Epic'). Dejarlos puestos daría una rejilla vacía sin explicación.
    setFilters({ setId: 'all', rarity: 'all' })
    setSettings(await call('settings:patch', { game: next }))
  }

  const choices: (GameId | 'all')[] = ['all', ...games.map((g) => g.value)]

  return (
    <div style={{ display: 'flex', border: '1px solid var(--rule)', flex: '0 0 auto' }}>
      {choices.map((code) => {
        const active = settings.game === code
        return (
          <button
            key={code}
            type="button"
            onClick={() => void choose(code)}
            className="font-code no-drag"
            style={{
              background: active ? 'var(--ac)' : 'transparent',
              color: active ? 'var(--on-brand)' : 'var(--soft)',
              border: 0,
              padding: '7px 11px',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <span style={{ fontSize: 9.5, letterSpacing: '.14em', fontWeight: 600 }}>
              {code === 'all' ? strings.gameAll : strings[GAME_LABEL[code]]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function Header({ strings, lang }: { strings: Strings; lang: UiLang }): React.JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const stats = useCollectionStats()
  const update = useUpdateStatus()

  const switchLang = async (next: UiLang): Promise<void> => {
    setSettings(await call('settings:patch', { uiLang: next }))
  }

  return (
    <header
      style={{
        position: 'relative',
        zIndex: 40,
        flex: `0 0 ${HEADER_HEIGHT}px`,
        minHeight: HEADER_HEIGHT,
        borderBottom: '1px solid var(--rule)'
      }}
    >
      {/* El desenfoque, aparte de la región de arrastre. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--header)',
          backdropFilter: 'blur(10px)',
          zIndex: 0
        }}
      />

      <div
        className="drag-region titlebar-inset titlebar-leading"
        style={{
          position: 'relative',
          zIndex: 1,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 28
          // Sin `padding` aquí: lo pone `.titlebar-inset`, que además reserva
          // el hueco de los botones de ventana. Un padding en línea lo pisaría.
        }}
      >
        {/* Marca */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto' }}>
          <div
            className="font-code"
            style={{
              width: 30,
              height: 30,
              border: '1px solid var(--ac)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ac)'
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.02em' }}>CX</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span
              className="font-brand text-ink"
              style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1 }}
            >
              CARDEX
            </span>
            <span
              className="font-code text-faint"
              style={{ fontSize: 9.5, letterSpacing: '.22em', lineHeight: 1 }}
            >
              {strings.tagline}
            </span>
          </div>
        </div>

        <GameSwitch strings={strings} />

        {/* Navegación 01-05 */}
        <nav style={{ display: 'flex', alignSelf: 'stretch', flex: '0 0 auto' }}>
          {VIEWS.map((v, i) => {
            const active = view === v
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className="font-brand no-drag"
                style={{
                  background: active ? 'var(--nav-on)' : 'transparent',
                  border: 0,
                  borderBottom: `2px solid ${active ? 'var(--ac)' : 'transparent'}`,
                  padding: '0 16px',
                  cursor: 'pointer',
                  color: active ? 'var(--ink)' : 'var(--soft)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  font: 'var(--type-nav)',
                  letterSpacing: 'var(--type-nav-ls)'
                }}
              >
                <span className="font-code" style={{ fontSize: 9, opacity: 0.55 }}>
                  0{i + 1}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>{strings[NAV_LABEL[v]]}</span>
              </button>
            )
          })}
        </nav>

        <div style={{ flex: '1 1 40px' }} />

        {/* Aviso de actualización, sólo cuando hay algo que decir. */}
        {update.data?.state === 'ready' ? (
          <button
            type="button"
            onClick={() => void call('update:install', undefined)}
            className="font-code no-drag"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--ac)',
              background: 'var(--ac-brand-wash)',
              color: 'var(--ac)',
              cursor: 'pointer',
              fontSize: 9.5,
              letterSpacing: '.12em'
            }}
            title={`${strings.updateReady} · ${update.data.version}`}
          >
            {strings.updateRestart}
          </button>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <span
              className="font-code text-faint"
              style={{ fontSize: 9, letterSpacing: '.18em', lineHeight: 1 }}
            >
              {strings.totalValue}
            </span>
            <span
              className="font-code text-ink tabular"
              style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}
            >
              {money(stats.data?.totalCents ?? 0, lang)}
            </span>
          </div>

          <div style={{ display: 'flex', border: '1px solid var(--rule)' }}>
            {(['es', 'en'] as const).map((code) => {
              const active = settings.uiLang === code
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => void switchLang(code)}
                  className="font-code no-drag"
                  style={{
                    background: active ? 'var(--ac)' : 'transparent',
                    color: active ? 'var(--on-brand)' : 'var(--soft)',
                    border: 0,
                    padding: '7px 10px',
                    cursor: 'pointer'
                  }}
                  title={code === 'es' ? 'Español' : 'English'}
                >
                  <span style={{ fontSize: 10, letterSpacing: '.1em', fontWeight: 600 }}>
                    {code.toUpperCase()}
                  </span>
                </button>
              )
            })}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              paddingLeft: 16,
              borderLeft: '1px solid var(--rule)'
            }}
          >
            <OkDot />
            <span className="font-code text-soft" style={{ fontSize: 9.5, letterSpacing: '.12em' }}>
              {strings.localDb}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
