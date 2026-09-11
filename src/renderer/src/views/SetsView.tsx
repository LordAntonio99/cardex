import type { UiLang } from '@shared/types'
import { Button, EmptyState, Eyebrow, ImageSlot } from '../components/ds'
import { call, useAssetImage, useCatalogStatus, useSetProgress } from '../lib/api'
import { money } from '../lib/format'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'

/**
 * Sets y sobres.
 *
 * El arte de los sobres no está en ninguna API pública, así que hasta que
 * llegue del catálogo publicado a mano se dibuja el hueco con su etiqueta. Es
 * justo lo que el diseño ya preveía con los `image-slot`.
 */
export function SetsView({ strings, lang }: { strings: Strings; lang: UiLang }): React.JSX.Element {
  const sets = useSetProgress()
  const catalog = useCatalogStatus()
  const setView = useStore((s) => s.setView)
  const setFilters = useStore((s) => s.setFilters)

  const syncing = catalog.data?.state === 'syncing' || catalog.data?.state === 'checking'
  const rows = sets.data ?? []

  const openSet = (setId: string): void => {
    setFilters({ setId, ownedOnly: false })
    setView('explorer')
  }

  return (
    <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          padding: 26,
          borderBottom: '1px solid var(--rule)'
        }}
      >
        <Eyebrow tone="brand">{strings.setsEyebrow}</Eyebrow>
        <h1 className="type-h3 text-ink" style={{ margin: 0 }}>
          {strings.setsTitle}
        </h1>
        <p className="type-body-sm text-soft" style={{ margin: 0, maxWidth: '60ch', textWrap: 'pretty' }}>
          {strings.setsSub}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          eyebrow={strings.setsEyebrow}
          title={strings.emptySetsTitle}
          description={strings.emptySetsSub}
          action={
            <Button
              variant="brand"
              size="sm"
              disabled={syncing}
              onClick={() => void call('catalog:sync', { force: false })}
            >
              {syncing ? strings.catalogSyncing : strings.catalogSync}
            </Button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((row) => (
            <div
              key={row.set.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '210px minmax(0, 1fr)',
                gap: 26,
                padding: '24px 26px',
                borderBottom: '1px solid var(--rule)'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    background: 'var(--deep)',
                    border: '1px solid var(--rule)',
                    padding: 14,
                    display: 'grid',
                    placeItems: 'center'
                  }}
                >
                  <SetLogo
                    logoPath={row.set.logoPath}
                    name={row.set.name}
                    lang={lang}
                    placeholder={strings.logoPlaceholder}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                    <span
                      className="font-code"
                      style={{ fontSize: 9.5, letterSpacing: '.16em', color: 'var(--ac)' }}
                    >
                      {row.set.code ?? row.set.id.toUpperCase()}
                    </span>
                    <span className="font-code text-faint" style={{ fontSize: 9.5 }}>
                      {row.set.releasedOn?.slice(0, 4) ?? ''}
                    </span>
                  </div>
                  <span
                    className="font-brand text-ink"
                    style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.15 }}
                  >
                    {row.set.name}
                  </span>
                  <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.08em' }}>
                    {row.set.seriesId.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <span className="font-code text-soft" style={{ fontSize: 9.5, letterSpacing: '.14em' }}>
                      {strings.completion}
                    </span>
                    <span className="font-code text-ink tabular" style={{ fontSize: 11, fontWeight: 700 }}>
                      {row.pct.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ height: 3, background: 'var(--rule)', position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${Math.max(row.pct > 0 ? 1.5 : 0, row.pct)}%`,
                        background: 'var(--ac)'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <span className="font-code text-faint tabular" style={{ fontSize: 9.5 }}>
                      {row.ownedCards} / {row.set.totalOfficial}
                    </span>
                    <span className="font-code text-ink tabular" style={{ fontSize: 13, fontWeight: 700 }}>
                      {money(row.valueCents, lang)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openSet(row.set.id)}
                  className="font-code"
                  style={{
                    background: 'none',
                    border: '1px solid var(--rule)',
                    padding: '9px 12px',
                    cursor: 'pointer',
                    color: 'var(--ac)',
                    textAlign: 'center'
                  }}
                >
                  <span style={{ fontSize: 9.5, letterSpacing: '.14em', whiteSpace: 'nowrap' }}>
                    {strings.seeCards}
                  </span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.18em' }}>
                  {strings.boostersIn}
                </span>
                {row.packs.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', minHeight: 180 }}>
                    <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.06em' }}>
                      {strings.noPacks}
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'stretch',
                      gap: 18,
                      flexWrap: 'wrap',
                      minHeight: 210
                    }}
                  >
                    {row.packs.map((pack) => (
                      <PackSlot
                        key={pack.id}
                        artworkPath={pack.artworkPath}
                        name={pack.name}
                        placeholder={strings.packPlaceholder}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

/**
 * Logo del set.
 *
 * Va en su propio componente porque necesita un hook y no se puede llamar a uno
 * dentro de un map: el orden cambiaría al variar la lista.
 *
 * El logo vive en TCGdex bajo "{idioma}/{ruta}.webp", sin segmento de calidad
 * (a diferencia de las cartas), y no está en todos los idiomas. El proceso main
 * cae al inglés si el pedido no lo tiene: el Set Base sólo existe en inglés.
 */
function SetLogo({
  logoPath,
  name,
  lang,
  placeholder
}: {
  logoPath: string | null
  name: string
  lang: UiLang
  placeholder: string
}): React.JSX.Element {
  const logo = useAssetImage('setAsset', logoPath, { lang })
  return (
    <ImageSlot
      src={logo.data}
      placeholder={placeholder}
      title={name}
      style={{ width: '100%', height: 104 }}
    />
  )
}

/**
 * Sobre o producto.
 *
 * Ninguna API pública publica arte de sobres, así que la imagen sale del
 * catálogo del repositorio. Mientras no la haya se dibuja el hueco con el
 * nombre del sobre, que ya dice bastante más que un genérico «Sobre».
 */
function PackSlot({
  artworkPath,
  name,
  placeholder
}: {
  artworkPath: string | null
  name: string
  placeholder: string
}): React.JSX.Element {
  const art = useAssetImage('packAsset', artworkPath)
  return (
    <ImageSlot
      src={art.data}
      placeholder={placeholder}
      title={name}
      style={{ width: 138, flex: '0 0 138px', minHeight: 180 }}
    />
  )
}
