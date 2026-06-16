-- Dedup invoices per user instead of globally.
DROP INDEX "Invoice_cdc_key";
CREATE UNIQUE INDEX "Invoice_userId_cdc_key" ON "Invoice"("userId", "cdc");
