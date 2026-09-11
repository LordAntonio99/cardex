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
      "packs": ["sv03-booster"],
      "printings": [
        {
          "id": "4ffrmhcfiaejakhepqdkx7o",
          "kind": "holo",
          "subtype": "unlimited",
          "stamp": [],
          "label": "Holo · Unlimited",
          "variant": "holo",
          "sortKey": 0,
          "prices": [
            {
              "source": "cardmarket",
              "currency": "EUR",
              "lowCents": 10200,
              "trendCents": 59115,
              "avg7Cents": 62329,
              "avg30Cents": 55696,
              "updatedAt": "2026-09-11T11:36:57.016Z"
            }
          ]
        }
      ]
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

### Impresiones: por qué `printings` importa

`variants` da el eje grueso (normal, holo, reverse, 1ª edición) y `printings` la realidad
completa. En las cartas antiguas la diferencia no es un matiz:

| Charizard, Set Base, nº 4 | Precio (Cardmarket) |
|---|---|
| Holo · Unlimited | 591 € |
| Holo · Shadowless | 3.567 € |
| **Holo · Shadowless · 1ª edición** | **3.567 €** |
| Holo · Copyright 1999-2000 | sin precio |

Cada impresión trae su `id` estable de TCGdex, su etiqueta, a qué eje grueso pertenece y sus
precios. La aplicación:

- valora lo que tienes con el precio de **tu** impresión, no con uno genérico;
- enseña como precio de referencia el de la impresión **corriente** (la primera con precio,
  sin sello y que no sea de 1ª edición). Poner el precio de 1ª edición en todas las cartas del
  Set Base daría una idea completamente falsa de lo que vale;
- saca la variación a siete días de comparar `trendCents` con `avg7Cents`, así que hay dato
  desde el primer día sin esperar a acumular histórico local.

Un aviso sobre los datos de origen: Cardmarket comparte identificador de producto entre
«shadowless» y «shadowless 1ª edición», así que en muchas cartas el precio de ambas sale
idéntico. Es una limitación de la fuente, no del catálogo.

### El idioma de la ficha se decide por set

El generador prefiere el español, pero **se queda con el primer idioma que tenga cartas de
verdad**. El Set Base nunca se imprimió en español: TCGdex tiene el set traducido
(«Edición Básica») pero con cero cartas, así que la ficha sale del inglés y queda anotado en
`set.sourceLang`.

`langs` dice en qué idiomas existe cada carta, y la aplicación pide la imagen en uno de ellos.
Sin eso, todo el Set Base se quedaría con el marcador de posición, porque
`assets.tcgdex.net/es/base/base1/...` devuelve 404.

### Los sobres son cosa tuya

**Ninguna fuente pública tiene arte de sobres.** TCGdex no lo publica: su endpoint
`/boosters` devuelve 404, el campo no aparece ni en cartas ni en sets, y tampoco hay nada en
su CDN. Comprobado, no supuesto.

Por eso los sobres se mantienen a mano, en `catalog-packs/` de la rama `main`:

```
catalog-packs/
├── base1.json            definición de los sobres del set
└── images/
    └── base1-booster-charizard.webp
```

Está fuera de `catalog/` a propósito: esa carpeta es salida generada y está en el
`.gitignore`, así que lo que pusieras dentro se perdería al regenerar. El generador lee las
definiciones de ahí y copia `catalog-packs/images/` a `catalog/packs/` de la salida.

Un fichero de set se ve así:

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

`artworkPath` admite dos formas:

**Una URL https completa** — se referencia donde ya esté alojada la imagen:

```json
"artworkPath": "https://archives.bulbagarden.net/media/upload/thumb/0/06/Base_Set_Booster_Charizard_Long.jpg/440px-Base_Set_Booster_Charizard_Long.jpg"
```

Es lo que usa el Set Base. [Bulbagarden Archives](https://archives.bulbagarden.net) tiene arte
de sobres de casi todos los sets y sirve miniaturas por su API de MediaWiki: pedir
`prop=imageinfo&iiurlwidth=440` devuelve un `thumburl` de 20-90 KB, que es de sobra para un
hueco de 138 px. Referenciar en vez de republicar mantiene el repositorio libre de material
ajeno, igual que con las ilustraciones de carta, y cada usuario se baja la imagen una sola vez
a su caché local.

Sólo se aceptan URL `https` y nunca hacia direcciones internas: el catálogo llega de la red y
se trata como dato.

**Una ruta dentro del catálogo** — si prefieres alojarlas tú:

```json
"artworkPath": "packs/base1-booster-charizard.webp"
```

Deja el fichero en `catalog-packs/images/` y el generador lo copia a `catalog/packs/`. Formato
recomendado `.webp` vertical, de 400-600 px de ancho; también valen `.png`, `.jpg`, `.gif` y
`.avif`.

Mientras `artworkPath` sea nulo, la vista «Sets y sobres» dibuja el hueco con el nombre del
sobre, que es exactamente lo que el diseño ya preveía.

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
