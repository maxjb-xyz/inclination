/**
 * Phase 9 — demo/seed data (spec §8 self-host).
 *
 * Idempotent, opt-in seed: creates a demo workspace with a couple of document
 * pages and a small "Tasks" database (a board-ish table with Status + Due date).
 * Gated behind `SEED_DEMO=true` — running it without that env var is a no-op so
 * it is safe to wire into boot/CI without ever mutating a real install.
 *
 * Idempotency strategy: a stable demo workspace id + deterministic page ids so
 * re-running upserts the same rows rather than duplicating them. The demo data
 * is owned by the first existing user (or a created demo user) so the workspace
 * is reachable in the app.
 *
 * Run: `SEED_DEMO=true pnpm --filter @inclination/db run seed`
 */
import { PrismaClient } from "@prisma/client";

// Stable ids so re-seeding is an upsert, not a duplicate.
const DEMO_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000010";
const WELCOME_PAGE_ID = "00000000-0000-4000-8000-000000000020";
const GUIDE_PAGE_ID = "00000000-0000-4000-8000-000000000021";
const TASKS_DB_PAGE_ID = "00000000-0000-4000-8000-000000000022";
const STATUS_PROP_ID = "00000000-0000-4000-8000-000000000030";
const DUE_PROP_ID = "00000000-0000-4000-8000-000000000031";
const NAME_PROP_ID = "00000000-0000-4000-8000-000000000032";
const TABLE_VIEW_ID = "00000000-0000-4000-8000-000000000040";
const TASK_ROW_1_ID = "00000000-0000-4000-8000-000000000050";
const TASK_ROW_2_ID = "00000000-0000-4000-8000-000000000051";

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  // Owner: reuse the first existing user if there is one (so the demo workspace
  // shows up for them); otherwise create a deterministic demo user.
  const existingUser = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  const ownerId = existingUser?.id ?? DEMO_USER_ID;
  if (!existingUser) {
    await prisma.user.upsert({
      where: { id: DEMO_USER_ID },
      create: {
        id: DEMO_USER_ID,
        email: "demo@inclination.local",
        displayName: "Demo User",
        emailVerifiedAt: new Date(),
      },
      update: {},
    });
  }

  await prisma.workspace.upsert({
    where: { id: DEMO_WORKSPACE_ID },
    create: { id: DEMO_WORKSPACE_ID, name: "Demo Workspace", icon: "🚀" },
    update: { name: "Demo Workspace" },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: DEMO_WORKSPACE_ID, userId: ownerId } },
    create: { workspaceId: DEMO_WORKSPACE_ID, userId: ownerId, role: "owner" },
    update: { role: "owner" },
  });

  // Two simple document pages.
  await prisma.page.upsert({
    where: { id: WELCOME_PAGE_ID },
    create: {
      id: WELCOME_PAGE_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      type: "document",
      title: "Welcome to Inclination",
      icon: "👋",
      sortKey: "a0",
      createdById: ownerId,
      editedById: ownerId,
    },
    update: { title: "Welcome to Inclination" },
  });
  await prisma.page.upsert({
    where: { id: GUIDE_PAGE_ID },
    create: {
      id: GUIDE_PAGE_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      type: "document",
      title: "Getting Started Guide",
      icon: "📘",
      sortKey: "a1",
      createdById: ownerId,
      editedById: ownerId,
    },
    update: { title: "Getting Started Guide" },
  });

  // A small Tasks database (container page + Database + properties + a table view).
  await prisma.page.upsert({
    where: { id: TASKS_DB_PAGE_ID },
    create: {
      id: TASKS_DB_PAGE_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      type: "database",
      title: "Tasks",
      icon: "✅",
      sortKey: "a2",
      createdById: ownerId,
      editedById: ownerId,
    },
    update: { title: "Tasks" },
  });

  await prisma.database.upsert({
    where: { pageId: TASKS_DB_PAGE_ID },
    create: { pageId: TASKS_DB_PAGE_ID, defaultViewId: TABLE_VIEW_ID },
    update: { defaultViewId: TABLE_VIEW_ID },
  });

  await prisma.property.upsert({
    where: { id: NAME_PROP_ID },
    create: {
      id: NAME_PROP_ID,
      databaseId: TASKS_DB_PAGE_ID,
      name: "Name",
      type: "title",
      order: 0,
      isPrimary: true,
    },
    update: {},
  });
  await prisma.property.upsert({
    where: { id: STATUS_PROP_ID },
    create: {
      id: STATUS_PROP_ID,
      databaseId: TASKS_DB_PAGE_ID,
      name: "Status",
      type: "status",
      order: 1,
      config: {
        options: [
          { id: "todo", name: "To do", color: "gray", group: "todo" },
          { id: "doing", name: "In progress", color: "blue", group: "in_progress" },
          { id: "done", name: "Done", color: "green", group: "complete" },
        ],
      },
    },
    update: {},
  });
  await prisma.property.upsert({
    where: { id: DUE_PROP_ID },
    create: {
      id: DUE_PROP_ID,
      databaseId: TASKS_DB_PAGE_ID,
      name: "Due",
      type: "date",
      order: 2,
    },
    update: {},
  });

  await prisma.view.upsert({
    where: { id: TABLE_VIEW_ID },
    create: {
      id: TABLE_VIEW_ID,
      databaseId: TASKS_DB_PAGE_ID,
      type: "table",
      name: "All tasks",
      order: 0,
    },
    update: {},
  });

  // Two example rows (row pages) with cell values.
  const rows: { id: string; title: string; sortKey: string; status: string; due: string }[] = [
    { id: TASK_ROW_1_ID, title: "Read the getting started guide", sortKey: "a0", status: "todo", due: "2026-06-10" },
    { id: TASK_ROW_2_ID, title: "Invite a teammate", sortKey: "a1", status: "doing", due: "2026-06-12" },
  ];
  for (const row of rows) {
    await prisma.page.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        workspaceId: DEMO_WORKSPACE_ID,
        parentId: TASKS_DB_PAGE_ID,
        type: "row",
        title: row.title,
        sortKey: row.sortKey,
        createdById: ownerId,
        editedById: ownerId,
      },
      update: { title: row.title },
    });
    await prisma.cell.upsert({
      where: { rowPageId_propertyId: { rowPageId: row.id, propertyId: NAME_PROP_ID } },
      create: { rowPageId: row.id, propertyId: NAME_PROP_ID, value: row.title },
      update: { value: row.title },
    });
    await prisma.cell.upsert({
      where: { rowPageId_propertyId: { rowPageId: row.id, propertyId: STATUS_PROP_ID } },
      create: { rowPageId: row.id, propertyId: STATUS_PROP_ID, value: row.status },
      update: { value: row.status },
    });
    await prisma.cell.upsert({
      where: { rowPageId_propertyId: { rowPageId: row.id, propertyId: DUE_PROP_ID } },
      create: { rowPageId: row.id, propertyId: DUE_PROP_ID, value: row.due },
      update: { value: row.due },
    });
  }
}

async function main(): Promise<void> {
  if (process.env.SEED_DEMO !== "true") {
    console.log("SEED_DEMO is not 'true' — skipping demo seed (no-op).");
    return;
  }
  const prisma = new PrismaClient();
  try {
    await seedDemo(prisma);
    console.log("Demo data seeded (idempotent).");
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported by a test).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
