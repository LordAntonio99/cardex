# Arte de sobres

Aquí van las imágenes de sobres y productos. Se copian tal cual a `catalog/packs/`
al generar el catálogo, y de ahí las sirve la aplicación.

Ninguna API pública publica arte de sobres: es lo único del catálogo que hay que
aportar a mano. TCGdex no lo tiene (su endpoint `/boosters` devuelve 404 y el campo
no aparece ni en cartas ni en sets), y tampoco está en su CDN.

## Cómo añadir uno

1. Deja el fichero aquí, por ejemplo `base1-booster-charizard.webp`.
2. Apunta a él desde `catalog-packs/<setId>.json`:

   ```json
   "artworkPath": "packs/base1-booster-charizard.webp"
   ```

   La ruta es relativa a la raíz del catálogo publicado.
3. Regenera y publica: `npm run catalog:build -- --sets base1`

Formato recomendado: `.webp`, vertical, ancho de 400-600 px. También se admiten
`.png`, `.jpg`, `.gif` y `.avif`.

## Sobre los derechos

El arte de los sobres es propiedad de The Pokémon Company, Nintendo, Creatures y
GAME FREAK, igual que las ilustraciones de las cartas. Por eso no se empaqueta
nada de esto en el instalador: la aplicación descarga las imágenes al equipo de
cada usuario cuando hacen falta.
