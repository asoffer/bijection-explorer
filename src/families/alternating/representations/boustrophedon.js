import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeRegistry, register, applyHighlight, makeInteractive } from "../../../core/view.js";

export const meta = {
  id: "boustro",
  name: "Boustrophedon path",
  blurb:
    "A path down the Seidel–Entringer–Arnold triangle — the array behind the boustrophedon transform whose corner entries are the zigzag numbers. Each row is counted from the opposite side, the way an ox plows; the path drops into a row then follows its arrow to the chosen cell. Hover a row and click to redraw the path — the permutation follows.",
};

// Alternating permutation <-> boustrophedon path.
//
// A path is a reading index per row: js[k] is how far along row k's arrow the
// path's cell sits (0 = the arrow's start). js[0]=0 (the apex). Peeling the
// permutation from the front gives these indices: at step s, r is the rank of
// the peeled term among those left, read from the left on even steps and the
// right on odd steps (the boustrophedon reversal). Row k holds peel step
// s = (n-1)-k. This map is a bijection onto down-up alternating permutations
// (verified against A000111).
function permToCols(perm) {
  const n = perm.length;
  const cur = perm.slice();
  const code = [];
  let s = 0;
  while (cur.length) {
    const m = cur.length;
    let r = 0;
    for (let j = 1; j < m; j++) if (cur[j] < cur[0]) r++;
    code.push(s % 2 === 0 ? r : m - 1 - r);
    cur.shift();
    s++;
  }
  return code.map((_, k) => code[n - 1 - k]); // js[k] = code[(n-1)-k]
}

// Inverse: replay the reading indices back into the permutation (values 1..n).
function colsToPerm(js) {
  const n = js.length;
  const remaining = Array.from({ length: n }, (_, i) => i);
  const perm = [];
  for (let s = 0; s < n; s++) {
    const idx = js[n - 1 - s]; // code[s]
    const m = remaining.length;
    const r = s % 2 === 0 ? idx : m - 1 - idx;
    perm.push(remaining[r] + 1);
    remaining.splice(r, 1);
  }
  return perm;
}

// Legal reading indices for row k+1 given row k sits at index a: [(k+1)-a, k+1].
// (Verified: these transitions generate exactly the alternating permutations.)
function allowedNext(k, a) {
  return [k + 1 - a, k + 1];
}

// Reroute through (row k, index j), keeping rows above and clamping the rows
// below back into their legal ranges. Always yields a legal path.
function setAndClamp(js, k, j) {
  const nj = js.slice();
  nj[k] = j;
  for (let i = k + 1; i < nj.length; i++) {
    const [lo, hi] = allowedNext(i - 1, nj[i - 1]);
    nj[i] = Math.max(lo, Math.min(hi, js[i]));
  }
  return nj;
}

// Row k is read left→right when k is even, right→left when odd. The geometric
// column (left-aligned grid) counts from the arrow's start, so it flips per row.
const readsLTR = (k) => k % 2 === 0;
const colOf = (k, j) => (readsLTR(k) ? j : k - j);

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let geom = null; // { x, y, rowH, padTop, W, H, n, js }
  let cands = null; // <g> holding hover-revealed candidate rings + preview
  let preview = null; // staircase preview of the reroute under the cursor

  // Drop-then-slide staircase through the given reading indices: from each node
  // fall straight down (holding its x) into the next row, then slide across to
  // that row's node (always in the row's arrow direction).
  function stairPoints(js, x, y) {
    const nx = (k) => x(k, colOf(k, js[k]));
    const pts = [`${nx(0)},${y(0)}`];
    for (let k = 1; k < js.length; k++) {
      pts.push(`${nx(k - 1)},${y(k)}`); // vertical drop
      pts.push(`${nx(k)},${y(k)}`); // slide along row k's arrow
    }
    return pts.join(" ");
  }

  function setPath(perm) {
    registry.clear();
    currentEls = [];
    const n = perm.length;
    const js = permToCols(perm);

    const cellStep = 40; // horizontal spacing between adjacent cells
    const rowH = 44; // vertical spacing between rows
    const padX = 30;
    const padTop = 24;
    const padBot = 22;
    const W = Math.max((n - 1) * cellStep, 0) + padX * 2;
    const H = Math.max(n - 1, 0) * rowH + padTop + padBot;
    const centerX = W / 2;

    // Centred (equilateral) layout: row k is symmetric about the axis. The drop
    // holds the upper node's x, so it stays vertical even though rows interleave.
    const x = (k, c) => centerX + (c - k / 2) * cellStep;
    const y = (k) => padTop + k * rowH;
    geom = { x, y, rowH, padTop, W, H, n, js };

    const next = makeSvg(`0 0 ${W} ${H}`);

    // Each row: a reading guide with an arrowhead at its far (reading) end, and
    // faint lattice dots for every cell.
    for (let k = 0; k < n; k++) {
      if (k >= 1) {
        const yy = y(k);
        next.appendChild(svgEl("line", { x1: x(k, 0), y1: yy, x2: x(k, k), y2: yy, class: "boustro-row" }));
        const ltr = readsLTR(k);
        const tipX = ltr ? x(k, k) : x(k, 0);
        const dir = ltr ? -1 : 1; // arrowhead opens back from the tip
        next.appendChild(
          svgEl("path", { d: `M ${tipX} ${yy} l ${dir * 7} ${-4} l 0 8 z`, class: "boustro-arrow" })
        );
      }
      for (let c = 0; c <= k; c++) {
        next.appendChild(svgEl("circle", { cx: x(k, c), cy: y(k), r: 2.6, class: "boustro-cell" }));
      }
    }

    // The permutation's path as a boustrophedon staircase.
    if (n >= 2) {
      next.appendChild(svgEl("polyline", { points: stairPoints(js, x, y), class: "boustro-path" }));
    }

    // Hover-revealed editing layer, drawn under the nodes.
    cands = svgEl("g", { class: "boustro-cands" });
    preview = svgEl("polyline", { class: "boustro-preview", visibility: "hidden" });
    cands.appendChild(preview);
    next.appendChild(cands);

    // Chosen nodes, labelled with term p_s (pair id = position s = (n-1)-k).
    for (let k = 0; k < n; k++) {
      const s = n - 1 - k;
      const cx = x(k, colOf(k, js[k]));
      const cy = y(k);
      const g = svgEl("g", { class: "boustro-node interactive" });
      g.appendChild(svgEl("circle", { cx, cy, r: 12, class: "boustro-dot" }));
      const label = svgEl("text", {
        x: cx,
        y: cy,
        class: "boustro-num",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = String(perm[s]);
      g.appendChild(label);
      register(registry, s, g);
      makeInteractive(g, s, callbacks, null);
      next.appendChild(g);
    }

    next.addEventListener("pointermove", onMove);
    next.addEventListener("pointerleave", clearCands);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
  }

  function clearCands() {
    if (!cands) return;
    for (const el of [...cands.children]) if (el !== preview) el.remove();
    if (preview) preview.style.visibility = "hidden";
  }

  // Show the legal cells for the row nearest the cursor; each is clickable and
  // previews the resulting reroute on hover.
  function onMove(e) {
    if (!geom || !svg) return;
    const { x, y, rowH, padTop, H, n, js } = geom;
    clearCands();
    const rect = svg.getBoundingClientRect();
    const vby = ((e.clientY - rect.top) / rect.height) * H;
    const k = Math.round((vby - padTop) / rowH);
    if (k < 1 || k > n - 1) return; // apex is fixed; nothing to edit off-triangle

    const [lo, hi] = allowedNext(k - 1, js[k - 1]);
    for (let j = lo; j <= hi; j++) {
      if (j === js[k]) continue; // already the current node
      const ring = svgEl("circle", { cx: x(k, colOf(k, j)), cy: y(k), r: 12, class: "boustro-cand" });
      const rerouted = setAndClamp(js, k, j);
      ring.addEventListener("pointerenter", () => {
        preview.setAttribute("points", stairPoints(rerouted, x, y));
        preview.style.visibility = "visible";
      });
      ring.addEventListener("pointerleave", () => (preview.style.visibility = "hidden"));
      ring.addEventListener("click", (ev) => {
        ev.stopPropagation();
        callbacks.onEdit({ type: "set", perm: colsToPerm(rerouted) });
      });
      cands.appendChild(ring);
    }
  }

  return {
    setPath,
    highlight(pairId) {
      const range = pairId === null || pairId === undefined ? null : [pairId, pairId];
      currentEls = applyHighlight(registry, currentEls, range);
    },
    destroy() {
      if (svg) svg.remove();
    },
  };
}
