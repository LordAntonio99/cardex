import { useEffect } from 'react'
import { VIEWS, type ViewId } from '@shared/types'
import { DetailPanel } from './layout/DetailPanel'
import { Header } from './layout/Header'
import { Sidebar } from './layout/Sidebar'
import { GridView } from './views/GridView'
import { MarketView } from './views/MarketView'
import { ScannerView } from './views/ScannerView'
import { SetsView } from './views/SetsView'
import { t } from './i18n'
import {
  useCatalogStatus,
  useDbInvalidation,
  useFilterOptions,
  useIpcEvent,
  useSettings,
  useSystemInfo
} from './lib/api'
import { installCardPointer, setPointerPreset, setPointerReducedMotion } from './lib/cardPointer'
import { applyPreset } from './lib/holo'
import { useStore } from './state/store'

export function App(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const setPriceCeiling = useStore((s) => s.setPriceCeiling)

  const loadedSettings = useSettings()
  const system = useSystemInfo()
  const filterOptions = useFilterOptions()
  const catalog = useCatalogStatus()

  useDbInvalidation()

  // Los ajustes viven en el proceso main; el store del renderer es un espejo.
  useEffect(() => {
    if (loadedSettings.data) setSettings(loadedSettings.data)
  }, [loadedSettings.data, setSettings])

  useEffect(() => {
    if (system.data) setTheme(system.data.resolvedTheme)
  }, [system.data, setTheme])

  useEffect(() => {
    if (filterOptions.data) setPriceCeiling(filterOptions.data.maxCents)
  }, [filterOptions.data, setPriceCeiling])

  // El efecto 3D se escribe en :root, de donde lo leen las capas del foil.
  useEffect(() => {
    applyPreset(settings.effect3d)
    setPointerPreset(settings.effect3d)
  }, [settings.effect3d])

  useEffect(() => {
    setPointerReducedMotion(settings.reduceMotion)
  }, [settings.reduceMotion])

  // El seguimiento del puntero es un único listener para toda la aplicación.
  useEffect(() => installCardPointer(), [])

  // El bundle del design system usa [data-theme="light"]; el proceso main manda
  // el tema ya resuelto contra el del sistema.
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = settings.uiLang
  }, [settings.uiLang])

  useEffect(() => {
    if (system.data) document.body.classList.add(`platform-${system.data.platform}`)
  }, [system.data])

  useIpcEvent('theme:changed', setTheme)
  useIpcEvent('nav:go', ({ view: next }) => {
    if ((VIEWS as readonly string[]).includes(next)) setView(next as ViewId)
  })
  // La sincronización de catálogo empuja su progreso; se refleja al momento.
  useIpcEvent('catalog:progress', () => void catalog.refetch())

  const strings = t(settings.uiLang)
  const isGrid = view === 'collection' || view === 'explorer'

  return (
    <>
      <Header strings={strings} lang={settings.uiLang} />

      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, minHeight: 0, position: 'relative' }}>
        {isGrid ? <Sidebar strings={strings} lang={settings.uiLang} /> : null}

        {view === 'collection' ? (
          <GridView scope="collection" strings={strings} lang={settings.uiLang} />
        ) : null}
        {view === 'explorer' ? (
          <GridView scope="explorer" strings={strings} lang={settings.uiLang} />
        ) : null}
        {view === 'sets' ? <SetsView strings={strings} lang={settings.uiLang} /> : null}
        {view === 'scan' ? <ScannerView strings={strings} lang={settings.uiLang} /> : null}
        {view === 'market' ? <MarketView strings={strings} lang={settings.uiLang} /> : null}

        <DetailPanel strings={strings} lang={settings.uiLang} />
      </div>
    </>
  )
}
