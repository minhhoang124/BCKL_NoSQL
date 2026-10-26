-- Additive P1 aftersales; no legacy rows or Order/Payment states are rewritten.
CREATE TABLE aftersale_requests (
 id SERIAL PRIMARY KEY, "orderItemId" INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
 kind VARCHAR(24) NOT NULL CHECK(kind IN ('REFUND_ONLY','RETURN_AND_REFUND')),
 state VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','REJECTED','CANCELLED','DISPUTED','AWAITING_RETURN','REFUNDED','ADMIN_REJECTED')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 "reasonCode" VARCHAR(32) NOT NULL, description VARCHAR(1000) NOT NULL,
 "deadlineAt" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3), restockable BOOLEAN,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT aftersale_requests_id_orderItemId_key UNIQUE(id,"orderItemId"),
 CHECK ("deadlineAt">="createdAt"),
 CHECK (("receivedAt" IS NULL AND restockable IS NULL) OR
        ("receivedAt" IS NOT NULL AND restockable IS NOT NULL AND kind='RETURN_AND_REFUND' AND state='REFUNDED' AND "receivedAt">="createdAt")),
 CHECK(state<>'AWAITING_RETURN' OR kind='RETURN_AND_REFUND')
);
CREATE UNIQUE INDEX aftersale_item_reserved ON aftersale_requests("orderItemId") WHERE state IN ('PENDING','DISPUTED','AWAITING_RETURN');
CREATE INDEX "aftersale_requests_orderItemId_id_idx" ON aftersale_requests("orderItemId",id);
CREATE INDEX aftersale_requests_state_id_idx ON aftersale_requests(state,id);
CREATE TABLE aftersale_history (
 id BIGSERIAL PRIMARY KEY, "requestId" INTEGER NOT NULL REFERENCES aftersale_requests(id) ON DELETE RESTRICT,
 "actorId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 "fromState" VARCHAR(24), "toState" VARCHAR(24) NOT NULL,
 "fromRevision" INTEGER NOT NULL, "toRevision" INTEGER NOT NULL,
 reason VARCHAR(1000) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "aftersale_history_requestId_toRevision_key" UNIQUE("requestId","toRevision"),
 CHECK("fromRevision">=0 AND "toRevision">0 AND "toRevision"::bigint="fromRevision"::bigint+1),
 CHECK(("fromRevision"=0 AND "fromState" IS NULL AND "toState"='PENDING') OR ("fromRevision">0 AND "fromState" IS NOT NULL))
);
CREATE TABLE aftersale_commands (
 id BIGSERIAL PRIMARY KEY, "actorId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 "commandId" VARCHAR(36) NOT NULL CHECK("commandId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 action VARCHAR(16) NOT NULL CHECK(action IN ('create','cancel','dispute','approve','reject','receive')),
 "targetId" INTEGER NOT NULL CHECK("targetId">0),
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[0-9a-f]{64}$'),
 outcome VARCHAR(8) NOT NULL CHECK(outcome IN ('APPLIED','CLOSED')), receipt JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "aftersale_commands_actorId_commandId_key" UNIQUE("actorId","commandId"),
 CHECK((outcome='CLOSED' AND receipt IS NULL) OR
       (outcome='APPLIED' AND receipt IS NOT NULL AND jsonb_typeof(receipt)='object'))
);
CREATE TABLE refund_records (
 id BIGSERIAL PRIMARY KEY, "requestId" INTEGER NOT NULL UNIQUE,
 "orderItemId" INTEGER NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
 "paymentId" INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 amount DECIMAL(14,2) NOT NULL CHECK(amount>0), currency VARCHAR(3) NOT NULL DEFAULT 'VND' CHECK(currency='VND'),
 mode VARCHAR(16) NOT NULL DEFAULT 'SIMULATED' CHECK(mode='SIMULATED'),
 "succeededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "refund_records_requestId_orderItemId_key" UNIQUE("requestId","orderItemId"),
 FOREIGN KEY("requestId","orderItemId") REFERENCES aftersale_requests(id,"orderItemId") ON DELETE RESTRICT
);
CREATE TABLE revenue_adjustments (
 id BIGSERIAL PRIMARY KEY, "refundId" BIGINT NOT NULL UNIQUE REFERENCES refund_records(id) ON DELETE RESTRICT,
 amount DECIMAL(14,2) NOT NULL CHECK(amount<0), "effectiveAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "revenue_adjustments_effectiveAt_id_idx" ON revenue_adjustments("effectiveAt",id);

CREATE FUNCTION aftersale_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'aftersale ledger is immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER aftersale_history_immutable BEFORE UPDATE OR DELETE ON aftersale_history FOR EACH ROW EXECUTE FUNCTION aftersale_immutable();
CREATE TRIGGER aftersale_commands_immutable BEFORE UPDATE OR DELETE ON aftersale_commands FOR EACH ROW EXECUTE FUNCTION aftersale_immutable();
CREATE TRIGGER refund_records_immutable BEFORE UPDATE OR DELETE ON refund_records FOR EACH ROW EXECUTE FUNCTION aftersale_immutable();
CREATE FUNCTION aftersale_request_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'request history retained' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW."orderItemId",NEW.kind,NEW."reasonCode",NEW.description,NEW."deadlineAt",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD.id,OLD."orderItemId",OLD.kind,OLD."reasonCode",OLD.description,OLD."deadlineAt",OLD."createdAt")
    OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW.state=OLD.state THEN
   RAISE EXCEPTION 'invalid request identity/revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER aftersale_request_revision BEFORE UPDATE OR DELETE ON aftersale_requests FOR EACH ROW EXECUTE FUNCTION aftersale_request_revision();
CREATE FUNCTION refund_record_validate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_items i JOIN payments p ON p."orderId"=i."orderId"
   WHERE i.id=NEW."orderItemId" AND p.id=NEW."paymentId" AND p.status='PAID'
   AND p.currency='VND' AND p."paidAt" IS NOT NULL AND NEW.amount=i."lineTotal") THEN
  RAISE EXCEPTION 'invalid refund provenance' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER refund_record_validate BEFORE INSERT ON refund_records FOR EACH ROW EXECUTE FUNCTION refund_record_validate();
CREATE FUNCTION revenue_adjustment_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_amount NUMERIC; expected_time TIMESTAMP(3);
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'adjustment retained' USING ERRCODE='23514'; END IF;
 SELECT -r.amount, CASE WHEN o."completedAt" IS NULL THEN NULL ELSE GREATEST(r."succeededAt",o."completedAt") END
 INTO expected_amount,expected_time FROM refund_records r JOIN order_items i ON i.id=r."orderItemId" JOIN orders o ON o.id=i."orderId" WHERE r.id=NEW."refundId";
 IF expected_amount IS NULL OR NEW.amount<>expected_amount OR NEW."effectiveAt" IS DISTINCT FROM expected_time THEN
  RAISE EXCEPTION 'invalid adjustment provenance' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (OLD."effectiveAt" IS NOT NULL OR NEW."effectiveAt" IS NULL OR
   ROW(NEW.id,NEW."refundId",NEW.amount,NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."refundId",OLD.amount,OLD."createdAt")) THEN
  RAISE EXCEPTION 'adjustment immutable except activation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER revenue_adjustment_validate BEFORE INSERT OR UPDATE OR DELETE ON revenue_adjustments FOR EACH ROW EXECUTE FUNCTION revenue_adjustment_validate();
