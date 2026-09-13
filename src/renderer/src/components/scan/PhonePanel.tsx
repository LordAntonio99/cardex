import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PhoneSession } from '@shared/types'
import { Button, Eyebrow } from '../ds'
import { call, keys, useIpcEvent, usePhoneSession } from '../../lib/api'
import type { Strings } from '../../i18n'
import { QrCode } from './QrCode'

/**
 * Escanear con el móvil.
 *
 * Vive en la columna del lote, no en la de la cámara, por dos motivos. Uno, que
 * el QR y las cartas que van entrando se miran en el mismo momento. Y dos, que
 * la webcam no tiene por qué apagarse: las dos fuentes caen en el mismo lote, y
 * lo único que hay que evitar es que disparen a la vez, de lo que se encarga la
 * vista pausando el automático de la webcam mientras haya móvil conectado.
 */

/**
 * Cuánto se espera antes de dar por hecho que algo va mal.
 *
 * Desde dentro no hay forma de saber si el firewall está descartando los
 * paquetes: el socket escucha igual. Lo único observable es que no llega ningún
 * latido, así que se cuenta el tiempo y se despliega la ayuda sin que el usuario
 * tenga que buscarla.
 */
const HELP_AFTER_MS = 20_000

const FIREWALL_CMD =
  'New-NetFirewallRule -DisplayName "Cardex movil" -Direction Inbound -Action Allow ' +
  '-Program "$env:LOCALAPPDATA\\Programs\\Cardex\\Cardex.exe" -Protocol TCP -LocalPort 8770 -Profile Private'

export function PhonePanel({ strings }: { strings: Strings }): React.JSX.Element {
  const qc = useQueryClient()
  const query = usePhoneSession()
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  const [copied, setCopied] = useState(false)

  useIpcEvent(
    'phone:session',
    // Memoizado: `useIpcEvent` tiene el manejador en sus dependencias, y uno
    // nuevo en cada renderizado se daría de baja y de alta sin parar.
    useCallback((next: PhoneSession) => qc.setQueryData(keys.phone, next), [qc])
  )

  const session = query.data
  const state = session?.state ?? 'off'
  const connected = session?.connected ?? false

  // Si el móvil no ha dado señales en veinte segundos, la ayuda se abre sola.
  useEffect(() => {
    if (state !== 'listening' || connected) return
    const timer = setTimeout(() => setHelp(true), HELP_AFTER_MS)
    return () => clearTimeout(timer)
  }, [state, connected])

  useEffect(() => {
    if (connected) setHelp(false)
  }, [connected])

  const start = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      qc.setQueryData(keys.phone, await call('phone:start', undefined))
    } finally {
      setBusy(false)
    }
  }, [qc])

  const stop = useCallback(async (): Promise<void> => {
    await call('phone:stop', undefined)
    qc.setQueryData(keys.phone, await call('phone:status', undefined))
    setHelp(false)
  }, [qc])

  const copy = useCallback((): void => {
    void navigator.clipboard
      .writeText(FIREWALL_CMD)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => {
        // Sin portapapeles el comando sigue ahí, y se puede seleccionar a mano.
      })
  }, [])

  const frame: React.CSSProperties = {
    borderBottom: '1px solid var(--rule)',
    padding: '14px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  }

  // ── Apagado ────────────────────────────────────────────────────────────────
  if (state === 'off' || state === 'error') {
    return (
      <div style={frame}>
        <Eyebrow>{strings.phoneEyebrow}</Eyebrow>
        <p className="type-body-sm text-soft" style={{ margin: 0 }}>
          {strings.phoneIntro}
        </p>
        {state === 'error' ? (
          <p className="type-body-sm" style={{ margin: 0, color: 'oklch(.62 .17 25)' }}>
            {session?.message ?? strings.phoneError}
          </p>
        ) : null}
        {/* El aviso va ANTES del botón a propósito. El diálogo del firewall pide
            elevación, y uno que llega por sorpresa se cancela; cancelarlo crea
            una regla de bloqueo que ya no vuelve a preguntar nunca. */}
        <p className="type-body-sm text-faint" style={{ margin: 0 }}>
          {strings.phoneFirewallWarn}
        </p>
        <Button variant="ghost" size="sm" onClick={() => void start()} disabled={busy}>
          {state === 'error' ? strings.phoneRetry : strings.phoneStart}
        </Button>
      </div>
    )
  }

  // ── Arrancando ─────────────────────────────────────────────────────────────
  if (state === 'starting' || !session?.url) {
    return (
      <div style={frame}>
        <Eyebrow>{strings.phoneEyebrow}</Eyebrow>
        <span className="type-body-sm text-soft">{strings.phoneStarting}</span>
      </div>
    )
  }

  // ── Escuchando ─────────────────────────────────────────────────────────────
  return (
    <div style={frame}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Eyebrow>{strings.phoneEyebrow}</Eyebrow>
        <span
          style={{
            width: 6,
            height: 6,
            marginLeft: 'auto',
            background: connected ? 'var(--ok)' : 'var(--faint)'
          }}
        />
        <span className="font-code" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--faint)' }}>
          {connected ? strings.phoneConnected : strings.phoneWaiting}
        </span>
        {/* No es lo mismo que el tamaño del lote: aquí cuentan también las que
            salieron movidas o con brillo y no llegaron a entrar. */}
        {session.captureCount > 0 ? (
          <span className="font-code" style={{ fontSize: 9, color: 'var(--faint)' }}>
            · {session.captureCount} {strings.phoneCaptures}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
        <QrCode value={session.url} size={192} />
      </div>

      <span className="type-body-sm text-soft" style={{ textAlign: 'center' }}>
        {strings.phoneScanThis}
      </span>

      <code
        className="font-code"
        style={{
          fontSize: 10,
          color: 'var(--faint)',
          textAlign: 'center',
          wordBreak: 'break-all',
          userSelect: 'text'
        }}
      >
        {`${session.address}:${session.port}`}
      </code>

      {session.candidates.length > 1 ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="font-code" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--faint)' }}>
            {strings.phoneAddressLabel}
          </span>
          <select
            value={session.address ?? ''}
            onChange={(e) => {
              void call('phone:useAddress', { address: e.target.value }).then((next) =>
                qc.setQueryData(keys.phone, next)
              )
            }}
            className="font-brand"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              color: 'var(--soft)',
              border: '1px solid var(--rule)',
              padding: '4px 6px',
              fontSize: 11
            }}
          >
            {session.candidates.map((c) => (
              <option key={c.address} value={c.address} style={{ color: 'var(--ink)' }}>
                {c.address} · {c.iface}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="type-body-sm text-faint" style={{ margin: 0 }}>
        {strings.phoneCertNote}
      </p>

      {connected ? (
        <p className="type-body-sm text-faint" style={{ margin: 0 }}>
          {strings.phoneWebcamPaused}
        </p>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button variant="quiet" size="sm" onClick={() => void stop()}>
          {strings.phoneStop}
        </Button>
        <button
          type="button"
          onClick={() => setHelp((v) => !v)}
          className="type-body-sm"
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 0,
            color: 'var(--soft)',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            padding: 0
          }}
        >
          {strings.phoneHelpTitle}
        </button>
      </div>

      {help ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            border: '1px solid var(--rule)',
            background: 'var(--deep)'
          }}
        >
          <p className="type-body-sm text-soft" style={{ margin: 0 }}>
            {strings.phoneHelpFirewall}
          </p>
          <code
            className="font-code"
            style={{
              fontSize: 9.5,
              lineHeight: 1.6,
              color: 'var(--on-deep-soft)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              userSelect: 'text'
            }}
          >
            {FIREWALL_CMD}
          </code>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? strings.phoneCopied : strings.phoneCopy}
          </Button>
          <p className="type-body-sm text-faint" style={{ margin: 0 }}>
            {strings.phoneHelpProfile}
          </p>
          <p className="type-body-sm text-faint" style={{ margin: 0 }}>
            {strings.phoneHelpNetwork}
          </p>
        </div>
      ) : null}

      <p className="type-body-sm text-faint" style={{ margin: 0 }}>
        {strings.phoneQrWarning}
      </p>
    </div>
  )
}
