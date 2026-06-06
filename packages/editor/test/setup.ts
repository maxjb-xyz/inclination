// jsdom does not implement layout, so ProseMirror's selection/scroll machinery
// (coordsAtPos -> getClientRects/getBoundingClientRect) throws when a Tiptap
// transaction is dispatched. Provide inert stubs so editor tests can drive real
// edits without crashing.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (!Element.prototype.getClientRects) {
  Element.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
