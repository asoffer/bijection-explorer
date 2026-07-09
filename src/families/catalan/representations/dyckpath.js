import { U, D, analyze } from "../model.js";
import { applyEdit } from "../edits.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeInteractive, tween } from "../../../core/view.js";

export const meta = {
  id: "dyck",
  name: "Dyck path",
  blurb:
    "A lattice path of up/down steps that never dips below the axis. Hover a point to grow the path (peak up / valley down), hover a peak to remove it, or click a corner to reshape it.",
};

export function create(container, callbacks) {
  let svg = null;
  let region = null;
  let geom = null;
  let afford = null; // { ring, btnPeak, btnValley, btnDelete, reshape }
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    const { pairOfStep, openOf, closeOf } = analyze(path);

    // A swap (elementary move) keeps n fixed and moves exactly one vertex: the
    // apex between steps `at` and `at+1` slides between peak and valley height
    // while its two edges swap up/down (and colour). Everything else is
    // unchanged, so we animate that lone vertex and leave the rest in place.
    const swap = opts.animate && opts.edit && opts.edit.type === "swap" && opts.prevPath;
    const oldPts = swap ? prefixHeights(opts.prevPath) : null;

    // Prefix heights: pts[j] = height after j steps.
    const pts = prefixHeights(path);
    // Animate inside a frame tall enough for both shapes so nothing overflows.
    const maxH = Math.max(1, ...pts, ...(swap ? oldPts : []));

    const unit = 40;
    const padX = 24;
    const head = 34; // vertical headroom for the grow/shrink buttons
    const W = path.length * unit + padX * 2;
    const H = maxH * unit + head * 2;
    const X = (j) => padX + j * unit;
    const Y = (h) => head + (maxH - h) * unit;
    geom = { X, Y, pts, openOf, closeOf, path, W, unit, padX };

    const next = makeSvg(`0 0 ${W} ${H}`);

    // baseline
    next.appendChild(
      svgEl("line", { x1: X(0), y1: Y(0), x2: X(path.length), y2: Y(0), class: "axis" })
    );

    // shaded region under the hovered sub-arch (drawn behind the steps)
    region = svgEl("polygon", { class: "range-band" });
    next.appendChild(region);

    // per-step segments (hoverable / highlightable)
    const stepEls = [];
    for (let j = 0; j < path.length; j++) {
      const seg = svgEl("line", {
        x1: X(j),
        y1: Y(pts[j]),
        x2: X(j + 1),
        y2: Y(pts[j + 1]),
        class: `step ${path[j] === U ? "up" : "down"}`,
      });
      makeInteractive(seg, pairOfStep[j], callbacks, null);
      next.appendChild(seg);
      stepEls.push(seg);
    }

    // node dots at each lattice point
    const dotEls = [];
    for (let j = 0; j <= path.length; j++) {
      const dot = svgEl("circle", { cx: X(j), cy: Y(pts[j]), r: 2.5, class: "vertex" });
      next.appendChild(dot);
      dotEls.push(dot);
    }

    // affordance layer, on top, hidden until the pointer moves over the figure
    afford = buildAffordances(next);
    next.addEventListener("pointermove", (e) => updateAfford(e));
    next.addEventListener("pointerleave", hideAfford);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    if (swap) animateSwap(opts.edit.at, oldPts, pts, Y, stepEls, dotEls, { W, unit, head, maxH });
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
    const y0Old = (vb.maxH - oldMaxH) * vb.unit;
    const y0New = (vb.maxH - newMaxH) * vb.unit;
    const hOld = oldMaxH * vb.unit + vb.head * 2;
    const hNew = newMaxH * vb.unit + vb.head * 2;
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

  function buildAffordances(parent) {
    const g = svgEl("g", { class: "afford-layer" });
    const ring = svgEl("circle", { r: 6, class: "afford-ring", visibility: "hidden" });
    g.appendChild(ring);
    const mkBtn = (cls, glyph) => {
      const btn = svgEl("g", { class: `afford ${cls}`, visibility: "hidden" });
      btn.appendChild(svgEl("circle", { r: 11, cx: 0, cy: 0 }));
      const t = svgEl("text", {
        x: 0,
        y: 0,
        class: "afford-glyph",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      t.textContent = glyph;
      btn.appendChild(t);
      g.appendChild(btn);
      return btn;
    };
    const btnPeak = mkBtn("grow", "+");
    const btnValley = mkBtn("grow", "+");
    const btnDelete = mkBtn("shrink", "−");
    const reshape = svgEl("circle", { r: 7, class: "afford-reshape", visibility: "hidden" });
    g.appendChild(reshape);
    parent.appendChild(g);
    return { ring, btnPeak, btnValley, btnDelete, reshape };
  }

  function placeBtn(btn, x, y, onClick) {
    btn.setAttribute("transform", `translate(${x},${y})`);
    btn.style.visibility = "visible";
    btn.onclick = (e) => {
      e.stopPropagation();
      const p = onClick();
      if (p) callbacks.onEdit(p);
    };
  }

  function hideAfford() {
    if (!afford) return;
    afford.ring.style.visibility = "hidden";
    for (const b of [afford.btnPeak, afford.btnValley, afford.btnDelete]) {
      b.style.visibility = "hidden";
      b.onclick = null;
    }
    afford.reshape.style.visibility = "hidden";
    afford.reshape.onclick = null;
  }

  function updateAfford(e) {
    if (!afford || !geom) return;
    const { X, Y, pts, path, W, unit, padX } = geom;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let v = Math.round((vbX - padX) / unit);
    v = Math.max(0, Math.min(path.length, v));
    const h = pts[v];

    hideAfford();
    afford.ring.setAttribute("cx", X(v));
    afford.ring.setAttribute("cy", Y(h));
    afford.ring.style.visibility = "visible";

    const peakApex = v >= 1 && v <= path.length - 1 && path[v - 1] === U && path[v] === D;
    const valleyPt = v >= 1 && v <= path.length - 1 && path[v - 1] === D && path[v] === U;

    if (peakApex) {
      placeBtn(afford.btnDelete, X(v), Y(h) - 22, () => ({ type: "delete", at: v - 1 }));
      showReshape(v - 1, X(v) + 16, Y(h) + 2);
    } else {
      placeBtn(afford.btnPeak, X(v), Y(h + 1) - 22, () => ({ type: "insert", kind: "peak", at: v }));
      if (h >= 1) {
        placeBtn(afford.btnValley, X(v), Y(h - 1) + 22, () => ({ type: "insert", kind: "valley", at: v }));
      }
      if (valleyPt) showReshape(v - 1, X(v) + 16, Y(h) - 2);
    }
  }

  // Offer the elementary (peak<->valley) swap at step `at` when it stays valid.
  function showReshape(at, cx, cy) {
    const swap = { type: "swap", at };
    if (!applyEdit(geom.path, swap)) return;
    afford.reshape.setAttribute("cx", cx);
    afford.reshape.setAttribute("cy", cy);
    afford.reshape.style.visibility = "visible";
    afford.reshape.onclick = (ev) => {
      ev.stopPropagation();
      callbacks.onEdit(swap);
    };
  }

  function showRegion(pairId) {
    if (!region || !geom) return;
    if (pairId === null || pairId === undefined) {
      region.classList.remove("on");
      return;
    }
    const open = geom.openOf[pairId];
    const close = geom.closeOf[pairId];
    const poly = [];
    for (let j = open; j <= close + 1; j++) {
      poly.push(`${geom.X(j)},${geom.Y(geom.pts[j])}`);
    }
    region.setAttribute("points", poly.join(" "));
    region.classList.add("on");
  }

  return {
    setPath,
    highlight(pairId) {
      showRegion(pairId);
    },
    destroy() {
      if (svg) svg.remove();
    },
  };
}
