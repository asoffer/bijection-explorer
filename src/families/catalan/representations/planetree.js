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

const lerp = (a, b, e) => a + (b - a) * e;

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
            type: "remove",
            kind: "peak",
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
    // Move every vertex from (sx,sy) to (ex,ey), then redraw each edge from its
    // (interpolated) parent and child; pan the viewBox between the two frames.
    const stepVerts = (e, oldW, oldH) => {
      next.setAttribute("viewBox", `0 0 ${lerp(oldW, W, e)} ${lerp(oldH, H, e)}`);
      for (const v of verts) {
        v.cx = lerp(v.sx, v.ex, e);
        v.cy = lerp(v.sy, v.ey, e);
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

    const ed = opts.animate && opts.edit && opts.prevPath ? opts.edit : null;
    if (ed && ed.type === "swap") animateSwap(opts.prevPath);
    else if (ed && ed.type === "insert") animateGrow(opts.prevPath, ed);
    else if (ed && ed.type === "remove") animateShrink(opts.prevPath, ed);
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
