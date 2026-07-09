import { FAMILIES, byId } from "./registry.js";

// The active family supplies the object model (sampling, sizing, validity) and
// the list of representations. Everything below is family-agnostic; switching
// families rebuilds the panels and controls against the new descriptor.

let activeFamily = null;
let model = null;
let REPRESENTATIONS = null;
let repMap = null;
let path = null;

// ---- DOM handles ----------------------------------------------------------

const familySelect = document.getElementById("family-select");
const tagline = document.getElementById("tagline");
const nInput = document.getElementById("n-input");
const nLabel = document.getElementById("n-label");
const resetBtn = document.getElementById("reset");

// ---- a panel = selector + figure + blurb ----------------------------------

const panels = {
  left: makePanel("left"),
  right: makePanel("right"),
};

function makePanel(side) {
  const root = document.getElementById(`panel-${side}`);
  const panel = {
    side,
    repId: null,
    view: null,
    figure: root.querySelector(".figure-host"),
    blurb: root.querySelector(".blurb"),
    select: root.querySelector("select"),
  };

  panel.select.addEventListener("change", () => {
    panel.repId = panel.select.value;
    buildView(panel);
    panel.view.setPath(path);
  });

  return panel;
}

// Fill a panel's dropdown with the active family's representations.
function repopulate(panel, defaultId) {
  panel.select.innerHTML = "";
  for (const rep of REPRESENTATIONS) {
    const opt = document.createElement("option");
    opt.value = rep.meta.id;
    opt.textContent = rep.meta.name;
    panel.select.appendChild(opt);
  }
  panel.repId = defaultId;
  panel.select.value = defaultId;
}

function callbacksFor() {
  return {
    onHover: (pairId) => highlightAll(pairId),
    onLeave: () => highlightAll(null),
    onEdit: (newPath) => {
      if (newPath && newPath.length >= 2 && model.isValid(newPath)) setPath(newPath, true);
    },
  };
}

function buildView(panel) {
  if (panel.view) panel.view.destroy();
  panel.figure.innerHTML = "";
  const rep = repMap[panel.repId];
  panel.blurb.textContent = rep.meta.blurb;
  panel.view = rep.create(panel.figure, callbacksFor());
}

// ---- propagation ----------------------------------------------------------

function setPath(newPath, animate = false) {
  const prevPath = path;
  path = newPath;
  for (const p of Object.values(panels)) p.view.setPath(path, { animate, prevPath });
  syncControls();
}

function highlightAll(pairId) {
  for (const p of Object.values(panels)) p.view.highlight(pairId);
}

// ---- family switching -----------------------------------------------------

function setFamily(family) {
  activeFamily = family;
  model = family.model;
  REPRESENTATIONS = family.representations;
  repMap = byId(family);

  tagline.innerHTML = family.tagline;
  resetBtn.textContent = family.resetLabel;
  nInput.min = model.minSize;
  nInput.max = model.maxSize;

  repopulate(panels.left, family.defaults.left);
  repopulate(panels.right, family.defaults.right);

  path = model.random(family.defaults.size);
  buildView(panels.left);
  buildView(panels.right);
  setPath(path);
}

// ---- global controls ------------------------------------------------------

function syncControls() {
  const n = model.size(path);
  nInput.value = n;
  nLabel.textContent = n;
}

for (const family of FAMILIES) {
  const opt = document.createElement("option");
  opt.value = family.id;
  opt.textContent = family.name;
  familySelect.appendChild(opt);
}

familySelect.addEventListener("change", () => {
  const family = FAMILIES.find((f) => f.id === familySelect.value);
  if (family) setFamily(family);
});

nInput.addEventListener("input", () => {
  const n = Math.max(model.minSize, Math.min(model.maxSize, parseInt(nInput.value, 10) || model.minSize));
  setPath(model.random(n));
});

document.getElementById("randomize").addEventListener("click", () => {
  setPath(model.random(model.size(path)));
});

resetBtn.addEventListener("click", () => {
  setPath(model.reset(model.size(path)));
});

// swap the two panels' representations
document.getElementById("swap").addEventListener("click", () => {
  const l = panels.left.repId;
  const r = panels.right.repId;
  panels.left.select.value = r;
  panels.right.select.value = l;
  panels.left.repId = r;
  panels.right.repId = l;
  buildView(panels.left);
  buildView(panels.right);
  panels.left.view.setPath(path);
  panels.right.view.setPath(path);
});

// ---- go -------------------------------------------------------------------

familySelect.value = FAMILIES[0].id;
setFamily(FAMILIES[0]);
