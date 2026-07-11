import { analyze, subtreeRange } from "../model.js";
import { pathToTree, layoutTree } from "../tree.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import {
  makeRegistry,
  register,
  applyHighlight,
  makeInteractive,
  affordMenu,
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
  let menu = null;
  let cancelAnim = null;

  function setPath(path, opts = {}) {
    if (cancelAnim) cancelAnim();
    if (menu) menu.destroy();
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
    menu = affordMenu(next, callbacks.onEdit);

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
      const cx = X(node.x);
      const cy = Y(node.depth);
      if (node.leaf) {
        const rect = svgEl("rect", { x: cx - 5, y: cy - 5, width: 10, height: 10, class: "leaf" });
        next.appendChild(rect);
        node.el = rect;
        // generous transparent halo → a hoverable leaf that sprouts on "+"
        const halo = svgEl("circle", { cx, cy, r: 16, class: "afford-hit" });
        menu.anchor(halo, `leaf${node.pos}`, cx, cy, () => [
          { cls: "grow", glyph: "+", x: cx, y: cy + 24, produce: () => ({ type: "insert", kind: "peak", at: node.pos }) },
        ]);
        next.appendChild(halo);
        continue;
      }
      const c = svgEl("circle", { cx, cy, r: 13, class: "treenode" });
      register(registry, node.pair, c);
      makeInteractive(c, node.pair, callbacks, () => {
        callbacks.onEdit({ type: "rotate", pair: node.pair });
      });
      // a leaf-pair (cherry) node can be pruned back to a single leaf
      if (closeOf[node.pair] === openOf[node.pair] + 1) {
        menu.anchor(c, `n${node.pair}`, cx, cy, () => [
          { cls: "shrink", glyph: "−", x: cx + 24, y: cy - 22, produce: () => ({ type: "remove", kind: "peak", at: openOf[node.pair] }) },
        ]);
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

    // Place a node element (leaf rect or internal circle) at a pixel point.
    const putNode = (el, leaf, px, py) => {
      if (leaf) {
        el.setAttribute("x", px - 5);
        el.setAttribute("y", py - 5);
      } else {
        el.setAttribute("cx", px);
        el.setAttribute("cy", py);
      }
    };
    // Slide every node from its start point to its final one, then redraw every
    // branch from the moved endpoints. `pointOf` returns [start, final] per node.
    const morphFrame = (t, pointOf) => {
      for (const nd of nodes) {
        const [s, f] = pointOf(nd);
        nd.cx = s[0] + (f[0] - s[0]) * t;
        nd.cy = s[1] + (f[1] - s[1]) * t;
        putNode(nd.el, nd.leaf, nd.cx, nd.cy);
      }
      for (const e of edges) {
        e.el.setAttribute("x1", e.from.cx);
        e.el.setAttribute("y1", e.from.cy);
        e.el.setAttribute("x2", e.to.cx);
        e.el.setAttribute("y2", e.to.cy);
      }
    };
    const oldFrame = (prevPath) => {
      const oldA = analyze(prevPath);
      const oldLayout = layoutTree(pathToTree(prevPath, oldA.pairOfStep));
      return { oldA, oldLayout, oldW: Math.max(oldLayout.width, 1) * unit + pad * 2, oldH: Math.max(oldLayout.height, 1) * unit + pad * 2 };
    };
    const lerp = (a, b, t) => a + (b - a) * t;

    // Insert: a hovered leaf sprouts into an internal node with two leaf
    // children. In-order index is preserved left of the leaf and shifts by two
    // to its right, with no depth change — so the left of the tree holds still,
    // the right slides over by one node-pair, and the new node + its two leaves
    // unfold out of the old leaf's spot (which dissolves as they grow in).
    function animateSprout(prevPath, edit) {
      const { oldLayout, oldW, oldH } = oldFrame(prevPath);
      const leaf = oldLayout.nodes.find((nd) => nd.leaf && nd.pos === edit.at);
      if (!leaf) return;
      const p = leaf.x;
      const d = leaf.depth;
      const sprout = (nd) => nd.x >= p && nd.x <= p + 2;
      const pointOf = (nd) => {
        const f = [X(nd.x), Y(nd.depth)];
        if (nd.x < p) return [f, f]; // static
        if (nd.x <= p + 2) return [[X(p), Y(d)], f]; // unfolds from the old leaf
        return [[X(nd.x - 2), Y(nd.depth)], f]; // tail slid in from the left
      };

      const ghost = svgEl("rect", { width: 10, height: 10, class: "leaf" });
      next.appendChild(ghost);
      putNode(ghost, true, X(p), Y(d));

      next.style.overflow = "hidden";
      const frame = (t) => {
        next.setAttribute("viewBox", `0 0 ${lerp(oldW, W, t)} ${lerp(oldH, H, t)}`);
        morphFrame(t, pointOf);
        for (const nd of nodes) if (sprout(nd)) nd.el.style.opacity = String(t);
        ghost.style.opacity = String(1 - t);
      };
      frame(0);
      cancelAnim = tween(360, frame, () => {
        next.style.overflow = "";
        for (const nd of nodes) if (sprout(nd)) nd.el.style.opacity = "";
        ghost.remove();
        cancelAnim = null;
      });
    }

    // Remove: a cherry (internal node with two leaf children) is pruned back to
    // a single leaf. The mirror of a sprout: the right of the tree slides back in
    // by one node-pair while the two child leaves and their branches fold up into
    // the parent and fade, leaving a leaf that settles into the freed spot.
    function animatePrune(prevPath, edit) {
      const { oldA, oldLayout, oldW, oldH } = oldFrame(prevPath);
      const N = oldLayout.nodes.find((nd) => !nd.leaf && nd.pair === oldA.pairOfStep[edit.at]);
      if (!N) return;
      const xN = N.x;
      const d = N.depth;
      const p = xN - 1; // the merged leaf's new in-order index
      const merge = [X(xN), Y(d)]; // where N sat; the cherry folds up here
      const pointOf = (nd) => {
        const f = [X(nd.x), Y(nd.depth)];
        if (nd.x < p) return [f, f]; // static
        if (nd.x === p) return [[...merge], f]; // merged leaf slides out of N's spot
        return [[X(nd.x + 2), Y(nd.depth)], f]; // tail slid in from the right
      };
      const merged = nodes.find((nd) => nd.x === p);

      const gC = svgEl("circle", { r: 13, class: "treenode" });
      const gL1 = svgEl("rect", { width: 10, height: 10, class: "leaf" });
      const gL2 = svgEl("rect", { width: 10, height: 10, class: "leaf" });
      const gB1 = svgEl("line", { class: "branch" });
      const gB2 = svgEl("line", { class: "branch" });
      for (const el of [gB1, gB2, gC, gL1, gL2]) next.appendChild(el);
      const child = (col, t) => [lerp(X(col), merge[0], t), lerp(Y(d + 1), merge[1], t)];

      next.style.overflow = "hidden";
      const frame = (t) => {
        next.setAttribute("viewBox", `0 0 ${lerp(oldW, W, t)} ${lerp(oldH, H, t)}`);
        morphFrame(t, pointOf);
        if (merged) merged.el.style.opacity = String(t); // fade the new leaf in
        const l1 = child(xN - 1, t);
        const l2 = child(xN + 1, t);
        putNode(gL1, true, l1[0], l1[1]);
        putNode(gL2, true, l2[0], l2[1]);
        putNode(gC, false, merge[0], merge[1]);
        for (const [b, l] of [[gB1, l1], [gB2, l2]]) {
          b.setAttribute("x1", merge[0]);
          b.setAttribute("y1", merge[1]);
          b.setAttribute("x2", l[0]);
          b.setAttribute("y2", l[1]);
        }
        const op = String(1 - t);
        for (const el of [gC, gL1, gL2, gB1, gB2]) el.style.opacity = op;
      };
      frame(0);
      cancelAnim = tween(360, frame, () => {
        next.style.overflow = "";
        if (merged) merged.el.style.opacity = "";
        for (const el of [gC, gL1, gL2, gB1, gB2]) el.remove();
        cancelAnim = null;
      });
    }

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    const e = opts.animate && opts.edit && opts.prevPath ? opts.edit : null;
    if (e && e.type === "swap") animateSwap(opts.prevPath);
    else if (e && e.type === "insert") animateSprout(opts.prevPath, e);
    else if (e && e.type === "remove") animatePrune(opts.prevPath, e);
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
