import { analyze, subtreeRange, insertPeak, deletePeak } from "../model.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import {
  makeRegistry,
  register,
  applyHighlight,
  makeInteractive,
  makeAffordButton,
  showAffordButton,
  hideAffordButton,
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

  function setPath(path) {
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

    for (let p = 0; p < n; p++) {
      const a = openOf[p];
      const b = closeOf[p];
      const chord = svgEl("line", { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: "chord" });
      register(registry, p, chord);
      next.appendChild(chord);
      const hit = svgEl("line", { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: "chord-hit" });
      makeInteractive(hit, p, callbacks, null);
      next.appendChild(hit);
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
      showAffordButton(minus, bmx, bmy, callbacks.onEdit, () => deletePeak(path, openOf[best]));
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
    showAffordButton(plus, gx, gy, callbacks.onEdit, () => insertPeak(path, g));
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
