// Core model: the canonical object is a DOWN-UP alternating permutation of
// [n] = {1,…,n}:
//
//     p_0 > p_1 < p_2 > p_3 < …        (0-based indices)
//
// stored as an array holding the numbers 1..n in that order. These are counted
// by the Euler zigzag numbers 1, 1, 1, 2, 5, 16, 61, 272, … (OEIS A000111).
//
// Every representation renders THIS permutation. The universal highlight key
// ("pair id") is the POSITION index i (0..n-1): element p_i, its matrix dot,
// and its cell in the boustrophedon triangle all share pair id i, so hovering
// one lights its counterparts on the other side.

// ---- validity -------------------------------------------------------------

export function isValid(perm) {
  const n = perm.length;
  if (n === 0) return false;
  const seen = new Array(n + 1).fill(false);
  for (const v of perm) {
    if (!Number.isInteger(v) || v < 1 || v > n || seen[v]) return false;
    seen[v] = true;
  }
  return isAlternating(perm);
}

// Down-up: strict > at even gaps, strict < at odd gaps.
export function isAlternating(perm) {
  for (let i = 0; i + 1 < perm.length; i++) {
    if (i % 2 === 0) {
      if (!(perm[i] > perm[i + 1])) return false;
    } else {
      if (!(perm[i] < perm[i + 1])) return false;
    }
  }
  return true;
}

export function size(perm) {
  return perm.length;
}

// Inbound edits arrive as { type: "set", perm }. This family has no structural
// edit vocabulary of its own — a reroute just carries the resulting permutation
// — so applyEdit simply unwraps it. (Same contract as the Catalan family's
// applyEdit; see ../catalan/edits.js.)
export function applyEdit(perm, edit) {
  return edit && edit.type === "set" ? edit.perm : null;
}

// ---- construction ---------------------------------------------------------

// The canonical "zigzag" permutation: pull alternately from the top and bottom
// of 1..n — n, 1, n-1, 2, … — which is always down-up.
export function zigzag(n) {
  const out = [];
  let lo = 1;
  let hi = n;
  for (let i = 0; i < n; i++) out.push(i % 2 === 0 ? hi-- : lo++);
  return out;
}

// Uniform random down-up alternating permutation. Alternating permutations are
// a constant fraction (~(2/π)^n) of all permutations, so plain rejection over a
// Fisher–Yates shuffle stays cheap for the sizes this family allows.
export function random(n, rng = Math.random) {
  if (n <= 1) return n === 1 ? [1] : [];
  for (;;) {
    const p = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    if (isAlternating(p)) return p;
  }
}
