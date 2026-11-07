-- Additive foundation only. No Product value rewrites or historical audit guessing.
BEGIN;
ALTER TABLE "category_attribute_definitions" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "category_attribute_definitions" ADD CONSTRAINT "category_attribute_revision_positive" CHECK ("revision">0);

-- Keep read revision honest even while existing write APIs still exist.
-- Future CAS writes may set old+1; never double increment and never reset.
CREATE FUNCTION "category_attribute_bump_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE metadata_changed boolean;
BEGIN
 metadata_changed := ROW(NEW.name,NEW.slug,NEW."dataType",NEW."isRequired",NEW."isFilterable",NEW."allowsCustom",NEW."sortOrder",NEW."isActive")
   IS DISTINCT FROM ROW(OLD.name,OLD.slug,OLD."dataType",OLD."isRequired",OLD."isFilterable",OLD."allowsCustom",OLD."sortOrder",OLD."isActive");
 IF NEW.revision IS DISTINCT FROM OLD.revision AND NEW.revision::bigint<>OLD.revision::bigint+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='attribute_revision_monotonic',MESSAGE='Attribute revision cannot reset or skip';
 END IF;
 IF metadata_changed OR NEW.revision::bigint=OLD.revision::bigint+1 THEN
  IF OLD.revision=2147483647 THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='attribute_revision_exhausted',MESSAGE='Attribute revision exhausted';
  END IF;
  NEW.revision := OLD.revision+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "category_attribute_revision" BEFORE UPDATE ON "category_attribute_definitions"
 FOR EACH ROW EXECUTE FUNCTION "category_attribute_bump_revision"();

CREATE FUNCTION "category_attribute_option_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_revision integer;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW."attributeDefinitionId",NEW.value,NEW.slug,NEW."sortOrder",NEW."isActive")
   IS NOT DISTINCT FROM ROW(OLD."attributeDefinitionId",OLD.value,OLD.slug,OLD."sortOrder",OLD."isActive") THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW."attributeDefinitionId"<>OLD."attributeDefinitionId" THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='attribute_option_parent_immutable',MESSAGE='Option parent is immutable';
 END IF;
 SELECT revision INTO parent_revision FROM "category_attribute_definitions"
   WHERE id=NEW."attributeDefinitionId" FOR UPDATE;
 IF parent_revision=2147483647 THEN
   RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='attribute_revision_exhausted',MESSAGE='Attribute revision exhausted';
 END IF;
 UPDATE "category_attribute_definitions" SET revision=revision+1,"updatedAt"=CURRENT_TIMESTAMP WHERE id=NEW."attributeDefinitionId";
 RETURN NEW;
END $$;
CREATE TRIGGER "category_attribute_option_revision" AFTER INSERT OR UPDATE ON "category_attribute_options"
 FOR EACH ROW EXECUTE FUNCTION "category_attribute_option_revision"();

CREATE TABLE "category_attribute_audits" (
 "id" SERIAL PRIMARY KEY,"actorId" INTEGER NOT NULL REFERENCES "users"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "categoryId" INTEGER NOT NULL,"definitionId" INTEGER NOT NULL,"optionId" INTEGER,
 "entityType" VARCHAR(16) NOT NULL,"command" VARCHAR(32) NOT NULL,"revision" INTEGER NOT NULL,
 "reason" TEXT,"correlationId" UUID NOT NULL,"oldValues" JSONB,"newValues" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "attribute_audit_shape" CHECK ("categoryId">0 AND "definitionId">0 AND "revision">0
   AND (("entityType"='DEFINITION' AND "optionId" IS NULL) OR ("entityType"='OPTION' AND "optionId" IS NOT NULL AND "optionId">0))
   AND jsonb_typeof("newValues")='object' AND ("oldValues" IS NULL OR jsonb_typeof("oldValues")='object'))
);
CREATE INDEX "category_attribute_audits_definitionId_createdAt_idx" ON "category_attribute_audits"("definitionId","createdAt");
CREATE INDEX "category_attribute_audits_categoryId_createdAt_idx" ON "category_attribute_audits"("categoryId","createdAt");
CREATE FUNCTION "category_attribute_audit_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='attribute_audit_immutable',MESSAGE='Attribute audit is immutable'; END $$;
CREATE TRIGGER "category_attribute_audit_immutable" BEFORE UPDATE OR DELETE ON "category_attribute_audits"
 FOR EACH ROW EXECUTE FUNCTION "category_attribute_audit_immutable"();
COMMIT;
