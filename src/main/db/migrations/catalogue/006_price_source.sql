-- ═══════════════════════════════════════════════════════════════════════════
-- El precio deja de venir siempre de Cardmarket.
--
-- Las dos vistas filtraban `source = 0` a secas, que es «Cardmarket o nada».
-- Para Pokémon vale: TCGdex publica Cardmarket en todas las cartas. Riftbound
-- no está en ninguna API pública de Cardmarket, así que con ese filtro todas
-- sus cartas saldrían sin precio.
--
-- Ahora se toma la fuente de MENOR identificador de las que haya para esa
-- impresión: 0 (Cardmarket) si existe y 1 (TCGplayer) si no. No es un empate a
-- suertes —Cardmarket cotiza el mercado europeo, que es el que le importa a
-- quien usa esto— sino una preferencia con respaldo.
--
-- `card_default_price` expone además `avg7_cents` y `source`. Lo primero
-- evita que `cards.ts` tenga que repetir este mismo JOIN para sacar la
-- variación a siete días; lo segundo permite decir en la ficha de dónde sale
-- el precio, que con dos fuentes deja de ser una obviedad.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS card_default_price;

CREATE VIEW card_default_price AS
SELECT p.card_id      AS card_id,
       pr.source      AS source,
       pr.trend_cents AS trend_cents,
       pr.avg7_cents  AS avg7_cents,
       pr.currency    AS currency
FROM card_printings p
JOIN printing_prices pr
  ON pr.card_id = p.card_id AND pr.printing_id = p.printing_id
WHERE p.is_default = 1
  AND pr.source = (
    SELECT MIN(x.source) FROM printing_prices x
    WHERE x.card_id = p.card_id AND x.printing_id = p.printing_id
  );

-- Precio por eje grueso, que es lo que se usa para valorar la colección:
-- `card_keys` guarda el eje (normal/holo/reverse/1ª), no la impresión exacta.
--
-- Se conserva la corrección de la migración 003: dentro de un eje se toma la
-- impresión de menor `sort_key` con precio, no el máximo. Con MAX, a quien
-- tuviera el Charizard holo corriente (591 €) se le valoraba con el shadowless
-- (3.567 €).
DROP VIEW IF EXISTS card_variant_price;

CREATE VIEW card_variant_price AS
SELECT p.card_id      AS card_id,
       p.variant      AS variant,
       pr.source      AS source,
       pr.trend_cents AS trend_cents,
       pr.currency    AS currency
FROM card_printings p
JOIN printing_prices pr
  ON pr.card_id = p.card_id AND pr.printing_id = p.printing_id
WHERE pr.source = (
    SELECT MIN(x.source) FROM printing_prices x
    WHERE x.card_id = p.card_id AND x.printing_id = p.printing_id
  )
  AND p.sort_key = (
    SELECT MIN(p2.sort_key)
    FROM card_printings p2
    JOIN printing_prices pr2
      ON pr2.card_id = p2.card_id AND pr2.printing_id = p2.printing_id
    WHERE p2.card_id = p.card_id AND p2.variant = p.variant
  );
