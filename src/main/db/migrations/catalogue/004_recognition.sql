-- ═══════════════════════════════════════════════════════════════════════════
-- Vectores de reconocimiento para el escáner.
--
-- Una fila por (carta, idioma, modelo): la huella visual de 384 dimensiones que
-- publica el catálogo y contra la que se compara lo que ve la cámara.
--
-- Por idioma porque la misma carta impresa en español y en inglés son dos
-- imágenes distintas, y comparar contra las dos mejora el emparejamiento. Por
-- modelo porque unos vectores sólo son comparables con los que salieron del
-- MISMO modelo y el MISMO preproceso; al cambiarlos se publica otro
-- identificador y las instalaciones antiguas siguen usando los suyos.
--
-- SIN CLAVE FORÁNEA A `cards`, y esto es deliberado: el fichero de un set se
-- republica cada vez que cambian los precios, y al importarlo se borran y
-- reinsertan sus cartas. Una cascada desde ahí se llevaría por delante estos
-- vectores, y como el sha256 del fichero de vectores NO habría cambiado, nadie
-- los volvería a traer: el escáner se quedaría mudo tras la primera
-- sincronización. Las filas huérfanas (una carta que desaparece del catálogo)
-- se filtran al cargar, cruzando con `cards`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE card_recognition (
  set_id    TEXT NOT NULL,
  card_id   TEXT NOT NULL,
  lang      TEXT NOT NULL,
  model     TEXT NOT NULL,
  -- dims * 4 bytes, float32 little-endian, ya normalizado a longitud 1 para que
  -- el coseno sea un simple producto escalar.
  embedding BLOB NOT NULL,
  PRIMARY KEY (card_id, lang, model)
) WITHOUT ROWID, STRICT;

-- La importación y el borrado van siempre por set y modelo.
CREATE INDEX idx_recognition_set ON card_recognition(set_id, model);

-- Qué fichero de vectores se importó y con qué hash, igual que `catalog_sources`
-- hace con los sets. Permite reimportar sólo lo que cambie.
CREATE TABLE recognition_sources (
  set_id      TEXT NOT NULL,
  model       TEXT NOT NULL,
  file        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (set_id, model)
) WITHOUT ROWID, STRICT;
