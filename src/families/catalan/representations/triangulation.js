import { analyze, subtreeRange, insertPeak, deletePeak } from "../model.js";
import { pathToTree, treeToPath, rotateAtPair, leafCount } from "../tree.js";
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
  id: "triangulation",
  name: "Polygon triangulation",
  blurb:
    "A triangulation of a convex (n+2)-gon: each triangle is a node, sharing the base edge (0,n+1). Click a triangle to flip its diagonal, hover a side to bevel in a new vertex, or an ear to remove it.",
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

const tkey = (a, b, c) => [a, b, c].sort((x, y) => x - y).join(",");

// Find the vertex added/removed between two triangulations that differ by one
// pair. Relabelling the larger triangulation by the shift "drop index j" must
// send every triangle not touching j into the smaller one; among such j we take
// the one leaving the most triangles fixed, so the odd vertex out is the newly
// added (lowest-degree) one. Most insertions are local (an ear, or a vertex
// splitting one triangle); a minority genuinely restructure and just morph.
function findSplit(bigTris, smallSet, Mbig) {
  let best = -1;
  let bestKept = -1;
  for (let j = 1; j <= Mbig - 2; j++) {
    const g = (x) => (x < j ? x : x - 1);
    let kept = 0;
    let ok = true;
    for (const t of bigTris) {
      if (t.a === j || t.b === j || t.c === j) continue;
      if (smallSet.has(tkey(g(t.a), g(t.b), g(t.c)))) kept++;
      else {
        ok = false;
        break;
      }
    }
    if (ok && kept > bestKept) {
      bestKept = kept;
      best = j;
    }
  }
  return best;
}

const lerp = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });

export function create(container, callbacks) {
  let svg = null;
  const registry = makeRegistry();
  let currentEls = [];
  let rangeOf = [];
  let prev = null; // { M, vpos, tris } from the previous render
  let animId = 0;
  let plus = null;
  let minus = null;

  function setPath(path, opts = {}) {
    registry.clear();
    currentEls = [];
    cancelAnimationFrame(animId);

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

    const triangles = [];
    collectTriangles(tree, 0, M - 1, triangles);

    const triEls = [];
    for (const t of triangles) {
      const poly = svgEl("polygon", { class: "triangle" });
      register(registry, t.pair, poly);
      makeInteractive(poly, t.pair, callbacks, () => {
        callbacks.onEdit(treeToPath(rotateAtPair(tree, t.pair)));
      });
      // an ear (leaf-pair node) can be removed, collapsing along its outer edge
      if (closeOf[t.pair] === openOf[t.pair] + 1) {
        poly.addEventListener("pointerenter", () => {
          const c = {
            x: (newVpos[t.a].x + newVpos[t.b].x + newVpos[t.c].x) / 3,
            y: (newVpos[t.a].y + newVpos[t.b].y + newVpos[t.c].y) / 3,
          };
          showAffordButton(minus, c.x, c.y, callbacks.onEdit, () => deletePeak(path, openOf[t.pair]));
        });
      }
      next.appendChild(poly);
      triEls.push({ el: poly, a: t.a, b: t.b, c: t.c });
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
        const btnAt = outward(mid, 16);
        hit.addEventListener("pointerenter", () =>
          showAffordButton(plus, btnAt.x, btnAt.y, callbacks.onEdit, () => insertPeak(path, leafPos[v]))
        );
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

    plus = makeAffordButton("grow", "+");
    minus = makeAffordButton("shrink", "−");
    next.appendChild(plus);
    next.appendChild(minus);
    next.addEventListener("pointerleave", () => {
      hideAffordButton(plus);
      hideAffordButton(minus);
    });

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

    function runTween(onFrame, onDone) {
      const dur = 440;
      const start = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      const tick = (now) => {
        const raw = Math.min(1, (now - start) / dur);
        onFrame(ease(raw));
        if (raw < 1) animId = requestAnimationFrame(tick);
        else if (onDone) onDone();
      };
      animId = requestAnimationFrame(tick);
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
      runTween((e) => {
        applyPositions(newVpos.map((nv, x) => lerp(from[x], nv, e)));
        vertEls[j].el.style.opacity = e;
        labelEls[j].el.style.opacity = e;
      });
    }

    // A vertex at old index j was removed: the ear (j-1, j, j+1) collapses onto
    // its outer polygon edge as a fading ghost while the rest settles.
    function animateShrink(j, oldVpos) {
      const from = new Array(M); // new vertices, indexed by new label
      for (let x = 0; x < M; x++) from[x] = x < j ? oldVpos[x] : oldVpos[x + 1];
      applyPositions(from);

      const ghost = svgEl("polygon", { class: "triangle ghost" });
      next.appendChild(ghost);
      // old (j-1, j, j+1) -> new (j-1, j-1, j): the tip merges into neighbour j-1.
      const gFrom = [oldVpos[j - 1], oldVpos[j], oldVpos[j + 1]];
      const gTo = [newVpos[j - 1], newVpos[j - 1], newVpos[j]];

      runTween(
        (e) => {
          applyPositions(newVpos.map((nv, x) => lerp(from[x], nv, e)));
          const g = gFrom.map((p, i) => lerp(p, gTo[i], e));
          ghost.setAttribute("points", `${g[0].x},${g[0].y} ${g[1].x},${g[1].y} ${g[2].x},${g[2].y}`);
          ghost.style.opacity = 1 - e;
        },
        () => ghost.remove()
      );
    }

    const grew = opts.animate && prev && M === prev.M + 1;
    const shrank = opts.animate && prev && M === prev.M - 1;
    let animated = false;
    if (grew) {
      const oldSet = new Set(prev.tris.map((t) => tkey(t.a, t.b, t.c)));
      const j = findSplit(triangles, oldSet, M);
      if (j >= 0) {
        animateGrow(j, prev.vpos);
        animated = true;
      }
    } else if (shrank) {
      const newSet = new Set(triangles.map((t) => tkey(t.a, t.b, t.c)));
      const j = findSplit(prev.tris, newSet, prev.M);
      if (j >= 0) {
        animateShrink(j, prev.vpos);
        animated = true;
      }
    }
    if (!animated) applyPositions(newVpos);

    if (svg) container.replaceChild(next, svg);
    else container.appendChild(next);
    svg = next;
    prev = { M, vpos: newVpos, tris: triangles.map((t) => ({ a: t.a, b: t.b, c: t.c })) };
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
