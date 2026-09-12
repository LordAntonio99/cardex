import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanEngineStatus, ScanStatus } from '@shared/types'
import { Button, Eyebrow, GridTexture } from '../ds'
import type { Strings } from '../../i18n'

/**
 * La cámara y el disparo.
 *
 * El auto-disparo es puro JavaScript sobre un lienzo diminuto: nada de visión
 * por computador aquí. El renderer corre en un sandbox con una CSP que no
 * permite WebAssembly, y relajarla para ahorrarse cuatro restas no compensa. Lo
 * único que hace esta vista es decidir CUÁNDO merece la pena mandar un
 * fotograma; el reconocimiento de verdad ocurre en el proceso auxiliar.
 */

type CamState = 'off' | 'starting' | 'live' | 'denied'

/** Lado del lienzo de trabajo. Con esto sobra para medir movimiento. */
const WORK_W = 96
const WORK_H = 132

/** Veces por segundo que se mira el fotograma. */
const TICK_HZ = 8

/**
 * Umbrales del disparo automático, en niveles de gris medios (0-255).
 *
 * `PRESENCE_ON` es cuánto tiene que cambiar el marco respecto al fondo vacío
 * para creer que hay algo; `MOTION_STILL`, cuánto puede cambiar entre
 * fotogramas para considerarlo quieto. Son generosos a propósito: equivocarse
 * disparando de más sólo cuesta 100 ms de reconocimiento, y el resultado malo
 * se descarta solo.
 */
const PRESENCE_ON = 14
const PRESENCE_OFF = 7
const MOTION_STILL = 3.2
const STILL_TICKS = 4
const CLEAR_TICKS = 6

export interface CameraHandle {
  busy: boolean
  lastStatus: ScanStatus | null
}

export function CameraPane({
  strings,
  engine,
  hasCatalog,
  auto,
  onToggleAuto,
  onCapture,
  busy,
  lastStatus,
  cameraId,
  cameraLabel,
  onPickCamera
}: {
  strings: Strings
  engine: ScanEngineStatus | undefined
  hasCatalog: boolean
  auto: boolean
  onToggleAuto: (next: boolean) => void
  onCapture: (jpegDataUrl: string) => void
  busy: boolean
  lastStatus: ScanStatus | null
  cameraId: string | null
  cameraLabel: string | null
  onPickCamera: (device: { id: string; label: string }) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cam, setCam] = useState<CamState>('off')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [hint, setHint] = useState<'idle' | 'hold' | 'ready'>('idle')
  const [flash, setFlash] = useState(false)

  // Lo que necesita el bucle y no debe provocar renderizados.
  const workRef = useRef<HTMLCanvasElement | null>(null)
  const baselineRef = useRef<Float32Array | null>(null)
  const previousRef = useRef<Float32Array | null>(null)
  const stillRef = useRef(0)
  const clearRef = useRef(0)
  const armedRef = useRef(true)
  const busyRef = useRef(busy)
  const autoRef = useRef(auto)
  const lastTickRef = useRef(0)
  // El manejador llega como función nueva en cada renderizado. Guardado en una
  // referencia, `fire` deja de cambiar y el bucle de vídeo no tiene que
  // desmontarse y volver a registrarse cada vez que cambia un texto de ayuda.
  const onCaptureRef = useRef(onCapture)

  busyRef.current = busy
  autoRef.current = auto
  onCaptureRef.current = onCapture

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    baselineRef.current = null
    previousRef.current = null
  }, [])

  /** Abre la cámara elegida, o la primera si la guardada ya no está. */
  const start = useCallback(
    async (preferredId?: string | null) => {
      setCam('starting')
      stop()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(preferredId ? { deviceId: { exact: preferredId } } : {}),
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCam('live')

        // Las etiquetas de los dispositivos sólo aparecen una vez concedido el
        // permiso, así que la lista se pide DESPUÉS de abrir la cámara.
        const all = await navigator.mediaDevices.enumerateDevices()
        setDevices(all.filter((d) => d.kind === 'videoinput'))
      } catch {
        // Permiso denegado, sin cámara, o en uso por otra aplicación.
        setCam('denied')
      }
    },
    [stop]
  )

  /**
   * Arranque con recuperación por nombre.
   *
   * El identificador de dispositivo no sobrevive a un cambio de puerto USB ni,
   * en algunos equipos, a un reinicio. Si el guardado ya no vale se reintenta
   * buscando la cámara por su nombre, que es lo que el usuario reconoce.
   */
  const startPreferred = useCallback(async () => {
    if (cameraId) {
      try {
        await start(cameraId)
        return
      } catch {
        // Sigue abajo.
      }
    }
    if (cameraLabel) {
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      const match = all.find((d) => d.kind === 'videoinput' && d.label === cameraLabel)
      if (match) {
        await start(match.deviceId)
        return
      }
    }
    await start(null)
  }, [cameraId, cameraLabel, start])

  // Al salir de la vista se suelta la cámara: dejar el piloto encendido de
  // fondo sería inaceptable.
  useEffect(() => stop, [stop])

  /** Rectángulo de la guía, en píxeles del vídeo. */
  const guideInVideo = useCallback((): { x: number; y: number; w: number; h: number } | null => {
    const video = videoRef.current
    const box = boxRef.current
    if (!video || !box || !video.videoWidth) return null
    const bw = box.clientWidth
    const bh = box.clientHeight
    // `object-fit: cover`: el vídeo se escala hasta tapar la caja y se recorta.
    const scale = Math.max(bw / video.videoWidth, bh / video.videoHeight)
    const guideW = bw * 0.38
    const guideH = (guideW * 88) / 63
    const w = guideW / scale
    const h = guideH / scale
    return { x: (video.videoWidth - w) / 2, y: (video.videoHeight - h) / 2, w, h }
  }, [])

  /** Fotograma completo en JPEG, que es lo que necesita el reconocedor. */
  const grabFull = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  }, [])

  const fire = useCallback(() => {
    const jpeg = grabFull()
    if (!jpeg) return
    setFlash(true)
    setTimeout(() => setFlash(false), 180)
    onCaptureRef.current(jpeg)
  }, [grabFull])

  /**
   * El bucle de vigilancia.
   *
   * Mira sólo la región de la guía, reducida a 96x132 en gris. Compara con el
   * fotograma anterior (¿se mueve?) y con el fondo vacío (¿hay algo?). Cuando
   * hay algo y lleva unos fotogramas quieto, dispara; luego se desarma hasta
   * que la carta se retira, para no meter la misma dos veces.
   */
  useEffect(() => {
    if (cam !== 'live') return
    const video = videoRef.current
    if (!video) return

    workRef.current ??= document.createElement('canvas')
    const canvas = workRef.current
    canvas.width = WORK_W
    canvas.height = WORK_H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let cancelled = false
    let handle = 0

    const tick = (): void => {
      if (cancelled) return
      const now = performance.now()
      if (now - lastTickRef.current >= 1000 / TICK_HZ) {
        lastTickRef.current = now
        measure()
      }
      handle = video.requestVideoFrameCallback(tick)
    }

    const measure = (): void => {
      const guide = guideInVideo()
      if (!guide) return
      ctx.drawImage(video, guide.x, guide.y, guide.w, guide.h, 0, 0, WORK_W, WORK_H)
      const { data } = ctx.getImageData(0, 0, WORK_W, WORK_H)

      const gray = new Float32Array(WORK_W * WORK_H)
      for (let i = 0; i < gray.length; i += 1) {
        const o = i * 4
        gray[i] = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!
      }

      baselineRef.current ??= gray.slice()
      const previous = previousRef.current
      previousRef.current = gray

      const meanDiff = (a: Float32Array, b: Float32Array): number => {
        let sum = 0
        for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i]! - b[i]!)
        return sum / a.length
      }

      const presence = meanDiff(gray, baselineRef.current)
      const motion = previous ? meanDiff(gray, previous) : 999

      // Desarmado tras un disparo: se espera a que el marco vuelva a estar
      // vacío. Así una carta que se queda en la mesa no se escanea en bucle.
      if (!armedRef.current) {
        if (presence < PRESENCE_OFF) {
          clearRef.current += 1
          if (clearRef.current >= CLEAR_TICKS) {
            armedRef.current = true
            clearRef.current = 0
            // El fondo se reaprende: la luz de la habitación cambia.
            baselineRef.current = gray.slice()
            setHint('idle')
          }
        } else {
          clearRef.current = 0
        }
        return
      }

      if (presence < PRESENCE_ON) {
        stillRef.current = 0
        setHint('idle')
        return
      }

      if (motion > MOTION_STILL) {
        stillRef.current = 0
        setHint('hold')
        return
      }

      stillRef.current += 1
      setHint(stillRef.current >= STILL_TICKS ? 'ready' : 'hold')

      if (stillRef.current >= STILL_TICKS && autoRef.current && !busyRef.current) {
        armedRef.current = false
        stillRef.current = 0
        fire()
      }
    }

    handle = video.requestVideoFrameCallback(tick)
    return () => {
      cancelled = true
      if (handle) video.cancelVideoFrameCallback(handle)
    }
  }, [cam, fire, guideInVideo])

  // ── Presentación ───────────────────────────────────────────────────────────

  const engineLabel = ((): { text: string; tone: string } => {
    switch (engine?.state) {
      case 'ready':
        return { text: strings.engineReady, tone: 'var(--ok)' }
      case 'loading':
        return { text: strings.engineLoading, tone: 'var(--ac)' }
      case 'error':
        return { text: strings.engineError, tone: 'oklch(.62 .17 25)' }
      case 'unavailable':
        return { text: strings.engineUnavailable, tone: 'oklch(.72 .15 70)' }
      default:
        return { text: strings.engineOff, tone: 'var(--faint)' }
    }
  })()

  const feedback = ((): string => {
    if (busy) return strings.seeWorking
    switch (lastStatus) {
      case 'no_card':
        return strings.seeNoCard
      case 'blurry':
        return strings.seeBlurry
      case 'glare':
        return strings.seeGlare
      case 'unknown':
        return strings.seeUnknown
      default:
        return hint === 'ready' ? strings.seeReady : hint === 'hold' ? strings.seeHold : ''
    }
  })()

  const live = cam === 'live'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--rule)',
        minHeight: 0
      }}
    >
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
          <p
            className="type-body-sm text-soft"
            style={{ margin: 0, maxWidth: '52ch', textWrap: 'pretty' }}
          >
            {strings.scanSub}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button variant="ghost" size="sm" onClick={() => (live ? (stop(), setCam('off')) : void startPreferred())}>
            {live ? strings.scanPause : strings.scanStart}
          </Button>
          <Button
            variant="brand"
            size="sm"
            onClick={fire}
            disabled={!live || busy || !hasCatalog}
            title={hasCatalog ? undefined : strings.scanNoCatalog}
          >
            {strings.scanCapture}
          </Button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          padding: 26,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          background: 'var(--deep)',
          overflowY: 'auto',
          minHeight: 0
        }}
      >
        <div
          ref={boxRef}
          style={{
            position: 'relative',
            // `margin: auto` en vez de `justifyContent: center` en el padre:
            // con desbordamiento, centrar recorta la parte de arriba y deja
            // contenido fuera de alcance.
            marginTop: 'auto',
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
              display: live ? 'block' : 'none'
            }}
          />
          {!live ? <GridTexture /> : null}

          {/* Marco de escaneo. */}
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <div
              style={{
                position: 'relative',
                width: '38%',
                aspectRatio: '63 / 88',
                border: `1px solid ${hint === 'ready' ? 'var(--ok)' : 'rgba(151, 113, 226, .75)'}`,
                background: hint === 'ready' ? 'rgba(30, 158, 90, .10)' : 'rgba(138, 92, 223, .07)',
                transition: 'border-color .15s, background .15s'
              }}
            >
              {live && hint !== 'ready' ? (
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
            </div>
          </div>

          {/* Destello de captura. */}
          {flash ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--on-brand)',
                opacity: 0.5,
                pointerEvents: 'none'
              }}
            />
          ) : null}

          {/* Estado del motor. */}
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
                background: engineLabel.tone,
                animation: engine?.state === 'loading' ? 'cdx-blip 1.1s ease-in-out infinite' : 'none'
              }}
            />
            <span
              className="font-code"
              style={{ fontSize: 9, letterSpacing: '.16em', color: 'var(--on-deep-soft)' }}
            >
              {engineLabel.text}
            </span>
            {engine?.state === 'ready' ? (
              <span className="font-code" style={{ fontSize: 9, color: 'var(--on-deep-faint)' }}>
                · {engine.refCount.toLocaleString()} {strings.engineRefsSuffix}
              </span>
            ) : null}
          </div>

          {/* Lo que ve la cámara ahora mismo. */}
          {feedback ? (
            <div
              style={{
                position: 'absolute',
                left: 14,
                right: 14,
                bottom: 14,
                padding: '8px 12px',
                border: '1px solid var(--on-deep-rule)',
                background: 'rgba(13, 14, 16, .86)',
                textAlign: 'center'
              }}
            >
              <span className="type-body-sm" style={{ color: 'var(--on-deep-soft)' }}>
                {feedback}
              </span>
            </div>
          ) : null}
        </div>

        {/* Controles bajo la imagen. */}
        <div
          style={{
            width: '100%',
            maxWidth: 560,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 'auto'
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => onToggleAuto(e.target.checked)}
              style={{ accentColor: 'var(--ac)', width: 15, height: 15 }}
            />
            <span className="type-body-sm" style={{ color: 'var(--on-deep-soft)' }}>
              {strings.scanAuto}
            </span>
            <span className="font-code" style={{ fontSize: 9, color: 'var(--on-deep-faint)' }}>
              {auto ? strings.scanAutoOn : strings.scanAutoOff}
            </span>
          </label>

          {devices.length > 1 ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="font-code" style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--on-deep-faint)' }}>
                {strings.scanCamera}
              </span>
              <select
                value={cameraId ?? devices[0]?.deviceId ?? ''}
                onChange={(e) => {
                  const device = devices.find((d) => d.deviceId === e.target.value)
                  if (!device) return
                  onPickCamera({ id: device.deviceId, label: device.label })
                  void start(device.deviceId)
                }}
                className="font-brand"
                style={{
                  background: 'transparent',
                  color: 'var(--on-deep-soft)',
                  border: '1px solid var(--on-deep-rule)',
                  padding: '5px 7px',
                  fontSize: 12,
                  maxWidth: 220
                }}
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId} style={{ color: 'var(--ink)' }}>
                    {d.label || strings.scanCamera}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
          {hasCatalog ? strings.scanTips : strings.scanNoCatalog}
        </span>
        {engine?.message ? (
          <span className="type-body-sm" style={{ color: 'oklch(.72 .15 70)', margin: 0 }}>
            {engine.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}
