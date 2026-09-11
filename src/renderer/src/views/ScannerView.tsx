import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanDetection, UiLang } from '@shared/types'
import { Button, Eyebrow, GridTexture } from '../components/ds'
import { call, useCatalogStatus } from '../lib/api'
import { money } from '../lib/format'
import { artGradient } from '../lib/holo'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'

/**
 * Escáner por lotes.
 *
 * La cámara, la cola y la confirmación son reales: al confirmar, las cartas
 * entran en la base como movimientos de tipo 'pull'. Lo único simulado es el
 * reconocimiento, que vive detrás de `scan:identify` en el proceso main. Cuando
 * entre el reconocimiento de verdad (hash perceptual contra `cards.phash`, y
 * OCR del número después), esta vista no cambia.
 */

type CamState = 'off' | 'starting' | 'live' | 'paused' | 'denied'

export function ScannerView({
  strings,
  lang
}: {
  strings: Strings
  lang: UiLang
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cam, setCam] = useState<CamState>('off')
  const [queue, setQueue] = useState<ScanDetection[]>([])
  const [busy, setBusy] = useState(false)
  const catalog = useCatalogStatus()
  const setView = useStore((s) => s.setView)

  const hasCatalog = (catalog.data?.installed.cardCount ?? 0) > 0

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const start = useCallback(async () => {
    setCam('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment' },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCam('live')
    } catch {
      // Permiso denegado, sin cámara, o en uso por otra aplicación.
      setCam('denied')
    }
  }, [])

  // Al salir de la vista se suelta la cámara: dejar el piloto encendido de
  // fondo sería inaceptable.
  useEffect(() => stop, [stop])

  const toggle = (): void => {
    if (cam === 'live') {
      stop()
      setCam('paused')
    } else {
      void start()
    }
  }

  const detect = async (): Promise<void> => {
    const canvas = document.createElement('canvas')
    const video = videoRef.current
    let dataUrl = ''
    if (video && cam === 'live' && video.videoWidth > 0) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    }
    const detection = await call('scan:identify', { imageDataUrl: dataUrl })
    if (detection) setQueue((q) => [...q, detection])
  }

  const commit = async (): Promise<void> => {
    if (!queue.length) return
    setBusy(true)
    try {
      await call('scan:commit', { detections: queue })
      setQueue([])
      setView('collection')
    } finally {
      setBusy(false)
    }
  }

  const statusLabel =
    cam === 'live'
      ? strings.scanLive
      : cam === 'denied'
        ? strings.scanNoCam
        : cam === 'starting'
          ? strings.loading
          : strings.scanPaused

  const statusColor = cam === 'live' ? 'var(--ok)' : cam === 'denied' ? 'oklch(.62 .17 25)' : 'var(--faint)'

  return (
    <main
      style={{
        flex: 1,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 340px',
        alignItems: 'stretch',
        overflow: 'hidden'
      }}
    >
      {/* ── Cámara ── */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--rule)', minHeight: 0 }}>
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
            <Eyebrow tone="brand">{strings.scanEyebrow}</Eyebrow>
            <h1 className="type-h3 text-ink" style={{ margin: 0 }}>
              {strings.scanTitle}
            </h1>
            <p className="type-body-sm text-soft" style={{ margin: 0, maxWidth: '52ch', textWrap: 'pretty' }}>
              {strings.scanSub}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button variant="ghost" size="sm" onClick={toggle}>
              {cam === 'live' ? strings.scanPause : cam === 'paused' ? strings.scanResume : strings.scanStart}
            </Button>
            <Button variant="brand" size="sm" onClick={() => void detect()} disabled={!hasCatalog}>
              {strings.scanSimulate}
            </Button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            padding: 26,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            background: 'var(--deep)',
            overflowY: 'auto',
            minHeight: 0
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 560,
              aspectRatio: '4 / 3',
              border: '1px solid var(--on-deep-rule)',
              overflow: 'hidden'
            }}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: cam === 'live' ? 'block' : 'none'
              }}
            />
            {cam !== 'live' ? <GridTexture /> : null}

            {/* Marco de escaneo con la línea que barre. */}
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div
                style={{
                  position: 'relative',
                  width: '38%',
                  aspectRatio: '63 / 88',
                  border: '1px solid rgba(151, 113, 226, .75)',
                  background: 'rgba(138, 92, 223, .07)'
                }}
              >
                {cam === 'live' ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: -1,
                      right: -1,
                      height: 1,
                      background: 'var(--ac)',
                      boxShadow: '0 0 14px 2px rgba(151, 113, 226, .85)',
                      animation: 'cdx-scan 2.1s linear infinite'
                    }}
                  />
                ) : null}
                <div
                  style={{
                    position: 'absolute',
                    inset: -1,
                    border: '1px solid transparent',
                    borderTopColor: 'var(--ac)',
                    borderLeftColor: 'var(--ac)',
                    width: 16,
                    height: 16
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    border: '1px solid transparent',
                    borderBottomColor: 'var(--ac)',
                    borderRightColor: 'var(--ac)',
                    width: 16,
                    height: 16
                  }}
                />
              </div>
            </div>

            <div
              style={{
                position: 'absolute',
                left: 14,
                top: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                border: '1px solid var(--on-deep-rule)',
                background: 'rgba(13, 14, 16, .82)'
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  background: statusColor,
                  animation: cam === 'live' ? 'cdx-blip 1.1s ease-in-out infinite' : 'none'
                }}
              />
              <span className="font-code" style={{ fontSize: 9, letterSpacing: '.16em', color: 'var(--on-deep-soft)' }}>
                {statusLabel}
              </span>
            </div>

            <div
              style={{
                position: 'absolute',
                right: 14,
                bottom: 14,
                padding: '6px 10px',
                border: '1px solid var(--on-deep-rule)',
                background: 'rgba(13, 14, 16, .82)'
              }}
            >
              <span className="font-code" style={{ fontSize: 9, letterSpacing: '.12em', color: 'var(--on-deep-faint)' }}>
                {strings.scanCam}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: '14px 26px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.14em' }}>
            {strings.scanHint}
          </span>
          {cam === 'denied' ? (
            <span className="type-body-sm" style={{ color: 'oklch(.62 .17 25)', margin: 0 }}>
              {strings.scanPermDenied}
            </span>
          ) : null}
          <span className="type-body-sm text-soft" style={{ margin: 0, maxWidth: '70ch' }}>
            {hasCatalog ? strings.scanNotReal : strings.scanNoCatalog}
          </span>
        </div>
      </div>

      {/* ── Lote ── */}
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
            queue.map((d, i) => (
              <div
                key={d.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '46px minmax(0, 1fr)',
                  gap: 12,
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--rule)'
                }}
              >
                <div
                  style={{
                    aspectRatio: '63 / 88',
                    borderRadius: 3,
                    border: '1px solid rgba(237,234,227,.16)',
                    background: artGradient([])
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <span
                    className="font-brand text-ink ellipsis"
                    style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-.01em' }}
                  >
                    {d.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="font-code text-faint tabular" style={{ fontSize: 9 }}>
                      {d.numberLabel}
                    </span>
                    <span className="font-code text-faint" style={{ fontSize: 9 }}>
                      ·
                    </span>
                    <span className="font-code text-faint" style={{ fontSize: 9 }}>
                      {d.lang.toUpperCase()}
                    </span>
                    <span className="font-code text-faint" style={{ fontSize: 9 }}>
                      ·
                    </span>
                    <span className="font-code text-ink tabular" style={{ fontSize: 9.5, fontWeight: 700 }}>
                      {money(d.priceCents, lang)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 2, background: 'var(--rule)', position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${d.confidence}%`,
                          background:
                            d.confidence > 90 ? 'var(--ok)' : d.confidence > 80 ? 'var(--ac)' : 'oklch(.72 .15 70)'
                        }}
                      />
                    </div>
                    <span
                      className="font-code tabular"
                      style={{
                        fontSize: 9,
                        color: d.confidence > 90 ? 'var(--ok)' : d.confidence > 80 ? 'var(--ac)' : 'oklch(.72 .15 70)'
                      }}
                    >
                      {d.confidence.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 2 }}>
                    <button
                      type="button"
                      onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                      className="font-code"
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--faint)' }}
                    >
                      <span style={{ fontSize: 9, letterSpacing: '.14em' }}>{strings.drop}</span>
                    </button>
                  </div>
                </div>
              </div>
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
          <Button
            variant="brand"
            fullWidth
            disabled={queue.length === 0 || busy}
            onClick={() => void commit()}
          >
            {strings.commit} ({queue.length})
          </Button>
          <button
            type="button"
            onClick={() => setQueue([])}
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
    </main>
  )
}
