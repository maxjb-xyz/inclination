-- CreateTable
CREATE TABLE "SearchIndex" (
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "tsv" tsvector,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchIndex_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "pageId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchIndex_workspaceId_idx" ON "SearchIndex"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_objectKey_key" ON "Attachment"("objectKey");

-- CreateIndex
CREATE INDEX "Attachment_pageId_idx" ON "Attachment"("pageId");

-- CreateIndex
CREATE INDEX "Attachment_workspaceId_idx" ON "Attachment"("workspaceId");

-- AddForeignKey
ALTER TABLE "SearchIndex" ADD CONSTRAINT "SearchIndex_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Full-text search column maintenance (Phase 7, spec §6).
-- Prisma cannot model a generated/maintained tsvector, so the `tsv` column is
-- kept current by a trigger rather than by application writers. Any INSERT or
-- UPDATE on SearchIndex recomputes `tsv` from the title + extracted body text,
-- and a GIN index makes `tsv @@ websearch_to_tsquery(...)` fast. Because the
-- trigger owns `tsv`, every writer (sync server body upsert, API title/cell
-- updates) only has to set the scalar `title`/`bodyText` columns and the search
-- vector stays consistent regardless of which writer touched the row.
-- ─────────────────────────────────────────────────────────────

-- Recompute the search vector from title + bodyText. `coalesce` guards NULLs.
CREATE OR REPLACE FUNCTION "search_index_tsv_update"() RETURNS trigger AS $$
BEGIN
  NEW."tsv" :=
    to_tsvector('english', coalesce(NEW."title", '') || ' ' || coalesce(NEW."bodyText", ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire BEFORE INSERT/UPDATE so the freshly computed vector is what gets stored.
CREATE TRIGGER "search_index_tsv_trigger"
  BEFORE INSERT OR UPDATE ON "SearchIndex"
  FOR EACH ROW
  EXECUTE FUNCTION "search_index_tsv_update"();

-- GIN index over the maintained vector for fast full-text matching.
CREATE INDEX "SearchIndex_tsv_idx" ON "SearchIndex" USING GIN ("tsv");
