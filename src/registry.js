// Registry of object families. Add a family by importing its descriptor
// (families/<name>/index.js) and appending it here.
//
// The app currently drives a single active family; multi-family selection can
// be layered on top later without touching the families themselves.

import { family as catalan } from "./families/catalan/index.js";

export const FAMILIES = [catalan];

// The family the app is currently exploring.
export const activeFamily = FAMILIES[0];

// Representations of the active family, keyed by id (for the panel dropdowns).
export const BY_ID = Object.fromEntries(
  activeFamily.representations.map((r) => [r.meta.id, r])
);
