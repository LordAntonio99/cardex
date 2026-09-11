# Cardex

Gestor de colección de cartas Pokémon TCG para escritorio. Base de datos local, sin cuenta y
sin servidor: todo vive en tu equipo.

- **Colección** — lo que tienes, con su valor y su variación.
- **Explorador** — el catálogo entero; las que te faltan salen en gris.
- **Sets y sobres** — progreso por set y los sobres en los que puede salir cada carta.
- **Escáner** — escaneo por lotes con la webcam y confirmación en bloque.
- **Mercado** — valor de la colección, histórico y las que más se mueven.

## Estado

**Versión 0.1.1.** Instalador para Windows en
[Releases](https://github.com/LordAntonio99/cardex/releases).

Al abrirla por primera vez se descarga el catálogo publicado: de momento el **Set Base** (102
cartas, con la 1ª edición como impresión propia) y **Oscuridad Absoluta** (120 cartas), con sus
imágenes, sus sobres y precios de Cardmarket. Tu colección arranca vacía.

Lo que **todavía no** hace:

- El **reconocimiento automático de cartas** del escáner está simulado. La cámara, la cola y la
  confirmación son reales: «Simular detección» mete una carta del catálogo en el lote para que
  puedas recorrer el flujo entero. El reconocimiento de verdad (hash perceptual contra
  `cards.phash`, y OCR del número después) entra detrás de la misma interfaz.
- **Los precios no se refrescan solos.** Llegan con el catálogo, así que se actualizan cuando se
  publica uno nuevo. El histórico de tu colección sí crece: cada sincronización anota el precio
  del día de lo que tienes.
- **Sólo se compila para Windows.** El código no asume Windows más allá de la barra de título,
  pero macOS y Linux no se han probado.
- El instalador va **sin firmar**: Windows SmartScreen avisará la primera vez. Hay que darle a
  «Más información» → «Ejecutar de todas formas».

## Requisitos

Node 22 o superior.

## Desarrollo

```bash
npm install
npm run dev
```

Atajos: `Ctrl+1` a `Ctrl+5` cambian de vista.

El catálogo se descarga solo al arrancar, así que en desarrollo ya tienes cartas con las que
trabajar. Para meter algunas en tu colección: Escáner → «Simular detección» → «Confirmar lote».

### Probar un catálogo antes de publicarlo

```bash
npm run catalog:build -- --sets me05   # genera ./catalog
npm run catalog:serve                  # lo sirve en http://localhost:8787
```

Y en otra terminal, la aplicación apuntando ahí en vez de a GitHub:

```bash
CARDEX_CATALOG_BASE=http://localhost:8787 npm run dev
```

En PowerShell: `$env:CARDEX_CATALOG_BASE="http://localhost:8787"; npm run dev`

La variable sólo se atiende en desarrollo.

### Comprobaciones

```bash
npm run typecheck     # main + preload + renderer
npm run build:win     # instalador NSIS en release/<versión>
```

## Dónde están los datos

`%APPDATA%/Cardex/`:

```
data/collection.db    TU COLECCIÓN. Lo único irreemplazable: respalda este fichero.
data/catalogue.db     catálogo descargado. Se puede borrar y volver a sincronizar.
images/               caché de imágenes de carta
logs/main.log         registro
settings.json         idioma, tema, efecto 3D y tamaño de la ventana
```

Son **dos ficheros de base de datos a propósito**. SQLite no admite claves foráneas entre bases
adjuntas, y esa limitación es justo la garantía que se busca: por construcción, una
reimportación de catálogo no puede tocar tu colección.

> Si tu `%APPDATA%` está redirigido a OneDrive o similar, la aplicación lo avisa en el log.
> SQLite y las carpetas sincronizadas se llevan mal y hay riesgo real de corrupción.

## Arquitectura

```
src/
├── shared/      modelo de dominio y contrato IPC (el único punto de contacto)
├── preload/     puente con lista blanca de canales
├── main/        ventana, base de datos, catálogo, escáner, autoactualización
└── renderer/    React: vistas, design system y la carta holográfica
```

El renderer no habla nunca con SQLite ni con la red: todo pasa por
`src/shared/ipc-contract.ts`, que es una lista cerrada de operaciones con tipos. No se expone
SQL libre.

### El visor de carta

La rejilla enseña las cartas planas. Pulsando la miniatura de la ficha se abre el visor a media
pantalla, que se gira arrastrando: el giro horizontal no tiene tope, así que pasando de 90°
aparece el reverso.

Es la pieza delicada del CSS. Antes de tocar `src/renderer/src/styles/card.css`, léete su
cabecera: cualquier «propiedad de agrupación» (`opacity`, `filter`, `mix-blend-mode`,
`isolation`, `mask`, `clip-path`, `content-visibility`) fuerza `transform-style: flat`. Si
alguna cae sobre el nodo con `preserve-3d`, el giro colapsa a 2D sin ningún error en consola.
Por eso qué cara se ve se decide además en JavaScript, a partir del ángulo.

El **efecto holográfico** está retirado: a tamaño de rejilla ensuciaba la ilustración en vez de
realzarla. El CSS se conserva entero y documentado, marcado como en barbecho, para recuperarlo
cuando se afine.

## Catálogo

Los datos de sets y cartas se publican aparte de la aplicación, en la rama `catalog` de este
repositorio, para poder añadir sets nuevos sin sacar versión. El formato y cómo generarlo están
en [docs/CATALOG.md](docs/CATALOG.md).

Fuente: [TCGdex](https://tcgdex.dev) (MIT), que trae los nombres en español de forma nativa.

Lo único que no sale de ninguna API es el **arte de los sobres**. Se mantiene a mano en
`catalog-packs/`: las definiciones por set en `catalog-packs/<setId>.json` y las imágenes en
`catalog-packs/images/`, que el generador copia al catálogo publicado. Mientras un sobre no
tenga imagen, la vista de Sets dibuja el hueco con su nombre.

Las imágenes de carta **no se empaquetan** en el instalador: son propiedad de sus titulares. Se
descargan a tu equipo cuando hacen falta, y se pueden desactivar en los ajustes.

## Publicar una versión

```bash
npm version patch      # o minor / major
git push --follow-tags
```

El tag `v*` dispara `.github/workflows/release.yml`, que compila en Windows y sube el
instalador junto al `latest.yml` que necesita el autoactualizador.

**No borres releases antiguas**: las actualizaciones diferenciales resuelven el `.blockmap` de
la versión anterior desde su propia release.

### Sobre la firma

Los instaladores van sin firmar. `electron-updater` sigue funcionando (sólo verifica la firma
si el `app-update.yml` empaquetado trae `publisherName`, y una compilación sin firmar no lo
trae), pero SmartScreen mostrará un aviso la primera vez.

Cuando interese quitarlo, **Azure Artifact Signing** está abierto a autónomos de la UE por unos
10 €/mes y da reputación en SmartScreen desde el primer día, sin el ritual de acumular
descargas. Pasar de sin firma a con firma es seguro; **al revés rompe el autoactualizador** de
quien ya la tenga instalada.

## Créditos

Interfaz diseñada en Claude Design. Datos de [TCGdex](https://tcgdex.dev).

Pokémon y las cartas del JCC Pokémon son propiedad de The Pokémon Company, Nintendo, Creatures
y GAME FREAK. Este proyecto no está afiliado ni respaldado por ninguna de ellas.
