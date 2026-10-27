-- Additive sandbox payment evidence. Existing COD Orders, Payments and receipts stay unchanged.
ALTER TYPE "PaymentStatus" ADD VALUE 'REVIEW_REQUIRED';
CREATE TABLE payment_transactions (
 id UUID PRIMARY KEY,
 "paymentId" INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 reference VARCHAR(32) NOT NULL UNIQUE CHECK(reference ~ '^[a-f0-9]{32}$'),
 provider "PaymentProvider" NOT NULL DEFAULT 'VNPAY' CHECK(provider='VNPAY'),
 "tmnCode" VARCHAR(8) NOT NULL CHECK("tmnCode" ~ '^[A-Z0-9]{8}$'),
 amount DECIMAL(14,2) NOT NULL CHECK(amount>0 AND amount=trunc(amount) AND amount<=9999999999),
 currency VARCHAR(3) NOT NULL DEFAULT 'VND' CHECK(currency='VND'),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCEEDED','FAILED','CANCELLED','REVIEW_REQUIRED')),
 "ipAddress" VARCHAR(45) NOT NULL,
 "returnUrl" VARCHAR(255) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "settledAt" TIMESTAMP(3),
 "providerTransactionNo" VARCHAR(15),
 "responseCode" VARCHAR(2),
 "transactionStatus" VARCHAR(2),
 CONSTRAINT payment_transactions_time CHECK("expiresAt"="createdAt"+INTERVAL '15 minutes' AND ("settledAt" IS NULL OR "settledAt">="createdAt")),
 CONSTRAINT payment_transactions_terminal CHECK((status='PENDING' AND "settledAt" IS NULL AND "providerTransactionNo" IS NULL AND "responseCode" IS NULL AND "transactionStatus" IS NULL) OR
 (status<>'PENDING' AND "settledAt" IS NOT NULL AND "responseCode" ~ '^[0-9]{2}$' AND "transactionStatus" ~ '^[0-9]{2}$')),
 CONSTRAINT payment_transactions_success CHECK(status<>'SUCCEEDED' OR ("responseCode"='00' AND "transactionStatus"='00' AND "providerTransactionNo" ~ '^[1-9][0-9]{0,14}$')),
 UNIQUE(provider,"providerTransactionNo")
);
CREATE TABLE payment_notifications (
 id BIGSERIAL PRIMARY KEY,
 "transactionId" UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 digest VARCHAR(64) NOT NULL UNIQUE CHECK(digest ~ '^[a-f0-9]{64}$'),
 "responseCode" VARCHAR(2) NOT NULL CHECK("responseCode" ~ '^[0-9]{2}$'),
 "transactionStatus" VARCHAR(2) NOT NULL CHECK("transactionStatus" ~ '^[0-9]{2}$'),
 "providerTransactionNo" VARCHAR(15) NOT NULL CHECK("providerTransactionNo" ~ '^[0-9]{1,15}$'),
 outcome VARCHAR(16) NOT NULL CHECK(outcome IN ('SUCCEEDED','FAILED','CANCELLED','REVIEW_REQUIRED')),
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payment_notifications_transactionId_id_idx" ON payment_notifications("transactionId",id);
CREATE FUNCTION payment_notification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payment notification is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER payment_notification_immutable BEFORE UPDATE OR DELETE ON payment_notifications FOR EACH ROW EXECUTE FUNCTION payment_notification_immutable();
CREATE FUNCTION payment_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (
   (to_jsonb(NEW)-'status'-'settledAt'-'providerTransactionNo'-'responseCode'-'transactionStatus') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'settledAt'-'providerTransactionNo'-'responseCode'-'transactionStatus')
   OR (OLD.status<>'PENDING' AND NEW IS DISTINCT FROM OLD AND NOT(OLD.status<>'REVIEW_REQUIRED' AND NEW.status='REVIEW_REQUIRED'))
   OR (OLD.status<>'PENDING' AND NEW.status='PENDING')
 ) THEN RAISE EXCEPTION 'Payment transaction identity/terminal state immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM payments WHERE id=NEW."paymentId";
 IF NOT FOUND OR p.provider<>'VNPAY' OR p.amount<>NEW.amount OR p.currency<>NEW.currency
 THEN RAISE EXCEPTION 'Transaction must match online Payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_transaction_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION payment_transaction_guard();

-- COD hash/receipt v1 stays strict. Online checkout uses an explicit v2 boundary.
ALTER TABLE checkouts ADD CONSTRAINT checkouts_v2_shape CHECK("hashVersion" IS DISTINCT FROM 2 OR
 ("requestHash" ~ '^[0-9a-f]{64}$' AND (status<>'COMPLETED' OR
 COALESCE("completedAt" IS NOT NULL AND "receiptVersion"=2 AND jsonb_typeof("receiptJson")='object',false))));
CREATE FUNCTION protect_completed_checkout_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."hashVersion"=2 AND OLD.status='COMPLETED' AND
 (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt')
 THEN RAISE EXCEPTION 'Completed checkout v2 is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkouts_v2_immutable BEFORE UPDATE ON checkouts FOR EACH ROW EXECUTE FUNCTION protect_completed_checkout_v2();
