import { U, analyze, subtreeRange } from "../model.js";
import { applyEdit } from "../edits.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeRegistry, register, applyHighlight, makeInteractive, tween } from "../../../core/view.js";

export const meta = {
  id: "parens",
  name: "Balanced parentheses",
  blurb:
    "Each up-step is an open bracket, each down-step its matching close. Hover to shade the substring a pair spans; hover a gap to insert () or an empty () to delete it; click a caret to swap neighbours.",
};

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let band = null;
  let geom = null;
  let afford = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    registry.clear();
    currentEls = [];
    const { pairOfStep, openOf, closeOf, n } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));

    const unit = 34;
    const pad = 30;
    const W = path.length * unit + pad * 2;
    const H = unit * 2 + pad * 2;
    const cx = (j) => pad + j * unit + unit / 2;
    const gapX = (g) => pad + g * unit;
    const midY = pad + unit;
    geom = { unit, pad, cx, gapX, midY, openOf, closeOf, path, W };

    const next = makeSvg(`0 0 ${W} ${H}`);

    // backing band (drawn first, hidden until hover)
    band = svgEl("rect", { class: "range-band", rx: 10, ry: 10, height: unit * 1.5, y: midY - unit * 0.75 });
    next.appendChild(band);

    // brackets
    const glyphEls = [];
    for (let j = 0; j < path.length; j++) {
      const ch = path[j] === U ? "(" : ")";
      const t = svgEl("text", {
        x: cx(j),
        y: midY,
        class: "paren",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      t.textContent = ch;
      register(registry, pairOfStep[j], t);
      makeInteractive(t, pairOfStep[j], callbacks, null);
      next.appendChild(t);
      glyphEls.push(t);
    }

    afford = buildAffordances(next);
    next.addEventListener("pointermove", updateAfford);
    next.addEventListener("pointerleave", hideAfford);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    const swap = opts.animate && opts.edit && opts.edit.type === "swap" && opts.prevPath;
    if (swap) animateSwap(opts.edit.at, cx, glyphEls);
  }

  // A swap trades the two adjacent brackets: each glyph starts where the other
  // one was and slides home, so the `(` and `)` visibly cross past each other.
  function animateSwap(at, cx, glyphEls) {
    const a = glyphEls[at];
    const b = glyphEls[at + 1];
    if (!a || !b) return;
    const xa = cx(at);
    const xb = cx(at + 1);
    cancelAnim = tween(
      340,
      (e) => {
        a.setAttribute("x", xb + (xa - xb) * e); // arrived from position at+1
        b.setAttribute("x", xa + (xb - xa) * e); // arrived from position at
      },
      () => {
        cancelAnim = null;
      }
    );
  }

  function buildAffordances(parent) {
    const g = svgEl("g", { class: "afford-layer" });
    const guide = svgEl("line", { class: "afford-ring", visibility: "hidden" });
    g.appendChild(guide);
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
    const btnInsert = mkBtn("grow", "+");
    const btnDelete = mkBtn("shrink", "−");
    const reshape = svgEl("circle", { r: 6, class: "afford-reshape", visibility: "hidden" });
    g.appendChild(reshape);
    parent.appendChild(g);
    return { guide, btnInsert, btnDelete, reshape };
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
    afford.guide.style.visibility = "hidden";
    for (const b of [afford.btnInsert, afford.btnDelete]) {
      b.style.visibility = "hidden";
      b.onclick = null;
    }
    afford.reshape.style.visibility = "hidden";
    afford.reshape.onclick = null;
  }

  function updateAfford(e) {
    if (!afford || !geom) return;
    const { unit, pad, gapX, midY, openOf, closeOf, path, W } = geom;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let g = Math.round((vbX - pad) / unit);
    g = Math.max(0, Math.min(path.length, g));

    hideAfford();
    const x = gapX(g);
    afford.guide.setAttribute("x1", x);
    afford.guide.setAttribute("x2", x);
    afford.guide.setAttribute("y1", midY - unit * 0.8);
    afford.guide.setAttribute("y2", midY + unit * 0.8);
    afford.guide.style.visibility = "visible";

    // is this gap the inside of an empty pair "()" ?
    let emptyPair = -1;
    for (let p = 0; p < openOf.length; p++) {
      if (openOf[p] === g - 1 && closeOf[p] === g) {
        emptyPair = p;
        break;
      }
    }
    if (emptyPair >= 0) {
      placeBtn(afford.btnDelete, x, midY - unit * 0.95, () => ({ type: "delete", at: g - 1 }));
    } else {
      placeBtn(afford.btnInsert, x, midY - unit * 0.95, () => ({ type: "insert", kind: "peak", at: g }));
    }

    // reshape (swap the two steps straddling this gap) where valid
    const swap = { type: "swap", at: g - 1 };
    if (applyEdit(path, swap)) {
      afford.reshape.setAttribute("cx", x);
      afford.reshape.setAttribute("cy", midY + unit * 0.7);
      afford.reshape.style.visibility = "visible";
      afford.reshape.onclick = (ev) => {
        ev.stopPropagation();
        callbacks.onEdit(swap);
      };
    }
  }

  function showBand(range) {
    if (!band || !geom) return;
    if (!range) {
      band.classList.remove("on");
      return;
    }
    const [lo] = range;
    const left = geom.cx(geom.openOf[lo]) - geom.unit * 0.45;
    const right = geom.cx(geom.closeOf[lo]) + geom.unit * 0.45;
    band.setAttribute("x", left);
    band.setAttribute("width", right - left);
    band.classList.add("on");
  }

  return {
    setPath,
    highlight(pairId) {
      const range = pairId === null || pairId === undefined ? null : rangeOf[pairId];
      currentEls = applyHighlight(registry, currentEls, range);
      showBand(range);
    },
    destroy() {
      if (svg) svg.remove();
    },
  };
}
