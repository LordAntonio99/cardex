-- ═══════════════════════════════════════════════════════════════════════════
-- Impresiones concretas y sus precios.
--
-- La máscara `variant_mask` de `cards` dice qué ejes existen (normal, holo,
-- reverse, 1ª edición), pero se queda corta para las cartas antiguas: en el Set
-- Base, un Charizard holo unlimited vale unos 590 € y el mismo holo shadowless
-- de 1ª edición pasa de 3.500 €. Son impresiones distintas, con mercado propio.
--
-- TCGdex las publica en `variants_detailed`, cada una con su identificador
-- estable y su precio. Aquí se guardan enteras aunque la interfaz todavía sólo
-- exponga el eje grueso: así el día que se enseñen no hace falta volver a
-- descargar el catálogo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE card_printings (
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  printing_id TEXT NOT NULL,             -- variantId de TCGdex, estable
  -- Eje grueso al que pertenece: normal | holo | reverse | first_ed.
  -- Es lo que enlaza con `card_keys.variant` de la colección del usuario.
  variant     TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- normal | holo | reverse
  subtype     TEXT NOT NULL DEFAULT '',  -- unlimited | shadowless | ...
  stamp       TEXT NOT NULL DEFAULT '',  -- '1st-edition', 'poketour-99'...
  label       TEXT NOT NULL,             -- 'Holo · Shadowless · 1ª edición'
  -- La impresión que se usa como precio de referencia de la carta cuando el
  -- usuario no tiene ninguna copia. Se elige la corriente, no la cara: enseñar
  -- el precio de 1ª edición en todo el Set Base engañaría.
  is_default  INTEGER NOT NULL DEFAULT 0,
  sort_key    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, printing_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_printings_variant ON card_printings(card_id, variant);
CREATE INDEX idx_printings_default ON card_printings(card_id) WHERE is_default = 1;

CREATE TABLE printing_prices (
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  printing_id TEXT NOT NULL,
  source      INTEGER NOT NULL,          -- 0 = cardmarket, 1 = tcgplayer
  currency    TEXT NOT NULL DEFAULT 'EUR',
  low_cents   INTEGER,
  trend_cents INTEGER,
  avg7_cents  INTEGER,
  avg30_cents INTEGER,
  updated_at  TEXT,
  PRIMARY KEY (card_id, printing_id, source)
) WITHOUT ROWID, STRICT;

-- Precio de referencia por carta: el de su impresión corriente en Cardmarket.
CREATE VIEW card_default_price AS
SELECT p.card_id      AS card_id,
       pr.trend_cents AS trend_cents,
       pr.currency    AS currency
FROM card_printings p
JOIN printing_prices pr
  ON pr.card_id = p.card_id AND pr.printing_id = p.printing_id AND pr.source = 0
WHERE p.is_default = 1;

-- Precio por eje grueso: el más alto de las impresiones de ese eje. Es lo que
-- se usa para valorar lo que el usuario tiene, porque `card_keys` guarda el eje
-- grueso, no la impresión exacta.
CREATE VIEW card_variant_price AS
SELECT p.card_id            AS card_id,
       p.variant            AS variant,
       MAX(pr.trend_cents)  AS trend_cents,
       pr.currency          AS currency
FROM card_printings p
JOIN printing_prices pr
  ON pr.card_id = p.card_id AND pr.printing_id = p.printing_id AND pr.source = 0
GROUP BY p.card_id, p.variant;
