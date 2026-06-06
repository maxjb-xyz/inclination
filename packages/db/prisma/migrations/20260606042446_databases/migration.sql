-- CreateTable
CREATE TABLE "Database" (
    "pageId" TEXT NOT NULL,
    "defaultViewId" TEXT,
    "subitemsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "subitemsPropertyId" TEXT,

    CONSTRAINT "Database_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cell" (
    "id" TEXT NOT NULL,
    "rowPageId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Cell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationLink" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fromRowId" TEXT NOT NULL,
    "toRowId" TEXT NOT NULL,

    CONSTRAINT "RelationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "databaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_databaseId_idx" ON "Property"("databaseId");

-- CreateIndex
CREATE INDEX "Cell_propertyId_idx" ON "Cell"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Cell_rowPageId_propertyId_key" ON "Cell"("rowPageId", "propertyId");

-- CreateIndex
CREATE INDEX "RelationLink_propertyId_fromRowId_idx" ON "RelationLink"("propertyId", "fromRowId");

-- CreateIndex
CREATE INDEX "RelationLink_propertyId_toRowId_idx" ON "RelationLink"("propertyId", "toRowId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationLink_propertyId_fromRowId_toRowId_key" ON "RelationLink"("propertyId", "fromRowId", "toRowId");

-- CreateIndex
CREATE INDEX "View_databaseId_idx" ON "View"("databaseId");

-- AddForeignKey
ALTER TABLE "Database" ADD CONSTRAINT "Database_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database"("pageId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cell" ADD CONSTRAINT "Cell_rowPageId_fkey" FOREIGN KEY ("rowPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cell" ADD CONSTRAINT "Cell_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationLink" ADD CONSTRAINT "RelationLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationLink" ADD CONSTRAINT "RelationLink_fromRowId_fkey" FOREIGN KEY ("fromRowId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationLink" ADD CONSTRAINT "RelationLink_toRowId_fkey" FOREIGN KEY ("toRowId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_databaseId_fkey" FOREIGN KEY ("databaseId") REFERENCES "Database"("pageId") ON DELETE CASCADE ON UPDATE CASCADE;
