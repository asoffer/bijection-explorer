import { analyze, subtreeRange, insertPeak, deletePeak } from "../model.js";
import { pathToTree, treeToPath, rotateAtPair, layoutTree } from "../tree.js";
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
  id: "tree",
  name: "Binary tree",
  blurb:
    "A full binary tree with n internal nodes, from the grammar w = U·a·D·b. Click a node to rotate it, hover a leaf to sprout it, or a leaf-pair node to prune it.",
};

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let plus = null;
  let minus = null;

  function setPath(path) {
    registry.clear();
    currentEls = [];
    const { pairOfStep, openOf, closeOf, n } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    const tree = pathToTree(path, pairOfStep);
    const { nodes, edges, width, height } = layoutTree(tree);

    const unit = 46;
    const pad = 34;
    const W = Math.max(width, 1) * unit + pad * 2;
    const H = Math.max(height, 1) * unit + pad * 2;
    const X = (x) => pad + x * unit + unit / 2;
    const Y = (d) => pad + d * unit + unit / 2;

    const next = makeSvg(`0 0 ${W} ${H}`);

    for (const e of edges) {
      next.appendChild(
        svgEl("line", {
          x1: X(e.from.x),
          y1: Y(e.from.depth),
          x2: X(e.to.x),
          y2: Y(e.to.depth),
          class: "branch",
        })
      );
    }

    for (const node of nodes) {
      if (node.leaf) {
        const rect = svgEl("rect", {
          x: X(node.x) - 5,
          y: Y(node.depth) - 5,
          width: 10,
          height: 10,
          class: "leaf interactive",
        });
        rect.addEventListener("pointerenter", () =>
          showAffordButton(plus, X(node.x), Y(node.depth) + 20, callbacks.onEdit, () =>
            insertPeak(path, node.pos)
          )
        );
        next.appendChild(rect);
        continue;
      }
      const c = svgEl("circle", { cx: X(node.x), cy: Y(node.depth), r: 13, class: "treenode" });
      register(registry, node.pair, c);
      makeInteractive(c, node.pair, callbacks, () => {
        callbacks.onEdit(treeToPath(rotateAtPair(tree, node.pair)));
      });
      // a leaf-pair (cherry) node can be pruned back to a single leaf
      const isCherry = closeOf[node.pair] === openOf[node.pair] + 1;
      if (isCherry) {
        c.addEventListener("pointerenter", () =>
          showAffordButton(minus, X(node.x) + 20, Y(node.depth) - 18, callbacks.onEdit, () =>
            deletePeak(path, openOf[node.pair])
          )
        );
      }
      next.appendChild(c);
    }

    // affordance buttons, on top, hidden until a leaf / cherry is hovered
    plus = makeAffordButton("grow", "+");
    minus = makeAffordButton("shrink", "−");
    next.appendChild(plus);
    next.appendChild(minus);
    next.addEventListener("pointerleave", () => {
      hideAffordButton(plus);
      hideAffordButton(minus);
    });

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
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
