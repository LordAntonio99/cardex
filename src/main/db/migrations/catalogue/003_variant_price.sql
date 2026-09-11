-- ═══════════════════════════════════════════════════════════════════════════
-- Corrige el precio por eje de variante.
--
-- La versión anterior tomaba el MÁXIMO entre las impresiones de un mismo eje, y
-- eso infla las colecciones de forma grosera. En el Set Base, el eje `holo` de
-- Charizard agrupa la impresión unlimited (591 €) y la shadowless (3.567 €):
-- con MAX, a quien tuviera el holo corriente se le valoraba en 3.567 €.
--
-- Ahora se toma la impresión de menor `sort_key` con precio dentro de cada eje,
-- que es el orden en que TCGdex las publica y deja arriba la común. Para el eje
-- de 1ª edición sigue saliendo la de 1ª edición, porque es la única que hay.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS card_variant_price;

CREATE VIEW card_variant_price AS
SELECT p.card_id      AS card_id,
       p.variant      AS variant,
       pr.trend_cents AS trend_cents,
       pr.currency    AS currency
FROM card_printings p
JOIN printing_prices pr
  ON pr.card_id = p.card_id AND pr.printing_id = p.printing_id AND pr.source = 0
WHERE p.sort_key = (
  SELECT MIN(p2.sort_key)
  FROM card_printings p2
  JOIN printing_prices pr2
    ON pr2.card_id = p2.card_id AND pr2.printing_id = p2.printing_id AND pr2.source = 0
  WHERE p2.card_id = p.card_id AND p2.variant = p.variant
);
