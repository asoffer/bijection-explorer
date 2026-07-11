import { U, analyze, subtreeRange } from "../model.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeRegistry, register, applyHighlight, makeInteractive, affordMenu, tween, dispatchEdit } from "../../../core/view.js";

export const meta = {
  id: "perm",
  name: "312-avoiding permutation",
  blurb:
    "Read the path as stack operations — up = push the next value, down = pop and output. Feeding 1,2,…,n through one stack yields exactly the 312-avoiding permutations. Hover a column gap to insert a value or swap neighbours, a push-then-pop point to remove it, or the notch between two blocks to merge them.",
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
  let menu = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    if (menu) menu.destroy();
    registry.clear();
    currentEls = [];
    const perm = permutationFromPath(path);
    const n = perm.length;
    const { openOf, closeOf, pairOfStep } = analyze(path);
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

    menu = affordMenu(next, callbacks.onEdit);

    // Column gaps (drawn under the dots): insert a value above the grid, or swap
    // the two neighbouring columns below it where the result stays 312-avoiding.
    const gridTop = pad;
    const gridBot = pad + n * unit;
    for (let gp = 0; gp <= n; gp++) {
      const gx = pad + gp * unit;
      const hit = svgEl("rect", { x: gx - unit / 2, y: gridTop - 28, width: unit, height: n * unit + 56, class: "afford-hit" });
      menu.anchor(hit, `col${gp}`, gx, (gridTop + gridBot) / 2, () => {
        const opts = [
          { cls: "grow", glyph: "+", x: gx, y: gridTop - 16, produce: () => ({ type: "insert", kind: "peak", at: gp < n ? downIdx[gp] : path.length }) },
        ];
        if (gp >= 1 && gp <= n - 1) {
          const swapped = perm.slice();
          [swapped[gp - 1], swapped[gp]] = [swapped[gp], swapped[gp - 1]];
          const moved = pathFromPermutation(swapped);
          if (moved) opts.push({ cls: "reshape", glyph: "⇄", x: gx, y: gridBot + 16, produce: () => ({ type: "set", path: moved }) });
        }
        return opts;
      });
      next.appendChild(hit);
    }

    // Valley notches: a valley (D then U) sits between two sibling blocks, whose
    // lowest points are the left block's min value and the right block's min. The
    // "−" lives at the empty corner where those two points will meet on merge.
    for (let i = 0; i + 1 < path.length; i++) {
      if (path[i] !== -1 || path[i + 1] !== U) continue;
      const L = pairOfStep[i];
      const R = pairOfStep[i + 1];
      const mx = X(posOf[R + 1]); // right block's lowest column
      const my = Y(L + 1); // left block's lowest row
      const hit = svgEl("circle", { cx: mx, cy: my, r: 15, class: "afford-hit" });
      menu.anchor(hit, `valley${i}`, mx, my, () => [
        { cls: "shrink", glyph: "−", x: mx, y: my, produce: () => ({ type: "remove", kind: "valley", at: i }) },
      ]);
      next.appendChild(hit);
    }

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
      // a value pushed then immediately popped (a peak) can be removed
      if (closeOf[v - 1] === openOf[v - 1] + 1) {
        menu.anchor(g, `pt${v}`, X(i), Y(v), () => [
          { cls: "shrink", glyph: "−", x: X(i), y: Y(v) - 24, produce: () => ({ type: "remove", kind: "peak", at: openOf[v - 1] }) },
        ]);
      }
      next.appendChild(g);
      groupEls.push(g);
    }

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

    // Remove a valley = merge two sibling blocks. Their two lowest points slide
    // together — the left block's rightwards, the right block's downwards — meet
    // at the corner and fuse; then the rest of the grid reflows to the new plot.
    function animateValleyRemove(edit) {
      const oldA = analyze(opts.prevPath);
      const L = oldA.pairOfStep[edit.at];
      const R = oldA.pairOfStep[edit.at + 1];
      const Lval = L + 1;
      const Rval = R + 1; // the value that disappears (right block's lowest)
      const posOld = [];
      oldPerm.forEach((v, idx) => (posOld[v] = idx));
      const meet = { x: X(posOld[Rval]), y: Y(Lval) };
      const lerp = (a, b, e) => a + (b - a) * e;

      const specs = [];
      let lowLeft = null;
      for (let idx = 0; idx < perm.length; idx++) {
        const w = perm[idx]; // new value
        const ov = w < Rval ? w : w + 1; // old value it came from
        const spec = { g: groupEls[idx], ox: X(posOld[ov]), oy: Y(ov), nx: X(idx), ny: Y(w) };
        specs.push(spec);
        if (ov === Lval) lowLeft = spec;
      }

      const ghost = svgEl("g", { class: "permpt" });
      ghost.appendChild(svgEl("circle", { cx: X(posOld[Rval]), cy: Y(Rval), r: 11, class: "permdot" }));
      const glbl = svgEl("text", {
        x: X(posOld[Rval]),
        y: Y(Rval),
        class: "permlabel",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      glbl.textContent = String(Rval);
      ghost.appendChild(glbl);
      next.appendChild(ghost);

      const vb0 = cropVB(oldPerm.length).split(" ").map(Number);
      const vb1 = cropVB(n).split(" ").map(Number);
      const e0 = 0.5; // phase A: the two points meet; phase B: the grid reflows
      next.style.overflow = "hidden";
      const frame = (e) => {
        const eA = Math.min(1, e / e0);
        const eB = Math.max(0, (e - e0) / (1 - e0));
        for (const s of specs) {
          let x, y;
          if (s === lowLeft) {
            if (e < e0) {
              x = lerp(s.ox, meet.x, eA); // slide right, same row
              y = s.oy;
            } else {
              x = lerp(meet.x, s.nx, eB);
              y = lerp(meet.y, s.ny, eB);
            }
          } else if (e < e0) {
            x = s.ox;
            y = s.oy;
          } else {
            x = lerp(s.ox, s.nx, eB);
            y = lerp(s.oy, s.ny, eB);
          }
          s.g.setAttribute("transform", `translate(${x - s.nx},${y - s.ny})`);
        }
        const gy = lerp(Y(Rval), meet.y, eA); // ghost slides straight down and fades
        ghost.setAttribute("transform", `translate(0,${gy - Y(Rval)})`);
        ghost.style.opacity = String(1 - eA);
        next.setAttribute("viewBox", vb0.map((o, k) => lerp(o, vb1[k], eB)).join(" "));
      };
      frame(0);
      cancelAnim = tween(520, frame, () => {
        next.style.overflow = "";
        for (const s of specs) s.g.removeAttribute("transform");
        ghost.remove();
        cancelAnim = null;
        if (frameN !== n) setPath(path);
      });
    }

    // insert / non-valley remove share animateResize; a valley remove is a block
    // merge (animateValleyRemove). oldPerm is populated exactly for insert/remove,
    // which is all these handlers touch.
    dispatchEdit(opts, {
      swap: (edit, prevPath) => animateSwap(permutationFromPath(prevPath), perm, geom.Y, groupEls),
      insert: (edit) => animateResize(edit),
      remove: (edit) => (edit.kind === "valley" ? animateValleyRemove(edit) : animateResize(edit)),
    });
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
      if (menu) menu.destroy();
      if (svg) svg.remove();
    },
  };
}
