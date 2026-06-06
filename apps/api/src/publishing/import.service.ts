import { Injectable } from "@nestjs/common";
import type { ImportMarkdownInput } from "@inclination/shared";
import type { Prisma } from "@inclination/db";
import { splitMarkdownIntoTree, type ImportedPageNode } from "@inclination/editor";
import { generateKeyBetween } from "fractional-indexing";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

export interface CreatedPageNode {
  id: string;
  title: string;
  children: CreatedPageNode[];
}

/**
 * Phase 8 — Markdown import (spec §8 gate: "a Markdown file imports into a page
 * tree"). Requires workspace membership. Parses the Markdown into a page tree
 * (each top-level `#` H1 → a child page; see `splitMarkdownIntoTree`) and seeds
 * each page's `PageContent.doc` with the ProseMirror-JSON body. The Yjs body
 * (`ydocState`) is left null: the collaborative editor hydrates from `doc` on
 * first open and Yjs becomes authoritative thereafter (the same back-compat path
 * the rest of the app uses for `doc`-seeded pages).
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async importMarkdown(
    userId: string,
    workspaceId: string,
    input: ImportMarkdownInput,
  ): Promise<CreatedPageNode> {
    await this.workspaces.requireMember(userId, workspaceId);
    const tree = splitMarkdownIntoTree(input.filename, input.markdown);
    return this.createPageTree(userId, workspaceId, null, tree, generateKeyBetween(null, null));
  }

  /**
   * Recursively create a page (+ seeded content) and its children, returning the
   * nested `{ id, title, children }` tree. Siblings get ascending fractional-index
   * sort keys generated left-to-right.
   */
  private async createPageTree(
    userId: string,
    workspaceId: string,
    parentId: string | null,
    node: ImportedPageNode,
    sortKey: string,
  ): Promise<CreatedPageNode> {
    const page = await this.prisma.page.create({
      data: {
        workspaceId,
        parentId,
        type: "document",
        title: node.title,
        sortKey,
        createdById: userId,
        editedById: userId,
        content: { create: { doc: node.doc as Prisma.InputJsonValue } },
      },
    });

    const children: CreatedPageNode[] = [];
    let prevKey: string | null = null;
    for (const child of node.children) {
      prevKey = generateKeyBetween(prevKey, null);
      children.push(await this.createPageTree(userId, workspaceId, page.id, child, prevKey));
    }

    return { id: page.id, title: page.title, children };
  }
}
