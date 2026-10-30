-- Same file uploaded under two tenants becomes one row. Keep the earliest id.
DELETE FROM "idp_document" a
USING "idp_document" b
WHERE a.sha256 = b.sha256
  AND a.id > b.id;

-- DropIndex
DROP INDEX "idp_document_tenantId_sha256_key";

-- CreateIndex
CREATE UNIQUE INDEX "idp_document_sha256_key" ON "idp_document"("sha256");

-- DropIndex
DROP INDEX "idp_extraction_tenantId_requestHash_idx";

-- CreateIndex
CREATE INDEX "idp_extraction_requestHash_idx" ON "idp_extraction"("requestHash");

-- AlterTable
ALTER TABLE "idp_document" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "idp_page" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "idp_extraction" DROP COLUMN "tenantId";

-- AlterTable
ALTER TABLE "idp_extracted_field" DROP COLUMN "tenantId";
