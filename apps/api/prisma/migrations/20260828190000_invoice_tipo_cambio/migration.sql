-- Exchange rate to PYG carried by the DTE (dTiCam); null for PYG invoices.
ALTER TABLE "Invoice" ADD COLUMN "tipoCambio" DECIMAL(18,6);
