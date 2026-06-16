-- CreateTable
CREATE TABLE "EmailConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "authType" TEXT NOT NULL DEFAULT 'app_password',
    "secretEnc" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailConnection_userId_idx" ON "EmailConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConnection_userId_email_key" ON "EmailConnection"("userId", "email");

-- AddForeignKey
ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
