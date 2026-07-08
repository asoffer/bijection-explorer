// Full binary tree with n internal nodes, in bijection with a Dyck path via the
// classic recursive grammar:  w = U a D b  ->  node(left = T(a), right = T(b)).
// The leading up-step of each subword becomes an internal node, so every
// internal node carries the pair id of that up-step.

import { U } from "./model.js";

// Leaf: { leaf: true, pos }
// Internal: { leaf: false, pair, left, right }

export function pathToTree(path, pairOfStep) {
  let i = 0;
  function build() {
    if (i >= path.length || path[i] !== U) {
      // pos is the path index where inserting `UD` sprouts this leaf into a node.
      return { leaf: true, pos: i };
    }
    const pair = pairOfStep[i];
    i++; // consume the U
    const left = build();
    i++; // consume the matching D (a is balanced, so cursor sits on it)
    const right = build();
    return { leaf: false, pair, left, right };
  }
  return build();
}

export function treeToPath(tree) {
  const out = [];
  (function emit(t) {
    if (t.leaf) return;
    out.push(U);
    emit(t.left);
    out.push(-1);
    emit(t.right);
  })(tree);
  return out;
}

export function leafCount(t) {
  return t.leaf ? 1 : leafCount(t.left) + leafCount(t.right);
}

export function internalCount(t) {
  return t.leaf ? 0 : 1 + internalCount(t.left) + internalCount(t.right);
}

// Rotate at the internal node whose pair id is `pair`. Prefers a left rotation
// (needs an internal right child); falls back to a right rotation. Returns a
// new tree (structurally shared where unchanged). No-op if neither is possible.
export function rotateAtPair(tree, pair) {
  function rec(t) {
    if (t.leaf) return t;
    if (t.pair === pair) return rotate(t);
    return { ...t, left: rec(t.left), right: rec(t.right) };
  }
  return rec(tree);
}

function rotate(x) {
  // Left rotation: x has internal right child y.
  //   x(A, y(B, C))  ->  y(x(A, B), C)
  if (!x.right.leaf) {
    const y = x.right;
    return {
      leaf: false,
      pair: y.pair,
      left: { leaf: false, pair: x.pair, left: x.left, right: y.left },
      right: y.right,
    };
  }
  // Right rotation: x has internal left child y.
  //   x(y(A, B), C)  ->  y(A, x(B, C))
  if (!x.left.leaf) {
    const y = x.left;
    return {
      leaf: false,
      pair: y.pair,
      left: y.left,
      right: { leaf: false, pair: x.pair, left: y.right, right: x.right },
    };
  }
  return x; // both children are leaves: nothing to rotate
}

// Assign an (x, depth) layout position to every node via in-order x-ordering.
// Returns { nodes, edges, width, height } with pair ids on internal nodes.
export function layoutTree(tree) {
  const nodes = [];
  const edges = [];
  let xCounter = 0;
  let maxDepth = 0;

  function place(t, depth) {
    maxDepth = Math.max(maxDepth, depth);
    if (t.leaf) {
      const x = xCounter++;
      const node = { leaf: true, x, depth, pos: t.pos };
      nodes.push(node);
      return node;
    }
    const leftNode = place(t.left, depth + 1);
    const x = xCounter++;
    const rightNode = place(t.right, depth + 1);
    const node = { leaf: false, pair: t.pair, x, depth };
    nodes.push(node);
    edges.push({ from: node, to: leftNode });
    edges.push({ from: node, to: rightNode });
    return node;
  }

  place(tree, 0);
  return { nodes, edges, width: xCounter, height: maxDepth + 1 };
}
