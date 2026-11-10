/*
 * Draws the contour-line pattern used behind the header band and the content sheet
 * (src/assets/contours.svg). The ELO 2027 site uses contour lines of the Caribbean coast around
 * Barranquilla; this pattern is our own, generated from a made-up height field, so nothing is
 * copied from the site. It is deterministic: run it again and the file does not change.
 *
 *   node apps/web/scripts/make-contours.mjs
 *
 * The SVG has strokes only and no colours that matter: CSS uses it as a mask, so the lines take
 * whatever colour the theme gives them (see .contours in styles/layout.css).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const W = 1440;
const H = 960;
const COLS = 60;
const ROWS = 40;
const LEVELS = 10;

/** A height field: a few hills and a long ridge, with slow waves so the lines wander. */
const hills = [
  [0.68, 0.36, 0.2, 1.0],
  [0.24, 0.7, 0.26, 0.8],
  [0.9, 0.86, 0.18, 0.62],
  [0.1, 0.16, 0.16, 0.55],
  [0.5, 1.02, 0.2, 0.5],
];
function height(u, v) {
  let h = 0;
  for (const [cx, cy, r, amp] of hills) {
    const d2 = ((u - cx) * (W / H)) ** 2 + (v - cy) ** 2;
    h += amp * Math.exp(-d2 / (2 * r * r));
  }
  h += 0.09 * Math.sin(u * 9.1 + v * 3.3) + 0.07 * Math.sin(v * 11.7 - u * 4.2);
  h += 0.05 * Math.sin((u + v) * 17.3);
  return h;
}

const grid = [];
for (let j = 0; j <= ROWS; j++) {
  const row = [];
  for (let i = 0; i <= COLS; i++) row.push(height(i / COLS, j / ROWS));
  grid.push(row);
}
const flat = grid.flat();
const lo = Math.min(...flat);
const hi = Math.max(...flat);

/** Marching squares: the line segments where the field crosses `level`, in grid coordinates. */
function segments(level) {
  const out = [];
  const cross = (a, b, pa, pb) => {
    const t = (level - a) / (b - a);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
  };
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const corners = [
        [i, j, grid[j][i]],
        [i + 1, j, grid[j][i + 1]],
        [i + 1, j + 1, grid[j + 1][i + 1]],
        [i, j + 1, grid[j + 1][i]],
      ];
      const points = [];
      for (let k = 0; k < 4; k++) {
        const [x1, y1, a] = corners[k];
        const [x2, y2, b] = corners[(k + 1) % 4];
        if (a < level !== b < level) points.push(cross(a, b, [x1, y1], [x2, y2]));
      }
      // Two crossings make one segment; four (a saddle) make two.
      for (let k = 0; k + 1 < points.length; k += 2) out.push([points[k], points[k + 1]]);
    }
  }
  return out;
}

/** Joins segments that share an end point into polylines. */
function chains(segs) {
  const key = ([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const ends = new Map();
  const add = (k, s) => {
    const list = ends.get(k);
    if (list) list.push(s);
    else ends.set(k, [s]);
  };
  for (const s of segs) {
    add(key(s[0]), s);
    add(key(s[1]), s);
  }
  const used = new Set();
  const lines = [];
  const extend = (line, atEnd) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const next = (ends.get(key(tip)) ?? []).find((s) => !used.has(s));
      if (!next) return;
      used.add(next);
      const other = key(next[0]) === key(tip) ? next[1] : next[0];
      if (atEnd) line.push(other);
      else line.unshift(other);
    }
  };
  for (const s of segs) {
    if (used.has(s)) continue;
    used.add(s);
    const line = [s[0], s[1]];
    extend(line, true);
    extend(line, false);
    if (line.length > 8) lines.push(line);
  }
  return lines;
}

/** A smooth path through the midpoints of a polyline, in whole pixels to keep the file small. */
function path(line) {
  const px = line.map(([x, y]) => [Math.round((x / COLS) * W), Math.round((y / ROWS) * H)]);
  const closed = px[0][0] === px[px.length - 1][0] && px[0][1] === px[px.length - 1][1];
  const mid = (a, b) => [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
  let d = `M${closed ? mid(px[0], px[1]).join(" ") : px[0].join(" ")}`;
  for (let i = 1; i < px.length - 1; i++)
    d += `Q${px[i].join(" ")} ${mid(px[i], px[i + 1]).join(" ")}`;
  if (closed) d += `Q${px[0].join(" ")} ${mid(px[0], px[1]).join(" ")}Z`;
  else d += `L${px[px.length - 1].join(" ")}`;
  return d;
}

const paths = [];
for (let n = 1; n <= LEVELS; n++) {
  const level = lo + ((hi - lo) * n) / (LEVELS + 1);
  // Every fourth line is an index contour, drawn heavier, as on a printed map.
  const width = n % 4 === 0 ? 2.2 : 1.1;
  const d = chains(segments(level)).map(path).join("");
  paths.push(`<path stroke-width="${width}" d="${d}"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round"><title>Contour lines</title>${paths.join("")}</svg>\n`;
const out = fileURLToPath(new URL("../src/assets/contours.svg", import.meta.url));
writeFileSync(out, svg);
console.log(`${out}: ${svg.length} bytes, ${paths.length} levels`);
