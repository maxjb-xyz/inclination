/**
 * Trigger a client-side download of a Markdown export.
 *
 * Builds a Blob from the markdown text and clicks a synthetic anchor with the
 * server-provided filename. Kept tiny + injectable (the anchor click is the only
 * DOM side effect) so it works in jsdom under test without a real download.
 */
export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "page.md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
