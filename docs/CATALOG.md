# El catálogo de Cardex

Cardex tiene **dos canales de actualización independientes**:

| Canal | Qué trae | Cómo llega |
|---|---|---|
| **Aplicación** | el binario, el código, el esquema de la base | `electron-updater` desde las releases de GitHub |
| **Catálogo** | sets, cartas y sobres | un manifiesto versionado en la rama `catalog` de este repositorio |

Están separados a propósito: añadir un set nuevo no debería obligar a sacar una versión de la
aplicación, ni a que nadie se la actualice.

## Dos juegos

El catálogo cubre **Pokémon** y **Riftbound** (el JCC de League of Legends). Cada set declara a
cuál pertenece, y de ahí sale todo lo demás:

| | Pokémon | Riftbound |
|---|---|---|
| Cartas y metadatos | [TCGdex](https://tcgdex.dev) (MIT) | galería oficial de Riot |
| Ilustraciones | `assets.tcgdex.net` | CDN de Riot (`cmsassets.rgpub.io`) |
| Precios | Cardmarket, vía TCGdex | TCGplayer, vía [TCGCSV](https://tcgcsv.com) |
| Moneda | euros de origen | dólares convertidos con el tipo del BCE |
| Arte de sobres | a mano, en `catalog-packs/` | productos sellados de TCGplayer |
| Idiomas | español, inglés, japonés | sólo inglés |

Los identificadores de Riftbound van con el prefijo `rb-` (`rb-ogn`, `rb-ogn-056-298`). No es
cosmético: `card_keys.card_id` de la colección del usuario **no tiene clave foránea** al
catálogo —SQLite no las admite entre bases adjuntas, y esa limitación es justo la garantía de
que reimportar no puede tocar la colección—, así que nadie vigila que dos juegos no usen el
mismo identificador. El prefijo lo hace imposible.

> **Riftbound no se imprime en español.** La galería en `es-es` devuelve los mismos nombres, el
> mismo texto y las mismas imágenes que en `en-us`; sólo traduce las etiquetas de su propia
> interfaz. Sus cartas entran con `langs: ["en"]`, que es el caso que la aplicación ya trataba
> con el Set Base.

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

# Riftbound, por la abreviatura impresa
npm run catalog:build -- --riftbound ogn,sfd,unl,ven

# Los dos juegos de una vez, que es como hay que publicarlo
npm run catalog:build -- --sets sv03,base1 --riftbound ogn,sfd,unl,ven

# Muestra pequeña, para probar
npm run catalog:sample
```

El generador es **uno solo** aunque los orígenes sean varios, porque el manifiesto se reescribe
entero en cada ejecución: dos generadores publicarían dos índices donde el otro juego no
existe. `scripts/build-catalog.mjs` orquesta y escribe, y `scripts/riftbound.mjs` es el origen
de Riftbound.

### Añadir sets sin regenerarlo todo: `--keep`

Con setenta sets y sus vectores, regenerarlo todo para añadir uno son horas de descargas. Con
`--keep`, los sets que ya estaban en `--out` y no se han vuelto a generar **siguen en el
índice**:

```bash
npm run catalog:build -- --riftbound ogn,sfd,unl,ven --recognition --keep \
  --out ../cardex-catalog/catalog
```

La garantía que daba regenerarlo todo —que no desaparezca un set del índice sin que nadie se
entere— se mantiene por otra vía: en lugar de rehacer el fichero, se **comprueba** que sigue en
disco y que su `sha256` es el que declaraba el manifiesto. Si falta o no cuadra, el generador
**se planta** en vez de publicar un índice que apunta a un fichero que ya no es el que dice ser.

Los vectores se conservan también para un set que sí se ha regenerado, si esa ejecución no
llevaba `--recognition`: cambian a otro ritmo que los precios, y las cartas que ya no existan se
filtran al cargarlos.

Sin `--keep`, la regla de siempre: **se regeneran todos los sets publicados a la vez, de los dos
juegos**.

Opciones: `--langs es,en` (el primero aporta la ficha completa; sólo afecta a Pokémon),
`--limit N`, `--out dir`, `--concurrency N`.

### Publicarlo

El catálogo se genera **directamente dentro de un worktree** de la rama `catalog`:

```bash
# Una sola vez por equipo
git worktree add ../cardex-catalog catalog

# Cada publicación, desde la raíz del proyecto
git -C ../cardex-catalog pull --ff-only
npm run catalog:build -- --out ../cardex-catalog/catalog --series sv
git -C ../cardex-catalog add catalog
git -C ../cardex-catalog commit -m "Catálogo: serie Escarlata y Púrpura"
git -C ../cardex-catalog push origin catalog
```

> **No hagas `git checkout catalog` con el catálogo recién generado en el directorio.**
> `/catalog/` está ignorado en `main`, y git considera prescindibles los ficheros ignorados:
> el checkout los sobrescribe **sin avisar** con lo que ya estaba publicado, y te quedas sin
> la generación entera. El worktree además deja el repositorio principal donde está.

`npm run` se ejecuta desde la raíz del proyecto aunque lo lances desde otro directorio, así que
`--out` y `--packs` son relativos a la raíz, no a donde estés.

**El manifiesto se reescribe entero** con los sets de esa ejecución. Generar sólo el set nuevo
publica un índice donde los demás no existen: quien ya los tenga los conserva, pero una
instalación nueva se quedaría sólo con ese. Regenera siempre todos los sets publicados.

La próxima vez que alguien abra Cardex, se lo baja. El procedimiento completo, con las
llamadas de API para elegir el set y buscar el arte de los sobres, está en la skill
[`anadir-set`](../.claude/skills/anadir-set/SKILL.md).

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
  "schemaVersion": 2,
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

**Historial del formato:**

| Versión | Qué cambió |
|---|---|
| 1 | sólo Pokémon |
| 2 | el set declara su `game`; de ahí salen su origen de imágenes y su fuente de precios |

La v2 se subió con Riftbound en lugar de colar `game` como campo opcional dentro de la v1. Una
instalación anterior no conoce el campo, así que habría importado los sets de Riftbound como si
fueran de Pokémon: imágenes pedidas a TCGdex que devuelven 404, precios sin fuente y cartas
mezcladas en la rejilla. Es preferible que diga «actualiza la aplicación» y no toque nada.

### `sets/<setId>.json`

```json
{
  "set": {
    "id": "sv03",
    "game": "pokemon",
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

- **`game`** acepta `pokemon` y `riftbound`. Ausente equivale a `pokemon`, así que los ficheros
  de Pokémon anteriores no hay que regenerarlos por esto.
- **`totalOfficial` frente a `totalAll`.** El porcentaje de completado se calcula contra
  `totalOfficial` (las cartas numeradas). Si se usara el total con secretas, un set nunca
  llegaría al 100 % y el indicador mentiría. En Riftbound, `totalOfficial` es el
  `collectorNumberMax` de la galería y `totalAll` el recuento con las *showcase*, que van por
  encima de ese número igual que las secretas de Pokémon.
- **`types` va SIEMPRE en inglés canónico** (`Grass`, `Fire`, `Lightning`… y en Riftbound
  `Fury`, `Calm`, `Mind`, `Body`, `Chaos`, `Order`, `Colorless`). Es la clave de la tabla de
  colores `oklch` con la que se pinta cada carta: si se colara `Planta` o `Calma`, el degradado
  se iría al color por defecto **sin dar ningún error**. Los dos generadores los toman de la
  versión inglesa por este motivo.
- **`stats`** son las cifras impresas que no son el PV: `energy`, `might` y `power` en
  Riftbound. Van como mapa, y no como columnas, para que el tercer juego no obligue a otra
  migración. Sólo se guardan las que la carta trae de verdad; un cero es un valor legítimo.
- **`category`** es `Pokemon | Trainer | Energy` en Pokémon y
  `Unit | Spell | Legend | Battlefield | Gear | Rune` en Riftbound. El visor la usa para elegir
  el reverso: en Riftbound no todas las cartas comparten el mismo.
- **`rarity` va en el idioma principal** (español por defecto). El clasificador de rareza de la
  interfaz entiende tanto `Rara Doble` como `Double Rare`, así que el efecto holográfico
  funciona igual. Ojo: los datos de TCGdex en español están incompletos y algunas rarezas
  llegan en inglés; no es un fallo del generador.
- **`imagePath` no es una URL.** La aplicación la compone en tiempo de render, y cómo la compone
  depende del juego (`SOURCES`, en `src/main/catalog/images.ts`):

  | Juego | `imagePath` | URL resultante |
  |---|---|---|
  | Pokémon | `sv/sv03/125` | `assets.tcgdex.net/{idioma}/{imagePath}/{low\|high}.webp` |
  | Riftbound | `a3ddb0…-744x1039.png` | `cmsassets.rgpub.io/…/{imagePath}?w={300\|744}&fm=webp` |

  Así la misma fila de Pokémon sirve para la carta en español, inglés y japonés, y la de
  Riftbound para la miniatura de la rejilla y la del visor.
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

### El precio no siempre viene de Cardmarket

Cardmarket cotiza el mercado europeo, en euros, y es la fuente preferida. Pero **Riftbound no
está en ninguna API pública de Cardmarket**, así que sus precios salen de TCGplayer a través de
[TCGCSV](https://tcgcsv.com), que es un espejo diario sin clave ni registro.

Eso obliga a dos cosas:

1. **Convertir la moneda.** TCGplayer cotiza en dólares y Cardex lleva los euros por dentro —el
   dinero viaja en céntimos enteros de euro desde la base hasta la interfaz—. El generador
   aplica el tipo de cambio de referencia del BCE del día, **uno solo para toda la ejecución**:
   mezclar tipos daría cifras que no cuadran entre sí sin que nadie pueda saber por qué. La
   conversión queda anotada en cada precio publicado para poder auditarla:

   ```json
   {
     "source": "tcgplayer",
     "currency": "EUR",
     "trendCents": 1834,
     "sourceCurrency": "USD",
     "fxRate": 0.862664,
     "fxOn": "2026-09-11"
   }
   ```

   Esos tres últimos campos **no se importan**: son para quien lea el catálogo publicado. La
   ficha de carta sí dice de dónde sale el precio, para que nadie compare la cifra con
   Cardmarket y piense que la aplicación se equivoca.

2. **Elegir fuente al consultar.** Las vistas `card_default_price` y `card_variant_price`
   (migración `006_price_source.sql`) toman la fuente de menor identificador de las que haya
   para esa impresión: Cardmarket si existe, TCGplayer si no. Antes filtraban `source = 0` a
   secas, que para Pokémon vale y para Riftbound habría dejado todas las cartas sin precio.

**Riftbound no tiene variación a siete días.** TCGplayer publica precio de mercado pero no media
semanal, así que `avg7Cents` va nulo y esas cartas salen con «—» y no entran en «las que más se
mueven». Rellenarlo con el precio de hoy daría un 0,0 % permanente con toda la pinta de ser un
dato.

### El idioma de la ficha se decide por set

El generador prefiere el español, pero **se queda con el primer idioma que tenga cartas de
verdad**. El Set Base nunca se imprimió en español: TCGdex tiene el set traducido
(«Edición Básica») pero con cero cartas, así que la ficha sale del inglés y queda anotado en
`set.sourceLang`.

`langs` dice en qué idiomas existe cada carta, y la aplicación pide la imagen en uno de ellos.
Sin eso, todo el Set Base se quedaría con el marcador de posición, porque
`assets.tcgdex.net/es/base/base1/...` devuelve 404.

### Los sobres son cosa tuya (en Pokémon)

**Ninguna fuente pública tiene arte de sobres de Pokémon.** TCGdex no lo publica: su endpoint
`/boosters` devuelve 404, el campo no aparece ni en cartas ni en sets, y tampoco hay nada en
su CDN. Comprobado, no supuesto.

> En Riftbound sí lo hay: TCGplayer lista los productos sellados de cada set —sobres,
> displays, mazos de campeón, bundles— con su imagen, y el generador los convierte en sobres
> automáticamente, referenciando `tcgplayer-cdn.tcgplayer.com/product/<id>_400w.jpg`. No hay
> nada que mantener a mano, pero si pones un `catalog-packs/rb-<set>.json`, ése manda.

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

## Datos de reconocimiento

El escáner compara lo que ve la cámara con una **huella visual** de cada carta: 384 números que
salen de pasar la imagen de referencia por un modelo de visión. Esas huellas se calculan al
generar el catálogo y viajan con él.

```bash
npm run build            # el generador usa el MISMO código que el escáner
npm run models:fetch     # y el mismo modelo
node scripts/build-catalog.mjs --sets base1,me05 --recognition
```

Salen a `catalog/recog/<setId>.<modelo>.bin` y se listan en el manifiesto:

```json
"recognition": [
  {
    "id": "me05",
    "file": "recog/me05.dinov2s-u8-224-cls-v1.bin",
    "sha256": "fc6e9287…",
    "model": "dinov2s-u8-224-cls-v1",
    "dims": 384,
    "dtype": "f32",
    "count": 239
  }
]
```

**En ficheros aparte y no dentro del JSON del set**, porque cambian a ritmos distintos: el JSON
se republica cada vez que se mueven los precios, y las huellas sólo cuando cambian las cartas o
el modelo. Juntos, un cambio de céntimos obligaría a recalcular lo caro y a que todo el mundo
se lo bajara otra vez.

**Una huella por carta y por idioma.** La misma carta impresa en español y en inglés son dos
imágenes distintas, y comparar con las dos mejora el acierto. Los sets anteriores a Blanco y
Negro no tienen imágenes en español en TCGdex; ahí sólo se publica la inglesa, que es la misma
ilustración. Riftbound sólo se imprime en inglés: una huella por carta y ya está.

### Las cartas apaisadas se publican giradas

Los campos de batalla de Riftbound se imprimen en horizontal. El escáner **no puede
entregarlos así**: `orderCorners` normaliza cualquier cuadrilátero a vertical, de modo que la
captura de una carta apaisada siempre llega girada 90°, en un sentido o en el otro según por
dónde se haya dejado la carta sobre la mesa.

Por eso el generador gira la imagen de referencia a vertical antes de calcular su huella. Con
**una sola** basta: `matchCard` prueba la captura y su giro de 180°, y esas dos pruebas cubren
los dos sentidos posibles. Comprobado contra el propio pipeline: un campo de batalla puesto de
las dos maneras casa con su referencia a 0,90-0,95 de coseno.

Sin esto, la referencia sería la única imagen del catálogo que no se parece a lo que ve la
cámara, y fallaría **sin dar ningún error**.

### El identificador de modelo importa

`dinov2s-u8-224-cls-v1` nombra el modelo **y su preproceso**. Va escrito dentro del fichero y se
comprueba al importar: unas huellas calculadas con otro modelo, otro recorte u otro tamaño de
entrada no son comparables con las que saca la cámara, y el fallo sería **silencioso** —
reconocería peor, sin dar ningún error—. Por eso:

- la aplicación sólo importa las entradas cuyo `model` entiende, y si no hay ninguna lo dice
  («sin datos de reconocimiento») en vez de escanear a ciegas;
- el nombre del fichero lleva el modelo, así que pueden convivir dos en la rama `catalog`
  mientras se solapan versiones de la aplicación;
- cambiar el modelo, el tamaño de entrada o el recorte obliga a **subir el identificador**
  (`RECOG_MODEL_ID`, en `src/main/recognition/format.ts`) y a republicar.

No hace falta tocar `schemaVersion`: una aplicación anterior a esta función ignora la clave
`recognition` y sigue importando los sets con normalidad.

### Las imágenes siguen sin publicarse

Para calcular las huellas hay que descargar las imágenes, y eso se hace a `.cache/images/`, en
la máquina de quien genera el catálogo. Ahí se quedan. Lo que se publica es el vector, que es un
dato derivado del que no se puede reconstruir la ilustración.

---

## Imágenes y derechos

El catálogo publica **metadatos**, que es lo que cubre la licencia MIT de TCGdex.

Las **imágenes de carta no se publican ni se empaquetan nunca** en el instalador: son de The
Pokémon Company, Nintendo, Creatures y GAME FREAK las de Pokémon, y de Riot Games las de
Riftbound. La aplicación guarda sólo la ruta y baja la imagen del CDN que corresponda a la
máquina de cada usuario cuando hace falta, a `%APPDATA%/Cardex/images`.

De este modo el instalable no contiene material ajeno, la caché es contenido que genera cada
usuario en su equipo, y cambiar de origen el día de mañana es una entrada de la tabla `SOURCES`
en `src/main/catalog/images.ts`.

El usuario puede desactivar la descarga de imágenes en los ajustes.
