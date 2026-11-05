-- barcode must be unique when non-null
-- Clean existing data first, otherwise CREATE UNIQUE INDEX fails on remote DBs that already hold duplicates
UPDATE items SET barcode = NULL WHERE TRIM(barcode) = '';
UPDATE items SET barcode = NULL
WHERE barcode IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM items WHERE barcode IS NOT NULL GROUP BY barcode);
DROP INDEX IF EXISTS items_barcode_idx;
CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_unique_idx ON items(barcode) WHERE barcode IS NOT NULL;
