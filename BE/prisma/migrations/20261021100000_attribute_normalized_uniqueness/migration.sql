-- Contract #65: reserve normalized labels even on inactive definitions/options.
-- No label/value/foreign-key/revision/timestamp backfill. Fail on existing conflicts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Prevent a writer from slipping between duplicate detection and index creation.
LOCK TABLE "category_attribute_definitions", "category_attribute_options"
  IN SHARE ROW EXCLUSIVE MODE;

-- ICU is explicit: lower() must not silently inherit a deployment's C/Turkish locale.
-- Keep this v1 definition stable; a future Unicode/ICU change needs an audited
-- migration and REINDEX, not CREATE OR REPLACE under an existing expression index.
CREATE COLLATION "attribute_vi_v1" (provider = icu, locale = 'vi', deterministic = true);
CREATE FUNCTION "attribute_normalized_key_v1"(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN pg_catalog.lower(
  pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.normalize(value, 'NFC'),
      -- ECMAScript trim/\s, NOT PostgreSQL's locale-dependent [[:space:]].
      U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',
      ' ', 'g'
    ), ' '
  ) COLLATE "attribute_vi_v1"
);

DO $$
DECLARE definition_groups bigint; option_groups bigint; oversized bigint;
BEGIN
  SELECT count(*) INTO definition_groups FROM (
    SELECT 1 FROM "category_attribute_definitions"
    GROUP BY "categoryId", "attribute_normalized_key_v1"(name) COLLATE "C"
    HAVING count(*) > 1
  ) AS conflicts;
  SELECT count(*) INTO option_groups FROM (
    SELECT 1 FROM "category_attribute_options"
    GROUP BY "attributeDefinitionId", "attribute_normalized_key_v1"(value) COLLATE "C"
    HAVING count(*) > 1
  ) AS conflicts;
  IF definition_groups > 0 OR option_groups > 0 THEN
    -- Counts only: migration logs must not expose historical label/value content.
    RAISE EXCEPTION USING ERRCODE='23505',
      CONSTRAINT='attribute_normalized_upgrade_conflict',
      MESSAGE=format('Normalized attribute conflicts: definition groups=%s, option groups=%s. Audit and resolve explicitly before retry.', definition_groups, option_groups);
  END IF;
  -- Index rows must fit B-tree pages; never truncate/hash away a legacy value.
  SELECT count(*) INTO oversized FROM (
    SELECT "attribute_normalized_key_v1"(name) AS key FROM "category_attribute_definitions"
    UNION ALL SELECT "attribute_normalized_key_v1"(value) FROM "category_attribute_options"
  ) AS labels WHERE octet_length(key) > 2000;
  IF oversized > 0 THEN
    RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='Legacy attribute labels exceed safe index bounds. Audit explicitly before retry.';
  END IF;
END $$;

-- Bytewise comparison after canonicalization retains accents and does not fold
-- compatibility characters. These SQL expression indexes are not Prisma fields.
CREATE UNIQUE INDEX "attribute_definition_category_normalized_name_key"
  ON "category_attribute_definitions" ("categoryId", ("attribute_normalized_key_v1"(name) COLLATE "C"));
CREATE UNIQUE INDEX "attribute_option_definition_normalized_value_key"
  ON "category_attribute_options" ("attributeDefinitionId", ("attribute_normalized_key_v1"(value) COLLATE "C"));
COMMIT;
