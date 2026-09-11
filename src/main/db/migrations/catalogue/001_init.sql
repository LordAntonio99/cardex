-- ═══════════════════════════════════════════════════════════════════════════
-- catalogue.db — datos de referencia. REEMPLAZABLE POR COMPLETO.
--
-- Esta base se reconstruye desde el catálogo publicado en GitHub. No contiene
-- ni un solo dato del usuario, y por eso puede borrarse y regenerarse sin
-- consecuencias. Se adjunta desde collection.db como `cat`.
--
-- SQLite NO admite claves foráneas entre bases adjuntas, y eso es exactamente
-- la garantía que buscamos: ningún ON DELETE CASCADE de aquí puede alcanzar la
-- colección del usuario.
-- ═══════════════════════════════════════════════════════════════════════════

-- Metadatos del catálogo instalado: versión, origen, fecha de compilación.
CREATE TABLE cat_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID, STRICT;

-- Qué fichero del manifiesto se importó y con qué hash, para reimportar sólo
-- lo que ha cambiado.
CREATE TABLE catalog_sources (
  set_id      TEXT PRIMARY KEY,
  file        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  card_count  INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL
) WITHOUT ROWID, STRICT;

-- ── Series y sets ──────────────────────────────────────────────────────────

CREATE TABLE series (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'intl'   -- 'intl' | 'jp'
) STRICT;

CREATE TABLE sets (
  id             TEXT PRIMARY KEY,      -- 'sv03'
  series_id      TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  region         TEXT NOT NULL DEFAULT 'intl',
  code           TEXT,                  -- abreviatura impresa: OBF, BASE
  name           TEXT NOT NULL,
  released_on    TEXT,                  -- 'YYYY-MM-DD'
  -- Cartas numeradas frente al total con secretas. El porcentaje de completado
  -- del diseño se calcula contra total_official, no contra total_all.
  total_official INTEGER NOT NULL DEFAULT 0,
  total_all      INTEGER NOT NULL DEFAULT 0,
  logo_path      TEXT,                  -- ruta base de TCGdex, sin idioma ni extensión
  symbol_path    TEXT,
  -- Orden propio: el del origen no es fiable.
  sort_key       INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_sets_sort   ON sets(sort_key DESC, id);
CREATE INDEX idx_sets_series ON sets(series_id);

CREATE TABLE set_names (
  set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  lang   TEXT NOT NULL,                 -- 'es' | 'en' | 'ja'
  name   TEXT NOT NULL,
  PRIMARY KEY (set_id, lang)
) WITHOUT ROWID, STRICT;

-- ── Cartas ─────────────────────────────────────────────────────────────────

CREATE TABLE cards (
  id            TEXT PRIMARY KEY,       -- 'sv03-125'
  set_id        TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  local_id      TEXT NOT NULL,          -- número impreso: '136', 'TG05', 'SV107'
  -- El número se parte en dos porque ordenar '10' frente a '9' como texto da
  -- un resultado inservible, y hay sufijos alfabéticos de verdad.
  number_sort   INTEGER NOT NULL DEFAULT 0,
  number_suffix TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,          -- nombre canónico (en); las traducciones en card_names
  rarity        TEXT,
  category      TEXT,                   -- Pokemon | Trainer | Energy
  types         TEXT NOT NULL DEFAULT '[]',  -- JSON: ["Fire"]. Alimenta el degradado oklch.
  hp            INTEGER,
  illustrator   TEXT,
  image_path    TEXT,                   -- 'sv/sv03/125' -> la URL se compone en tiempo de render
  -- bit0 normal, bit1 holo, bit2 reverse, bit3 primera edición
  variant_mask  INTEGER NOT NULL DEFAULT 1,
  -- Hash perceptual de 8 bytes para el escáner. Se precalcula al construir el
  -- catálogo; nulo mientras no exista.
  phash         BLOB
) STRICT;

CREATE INDEX idx_cards_set_order ON cards(set_id, number_sort, number_suffix);
CREATE INDEX idx_cards_rarity    ON cards(rarity);
CREATE INDEX idx_cards_name      ON cards(name);

CREATE TABLE card_names (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  lang    TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (card_id, lang)
) WITHOUT ROWID, STRICT;

-- En qué idiomas existe realmente esta impresión. Sin esto, la interfaz
-- ofrecería idiomas que nunca se imprimieron.
CREATE TABLE card_langs (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  lang    TEXT NOT NULL,
  PRIMARY KEY (card_id, lang)
) WITHOUT ROWID, STRICT;

-- ── Sobres y productos ─────────────────────────────────────────────────────
-- Ninguna API pública trae el arte de los sobres: llega del catálogo que se
-- publica a mano en el repositorio. Por eso artwork_path admite NULL y la
-- interfaz dibuja un hueco con placeholder.

CREATE TABLE packs (
  id           TEXT PRIMARY KEY,
  set_id       TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'booster',  -- booster|etb|bundle|collection|other
  artwork_path TEXT,
  logo_path    TEXT,
  sort_key     INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_packs_set ON packs(set_id, sort_key);

CREATE TABLE pack_names (
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  lang    TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (pack_id, lang)
) WITHOUT ROWID, STRICT;

-- Sin filas para una carta => puede salir en cualquier sobre de su set.
CREATE TABLE card_packs (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, pack_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_card_packs_pack ON card_packs(pack_id);

-- Equivalencias JP <-> occidental. No es derivable de ninguna fuente: se cura
-- a mano en el catálogo publicado.
CREATE TABLE card_equivalents (
  card_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  other_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  confidence    INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (card_id, other_card_id)
) WITHOUT ROWID, STRICT;

-- ── Buscador ───────────────────────────────────────────────────────────────
-- Tabla de contenido externo: una fila por carta e idioma.

CREATE TABLE card_search_src (
  rowid_   INTEGER PRIMARY KEY,
  card_id  TEXT NOT NULL,
  lang     TEXT NOT NULL,
  name     TEXT NOT NULL,
  set_name TEXT NOT NULL,
  number   TEXT NOT NULL
) STRICT;

CREATE INDEX idx_search_src_card ON card_search_src(card_id);

-- remove_diacritics 2 (no 1: el modo 1 es el heredado y se deja fuera los
-- diacríticos en secuencias de varios puntos de código). Con el 2, pokemon y
-- pokémon son la misma búsqueda, que es lo que espera cualquiera escribiendo
-- en español. prefix '2 3' para buscar mientras se teclea.
CREATE VIRTUAL TABLE cards_fts USING fts5(
  name,
  set_name,
  number,
  content      = 'card_search_src',
  content_rowid = 'rowid_',
  tokenize     = "unicode61 remove_diacritics 2",
  prefix       = '2 3'
);

-- El japonés no separa palabras: unicode61 devolvería un único token gigante.
CREATE VIRTUAL TABLE cards_fts_cjk USING fts5(
  name,
  content       = 'card_search_src',
  content_rowid = 'rowid_',
  tokenize      = "trigram"
);
