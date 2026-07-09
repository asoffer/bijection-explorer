import { analyze, subtreeRange } from "../model.js";
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
  id: "chords",
  name: "Non-crossing chords",
  blurb:
    "2n points on a circle joined by n non-crossing chords — the bracket matching, chord i joining point openOf(i) to closeOf(i). Hover an arc gap to add a chord, or a short chord to remove it.",
};

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let plus = null;
  let minus = null;
  let geom = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    registry.clear();
    currentEls = [];
    const { openOf, closeOf, n } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    const P = path.length; // 2n points

    const R = 120;
    const pad = 40;
    const cxc = R + pad;
    const cyc = R + pad;
    const W = 2 * (R + pad);
    const ang = (j) => (-90 + (j * 360) / P) * (Math.PI / 180);
    const PX = (j) => cxc + R * Math.cos(ang(j));
    const PY = (j) => cyc + R * Math.sin(ang(j));
    geom = { cxc, cyc, R, P, n, PX, PY, openOf, closeOf, path, W };

    const next = makeSvg(`0 0 ${W} ${W}`);

    const chordEls = [];
    for (let p = 0; p < n; p++) {
      const a = openOf[p];
      const b = closeOf[p];
      const chord = svgEl("line", { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: "chord" });
      register(registry, p, chord);
      next.appendChild(chord);
      const hit = svgEl("line", { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: "chord-hit" });
      makeInteractive(hit, p, callbacks, null);
      next.appendChild(hit);
      chordEls.push([chord, hit]);
    }

    for (let j = 0; j < P; j++) {
      next.appendChild(svgEl("circle", { cx: PX(j), cy: PY(j), r: 4, class: "cpoint" }));
    }

    plus = makeAffordButton("grow", "+");
    minus = makeAffordButton("shrink", "−");
    next.appendChild(plus);
    next.appendChild(minus);
    next.addEventListener("pointermove", onMove);
    next.addEventListener("pointerleave", () => {
      hideAffordButton(plus);
      hideAffordButton(minus);
    });

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    const swap = opts.animate && opts.edit && opts.edit.type === "swap" && opts.prevPath;
    if (swap) animateSwap(analyze(opts.prevPath), chordEls);
  }

  // A swap reconnects the chords touching the moved point. Points stay fixed, so
  // each changed chord's endpoints slide along the circle (shortest way) from
  // the points they used to join to the points they now join.
  function animateSwap(old, chordEls) {
    const { P, PX, PY, openOf, closeOf, n } = geom;
    const short = (from, to) => {
      let d = to - from;
      if (d > P / 2) d -= P;
      if (d < -P / 2) d += P;
      return d;
    };
    const moves = [];
    for (let p = 0; p < n; p++) {
      if (old.openOf[p] === openOf[p] && old.closeOf[p] === closeOf[p]) continue;
      moves.push({
        els: chordEls[p],
        a0: old.openOf[p],
        b0: old.closeOf[p],
        da: short(old.openOf[p], openOf[p]),
        db: short(old.closeOf[p], closeOf[p]),
      });
    }
    if (!moves.length) return;
    const setAt = (m, e) => {
      const ai = m.a0 + m.da * e;
      const bi = m.b0 + m.db * e;
      for (const el of m.els) {
        el.setAttribute("x1", PX(ai));
        el.setAttribute("y1", PY(ai));
        el.setAttribute("x2", PX(bi));
        el.setAttribute("y2", PY(bi));
      }
    };
    moves.forEach((m) => setAt(m, 0));
    cancelAnim = tween(
      380,
      (e) => moves.forEach((m) => setAt(m, e)),
      () => {
        moves.forEach((m) => setAt(m, 1));
        cancelAnim = null;
      }
    );
  }

  function onMove(e) {
    if (!geom) return;
    const { cxc, cyc, R, P, n, PX, PY, openOf, closeOf, path, W } = geom;
    const rect = svg.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    const vby = ((e.clientY - rect.top) / rect.height) * W;
    hideAffordButton(plus);
    hideAffordButton(minus);

    // nearest short chord (adjacent points = a peak) -> remove
    let best = -1;
    let bestD = Infinity;
    let bmx = 0;
    let bmy = 0;
    for (let p = 0; p < n; p++) {
      if (closeOf[p] !== openOf[p] + 1) continue;
      const mx = (PX(openOf[p]) + PX(closeOf[p])) / 2;
      const my = (PY(openOf[p]) + PY(closeOf[p])) / 2;
      const d = Math.hypot(vbx - mx, vby - my);
      if (d < bestD) {
        bestD = d;
        best = p;
        bmx = mx;
        bmy = my;
      }
    }
    if (best >= 0 && bestD < 22) {
      showAffordButton(minus, bmx, bmy, callbacks.onEdit, () => ({ type: "delete", at: openOf[best] }));
      return;
    }

    // otherwise a "+" at the nearest arc gap between two points
    let t = (Math.atan2(vby - cyc, vbx - cxc) * 180) / Math.PI + 90;
    t = (((t / 360) % 1) + 1) % 1;
    t *= P;
    const s = Math.floor(t); // between point s and s+1
    const g = s + 1; // insert new points before index g
    const gapAngle = (-90 + ((s + 0.5) * 360) / P) * (Math.PI / 180);
    const gx = cxc + (R + 16) * Math.cos(gapAngle);
    const gy = cyc + (R + 16) * Math.sin(gapAngle);
    showAffordButton(plus, gx, gy, callbacks.onEdit, () => ({ type: "insert", kind: "peak", at: g }));
  }

  return {
    setPath,
    highlight(pairId) {
      const range = pairId === null || pairId === undefined ? null : rangeOf[pairId];
      currentEls = applyHighlight(registry, currentEls, range);
    },
    destroy() {
      if (svg) svg.remove();
    },
  };
}
