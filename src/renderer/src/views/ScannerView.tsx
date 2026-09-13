import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AppSettings, ScanStatus, UiLang } from '@shared/types'
import { BatchList } from '../components/scan/BatchList'
import { CameraPane } from '../components/scan/CameraPane'
import { PhonePanel } from '../components/scan/PhonePanel'
import { PhoneReview } from '../components/scan/PhoneReview'
import {
  call,
  keys,
  useCatalogStatus,
  useIpcEvent,
  usePhoneSession,
  useScanEngine,
  useSettings
} from '../lib/api'
import type { Strings } from '../i18n'
import { enqueueResult, useScanStore } from '../state/scan'
import { useStore } from '../state/store'

/**
 * Escáner por lotes.
 *
 * La vista orquesta y poco más: la cámara y el disparo viven en `CameraPane`, el
 * lote en `BatchList`, y el reconocimiento de verdad en el proceso auxiliar, al
 * otro lado de `scan:identify`.
 *
 * El lote se guarda en su propio store y no en el estado de este componente,
 * porque `App` desmonta la vista al cambiar de pantalla: con `useState`, ir a
 * mirar una carta a la colección y volver borraba el trabajo hecho.
 */
export function ScannerView({
  strings,
  lang
}: {
  strings: Strings
  lang: UiLang
}): React.JSX.Element {
  const qc = useQueryClient()
  const catalog = useCatalogStatus()
  const engine = useScanEngine()
  const settings = useSettings()
  const phone = usePhoneSession()
  const setView = useStore((s) => s.setView)
  const mirrorSettings = useStore((s) => s.setSettings)

  const queue = useScanStore((s) => s.queue)
  const choose = useScanStore((s) => s.choose)
  const setVariant = useScanStore((s) => s.setVariant)
  const setLang = useScanStore((s) => s.setLang)
  const remove = useScanStore((s) => s.remove)
  const clear = useScanStore((s) => s.clear)
  const review = useScanStore((s) => s.review)
  const acceptReview = useScanStore((s) => s.acceptReview)
  const rejectReview = useScanStore((s) => s.rejectReview)
  const dismissReview = useScanStore((s) => s.dismissReview)

  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [lastStatus, setLastStatus] = useState<ScanStatus | null>(null)
  const [added, setAdded] = useState(0)

  const hasCatalog = (catalog.data?.installed.cardCount ?? 0) > 0

  // El estado del motor llega por evento, pero los que se emiten antes de montar
  // la vista se pierden: por eso además se consulta al entrar.
  useIpcEvent(
    'scan:engine',
    useCallback((status) => qc.setQueryData(keys.scanEngine, status), [qc])
  )

  /**
   * Se enciende el motor al entrar y se suelta al salir.
   *
   * Cargar el modelo lleva un segundo largo, así que se adelanta mientras el
   * usuario coloca la primera carta. Y al salir se libera: son cientos de megas
   * que no tiene sentido retener mirando la colección.
   */
  useEffect(() => {
    void call('scan:warmup', undefined)
    return () => {
      void call('scan:release', undefined)
    }
  }, [])

  const capture = useCallback(
    async (imageDataUrl: string): Promise<void> => {
      setBusy(true)
      try {
        const result = await call('scan:identify', { imageDataUrl })
        setLastStatus(result.status)
        enqueueResult(result)
      } catch {
        // El motor informa de su estado por su cuenta; aquí basta con no dejar
        // la vista colgada en «reconociendo».
        setLastStatus('unknown')
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const commit = useCallback(async (): Promise<void> => {
    if (!queue.length) return
    setCommitting(true)
    try {
      const result = await call('scan:commit', {
        // Sólo lo que la colección necesita: la miniatura y las alternativas se
        // quedan aquí.
        detections: queue.map((q) => ({
          cardId: q.cardId,
          variant: q.variant,
          lang: q.lang,
          name: q.name,
          numberLabel: q.numberLabel
        }))
      })
      clear()
      setAdded(result.added)
      // No se navega a la colección: lo normal es seguir escaneando. El aviso
      // dice lo que ha entrado, y la colección se refresca sola.
    } finally {
      setCommitting(false)
    }
  }, [queue, clear])

  // El aviso de «añadidas» se va solo.
  useEffect(() => {
    if (!added) return
    const timer = setTimeout(() => setAdded(0), 6000)
    return () => clearTimeout(timer)
  }, [added])

  const patchSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      const next = await call('settings:patch', patch)
      mirrorSettings(next)
      qc.setQueryData(keys.settings, next)
    },
    [mirrorSettings, qc]
  )

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
      {/* Escaneando con el móvil, el panel de la webcam es espacio muerto: la
          cámara está apagada y la carta recién reconocida sólo se ve en la ficha
          del lote, que es donde peor se juzga si ha acertado. Mientras haya algo
          del móvil que revisar, este sitio lo ocupa la carta en grande. */}
      {review ? (
        <PhoneReview
          review={review}
          item={review.id ? queue.find((q) => q.id === review.id) : undefined}
          strings={strings}
          lang={lang}
          onAccept={acceptReview}
          onReject={rejectReview}
          onChoose={(candidate) => {
            if (review.id) choose(review.id, candidate)
            dismissReview()
          }}
          onDismiss={dismissReview}
        />
      ) : (
        <CameraPane
          strings={strings}
          engine={engine.data}
          hasCatalog={hasCatalog}
          // Con el móvil capturando, la webcam deja de dispararse sola: dos
          // fuentes automáticas sobre el mismo lote sólo producen duplicados. El
          // botón de capturar a mano sigue funcionando.
          auto={(settings.data?.scanAutoCapture ?? true) && !phone.data?.connected}
          onToggleAuto={(next) => void patchSettings({ scanAutoCapture: next })}
          onCapture={(jpeg) => void capture(jpeg)}
          busy={busy}
          lastStatus={lastStatus}
          cameraId={settings.data?.cameraId ?? null}
          cameraLabel={settings.data?.cameraLabel ?? null}
          onPickCamera={(device) =>
            void patchSettings({ cameraId: device.id, cameraLabel: device.label || null })
          }
        />
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          background: 'var(--card)'
        }}
      >
        {added > 0 ? (
          <button
            type="button"
            onClick={() => setView('collection')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 20px',
              border: 0,
              borderBottom: '1px solid var(--rule)',
              background: 'rgba(30, 158, 90, .12)',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <span
              className="font-code"
              style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--ok)' }}
            >
              {strings.committed.toUpperCase()}
            </span>
            <span className="type-body-sm text-soft">
              {added} {added === 1 ? strings.scanAddedOne : strings.scanAddedMany}
            </span>
          </button>
        ) : null}

        <PhonePanel strings={strings} />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <BatchList
            queue={queue}
            strings={strings}
            lang={lang}
            busy={committing}
            onChoose={choose}
            onVariant={setVariant}
            onLang={setLang}
            onRemove={remove}
            onCommit={() => void commit()}
            onClear={clear}
          />
        </div>
      </div>
    </main>
  )
}
