import { U, D, analyze } from "../model.js";
import { applyEdit } from "../edits.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeInteractive, affordMenu, tween, dispatchEdit } from "../../../core/view.js";

export const meta = {
  id: "dyck",
  name: "Dyck path",
  blurb:
    "A lattice path of up/down steps that never dips below the axis. Hover a slope to grow the path (peak up / valley down), a peak or valley to remove it, or a corner to reshape it.",
};

const unit = 40;
const padX = 24;
const head = 34; // vertical headroom for the grow/shrink buttons

export function create(container, callbacks) {
  let svg = null;
  let pairBand = null; // filled trapezoid between the pair's `/` and `\`
  let betweenBand = null; // nested content sitting on top of the trapezoid
  let geom = null;
  let menu = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    if (menu) menu.destroy();
    const { openOf, closeOf } = analyze(path);

    // A swap (elementary move) keeps n fixed and moves exactly one vertex; a
    // resize (insert/remove a peak or valley) adds or drops one UD/DU pair. Both
    // animate against the previous path, so we draw inside a frame tall enough
    // for both shapes and pan the viewBox onto the new compact box at the end.
    const e = opts.animate && opts.edit && opts.prevPath ? opts.edit : null;
    const swap = e && e.type === "swap" ? e : null;
    const resize = e && (e.type === "insert" || e.type === "remove") ? e : null;
    const oldPts = swap || resize ? prefixHeights(opts.prevPath) : null;

    // Prefix heights: pts[j] = height after j steps.
    const pts = prefixHeights(path);
    const maxH = Math.max(1, ...pts, ...(oldPts || []));

    const W = path.length * unit + padX * 2;
    const H = maxH * unit + head * 2;
    const X = (j) => padX + j * unit;
    const Y = (h) => head + (maxH - h) * unit;
    geom = { X, Y, pts, openOf, closeOf, path, W, maxH };

    const next = makeSvg(`0 0 ${W} ${H}`);
    menu = affordMenu(next, callbacks.onEdit);

    // baseline (widened to cover both shapes while a resize is in flight)
    const axisLen = Math.max(path.length, oldPts ? oldPts.length - 1 : 0);
    const axis = svgEl("line", { x1: X(0), y1: Y(0), x2: X(axisLen), y2: Y(0), class: "axis" });
    next.appendChild(axis);

    // hover shading, drawn behind the steps: a strong trapezoid for the pair
    // itself (the area between its `/` and `\`) plus a soft region for the
    // nested content resting on top of it.
    betweenBand = svgEl("polygon", { class: "range-band" });
    pairBand = svgEl("polygon", { class: "range-band-pair" });
    next.appendChild(betweenBand);
    next.appendChild(pairBand);

    // Transparent trapezoid hit areas: hovering anywhere between a pair's `/`
    // and `\` — not only on the two segments — selects that pair. These
    // trapezoids tile the whole region under the path, one per pair, so the
    // innermost one under the cursor wins.
    for (let p = 0; p < openOf.length; p++) {
      const o = openOf[p];
      const c = closeOf[p];
      const hit = svgEl("polygon", {
        class: "dyck-hit",
        points: [
          [X(o), Y(pts[o])],
          [X(o + 1), Y(pts[o + 1])],
          [X(c), Y(pts[c])],
          [X(c + 1), Y(pts[c + 1])],
        ]
          .map((q) => q.join(","))
          .join(" "),
      });
      makeInteractive(hit, p, callbacks, null);
      next.appendChild(hit);
    }

    // per-step segments (purely visual; hover is driven by the trapezoids above)
    const stepEls = [];
    for (let j = 0; j < path.length; j++) {
      const seg = svgEl("line", {
        x1: X(j),
        y1: Y(pts[j]),
        x2: X(j + 1),
        y2: Y(pts[j + 1]),
        class: `step ${path[j] === U ? "up" : "down"}`,
      });
      next.appendChild(seg);
      stepEls.push(seg);
    }

    // The elementary (peak<->valley) swap at step `at`, offered as a menu option
    // only where it stays valid.
    const reshapeOption = (at, x, y) => {
      const swap = { type: "swap", at };
      if (!applyEdit(path, swap)) return null;
      return { cls: "reshape", glyph: "↕", x, y, produce: () => swap };
    };
    // Every sensible option for lattice vertex `v`, laid out radially so they
    // never collide: insert a peak above (always) and a valley below (only off
    // the axis); peaks and valleys additionally remove (left) and swap (right).
    const vertexOptions = (v) => {
      const h = pts[v];
      const isPeak = v >= 1 && v <= path.length - 1 && path[v - 1] === U && path[v] === D;
      const isValley = v >= 1 && v <= path.length - 1 && path[v - 1] === D && path[v] === U;
      const opts = [
        { cls: "grow", glyph: "+", x: X(v), y: Y(h) - 26, produce: () => ({ type: "insert", kind: "peak", at: v }) },
      ];
      if (h >= 1)
        opts.push({ cls: "grow", glyph: "+", x: X(v), y: Y(h) + 26, produce: () => ({ type: "insert", kind: "valley", at: v }) });
      if (isPeak || isValley) {
        opts.push({
          cls: "shrink",
          glyph: "−",
          x: X(v) - 26,
          y: Y(h),
          produce: () => ({ type: "remove", kind: isPeak ? "peak" : "valley", at: v - 1 }),
        });
        opts.push(reshapeOption(v - 1, X(v) + 26, Y(h)));
      }
      return opts;
    };

    // node dots + per-vertex edit menus at each lattice point
    const dotEls = [];
    for (let j = 0; j <= path.length; j++) {
      const cx = X(j);
      const cy = Y(pts[j]);
      const dot = svgEl("circle", { cx, cy, r: 2.5, class: "vertex" });
      next.appendChild(dot);
      dotEls.push(dot);
      const halo = svgEl("circle", { cx, cy, r: 16, class: "afford-hit" });
      menu.anchor(halo, `v${j}`, cx, cy, () => vertexOptions(j));
      next.appendChild(halo);
    }

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    // (`swap`/`resize`/`oldPts` were derived up top because the viewBox frame is
    // sized to fit both the old and new shapes; the tail just routes each type to
    // its animator.)
    dispatchEdit(opts, {
      swap: (edit) => animateSwap(edit.at, oldPts, pts, Y, stepEls, dotEls, { W, maxH }),
      insert: (edit) => animateInsert(next, edit, oldPts, pts, stepEls, dotEls),
      remove: (edit) => animateRemove(next, edit, oldPts, pts, stepEls, dotEls, axis),
    });
  }

  function prefixHeights(p) {
    const pts = [0];
    for (let j = 0; j < p.length; j++) pts.push(pts[j] + p[j]);
    return pts;
  }

  // Slide the apex between steps `at`/`at+1` from its old height to its new one
  // and crossfade the two edges from their pre-swap colours to their new ones.
  function animateSwap(at, oldPts, pts, Y, stepEls, dotEls, vb) {
    const m = at + 1;
    const yOld = Y(oldPts[m]);
    const yNew = Y(pts[m]);
    const left = stepEls[at]; // edge ending at the apex
    const right = stepEls[at + 1]; // edge starting at the apex
    const dot = dotEls[m];

    // The path is drawn in a frame tall enough for both shapes (vb.maxH). If the
    // swap raises or lowers the peak's global max, the old and new compact frames
    // differ, so pan/zoom the viewBox from the old compact box to the new one —
    // frame 0 then matches the image that was on screen (no jump).
    const oldMaxH = Math.max(1, ...oldPts);
    const newMaxH = Math.max(1, ...pts);
    const y0Old = (vb.maxH - oldMaxH) * unit;
    const y0New = (vb.maxH - newMaxH) * unit;
    const hOld = oldMaxH * unit + head * 2;
    const hNew = newMaxH * unit + head * 2;
    const setVB = (e) =>
      svg.setAttribute("viewBox", `0 ${y0Old + (y0New - y0Old) * e} ${vb.W} ${hOld + (hNew - hOld) * e}`);

    // A swap flips each edge's direction, so its old colour is the opposite of
    // the one it now carries. Paint that, commit, then release to animate.
    for (const seg of [left, right]) {
      seg.style.stroke = seg.classList.contains("up") ? "var(--down)" : "var(--up)";
    }
    void left.getBoundingClientRect();
    for (const seg of [left, right]) {
      seg.style.transition = "stroke 360ms linear";
      seg.style.stroke = "";
    }

    setVB(0);
    cancelAnim = tween(
      360,
      (e) => {
        const y = yOld + (yNew - yOld) * e;
        left.setAttribute("y2", y);
        right.setAttribute("y1", y);
        dot.setAttribute("cy", y);
        setVB(e);
      },
      () => {
        left.style.transition = "";
        right.style.transition = "";
        cancelAnim = null;
      }
    );
  }

  // ---- resize animation helpers ---------------------------------------------

  const lerp = (a, b, e) => a + (b - a) * e;
  const pt = (s, t, e) => [lerp(s[0], t[0], e), lerp(s[1], t[1], e)];
  const setSeg = (el, l, r) => {
    el.setAttribute("x1", l[0]);
    el.setAttribute("y1", l[1]);
    el.setAttribute("x2", r[0]);
    el.setAttribute("y2", r[1]);
  };
  // The old and new compact boxes, in the shared (maxH) frame. Panning between
  // them widens or narrows the whole figure in step with the edit.
  function resizeBoxes(oldPts, pts, maxH) {
    const vb = (P) => [0, (maxH - Math.max(1, ...P)) * unit, (P.length - 1) * unit + 2 * padX, Math.max(1, ...P) * unit + head * 2];
    return [vb(oldPts), vb(pts)];
  }
  const lerpBox = (a, b, e) => a.map((o, i) => lerp(o, b[i], e)).join(" ");

  // Insert: render the NEW path, then run it backwards from the old one. Kept
  // vertices morph from where they sat (the tail slides over by one pair width)
  // and the inserted pair unfolds out of the edit vertex, fading in.
  function animateInsert(root, edit, oldPts, pts, stepEls, dotEls) {
    const { X, Y, maxH } = geom;
    const at = edit.at;
    const Ln = pts.length - 1;
    const startOf = (j) => {
      if (j <= at) return [X(j), Y(oldPts[j])];
      if (j <= at + 2) return [X(at), Y(oldPts[at])]; // inserted pair unfolds from here
      return [X(j - 2), Y(oldPts[j - 2])]; // tail slid one pair to the left
    };
    const starts = [];
    const ends = [];
    for (let j = 0; j <= Ln; j++) {
      starts.push(startOf(j));
      ends.push([X(j), Y(pts[j])]);
    }
    const fadeIn = [stepEls[at], stepEls[at + 1]];
    for (const s of fadeIn) s.style.opacity = "0";
    const [vbOld, vbNew] = resizeBoxes(oldPts, pts, maxH);

    root.style.overflow = "hidden";
    const frame = (e) => {
      const cur = starts.map((s, j) => pt(s, ends[j], e));
      for (let j = 0; j <= Ln; j++) {
        dotEls[j].setAttribute("cx", cur[j][0]);
        dotEls[j].setAttribute("cy", cur[j][1]);
      }
      for (let k = 0; k < Ln; k++) setSeg(stepEls[k], cur[k], cur[k + 1]);
      for (const s of fadeIn) s.style.opacity = String(e);
      root.setAttribute("viewBox", lerpBox(vbOld, vbNew, e));
    };
    frame(0);
    cancelAnim = tween(320, frame, () => {
      root.style.overflow = "";
      for (const s of fadeIn) s.style.opacity = "";
      cancelAnim = null;
    });
  }

  // Remove: the two edges into and out of the apex shrink away and the apex,
  // together with the right-base node, folds into the left base — the two bases
  // merge into one. The kept path is the NEW path, drawn so that at frame 0 it
  // overlays the old one exactly (the reconnecting edge starts where the old
  // post-apex edge was, not spanning across the gap). The apex edges and the
  // vanishing right-base node are ghosts that fade as they meet the left base.
  function animateRemove(root, edit, oldPts, pts, stepEls, dotEls, axis) {
    const { X, Y, maxH } = geom;
    const at = edit.at;
    const Ln = pts.length - 1;
    const oldV = (j) => [X(j), Y(oldPts[j])];
    const newV = (j) => [X(j), Y(pts[j])];
    const merge = oldV(at); // the surviving (left) base

    // NEW segment k came from old edge (k < at ? k : k + 2); start it on that
    // old edge so nothing jumps.
    const segSpec = stepEls.map((el, k) => {
      const oe = k < at ? k : k + 2;
      return { el, ls: oldV(oe), le: newV(k), rs: oldV(oe + 1), re: newV(k + 1) };
    });
    // NEW vertex j came from old vertex (j <= at ? j : j + 2).
    const dotSpec = dotEls.map((el, j) => ({ el, s: oldV(j <= at ? j : j + 2), e: newV(j) }));

    const ghostEdges = [at, at + 1].map((i0) => {
      const el = svgEl("line", { class: `step ${oldPts[i0 + 1] > oldPts[i0] ? "up" : "down"}` });
      root.appendChild(el);
      return { el, a: oldV(i0), b: oldV(i0 + 1) };
    });
    const ghostDot = svgEl("circle", { r: 2.5, class: "vertex" });
    root.appendChild(ghostDot);
    const rightBase = oldV(at + 2);
    const [vbOld, vbNew] = resizeBoxes(oldPts, pts, maxH);

    root.style.overflow = "hidden";
    const frame = (e) => {
      for (const s of segSpec) setSeg(s.el, pt(s.ls, s.le, e), pt(s.rs, s.re, e));
      for (const d of dotSpec) {
        const p = pt(d.s, d.e, e);
        d.el.setAttribute("cx", p[0]);
        d.el.setAttribute("cy", p[1]);
      }
      for (const g of ghostEdges) {
        setSeg(g.el, pt(g.a, merge, e), pt(g.b, merge, e));
        g.el.style.opacity = String(1 - e);
      }
      const gp = pt(rightBase, merge, e);
      ghostDot.setAttribute("cx", gp[0]);
      ghostDot.setAttribute("cy", gp[1]);
      ghostDot.style.opacity = String(1 - e);
      root.setAttribute("viewBox", lerpBox(vbOld, vbNew, e));
    };
    frame(0);
    cancelAnim = tween(320, frame, () => {
      root.style.overflow = "";
      for (const g of ghostEdges) g.el.remove();
      ghostDot.remove();
      axis.setAttribute("x2", X(Ln)); // trim the baseline back to the new width
      cancelAnim = null;
    });
  }

  function showRegions(pairId) {
    if (!pairBand || !betweenBand || !geom) return;
    if (pairId === null || pairId === undefined) {
      pairBand.classList.remove("on");
      betweenBand.classList.remove("on");
      return;
    }
    const { X, Y, pts, openOf, closeOf } = geom;
    const open = openOf[pairId];
    const close = closeOf[pairId];
    // Trapezoid between the two matching steps: base of `/`, top of `/`,
    // top of `\`, base of `\`.
    const trap = [
      [X(open), Y(pts[open])],
      [X(open + 1), Y(pts[open + 1])],
      [X(close), Y(pts[close])],
      [X(close + 1), Y(pts[close + 1])],
    ];
    pairBand.setAttribute("points", trap.map((p) => p.join(",")).join(" "));
    pairBand.classList.add("on");
    // Nested content rides on top of the trapezoid: the sub-path from the top of
    // `/` across to the top of `\` (empty for a bare peak, where close = open+1).
    if (close > open + 1) {
      const inner = [];
      for (let j = open + 1; j <= close; j++) inner.push([X(j), Y(pts[j])]);
      betweenBand.setAttribute("points", inner.map((p) => p.join(",")).join(" "));
      betweenBand.classList.add("on");
    } else {
      betweenBand.classList.remove("on");
    }
  }

  return {
    setPath,
    highlight(pairId) {
      showRegions(pairId);
    },
    destroy() {
      if (cancelAnim) cancelAnim();
      if (menu) menu.destroy();
      if (svg) svg.remove();
    },
  };
}
