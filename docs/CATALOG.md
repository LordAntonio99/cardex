# El catálogo de Cardex

Cardex tiene **dos canales de actualización independientes**:

| Canal | Qué trae | Cómo llega |
|---|---|---|
| **Aplicación** | el binario, el código, el esquema de la base | `electron-updater` desde las releases de GitHub |
| **Catálogo** | sets, cartas y sobres | un manifiesto versionado en la rama `catalog` de este repositorio |

Están separados a propósito: añadir un set nuevo no debería obligar a sacar una versión de la
aplicación, ni a que nadie se la actualice.

---

## Dónde vive

Rama **`catalog`** del repositorio `LordAntonio99/cardex`:

```
catalog/
├── manifest.json          índice: versión del catálogo y hash de cada fichero
├── sets/
│   ├── sv03.json          un fichero por set: set + cartas + sobres
│   └── base1.json
└── packs/
    └── sv03.json          arte de sobres, a mano (ver más abajo)
```

La aplicación lo lee de
`https://raw.githubusercontent.com/LordAntonio99/cardex/catalog/catalog/manifest.json`.

## Cómo lo consume la aplicación

1. Descarga `manifest.json` al arrancar y una vez al día.
2. Compara el `sha256` de cada set con el que ya tiene importado.
3. Se baja **sólo los ficheros que han cambiado**, comprueba el hash e importa cada uno dentro
   de su propia transacción.
4. Si un set viene roto, se salta ese y sigue con los demás. Como no registra su hash, lo
   reintentará la próxima vez.
5. Reconstruye el índice de búsqueda una sola vez al final.

Sin conexión, o sin catálogo publicado, la aplicación funciona con lo que ya tenga en local y
lo dice en la interfaz. No se rompe.

**Los datos del usuario no se tocan nunca.** El catálogo vive en `catalogue.db` y la colección
en `collection.db`. Son dos ficheros distintos, y SQLite no admite claves foráneas entre bases
adjuntas: por construcción, un borrado en el catálogo no puede alcanzar tu colección.

---

## Generarlo

```bash
# Un set
npm run catalog:build -- --sets sv03

# Varios
npm run catalog:build -- --sets sv03,sv01,base1

# Una serie entera
npm run catalog:build -- --series sv

# Muestra pequeña, para probar
npm run catalog:sample
```

El script saca los datos de [TCGdex](https://tcgdex.dev), que es abierto (MIT), sigue vivo y
trae los nombres en español de forma nativa.

Opciones: `--langs es,en` (el primero aporta la ficha completa), `--limit N`, `--out dir`,
`--concurrency N`.

### Publicarlo

```bash
npm run catalog:build -- --series sv
git checkout catalog
git add catalog
git commit -m "catálogo: serie Escarlata y Púrpura"
git push origin catalog
```

La próxima vez que alguien abra Cardex, se lo baja.

### Probarlo antes de publicar

```bash
npm run catalog:sample      # genera ./catalog
npm run catalog:serve       # lo sirve en http://localhost:8787
```

Y en otra terminal, la aplicación apuntando ahí:

```bash
CARDEX_CATALOG_BASE=http://localhost:8787 npm run dev
```

En PowerShell: `$env:CARDEX_CATALOG_BASE="http://localhost:8787"; npm run dev`

La variable **sólo se atiende en desarrollo**. En una instalación empaquetada el origen del
catálogo no es negociable desde el entorno.

---

## Formato

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "catalogVersion": "2026.09.11",
  "generatedAt": "2026-09-11T11:48:40.698Z",
  "sets": [
    {
      "id": "sv03",
      "file": "sets/sv03.json",
      "sha256": "84c2d69c59...",
      "cardCount": 230
    }
  ]
}
```

Si `schemaVersion` es mayor que el que entiende la aplicación instalada, ésta se planta y pide
que la actualices, en vez de importar a medias algo que no comprende.

### `sets/<setId>.json`

```json
{
  "set": {
    "id": "sv03",
    "seriesId": "sv",
    "seriesName": "Escarlata y Púrpura",
    "region": "intl",
    "code": "OBF",
    "name": "Obsidian Flames",
    "names": { "es": "Llamas Obsidianas", "en": "Obsidian Flames" },
    "releasedOn": "2023-08-11",
    "totalOfficial": 197,
    "totalAll": 230,
    "logoPath": "sv/sv03/logo",
    "symbolPath": "sv/sv03/symbol",
    "sortKey": 20230811
  },
  "cards": [
    {
      "id": "sv03-015",
      "localId": "015",
      "name": "Decidueye ex",
      "names": { "es": "Decidueye ex", "en": "Decidueye ex" },
      "rarity": "Rara Doble",
      "category": "Pokemon",
      "types": ["Grass"],
      "hp": 320,
      "illustrator": "PLANETA Mochizuki",
      "imagePath": "sv/sv03/015",
      "variants": ["holo"],
      "langs": ["es", "en"],
      "packs": ["sv03-booster"]
    }
  ],
  "packs": []
}
```

Detalles que importan:

- **`totalOfficial` frente a `totalAll`.** El porcentaje de completado se calcula contra
  `totalOfficial` (las cartas numeradas). Si se usara el total con secretas, un set nunca
  llegaría al 100 % y el indicador mentiría.
- **`types` va SIEMPRE en inglés canónico** (`Grass`, `Fire`, `Lightning`…). Es la clave de la
  tabla de colores `oklch` con la que se pinta cada carta: si se colara `Planta`, el degradado
  se iría al color por defecto. El generador los toma de la versión inglesa por este motivo.
- **`rarity` va en el idioma principal** (español por defecto). El clasificador de rareza de la
  interfaz entiende tanto `Rara Doble` como `Double Rare`, así que el efecto holográfico
  funciona igual. Ojo: los datos de TCGdex en español están incompletos y algunas rarezas
  llegan en inglés; no es un fallo del generador.
- **`imagePath` no lleva idioma ni extensión.** La aplicación compone la URL en tiempo de
  render: `https://assets.tcgdex.net/{idioma}/{imagePath}/{low|high}.webp`. Así la misma fila
  sirve para la carta en español, inglés y japonés.
- **`variants`** acepta `normal`, `holo`, `reverse` y `first_ed`. Se guardan como máscara de
  bits.
- **`packs`** en una carta es opcional. Sin él se entiende que puede salir en cualquier sobre
  de su set, que es el caso normal: sólo las cartas con distribución especial necesitan la
  relación explícita.

### Los sobres son cosa tuya

**Ninguna fuente pública tiene arte de sobres.** TCGdex no lo publica: su endpoint
`/boosters` devuelve 404 y el campo no aparece ni en cartas ni en sets. Comprobado, no
supuesto.

Por eso el generador respeta un fichero de superposición por set en `catalog/packs/<setId>.json`.
Lo que pongas ahí sobrevive a cada regeneración:

```json
[
  {
    "id": "sv03-booster",
    "name": "Sobre Llamas Obsidianas",
    "names": { "es": "Sobre Llamas Obsidianas", "en": "Obsidian Flames Booster" },
    "kind": "booster",
    "artworkPath": "packs/sv03-booster.webp"
  },
  {
    "id": "sv03-etb",
    "name": "Elite Trainer Box Llamas Obsidianas",
    "kind": "etb",
    "artworkPath": "packs/sv03-etb.webp"
  }
]
```

`kind` acepta `booster`, `etb`, `bundle`, `collection` y `other`.

Mientras `artworkPath` sea nulo, la vista «Sets y sobres» dibuja el hueco con su etiqueta, que
es exactamente lo que el diseño ya preveía.

---

## Imágenes y derechos

El catálogo publica **metadatos**, que es lo que cubre la licencia MIT de TCGdex.

Las **imágenes de carta no se publican ni se empaquetan nunca** en el instalador: son de The
Pokémon Company, Nintendo, Creatures y GAME FREAK. La aplicación guarda sólo la ruta y baja la
imagen desde `assets.tcgdex.net` a la máquina de cada usuario cuando hace falta, a
`%APPDATA%/Cardex/images`.

De este modo el instalable no contiene material ajeno, la caché es contenido que genera cada
usuario en su equipo, y cambiar de origen el día de mañana es una línea
(`ASSET_BASE` en `src/main/catalog/images.ts`).

El usuario puede desactivar la descarga de imágenes en los ajustes.
