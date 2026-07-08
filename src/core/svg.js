const NS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    el.setAttribute(k, String(v));
  }
  for (const c of children) el.appendChild(c);
  return el;
}

export function makeSvg(viewBox) {
  const svg = svgEl("svg", {
    viewBox,
    preserveAspectRatio: "xMidYMid meet",
    class: "figure",
  });
  return svg;
}
