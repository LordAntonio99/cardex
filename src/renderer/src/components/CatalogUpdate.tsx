import { useEffect, useRef, useState } from 'react'
import type { CatalogStatus } from '@shared/types'
import { Button, Eyebrow, GridTexture } from './ds'
import { call } from '../lib/api'
import type { Strings } from '../i18n'

/**
 * La pantalla que tapa la aplicación mientras llega catálogo nuevo.
 *
 * Antes, una actualización de catálogo ocurría en silencio: la aplicación se
 * abría, los sets aparecían de golpe un minuto después y nadie sabía por qué.
 * Peor en la primera ejecución, donde la rejilla está vacía hasta que termina y
 * parece que la aplicación no funciona.
 *
 * Tapa a propósito. Mientras se reescriben los sets, la rejilla está leyendo
 * filas que se están borrando y reinsertando; dejar al usuario navegar por ahí
 * enseña estados a medias y bloqueos de la base. Es un minuto, y el precio de
 * dejar mirar es un minuto de cosas raras.
 *
 * NO aparece en la comprobación diaria que no encuentra nada: sólo cuando hay
 * algo que traer de verdad.
 */

type Phase =
  | { kind: 'hidden' }
  | { kind: 'working'; status: CatalogStatus }
  | { kind: 'done' }

export function CatalogUpdate({ status, strings }: { status: CatalogStatus | undefined; strings: Strings }): React.JSX.Element | null {
  const [phase, setPhase] = useState<Phase>({ kind: 'hidden' })
  const [restarting, setRestarting] = useState(false)
  // Si no llegamos a tapar la pantalla, tampoco hay que pedir un reinicio: no
  // se ha traído nada.
  const wasWorking = useRef(false)

  useEffect(() => {
    if (!status) return
    if (status.state === 'syncing') {
      wasWorking.current = true
      setPhase({ kind: 'working', status })
      return
    }
    if (wasWorking.current && (status.state === 'idle' || status.state === 'error')) {
      wasWorking.current = false
      setPhase({ kind: 'done' })
    }
  }, [status])

  if (phase.kind === 'hidden') return null

  const progress = phase.kind === 'working' ? phase.status.progress : undefined
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0
  const done = phase.kind === 'done'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'var(--deep)',
        display: 'grid',
        placeItems: 'center',
        padding: 40
      }}
    >
      <GridTexture />

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          gap: 22
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow tone="brand">{strings.catalogEyebrow}</Eyebrow>
          <h1 className="type-h3" style={{ margin: 0, color: 'var(--on-deep-ink, #fff)' }}>
            {done ? strings.catalogDoneTitle : strings.catalogWorkingTitle}
          </h1>
          <p
            className="type-body-sm"
            style={{ margin: 0, color: 'var(--on-deep-soft)', maxWidth: '44ch', textWrap: 'pretty' }}
          >
            {done ? strings.catalogDoneBody : strings.catalogWorkingBody}
          </p>
        </div>

        {/* La barra. En 'done' se queda llena en vez de desaparecer: el salto a
            vacío haría dudar de si terminó. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div
            style={{
              height: 3,
              background: 'var(--on-deep-rule)',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: `${done ? 100 : pct}%`,
                background: done ? 'var(--ok)' : 'var(--ac)',
                transition: 'width .35s ease'
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span
              className="font-code"
              style={{ fontSize: 9.5, letterSpacing: '.12em', color: 'var(--on-deep-faint)' }}
            >
              {done
                ? strings.catalogDoneStep
                : progress
                  ? `${progress.phase === 'recognition' ? strings.catalogStepVectors : strings.catalogStepSets}${progress.currentSet ? ` · ${progress.currentSet}` : ''}`
                  : strings.catalogStepChecking}
            </span>
            {progress && progress.total > 0 && !done ? (
              <span
                className="font-code tabular"
                style={{ fontSize: 9.5, color: 'var(--on-deep-faint)' }}
              >
                {progress.done} / {progress.total}
              </span>
            ) : null}
          </div>
        </div>

        {done ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Button variant="brand" onClick={() => { setRestarting(true); void call('system:restart', undefined) }} disabled={restarting}>
              {restarting ? strings.catalogRestarting : strings.catalogRestart}
            </Button>
            <button
              type="button"
              onClick={() => setPhase({ kind: 'hidden' })}
              className="font-code"
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                cursor: 'pointer',
                color: 'var(--on-deep-faint)'
              }}
            >
              <span style={{ fontSize: 9.5, letterSpacing: '.14em' }}>{strings.catalogLater}</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
