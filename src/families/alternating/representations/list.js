import { svgEl, makeSvg } from "../../../core/svg.js";
import { makeRegistry, register, applyHighlight, makeInteractive } from "../../../core/view.js";

export const meta = {
  id: "list",
  name: "One-line notation",
  blurb:
    "The permutation written out as a list p₁ p₂ … pₙ. Being alternating means the values rise and fall in strict turn: p₁ > p₂ < p₃ > p₄ < … . Hover a term to find it on the other side.",
};

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];

  function setPath(perm) {
    registry.clear();
    currentEls = [];
    const n = perm.length;

    const box = 40; // number token size
    const gap = 26; // space between tokens (holds the comparator)
    const padX = 20;
    const padY = 24;
    const step = box + gap;
    const W = padX * 2 + n * box + (n - 1) * gap;
    const H = padY * 2 + box;
    const cx = (i) => padX + i * step + box / 2;
    const cy = padY + box / 2;

    const next = makeSvg(`0 0 ${W} ${H}`);

    // comparators between consecutive terms: > at even gaps, < at odd gaps
    for (let i = 0; i + 1 < n; i++) {
      const t = svgEl("text", {
        x: (cx(i) + cx(i + 1)) / 2,
        y: cy,
        class: "alt-cmp",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      t.textContent = i % 2 === 0 ? "›" : "‹";
      next.appendChild(t);
    }

    // number tokens
    for (let i = 0; i < n; i++) {
      const g = svgEl("g", { class: "alt-term interactive" });
      g.appendChild(
        svgEl("rect", {
          x: cx(i) - box / 2,
          y: cy - box / 2,
          width: box,
          height: box,
          rx: 9,
          class: "alt-term-box",
        })
      );
      const label = svgEl("text", {
        x: cx(i),
        y: cy,
        class: "alt-term-num",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = String(perm[i]);
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
