import { U, analyze, subtreeRange, insertPeak, deletePeak } from "../model.js";
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
    const { openOf, closeOf, n } = analyze(path);
    rangeOf = Array.from({ length: n }, (_, p) => subtreeRange(openOf, closeOf, p));
    const root = pathToPlaneTree(path);

    let xc = 0;
    let maxD = 0;
    (function assign(v) {
      maxD = Math.max(maxD, v.depth);
      if (!v.children.length) {
        v.x = xc++;
      } else {
        v.children.forEach(assign);
        v.x = (v.children[0].x + v.children[v.children.length - 1].x) / 2;
      }
    })(root);

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
        showAffordButton(plus, X(v.x), Y(v.depth) + 22, callbacks.onEdit, () =>
          insertPeak(path, addPos)
        );
        if (!isRoot && v.children.length === 0) {
          showAffordButton(minus, X(v.x) + 20, Y(v.depth) - 18, callbacks.onEdit, () =>
            deletePeak(path, openOf[v.pair])
          );
        }
      });
      next.appendChild(dot);
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
