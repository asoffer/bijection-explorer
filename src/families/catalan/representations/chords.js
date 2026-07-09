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

    const pointEls = [];
    for (let j = 0; j < P; j++) {
      const c = svgEl("circle", { cx: PX(j), cy: PY(j), r: 4, class: "cpoint" });
      next.appendChild(c);
      pointEls.push(c);
    }

    // Grow / shrink by one chord. Inserting or removing two adjacent points
    // reshuffles every point's slot around the (fixed-size) circle, so all points
    // slide to their new angles; the added chord and its two points fade in at the
    // gap, or the removed short chord collapses to a point and fades out.
    function animateResize(edit, prevPath) {
      const grow = edit.type === "insert";
      const oldP = prevPath.length;
      const at = edit.at; // the two new / removed points are `at`, `at+1`
      const ang = (j, PP) => (-90 + (j * 360) / PP) * (Math.PI / 180);
      const pos = (a) => [cxc + R * Math.cos(a), cyc + R * Math.sin(a)];
      const slerp = (a0, a1, e) => {
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return a0 + d * e;
      };
      const oldAngleOf = (j) => {
        if (grow) return j === at || j === at + 1 ? null : ang(j < at ? j : j - 2, oldP);
        return ang(j < at ? j : j + 2, oldP);
      };
      const newPoints = grow ? new Set([at, at + 1]) : new Set();
      let newChord = -1;
      if (grow)
        for (let p = 0; p < n; p++) {
          const a = openOf[p];
          const b = closeOf[p];
          if ((a === at && b === at + 1) || (a === at + 1 && b === at)) {
            newChord = p;
            break;
          }
        }

      let ghost = null;
      if (!grow) {
        const gChord = svgEl("line", { class: "chord" });
        const gp1 = svgEl("circle", { r: 4, class: "cpoint" });
        const gp2 = svgEl("circle", { r: 4, class: "cpoint" });
        next.appendChild(gChord);
        next.appendChild(gp1);
        next.appendChild(gp2);
        const a1 = ang(at, oldP);
        const a2 = ang(at + 1, oldP);
        ghost = { gChord, gp1, gp2, a1, a2, mid: (a1 + a2) / 2 };
      }

      const cpos = new Array(P);
      const frame = (e) => {
        for (let j = 0; j < P; j++) {
          const oa = oldAngleOf(j);
          const p = oa === null ? pos(ang(j, P)) : pos(slerp(oa, ang(j, P), e));
          cpos[j] = p;
          pointEls[j].setAttribute("cx", p[0]);
          pointEls[j].setAttribute("cy", p[1]);
          if (newPoints.has(j)) pointEls[j].style.opacity = String(e);
        }
        for (let p = 0; p < n; p++) {
          const a = cpos[openOf[p]];
          const b = cpos[closeOf[p]];
          for (const el of chordEls[p]) {
            el.setAttribute("x1", a[0]);
            el.setAttribute("y1", a[1]);
            el.setAttribute("x2", b[0]);
            el.setAttribute("y2", b[1]);
          }
          if (p === newChord) chordEls[p][0].style.opacity = String(e);
        }
        if (ghost) {
          const p1 = pos(slerp(ghost.a1, ghost.mid, e));
          const p2 = pos(slerp(ghost.a2, ghost.mid, e));
          ghost.gp1.setAttribute("cx", p1[0]);
          ghost.gp1.setAttribute("cy", p1[1]);
          ghost.gp2.setAttribute("cx", p2[0]);
          ghost.gp2.setAttribute("cy", p2[1]);
          ghost.gChord.setAttribute("x1", p1[0]);
          ghost.gChord.setAttribute("y1", p1[1]);
          ghost.gChord.setAttribute("x2", p2[0]);
          ghost.gChord.setAttribute("y2", p2[1]);
          const op = String(1 - e);
          ghost.gp1.style.opacity = op;
          ghost.gp2.style.opacity = op;
          ghost.gChord.style.opacity = op;
        }
      };
      frame(0);
      cancelAnim = tween(360, frame, () => {
        for (const j of newPoints) pointEls[j].style.opacity = "";
        if (newChord >= 0) chordEls[newChord][0].style.opacity = "";
        if (ghost) {
          ghost.gChord.remove();
          ghost.gp1.remove();
          ghost.gp2.remove();
        }
        cancelAnim = null;
      });
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

    const ed = opts.animate && opts.edit && opts.prevPath ? opts.edit : null;
    if (ed && ed.type === "swap") animateSwap(analyze(opts.prevPath), chordEls);
    else if (ed && (ed.type === "insert" || ed.type === "remove")) animateResize(ed, opts.prevPath);
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
      showAffordButton(minus, bmx, bmy, callbacks.onEdit, () => ({ type: "remove", kind: "peak", at: openOf[best] }));
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
