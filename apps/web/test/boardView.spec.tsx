import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BoardView } from "../src/databases/BoardView";
import { boardDrop } from "../src/databases/boardMove";
import type { Property, QueryGroup, QueryResultRow, View } from "../src/databases/dbTypes";

const props: Property[] = [
  { id: "p1", databaseId: "db1", name: "Name", type: "text", config: {}, order: 0, isPrimary: true },
  {
    id: "status",
    databaseId: "db1",
    name: "Status",
    type: "status",
    config: {
      options: [
        { id: "todo", name: "To do", color: "gray" },
        { id: "done", name: "Done", color: "green" },
      ],
      groups: [],
    },
    order: 1,
    isPrimary: false,
  },
];

const view: View = {
  id: "v1",
  databaseId: "db1",
  type: "board",
  name: "Board",
  order: 0,
  config: { groupBy: "status", visibleProperties: ["p1", "status"] },
};

const rows: QueryResultRow[] = [
  { pageId: "r1", cells: { p1: "Alpha", status: "todo" }, computed: {} },
  { pageId: "r2", cells: { p1: "Beta", status: "done" }, computed: {} },
  { pageId: "r3", cells: { p1: "Gamma", status: "todo" }, computed: {} },
];

const groups: QueryGroup[] = [
  { key: "todo", label: "To do", isEmpty: false, pageIds: ["r1", "r3"] },
  { key: "done", label: "Done", isEmpty: false, pageIds: ["r2"] },
];

describe("BoardView", () => {
  it("groups cards into columns from the query `groups`", () => {
    render(
      <BoardView
        view={view}
        properties={props}
        rows={rows}
        groups={groups}
        groupByPropertyId="status"
        onSetCell={vi.fn()}
      />,
    );
    const todoCol = screen.getByTestId("db-board-col-todo");
    const doneCol = screen.getByTestId("db-board-col-done");
    expect(within(todoCol).getByTestId("db-card-r1")).toBeInTheDocument();
    expect(within(todoCol).getByTestId("db-card-r3")).toBeInTheDocument();
    expect(within(doneCol).getByTestId("db-card-r2")).toBeInTheDocument();
    // A card from the other column is not in the To do column.
    expect(within(todoCol).queryByTestId("db-card-r2")).toBeNull();
  });

  it("a drop onto a column resolves to setting the cell to that option", () => {
    // The board's drag-end delegates to boardDrop; verify the mapping that drives
    // the optimistic onSetCell(rowId, groupBy, value).
    expect(boardDrop("r1", "col:done")).toEqual({ rowId: "r1", value: "done" });
    expect(boardDrop("r1", "col:")).toEqual({ rowId: "r1", value: null });
    expect(boardDrop("r1", null)).toBeNull();
  });
});
