import { analyze, subtreeRange } from "../model.js";
import { pathToTree, layoutTree } from "../tree.js";
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
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
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
      e.el = svgEl("line", {
        x1: X(e.from.x),
        y1: Y(e.from.depth),
        x2: X(e.to.x),
        y2: Y(e.to.depth),
        class: "branch",
      });
      next.appendChild(e.el);
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
          showAffordButton(plus, X(node.x), Y(node.depth) + 20, callbacks.onEdit, () => ({
            type: "insert",
            kind: "peak",
            at: node.pos,
          }))
        );
        next.appendChild(rect);
        node.el = rect;
        continue;
      }
      const c = svgEl("circle", { cx: X(node.x), cy: Y(node.depth), r: 13, class: "treenode" });
      register(registry, node.pair, c);
      makeInteractive(c, node.pair, callbacks, () => {
        callbacks.onEdit({ type: "rotate", pair: node.pair });
      });
      // a leaf-pair (cherry) node can be pruned back to a single leaf
      const isCherry = closeOf[node.pair] === openOf[node.pair] + 1;
      if (isCherry) {
        c.addEventListener("pointerenter", () =>
          showAffordButton(minus, X(node.x) + 20, Y(node.depth) - 18, callbacks.onEdit, () => ({
            type: "delete",
            at: openOf[node.pair],
          }))
        );
      }
      next.appendChild(c);
      node.el = c;
    }

    // A swap is a rotation. In-order position (x) is preserved by a rotation, so
    // every node keeps its column and only its depth changes: match old and new
    // nodes by x, slide each to its new depth, and redraw the branches (whose
    // parent/child links changed) each frame from the moving endpoints.
    function animateSwap(prevPath) {
      const oldA = analyze(prevPath);
      const oldLayout = layoutTree(pathToTree(prevPath, oldA.pairOfStep));
      const oldDepthByX = new Map(oldLayout.nodes.map((nd) => [nd.x, nd.depth]));
      // Tree height changes with a rotation, so the viewBox differs old vs new;
      // tween it so frame 0 matches the image that was on screen.
      const oldW = Math.max(oldLayout.width, 1) * unit + pad * 2;
      const oldH = Math.max(oldLayout.height, 1) * unit + pad * 2;
      let moved = false;
      for (const nd of nodes) {
        nd.d0 = oldDepthByX.has(nd.x) ? oldDepthByX.get(nd.x) : nd.depth;
        nd.d1 = nd.depth;
        if (nd.d0 !== nd.d1) moved = true;
      }
      if (!moved) return false;

      const place = (nd, d) => {
        if (nd.leaf) nd.el.setAttribute("y", Y(d) - 5);
        else nd.el.setAttribute("cy", Y(d));
      };
      const frame = (t) => {
        next.setAttribute("viewBox", `0 0 ${oldW + (W - oldW) * t} ${oldH + (H - oldH) * t}`);
        for (const nd of nodes) {
          nd.cd = nd.d0 + (nd.d1 - nd.d0) * t;
          place(nd, nd.cd);
        }
        for (const e of edges) {
          e.el.setAttribute("y1", Y(e.from.cd));
          e.el.setAttribute("y2", Y(e.to.cd));
        }
      };
      frame(0);
      cancelAnim = tween(400, frame, () => {
        frame(1);
        cancelAnim = null;
      });
      return true;
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

    const swap = opts.animate && opts.edit && opts.edit.type === "swap" && opts.prevPath;
    if (swap) animateSwap(opts.prevPath);
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
