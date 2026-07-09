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
    // A size-changing edit animates inside a frame big enough for both the old
    // and new grids; the viewBox pans onto the new one and we settle afterwards.
    const oldPerm =
      opts.animate && opts.edit && opts.prevPath && (opts.edit.type === "insert" || opts.edit.type === "remove")
        ? permutationFromPath(opts.prevPath)
        : null;
    const frameN = oldPerm ? Math.max(n, oldPerm.length) : n;
    const W = Math.max(n, 1) * unit + pad * 2;
    const H = Math.max(n, 1) * unit + pad * 2;
    const gridPx = frameN * unit + pad * 2;
    const X = (i) => pad + i * unit + unit / 2;
    const Y = (v) => pad + (frameN - v) * unit + unit / 2; // value height in the shared frame
    const cropVB = (m) => `0 ${(frameN - m) * unit} ${m * unit + pad * 2} ${m * unit + pad * 2}`;
    geom = { X, Y, unit, pad, n, W, perm, posOf, openOf, closeOf, downIdx, path };

    const next = makeSvg(`0 0 ${W} ${H}`);

    // light grid, sized to the frame
    for (let i = 0; i <= frameN; i++) {
      next.appendChild(
        svgEl("line", { x1: pad + i * unit, y1: pad, x2: pad + i * unit, y2: gridPx - pad, class: "grid" })
      );
      next.appendChild(
        svgEl("line", { x1: pad, y1: pad + i * unit, x2: gridPx - pad, y2: pad + i * unit, class: "grid" })
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

    // Grow / shrink by one value. Inserting or removing a value both relabels
    // (values past it shift by one) and resizes the grid, so match dots by value:
    // each survivor slides from where its value used to sit to its new column and
    // row, the newcomer pops in, and the removed value fades out as a ghost.
    function animateResize(edit) {
      const oldN = oldPerm.length;
      const grow = edit.type === "insert";
      const posOld = [];
      oldPerm.forEach((v, i) => (posOld[v] = i));
      const uStep = edit.kind === "valley" ? edit.at + 1 : edit.at;
      const src = grow ? path : opts.prevPath;
      const { matchOf } = analyze(src);
      let outPos = 0;
      for (let i = 0; i < matchOf[uStep]; i++) if (src[i] === -1) outPos++;
      const k = grow ? perm[outPos] : oldPerm[outPos]; // the value that appears / disappears
      const lerp = (a, b, e) => a + (b - a) * e;

      const specs = [];
      for (let i = 0; i < perm.length; i++) {
        if (grow && i === outPos) {
          specs.push({ g: groupEls[i], enter: true });
          continue;
        }
        const w = perm[i];
        const ov = grow ? (w < k ? w : w - 1) : w < k ? w : w + 1;
        const op = posOld[ov];
        specs.push({ g: groupEls[i], sx: X(op), sy: Y(ov), ex: X(i), ey: Y(w) });
      }

      let ghost = null;
      if (!grow) {
        ghost = svgEl("g", { class: "permpt" });
        ghost.appendChild(svgEl("circle", { cx: X(outPos), cy: Y(k), r: 11, class: "permdot" }));
        const lbl = svgEl("text", {
          x: X(outPos),
          y: Y(k),
          class: "permlabel",
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        lbl.textContent = String(k);
        ghost.appendChild(lbl);
        next.appendChild(ghost);
      }
      for (const s of specs) {
        if (!s.enter) continue;
        s.g.style.transformBox = "fill-box";
        s.g.style.transformOrigin = "center";
      }
      if (ghost) {
        ghost.style.transformBox = "fill-box";
        ghost.style.transformOrigin = "center";
      }

      const vb0 = cropVB(oldN).split(" ").map(Number);
      const vb1 = cropVB(n).split(" ").map(Number);
      next.style.overflow = "hidden";
      const frame = (e) => {
        next.setAttribute("viewBox", vb0.map((o, i) => lerp(o, vb1[i], e)).join(" "));
        for (const s of specs) {
          if (s.enter) {
            s.g.style.opacity = String(e);
            s.g.style.transform = `scale(${0.4 + 0.6 * e})`;
          } else {
            s.g.setAttribute("transform", `translate(${lerp(s.sx, s.ex, e) - s.ex},${lerp(s.sy, s.ey, e) - s.ey})`);
          }
        }
        if (ghost) {
          ghost.style.opacity = String(1 - e);
          ghost.style.transform = `scale(${0.4 + 0.6 * (1 - e)})`;
        }
      };
      frame(0);
      cancelAnim = tween(320, frame, () => {
        next.style.overflow = "";
        for (const s of specs) {
          if (s.enter) {
            s.g.style.opacity = "";
            s.g.style.transform = "";
          } else s.g.removeAttribute("transform");
        }
        if (ghost) ghost.remove();
        cancelAnim = null;
        if (frameN !== n) setPath(path); // settle onto the natural n-frame
      });
    }

    const ed = opts.animate && opts.edit && opts.prevPath ? opts.edit : null;
    if (ed && ed.type === "swap") animateSwap(permutationFromPath(opts.prevPath), perm, geom.Y, groupEls);
    else if (oldPerm && ed) animateResize(ed);
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
          type: "remove",
          kind: "peak",
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
