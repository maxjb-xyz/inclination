-- NOTE: `prisma migrate dev` proposed dropping "SearchIndex_tsv_idx" because the
-- tsvector GIN index is created via raw SQL in the search migration and is not
-- represented in the Prisma schema (it appears as drift). Dropping it would
-- break full-text search, so that statement is intentionally omitted here.

-- CreateTable
CREATE TABLE "PublicShare" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "includeSubpages" BOOLEAN NOT NULL DEFAULT false,
    "allowDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "publishedHtml" TEXT,
    "publishedTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncedBlock" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ydocState" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncedBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicShare_pageId_key" ON "PublicShare"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicShare_slug_key" ON "PublicShare"("slug");

-- CreateIndex
CREATE INDEX "PublicShare_slug_idx" ON "PublicShare"("slug");

-- CreateIndex
CREATE INDEX "SyncedBlock_workspaceId_idx" ON "SyncedBlock"("workspaceId");

-- AddForeignKey
ALTER TABLE "PublicShare" ADD CONSTRAINT "PublicShare_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
