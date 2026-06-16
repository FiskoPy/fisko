-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cdc" TEXT NOT NULL,
    "tipoDoc" INTEGER NOT NULL,
    "tipoDocDesc" TEXT,
    "emisorRuc" TEXT NOT NULL,
    "emisorDv" INTEGER,
    "emisorNombre" TEXT NOT NULL,
    "receptorRuc" TEXT,
    "receptorDv" INTEGER,
    "receptorNombre" TEXT,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PYG',
    "totalOpe" DECIMAL(18,4) NOT NULL,
    "totalIva" DECIMAL(18,4) NOT NULL,
    "iva5" DECIMAL(18,4) NOT NULL,
    "iva10" DECIMAL(18,4) NOT NULL,
    "baseGrav5" DECIMAL(18,4) NOT NULL,
    "baseGrav10" DECIMAL(18,4) NOT NULL,
    "originalCdc" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "xmlRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "codigo" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(18,4) NOT NULL,
    "precioUnit" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "ivaRate" INTEGER NOT NULL,
    "ivaBase" DECIMAL(18,4) NOT NULL,
    "ivaMonto" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_cdc_key" ON "Invoice"("cdc");

-- CreateIndex
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

-- CreateIndex
CREATE INDEX "Invoice_userId_fechaEmision_idx" ON "Invoice"("userId", "fechaEmision");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
