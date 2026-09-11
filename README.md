# Catálogo de Cardex

Esta rama **no contiene código**. Es el canal de contenido de
[Cardex](https://github.com/LordAntonio99/cardex/tree/main): sets, cartas y sobres.

Va aparte a propósito, para poder añadir un set nuevo sin sacar una versión de la aplicación
ni obligar a nadie a actualizarla. La app lee `catalog/manifest.json`, compara el `sha256` de
cada fichero con lo que ya tiene importado y se baja sólo lo que ha cambiado.

```
catalog/
├── manifest.json       índice: versión del catálogo y hash de cada fichero
├── sets/<setId>.json   set + cartas + impresiones + precios
└── packs/<setId>.json  arte de sobres, mantenido a mano
```

El formato está documentado en
[docs/CATALOG.md](https://github.com/LordAntonio99/cardex/blob/main/docs/CATALOG.md).

## Cómo se regenera

Desde la rama `main`:

```bash
npm run catalog:build -- --sets base1
```

Los datos salen de [TCGdex](https://tcgdex.dev) (MIT). Lo que hay en `catalog/packs/` se
mantiene a mano y sobrevive a cada regeneración: ninguna fuente pública publica arte de
sobres.

## Qué NO hay aquí

Imágenes de carta. Son propiedad de The Pokémon Company, Nintendo, Creatures y GAME FREAK.
Los ficheros guardan sólo la ruta, y cada usuario se las descarga a su propio equipo desde
`assets.tcgdex.net` cuando hacen falta.

Este proyecto no está afiliado ni respaldado por ninguna de esas empresas.
