-- CreateTable
CREATE TABLE "PageReference" (
    "id" TEXT NOT NULL,
    "fromPageId" TEXT NOT NULL,
    "toPageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageReference_toPageId_idx" ON "PageReference"("toPageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageReference_fromPageId_toPageId_key" ON "PageReference"("fromPageId", "toPageId");

-- AddForeignKey
ALTER TABLE "PageReference" ADD CONSTRAINT "PageReference_fromPageId_fkey" FOREIGN KEY ("fromPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageReference" ADD CONSTRAINT "PageReference_toPageId_fkey" FOREIGN KEY ("toPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
