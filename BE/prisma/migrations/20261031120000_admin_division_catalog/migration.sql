-- Official administrative catalogue (QĐ 19/2025/QĐ-TTg, two levels: province + commune/ward).
-- Additive only: existing addresses and Order snapshots are NOT rewritten; all-null codes = legacy free text.
-- No catalogue rows are seeded here; data is imported from the official file with its SHA256.

-- AlterTable
ALTER TABLE "user_addresses" ADD COLUMN     "divisionVersionId" INTEGER,
ADD COLUMN     "provinceCode" VARCHAR(2),
ADD COLUMN     "wardCode" VARCHAR(5);

-- CreateTable
CREATE TABLE "admin_division_versions" (
    "id" SERIAL NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "sourceSha256" CHAR(64) NOT NULL,
    "provinceCount" INTEGER NOT NULL,
    "wardCount" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_division_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_provinces" (
    "versionId" INTEGER NOT NULL,
    "code" VARCHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "admin_provinces_pkey" PRIMARY KEY ("versionId","code")
);

-- CreateTable
CREATE TABLE "admin_wards" (
    "versionId" INTEGER NOT NULL,
    "code" VARCHAR(5) NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provinceCode" VARCHAR(2) NOT NULL,

    CONSTRAINT "admin_wards_pkey" PRIMARY KEY ("versionId","code")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_division_versions_sourceSha256_key" ON "admin_division_versions"("sourceSha256");

-- CreateIndex
CREATE INDEX "admin_wards_versionId_provinceCode_idx" ON "admin_wards"("versionId", "provinceCode");

-- CreateIndex
CREATE UNIQUE INDEX "admin_wards_versionId_code_provinceCode_key" ON "admin_wards"("versionId", "code", "provinceCode");

-- CreateIndex
CREATE INDEX "user_addresses_divisionVersionId_wardCode_provinceCode_idx" ON "user_addresses"("divisionVersionId", "wardCode", "provinceCode");

-- AddForeignKey
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_divisionVersionId_wardCode_provinceCode_fkey" FOREIGN KEY ("divisionVersionId", "wardCode", "provinceCode") REFERENCES "admin_wards"("versionId", "code", "provinceCode") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "admin_provinces" ADD CONSTRAINT "admin_provinces_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "admin_division_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "admin_wards" ADD CONSTRAINT "admin_wards_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "admin_division_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "admin_wards" ADD CONSTRAINT "admin_wards_versionId_provinceCode_fkey" FOREIGN KEY ("versionId", "provinceCode") REFERENCES "admin_provinces"("versionId", "code") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Integrity not expressible in Prisma.
ALTER TABLE "admin_division_versions"
  ADD CONSTRAINT "admin_division_versions_sha_check" CHECK ("sourceSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "admin_division_versions_counts_check" CHECK ("provinceCount" > 0 AND "wardCount" > 0),
  ADD CONSTRAINT "admin_division_versions_source_check" CHECK (length(btrim("sourceRef")) BETWEEN 1 AND 200);
CREATE UNIQUE INDEX "admin_division_versions_one_active" ON "admin_division_versions" ("isActive") WHERE "isActive";
ALTER TABLE "admin_provinces"
  ADD CONSTRAINT "admin_provinces_code_check" CHECK ("code" ~ '^[0-9]{2}$'),
  ADD CONSTRAINT "admin_provinces_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "admin_provinces_kind_check" CHECK ("kind" IN ('THANH_PHO', 'TINH'));
ALTER TABLE "admin_wards"
  ADD CONSTRAINT "admin_wards_code_check" CHECK ("code" ~ '^[0-9]{5}$'),
  ADD CONSTRAINT "admin_wards_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "admin_wards_kind_check" CHECK ("kind" IN ('PHUONG', 'XA', 'DAC_KHU'));
ALTER TABLE "user_addresses"
  ADD CONSTRAINT "user_addresses_division_all_or_none" CHECK (
    ("provinceCode" IS NULL AND "wardCode" IS NULL AND "divisionVersionId" IS NULL) OR
    ("provinceCode" IS NOT NULL AND "wardCode" IS NOT NULL AND "divisionVersionId" IS NOT NULL)
  );
