import { VARIANTS, type CardLang, type ScanCandidate, type Variant } from '@shared/types'
import { Button, Eyebrow } from '../ds'
import { money } from '../../lib/format'
import type { Strings } from '../../i18n'
import type { QueueItem } from '../../state/scan'
import type { UiLang } from '@shared/types'

/**
 * El lote pendiente de confirmar.
 *
 * Cada carta se puede revisar antes de que entre en la colección: cambiar la
 * elegida por otra de las candidatas, corregir la variante y el idioma, o
 * descartarla. Las que el reconocimiento no dio por seguras salen marcadas y con
 * las alternativas desplegadas: el objetivo es que confirmar el lote sea un acto
 * consciente, no un «aceptar» a ciegas.
 */

const BIT: Record<Variant, number> = { normal: 1, holo: 2, reverse: 4, first_ed: 8 }

function variantLabel(v: Variant, strings: Strings): string {
  return v === 'holo'
    ? strings.variantHolo
    : v === 'reverse'
      ? strings.variantReverse
      : v === 'first_ed'
        ? strings.variantFirstEd
        : strings.variantNormal
}

/** Fichas pequeñas para elegir entre pocas opciones. */
function Chips<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}): React.JSX.Element | null {
  if (options.length < 2) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="font-code text-faint" style={{ fontSize: 8.5, letterSpacing: '.12em' }}>
        {label}
      </span>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="font-code"
            style={{
              fontSize: 9,
              letterSpacing: '.04em',
              padding: '3px 6px',
              cursor: 'pointer',
              background: on ? 'rgba(151,113,226,.16)' : 'transparent',
              border: `1px solid ${on ? 'var(--ac)' : 'var(--rule)'}`,
              color: on ? 'var(--ac)' : 'var(--soft)'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Row({
  item,
  strings,
  lang,
  onChoose,
  onVariant,
  onLang,
  onRemove
}: {
  item: QueueItem
  strings: Strings
  lang: UiLang
  onChoose: (candidate: ScanCandidate) => void
  onVariant: (variant: Variant) => void
  onLang: (lang: CardLang) => void
  onRemove: () => void
}): React.JSX.Element {
  const needsCheck = item.status === 'confirm'
  const tone = needsCheck ? 'oklch(.72 .15 70)' : 'var(--ok)'
  // Sólo las alternativas que no son la ya elegida.
  const others = item.alternatives.filter((c) => c.cardId !== item.cardId).slice(0, 3)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '52px minmax(0, 1fr)',
        gap: 12,
        padding: '14px 20px',
        borderBottom: '1px solid var(--rule)',
        // La banda de color a la izquierda distingue de un vistazo lo aceptado
        // de lo que hay que mirar.
        boxShadow: `inset 2px 0 0 ${tone}`
      }}
    >
      {item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          style={{
            width: 52,
            aspectRatio: '63 / 88',
            objectFit: 'cover',
            borderRadius: 3,
            border: '1px solid var(--rule)'
          }}
        />
      ) : (
        <div
          style={{
            width: 52,
            aspectRatio: '63 / 88',
            borderRadius: 3,
            border: '1px solid var(--rule)',
            background: 'var(--deep)'
          }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
          <span
            className="font-brand text-ink ellipsis"
            style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.01em' }}
            title={item.name}
          >
            {item.name}
          </span>
          <span className="font-code tabular" style={{ fontSize: 9, color: tone, whiteSpace: 'nowrap' }}>
            {item.confidence.toFixed(0)}%
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="font-code text-faint tabular" style={{ fontSize: 9 }}>
            {item.numberLabel}
          </span>
          <span className="font-code text-faint" style={{ fontSize: 9 }}>
            ·
          </span>
          <span className="font-code text-ink tabular" style={{ fontSize: 9.5, fontWeight: 700 }}>
            {money(item.priceCents, lang)}
          </span>
        </div>

        {needsCheck ? (
          <span className="font-code" style={{ fontSize: 9, letterSpacing: '.1em', color: tone }}>
            {strings.scanConfirmNeeded.toUpperCase()}
          </span>
        ) : null}

        <Chips
          label={strings.scanVariant}
          value={item.variant}
          onChange={onVariant}
          options={VARIANTS.filter((v) => item.variantMask & BIT[v]).map((v) => ({
            value: v,
            label: variantLabel(v, strings)
          }))}
        />

        <Chips
          label={strings.scanLangShort}
          value={item.lang}
          onChange={onLang}
          options={item.langs.map((l) => ({ value: l, label: l.toUpperCase() }))}
        />

        {needsCheck && others.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 2 }}>
            <span className="font-code text-faint" style={{ fontSize: 8.5, letterSpacing: '.12em' }}>
              {strings.scanAlternatives.toUpperCase()}
            </span>
            {others.map((c) => (
              <button
                key={c.cardId}
                type="button"
                onClick={() => onChoose(c)}
                className="font-brand"
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 7,
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  padding: '5px 7px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--soft)',
                  fontSize: 11.5
                }}
              >
                <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>
                  {c.name}
                </span>
                <span className="font-code tabular text-faint" style={{ fontSize: 8.5 }}>
                  {c.numberLabel}
                </span>
                <span className="font-code tabular text-faint" style={{ fontSize: 8.5 }}>
                  {c.score.toFixed(0)}%
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 2 }}>
          <button
            type="button"
            onClick={onRemove}
            className="font-code"
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              cursor: 'pointer',
              color: 'var(--faint)'
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: '.14em' }}>{strings.drop}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export function BatchList({
  queue,
  strings,
  lang,
  busy,
  onChoose,
  onVariant,
  onLang,
  onRemove,
  onCommit,
  onClear
}: {
  queue: QueueItem[]
  strings: Strings
  lang: UiLang
  busy: boolean
  onChoose: (id: string, candidate: ScanCandidate) => void
  onVariant: (id: string, variant: Variant) => void
  onLang: (id: string, lang: CardLang) => void
  onRemove: (id: string) => void
  onCommit: () => void
  onClear: () => void
}): React.JSX.Element {
  const pending = queue.filter((q) => q.status === 'confirm').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--card)', minHeight: 0 }}>
      <div
        style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Eyebrow>{strings.batch}</Eyebrow>
          <span
            className="font-brand text-ink"
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.015em' }}
          >
            {queue.length === 1 ? strings.queueOne : strings.queueMany}
          </span>
          {pending > 0 ? (
            <span className="font-code" style={{ fontSize: 9, letterSpacing: '.1em', color: 'oklch(.72 .15 70)' }}>
              {pending} · {strings.scanConfirmNeeded.toUpperCase()}
            </span>
          ) : null}
        </div>
        <span className="font-code text-ink tabular" style={{ fontSize: 20, fontWeight: 700 }}>
          {queue.length}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {queue.length === 0 ? (
          <div style={{ padding: 20 }}>
            <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.1em' }}>
              {strings.queueEmpty}
            </span>
          </div>
        ) : (
          queue.map((item) => (
            <Row
              key={item.id}
              item={item}
              strings={strings}
              lang={lang}
              onChoose={(c) => onChoose(item.id, c)}
              onVariant={(v) => onVariant(item.id, v)}
              onLang={(l) => onLang(item.id, l)}
              onRemove={() => onRemove(item.id)}
            />
          ))
        )}
      </div>

      <div
        style={{
          padding: '18px 20px',
          borderTop: '1px solid var(--rule)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        <Button variant="brand" fullWidth disabled={queue.length === 0 || busy} onClick={onCommit}>
          {strings.commit} ({queue.length})
        </Button>
        <button
          type="button"
          onClick={onClear}
          disabled={queue.length === 0}
          className="font-code text-faint"
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            cursor: queue.length ? 'pointer' : 'default',
            opacity: queue.length ? 1 : 0.4
          }}
        >
          <span style={{ fontSize: 9.5, letterSpacing: '.16em' }}>{strings.clearBatch}</span>
        </button>
      </div>
    </div>
  )
}
