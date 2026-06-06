import { randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { describe, expect, it } from "vitest";
import { TokenService } from "../src/auth/token.service";
import type { AppConfig } from "../src/config/app-config";
import type { PrismaService } from "../src/prisma/prisma.service";

/** Minimal in-memory stand-in for the slice of PrismaService TokenService uses. */
function fakePrisma(users: { id: string; email: string }[]) {
  type Row = {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
    replacedById: string | null;
  };
  const rows: Row[] = [];
  return {
    store: rows,
    refreshToken: {
      create: async ({ data }: { data: Omit<Row, "id" | "revokedAt" | "replacedById"> }) => {
        const row: Row = { id: randomUUID(), revokedAt: null, replacedById: null, ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where: { tokenHash } }: { where: { tokenHash: string } }) =>
        rows.find((r) => r.tokenHash === tokenHash) ?? null,
      update: async ({ where: { id }, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { tokenHash?: string; userId?: string; revokedAt?: null };
        data: Partial<Row>;
      }) => {
        let count = 0;
        for (const r of rows) {
          if (where.tokenHash !== undefined && r.tokenHash !== where.tokenHash) continue;
          if (where.userId !== undefined && r.userId !== where.userId) continue;
          if (where.revokedAt === null && r.revokedAt !== null) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      },
    },
    user: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        users.find((u) => u.id === id) ?? null,
    },
  };
}

function makeService(prisma: ReturnType<typeof fakePrisma>, refreshTtlSec = 1000): TokenService {
  const jwt = new JwtService({ secret: "test-secret", signOptions: { expiresIn: 900 } });
  const config = { refreshTtlSec, jwtAccessSecret: "test-secret", accessTtlSec: 900 } as AppConfig;
  return new TokenService(jwt, prisma as unknown as PrismaService, config);
}

const user = { id: "u1", email: "a@b.com" };

describe("TokenService access tokens", () => {
  it("issues an access token that verifies and carries the subject", () => {
    const svc = makeService(fakePrisma([user]));
    const token = svc.issueAccess(user);
    expect(svc.verifyAccess(token).sub).toBe("u1");
    expect(svc.verifyAccess(token).email).toBe("a@b.com");
  });

  it("rejects a tampered token", () => {
    const svc = makeService(fakePrisma([user]));
    expect(() => svc.verifyAccess("garbage")).toThrow();
  });
});

describe("TokenService refresh rotation", () => {
  it("rotates: the old token becomes invalid and the new one works", async () => {
    const prisma = fakePrisma([user]);
    const svc = makeService(prisma);
    const first = await svc.issueRefresh(user.id);

    const rotated = await svc.rotate(first);
    expect(rotated.refreshToken).not.toBe(first);
    expect(svc.verifyAccess(rotated.accessToken).sub).toBe("u1");

    // The new token rotates again fine.
    const again = await svc.rotate(rotated.refreshToken);
    expect(again.refreshToken).not.toBe(rotated.refreshToken);
  });

  it("treats reuse of a rotated token as theft and revokes the whole chain", async () => {
    const prisma = fakePrisma([user]);
    const svc = makeService(prisma);
    const first = await svc.issueRefresh(user.id);
    const rotated = await svc.rotate(first);

    // Reusing `first` (already rotated) must fail...
    await expect(svc.rotate(first)).rejects.toThrow();
    // ...and must also invalidate the live token issued from it.
    await expect(svc.rotate(rotated.refreshToken)).rejects.toThrow();
    expect(prisma.store.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it("rejects an unknown token", async () => {
    const svc = makeService(fakePrisma([user]));
    await expect(svc.rotate("nope")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const prisma = fakePrisma([user]);
    const svc = makeService(prisma);
    const token = await svc.issueRefresh(user.id);
    prisma.store[0]!.expiresAt = new Date(Date.now() - 1000);
    await expect(svc.rotate(token)).rejects.toThrow();
  });

  it("logout revokes the presented token so it can't rotate", async () => {
    const prisma = fakePrisma([user]);
    const svc = makeService(prisma);
    const token = await svc.issueRefresh(user.id);
    await svc.revoke(token);
    await expect(svc.rotate(token)).rejects.toThrow();
  });
});
