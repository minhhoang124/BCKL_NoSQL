-- Additive follow-up: do not rewrite the already-applied local QA migration.
CREATE FUNCTION chat_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."buyerId" IS DISTINCT FROM OLD."buyerId"
    OR NEW."storeId" IS DISTINCT FROM OLD."storeId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."lastSequence"::BIGINT <> OLD."lastSequence"::BIGINT + 1 THEN
    RAISE EXCEPTION 'chat parent identity/counter immutable except append' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_parent_guard BEFORE UPDATE ON "chat_conversations" FOR EACH ROW EXECUTE FUNCTION chat_parent_guard();

CREATE FUNCTION chat_parent_history_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_last INTEGER; history_last INTEGER;
BEGIN
  SELECT "lastSequence" INTO current_last FROM "chat_conversations" WHERE id=NEW.id;
  SELECT COALESCE(MAX(sequence),0) INTO history_last FROM "chat_messages" WHERE "conversationId"=NEW.id;
  IF current_last IS DISTINCT FROM history_last THEN
    RAISE EXCEPTION 'chat parent must match committed history' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER chat_parent_history_check AFTER INSERT OR UPDATE ON "chat_conversations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION chat_parent_history_check();
