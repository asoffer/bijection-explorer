import {
  U,
  D,
  analyze,
  elementaryMove,
  insertPeak,
  insertValley,
  deletePeak,
} from "../model.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeInteractive } from "../../../core/view.js";

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

  function setPath(path) {
    const { pairOfStep, openOf, closeOf } = analyze(path);

    // Prefix heights: pts[j] = height after j steps.
    const pts = [0];
    let maxH = 0;
    for (let j = 0; j < path.length; j++) {
      pts.push(pts[j] + path[j]);
      maxH = Math.max(maxH, pts[j + 1]);
    }
    maxH = Math.max(maxH, 1);

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
    }

    // node dots at each lattice point
    for (let j = 0; j <= path.length; j++) {
      next.appendChild(svgEl("circle", { cx: X(j), cy: Y(pts[j]), r: 2.5, class: "vertex" }));
    }

    // affordance layer, on top, hidden until the pointer moves over the figure
    afford = buildAffordances(next);
    next.addEventListener("pointermove", (e) => updateAfford(e));
    next.addEventListener("pointerleave", hideAfford);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
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
      placeBtn(afford.btnDelete, X(v), Y(h) - 22, () => deletePeak(path, v - 1));
      const swap = elementaryMove(path, v - 1);
      if (swap) {
        afford.reshape.setAttribute("cx", X(v) + 16);
        afford.reshape.setAttribute("cy", Y(h) + 2);
        afford.reshape.style.visibility = "visible";
        afford.reshape.onclick = (ev) => {
          ev.stopPropagation();
          callbacks.onEdit(swap);
        };
      }
    } else {
      placeBtn(afford.btnPeak, X(v), Y(h + 1) - 22, () => insertPeak(path, v));
      if (h >= 1) placeBtn(afford.btnValley, X(v), Y(h - 1) + 22, () => insertValley(path, v));
      if (valleyPt) {
        const swap = elementaryMove(path, v - 1);
        if (swap) {
          afford.reshape.setAttribute("cx", X(v) + 16);
          afford.reshape.setAttribute("cy", Y(h) - 2);
          afford.reshape.style.visibility = "visible";
          afford.reshape.onclick = (ev) => {
            ev.stopPropagation();
            callbacks.onEdit(swap);
          };
        }
      }
    }
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
