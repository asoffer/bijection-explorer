import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeRegistry, register, applyHighlight, makeInteractive } from "../../../core/view.js";

export const meta = {
  id: "matrix",
  name: "Permutation matrix",
  blurb:
    "One dot per column i at height p_i — the graph of the permutation. Its alternating shape shows as a zig-zag of peaks and valleys. Shares the grid-and-dot rendering with the Catalan 312-avoiding view. Hover a dot to find its counterpart.",
};

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];

  function setPath(perm) {
    registry.clear();
    currentEls = [];
    const n = perm.length;

    const unit = 38;
    const pad = 30;
    const W = Math.max(n, 1) * unit + pad * 2;
    const H = Math.max(n, 1) * unit + pad * 2;
    const X = (i) => pad + i * unit + unit / 2; // column (position)
    const Y = (v) => pad + (n - v) * unit + unit / 2; // row (value), high = up

    const next = makeSvg(`0 0 ${W} ${H}`);

    // light grid
    for (let i = 0; i <= n; i++) {
      next.appendChild(
        svgEl("line", { x1: pad + i * unit, y1: pad, x2: pad + i * unit, y2: H - pad, class: "grid" })
      );
      next.appendChild(
        svgEl("line", { x1: pad, y1: pad + i * unit, x2: W - pad, y2: pad + i * unit, class: "grid" })
      );
    }

    // dot per (position i, value p_i)
    for (let i = 0; i < n; i++) {
      const v = perm[i];
      const g = svgEl("g", { class: "permpt interactive" });
      g.appendChild(svgEl("circle", { cx: X(i), cy: Y(v), r: 11, class: "permdot" }));
      const label = svgEl("text", {
        x: X(i),
        y: Y(v),
        class: "permlabel",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = String(v);
      g.appendChild(label);
      register(registry, i, g);
      makeInteractive(g, i, callbacks, null);
      next.appendChild(g);
    }

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
  }

  return {
    setPath,
    highlight(pairId) {
      const range = pairId === null || pairId === undefined ? null : [pairId, pairId];
      currentEls = applyHighlight(registry, currentEls, range);
    },
    destroy() {
      if (svg) svg.remove();
    },
  };
}
