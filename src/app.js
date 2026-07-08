import { activeFamily, BY_ID } from "./registry.js";

// The active family supplies the object model (sampling, sizing, validity) and
// the list of representations. Everything below is family-agnostic.
const { model, representations: REPRESENTATIONS, defaults } = activeFamily;

// ---- shared state ---------------------------------------------------------

let path = model.random(defaults.size);

const panels = {
  left: makePanel("left", defaults.left),
  right: makePanel("right", defaults.right),
};

// ---- a panel = selector + figure + blurb ----------------------------------

function makePanel(side, defaultId) {
  const root = document.getElementById(`panel-${side}`);
  const select = root.querySelector("select");
  const figure = root.querySelector(".figure-host");
  const blurb = root.querySelector(".blurb");

  for (const rep of REPRESENTATIONS) {
    const opt = document.createElement("option");
    opt.value = rep.meta.id;
    opt.textContent = rep.meta.name;
    select.appendChild(opt);
  }
  select.value = defaultId;

  const panel = {
    side,
    repId: defaultId,
    view: null,
    figure,
    blurb,
    select,
  };

  select.addEventListener("change", () => {
    panel.repId = select.value;
    buildView(panel);
    panel.view.setPath(path);
  });

  buildView(panel);
  return panel;
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
  const rep = BY_ID[panel.repId];
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

// ---- global controls ------------------------------------------------------

const nInput = document.getElementById("n-input");
const nLabel = document.getElementById("n-label");

function syncControls() {
  const n = model.size(path);
  nInput.value = n;
  nLabel.textContent = n;
}

nInput.addEventListener("input", () => {
  const n = Math.max(model.minSize, Math.min(model.maxSize, parseInt(nInput.value, 10) || model.minSize));
  setPath(model.random(n));
});

document.getElementById("randomize").addEventListener("click", () => {
  setPath(model.random(model.size(path)));
});

document.getElementById("reset").addEventListener("click", () => {
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

setPath(path);
