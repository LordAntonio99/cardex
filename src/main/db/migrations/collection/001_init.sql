-- ═══════════════════════════════════════════════════════════════════════════
-- collection.db — los datos del usuario. LO ÚNICO IRREEMPLAZABLE.
--
-- Esta base no se toca jamás al actualizar el catálogo. Vive en userData y es
-- la única que hay que respaldar. `card_id` apunta a catalogue.db a propósito
-- SIN clave foránea: SQLite no las admite entre bases adjuntas, y esa
-- limitación es la garantía estructural de que una reimportación de catálogo
-- no puede borrar nada de aquí.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
) WITHOUT ROWID, STRICT;

-- ── La unidad real de posesión ─────────────────────────────────────────────
-- Un coleccionista no tiene "un Charizard": tiene un Charizard reverse en
-- español. Carta + variante + idioma son mercados distintos con precios
-- distintos. Esta tabla sólo contiene combinaciones que el usuario posee o
-- vigila, así que es pequeña: cientos o miles de filas, no el producto
-- cartesiano del catálogo.

CREATE TABLE card_keys (
  id      INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL,               -- 'sv03-125' (referencia lógica a cat.cards)
  variant TEXT NOT NULL,               -- normal|holo|reverse|first_ed
  lang    TEXT NOT NULL,               -- es|en|ja
  -- Copia congelada del catálogo en el momento del alta. Si una reimportación
  -- cambia o retira el id, la carta sigue siendo legible en la interfaz en vez
  -- de convertirse en una fila fantasma.
  snap_name   TEXT NOT NULL,
  snap_set_id TEXT NOT NULL,
  snap_number TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (card_id, variant, lang)
) STRICT;

CREATE INDEX idx_card_keys_card ON card_keys(card_id);

-- ── Inventario ─────────────────────────────────────────────────────────────

CREATE TABLE collection_items (
  card_key_id   INTEGER NOT NULL REFERENCES card_keys(id),
  condition     TEXT NOT NULL DEFAULT 'NM',   -- NM|LP|MP|HP|DMG
  -- Nunca NULL dentro de una clave primaria: SQLite considera cada NULL
  -- distinto de los demás y colaría filas duplicadas.
  grader        TEXT NOT NULL DEFAULT '',     -- '' | PSA | CGC | BGS
  grade         REAL NOT NULL DEFAULT -1,     -- -1 = sin gradear
  -- Caché derivada de `movements`. Se mantiene con disparadores y se puede
  -- reconstruir entera.
  qty           INTEGER NOT NULL DEFAULT 0,
  qty_for_trade INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (card_key_id, condition, grader, grade)
) STRICT;

CREATE INDEX idx_items_owned ON collection_items(card_key_id) WHERE qty > 0;

-- ── Libro de movimientos: sólo se añade ────────────────────────────────────
-- Nunca UPDATE, nunca DELETE. Una corrección es una fila 'adjust'. El diseño
-- dice que el histórico no se borra nunca, y aquí eso es estructural.

CREATE TABLE movements (
  id          INTEGER PRIMARY KEY,
  card_key_id INTEGER NOT NULL REFERENCES card_keys(id),
  kind        TEXT NOT NULL,            -- buy|sell|pull|trade_in|trade_out|gift|loss|grade|adjust
  qty_delta   INTEGER NOT NULL,         -- con signo
  unit_cents  INTEGER,                  -- NULL en tiradas y regalos
  currency    TEXT NOT NULL DEFAULT 'EUR',
  fees_cents  INTEGER NOT NULL DEFAULT 0,
  condition   TEXT NOT NULL DEFAULT 'NM',
  grader      TEXT NOT NULL DEFAULT '',
  grade       REAL NOT NULL DEFAULT -1,
  source      TEXT,
  occurred_at INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  note        TEXT
) STRICT;

CREATE INDEX idx_mov_key_time ON movements(card_key_id, occurred_at);
CREATE INDEX idx_mov_time     ON movements(occurred_at);

-- Mantiene collection_items.qty al día sin que nadie tenga que acordarse.
CREATE TRIGGER trg_mov_apply AFTER INSERT ON movements
BEGIN
  INSERT INTO collection_items (card_key_id, condition, grader, grade, qty, updated_at)
  VALUES (NEW.card_key_id, NEW.condition, NEW.grader, NEW.grade, NEW.qty_delta, NEW.created_at)
  ON CONFLICT (card_key_id, condition, grader, grade) DO UPDATE SET
    qty        = qty + NEW.qty_delta,
    updated_at = NEW.created_at;
END;

-- ── Precios ────────────────────────────────────────────────────────────────
-- La única tabla que puede crecer de verdad. Sólo se guardan precios de claves
-- que el usuario posee o vigila; con 5.000 claves son ~1,8 M filas al año,
-- unos 60 MB. WITHOUT ROWID + enteros mantienen la fila en ~35 bytes.

CREATE TABLE price_points (
  card_key_id INTEGER NOT NULL REFERENCES card_keys(id),
  source      INTEGER NOT NULL,         -- 0 = cardmarket, 1 = tcgplayer
  day         INTEGER NOT NULL,         -- días desde epoch
  low_cents   INTEGER,
  trend_cents INTEGER NOT NULL,         -- la serie que se dibuja
  avg7_cents  INTEGER,
  avg30_cents INTEGER,
  PRIMARY KEY (card_key_id, source, day)
) WITHOUT ROWID, STRICT;

CREATE TABLE portfolio_snapshots (
  day           INTEGER PRIMARY KEY,
  total_cents   INTEGER NOT NULL,
  cost_cents    INTEGER NOT NULL,
  item_count    INTEGER NOT NULL,
  distinct_keys INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'EUR'
) WITHOUT ROWID, STRICT;

-- Cardmarket cotiza en euros y TCGplayer en dólares: antes o después hay que
-- mezclarlos.
CREATE TABLE fx_rates (
  day   INTEGER NOT NULL,
  base  TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate  REAL NOT NULL,
  PRIMARY KEY (day, base, quote)
) WITHOUT ROWID, STRICT;

CREATE TABLE watchlist (
  card_key_id INTEGER PRIMARY KEY REFERENCES card_keys(id),
  added_at    INTEGER NOT NULL
) WITHOUT ROWID, STRICT;

-- ── Huérfanos ──────────────────────────────────────────────────────────────
-- Los identificadores de carta del origen cambian de vez en cuando. Cuando
-- tras una reimportación una clave del usuario ya no encuentra su carta, se
-- registra aquí y se avisa en la interfaz. Nunca se descarta en silencio.

CREATE TABLE orphan_keys (
  card_key_id INTEGER PRIMARY KEY REFERENCES card_keys(id),
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;

-- ── Escáner ────────────────────────────────────────────────────────────────

CREATE TABLE scan_batches (
  id           INTEGER PRIMARY KEY,
  started_at   INTEGER NOT NULL,
  committed_at INTEGER,
  status       TEXT NOT NULL DEFAULT 'open'   -- open|committed|discarded
) STRICT;

CREATE TABLE scan_detections (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES scan_batches(id) ON DELETE CASCADE,
  card_id     TEXT NOT NULL,
  variant     TEXT NOT NULL DEFAULT 'normal',
  lang        TEXT NOT NULL DEFAULT 'es',
  confidence  REAL NOT NULL DEFAULT 0,
  image_path  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|kept|dropped
  detected_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_detections_batch ON scan_detections(batch_id, status);

-- ── Caché de imágenes ──────────────────────────────────────────────────────
-- Las imágenes de carta no se empaquetan nunca en el instalador: son propiedad
-- de sus titulares. Se descargan bajo demanda a userData y se registran aquí
-- para poder purgarlas por antigüedad.

CREATE TABLE image_cache (
  path         TEXT PRIMARY KEY,
  bytes        INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
) WITHOUT ROWID, STRICT;
