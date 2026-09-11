import { useRef } from 'react'
import { EFFECTS_3D, type CardLang, type Effect3d, type UiLang } from '@shared/types'
import { call, useFilterOptions } from '../lib/api'
import { money } from '../lib/format'
import { applyPreset } from '../lib/holo'
import { setPointerPreset } from '../lib/cardPointer'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'
import { Eyebrow, Input } from '../components/ds'

/**
 * Barra lateral de filtros.
 *
 * Se implementa entera desde el principio aunque la base esté vacía, porque es
 * lo que define la consulta SQL que alimenta las dos rejillas. Las opciones
 * (sets, rarezas, idiomas) salen del catálogo real, no de una lista fija: cada
 * set nuevo estrena rarezas.
 */

const PRESET_LABEL: Record<Effect3d, { es: [string, string]; en: [string, string] }> = {
  rainbow: {
    es: ['Arcoíris', 'INCLINACIÓN SUAVE · SOMBRA AMPLIA'],
    en: ['Rainbow', 'SOFT TILT · WIDE SHADOW']
  },
  prism: {
    es: ['Prismático', 'INCLINACIÓN FUERTE · SOMBRA CERRADA'],
    en: ['Prismatic', 'HARD TILT · TIGHT SHADOW']
  },
  glitter: {
    es: ['Glitter', 'POCA INCLINACIÓN · SOMBRA DIFUSA'],
    en: ['Glitter', 'LOW TILT · DIFFUSE SHADOW']
  }
}

const SECTION: React.CSSProperties = {
  padding: '16px 18px',
  borderBottom: '1px solid var(--rule)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10
}

export function Sidebar({ strings, lang }: { strings: Strings; lang: UiLang }): React.JSX.Element {
  const view = useStore((s) => s.view)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const resetFilters = useStore((s) => s.resetFilters)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const ceiling = useStore((s) => s.priceCeiling)
  const options = useFilterOptions()

  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<'min' | 'max' | null>(null)

  const hasCatalog = (options.data?.sets.length ?? 0) > 0

  // ── Deslizador doble de precio ─────────────────────────────────────────────
  const priceAt = (clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    // Se redondea a sesenta pasos, como el diseño, para que el tirador encaje.
    return Math.round((p * ceiling) / (ceiling / 60)) * (ceiling / 60)
  }

  const applyPrice = (v: number): void => {
    if (dragging.current === 'min') setFilters({ minCents: Math.min(v, filters.maxCents) })
    else setFilters({ maxCents: Math.max(v, filters.minCents) })
  }

  const chooseEffect = async (effect: Effect3d): Promise<void> => {
    applyPreset(effect)
    setPointerPreset(effect)
    setSettings(await call('settings:patch', { effect3d: effect }))
  }

  const pill = (active: boolean): React.CSSProperties => ({
    border: `1px solid ${active ? 'var(--ac)' : 'var(--rule)'}`,
    background: active ? 'var(--ac-brand-wash)' : 'transparent',
    color: active ? 'var(--ac)' : 'var(--soft)',
    padding: '6px 9px',
    cursor: 'pointer'
  })

  const langOptions: (CardLang | 'all')[] = ['all', 'es', 'en', 'ja']

  return (
    <aside
      style={{
        width: 252,
        flex: '0 0 252px',
        borderRight: '1px solid var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--paper)',
        minHeight: 0
      }}
    >
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--rule)' }}>
        <Input
          label={strings.search}
          value={filters.search}
          onChange={(search) => setFilters({ search })}
          placeholder={strings.searchPlaceholder}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* ── Sets ── */}
        <div style={{ ...SECTION, gap: 9 }}>
          <Eyebrow>{strings.fSet}</Eyebrow>
          {hasCatalog ? (
            <>
              <FilterRow
                label={strings.all}
                count={options.data?.sets.reduce((a, s) => a + s.count, 0) ?? 0}
                active={filters.setId === 'all'}
                onClick={() => setFilters({ setId: 'all' })}
              />
              {options.data?.sets.map((s) => (
                <FilterRow
                  key={s.id}
                  label={s.name}
                  count={s.count}
                  active={filters.setId === s.id}
                  onClick={() => setFilters({ setId: s.id })}
                />
              ))}
            </>
          ) : (
            <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
              {strings.noFilters}
            </span>
          )}
        </div>

        {/* ── Idioma ── */}
        <div style={SECTION}>
          <Eyebrow>{strings.fLang}</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {langOptions.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setFilters({ lang: code })}
                className="font-code"
                style={pill(filters.lang === code)}
              >
                <span style={{ fontSize: 9.5, letterSpacing: '.1em', fontWeight: 600 }}>
                  {code === 'all' ? strings.allShort : code === 'ja' ? 'JP' : code.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Rareza ── */}
        <div style={SECTION}>
          <Eyebrow>{strings.fRarity}</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              onClick={() => setFilters({ rarity: 'all' })}
              className="font-code"
              style={pill(filters.rarity === 'all')}
            >
              <span style={{ fontSize: 9.5, letterSpacing: '.06em', fontWeight: 600 }}>
                {strings.allShort}
              </span>
            </button>
            {options.data?.rarities.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setFilters({ rarity: r.value })}
                className="font-code"
                style={pill(filters.rarity === r.value)}
                title={`${r.count}`}
              >
                <span style={{ fontSize: 9.5, letterSpacing: '.06em', fontWeight: 600 }}>
                  {r.value}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Precio ── */}
        <div style={{ ...SECTION, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <Eyebrow>{strings.fPrice}</Eyebrow>
            <span
              className="font-code text-ink tabular"
              style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {money(filters.minCents, lang)} – {money(filters.maxCents, lang)}
            </span>
          </div>
          <div
            ref={trackRef}
            onPointerDown={(e) => {
              const v = priceAt(e.clientX)
              dragging.current =
                Math.abs(v - filters.minCents) <= Math.abs(v - filters.maxCents) ? 'min' : 'max'
              e.currentTarget.setPointerCapture(e.pointerId)
              applyPrice(v)
            }}
            onPointerMove={(e) => {
              if (dragging.current) applyPrice(priceAt(e.clientX))
            }}
            onPointerUp={() => {
              dragging.current = null
            }}
            style={{ position: 'relative', height: 22, cursor: 'ew-resize', touchAction: 'none' }}
          >
            <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 2, background: 'var(--rule)' }} />
            <div
              style={{
                position: 'absolute',
                top: 10,
                height: 2,
                left: `${(filters.minCents / ceiling) * 100}%`,
                width: `${((filters.maxCents - filters.minCents) / ceiling) * 100}%`,
                background: 'var(--ac)'
              }}
            />
            {([filters.minCents, filters.maxCents] as const).map((v, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: 5,
                  left: `${(v / ceiling) * 100}%`,
                  marginLeft: -6,
                  width: 12,
                  height: 12,
                  background: 'var(--ac)',
                  border: '1px solid var(--paper)'
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.12em' }}>
              {strings.fMin}
            </span>
            <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.12em' }}>
              {strings.fMax}
            </span>
          </div>
        </div>

        {/* ── Efecto 3D ── */}
        <div style={SECTION}>
          <Eyebrow>{strings.effect3d}</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--rule)' }}>
            {EFFECTS_3D.map((effect) => {
              const active = settings.effect3d === effect
              const [label, hint] = PRESET_LABEL[effect][lang]
              return (
                <button
                  key={effect}
                  type="button"
                  onClick={() => void chooseEffect(effect)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'flex-start',
                    background: active ? 'var(--card)' : 'var(--paper)',
                    border: 0,
                    borderLeft: `2px solid ${active ? 'var(--ac)' : 'transparent'}`,
                    padding: '9px 11px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <span
                    className="font-brand"
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      letterSpacing: '-.01em',
                      color: active ? 'var(--ink)' : 'var(--soft)'
                    }}
                  >
                    {label}
                  </span>
                  <span className="font-code text-faint" style={{ fontSize: 9, letterSpacing: '.04em' }}>
                    {hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Interruptores ── */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/*
           * En la Colección este interruptor no hace nada: el ámbito de la
           * consulta ya filtra a lo que tienes. Sólo se enseña donde cambia
           * algo, que es el Explorador.
           */}
          {view === 'explorer' ? (
          <button
            type="button"
            onClick={() => setFilters({ ownedOnly: !filters.ownedOnly })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'none',
              border: 0,
              padding: 0,
              cursor: 'pointer'
            }}
          >
            <span
              className="font-code"
              style={{
                width: 15,
                height: 15,
                flex: '0 0 15px',
                border: `1px solid ${filters.ownedOnly ? 'var(--ac)' : 'var(--rule)'}`,
                background: filters.ownedOnly ? 'var(--ac)' : 'transparent',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--on-brand)'
              }}
            >
              <span style={{ fontSize: 9, lineHeight: 1 }}>{filters.ownedOnly ? '×' : ''}</span>
            </span>
            <span className="font-brand text-soft" style={{ fontSize: 12.5 }}>
              {strings.ownedOnly}
            </span>
          </button>
          ) : null}

          <button
            type="button"
            onClick={resetFilters}
            className="font-code text-faint"
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontSize: 9.5, letterSpacing: '.16em' }}>{strings.reset}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}

function FilterRow({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 10,
        width: '100%',
        background: 'none',
        border: 0,
        padding: '4px 0',
        cursor: 'pointer',
        textAlign: 'left',
        color: active ? 'var(--ac)' : 'var(--soft)'
      }}
    >
      <span className="font-brand ellipsis" style={{ fontSize: 13, letterSpacing: '-.01em' }}>
        {label}
      </span>
      <span className="font-code tabular" style={{ fontSize: 9.5, opacity: 0.7 }}>
        {count}
      </span>
    </button>
  )
}
