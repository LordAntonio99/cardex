-- ═══════════════════════════════════════════════════════════════════════════
-- El catálogo deja de ser sólo de Pokémon.
--
-- El juego cuelga del SET y no de la carta: un set pertenece a un juego y no
-- hay caso intermedio. De ahí sale todo lo demás —de dónde se baja la imagen,
-- qué fuente cotiza la carta, qué reverso tiene—, así que una sola columna
-- gobierna el resto.
--
-- El valor por defecto es 'pokemon' a propósito: las filas que ya estuvieran
-- importadas son todas de Pokémon, y así una base existente queda correcta sin
-- necesidad de volver a sincronizar nada.
--
-- `collection.db` NO se toca. El juego de una carta del usuario se resuelve
-- cruzando por `cat.sets`, de modo que la base irreemplazable se queda igual
-- que estaba.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sets ADD COLUMN game TEXT NOT NULL DEFAULT 'pokemon';

-- La rejilla, los sets y la cartera filtran por juego y ordenan por fecha.
CREATE INDEX idx_sets_game ON sets(game, sort_key DESC);

-- ── Cifras impresas que no son el PV ───────────────────────────────────────
-- Riftbound imprime energía, poderío y poder donde Pokémon imprime PV. Van en
-- un JSON y no en tres columnas para que el tercer juego no obligue a otra
-- migración: son datos para enseñar, nunca para filtrar ni ordenar.

ALTER TABLE cards ADD COLUMN stats TEXT;
