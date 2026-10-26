-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "audience" VARCHAR(8) NOT NULL,
    "sourceKind" VARCHAR(16) NOT NULL,
    "sourceId" BIGINT NOT NULL,
    "channel" VARCHAR(8) NOT NULL DEFAULT 'IN_APP',
    "title" VARCHAR(160) NOT NULL,
    "text" VARCHAR(400) NOT NULL,
    "link" VARCHAR(200) NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_audience_id_idx" ON "notifications"("recipientId", "audience", "id");

-- CreateIndex
CREATE INDEX "notifications_recipient_read_id_idx" ON "notifications"("recipientId", "readAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_recipient_channel_key" ON "notifications"("recipientId", "sourceKind", "sourceId", "channel");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE notifications ADD CONSTRAINT notification_payload_shape CHECK (
 "sourceId">0 AND channel='IN_APP' AND audience IN('ACCOUNT','BUYER','SELLER','ADMIN')
 AND "sourceKind" IN('ORDER','STORE','PRODUCT','AFTERSALE','CHAT','REVIEW')
 AND char_length(btrim(title)) BETWEEN 1 AND 160 AND char_length(btrim(text)) BETWEEN 1 AND 400
 AND char_length(link) BETWEEN 1 AND 200
 AND link ~ '^/(account/(orders/[1-9][0-9]*|aftersales|reviews\?itemId=[1-9][0-9]*|store-application)|seller(/orders/[1-9][0-9]*|/aftersales|/reviews)?|admin/(products|stores|returns|store-applications\?storeId=[1-9][0-9]*)|messages/[1-9][0-9]*)$'
 AND ("readAt" IS NULL OR "readAt">="createdAt")
);
CREATE FUNCTION notification_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'readAt') IS DISTINCT FROM (to_jsonb(OLD)-'readAt')
   OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS DISTINCT FROM OLD."readAt")
 THEN RAISE EXCEPTION 'Only first read acknowledgement may change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_evidence_guard BEFORE UPDATE OR DELETE ON notifications
 FOR EACH ROW EXECUTE FUNCTION notification_evidence_guard();
