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
} from "../../../core/view.js";

export const meta = {
  id: "syt",
  name: "Young tableau pair",
  blurb:
    "A pair (P, Q) of standard Young tableaux of the same shape with ≤2 rows. Split the path at its midpoint: the first half rows P, the second (reversed) rows Q. Hover to add or remove a box.",
};

// row-word of P (first half) and Q (second half, reversed and flipped); 1 = row 1.
function pathToPair(path) {
  const n = path.length / 2;
  const p = [];
  const q = [];
  for (let i = 0; i < n; i++) p.push(path[i] === U ? 1 : 2);
  for (let j = 1; j <= n; j++) q.push(path[2 * n - j] === -1 ? 1 : 2);
  return { p, q, n };
}

function pairToPath(p, q) {
  const n = p.length;
  const F = p.map((x) => (x === 1 ? 1 : -1));
  const S = [];
  for (let m = 0; m < n; m++) S.push(q[n - 1 - m] === 1 ? -1 : 1);
  return F.concat(S);
}

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let plus1 = null;
  let plus2 = null;
  let minus = null;
  let geom = null;

  function setPath(path) {
    registry.clear();
    currentEls = [];
    const { openOf, closeOf, pairOfStep, n } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    const { p, q } = pathToPair(path);
    const a1 = p.filter((x) => x === 1).length;
    const a2 = n - a1;

    const cs = 32;
    const gap = 30;
    const padX = 24;
    const padY = 24;
    const labelH = 22;
    const rowY1 = padY + labelH;
    const rowY2 = rowY1 + cs;
    const qX = padX + a1 * cs + gap;
    const W = qX + a1 * cs + padX + 34;
    const H = rowY2 + cs + padY;
    const N = path.length;

    const next = makeSvg(`0 0 ${W} ${H}`);

    // draw one tableau; ballot -> row assignment; pairFor(value) gives the pair id
    function drawTableau(x0, ballot, labelText, pairFor) {
      const label = svgEl("text", { x: x0, y: padY + 4, class: "syt-title" });
      label.textContent = labelText;
      next.appendChild(label);
      const cols = { 1: 0, 2: 0 };
      for (let v = 1; v <= n; v++) {
        const row = ballot[v - 1];
        const col = cols[row]++;
        const cx = x0 + col * cs;
        const cy = row === 1 ? rowY1 : rowY2;
        const g = svgEl("g", { class: "syt-cell interactive" });
        g.appendChild(svgEl("rect", { x: cx, y: cy, width: cs, height: cs, rx: 3, class: "syt-box" }));
        const t = svgEl("text", {
          x: cx + cs / 2,
          y: cy + cs / 2,
          class: "syt-num",
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        t.textContent = String(v);
        g.appendChild(t);
        const pid = pairFor(v);
        register(registry, pid, g);
        makeInteractive(g, pid, callbacks, null);
        next.appendChild(g);
      }
    }

    drawTableau(padX, p, "P", (v) => pairOfStep[v - 1]);
    drawTableau(qX, q, "Q", (v) => pairOfStep[N - v]);

    // affordances: extend row 1 / row 2 of the pair, or remove the largest box.
    const rowNofN = p[n - 1]; // n sits at the end of this row in P
    const removable = n >= 2 && p[n - 1] === q[n - 1];
    geom = {
      plus1At: { x: qX + a1 * cs + 14, y: rowY1 + cs / 2 },
      plus2At: { x: qX + a2 * cs + 14, y: rowY2 + cs / 2 },
      canPlus2: a1 > a2,
      minusAt: {
        x: padX + ((rowNofN === 1 ? a1 : a2) - 1) * cs + cs,
        y: (rowNofN === 1 ? rowY1 : rowY2) - 6,
      },
      removable,
      grow1: () => pairToPath([...p, 1], [...q, 1]),
      grow2: () => pairToPath([...p, 2], [...q, 2]),
      shrink: () => pairToPath(p.slice(0, -1), q.slice(0, -1)),
    };

    plus1 = makeAffordButton("grow", "+");
    plus2 = makeAffordButton("grow", "+");
    minus = makeAffordButton("shrink", "−");
    next.appendChild(plus1);
    next.appendChild(plus2);
    next.appendChild(minus);
    next.addEventListener("pointermove", showAfford);
    next.addEventListener("pointerleave", hideAfford);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
  }

  function showAfford() {
    if (!geom) return;
    showAffordButton(plus1, geom.plus1At.x, geom.plus1At.y, callbacks.onEdit, geom.grow1);
    if (geom.canPlus2) {
      showAffordButton(plus2, geom.plus2At.x, geom.plus2At.y, callbacks.onEdit, geom.grow2);
    }
    if (geom.removable) {
      showAffordButton(minus, geom.minusAt.x, geom.minusAt.y, callbacks.onEdit, geom.shrink);
    }
  }

  function hideAfford() {
    hideAffordButton(plus1);
    hideAffordButton(plus2);
    hideAffordButton(minus);
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
