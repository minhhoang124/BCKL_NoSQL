-- CreateTable
CREATE TABLE "product_reviews" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rating" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_review_replies" (
    "reviewId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_review_replies_pkey" PRIMARY KEY ("reviewId")
);

-- CreateTable
CREATE TABLE "product_review_audits" (
    "id" BIGSERIAL NOT NULL,
    "reviewId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" VARCHAR(8) NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "hidden" BOOLEAN NOT NULL,
    "replyBody" VARCHAR(2000),
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_review_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_review_commands" (
    "id" BIGSERIAL NOT NULL,
    "actorId" INTEGER NOT NULL,
    "commandId" UUID NOT NULL,
    "scope" VARCHAR(8) NOT NULL,
    "action" VARCHAR(8) NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(8) NOT NULL,
    "auditId" BIGINT,
    "receipt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_review_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_reviews_orderItemId_key" ON "product_reviews"("orderItemId");

-- CreateIndex
CREATE INDEX "product_reviews_hidden_id_idx" ON "product_reviews"("hidden", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_review_audits_reviewId_revision_key" ON "product_review_audits"("reviewId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "product_review_commands_auditId_key" ON "product_review_commands"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "product_review_commands_actorId_commandId_key" ON "product_review_commands"("actorId", "commandId");

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_replies" ADD CONSTRAINT "product_review_replies_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "product_reviews"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_replies" ADD CONSTRAINT "product_review_replies_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_audits" ADD CONSTRAINT "product_review_audits_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "product_reviews"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_audits" ADD CONSTRAINT "product_review_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_commands" ADD CONSTRAINT "product_review_commands_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_commands" ADD CONSTRAINT "product_review_commands_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "product_review_commands" ADD CONSTRAINT "product_review_commands_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "product_review_audits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE product_reviews ADD CONSTRAINT product_review_shape CHECK
 (revision>0 AND rating BETWEEN 1 AND 5 AND char_length(btrim(body)) BETWEEN 1 AND 2000);
ALTER TABLE product_review_replies ADD CONSTRAINT product_reply_shape CHECK
 (char_length(btrim(body)) BETWEEN 1 AND 2000);
ALTER TABLE product_review_audits ADD CONSTRAINT product_review_audit_shape CHECK
 (revision>0 AND rating BETWEEN 1 AND 5 AND char_length(btrim(body)) BETWEEN 1 AND 2000
 AND ((action='create' AND revision=1 AND NOT hidden AND "replyBody" IS NULL AND reason IS NULL)
   OR (action='edit' AND revision>1 AND "replyBody" IS NULL AND reason IS NULL)
   OR (action='reply' AND revision>1 AND char_length(btrim("replyBody")) BETWEEN 1 AND 2000 AND reason IS NULL)
   OR (action='hide' AND revision>1 AND hidden AND "replyBody" IS NULL AND char_length(btrim(reason)) BETWEEN 10 AND 500)) IS TRUE);
ALTER TABLE product_review_commands ADD CONSTRAINT product_review_command_shape CHECK
 ((scope='BUYER' AND action IN ('create','edit') OR scope='SELLER' AND action='reply' OR scope='ADMIN' AND action='hide')
 AND "requestHash" ~ '^[0-9a-f]{64}$'
 AND ((outcome='CLOSED' AND "auditId" IS NULL AND receipt IS NULL)
   OR (outcome='APPLIED' AND "auditId" IS NOT NULL AND jsonb_typeof(receipt)='object')) IS TRUE);

CREATE FUNCTION product_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Review evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER product_review_reply_immutable BEFORE UPDATE OR DELETE ON product_review_replies
 FOR EACH ROW EXECUTE FUNCTION product_review_immutable();
CREATE TRIGGER product_review_audit_immutable BEFORE UPDATE OR DELETE ON product_review_audits
 FOR EACH ROW EXECUTE FUNCTION product_review_immutable();
CREATE TRIGGER product_review_command_immutable BEFORE UPDATE OR DELETE ON product_review_commands
 FOR EACH ROW EXECUTE FUNCTION product_review_immutable();
CREATE FUNCTION product_review_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.revision<>1 OR NEW.hidden) THEN
   RAISE EXCEPTION 'Review must start visible at revision one' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW."orderItemId"<>OLD."orderItemId" OR NEW.revision<>OLD.revision+1
   OR (OLD.hidden AND NOT NEW.hidden) OR NEW."createdAt"<>OLD."createdAt") THEN
   RAISE EXCEPTION 'Review revision/identity violation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_review_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON product_reviews
 FOR EACH ROW EXECUTE FUNCTION product_review_revision_guard();

-- The review row is inserted/updated before its evidence in one transaction.
-- Deferred verification checks the final state, not each intermediate statement.
CREATE FUNCTION product_review_final_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r product_reviews; a product_review_audits;
BEGIN
 SELECT * INTO r FROM product_reviews WHERE id=NEW.id;
 SELECT * INTO a FROM product_review_audits WHERE "reviewId"=r.id AND revision=r.revision;
 IF a.id IS NULL OR a.rating<>r.rating OR a.body<>r.body OR a.hidden<>r.hidden THEN
   RAISE EXCEPTION 'Review final state requires matching audit' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_review_final_audit AFTER INSERT OR UPDATE ON product_reviews
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_review_final_audit();
