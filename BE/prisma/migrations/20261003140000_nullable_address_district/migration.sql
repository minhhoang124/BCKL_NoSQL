-- Expand only: preserve existing district strings and all historical snapshots.
ALTER TABLE "user_addresses" ALTER COLUMN "district" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "districtSnapshot" DROP NOT NULL;
