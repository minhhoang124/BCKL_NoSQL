CREATE TABLE "chat_conversations" (
  "id" SERIAL PRIMARY KEY,
  "buyerId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "storeId" INTEGER NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lastSequence" INTEGER NOT NULL DEFAULT 0 CHECK ("lastSequence" >= 0),
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_conversations_buyerId_storeId_key" UNIQUE ("buyerId", "storeId")
);
CREATE INDEX "chat_conversations_storeId_id_idx" ON "chat_conversations"("storeId", "id");
CREATE TABLE "chat_messages" (
  "id" SERIAL PRIMARY KEY,
  "conversationId" INTEGER NOT NULL REFERENCES "chat_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "senderId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "senderType" TEXT NOT NULL CHECK ("senderType" IN ('BUYER', 'SELLER')),
  "clientMessageId" VARCHAR(128) NOT NULL CHECK (length("clientMessageId") BETWEEN 1 AND 128 AND "clientMessageId" !~ '[^!-~]'),
  "content" TEXT NOT NULL CHECK (char_length("content") BETWEEN 1 AND 2000 AND btrim("content") <> ''),
  "payloadHash" VARCHAR(64) NOT NULL CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  "hashVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("hashVersion" = 1),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("conversationId", "sequence"),
  UNIQUE ("conversationId", "senderId", "clientMessageId"),
  UNIQUE ("conversationId", "id", "sequence")
);
CREATE TABLE "chat_read_states" (
  "conversationId" INTEGER NOT NULL REFERENCES "chat_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lastReadMessageId" INTEGER NOT NULL,
  "lastReadSequence" INTEGER NOT NULL CHECK ("lastReadSequence" > 0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("conversationId", "userId"),
  FOREIGN KEY ("conversationId", "lastReadMessageId", "lastReadSequence")
    REFERENCES "chat_messages"("conversationId", "id", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Both transports must lock the parent before replay lookup; this also guards
-- append ordering against an accidental direct INSERT using a stale sequence.
CREATE FUNCTION chat_append_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected INTEGER;
BEGIN
  SELECT "lastSequence" INTO expected FROM "chat_conversations" WHERE id=NEW."conversationId" FOR UPDATE;
  IF expected IS NULL OR expected = 2147483647 OR NEW.sequence::BIGINT <> expected::BIGINT + 1 THEN
    RAISE EXCEPTION 'chat sequence invalid' USING ERRCODE='23514';
  END IF;
  UPDATE "chat_conversations" SET "lastSequence"=NEW.sequence, "lastMessageAt"=NEW."createdAt" WHERE id=NEW."conversationId";
  RETURN NEW;
END $$;
CREATE TRIGGER chat_append_sequence BEFORE INSERT ON "chat_messages" FOR EACH ROW EXECUTE FUNCTION chat_append_sequence();

CREATE FUNCTION chat_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'chat message history immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER chat_history_immutable BEFORE UPDATE OR DELETE ON "chat_messages" FOR EACH ROW EXECUTE FUNCTION chat_history_immutable();

CREATE FUNCTION chat_read_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."conversationId" <> OLD."conversationId" OR NEW."userId" <> OLD."userId" OR NEW."lastReadSequence" < OLD."lastReadSequence" THEN
    RAISE EXCEPTION 'chat read cursor cannot move backwards' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_read_monotonic BEFORE UPDATE ON "chat_read_states" FOR EACH ROW EXECUTE FUNCTION chat_read_monotonic();
