// The alternating-permutation family: three renderings of one canonical object,
// a down-up alternating permutation of [n]. Same descriptor shape as the
// Catalan family — see ../catalan/index.js.

import { random, zigzag, size, isValid, applyEdit } from "./model.js";

import * as list from "./representations/list.js";
import * as matrix from "./representations/matrix.js";
import * as boustro from "./representations/boustrophedon.js";

export const family = {
  id: "alternating",
  name: "Alternating permutations",
  tagline:
    'The <a href="https://oeis.org/A000111">Euler zigzag numbers</a> count the ' +
    "alternating permutations — those whose values rise and fall in strict " +
    "turn. Here the same permutation is shown three ways. Hover a term to see " +
    "its counterpart light up.",
  resetLabel: "Zigzag",

  model: {
    random, // random(n) -> a fresh alternating permutation of size n
    reset: zigzag, // reset(n)  -> the canonical zigzag permutation
    size, // size(perm) -> n
    isValid, // guards inbound edits
    applyEdit, // applyEdit(perm, edit) -> next perm | null
    minSize: 1,
    maxSize: 10,
  },

  representations: [list, matrix, boustro],

  defaults: { size: 5, left: "list", right: "boustro" },
};
