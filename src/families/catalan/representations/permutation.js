import { U, analyze, subtreeRange } from "../model.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import {
  makeRegistry,
  register,
  applyHighlight,
  makeInteractive,
  makeAffordButton,
  showAffordButton,
  hideAffordButton,
  tween,
} from "../../../core/view.js";

export const meta = {
  id: "perm",
  name: "312-avoiding permutation",
  blurb:
    "Read the path as stack operations — up = push the next value, down = pop and output. Feeding 1,2,…,n through one stack yields exactly the 312-avoiding permutations. Swap neighbours with a caret, hover a column gap to insert a value, or a push-then-pop point to remove it.",
};

// Dyck path -> permutation (output of one stack fed the input 1..n).
function permutationFromPath(path) {
  const stack = [];
  const out = [];
  let input = 1;
  for (const s of path) {
    if (s === U) stack.push(input++);
    else out.push(stack.pop());
  }
  return out; // out[i] = value at position i; value v was the v-th push
}

// permutation -> Dyck path, or null if not stack-realizable (i.e. contains 312).
function pathFromPermutation(perm) {
  const n = perm.length;
  const stack = [];
  const path = [];
  let input = 1;
  for (let idx = 0; idx < n; idx++) {
    const target = perm[idx];
    while (stack.length === 0 || stack[stack.length - 1] !== target) {
      if (input > n) return null;
      stack.push(input++);
      path.push(U);
    }
    stack.pop();
    path.push(-1);
  }
  return path;
}

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let box = null;
  let geom = null;
  let plus = null;
  let minus = null;
  let reshape = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    registry.clear();
    currentEls = [];
    const perm = permutationFromPath(path);
    const n = perm.length;
    const { openOf, closeOf } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    // posOf[value] = output position of that value
    const posOf = [];
    perm.forEach((v, i) => (posOf[v] = i));
    const downIdx = [];
    path.forEach((s, i) => s === -1 && downIdx.push(i));

    const unit = 38;
    const pad = 30;
    const W = Math.max(n, 1) * unit + pad * 2;
    const H = Math.max(n, 1) * unit + pad * 2;
    const X = (i) => pad + i * unit + unit / 2;
    const Y = (v) => pad + (n - v) * unit + unit / 2;
    geom = { X, Y, unit, pad, n, W, perm, posOf, openOf, closeOf, downIdx, path };

    const next = makeSvg(`0 0 ${W} ${H}`);

    // light grid
    for (let i = 0; i <= n; i++) {
      next.appendChild(
        svgEl("line", { x1: pad + i * unit, y1: pad, x2: pad + i * unit, y2: H - pad, class: "grid" })
      );
      next.appendChild(
        svgEl("line", { x1: pad, y1: pad + i * unit, x2: W - pad, y2: pad + i * unit, class: "grid" })
      );
    }

    // bounding box for the hovered subtree (hidden until hover)
    box = svgEl("rect", { class: "range-band", rx: 8, ry: 8 });
    next.appendChild(box);

    // permutation points (i, value)
    const groupEls = [];
    for (let i = 0; i < n; i++) {
      const v = perm[i];
      const g = svgEl("g", { class: "permpt" });
      const dot = svgEl("circle", { cx: X(i), cy: Y(v), r: 11, class: "permdot" });
      const label = svgEl("text", {
        x: X(i),
        y: Y(v),
        class: "permlabel",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = String(v);
      g.appendChild(dot);
      g.appendChild(label);
      register(registry, v - 1, g);
      makeInteractive(g, v - 1, callbacks, null);
      next.appendChild(g);
      groupEls.push(g);
    }

    plus = makeAffordButton("grow", "+");
    minus = makeAffordButton("shrink", "−");
    reshape = svgEl("circle", { r: 6, class: "afford-reshape", visibility: "hidden" });
    next.appendChild(plus);
    next.appendChild(minus);
    next.appendChild(reshape);
    next.addEventListener("pointermove", updateAfford);
    next.addEventListener("pointerleave", hideAfford);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    const swap = opts.animate && opts.edit && opts.edit.type === "swap" && opts.prevPath;
    if (swap) animateSwap(permutationFromPath(opts.prevPath), perm, geom.Y, groupEls);
  }

  // A swap exchanges the values sitting in two columns. Each column's x is
  // fixed, so slide the two affected dots vertically from their old value-height
  // to their new one — they trade places up/down.
  function animateSwap(oldPerm, perm, Y, groupEls) {
    const moves = [];
    for (let i = 0; i < perm.length; i++) {
      if (oldPerm[i] !== perm[i]) moves.push({ g: groupEls[i], dy: Y(oldPerm[i]) - Y(perm[i]) });
    }
    if (!moves.length) return;
    for (const m of moves) m.g.setAttribute("transform", `translate(0,${m.dy})`);
    cancelAnim = tween(
      360,
      (e) => {
        for (const m of moves) m.g.setAttribute("transform", `translate(0,${m.dy * (1 - e)})`);
      },
      () => {
        for (const m of moves) m.g.removeAttribute("transform");
        cancelAnim = null;
      }
    );
  }

  function hideAfford() {
    hideAffordButton(plus);
    hideAffordButton(minus);
    reshape.style.visibility = "hidden";
    reshape.onclick = null;
  }

  // Hover a point that can be removed (a value pushed then popped at once) for
  // a "−"; otherwise offer a "+" at the nearest column gap to insert a value,
  // plus a reshape handle below it when swapping the two columns stays valid.
  function updateAfford(e) {
    if (!geom) return;
    const { X, Y, unit, pad, n, W, perm, openOf, closeOf, downIdx, path } = geom;
    const rect = svg.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    const vby = ((e.clientY - rect.top) / rect.height) * W; // viewBox is square
    hideAfford();

    const i = Math.max(0, Math.min(n - 1, Math.floor((vbx - pad) / unit)));
    const v = perm[i];
    if (v !== undefined && closeOf[v - 1] === openOf[v - 1] + 1) {
      const dist = Math.hypot(vbx - X(i), vby - Y(v));
      if (dist < unit * 0.6) {
        showAffordButton(minus, X(i), Y(v) - 18, callbacks.onEdit, () => ({
          type: "delete",
          at: openOf[v - 1],
        }));
        return;
      }
    }
    const g = Math.max(0, Math.min(n, Math.round((vbx - pad) / unit)));
    showAffordButton(plus, pad + g * unit, pad - 13, callbacks.onEdit, () => ({
      type: "insert",
      kind: "peak",
      at: g < n ? downIdx[g] : path.length,
    }));

    if (g >= 1 && g <= n - 1) {
      const swapped = perm.slice();
      [swapped[g - 1], swapped[g]] = [swapped[g], swapped[g - 1]];
      const moved = pathFromPermutation(swapped);
      if (moved) {
        reshape.setAttribute("cx", pad + g * unit);
        reshape.setAttribute("cy", pad + n * unit + 13);
        reshape.style.visibility = "visible";
        reshape.onclick = (ev) => {
          ev.stopPropagation();
          callbacks.onEdit({ type: "set", path: moved });
        };
      }
    }
  }

  function showBox(range) {
    if (!box || !geom) return;
    if (!range) {
      box.classList.remove("on");
      return;
    }
    const [lo, hi] = range;
    // values lo+1..hi+1 occupy a contiguous position block; box their extent
    let pmin = Infinity;
    let pmax = -Infinity;
    for (let v = lo + 1; v <= hi + 1; v++) {
      const p = geom.posOf[v];
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
    }
    const m = geom.unit * 0.45;
    const left = geom.X(pmin) - m;
    const right = geom.X(pmax) + m;
    const top = geom.Y(hi + 1) - m; // largest value -> smallest y
    const bottom = geom.Y(lo + 1) + m;
    box.setAttribute("x", left);
    box.setAttribute("y", top);
    box.setAttribute("width", right - left);
    box.setAttribute("height", bottom - top);
    box.classList.add("on");
  }

  return {
    setPath,
    highlight(pairId) {
      const range = pairId === null || pairId === undefined ? null : rangeOf[pairId];
      currentEls = applyHighlight(registry, currentEls, range);
      showBox(range);
    },
    destroy() {
      if (svg) svg.remove();
    },
  };
}
