import { useCallback, useRef, useState } from 'react'
import type { SortId, UiLang } from '@shared/types'
import { CardGrid } from '../components/card/CardGrid'
import { Button, EmptyState, Eyebrow } from '../components/ds'
import { call, useCatalogStatus } from '../lib/api'
import type { Strings } from '../i18n'
import { useStore } from '../state/store'

/**
 * Colección y Explorador comparten rejilla: sólo cambian el ámbito de la
 * consulta y los textos. El Explorador enseña el catálogo entero con las que
 * faltan en gris al 40%; la Colección, sólo lo que se tiene.
 */

interface Props {
  scope: 'collection' | 'explorer'
  strings: Strings
  lang: UiLang
}

const SORTS: { id: SortId; key: keyof Strings }[] = [
  { id: 'value', key: 'sortValue' },
  { id: 'delta', key: 'sortDelta' },
  { id: 'name', key: 'sortName' },
  { id: 'date', key: 'sortDate' }
]

export function GridView({ scope, strings, lang }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLElement>(null)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const setView = useStore((s) => s.setView)
  const catalog = useCatalogStatus()
  const [counts, setCounts] = useState({ total: 0, scopeTotal: 0, loading: true })

  // CardGrid avisa de cuántos resultados hay; la vista decide qué contar.
  const onEmpty = useCallback((info: { total: number; scopeTotal: number; loading: boolean }) => {
    setCounts(info)
  }, [])

  const meta =
    scope === 'collection'
      ? { eyebrow: strings.colEyebrow, title: strings.colTitle, sub: strings.colSub }
      : { eyebrow: strings.expEyebrow, title: strings.expTitle, sub: strings.expSub }

  const catalogEmpty = (catalog.data?.installed.cardCount ?? 0) === 0
  const syncing = catalog.data?.state === 'syncing' || catalog.data?.state === 'checking'
  const showEmpty = !counts.loading && counts.total === 0

  return (
    <main
      ref={scrollRef}
      style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          padding: '26px 26px 18px',
          borderBottom: '1px solid var(--rule)',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Eyebrow tone="brand">{meta.eyebrow}</Eyebrow>
          <h1 className="type-h3 text-ink" style={{ margin: 0 }}>
            {meta.title}
          </h1>
          <p
            className="type-body-sm text-soft"
            style={{ margin: 0, maxWidth: '56ch', textWrap: 'pretty' }}
          >
            {meta.sub}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="font-code text-faint" style={{ fontSize: 9.5, letterSpacing: '.16em' }}>
            {strings.sortBy}
          </span>
          <div style={{ display: 'flex', gap: 1, background: 'var(--rule)' }}>
            {SORTS.map((s) => {
              const active = filters.sort === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setFilters({ sort: s.id })}
                  className="font-code"
                  style={{
                    background: active ? 'var(--ac)' : 'var(--paper)',
                    color: active ? 'var(--on-brand)' : 'var(--soft)',
                    border: 0,
                    padding: '8px 12px',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: 10, letterSpacing: '.04em' }}>{strings[s.key]}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          padding: '11px 26px',
          borderBottom: '1px solid var(--rule)',
          background: 'var(--card)'
        }}
      >
        <span className="font-code text-soft tabular" style={{ fontSize: 10, letterSpacing: '.1em' }}>
          {counts.total} {strings.resultsOf} {counts.scopeTotal} {strings.results}
        </span>
        <span className="font-code text-faint" style={{ fontSize: 10, letterSpacing: '.1em' }}>
          {strings.flipHint}
        </span>
      </div>

      {showEmpty ? (
        catalogEmpty ? (
          <EmptyState
            eyebrow={meta.eyebrow}
            title={scope === 'collection' ? strings.emptyCollectionTitle : strings.emptyExplorerTitle}
            description={
              scope === 'collection' ? strings.emptyCollectionSub : strings.emptyExplorerSub
            }
            action={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  variant="brand"
                  size="sm"
                  disabled={syncing}
                  onClick={() => void call('catalog:sync', { force: false })}
                >
                  {syncing ? strings.catalogSyncing : strings.catalogSync}
                </Button>
                {scope === 'collection' ? (
                  <Button variant="ghost" size="sm" onClick={() => setView('scan')}>
                    {strings.navScan}
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : (
          <EmptyState
            eyebrow={meta.eyebrow}
            title={strings.emptyFiltered}
            description={strings.emptyFilteredSub}
          />
        )
      ) : null}

      {/*
       * La rejilla se queda montada aunque no haya resultados: es ella quien
       * informa de cuántos hay, y si se desmontara al quedar vacía dejaría de
       * hacerlo y el estado vacío no se iría nunca al cambiar los filtros.
       * Sin resultados ocupa cero, así que no estorba.
       */}
      <CardGrid
        scope={scope}
        scrollRef={scrollRef}
        lang={lang}
        strings={strings}
        onEmpty={onEmpty}
      />
    </main>
  )
}
