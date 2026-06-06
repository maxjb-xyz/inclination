import type { Property, View } from "./dbTypes";

/**
 * Resolve the ordered, visible properties for a view: honour the saved
 * `visibleProperties` order when present, otherwise fall back to every property
 * in definition order. Unknown ids in the saved list are dropped.
 */
export function visiblePropertiesFor(view: View | undefined, properties: Property[]): Property[] {
  const byId = new Map(properties.map((p) => [p.id, p]));
  const visible = view?.config.visibleProperties;
  if (visible && visible.length > 0) {
    return visible.map((id) => byId.get(id)).filter((p): p is Property => Boolean(p));
  }
  return properties;
}

/** The primary property (first isPrimary, else first property). */
export function primaryProperty(properties: Property[]): Property | undefined {
  return properties.find((p) => p.isPrimary) ?? properties[0];
}
