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
  tween,
} from "../../../core/view.js";

export const meta = {
  id: "planetree",
  name: "Plane tree",
  blurb:
    "An ordered rooted tree with n+1 vertices. Walk it depth-first: up = descend into a new child edge, down = return. Hover a vertex to add a child, or a leaf to prune it.",
};

// Each up-step descends into a fresh child edge (carrying that pair id); each
// down-step returns to the parent.
function pathToPlaneTree(path) {
  const root = { children: [], parent: null, pair: null, depth: 0 };
  let cur = root;
  let pc = 0;
  for (const s of path) {
    if (s === U) {
      const c = { children: [], parent: cur, pair: pc++, depth: cur.depth + 1 };
      cur.children.push(c);
      cur = c;
    } else {
      cur = cur.parent;
    }
  }
  return root;
}

// Assign each vertex an x (leaves left-to-right; internal = midpoint of children)
// and record the tree's width and max depth.
function layoutPlaneTree(root) {
  let width = 0;
  let maxD = 0;
  (function assign(v) {
    maxD = Math.max(maxD, v.depth);
    if (!v.children.length) {
      v.x = width++;
    } else {
      v.children.forEach(assign);
      v.x = (v.children[0].x + v.children[v.children.length - 1].x) / 2;
    }
  })(root);
  return { width, maxD };
}

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
    const { openOf, closeOf, n } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    const root = pathToPlaneTree(path);

    const { width: xc, maxD } = layoutPlaneTree(root);

    const unit = 46;
    const pad = 34;
    const W = Math.max(xc, 1) * unit + pad * 2;
    const H = (maxD + 1) * unit + pad * 2;
    const X = (x) => pad + x * unit + unit / 2;
    const Y = (d) => pad + d * unit + unit / 2;

    const next = makeSvg(`0 0 ${W} ${H}`);

    (function drawEdges(v) {
      for (const c of v.children) {
        const line = svgEl("line", {
          x1: X(v.x),
          y1: Y(v.depth),
          x2: X(c.x),
          y2: Y(c.depth),
          class: "branch interactive",
        });
        register(registry, c.pair, line);
        makeInteractive(line, c.pair, callbacks, null);
        next.appendChild(line);
        c.edgeEl = line; // the edge from this vertex's parent
        drawEdges(c);
      }
    })(root);

    const verts = [];
    (function collect(v) {
      verts.push(v);
      v.children.forEach(collect);
    })(root);

    for (const v of verts) {
      const isRoot = v.pair === null;
      const dot = svgEl("circle", {
        cx: X(v.x),
        cy: Y(v.depth),
        r: isRoot ? 7 : 6,
        class: isRoot ? "ptree-root" : "ptree-node interactive",
      });
      if (!isRoot) {
        register(registry, v.pair, dot);
        makeInteractive(dot, v.pair, callbacks, null);
      }
      dot.addEventListener("pointerenter", () => {
        const addPos = isRoot ? path.length : closeOf[v.pair];
        showAffordButton(plus, X(v.x), Y(v.depth) + 22, callbacks.onEdit, () => ({
          type: "insert",
          kind: "peak",
          at: addPos,
        }));
        if (!isRoot && v.children.length === 0) {
          showAffordButton(minus, X(v.x) + 20, Y(v.depth) - 18, callbacks.onEdit, () => ({
            type: "delete",
            at: openOf[v.pair],
          }));
        }
      });
      next.appendChild(dot);
      v.dotEl = dot;
    }

    // A swap promotes a vertex from child-of-X to sibling-of-X (or the reverse):
    // its subtree slides to the new location and its edge swings from the old
    // parent to the new one. Match vertices by pair id, tween all positions, and
    // redraw each edge each frame from its (interpolated) parent and child.
    function animateSwap(prevPath) {
      const oldRoot = pathToPlaneTree(prevPath);
      const oldL = layoutPlaneTree(oldRoot);
      // The tree's width/height change, so the viewBox differs old vs new. Tween
      // it too, otherwise frame 0 would be scaled unlike the image on screen.
      const oldW = Math.max(oldL.width, 1) * unit + pad * 2;
      const oldH = (oldL.maxD + 1) * unit + pad * 2;
      const oldPos = new Map();
      let oldRootPos = null;
      (function walk(v) {
        if (v.pair === null) oldRootPos = { x: v.x, depth: v.depth };
        else oldPos.set(v.pair, { x: v.x, depth: v.depth });
        v.children.forEach(walk);
      })(oldRoot);

      let moved = false;
      for (const v of verts) {
        const o = v.pair === null ? oldRootPos : oldPos.get(v.pair);
        v.sx = X(o ? o.x : v.x);
        v.sy = Y(o ? o.depth : v.depth);
        v.ex = X(v.x);
        v.ey = Y(v.depth);
        if (v.sx !== v.ex || v.sy !== v.ey) moved = true;
      }
      if (!moved) return false;

      const frame = (e) => {
        next.setAttribute("viewBox", `0 0 ${oldW + (W - oldW) * e} ${oldH + (H - oldH) * e}`);
        for (const v of verts) {
          v.cx = v.sx + (v.ex - v.sx) * e;
          v.cy = v.sy + (v.ey - v.sy) * e;
          v.dotEl.setAttribute("cx", v.cx);
          v.dotEl.setAttribute("cy", v.cy);
        }
        for (const v of verts) {
          if (!v.edgeEl || !v.parent) continue;
          v.edgeEl.setAttribute("x1", v.parent.cx);
          v.edgeEl.setAttribute("y1", v.parent.cy);
          v.edgeEl.setAttribute("x2", v.cx);
          v.edgeEl.setAttribute("y2", v.cy);
        }
      };
      frame(0);
      cancelAnim = tween(400, frame, () => {
        frame(1);
        cancelAnim = null;
      });
      return true;
    }

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
