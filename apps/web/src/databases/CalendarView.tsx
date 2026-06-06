import type { DateValue, Property, QueryResultRow, View } from "./dbTypes";
import { formatCellValue } from "./cellHelpers";
import { primaryProperty } from "./viewHelpers";

export interface CalendarViewProps {
  view: View;
  properties: Property[];
  rows: QueryResultRow[];
  /** The date property rows are placed by. */
  datePropertyId: string;
  /** Anchor month; defaults to the current month. */
  month?: Date;
}

interface DayCell {
  date: Date | null;
  iso: string;
}

/** Build a 6×7 month grid (leading/trailing blanks) for the given anchor month. */
function monthGrid(anchor: Date): DayCell[] {
  const year = anchor.getFullYear();
  const monthIdx = anchor.getMonth();
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const startWeekday = first.getUTCDay();
  const cells: DayCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null, iso: `blank-lead-${i}` });
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(Date.UTC(year, monthIdx, d));
    cells.push({ date, iso: date.toISOString().slice(0, 10) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, iso: `blank-trail-${cells.length}` });
  return cells;
}

/**
 * Month-grid calendar placing rows on the day of their date property (`start`,
 * date portion only). Rows without a date are omitted. Simple, read-only layout.
 */
export function CalendarView({
  properties,
  rows,
  datePropertyId,
  month = new Date(),
}: CalendarViewProps): React.ReactElement {
  const primary = primaryProperty(properties);
  const grid = monthGrid(month);

  const byDay = new Map<string, QueryResultRow[]>();
  for (const row of rows) {
    const value = row.cells[datePropertyId] as DateValue | null | undefined;
    if (!value || !value.start) continue;
    const day = value.start.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(row);
    byDay.set(day, list);
  }

  const monthLabel = month.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="db-calendar" data-testid="db-calendar">
      <div className="db-calendar__title">{monthLabel}</div>
      <div className="db-calendar__grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="db-calendar__weekday">
            {d}
          </div>
        ))}
        {grid.map((cell) => (
          <div
            key={cell.iso}
            className={`db-calendar__day${cell.date ? "" : " db-calendar__day--blank"}`}
            data-testid={cell.date ? `db-calendar-day-${cell.iso}` : undefined}
          >
            {cell.date ? <div className="db-calendar__daynum">{cell.date.getUTCDate()}</div> : null}
            {cell.date
              ? (byDay.get(cell.iso) ?? []).map((row) => (
                  <div key={row.pageId} className="db-calendar__event" data-testid={`db-calendar-event-${row.pageId}`}>
                    {primary
                      ? formatCellValue(primary, row.cells[primary.id] ?? null) || "Untitled"
                      : "Untitled"}
                  </div>
                ))
              : null}
          </div>
        ))}
      </div>
    </div>
  );
}
