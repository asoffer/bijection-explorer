import { U, analyze, subtreeRange } from "../model.js";
import { applyEdit } from "../edits.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeRegistry, register, applyHighlight, makeInteractive, affordMenu, tween } from "../../../core/view.js";

export const meta = {
  id: "parens",
  name: "Balanced parentheses",
  blurb:
    "Each up-step is an open bracket, each down-step its matching close. Hover a bracket to shade the substring its pair spans, or a gap to insert () or )( , remove an empty () or )( , or swap the two neighbours.",
};

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let band = null;
  let geom = null;
  let menu = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    if (menu) menu.destroy();
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
    menu = affordMenu(next, callbacks.onEdit);

    // backing band (drawn first, hidden until hover)
    band = svgEl("rect", { class: "range-band", rx: 10, ry: 10, height: unit * 1.5, y: midY - unit * 0.75 });
    next.appendChild(band);

    // Per-gap edit menus. A gap sits at a bracket boundary; its transparent hit
    // strip is drawn *under* the glyphs, so hovering a bracket still highlights
    // its pair while the exposed space between brackets opens the gap's menu.
    // The row is horizontal, so options stack vertically along the gap line:
    // inserts sit next to the row, remove/swap just beyond them.
    const heights = [0];
    for (let j = 0; j < path.length; j++) heights.push(heights[j] + path[j]);
    // Every sensible option at gap g: insert a peak `()` (always) above and a
    // valley `)(` below wherever there's nesting depth; remove an empty `()` or
    // a `)(` juncture sitting at the gap; swap the two straddling brackets.
    const gapOptions = (g) => {
      const x = gapX(g);
      const h = heights[g];
      const isPeak = g >= 1 && g <= path.length - 1 && path[g - 1] === U && path[g] !== U;
      const isValley = g >= 1 && g <= path.length - 1 && path[g - 1] !== U && path[g] === U;
      const opts = [
        { cls: "grow", glyph: "+", x, y: midY - 26, produce: () => ({ type: "insert", kind: "peak", at: g }) },
      ];
      if (h >= 1)
        opts.push({ cls: "grow", glyph: "+", x, y: midY + 26, produce: () => ({ type: "insert", kind: "valley", at: g }) });
      if (isPeak)
        opts.push({ cls: "shrink", glyph: "−", x, y: midY - 50, produce: () => ({ type: "remove", kind: "peak", at: g - 1 }) });
      else if (isValley)
        opts.push({ cls: "shrink", glyph: "−", x, y: midY - 50, produce: () => ({ type: "remove", kind: "valley", at: g - 1 }) });
      const swap = { type: "swap", at: g - 1 };
      if (applyEdit(path, swap)) opts.push({ cls: "reshape", glyph: "⇄", x, y: midY + 50, produce: () => swap });
      return opts;
    };
    for (let g = 0; g <= path.length; g++) {
      const hit = svgEl("rect", {
        x: gapX(g) - unit / 2,
        y: midY - unit * 1.5,
        width: unit,
        height: unit * 3,
        class: "afford-hit",
      });
      menu.anchor(hit, `g${g}`, gapX(g), midY, () => gapOptions(g));
      next.appendChild(hit);
    }

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

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    const e = opts.animate && opts.edit && opts.prevPath ? opts.edit : null;
    if (e && e.type === "swap") animateSwap(e.at, cx, glyphEls);
    else if (e && (e.type === "insert" || e.type === "remove"))
      animateResize(next, e, glyphEls, opts.prevPath);
  }

  // Grow / shrink by one bracket pair. The row is left-anchored, so brackets
  // before the edit hold still and those after slide over by one pair width;
  // the new pair fades and pops in at the gap, or the removed pair slides
  // together and fades. The viewBox widens or narrows in step.
  function animateResize(root, edit, glyphEls, prevPath) {
    const { unit, pad, cx, midY } = geom;
    const H = unit * 2 + pad * 2;
    const at = edit.at;
    const grow = edit.type === "insert";
    const oldLen = prevPath.length;
    const newLen = grow ? oldLen + 2 : oldLen - 2;
    const lerp = (a, b, t) => a + (b - a) * t;

    // start x (on the old row) for new glyph j
    const startX = (j) => {
      if (grow) return j < at ? cx(j) : j <= at + 1 ? cx(j) : cx(j - 2);
      return j < at ? cx(j) : cx(j + 2);
    };
    const inserted = grow ? new Set([at, at + 1]) : new Set();
    for (const j of inserted) {
      glyphEls[j].style.transformBox = "fill-box";
      glyphEls[j].style.transformOrigin = "center";
    }

    // removed pair: ghosts that slide together and fade
    const ghosts = [];
    if (!grow) {
      const mid = (cx(at) + cx(at + 1)) / 2;
      for (const k of [at, at + 1]) {
        const t = svgEl("text", {
          x: cx(k),
          y: midY,
          class: "paren",
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        t.textContent = prevPath[k] === U ? "(" : ")";
        root.appendChild(t);
        ghosts.push({ el: t, from: cx(k), to: mid });
      }
    }

    const oldW = oldLen * unit + pad * 2;
    const newW = newLen * unit + pad * 2;
    root.style.overflow = "hidden";
    const frame = (t) => {
      for (let j = 0; j < newLen; j++) {
        if (inserted.has(j)) {
          glyphEls[j].setAttribute("x", cx(j));
          glyphEls[j].style.opacity = String(t);
          glyphEls[j].style.transform = `scale(${0.3 + 0.7 * t})`;
        } else {
          glyphEls[j].setAttribute("x", lerp(startX(j), cx(j), t));
        }
      }
      for (const g of ghosts) {
        g.el.setAttribute("x", lerp(g.from, g.to, t));
        g.el.style.opacity = String(1 - t);
      }
      root.setAttribute("viewBox", `0 0 ${lerp(oldW, newW, t)} ${H}`);
    };
    frame(0);
    cancelAnim = tween(320, frame, () => {
      root.style.overflow = "";
      for (const j of inserted) {
        glyphEls[j].style.opacity = "";
        glyphEls[j].style.transform = "";
      }
      for (const g of ghosts) g.el.remove();
      cancelAnim = null;
    });
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
      if (menu) menu.destroy();
      if (svg) svg.remove();
    },
  };
}
