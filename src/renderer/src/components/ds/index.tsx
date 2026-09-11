import type { CSSProperties, ReactNode } from 'react'

/**
 * Primitivos del design system, reimplementados en React.
 *
 * Se reescriben en vez de arrastrar el runtime de Claude Design: son ocho
 * componentes pequeños y así la aplicación no depende de un intérprete de
 * plantillas en tiempo de ejecución. Todos los valores salen de los tokens del
 * bundle vendorizado, nunca de colores escritos a mano.
 */

// ── Eyebrow ──────────────────────────────────────────────────────────────────

export function Eyebrow({
  children,
  tone = 'default',
  style
}: {
  children: ReactNode
  tone?: 'default' | 'brand' | 'ink'
  style?: CSSProperties
}): React.JSX.Element {
  const color = tone === 'brand' ? 'var(--ac)' : tone === 'ink' ? 'var(--ink)' : 'var(--faint)'
  return (
    <span
      className="font-code"
      style={{ fontSize: 9.5, letterSpacing: '.2em', lineHeight: 1, color, ...style }}
    >
      {children}
    </span>
  )
}

// ── Tag ──────────────────────────────────────────────────────────────────────

export function Tag({
  children,
  tone = 'default',
  title
}: {
  children: ReactNode
  tone?: 'default' | 'brand'
  title?: string
}): React.JSX.Element {
  return (
    <span
      className="font-code"
      title={title}
      style={{
        fontSize: 9.5,
        letterSpacing: '.06em',
        padding: '3px 5px',
        border: `1px solid ${tone === 'brand' ? 'rgba(151,113,226,.5)' : 'var(--rule)'}`,
        color: tone === 'brand' ? 'var(--ac)' : 'var(--soft)',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  )
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'brand' | 'ghost' | 'quiet'

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled,
  fullWidth,
  title,
  style
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  disabled?: boolean
  fullWidth?: boolean
  title?: string
  style?: CSSProperties
}): React.JSX.Element {
  const palette: Record<ButtonVariant, CSSProperties> = {
    brand: { background: 'var(--ac)', color: 'var(--on-brand)', border: '1px solid var(--ac)' },
    ghost: { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)' },
    quiet: { background: 'transparent', color: 'var(--soft)', border: '0' }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-brand"
      style={{
        padding: size === 'sm' ? '9px 14px' : '12px 18px',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '-.01em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        width: fullWidth ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...palette[variant],
        ...style
      }}
    >
      {children}
    </button>
  )
}

// ── Input ────────────────────────────────────────────────────────────────────

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text'
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}): React.JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="font-brand"
        style={{
          background: 'transparent',
          border: 0,
          borderBottom: '1px solid var(--rule)',
          color: 'var(--ink)',
          fontSize: 14,
          padding: '7px 0',
          outline: 'none',
          width: '100%'
        }}
      />
    </label>
  )
}

// ── Indicadores ──────────────────────────────────────────────────────────────

export function OkDot({ on = true }: { on?: boolean }): React.JSX.Element {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        flex: '0 0 7px',
        background: on ? 'var(--ok)' : 'var(--faint)',
        animation: on ? 'var(--anim-dot)' : 'none'
      }}
    />
  )
}

export function GridTexture(): React.JSX.Element {
  return (
    <div
      className="ac-grid-texture"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  )
}

// ── ImageSlot ────────────────────────────────────────────────────────────────

/**
 * Hueco de imagen.
 *
 * El arte de sobres y productos no existe en ninguna API pública, así que
 * mientras no llegue del catálogo publicado se dibuja este marco con su
 * etiqueta, exactamente como en el diseño.
 */
export function ImageSlot({
  src,
  placeholder,
  title,
  style
}: {
  src?: string | null
  placeholder: string
  title?: string
  style?: CSSProperties
}): React.JSX.Element {
  if (src) {
    return (
      <img
        src={src}
        alt={title ?? placeholder}
        title={title}
        style={{ objectFit: 'contain', display: 'block', ...style }}
      />
    )
  }

  return (
    <div
      title={title}
      style={{
        border: '1px dashed var(--rule)',
        display: 'grid',
        placeItems: 'center',
        padding: 10,
        textAlign: 'center',
        ...style
      }}
    >
      <span
        className="font-code"
        style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--faint)', lineHeight: 1.5 }}
      >
        {(title ?? placeholder).toUpperCase()}
      </span>
    </div>
  )
}

// ── EmptyState ───────────────────────────────────────────────────────────────

/**
 * Estado vacío.
 *
 * Con la base recién creada es lo que más se ve, así que se trata como una
 * pantalla de pleno derecho y no como un hueco: etiqueta mono, filete, título
 * y una explicación de por qué está vacío y qué hacer al respecto.
 */
export function EmptyState({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 14,
        padding: '64px 26px',
        maxWidth: 560
      }}
    >
      <Eyebrow tone="brand">{eyebrow}</Eyebrow>
      <div style={{ height: 1, background: 'var(--rule)', width: 64 }} />
      <h2 className="type-h4 text-ink" style={{ margin: 0 }}>
        {title}
      </h2>
      <p
        className="type-body-sm text-soft"
        style={{ margin: 0, maxWidth: '52ch', textWrap: 'pretty' }}
      >
        {description}
      </p>
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  )
}
