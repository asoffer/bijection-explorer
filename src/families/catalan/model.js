// Core model: the canonical Catalan object is a Dyck path of semilength n.
//
// A Dyck path is represented as an array of steps, each +1 (Up) or -1 (Down),
// of length 2n, with every prefix sum >= 0 and total sum 0.
//
// Every representation renders THIS path. Every highlightable "part" of every
// representation corresponds to one of the n up-steps, indexed 0..n-1 in
// left-to-right order. That integer is the universal highlight key ("pair id"):
// two parts on opposite panels light up together exactly when they share it.

export const U = 1;
export const D = -1;

// ---- validity -------------------------------------------------------------

export function isValidPath(path) {
  let h = 0;
  for (const s of path) {
    h += s;
    if (h < 0) return false;
  }
  return h === 0;
}

export function semilength(path) {
  return path.length / 2;
}

// ---- matching / pair ids --------------------------------------------------

// pairOfStep[i] = the pair id (0-based, in order of up-steps) that step i
// belongs to. An up-step and its matching down-step share a pair id.
// matchOf[i] = index of the step matched to step i.
// openOf[pair] / closeOf[pair] = the path indices of the up- and down-step.
export function analyze(path) {
  const pairOfStep = new Array(path.length);
  const matchOf = new Array(path.length);
  const openOf = [];
  const closeOf = [];
  const stack = []; // entries: { pair, index }
  let counter = 0;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === U) {
      const pair = counter++;
      pairOfStep[i] = pair;
      openOf[pair] = i;
      stack.push({ pair, index: i });
    } else {
      const top = stack.pop();
      pairOfStep[i] = top.pair;
      closeOf[top.pair] = i;
      matchOf[i] = top.index;
      matchOf[top.index] = i;
    }
  }
  return { pairOfStep, matchOf, openOf, closeOf, n: counter };
}

// The subtree rooted at a pair spans a contiguous block of pair ids: the pair
// itself plus every pair nested inside it. Returns [lo, hi] inclusive.
export function subtreeRange(openOf, closeOf, pairId) {
  const inside = (closeOf[pairId] - openOf[pairId] - 1) / 2;
  return [pairId, pairId + inside];
}

// ---- construction helpers -------------------------------------------------

// Swap steps i and i+1 when they form a peak (UD) or valley (DU), staying a
// valid Dyck path. Returns a new path, or null if no valid move exists here.
export function elementaryMove(path, i) {
  if (i < 0 || i + 1 >= path.length) return null;
  const a = path[i];
  const b = path[i + 1];
  if (a === b) return null;
  if (a === D && b === U) {
    const p = path.slice();
    p[i] = U;
    p[i + 1] = D;
    return p; // valley -> peak: always valid
  }
  let hBefore = 0;
  for (let k = 0; k < i; k++) hBefore += path[k];
  if (hBefore < 1) return null; // peak -> valley needs room below
  const p = path.slice();
  p[i] = D;
  p[i + 1] = U;
  return p;
}

// --- size-changing edits (insert / delete one pair) ------------------------

// Insert a peak `UD` at lattice vertex v (0..path.length). Always valid.
export function insertPeak(path, v) {
  return [...path.slice(0, v), U, D, ...path.slice(v)];
}

// Insert a valley `DU` at lattice vertex v. Valid only where the height is >= 1.
export function insertValley(path, v) {
  let h = 0;
  for (let k = 0; k < v; k++) h += path[k];
  if (h < 1) return null;
  return [...path.slice(0, v), D, U, ...path.slice(v)];
}

// Delete an empty pair: a peak `UD` occupying steps i, i+1.
export function deletePeak(path, i) {
  if (path[i] !== U || path[i + 1] !== D) return null;
  return [...path.slice(0, i), ...path.slice(i + 2)];
}

export function staircasePath(n) {
  // UDUDUD... : n separate peaks.
  const p = [];
  for (let i = 0; i < n; i++) p.push(U, D);
  return p;
}

// ---- uniform random sampling ----------------------------------------------
// Exact uniform sampling over Dyck paths of semilength n via step-by-step
// conditional probabilities (reflection principle counts continuations).

const _pascal = (() => {
  const N = 60;
  const C = Array.from({ length: N + 1 }, () => new Array(N + 1).fill(0n));
  for (let i = 0; i <= N; i++) {
    C[i][0] = 1n;
    for (let j = 1; j <= i; j++) C[i][j] = C[i - 1][j - 1] + C[i - 1][j];
  }
  return C;
})();

function choose(n, k) {
  if (k < 0 || k > n || n < 0) return 0n;
  return _pascal[n][k];
}

// Number of paths with `up` up-steps and `down` down-steps remaining that
// start at height `h` and never go below 0.
function continuations(h, up, down) {
  const total = choose(up + down, down);
  const bad = choose(up + down, down - h - 1); // reflect over height -1
  return total - bad;
}

export function randomPath(n, rng = Math.random) {
  const path = [];
  let h = 0;
  let up = n;
  let down = n;
  for (let step = 0; step < 2 * n; step++) {
    const wU = up > 0 ? continuations(h + 1, up - 1, down) : 0n;
    const wD = down > 0 && h > 0 ? continuations(h - 1, up, down - 1) : 0n;
    const totalPaths = wU + wD;
    const r = BigInt(Math.floor(rng() * 1e9));
    const threshold = (wU * 1000000000n) / totalPaths;
    if (r < threshold) {
      path.push(U);
      h += 1;
      up -= 1;
    } else {
      path.push(D);
      h -= 1;
      down -= 1;
    }
  }
  return path;
}
