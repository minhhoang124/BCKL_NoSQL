-- Expand only: preserve Buyer and Seller preparation fences and all immutable
-- identity/opposing-outcome triggers. No historical receipts or keys are changed.
BEGIN;
ALTER TABLE "order_command_resolutions" DROP CONSTRAINT "order_resolution_identity_check";
ALTER TABLE "order_command_resolutions" ADD CONSTRAINT "order_resolution_identity_check" CHECK (
 "actorScope" = 'USER:' || "actorId"::text
 AND "actorId" > 0 AND "orderId" > 0 AND "hashVersion" = 1
 AND (("actorType" = 'SELLER' AND "command" IN ('confirm','start-packing','ready-to-ship','cancel','confirm-returned'))
   OR ("actorType" = 'BUYER' AND "command" IN ('cancel','complete')))
 AND "idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'
 AND "requestHash" ~ '^[0-9a-f]{64}$'
);
COMMIT;
