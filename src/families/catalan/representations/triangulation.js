import { analyze, subtreeRange } from "../model.js";
import { pathToTree, leafCount } from "../tree.js";
import { svgEl, makeSvg } from "../../../core/svg.js";
import {
  makeRegistry,
  register,
  applyHighlight,
  makeInteractive,
  affordMenu,
  tween,
  dispatchEdit,
} from "../../../core/view.js";

export const meta = {
  id: "triangulation",
  name: "Polygon triangulation",
  blurb:
    "A triangulation of a convex (n+2)-gon: each triangle is a node, sharing the base edge (0,n+1). Hover a diagonal to flip it, a side to bevel in a new vertex, or an ear to remove it.",
};

// In-order leaf path-positions; leaf k is the boundary edge (k, k+1).
function leafPositions(tree, out) {
  if (tree.leaf) {
    out.push(tree.pos);
    return;
  }
  leafPositions(tree.left, out);
  leafPositions(tree.right, out);
}

function collectTriangles(tree, lo, hi, out) {
  if (tree.leaf) return;
  const k = lo + leafCount(tree.left);
  out.push({ a: lo, b: k, c: hi, pair: tree.pair });
  collectTriangles(tree.left, lo, k, out);
  collectTriangles(tree.right, k, hi, out);
}

// The polygon vertex that appears (on insert) or disappears (on delete) with a
// single-pair edit is the ear tip — the middle vertex of the triangle whose
// pair opens at path index `at`. Because the edit hands us `at` directly, this
// is a lookup, not a diff over two triangulations.
function earTip(path, at) {
  const { pairOfStep } = analyze(path);
  const tris = [];
  collectTriangles(pathToTree(path, pairOfStep), 0, path.length / 2 + 1, tris);
  const t = tris.find((tt) => tt.pair === pairOfStep[at]);
  return t ? t.b : -1;
}

const lerp = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let prev = null; // { M, vpos, tris } from the previous render
  let cancelAnim = null;
  let menu = null;

  function setPath(path, opts = {}) {
    registry.clear();
    currentEls = [];
    if (cancelAnim) cancelAnim();
    if (menu) menu.destroy();

    const { pairOfStep, openOf, closeOf } = analyze(path);
    const n = path.length / 2;
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    const tree = pathToTree(path, pairOfStep);
    const leafPos = [];
    leafPositions(tree, leafPos); // leaf k -> boundary edge (k, k+1)
    const M = n + 2; // polygon vertices 0..n+1

    const R = 120;
    const pad = 34;
    const cxc = R + pad;
    const cyc = R + pad;
    const W = 2 * (R + pad);
    const H = 2 * (R + pad);
    const angle = (v) => (-90 - (360 * (v - (M - 1) / 2)) / M) * (Math.PI / 180);
    const newVpos = Array.from({ length: M }, (_, v) => ({
      x: cxc + R * Math.cos(angle(v)),
      y: cyc + R * Math.sin(angle(v)),
    }));
    const outward = (p, amt) => ({
      x: cxc + ((p.x - cxc) * (R + amt)) / R,
      y: cyc + ((p.y - cyc) * (R + amt)) / R,
    });

    const next = makeSvg(`0 0 ${W} ${H}`);
    menu = affordMenu(next, callbacks.onEdit);

    const triangles = [];
    collectTriangles(tree, 0, M - 1, triangles);

    const triEls = [];
    for (const t of triangles) {
      const poly = svgEl("polygon", { class: "triangle" });
      register(registry, t.pair, poly);
      makeInteractive(poly, t.pair, callbacks, null); // hover highlights; flips live on the diagonals
      // an ear (leaf-pair node) can be removed, collapsing along its outer edge
      if (closeOf[t.pair] === openOf[t.pair] + 1) {
        const c = {
          x: (newVpos[t.a].x + newVpos[t.b].x + newVpos[t.c].x) / 3,
          y: (newVpos[t.a].y + newVpos[t.b].y + newVpos[t.c].y) / 3,
        };
        menu.anchor(poly, `tri${t.pair}`, c.x, c.y, () => [
          { cls: "shrink", glyph: "−", x: c.x, y: c.y, produce: () => ({ type: "remove", kind: "peak", at: openOf[t.pair] }) },
        ]);
      }
      next.appendChild(poly);
      triEls.push({ el: poly, a: t.a, b: t.b, c: t.c, pair: t.pair });
    }

    const edgeEls = [];
    for (let v = 0; v < M; v++) {
      const w = (v + 1) % M;
      const isBase = (v === 0 && w === M - 1) || (v === M - 1 && w === 0);
      const line = svgEl("line", { class: isBase ? "polyedge base" : "polyedge" });
      next.appendChild(line);
      edgeEls.push({ el: line, v, w });
      // a boundary side can be bevelled: insert a vertex, forming a new ear
      if (!isBase) {
        const hit = svgEl("line", { class: "edge-hit" });
        const mid = { x: (newVpos[v].x + newVpos[w].x) / 2, y: (newVpos[v].y + newVpos[w].y) / 2 };
        const btnAt = outward(mid, 24);
        menu.anchor(hit, `edge${v}`, mid.x, mid.y, () => [
          { cls: "grow", glyph: "+", x: btnAt.x, y: btnAt.y, produce: () => ({ type: "insert", kind: "peak", at: leafPos[v] }) },
        ]);
        next.appendChild(hit);
        edgeEls.push({ el: hit, v, w });
      }
    }

    const vertEls = [];
    const labelEls = [];
    for (let v = 0; v < M; v++) {
      const c = svgEl("circle", { r: 3.5, class: "pvertex" });
      next.appendChild(c);
      vertEls.push({ el: c, v });
      const label = svgEl("text", {
        class: "plabel",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = String(v);
      next.appendChild(label);
      labelEls.push({ el: label, v });
    }

    // Flip affordances live on the diagonals. Each internal (non-root) triangle's
    // base edge (lo,hi) is a diagonal shared with its parent; flipping it is a
    // rotation of the parent toward this child (a left rotation pulls up a right
    // child, a right rotation a left child).
    (function walkDiagonals(t, lo, hi, parentPair, side) {
      if (t.leaf) return;
      const k = lo + leafCount(t.left);
      if (parentPair !== null) {
        const dir = side === "right" ? "left" : "right";
        const mid = { x: (newVpos[lo].x + newVpos[hi].x) / 2, y: (newVpos[lo].y + newVpos[hi].y) / 2 };
        const hit = svgEl("line", { class: "diag-hit" });
        menu.anchor(hit, `diag${lo}-${hi}`, mid.x, mid.y, () => [
          { cls: "reshape", glyph: "⇄", x: mid.x, y: mid.y, produce: () => ({ type: "rotate", pair: parentPair, dir }) },
        ]);
        next.appendChild(hit);
        edgeEls.push({ el: hit, v: lo, w: hi }); // positioned alongside the polygon edges
      }
      walkDiagonals(t.left, lo, k, t.pair, "left");
      walkDiagonals(t.right, k, hi, t.pair, "right");
    })(tree, 0, M - 1, null, null);

    function applyPositions(vpos) {
      for (const t of triEls) {
        t.el.setAttribute(
          "points",
          `${vpos[t.a].x},${vpos[t.a].y} ${vpos[t.b].x},${vpos[t.b].y} ${vpos[t.c].x},${vpos[t.c].y}`
        );
      }
      for (const e of edgeEls) {
        e.el.setAttribute("x1", vpos[e.v].x);
        e.el.setAttribute("y1", vpos[e.v].y);
        e.el.setAttribute("x2", vpos[e.w].x);
        e.el.setAttribute("y2", vpos[e.w].y);
      }
      for (const vo of vertEls) {
        vo.el.setAttribute("cx", vpos[vo.v].x);
        vo.el.setAttribute("cy", vpos[vo.v].y);
      }
      for (const lo of labelEls) {
        const p = vpos[lo.v];
        lo.el.setAttribute("x", cxc + ((p.x - cxc) * (R + 16)) / R);
        lo.el.setAttribute("y", cyc + ((p.y - cyc) * (R + 16)) / R);
      }
    }

    // A vertex was inserted at index j: shared vertices slide to their new
    // spots and the newcomer buds off its neighbour j-1 rather than the centre.
    function animateGrow(j, oldVpos) {
      const from = new Array(M);
      for (let x = 0; x < M; x++) {
        from[x] = x < j ? oldVpos[x] : x > j ? oldVpos[x - 1] : oldVpos[j - 1];
      }
      applyPositions(from);
      vertEls[j].el.style.opacity = 0;
      labelEls[j].el.style.opacity = 0;
      cancelAnim = tween(440, (e) => {
        applyPositions(newVpos.map((nv, x) => lerp(from[x], nv, e)));
        vertEls[j].el.style.opacity = e;
        labelEls[j].el.style.opacity = e;
      });
    }

    // A vertex at old index j was removed: the ear (j-1, j, j+1) collapses onto
    // its outer polygon edge as a fading ghost while the rest settles. The
    // removed vertex's own dot and label fold into neighbour j-1 and fade too,
    // so nothing pops out of existence at the start.
    function animateShrink(j, oldVpos) {
      const from = new Array(M); // new vertices, indexed by new label
      for (let x = 0; x < M; x++) from[x] = x < j ? oldVpos[x] : oldVpos[x + 1];

      const ghost = svgEl("polygon", { class: "triangle ghost" });
      next.appendChild(ghost);
      // old (j-1, j, j+1) -> new (j-1, j-1, j): the tip merges into neighbour j-1.
      const gFrom = [oldVpos[j - 1], oldVpos[j], oldVpos[j + 1]];
      const gTo = [newVpos[j - 1], newVpos[j - 1], newVpos[j]];

      const gVert = svgEl("circle", { r: 3.5, class: "pvertex" });
      const gLabel = svgEl("text", { class: "plabel", "text-anchor": "middle", "dominant-baseline": "central" });
      gLabel.textContent = String(j);
      next.appendChild(gVert);
      next.appendChild(gLabel);

      const frame = (e) => {
        applyPositions(newVpos.map((nv, x) => lerp(from[x], nv, e)));
        const g = gFrom.map((p, i) => lerp(p, gTo[i], e));
        ghost.setAttribute("points", `${g[0].x},${g[0].y} ${g[1].x},${g[1].y} ${g[2].x},${g[2].y}`);
        ghost.style.opacity = 1 - e;
        const vp = lerp(oldVpos[j], newVpos[j - 1], e); // fold into neighbour j-1
        gVert.setAttribute("cx", vp.x);
        gVert.setAttribute("cy", vp.y);
        const lp = outward(vp, 16);
        gLabel.setAttribute("x", lp.x);
        gLabel.setAttribute("y", lp.y);
        gVert.style.opacity = 1 - e;
        gLabel.style.opacity = 1 - e;
      };
      // Paint the first frame synchronously; tween's frames start on the next
      // rAF, so without this the freshly created ghosts flash at (0,0) first.
      frame(0);
      cancelAnim = tween(440, frame, () => {
        ghost.remove();
        gVert.remove();
        gLabel.remove();
      });
    }

    // A swap is a diagonal flip: two triangles reshape while the polygon stays
    // put. Match triangles by pair id; the ones whose corners changed morph from
    // their old corner vertices to their new ones (one corner slides across the
    // quad), which reads as the shared diagonal rotating to the other one.
    function animateFlip(prevPath) {
      applyPositions(newVpos); // polygon + unchanged triangles sit at their final spots
      const oldA = analyze(prevPath);
      const oldTris = [];
      collectTriangles(pathToTree(prevPath, oldA.pairOfStep), 0, M - 1, oldTris);
      const oldByPair = new Map(oldTris.map((t) => [t.pair, t]));
      const moves = [];
      for (const te of triEls) {
        const o = oldByPair.get(te.pair);
        if (!o || (o.a === te.a && o.b === te.b && o.c === te.c)) continue;
        moves.push({ el: te.el, a0: o.a, b0: o.b, c0: o.c, a1: te.a, b1: te.b, c1: te.c });
      }
      if (!moves.length) return false;
      const setAt = (m, e) => {
        const pa = lerp(newVpos[m.a0], newVpos[m.a1], e);
        const pb = lerp(newVpos[m.b0], newVpos[m.b1], e);
        const pc = lerp(newVpos[m.c0], newVpos[m.c1], e);
        m.el.setAttribute("points", `${pa.x},${pa.y} ${pb.x},${pb.y} ${pc.x},${pc.y}`);
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
      return true;
    }

    // Knowing the exact edit, the changed vertex is a lookup (earTip). A peak
    // insert grows and a delete shrinks by one vertex; a swap or rotate flips a
    // diagonal. A handler returns false when the edit isn't a clean single-step
    // change here (valley inserts, "set" reshapes, size mismatches), so those
    // fall through to a snap.
    const animated = dispatchEdit(opts, {
      insert: (edit) => {
        if (edit.kind === "valley" || M !== prev.M + 1) return false;
        const j = earTip(path, edit.at); // new labelling: the pair opens at `at`
        if (j < 0) return false;
        animateGrow(j, prev.vpos);
        return true;
      },
      remove: (edit, prevPath) => {
        if (edit.kind === "valley" || M !== prev.M - 1) return false;
        const j = earTip(prevPath, edit.at); // old labelling
        if (j < 0) return false;
        animateShrink(j, prev.vpos);
        return true;
      },
      swap: (edit, prevPath) => (M === prev.M ? animateFlip(prevPath) : false),
      rotate: (edit, prevPath) => (M === prev.M ? animateFlip(prevPath) : false),
    });
    if (!animated) applyPositions(newVpos);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
    prev = { M, vpos: newVpos };
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
