-- ═══════════════════════════════════════════════════════════════════════════
-- Las etiquetas de una carta, y que se puedan buscar.
--
-- Riftbound NO pone el nombre del campeón en sus leyendas: la carta de Shen se
-- llama «Eye of Twilight» y nada más. El campeón vive en un campo de etiquetas,
-- igual que la facción o la criatura. Sin publicarlas, buscar «Shen» no
-- encuentra su propia leyenda, que es justo como busca cualquiera.
--
-- Las tiene el 70 % de las cartas de Riftbound. En Pokémon no hay equivalente,
-- así que ahí la columna se queda vacía.
-- ═══════════════════════════════════════════════════════════════════════════

-- Para enseñarlas en la ficha. JSON, como `types`.
ALTER TABLE cards ADD COLUMN tags TEXT;

-- Y para buscarlas. La tabla de contenido gana una columna más.
ALTER TABLE card_search_src ADD COLUMN tags TEXT NOT NULL DEFAULT '';

-- El índice se rehace entero: una tabla FTS5 de contenido externo no admite
-- columnas nuevas, y como es un índice derivado no se pierde nada al tirarlo.
-- La configuración es la misma de siempre y no se toca por capricho:
-- remove_diacritics 2 para que «pokemon» y «pokémon» sean la misma búsqueda, y
-- prefix '2 3' para que encuentre mientras se teclea.
DROP TABLE IF EXISTS cards_fts;

CREATE VIRTUAL TABLE cards_fts USING fts5(
  name,
  set_name,
  number,
  tags,
  content       = 'card_search_src',
  content_rowid = 'rowid_',
  tokenize      = "unicode61 remove_diacritics 2",
  prefix        = '2 3'
);

-- Se reconstruye aquí mismo. La sincronización también lo hace al terminar,
-- pero quien no vuelva a sincronizar en un tiempo se quedaría sin buscador.
INSERT INTO cards_fts(cards_fts) VALUES('rebuild');
