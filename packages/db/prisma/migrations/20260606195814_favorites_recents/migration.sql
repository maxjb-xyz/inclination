-- NOTE: `prisma migrate dev` proposed dropping "SearchIndex_tsv_idx" because the
-- tsvector GIN index is created via raw SQL in the search migration and is not
-- represented in the Prisma schema (it appears as drift). Dropping it would
-- break full-text search, so that statement is intentionally omitted here.

-- CreateTable
CREATE TABLE "Favorite" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","pageId")
);

-- CreateTable
CREATE TABLE "RecentlyVisited" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentlyVisited_pkey" PRIMARY KEY ("userId","pageId")
);

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE INDEX "RecentlyVisited_userId_visitedAt_idx" ON "RecentlyVisited"("userId", "visitedAt");
