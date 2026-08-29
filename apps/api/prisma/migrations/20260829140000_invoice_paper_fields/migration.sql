-- Paper invoices (talonario) have no CDC: they carry a timbrado and a document
-- number instead. Both nullable — electronic invoices leave them empty.
ALTER TABLE "Invoice" ADD COLUMN "timbrado" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "numeroDoc" TEXT;
