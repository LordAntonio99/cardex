---
name: anadir-set
description: Añadir o actualizar un set de cartas y el arte de sus sobres en el catálogo de Cardex, paso a paso y con las llamadas de API concretas - elegir el set en TCGdex (Pokémon) o en la galería de Riot (Riftbound), generar los ficheros, buscar el arte de los sobres, probarlo en local y publicarlo en la rama catalog. Úsala siempre que se hable de añadir sets, sobres, packs, cartas de Pokémon o de Riftbound, o de regenerar o publicar el catálogo.
---

# Añadir un set al catálogo

El catálogo se publica **aparte de la aplicación**, en la rama `catalog` de este mismo
repositorio, para poder añadir un set sin sacar versión. Aquí está el procedimiento; el
**formato** de los ficheros está en [docs/CATALOG.md](../../../docs/CATALOG.md) y no se repite.

**Hay dos juegos y no se añaden igual.** Todo lo que sigue es el procedimiento de **Pokémon**;
Riftbound tiene su propia sección al final, mucho más corta porque casi todo es automático.

De dónde sale cada cosa:

| Dato | Pokémon | Riftbound |
|---|---|---|
| Set, cartas, impresiones, rutas de imagen | API de TCGdex | galería oficial de Riot |
| Precios | Cardmarket, vía TCGdex | TCGplayer, vía TCGCSV, convertido a € (BCE) |
| **Arte de los sobres** | Bulbagarden Archives, **a mano** | productos sellados de TCGplayer, automático |
| Vectores del escáner | Se calculan en local (`--recognition`) | igual |

> **La regla que se rompe primero.** `manifest.json` se **reescribe entero** en cada
> generación, con los sets de *esa* ejecución y nada más. Generar sólo el set nuevo publica un
> manifiesto donde los demás no existen: quien ya los tenga los conserva (la sincronización
> sólo añade), pero **una instalación nueva se quedará sólo con el set nuevo**. Se regeneran
> **siempre todos los sets publicados a la vez, de los dos juegos**: una ejecución con `--sets`
> y sin `--riftbound` borra Riftbound del manifiesto, y al revés.
>
> **Salvo con `--keep`**, que conserva en el índice lo que ya estaba en `--out` y no se ha
> regenerado, comprobando que cada fichero sigue ahí y que su `sha256` cuadra. Es lo que hace
> práctico añadir un set cuando ya hay setenta: con `--keep` son minutos, sin él son horas. Si
> algo no cuadra, se planta y lo dice.

---

## Paso 1 — Elegir el set y comprobar que existe en español

Base: `https://api.tcgdex.net/v2/{lang}` — abierta, MIT, con los nombres en español nativos.

```bash
# Las series, de más antigua a más nueva (la última es la de ahora)
curl -s https://api.tcgdex.net/v2/es/series

# Los sets de una serie
curl -s https://api.tcgdex.net/v2/es/series/me

# La ficha de un set: aquí sí viene releaseDate y la lista de cartas
curl -s https://api.tcgdex.net/v2/es/sets/me05
```

**Un nombre traducido no significa que el set exista en español.** `GET /v2/es/sets/base1`
devuelve `name: "Edición Básica"` y `cards: []`: cero cartas. La prueba de verdad es
`cards.length`, no el nombre.

Los sets de una serie, con su fecha y cuántas cartas tienen de verdad en español:

```bash
curl -s https://api.tcgdex.net/v2/es/series/me | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',async()=>{
  for (const s of JSON.parse(d).sets) {
    const f = await (await fetch('https://api.tcgdex.net/v2/es/sets/'+s.id)).json()
    console.log(String(s.id).padEnd(7), String(f.releaseDate).padEnd(12),
                String(f.cards?.length).padStart(4)+' cartas  ', f.name)
  }
})"
```

Para saber si ha salido algo más nuevo, se sondea el identificador siguiente: un **404** en
`GET /v2/es/sets/me06` significa que todavía no está.

Si el set no tiene cartas en español, **se añade igual**: el generador se queda con el primer
idioma de `--langs` que devuelva cartas (`sourceLang`), así que `base1` entra en inglés y los
nombres en español que sí existan se aprovechan. No hay que hacer nada especial.

---

## Paso 2 — Generar los ficheros

Primero, qué hay publicado ahora mismo:

```bash
curl -s https://raw.githubusercontent.com/LordAntonio99/cardex/catalog/catalog/manifest.json \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d);
      console.log('v'+m.catalogVersion, '| sets:', m.sets.map(s=>s.id).join(','),
                  '| vectores:', m.recognition?.length ?? 0)})"
```

Y se genera esa lista **más** el set nuevo, con los sets de Riftbound que ya hubiera:

```bash
npm run catalog:build -- --sets base1,me05,me04 --riftbound ogn,sfd,unl,ven
```

Opciones (`--help` las lista todas): `--series me` para una serie entera, `--langs es,en`,
`--limit N` para probar, `--out dir`, `--concurrency N`, `--packs dir`.

Sale en `./catalog` (ignorado por git en `main`; su sitio es la rama `catalog`). El script
avisa por set de cuántas cartas ha traído y cuántos sobres ha encontrado.

**Contrasta el número de cartas con `cardCount.official` de la API.** Si no cuadra, algo se ha
caído en la descarga y conviene repetir antes que publicar un set incompleto.

---

## Paso 3 — El arte de los sobres

**Ninguna API pública lo publica.** Comprobado: TCGdex no tiene endpoint `/boosters` (404), el
campo no aparece ni en cartas ni en sets, y su CDN no sirve `booster.webp`, `pack.webp`,
`display.webp` ni `box.webp`. Es lo único del catálogo que se aporta a mano.

La fuente es **Bulbagarden Archives**, un MediaWiki:
`https://archives.bulbagarden.net/w/api.php`

### 3.1 Listar lo que hay, sin adivinar nombres

```bash
curl -s -A 'Cardex' 'https://archives.bulbagarden.net/w/api.php?action=query&format=json&list=allimages&aiprefix=ME4&ailimit=50&aiprop=url|size'
```

`aiprefix` es la llamada buena: devuelve **todos** los ficheros que empiezan por ese prefijo.
Para `ME4` salen los cuatro sobres, el bundle, los dos displays, la ETB, la Build & Battle, los
blísters y los portfolios de una sola vez.

Si el prefijo no es obvio, se busca en el espacio de nombres de ficheros:

```bash
curl -s -A 'Cardex' 'https://archives.bulbagarden.net/w/api.php?action=query&format=json&list=search&srnamespace=6&srsearch=Pitch%20Black%20booster'
```

Convenciones de nombre, que ahorran mucho tiempo:

| Época | Patrón | Ejemplos reales |
|---|---|---|
| Moderna | `<CÓDIGO> <Producto>.png` | `ME4 Booster Mega Greninja.png`, `ME4 Booster Bundle.png`, `ME4 Booster Display 36 Pack.png`, `ME4 Elite Trainer Box outer.png`, `ME4 Build Battle Box outer.png` |
| Antigua | `<Set> Booster <Mascota> <Variante>.jpg` | `Base Set Booster Charizard Long.jpg`, `Base Set Booster Box.jpg` |

El código del set en Bulbagarden **no es el `id` de TCGdex**: `me05` allí es `ME5`, `me04` es
`ME4`. Los sets antiguos llevan sufijos de tirada (`_Long`, `_Shadowless`, `_Unlimited`) y de
idioma (`_ES`, `_DE`, `_FR`). El reverso de carta es `File:Cardback.jpg`.

### 3.2 Sacar la URL de la miniatura

```bash
curl -s -A 'Cardex' 'https://archives.bulbagarden.net/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=300&titles=File:ME4%20Booster%20Mega%20Greninja.png'
```

**Copia `thumburl` tal cual de la respuesta.** La ruta lleva un directorio de hash
(`/thumb/1/19/…`) que sale del MD5 del nombre y **no se puede componer a mano**: inventarlo
devuelve un 404 silencioso. Si la respuesta trae `"missing": ""`, el nombre está mal — vuelve
al `allimages` del paso anterior.

Tamaño de la miniatura, que importa porque estas imágenes se descargan en el equipo de cada
usuario:

- **JPEG** (sets antiguos): `iiurlwidth=440` → 20–92 KB. Bien.
- **PNG** (sets modernos): a 440 px pesa ~600 KB. **Usa `iiurlwidth=300`** (~320 KB).
- No todos los anchos existen: `220px` devuelve 404. Quédate en 300 o 440.
- Las miniaturas grandes se generan **bajo demanda** y la primera petición puede tardar más de
  40 s. Pídelas de una en una y con un timeout holgado (~90 s), no en paralelo.

Bulbagarden acepta el `User-Agent: Cardex` sin problema; mándalo.

### 3.3 Escribir `catalog-packs/<setId>.json`

Una lista de objetos. El fichero se llama como el `id` **de TCGdex** (`me04.json`):

```json
[
  {
    "id": "me04-booster-greninja",
    "name": "Rising Chaos Booster Pack (Mega Greninja)",
    "names": {
      "es": "Sobre Caos Creciente (Mega Greninja)",
      "en": "Rising Chaos Booster Pack (Mega Greninja)"
    },
    "kind": "booster",
    "artworkPath": "https://archives.bulbagarden.net/media/upload/thumb/1/19/ME4_Booster_Mega_Greninja.png/300px-ME4_Booster_Mega_Greninja.png"
  }
]
```

- `kind`: `booster` | `etb` | `bundle` | `collection` | `other`.
- `artworkPath`: una URL `https` absoluta, **o** una ruta `packs/<fichero>` si prefieres alojar
  la imagen tú (déjala en `catalog-packs/images/`, que el generador copia a `catalog/packs/`;
  ver [catalog-packs/images/LEEME.md](../../../catalog-packs/images/LEEME.md)).
- Se referencia por URL a propósito: el arte es de The Pokémon Company y no se redistribuye en
  el repositorio ni en el instalador, igual que las ilustraciones de carta.
- Mientras un sobre no tenga imagen, la vista de Sets dibuja el hueco con su nombre. No pasa
  nada por publicar el set primero y los sobres después.

Este fichero **manda y sobrevive a cada regeneración**, pero hay que regenerar para que entre:

```bash
npm run catalog:build -- --sets base1,me05,me04
```

---

## Paso 4 — Vectores del escáner (opcional)

Sin ellos el set se ve y se colecciona, pero el escáner no reconoce sus cartas.

```bash
npm run build          # pipeline.ts tiene que estar compilado
npm run models:fetch   # una sola vez por equipo
npm run catalog:build -- --sets base1,me05,me04 --recognition
```

Añade `catalog/recog/<setId>.<modelo>.bin` y el array `recognition` al manifiesto. Tarda:
descarga una imagen por carta y la pasa por el modelo. Detalles y la cuestión del identificador
de modelo, en [docs/CATALOG.md](../../../docs/CATALOG.md#datos-de-reconocimiento).

---

## Paso 5 — Probarlo antes de publicar

```bash
npm run catalog:serve          # sirve ./catalog en http://localhost:8787
```

Y en otra terminal, la aplicación apuntando ahí en vez de a GitHub:

```bash
CARDEX_CATALOG_BASE=http://localhost:8787 npm run dev
```

En PowerShell: `$env:CARDEX_CATALOG_BASE="http://localhost:8787"; npm run dev`

La variable **sólo se atiende en desarrollo**. Mira que el set aparezca en Sets con su logo,
que los sobres tengan arte y que el Explorador enseñe las cartas con sus precios.

---

## Paso 6 — Publicar

> **No uses `git checkout catalog` con el catálogo recién generado en el directorio.**
> `/catalog/` está en `.gitignore` en `main`, y git considera prescindibles los ficheros
> ignorados: el checkout los **sobrescribe sin avisar** con lo que ya estaba publicado. Se
> pierde la generación entera y el mensaje de git no dice nada. (Está comprobado.)

Se genera directamente dentro de un worktree de la rama `catalog`:

```bash
# Una sola vez por equipo
git worktree add ../cardex-catalog catalog

# Cada publicación, desde la raíz del proyecto
git -C ../cardex-catalog pull --ff-only
npm run catalog:build -- --out ../cardex-catalog/catalog --sets base1,me05,me04
git -C ../cardex-catalog add catalog
git -C ../cardex-catalog commit -m "Catálogo: Caos Creciente (me04), 122 cartas"
git -C ../cardex-catalog push origin catalog
```

El worktree deja el repositorio principal donde está: no cambia de rama ni toca nada tuyo, y
no hace falta copiar nada. `npm run` se ejecuta siempre desde la raíz del proyecto aunque lo
lances desde otro sitio, así que `--out` y `--packs` son relativos a la raíz, no a donde estés.

Antes del commit, `git -C ../cardex-catalog status` tiene que enseñar el set nuevo **y** el
`manifest.json` modificado, y ningún set anterior borrado.

---

## Paso 7 — Comprobar que ha llegado

```bash
curl -s https://raw.githubusercontent.com/LordAntonio99/cardex/catalog/catalog/manifest.json \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const m=JSON.parse(d);
      console.log('v'+m.catalogVersion);
      for (const s of m.sets) console.log(' ', s.id.padEnd(8), String(s.cardCount).padStart(4), 'cartas')})"
```

`raw.githubusercontent.com` cachea unos minutos. Luego, con la aplicación: Ajustes →
sincronizar catálogo, y el set aparece. No hay que sacar versión de la aplicación.

---

## Riftbound

Casi todo es automático. La abreviatura impresa del set es su identificador: `ogn` (Origins),
`sfd` (Spiritforged), `unl` (Unleashed), `ven` (Vendetta).

**Qué sets hay ahora mismo**, con sus cartas numeradas:

```bash
node -e "
const H='https://riftbound.leagueoflegends.com';
(async () => {
  const html = await (await fetch(H + '/en-us/card-gallery/')).text();
  const id = /\"buildId\":\"([^\"]+)\"/.exec(html)[1];
  const d = await (await fetch(H + '/_next/data/' + id + '/en-us/card-gallery.json')).json();
  const g = d.pageProps.page.blades.find(b => b.type === 'riftboundCardGallery');
  for (const s of g.sets.items) {
    const n = g.cards.items.filter(c => c.set.value.id === s.id).length;
    console.log(s.id.padEnd(5), String(s.collectorNumberMax).padStart(4), 'numeradas |',
                String(n).padStart(4), 'en total |', s.name);
  }
})()"
```

Y se genera como cualquier otro, junto con todos los sets de Pokémon publicados:

```bash
npm run catalog:build -- --sets base1,me05,me04 --riftbound ogn,sfd,unl,ven
```

Los pasos 4 a 7 (vectores, prueba local, publicación, comprobación) son **exactamente los
mismos**. El paso 3, el del arte de los sobres, **no hace falta**: el generador los saca de los
productos sellados de TCGplayer con su imagen. Si algún día quieres cambiarlos, un
`catalog-packs/rb-<set>.json` manda igual que en Pokémon.

Lo que conviene saber antes de tocar nada:

- **No hay API publicada.** La galería de Riot es una aplicación Next.js, y `scripts/riftbound.mjs`
  saca su `buildId` de la página para pedirle el JSON de datos. Cuando Riot despliega, el
  `buildId` cambia: por eso se lee en cada ejecución en vez de fijarlo. Si un día el generador
  dice *«No se ha encontrado el buildId»*, es que han cambiado cómo sirven la página y hay que
  revisar ese extractor.
- **El precio es TCGplayer convertido a euros** con el tipo del BCE del día, porque Cardmarket
  no abre su API. Queda anotado en cada precio (`sourceCurrency`, `fxRate`, `fxOn`) y la ficha
  de carta lo dice. **Regenerar cambia el tipo de cambio**, así que el `sha256` de todos los
  sets de Riftbound cambia aunque no se mueva ningún precio: es esperable.
- **Sólo existe en inglés.** No busques la versión en español: la galería en `es-es` devuelve
  exactamente lo mismo.
- **No hay logos de set.** Riot no los publica; la vista de Sets dibuja el hueco con el nombre.
- **Los tokens no tienen precio**: TCGplayer no los lista. Son nueve cartas en total y salen
  con «—».

---

## Trampas ya pisadas

- **Generar sólo el set nuevo.** El manifiesto se reescribe entero. Regenera siempre todos,
  **de los dos juegos**: `--sets` sin `--riftbound` borra Riftbound del índice.
- **`git checkout catalog`** borra el catálogo generado. Worktree.
- **Componer a mano la URL de la miniatura** de Bulbagarden. El directorio de hash no se
  adivina: copia `thumburl`.
- **Miniaturas PNG a 440 px**: ~600 KB por sobre, y los descarga cada usuario. 300 px.
- **Fiarse del nombre traducido del set** para dar por hecho que hay cartas en español.
  `cards.length` es lo único que vale.
- **Confundir el código de Bulbagarden con el id de TCGdex**: `me05` ↔ `ME5`.
- **Publicar sin contrastar** el número de cartas con `cardCount.official`.
