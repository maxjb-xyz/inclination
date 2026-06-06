import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TableView } from "../src/databases/TableView";
import type { Property, QueryResultRow, View } from "../src/databases/dbTypes";

const props: Property[] = [
  { id: "p1", databaseId: "db1", name: "Name", type: "text", config: {}, order: 0, isPrimary: true },
  { id: "p2", databaseId: "db1", name: "Done", type: "checkbox", config: {}, order: 1, isPrimary: false },
  { id: "p3", databaseId: "db1", name: "Total", type: "rollup", config: { relationPropertyId: "x", targetPropertyId: "y", aggregation: "sum" }, order: 2, isPrimary: false },
];

const view: View = {
  id: "v1",
  databaseId: "db1",
  type: "table",
  name: "Table",
  order: 0,
  config: { visibleProperties: ["p1", "p2", "p3"] },
};

const rows: QueryResultRow[] = [
  { pageId: "r1", cells: { p1: "Alpha", p2: true }, computed: { p3: 42 } },
  { pageId: "r2", cells: { p1: "Beta", p2: false }, computed: { p3: 7 } },
];

describe("TableView", () => {
  it("renders rows and cells from the query result, computed cells read-only", () => {
    render(
      <TableView
        view={view}
        properties={props}
        rows={rows}
        onSetCell={vi.fn()}
        onAddRow={vi.fn()}
        onAddProperty={vi.fn()}
      />,
    );
    // Two data rows.
    expect(screen.getByTestId("db-row-r1")).toBeInTheDocument();
    expect(screen.getByTestId("db-row-r2")).toBeInTheDocument();
    // Text cell editor carries the value.
    const textInputs = screen.getAllByLabelText("Name") as HTMLInputElement[];
    expect(textInputs[0]?.value).toBe("Alpha");
    // Computed rollup rendered read-only.
    expect(screen.getByTestId("db-cell-r1-p3")).toHaveTextContent("42");
  });

  it("editing a text cell calls onSetCell on blur", () => {
    const onSetCell = vi.fn();
    render(
      <TableView
        view={view}
        properties={props}
        rows={rows}
        onSetCell={onSetCell}
        onAddRow={vi.fn()}
        onAddProperty={vi.fn()}
      />,
    );
    const input = screen.getAllByLabelText("Name")[0]!;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(onSetCell).toHaveBeenCalledWith("r1", "p1", "Renamed");
  });

  it("toggling a checkbox cell calls onSetCell immediately", () => {
    const onSetCell = vi.fn();
    render(
      <TableView
        view={view}
        properties={props}
        rows={rows}
        onSetCell={onSetCell}
        onAddRow={vi.fn()}
        onAddProperty={vi.fn()}
      />,
    );
    const checkboxes = screen.getAllByLabelText("Done") as HTMLInputElement[];
    // Row 2 is currently false → toggling sets true.
    fireEvent.click(checkboxes[1]!);
    expect(onSetCell).toHaveBeenCalledWith("r2", "p2", true);
  });

  it("add-row and add-property buttons fire their callbacks", () => {
    const onAddRow = vi.fn();
    const onAddProperty = vi.fn();
    render(
      <TableView
        view={view}
        properties={props}
        rows={rows}
        onSetCell={vi.fn()}
        onAddRow={onAddRow}
        onAddProperty={onAddProperty}
      />,
    );
    fireEvent.click(screen.getByTestId("db-add-row"));
    fireEvent.click(screen.getByTestId("db-add-property"));
    expect(onAddRow).toHaveBeenCalled();
    expect(onAddProperty).toHaveBeenCalled();
  });
});
