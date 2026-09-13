import { CARD_LANGS, type CardLang } from '@shared/types'
import { Eyebrow } from '../ds'
import type { Strings } from '../../i18n'

/**
 * El idioma de las cartas que hay encima de la mesa.
 *
 * No es una preferencia cosmética: el reconocimiento no puede deducir el idioma
 * mirando —la misma carta en español, inglés o japonés da cosenos casi
 * idénticos, porque sólo cambian unas líneas de texto pequeño— así que se lo
 * tiene que decir el usuario. Con las impresiones japonesas en el catálogo pasó
 * a decidir algo más gordo todavía: la japonesa es otra carta, de otro set y con
 * otro número, y sin esta declaración el escáner propone la occidental.
 *
 * Está en el escáner y no en los ajustes generales porque cambia con cada caja
 * que se abre, no una vez en la vida.
 */
export function ScanLang({
  value,
  onChange,
  strings
}: {
  value: CardLang | null
  onChange: (next: CardLang | null) => void
  strings: Strings
}): React.JSX.Element {
  // `null` es «el de la interfaz»: el valor por defecto no obliga a elegir a
  // quien sólo colecciona en un idioma.
  const options: { value: CardLang | null; label: string }[] = [
    { value: null, label: strings.scanLangAuto },
    ...CARD_LANGS.map((l) => ({ value: l as CardLang | null, label: l.toUpperCase() }))
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '12px 20px',
        borderBottom: '1px solid var(--rule)'
      }}
    >
      <Eyebrow>{strings.scanLangLabel}</Eyebrow>
      <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => onChange(o.value)}
              className="font-code"
              style={{
                fontSize: 9,
                letterSpacing: '.08em',
                padding: '4px 8px',
                cursor: 'pointer',
                border: `1px solid ${on ? 'var(--ac)' : 'var(--rule)'}`,
                background: on ? 'var(--ac)' : 'transparent',
                color: on ? 'var(--on-brand)' : 'var(--soft)'
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
