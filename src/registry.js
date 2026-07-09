// Registry of object families. Add a family by importing its descriptor
// (families/<name>/index.js) and appending it here; the app shell renders a
// switcher over FAMILIES and drives whichever one is active.

import { family as catalan } from "./families/catalan/index.js";
import { family as alternating } from "./families/alternating/index.js";

export const FAMILIES = [catalan, alternating];

// Representations of a family, keyed by id (for the panel dropdowns).
export function byId(family) {
  return Object.fromEntries(family.representations.map((r) => [r.meta.id, r]));
}
