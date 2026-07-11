// Shared machinery for representation views.
//
// A view is created with create(container, callbacks) and returns:
//   { setPath(path), highlight(pairId | null), destroy() }
//
// callbacks: { onHover(pairId), onLeave(), onEdit(edit) }
// where `edit` is a family-defined descriptor (see families/*/edits.js); the
// shell turns it into the next object via model.applyEdit.

import { svgEl } from "./svg.js";

// ---- affordance menu ------------------------------------------------------
//
// A hover-driven radial menu of edit affordances. Create one per rendered
// figure, then register each hoverable node:
//
//   const menu = affordMenu(svgRoot, callbacks.onEdit);
//   menu.anchor(hitEl, key, cx, cy, () => [
//     { cls: "grow",   glyph: "+", x, y, produce: () => edit },
//     { cls: "shrink", glyph: "−", x, y, produce: () => edit },
//   ]);
//
// On hover the options animate outward from (cx,cy) to their (x,y); the pointer
// can then travel to any of them and click. A short grace period keeps the menu
// alive while the pointer crosses the gap from the node to a button, so hovering
// "with a bit of slack" doesn't dismiss it. Moving onto a different node's
// anchor opens that menu and closes this one.

const AFFORD_R = 11; // button radius
const AFFORD_GRACE = 160; // ms the menu survives after the pointer leaves it

export function affordMenu(root, onEdit) {
  // Buttons are appended straight to `root` on open (so they always render on
  // top of the static figure) and removed on close.
  let current = []; // button <g> elements currently shown
  let openKey = null;
  let closeTimer = 0;
  let cancelAnim = null;

  function clear() {
    if (cancelAnim) {
      cancelAnim();
      cancelAnim = null;
    }
    clearTimeout(closeTimer);
    for (const el of current) el.remove();
    current = [];
    openKey = null;
  }
  const cancelClose = () => clearTimeout(closeTimer);
  const scheduleClose = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(clear, AFFORD_GRACE);
  };

  function open(key, cx, cy, options) {
    if (openKey === key) {
      cancelClose();
      return;
    }
    clear();
    openKey = key;

    const btns = options.map((o) => {
      const g = svgEl("g", { class: `afford ${o.cls}` });
      g.appendChild(svgEl("circle", { r: AFFORD_R }));
      const t = svgEl("text", {
        class: "afford-glyph",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      t.textContent = o.glyph;
      g.appendChild(t);
      g.addEventListener("pointerenter", cancelClose);
      g.addEventListener("pointerleave", scheduleClose);
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        const p = o.produce();
        if (p) onEdit(p);
      });
      root.appendChild(g);
      return { g, o };
    });
    current = btns.map((b) => b.g);

    const lerp = (a, b, e) => a + (b - a) * e;
    const place = (e) => {
      for (const { g, o } of btns) {
        const x = lerp(cx, o.x, e);
        const y = lerp(cy, o.y, e);
        g.setAttribute("transform", `translate(${x},${y}) scale(${lerp(0.4, 1, e)})`);
        g.style.opacity = String(e);
      }
    };
    place(0);
    cancelAnim = tween(200, place, () => {
      cancelAnim = null;
    });
  }

  return {
    // Register `el` as the node that opens a menu of `buildOptions()` (an array,
    // possibly containing nulls, which are dropped) expanding from (cx,cy).
    anchor(el, key, cx, cy, buildOptions) {
      el.addEventListener("pointerenter", () => {
        cancelClose();
        const options = buildOptions().filter(Boolean);
        if (options.length) open(key, cx, cy, options);
      });
      el.addEventListener("pointerleave", scheduleClose);
    },
    clear,
    destroy() {
      clear();
    },
  };
}

// A hover-revealed grow/shrink button. cls is "grow" (amber +) or "shrink"
// (red −). Reused across representations.
export function makeAffordButton(cls, glyph) {
  const btn = svgEl("g", { class: `afford ${cls}`, visibility: "hidden" });
  btn.appendChild(svgEl("circle", { r: 11, cx: 0, cy: 0 }));
  const t = svgEl("text", {
    x: 0,
    y: 0,
    class: "afford-glyph",
    "text-anchor": "middle",
    "dominant-baseline": "central",
  });
  t.textContent = glyph;
  btn.appendChild(t);
  return btn;
}

export function showAffordButton(btn, x, y, onEdit, produce) {
  btn.setAttribute("transform", `translate(${x},${y})`);
  btn.style.visibility = "visible";
  btn.onclick = (e) => {
    e.stopPropagation();
    const p = produce();
    if (p) onEdit(p);
  };
}

export function hideAffordButton(btn) {
  btn.style.visibility = "hidden";
  btn.onclick = null;
}

// Drive a [0,1] progress value across `duration` ms (ease-out cubic), calling
// onFrame(e) each frame and onDone() once at the end. Returns a cancel fn;
// call it before starting a new tween so an in-flight one can't fight the new
// state. Representations use this to animate a known edit instead of snapping.
export function tween(duration, onFrame, onDone) {
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  let raf = 0;
  const tick = (now) => {
    const e = Math.min(1, (now - start) / duration);
    onFrame(ease(e));
    if (e < 1) raf = requestAnimationFrame(tick);
    else if (onDone) onDone();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// Route a just-applied edit to the matching animation handler.
//
// Every view's setPath ends with the same shape: "if this setPath came from an
// animated edit, morph to it; otherwise snap." This centralizes the guard and,
// crucially, makes coverage EXPLICIT — an edit type with no handler falls
// through and dispatchEdit returns false, so the caller snaps on purpose. That
// is the failure mode that let tree rotations go unanimated: a hand-written
// `if (e.type === "swap")` chain silently ignored the "rotate" it actually got.
//
//   const animated = dispatchEdit(opts, {
//     insert: (edit, prevPath) => animateSprout(prevPath, edit),
//     remove: (edit, prevPath) => animatePrune(prevPath, edit),
//     swap:   (edit, prevPath) => animateSwap(prevPath),
//     rotate: (edit, prevPath) => animateSwap(prevPath), // same depth-only morph
//   });
//   if (!animated) snapToFinalLayout();
//
// Handlers receive (edit, prevPath) and share the enclosing setPath scope for
// everything else. A handler may return false to decline (e.g. the edit isn't a
// clean single-step change here), in which case dispatchEdit reports false so
// the caller can snap. `handlers.default` catches any type without its own key
// (used by views like the SYT pair whose one animator self-filters).
export function dispatchEdit(opts, handlers) {
  if (!opts.animate || !opts.edit || !opts.prevPath) return false;
  const h = handlers[opts.edit.type] || handlers.default;
  if (!h) return false;
  return h(opts.edit, opts.prevPath) !== false;
}

// ---- node-link morph -------------------------------------------------------
//
// The node-diagram views (binary tree, plane tree) all animate a reshape the
// same way: tween every node from a start pixel point to its final one, then
// redraw every edge from its endpoints' fresh points, panning the viewBox
// between the old and new frames. These two helpers hold that shared mechanic
// so each view supplies only what's rep-specific — how a node's start/end
// points are computed, and how a node's element is placed.

// Pan a viewBox between two [x, y, w, h] frames; returns an onFrame(e) fn.
export function panViewBox(root, from, to) {
  return (e) => root.setAttribute("viewBox", from.map((o, i) => o + (to[i] - o) * e).join(" "));
}

// Default edge writer: an SVG <line> drawn from node a's live point to node b's.
export function drawLineEdge(el, a, b) {
  el.setAttribute("x1", a.cx);
  el.setAttribute("y1", a.cy);
  el.setAttribute("x2", b.cx);
  el.setAttribute("y2", b.cy);
}

// One frame of a node-link morph, at progress e in [0,1]. Each node in `nodes`
// carries start/end pixel coords {sx, sy, ex, ey}; the interpolated point is
// stored back on node.cx/cy (so edges can read it) and handed to
// place(node, x, y), which writes it onto the node's element(s). Each edge in
// `edges` is { el, from, to } with from/to being nodes; drawEdge(el, from, to)
// redraws it from their live points (defaults to an SVG line).
export function stepDiagram(e, nodes, edges, place, drawEdge = drawLineEdge) {
  for (const nd of nodes) {
    nd.cx = nd.sx + (nd.ex - nd.sx) * e;
    nd.cy = nd.sy + (nd.ey - nd.sy) * e;
    place(nd, nd.cx, nd.cy);
  }
  for (const ed of edges) drawEdge(ed.el, ed.from, ed.to);
}

export function makeRegistry() {
  // pairId -> array of DOM elements that should light up together.
  return new Map();
}

export function register(registry, pairId, el) {
  if (!registry.has(pairId)) registry.set(pairId, []);
  registry.get(pairId).push(el);
  el.dataset.pair = String(pairId);
}

// Highlight the inclusive range [lo, hi] (a subtree) in two tiers: the hovered
// pair itself — range[0] — gets class `hl`, while every part nested strictly
// inside it (range[0]+1 .. range[1], the "between" region: the substring,
// sub-arch, or descendants) gets `hl-in`. `currentEls` is the list of elements
// lit last time; returns the new list. Pass range = null to clear.
export function applyHighlight(registry, currentEls, range) {
  for (const el of currentEls) el.classList.remove("hl", "hl-in");
  const next = [];
  if (range) {
    for (let p = range[0]; p <= range[1]; p++) {
      const els = registry.get(p);
      if (!els) continue;
      const cls = p === range[0] ? "hl" : "hl-in";
      for (const el of els) {
        el.classList.add(cls);
        next.push(el);
      }
    }
  }
  return next;
}

// Wire an element so pointer enter/leave report a pair id, and click edits.
export function makeInteractive(el, pairId, callbacks, editFn) {
  el.classList.add("interactive");
  el.addEventListener("pointerenter", () => callbacks.onHover(pairId));
  el.addEventListener("pointerleave", () => callbacks.onLeave());
  if (editFn) {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      editFn();
    });
  }
}
