// The Catalan family: a set of representations that are all renderings of one
// canonical object (a Dyck path of semilength n), so any two can be paired.
//
// This module is the family DESCRIPTOR — the contract the app shell drives.
// A new object family (set partitions, Motzkin paths, …) is added by dropping a
// sibling directory that exports the same shape and registering it in
// ../../registry.js. Nothing in the app shell is Catalan-specific.

import { randomPath, staircasePath, isValidPath, semilength } from "./model.js";

import * as dyck from "./representations/dyckpath.js";
import * as parens from "./representations/parens.js";
import * as tree from "./representations/binarytree.js";
import * as planetree from "./representations/planetree.js";
import * as triangulation from "./representations/triangulation.js";
import * as chords from "./representations/chords.js";
import * as perm from "./representations/permutation.js";
import * as syt from "./representations/syt.js";

export const family = {
  id: "catalan",
  name: "Catalan objects",

  // Everything the shell needs to drive the shared object, independent of what
  // the object actually is.
  model: {
    random: randomPath, // random(n) -> a fresh object of size n
    reset: staircasePath, // reset(n)  -> the canonical/"identity" object of size n
    size: semilength, // size(obj) -> n
    isValid: isValidPath, // isValid(obj) -> bool, guards inbound edits
    minSize: 1,
    maxSize: 12,
  },

  // Order here is the order shown in the dropdowns.
  representations: [dyck, parens, tree, planetree, triangulation, chords, perm, syt],

  // Which representations each panel starts on, and the initial size.
  defaults: { size: 5, left: "dyck", right: "tree" },
};
