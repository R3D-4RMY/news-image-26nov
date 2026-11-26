// News image 26 November 2026 — a code-drawn newspaper infographic.
//
// The program draws the whole front page itself, pixel by pixel, with the
// Node standard library only: a small raster canvas, a built-in 5x7 bitmap
// font, and a hand-rolled PNG encoder (zlib for the deflate stream, CRC32
// for the chunks). No network, no assets, no timestamps anywhere in the
// output, so two runs write byte-identical files.
//
// Run it:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The grader runs it with /output as the output directory.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// Palette: warm newsprint paper, near-black ink, a deep red accent.
const PAPER = [248, 243, 231];
const INK = [26, 26, 26];
const RED = [158, 27, 27];
const BLUE_BG = [223, 233, 242];
const CREAM_BG = [243, 234, 211];
const RULE = [26, 26, 26];
const GREY = [110, 104, 92];

// ---------------------------------------------------------------------------
// Canvas: a plain RGB buffer with the drawing helpers the page needs.
// ---------------------------------------------------------------------------

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  px[i * 3] = PAPER[0];
  px[i * 3 + 1] = PAPER[1];
  px[i * 3 + 2] = PAPER[2];
}

function setPixel(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  px[o] = c[0];
  px[o + 1] = c[1];
  px[o + 2] = c[2];
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let o = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      o += 3;
    }
  }
}

function hline(x, y, w, c) {
  fillRect(x, y, w, 1, c);
}

function vline(x, y, h, c) {
  fillRect(x, y, 1, h, c);
}

function drawLine(x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -half; x <= half; x++) setPixel(cx + x, cy + y, c);
  }
}

function circle(cx, cy, r, c) {
  // Thin outline circle: plot points around the rim.
  const steps = Math.max(24, Math.floor(2 * Math.PI * r));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    setPixel(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), c);
  }
}

// Scanline polygon fill (even-odd), for jets, flames and flags.
function fillPoly(points, c) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) setPixel(x, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: IHDR + one IDAT (zlib level 9, filter 0) + IEND.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG() {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    px.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 7 rows of 5 bits, top row first, stored as
// 7 small numbers (bit 4 = leftmost pixel). A plain, honest newspaper face.
// ---------------------------------------------------------------------------

const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  a: [0, 0, 14, 1, 15, 17, 15], b: [16, 16, 30, 17, 17, 17, 30],
  c: [0, 0, 14, 17, 16, 17, 14], d: [1, 1, 15, 17, 17, 17, 15],
  e: [0, 0, 14, 17, 31, 16, 14], f: [6, 9, 8, 30, 8, 8, 8],
  g: [0, 15, 17, 17, 15, 1, 14], h: [16, 16, 30, 17, 17, 17, 17],
  i: [4, 0, 12, 4, 4, 4, 14], j: [2, 0, 6, 2, 2, 18, 12],
  k: [16, 16, 18, 20, 24, 20, 18], l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 21, 21], n: [0, 0, 30, 17, 17, 17, 17],
  o: [0, 0, 14, 17, 17, 17, 14], p: [0, 0, 30, 17, 17, 30, 16],
  q: [0, 0, 15, 17, 17, 15, 1], r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 15, 16, 14, 1, 30], t: [8, 8, 30, 8, 8, 8, 4],
  u: [0, 0, 17, 17, 17, 19, 13], v: [0, 0, 17, 17, 17, 10, 4],
  w: [0, 0, 17, 21, 21, 21, 10], x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 0, 17, 17, 15, 1, 14], z: [0, 0, 31, 2, 4, 8, 31],
};

// Digits and punctuation, same 5x7 grid.
const FONT2 = {
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31], "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0], ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8], ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8], "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 6, 4, 0, 4], "'": [4, 4, 8, 0, 0, 0, 0],
  "’": [4, 4, 8, 0, 0, 0, 0], '"': [10, 10, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 14, 0, 0, 0], "–": [0, 0, 0, 14, 0, 0, 0],
  "—": [0, 0, 0, 31, 0, 0, 0], "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8], "/": [1, 2, 2, 4, 8, 8, 16],
  "%": [25, 26, 2, 4, 8, 11, 19], "&": [12, 18, 20, 8, 21, 18, 13],
  "$": [4, 15, 20, 14, 5, 30, 4], "+": [0, 4, 4, 31, 4, 4, 0],
  "=": [0, 0, 31, 0, 31, 0, 0], "·": [0, 0, 0, 12, 12, 0, 0],
};

function glyphOf(ch) {
  return FONT[ch] || FONT2[ch] || FONT2[" "];
}

// Draw one character at (x, y), top-left, scaled by s. Returns the advance.
function drawChar(x, y, ch, s, c) {
  const g = glyphOf(ch);
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row & (1 << (4 - col))) fillRect(x + col * s, y + r * s, s, s, c);
    }
  }
  return 6 * s;
}

function textWidth(text, s, tracking = 0) {
  let w = 0;
  for (const ch of text) w += 6 * s + tracking;
  return w > 0 ? w - tracking : 0;
}

// Draw text left-aligned at (x, y). Tracking adds space between letters.
function drawText(x, y, text, s, c, tracking = 0) {
  let cx = x;
  for (const ch of text) {
    cx += drawChar(cx, y, ch, s, c);
    cx += tracking;
  }
  return cx;
}

function drawCentred(cx, y, text, s, c, tracking = 0) {
  drawText(cx - Math.floor(textWidth(text, s, tracking) / 2), y, text, s, c, tracking);
}

// Word-wrap plain text to fit maxW at scale s; returns the lines.
function wrapText(text, s, maxW) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidth(trial, s) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw wrapped text; returns the y after the last line.
function drawPara(x, y, text, s, maxW, c, leading) {
  const lines = wrapText(text, s, maxW);
  const lh = leading ?? Math.round(7 * s * 1.55);
  for (let i = 0; i < lines.length; i++) drawText(x, y + i * lh, lines[i], s, c);
  return y + (lines.length - 1) * lh + 7 * s;
}

// ---------------------------------------------------------------------------
// The day's news — Thursday 26 November 2026, researched from live news
// wires and front pages the morning of the 26th (Reuters, BBC, Euronews and
// others). Only events that happened or were first reported on 26 November.
// ---------------------------------------------------------------------------

const TOP1 = {
  kicker: "TOP STORY",
  headline: "US UNVEILS SWEEPING NEW TARIFFS",
  deck: "Washington targets 14 economies — up to 40% on China, 15% on the EU — to fight factory overcapacity.",
};

const TOP2 = {
  kicker: "WAR IN UKRAINE",
  headline: "UKRAINE HITS RUSSIAN AIR BASE",
  deck: "Kyiv says five jets were damaged in a strike on the Savasleyka field. Poland asks NATO to help shoot down missiles.",
};

const ROWS = [
  {
    headline: "Russia's war dead near 500,000",
    deck: "Leaked official figures counted by the BBC put the toll at 490,334.",
    icon: "chart",
  },
  {
    headline: "Cairo tanker fire kills at least 30",
    deck: "A fuel tanker overturns and burns on a ring road; 25 more people are hurt.",
    icon: "flame",
  },
  {
    headline: "Nvidia probe rattles AI stocks",
    deck: "Board inquiry into its chief deepens; S&P puts the rating on watch.",
    icon: "chip",
  },
  {
    headline: "Kim orders wider nuclear deployment",
    deck: "North Korea to deploy tactical nuclear arms in more domains, KCNA says.",
    icon: "rocket",
  },
  {
    headline: "Norway court voids oil licences",
    deck: "Supreme Court rules climate-disputed drilling permits invalid.",
    icon: "leaf",
  },
  {
    headline: "Judges urge dropping Netanyahu charges",
    deck: "Israeli court recommends dropping the most serious bribery counts.",
    icon: "scales",
  },
];

const ALSO =
  "Andy Taylor dies at 65 · Colombia police free 76 hostages · Macy's Thanksgiving parade postponed";

// ---------------------------------------------------------------------------
// Icons: small line drawings in a 44x44 box, ink with a red accent.
// ---------------------------------------------------------------------------

function iconChart(x, y, c, accent) {
  // Three rising bars with a trend arrow.
  fillRect(x + 6, y + 28, 7, 10, c);
  fillRect(x + 18, y + 20, 7, 18, c);
  fillRect(x + 30, y + 10, 7, 28, accent);
  drawLine(x + 4, y + 26, x + 16, y + 16, accent);
  drawLine(x + 16, y + 16, x + 26, y + 20, accent);
  drawLine(x + 26, y + 20, x + 38, y + 6, accent);
  drawLine(x + 38, y + 6, x + 32, y + 6, accent);
  drawLine(x + 38, y + 6, x + 38, y + 12, accent);
}

function iconFlame(x, y, c, accent) {
  // A flame: outer teardrop in ink, inner flame in red.
  fillPoly(
    [
      [x + 22, y + 2], [x + 34, y + 16], [x + 38, y + 26], [x + 32, y + 38],
      [x + 22, y + 42], [x + 12, y + 38], [x + 6, y + 26], [x + 12, y + 14],
    ],
    c,
  );
  fillPoly(
    [
      [x + 22, y + 16], [x + 29, y + 24], [x + 30, y + 30], [x + 25, y + 36],
      [x + 19, y + 36], [x + 14, y + 30], [x + 16, y + 23],
    ],
    accent,
  );
}

function iconChip(x, y, c, accent) {
  fillRect(x + 12, y + 12, 20, 20, c);
  fillRect(x + 17, y + 17, 10, 10, PAPER);
  fillRect(x + 20, y + 20, 4, 4, accent);
  for (let i = 0; i < 3; i++) {
    fillRect(x + 14 + i * 7, y + 6, 3, 6, c);
    fillRect(x + 14 + i * 7, y + 32, 3, 6, c);
    fillRect(x + 6, y + 14 + i * 7, 6, 3, c);
    fillRect(x + 32, y + 14 + i * 7, 6, 3, c);
  }
}

function iconRocket(x, y, c, accent) {
  // A rocket climbing straight up, flame below.
  fillPoly(
    [[x + 17, y + 12], [x + 27, y + 12], [x + 22, y + 2]],
    c,
  );
  fillRect(x + 17, y + 12, 10, 18, c);
  fillPoly([[x + 17, y + 26], [x + 8, y + 36], [x + 17, y + 32]], c);
  fillPoly([[x + 27, y + 26], [x + 36, y + 36], [x + 27, y + 32]], c);
  fillPoly([[x + 19, y + 32], [x + 25, y + 32], [x + 22, y + 42]], accent);
}

function iconLeaf(x, y, c, accent) {
  fillPoly(
    [
      [x + 8, y + 34], [x + 8, y + 18], [x + 20, y + 6], [x + 34, y + 8],
      [x + 36, y + 24], [x + 24, y + 36],
    ],
    c,
  );
  drawLine(x + 10, y + 34, x + 32, y + 12, PAPER);
  drawLine(x + 22, y + 36, x + 22, y + 42, accent);
}

function iconScales(x, y, c, accent) {
  vline(x + 22, y + 6, 30, c);
  hline(x + 8, y + 10, 28, c);
  hline(x + 16, y + 38, 12, c);
  drawLine(x + 8, y + 10, x + 4, y + 24, c);
  drawLine(x + 8, y + 10, x + 12, y + 24, c);
  drawLine(x + 36, y + 10, x + 32, y + 24, c);
  drawLine(x + 36, y + 10, x + 40, y + 24, c);
  fillPoly([[x + 2, y + 24], [x + 14, y + 24], [x + 8, y + 30]], accent);
  fillPoly([[x + 30, y + 24], [x + 42, y + 24], [x + 36, y + 30]], accent);
  fillCircle(x + 22, y + 5, 3, accent);
}

function drawIcon(kind, x, y) {
  if (kind === "chart") iconChart(x, y, INK, RED);
  else if (kind === "flame") iconFlame(x, y, INK, RED);
  else if (kind === "chip") iconChip(x, y, INK, RED);
  else if (kind === "rocket") iconRocket(x, y, INK, RED);
  else if (kind === "leaf") iconLeaf(x, y, INK, RED);
  else if (kind === "scales") iconScales(x, y, INK, RED);
}

// A small US flag: thirteen stripes and a canton of stars.
function drawFlagUS(x, y, w, h) {
  const stripeH = h / 13;
  for (let i = 0; i < 13; i++) {
    fillRect(x, Math.round(y + i * stripeH), w, Math.ceil(stripeH), i % 2 === 0 ? [178, 34, 52] : [255, 255, 255]);
  }
  const cw = Math.round(w * 0.4);
  const ch = Math.round(stripeH * 7);
  fillRect(x, y, cw, ch, [60, 59, 110]);
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 5; col++) {
      fillRect(x + 4 + col * 8, y + 3 + r * 6, 2, 2, [255, 255, 255]);
    }
  }
}

// A target: concentric rings with a red centre, for the air-base strike.
function drawTarget(cx, cy) {
  fillCircle(cx, cy, 30, INK);
  fillCircle(cx, cy, 25, PAPER);
  fillCircle(cx, cy, 18, INK);
  fillCircle(cx, cy, 13, PAPER);
  fillCircle(cx, cy, 6, RED);
}

// ---------------------------------------------------------------------------
// Page layout — 1024x1024, margins of 36, same newspaper shape as the
// 20 November edition: masthead, two top boxes, six story rows, an ALSO strip.
// ---------------------------------------------------------------------------

const M = 36; // page margin
const CW = W - 2 * M; // content width: 952

function drawMasthead() {
  drawCentred(512, 30, "THE WORLD IN ONE IMAGE", 2, RED, 6);
  drawCentred(512, 60, "26 NOVEMBER 2026", 7, INK);
  drawCentred(512, 118, "THURSDAY · WORLD NEWS", 2, GREY, 4);
  fillRect(M, 142, CW, 3, RED);
  fillRect(M, 148, CW, 1, RULE);
}

function drawTopBox(bx, story, icon) {
  const bw = 466;
  const by = 162;
  const bh = 272;
  fillRect(bx, by, bw, bh, story === TOP1 ? BLUE_BG : CREAM_BG);
  // 2px ink border.
  fillRect(bx, by, bw, 2, RULE);
  fillRect(bx, by + bh - 2, bw, 2, RULE);
  fillRect(bx, by, 2, bh, RULE);
  fillRect(bx + bw - 2, by, 2, bh, RULE);
  const ix = bx + 16;
  const iw = bw - 32;
  drawText(ix, by + 14, story.kicker, 2, RED, 2);
  if (icon === "flag") {
    drawFlagUS(bx + (bw - 110) / 2, by + 40, 110, 58);
  } else {
    drawTarget(bx + bw / 2, by + 68);
  }
  drawPara(ix, by + 112, story.headline, 3, iw, INK, 30);
  drawPara(ix, by + 178, story.deck, 2, iw, INK, 22);
}

function drawRows() {
  let y = 458;
  const rowH = 78;
  for (let i = 0; i < ROWS.length; i++) {
    const row = ROWS[i];
    drawIcon(row.icon, M, y + 8);
    drawText(M + 60, y + 6, row.headline, 3, INK);
    drawPara(M + 60, y + 34, row.deck, 2, W - M - (M + 60), INK, 22);
    if (i < ROWS.length - 1) hline(M, y + rowH - 8, CW, [200, 192, 172]);
    y += rowH;
  }
  return y;
}

function drawFooter(y) {
  hline(M, y + 6, CW, RULE);
  drawText(M, y + 18, "ALSO:", 2, RED, 1);
  const x0 = M + textWidth("ALSO: ", 2, 1);
  drawPara(x0, y + 18, ALSO, 2, W - M - x0, INK, 22);
}

// ---------------------------------------------------------------------------
// Main: draw the page, encode it, write /output/entry.png.
// ---------------------------------------------------------------------------

function main() {
  drawMasthead();
  drawTopBox(M, TOP1, "flag");
  drawTopBox(M + 466 + 20, TOP2, "jet");
  const afterRows = drawRows();
  drawFooter(afterRows + 2);

  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR?.trim() || "/output";
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, "entry.png");
  writeFileSync(dest, png);
  console.log(`Wrote entry.png (${png.length} bytes, 1024x1024) to ${dest}`);
}

main();
