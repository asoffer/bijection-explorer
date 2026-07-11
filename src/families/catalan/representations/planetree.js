import { U, analyze, subtreeRange } from "../model.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import {
  makeRegistry,
  register,
  applyHighlight,
  makeInteractive,
  affordMenu,
  tween,
  dispatchEdit,
  panViewBox,
  stepDiagram,
} from "../../../core/view.js";

export const meta = {
  id: "planetree",
  name: "Plane tree",
  blurb:
    "An ordered rooted tree with n+1 vertices. Walk it depth-first: up = descend into a new child edge, down = return. Hover a vertex to add a child (below) or a sibling on either side; hover a leaf to also prune it (above).",
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

const lerp = (a, b, e) => a + (b - a) * e;

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
    const root = pathToPlaneTree(path);

    const { width: xc, maxD } = layoutPlaneTree(root);

    const unit = 46;
    const pad = 34;
    const W = Math.max(xc, 1) * unit + pad * 2;
    const H = (maxD + 1) * unit + pad * 2;
    const X = (x) => pad + x * unit + unit / 2;
    const Y = (d) => pad + d * unit + unit / 2;

    const next = makeSvg(`0 0 ${W} ${H}`);
    menu = affordMenu(next, callbacks.onEdit);

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
      const cx = X(v.x);
      const cy = Y(v.depth);
      const dot = svgEl("circle", {
        cx,
        cy,
        r: isRoot ? 7 : 6,
        class: isRoot ? "ptree-root" : "ptree-node",
      });
      if (!isRoot) register(registry, v.pair, dot); // the dot is what lights up
      next.appendChild(dot);
      v.dotEl = dot;

      // A generous transparent halo is the actual hover/interaction surface, so
      // the node is easy to land on and the menu has slack around it.
      const halo = svgEl("circle", { cx, cy, r: 18, class: "afford-hit" });
      if (!isRoot) {
        halo.addEventListener("pointerenter", () => callbacks.onHover(v.pair));
        halo.addEventListener("pointerleave", () => callbacks.onLeave());
      }
      // Leaf insertions map to peaks in the path: a child appends at the node's
      // close step; a sibling before/after inserts just outside the node's span.
      const open = isRoot ? null : openOf[v.pair];
      const close = isRoot ? null : closeOf[v.pair];
      const isLeaf = !isRoot && v.children.length === 0;
      menu.anchor(halo, isRoot ? "root" : `v${v.pair}`, cx, cy, () => [
        // down — add a child (appended as the last child)
        { cls: "grow", glyph: "+", x: cx, y: cy + 26, produce: () => ({ type: "insert", kind: "peak", at: isRoot ? path.length : close }) },
        // left / right — add a sibling just before / after this node
        !isRoot ? { cls: "grow", glyph: "+", x: cx - 26, y: cy, produce: () => ({ type: "insert", kind: "peak", at: open }) } : null,
        !isRoot ? { cls: "grow", glyph: "+", x: cx + 26, y: cy, produce: () => ({ type: "insert", kind: "peak", at: close + 1 }) } : null,
        // up — prune this leaf back into its parent
        isLeaf ? { cls: "shrink", glyph: "−", x: cx, y: cy - 26, produce: () => ({ type: "remove", kind: "peak", at: open }) } : null,
      ]);
      next.appendChild(halo);
    }

    // How a vertex's dot is placed, and the parent→child edges to redraw during
    // a morph (each vertex owns the edge coming down from its parent).
    const placeVert = (v, x, y) => {
      v.dotEl.setAttribute("cx", x);
      v.dotEl.setAttribute("cy", y);
    };
    const morphEdges = verts.filter((v) => v.edgeEl && v.parent).map((v) => ({ el: v.edgeEl, from: v.parent, to: v }));

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

      const pan = panViewBox(next, [0, 0, oldW, oldH], [0, 0, W, H]);
      const frame = (e) => {
        pan(e);
        stepDiagram(e, verts, morphEdges, placeVert);
      };
      frame(0);
      cancelAnim = tween(400, frame, () => {
        frame(1);
        cancelAnim = null;
      });
      return true;
    }

    // Old vertex positions keyed by pair id (root kept separately), plus the
    // pair-id shift between old and new caused by inserting/removing one pair at
    // up-step `uStep`: a pair's id is unchanged before the edit point and shifts
    // by one after it.
    function oldFrame(prevPath) {
      const oldRoot = pathToPlaneTree(prevPath);
      const oldL = layoutPlaneTree(oldRoot);
      const byPair = new Map();
      let rootPos = null;
      (function walk(v) {
        if (v.pair === null) rootPos = v;
        else byPair.set(v.pair, v);
        v.children.forEach(walk);
      })(oldRoot);
      return {
        byPair,
        rootPos,
        oldW: Math.max(oldL.width, 1) * unit + pad * 2,
        oldH: (oldL.maxD + 1) * unit + pad * 2,
      };
    }
    const runResize = (frame) => {
      next.style.overflow = "hidden";
      frame(0);
      cancelAnim = tween(400, frame, () => {
        next.style.overflow = "";
        frame.cleanup && frame.cleanup();
        cancelAnim = null;
      });
    };
    // Move every vertex from (sx,sy) to (ex,ey), redraw each edge from its
    // (interpolated) parent and child, and pan the viewBox between the frames.
    const stepVerts = (e, oldW, oldH) => {
      panViewBox(next, [0, 0, oldW, oldH], [0, 0, W, H])(e);
      stepDiagram(e, verts, morphEdges, placeVert);
    };

    // Insert: a new child buds off its parent. Every other vertex slides from its
    // old spot; the newcomer starts collapsed on its parent and fades in.
    function animateGrow(prevPath, edit) {
      const { byPair, rootPos, oldW, oldH } = oldFrame(prevPath);
      const uStep = edit.kind === "valley" ? edit.at + 1 : edit.at;
      const newId = pairOfStep[uStep];
      const oldOf = (pair) => (pair === null ? rootPos : byPair.get(pair < newId ? pair : pair - 1));
      const newLeaf = verts.find((v) => v.pair === newId);
      if (!newLeaf) return false;
      for (const v of verts) {
        const o = v === newLeaf ? oldOf(v.parent.pair) : oldOf(v.pair);
        v.sx = X(o.x);
        v.sy = Y(o.depth);
        v.ex = X(v.x);
        v.ey = Y(v.depth);
      }
      newLeaf.dotEl.style.opacity = 0;
      if (newLeaf.edgeEl) newLeaf.edgeEl.style.opacity = 0;
      const frame = (e) => {
        stepVerts(e, oldW, oldH);
        newLeaf.dotEl.style.opacity = String(e);
        if (newLeaf.edgeEl) newLeaf.edgeEl.style.opacity = String(e);
      };
      frame.cleanup = () => {
        newLeaf.dotEl.style.opacity = "";
        if (newLeaf.edgeEl) newLeaf.edgeEl.style.opacity = "";
      };
      runResize(frame);
      return true;
    }

    // Remove: the pruned leaf folds into its parent as a fading ghost while the
    // rest of the tree settles.
    function animateShrink(prevPath, edit) {
      const { byPair, rootPos, oldW, oldH } = oldFrame(prevPath);
      const oldA = analyze(prevPath);
      const uStep = edit.kind === "valley" ? edit.at + 1 : edit.at;
      const removedId = oldA.pairOfStep[uStep];
      const removed = byPair.get(removedId);
      if (!removed) return false;
      const oldOf = (pair) => (pair === null ? rootPos : byPair.get(pair < removedId ? pair : pair + 1));
      for (const v of verts) {
        const o = oldOf(v.pair);
        v.sx = X(o.x);
        v.sy = Y(o.depth);
        v.ex = X(v.x);
        v.ey = Y(v.depth);
      }
      const ppair = removed.parent.pair;
      const parentNewPair = ppair === null ? null : ppair < removedId ? ppair : ppair - 1;
      const parentVert = verts.find((v) => v.pair === parentNewPair);
      const rFrom = { x: X(removed.x), y: Y(removed.depth) };
      const gDot = svgEl("circle", { r: 6, class: "ptree-node" });
      const gEdge = svgEl("line", { class: "branch" });
      next.appendChild(gEdge);
      next.appendChild(gDot);
      const frame = (e) => {
        stepVerts(e, oldW, oldH);
        const gx = lerp(rFrom.x, parentVert.cx, e);
        const gy = lerp(rFrom.y, parentVert.cy, e);
        gDot.setAttribute("cx", gx);
        gDot.setAttribute("cy", gy);
        gEdge.setAttribute("x1", parentVert.cx);
        gEdge.setAttribute("y1", parentVert.cy);
        gEdge.setAttribute("x2", gx);
        gEdge.setAttribute("y2", gy);
        gDot.style.opacity = String(1 - e);
        gEdge.style.opacity = String(1 - e);
      };
      frame.cleanup = () => {
        gDot.remove();
        gEdge.remove();
      };
      runResize(frame);
      return true;
    }

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;

    dispatchEdit(opts, {
      swap: (edit, prevPath) => animateSwap(prevPath),
      insert: (edit, prevPath) => animateGrow(prevPath, edit),
      remove: (edit, prevPath) => animateShrink(prevPath, edit),
    });
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
