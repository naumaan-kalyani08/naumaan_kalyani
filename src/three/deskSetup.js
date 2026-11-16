import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  TubeGeometry,
  Euler,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import memojiUrl from "../assets/memoji/smile.png?url";

/*
 * The workspace around the laptop: a back wall (window, shelf, neon sign or
 * daylight), a wooden desk and a few personal props.
 *
 * Built for zero per-frame cost:
 *  - Everything is static and generated in code (no model downloads). The
 *    memoji on the phone reuses the image the hero already loads.
 *  - The room is ONE textured plane, painted once and pre-blurred (a cheap
 *    depth-of-field look; no post-processing).
 *  - Props are merged by material: lit props = 1 draw call, unlit details
 *    (phone screen, sticky notes, bulb) = 1, baked contact shadows = 1.
 *  - No extra lights and no shadow maps: lamp light and shadows are baked into
 *    textures. Theme swaps repaint lazily (each theme's wall is cached).
 *
 * World units: the laptop is ≈ 3.15 wide, the desk is y = 0, the camera looks
 * from +z (front) towards -z (the wall).
 */

const WALL_Z = -4.2;
const WALL_W = 24;
const WALL_H = 12;
const LAMP_SPOT = { x: -2.05, z: -0.95 }; // where the lamp's light lands on the desk
const MONITOR_GLOW = { x: 2.7, z: -1.3 }; // the monitor's light spill on the desk (night)
/** Felt desk mat under the laptop (and phone/mouse): its top is at MAT_TOP. */
export const MAT_TOP = 0.012;
const MAT = { x: 0.5, z: 0.15, w: 4.9, d: 2.8 };
// Roughly where the opening shot's camera sits (camera-facing glow quads).
const CAM0 = new Vector3(3.6, 2.6, 5.3);
const KEY_DIR = { x: 0.6, z: -0.8 }; // key light's shadow direction on the desk

const PALETTE = {
  dark: {
    bg: "#05070f",
    wood: { base: "#4a3122", light: "#6b4a33", grain: "#24160d" },
    notes: 0.62,
    screen: 1,
    monitor: 0.95,
    bulb: "#ffd7a1",
    shadeInner: "#d9a066",
    shadow: 0.55,
  },
  light: {
    bg: "#f4f3ef",
    wood: { base: "#cdb08a", light: "#e2c9a6", grain: "#9b7a55" },
    notes: 1,
    screen: 0.96,
    monitor: 0.9,
    bulb: "#cfc8bc",
    shadeInner: "#4a4c55",
    shadow: 0.32,
  },
};

const rand = (() => {
  let seed = 7;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
})();

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Cheap, portable blur (ctx.filter isn't supported everywhere): scale down,
// then back up with smoothing. Two halvings per pass look softer than one jump.
function softBlur(canvas, passes = 2) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const small = makeCanvas(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  const sctx = small.getContext("2d");
  sctx.imageSmoothingQuality = "high";
  ctx.imageSmoothingQuality = "high";
  for (let i = 0; i < passes; i += 1) {
    sctx.clearRect(0, 0, small.width, small.height);
    sctx.drawImage(canvas, 0, 0, small.width, small.height);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(small, 0, 0, w, h);
  }
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

/* ------------------------------------------------------------------ wood */

// Seamless plank texture (grain runs along x; sine frequencies are whole
// multiples of the width so it tiles).
function woodTexture(size, wood) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = wood.base;
  ctx.fillRect(0, 0, size, size);
  const planks = 4;
  const ph = size / planks;
  for (let p = 0; p < planks; p += 1) {
    ctx.globalAlpha = 0.18 + rand() * 0.2;
    ctx.fillStyle = rand() > 0.5 ? wood.light : wood.grain;
    ctx.fillRect(0, p * ph, size, ph);
  }
  ctx.globalAlpha = 1;
  const k = (2 * Math.PI) / size;
  for (let i = 0; i < size * 0.45; i += 1) {
    const y0 = rand() * size;
    const amp = 1 + rand() * size * 0.012;
    const f1 = k * (1 + Math.floor(rand() * 3));
    const f2 = k * (4 + Math.floor(rand() * 5));
    const phase = rand() * Math.PI * 2;
    ctx.strokeStyle = rand() > 0.3 ? wood.grain : wood.light;
    ctx.globalAlpha = 0.05 + rand() * 0.16;
    ctx.lineWidth = 0.4 + rand() * (size / 512) * 1.4;
    for (const dy of [0, -size, size]) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += size / 64) {
        const y = y0 + dy + Math.sin(x * f1 + phase) * amp + Math.sin(x * f2 + phase * 2) * amp * 0.3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // plank seams
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = wood.grain;
  for (let p = 0; p < planks; p += 1) ctx.fillRect(0, p * ph, size, Math.max(1, size / 512));
  ctx.globalAlpha = 1;
  const texture = toTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/* ------------------------------------------------------------------ wall */

function wallTexture(name, width) {
  const height = width / 2;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const u = width / WALL_W; // px per world unit
  const X = (x) => (x + WALL_W / 2) * u;
  const Y = (y) => height - y * u;
  const bg = PALETTE[name].bg;
  const night = name === "dark";

  // Wall wash: lighter near the desk, dissolving into the page colour above.
  const wash = ctx.createLinearGradient(0, Y(0), 0, Y(WALL_H));
  if (night) {
    wash.addColorStop(0, "#161b30");
    wash.addColorStop(0.45, "#0c1021");
    wash.addColorStop(1, bg);
  } else {
    wash.addColorStop(0, "#e6e0d4");
    wash.addColorStop(0.5, "#eeeae2");
    wash.addColorStop(1, bg);
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  // Window (left of the laptop).
  const win = { x0: -7.4, x1: -3.7, y0: 1.3, y1: 5.7 };
  const wx = X(win.x0);
  const wy = Y(win.y1);
  const ww = (win.x1 - win.x0) * u;
  const wh = (win.y1 - win.y0) * u;
  ctx.save();
  roundRect(ctx, wx, wy, ww, wh, u * 0.08);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, wy, 0, wy + wh);
  if (night) {
    sky.addColorStop(0, "#0a1532");
    sky.addColorStop(1, "#1d2a5c");
  } else {
    sky.addColorStop(0, "#b9d8ff");
    sky.addColorStop(1, "#eef6ff");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(wx, wy, ww, wh);
  if (night) {
    // city lights → bokeh
    for (let i = 0; i < 46; i += 1) {
      const bx = wx + rand() * ww;
      const by = wy + wh * (0.35 + rand() * 0.65);
      const r = u * (0.06 + rand() * 0.22);
      const hue = rand();
      const color = hue < 0.5 ? "255,183,107" : hue < 0.8 ? "122,167,255" : "255,255,255";
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, `rgba(${color},0.9)`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    // moon glow
    const mg = ctx.createRadialGradient(wx + ww * 0.75, wy + wh * 0.18, 0, wx + ww * 0.75, wy + wh * 0.18, u * 0.9);
    mg.addColorStop(0, "rgba(220,230,255,0.85)");
    mg.addColorStop(0.2, "rgba(220,230,255,0.35)");
    mg.addColorStop(1, "rgba(220,230,255,0)");
    ctx.fillStyle = mg;
    ctx.fillRect(wx, wy, ww, wh);
  } else {
    // trees outside
    for (let i = 0; i < 14; i += 1) {
      const bx = wx + rand() * ww;
      const by = wy + wh * (0.55 + rand() * 0.5);
      const r = u * (0.5 + rand() * 0.7);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, "rgba(120,170,110,0.75)");
      g.addColorStop(1, "rgba(120,170,110,0)");
      ctx.fillStyle = g;
      ctx.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  }
  ctx.restore();
  // frame + mullions
  ctx.strokeStyle = night ? "#060812" : "#fbfaf7";
  ctx.lineWidth = u * 0.16;
  roundRect(ctx, wx, wy, ww, wh, u * 0.08);
  ctx.stroke();
  ctx.lineWidth = u * 0.09;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh * 0.42);
  ctx.lineTo(wx + ww, wy + wh * 0.42);
  ctx.stroke();
  // sill
  ctx.fillStyle = night ? "#0e1222" : "#f7f5f0";
  ctx.fillRect(wx - u * 0.25, wy + wh, ww + u * 0.5, u * 0.16);

  if (!night) {
    // sunlight falling through the window onto the wall
    ctx.fillStyle = "rgba(255,226,180,0.38)";
    for (const [dx, wFrac] of [
      [0, 0.46],
      [0.54, 0.46],
    ]) {
      ctx.beginPath();
      const sx = wx + ww * (1.25 + dx * 0.9);
      ctx.moveTo(sx, wy + wh * 0.2);
      ctx.lineTo(sx + ww * wFrac * 0.9, wy + wh * 0.28);
      ctx.lineTo(sx + ww * wFrac * 0.9 + u * 0.9, wy + wh * 0.95);
      ctx.lineTo(sx + u * 0.9, wy + wh * 0.87);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Shelf (right): two planks with books, a small plant and a speaker.
  const shelfColor = night ? "#1c2134" : "#d8cdbb";
  const bookColors = night
    ? ["#3b3f8f", "#7c2d3a", "#2f6b5e", "#a0773b", "#4c5671", "#5b3a7a", "#3d5a80"]
    : ["#e07a5f", "#3d405b", "#81b29a", "#f2cc8f", "#6d77c5", "#c9a6d8", "#5b8db8"];
  const shelf = (y, x0, x1) => {
    ctx.fillStyle = shelfColor;
    ctx.fillRect(X(x0), Y(y), (x1 - x0) * u, u * 0.12);
  };
  shelf(3.4, 2.7, 7.2);
  shelf(1.9, 3.1, 7.2);
  let bx = 2.9;
  while (bx < 5.6) {
    const bw = 0.16 + rand() * 0.16;
    const bh = 0.62 + rand() * 0.36;
    ctx.fillStyle = bookColors[Math.floor(rand() * bookColors.length)];
    roundRect(ctx, X(bx), Y(3.4 + bh), bw * u, bh * u, u * 0.02);
    ctx.fill();
    bx += bw + 0.02;
  }
  // leaning book
  ctx.save();
  ctx.translate(X(5.85), Y(3.4));
  ctx.rotate(0.32);
  ctx.fillStyle = bookColors[2];
  ctx.fillRect(0, -0.85 * u, 0.2 * u, 0.85 * u);
  ctx.restore();
  // shelf plant
  ctx.fillStyle = night ? "#2a2f45" : "#f1ede6";
  roundRect(ctx, X(6.35), Y(3.95), 0.55 * u, 0.55 * u, u * 0.08);
  ctx.fill();
  for (let i = 0; i < 9; i += 1) {
    const lx = X(6.62 + (rand() - 0.5) * 0.9);
    const ly = Y(4.1 + rand() * 0.75);
    const r = u * (0.16 + rand() * 0.16);
    ctx.fillStyle = night ? "rgba(46,110,82,0.9)" : "rgba(92,150,96,0.95)";
    ctx.beginPath();
    ctx.ellipse(lx, ly, r, r * 0.55, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // lower shelf: stacked books + speaker
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = bookColors[(i + 3) % bookColors.length];
    ctx.fillRect(X(3.4 + i * 0.03), Y(1.9 + 0.13 * (i + 1)), u * (1.2 - i * 0.08), u * 0.12);
  }
  ctx.fillStyle = night ? "#11141f" : "#3a3d48";
  roundRect(ctx, X(5.4), Y(2.75), u * 0.62, u * 0.85, u * 0.08);
  ctx.fill();
  ctx.fillStyle = night ? "#2a2f45" : "#6b6f7c";
  ctx.beginPath();
  ctx.arc(X(5.71), Y(2.2), u * 0.17, 0, Math.PI * 2);
  ctx.fill();

  if (night) {
    // Warm lamp light spilling onto the wall behind the lamp.
    const lg = ctx.createRadialGradient(X(-2.7), Y(2.6), 0, X(-2.7), Y(2.6), u * 3.4);
    lg.addColorStop(0, "rgba(255,186,120,0.32)");
    lg.addColorStop(1, "rgba(255,186,120,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  } else {
    // Framed print above the desk.
    const fx = X(-0.95);
    const fy = Y(5.4);
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(fx, fy, 1.9 * u, 2.3 * u);
    const art = ctx.createLinearGradient(fx, fy, fx + 1.9 * u, fy + 2.3 * u);
    art.addColorStop(0, "#6366f1");
    art.addColorStop(1, "#5fd6f6");
    ctx.fillStyle = art;
    ctx.fillRect(fx + 0.18 * u, fy + 0.18 * u, 1.54 * u, 1.94 * u);
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(0.7 * u)}px "Space Grotesk", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("nk", fx + 0.95 * u, fy + 1.15 * u);
  }

  // Contact shadow where the desk meets the wall.
  const base = ctx.createLinearGradient(0, Y(0), 0, Y(0.7));
  base.addColorStop(0, night ? "rgba(0,0,0,0.55)" : "rgba(80,60,40,0.18)");
  base.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, Y(0.7), width, 0.7 * u);

  // Out of focus: the camera is focused on the laptop.
  softBlur(canvas, 2);

  // Neon sign (night), drawn after the blur: a light source stays bright
  // and glowing even out of focus.
  if (night) {
    const nx = X(0.1);
    const ny = Y(3.55);
    ctx.font = `700 ${Math.round(1.25 * u)}px "Space Grotesk", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(129,140,248,1)";
    ctx.shadowBlur = u * 0.9;
    ctx.strokeStyle = "rgba(165,180,252,1)";
    ctx.lineWidth = u * 0.07;
    ctx.strokeText("nk", nx, ny);
    ctx.shadowBlur = u * 0.35;
    ctx.strokeStyle = "#eef0ff";
    ctx.lineWidth = u * 0.035;
    ctx.strokeText("nk", nx, ny);
    ctx.shadowBlur = 0;
    const halo = ctx.createRadialGradient(nx, ny, 0, nx, ny, u * 2.2);
    halo.addColorStop(0, "rgba(99,102,241,0.28)");
    halo.addColorStop(1, "rgba(99,102,241,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }


  // Sides dissolve into the page colour (no hard wall edge at any aspect).
  for (const [x0, x1] of [
    [0, X(-7.5)],
    [width, X(7.5)],
  ]) {
    const side = ctx.createLinearGradient(x0, 0, x1, 0);
    side.addColorStop(0, bg);
    side.addColorStop(1, `${bg}00`);
    ctx.fillStyle = side;
    ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), height);
  }
  return toTexture(canvas);
}

/* --------------------------------------------------------- desk lighting */

// Baked light on the desk (lightMap, shared UVs with the plane): the main pool
// around the laptop, plus the lamp's warm pool at night.
function deskLight(name, planeSize, planeCenterZ) {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (name === "dark") {
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.3, "#9a9a9a");
    g.addColorStop(1, "#303030");
  } else {
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#f7f7f7");
    g.addColorStop(1, "#ededed");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (name === "dark") {
    const px = ((LAMP_SPOT.x + planeSize / 2) / planeSize) * size;
    const py = ((LAMP_SPOT.z - planeCenterZ + planeSize / 2) / planeSize) * size;
    const lamp = ctx.createRadialGradient(px, py, 0, px, py, size * 0.11);
    lamp.addColorStop(0, "rgba(255,196,130,0.75)");
    lamp.addColorStop(1, "rgba(255,196,130,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, size, size);
    const mx = ((MONITOR_GLOW.x + planeSize / 2) / planeSize) * size;
    const my = ((MONITOR_GLOW.z - planeCenterZ + planeSize / 2) / planeSize) * size;
    const glow = ctx.createRadialGradient(mx, my, 0, mx, my, size * 0.13);
    glow.addColorStop(0, "rgba(110,130,255,0.42)");
    glow.addColorStop(1, "rgba(110,130,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  return toTexture(canvas);
}

/* ------------------------------------------------------------- geometry */

const scratch = { m: new Matrix4(), q: new Quaternion(), s: new Vector3(), p: new Vector3(), e: new Euler() };

// Bake a transform + a flat vertex colour into a geometry (for merging).
function part(geometry, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], color = "#ffffff" } = {}) {
  const { m, q, s, p, e } = scratch;
  q.setFromEuler(e.set(rotation[0], rotation[1], rotation[2]));
  geometry.applyMatrix4(m.compose(p.set(...position), q, s.set(...scale)));
  const c = new Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
}

// Cylinder from a to b (for lamp arms, pens…).
function rod(a, b, radius, color, segments = 10) {
  const dir = new Vector3().subVectors(b, a);
  const length = dir.length();
  const geometry = new CylinderGeometry(radius, radius, length, segments, 1);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  geometry.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
  return part(geometry, { color });
}


// Turned profile ([radius, y] pairs) → smooth solid of revolution.
function lathe(points, segments) {
  return new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), segments);
}

// Place a geometry built along `from` (local axis) so it points along `to`, at `at`.
function orient(geometry, at, from, to) {
  const q = new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  geometry.applyMatrix4(new Matrix4().compose(at, q, new Vector3(1, 1, 1)));
  return geometry;
}

// Rounded rectangle in the xy plane, centred (for the iPhone body).
function roundedRectShape(w, h, r) {
  const shape = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// Map a plane's UVs to a pixel rect of the atlas.
function atlasUV(geometry, [x, y, w, h], atlasW, atlasH) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (x + uv.getX(i) * w) / atlasW, 1 - (y + (1 - uv.getY(i)) * h) / atlasH);
  }
  return geometry;
}

/* ----------------------------------------------------- atlas (unlit bits) */

const ATLAS_W = 1024;
const ATLAS_H = 1024;
const REGION = {
  phone: [0, 0, 256, 512],
  notes: [
    [280, 16, 200, 200],
    [500, 16, 200, 200],
    [720, 16, 200, 200],
    [280, 236, 200, 200],
  ],
  bulb: [940, 20, 64, 64],
  monitor: [0, 516, 896, 504],
};
const NOTES = [
  { color: "#ffe066", lines: ["YOU!", "Can achieve anything in life"] },
  { color: "#ffb3c7", lines: ["git commit -m", "\"final_v2\""] },
  { color: "#a5f3fc", lines: ["TODO:", "Build great stuff"] },
  { color: "#bbf7d0", lines: ["Remember", "Early failure means earlier to Learn"] },
];

// A real-looking editor on the monitor: one of this site's own components.
const CODE = [
  [["import", "#c792ea"], [" { useGSAP } ", "#d6deeb"], ["from", "#c792ea"], [' "@gsap/react"', "#ecc48d"], [";", "#d6deeb"]],
  [["import", "#c792ea"], [" gsap ", "#d6deeb"], ["from", "#c792ea"], [' "gsap"', "#ecc48d"], [";", "#d6deeb"]],
  [],
  [["export default function", "#c792ea"], [" Hero", "#82aaff"], ["() {", "#d6deeb"]],
  [["  const", "#c792ea"], [" ref ", "#d6deeb"], ["=", "#7fdbca"], [" useRef", "#82aaff"], ["(", "#d6deeb"], ["null", "#ff5874"], [");", "#d6deeb"]],
  [],
  [["  useGSAP", "#82aaff"], ["(() => {", "#d6deeb"]],
  [["    gsap", "#d6deeb"], [".from", "#82aaff"], ["(", "#d6deeb"], ['".hero__char"', "#ecc48d"], [", {", "#d6deeb"]],
  [["      yPercent", "#80cbc4"], [": ", "#d6deeb"], ["110", "#f78c6c"], [",", "#d6deeb"]],
  [["      stagger", "#80cbc4"], [": ", "#d6deeb"], ["0.03", "#f78c6c"], [",", "#d6deeb"]],
  [["      ease", "#80cbc4"], [": ", "#d6deeb"], ['"power4.out"', "#ecc48d"], [",", "#d6deeb"]],
  [["    });", "#d6deeb"]],
  [["  }, { ", "#d6deeb"], ["scope", "#80cbc4"], [": ref });", "#d6deeb"]],
  [],
  [["  return", "#c792ea"], [" <", "#7fdbca"], ["h1", "#ff5874"], [" ref", "#c5e478"], ["={ref}>", "#d6deeb"], ["Naumaan Kalyani", "#d6deeb"], ["</", "#7fdbca"], ["h1", "#ff5874"], [">;", "#7fdbca"]],
  [["}", "#d6deeb"]],
];

const FONT_UI = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const FONT_MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
const FONT_HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";

function drawPhone(ctx, memoji) {
  const [x, y, w, h] = REGION.phone;
  ctx.fillStyle = "#050505"; // black glass bezel
  ctx.fillRect(x, y, w, h);
  ctx.save();
  roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 34);
  ctx.clip();
  const lock = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  lock.addColorStop(0, "#1e1b4b");
  lock.addColorStop(0.5, "#4338ca");
  lock.addColorStop(1, "#0e7490");
  ctx.fillStyle = lock;
  ctx.fillRect(x, y, w, h);
  // Dynamic Island
  ctx.fillStyle = "#000";
  roundRect(ctx, x + w / 2 - 38, y + 20, 76, 22, 11);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = `600 13px ${FONT_UI}`;
  ctx.fillText(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()), x + w / 2, y + 74);
  ctx.font = `700 64px ${FONT_UI}`;
  // Same time as the laptop's menu bar (12-hour, no AM/PM like the lock screen).
  const now = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date());
  ctx.fillText(now.replace(/\s?[AP]M$/i, ""), x + w / 2, y + 136);
  if (memoji) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 250, 68, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
    ctx.clip();
    ctx.drawImage(memoji, x + w / 2 - 76, y + 174, 152, 152);
    ctx.restore();
  }
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  roundRect(ctx, x + 18, y + 352, w - 36, 66, 16);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.font = `700 13px ${FONT_UI}`;
  ctx.fillText("Naumaan · now", x + 32, y + 378);
  ctx.font = `500 12px ${FONT_UI}`;
  ctx.fillText("Let's build something great ✨", x + 32, y + 400);
  // torch + camera buttons, home bar
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (const cx of [x + 46, x + w - 46]) {
    ctx.beginPath();
    ctx.arc(cx, y + h - 64, 20, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  roundRect(ctx, x + w / 2 - 44, y + h - 26, 88, 5, 3);
  ctx.fill();
  ctx.restore();
}

let caretRect = null; // atlas px [x, y, w, h] of the editor's caret

function drawEditor(ctx) {
  const [x, y, w, h] = REGION.monitor;
  ctx.fillStyle = "#011627";
  ctx.fillRect(x, y, w, h);
  // title bar
  ctx.fillStyle = "#010e1a";
  ctx.fillRect(x, y, w, 26);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + 16 + i * 16, y + 13, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#5f7e97";
  ctx.font = `500 11px ${FONT_UI}`;
  ctx.textAlign = "center";
  ctx.fillText("portfolio-nk08 — Hero.jsx", x + w / 2, y + 17);
  // activity bar + explorer
  ctx.fillStyle = "#010e1a";
  ctx.fillRect(x, y + 26, 34, h - 48);
  ctx.fillStyle = "#3b5672";
  for (let i = 0; i < 4; i += 1) ctx.fillRect(x + 10, y + 42 + i * 34, 14, 14);
  ctx.fillStyle = "#0b2942";
  ctx.fillRect(x + 34, y + 26, 170, h - 48);
  ctx.textAlign = "left";
  ctx.font = `600 10px ${FONT_UI}`;
  ctx.fillStyle = "#89a4bb";
  ctx.fillText("EXPLORER", x + 46, y + 46);
  const files = ["▾ src", "  ▾ components", "     Hero.jsx", "     Dock.jsx", "     LaptopIntro.jsx", "  ▸ three", "  ▸ style", "  App.jsx", "package.json"];
  ctx.font = `500 12px ${FONT_UI}`;
  files.forEach((f, i) => {
    if (i === 2) {
      ctx.fillStyle = "#1d3b53";
      ctx.fillRect(x + 34, y + 58 + i * 21, 170, 20);
    }
    ctx.fillStyle = i === 2 ? "#ffffff" : "#a3b8cc";
    ctx.fillText(f, x + 46, y + 72 + i * 21);
  });
  // tabs
  const ex = x + 204;
  ctx.fillStyle = "#010e1a";
  ctx.fillRect(ex, y + 26, w - 204, 28);
  ctx.fillStyle = "#011627";
  ctx.fillRect(ex, y + 26, 110, 28);
  ctx.fillStyle = "#6366f1";
  ctx.fillRect(ex, y + 26, 110, 2);
  ctx.fillStyle = "#d6deeb";
  ctx.font = `500 12px ${FONT_UI}`;
  ctx.fillText("Hero.jsx", ex + 30, y + 45);
  ctx.fillStyle = "#5f7e97";
  ctx.fillText("Hero.css", ex + 140, y + 45);
  // code
  ctx.font = `500 15px ${FONT_MONO}`;
  CODE.forEach((tokens, i) => {
    const ly = y + 82 + i * 22;
    ctx.fillStyle = i === 7 ? "#4b6479" : "#2b4b65";
    ctx.textAlign = "right";
    ctx.fillText(String(i + 1), ex + 34, ly);
    ctx.textAlign = "left";
    if (i === 7) {
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(ex + 40, ly - 15, w - 250, 21);
    }
    let cx = ex + 50;
    tokens.forEach(([text, color]) => {
      ctx.fillStyle = color;
      ctx.fillText(text, cx, ly);
      cx += ctx.measureText(text).width;
    });
  });
  // caret: a separate blinking mesh (see createDeskSetup); just remember where
  caretRect = [ex + 50 + ctx.measureText('    gsap.from(".hero__char", {').width, y + 82 + 7 * 22 - 15, 2, 19];
  // status bar
  ctx.fillStyle = "#4f46e5";
  ctx.fillRect(x, y + h - 22, w, 22);
  ctx.fillStyle = "#fff";
  ctx.font = `500 11px ${FONT_UI}`;
  ctx.fillText("⎇ main   ✓ 0   ⚠ 0", x + 12, y + h - 7);
  ctx.textAlign = "right";
  ctx.fillText("Ln 8, Col 31   UTF-8   JavaScript JSX   Prettier ✓", x + w - 12, y + h - 7);
}

function drawAtlas(ctx, memoji) {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  drawPhone(ctx, memoji);
  REGION.notes.forEach(([x, y, w, h], i) => {
    const note = NOTES[i];
    ctx.fillStyle = note.color;
    ctx.fillRect(x, y, w, h);
    const fold = ctx.createLinearGradient(x, y + h * 0.8, x, y + h);
    fold.addColorStop(0, "rgba(0,0,0,0)");
    fold.addColorStop(1, "rgba(0,0,0,0.1)");
    ctx.fillStyle = fold;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.07)"; // adhesive strip
    ctx.fillRect(x, y, w, h * 0.15);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Each entry of note.lines is a paragraph: word-wrapped, and the font
    // shrinks until everything fits inside the note (below the strip).
    const maxW = w * 0.84;
    const areaTop = y + h * 0.2;
    const areaH = h * 0.74;
    let size = h * 0.17;
    let rows = [];
    for (; size > h * 0.075; size -= 1) {
      ctx.font = `700 ${Math.round(size)}px ${FONT_HAND}`;
      rows = [];
      note.lines.forEach((paragraph, pi) => {
        let row = "";
        String(paragraph).split(/\s+/).forEach((word) => {
          const next = row ? `${row} ${word}` : word;
          if (row && ctx.measureText(next).width > maxW) {
            rows.push({ text: row, head: pi === 0 });
            row = word;
          } else row = next;
        });
        rows.push({ text: row, head: pi === 0 });
      });
      const widest = Math.max(...rows.map((r) => ctx.measureText(r.text).width));
      if (rows.length * size * 1.18 <= areaH && widest <= maxW) break;
    }
    const lineH = size * 1.18;
    const startY = areaTop + (areaH - rows.length * lineH) / 2 + lineH / 2;
    rows.forEach((r, k) => {
      ctx.font = `${r.head ? 800 : 700} ${Math.round(size)}px ${FONT_HAND}`;
      ctx.fillText(r.text, x + w / 2, startY + k * lineH);
    });
    ctx.restore();
  });
  ctx.textBaseline = "alphabetic";
  const [bx, by, bw, bh] = REGION.bulb;
  ctx.fillStyle = "#fff";
  ctx.fillRect(bx, by, bw, bh);
  drawEditor(ctx);
}

/* ------------------------------------------------------------- the setup */

export function createDeskSetup({ isMobile, reduced = false, renderer, onChange, edgeZ = 3 }) {
  const group = new Group();
  const textures = new Set();
  const own = (texture) => {
    textures.add(texture);
    return texture;
  };
  const seg = isMobile ? 0.6 : 1; // fewer segments on phones
  const n = (count) => Math.max(8, Math.round(count * seg));

  // Wall: textures painted lazily per theme, cached.
  const wallCache = {};
  const wallFor = (name) => (wallCache[name] ??= own(wallTexture(name, isMobile ? 512 : 1024)));
  const wall = new Mesh(new PlaneGeometry(WALL_W, WALL_H), new MeshBasicMaterial({ toneMapped: false }));
  wall.position.set(0, WALL_H / 2, WALL_Z);
  group.add(wall);

  // Desk wood (tiled) + baked light, applied to the scene's desk plane.
  const woodCache = {};
  const lightCache = {};
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const woodFor = (name) =>
    (woodCache[name] ??= (() => {
      const texture = own(woodTexture(isMobile ? 512 : 1024, PALETTE[name].wood));
      texture.repeat.set(3, 3);
      texture.anisotropy = anisotropy;
      return texture;
    })());
  const lightFor = (name, size, centerZ) => (lightCache[name] ??= own(deskLight(name, size, centerZ)));
  // Where the varnish reflections show: around the work area, fading out.
  let mask = null;
  const sheenMask = () => {
    if (mask) return mask;
    const canvas = makeCanvas(128, 128);
    const ctx = canvas.getContext("2d");
    const g = ctx.createRadialGradient(64, 68, 0, 64, 68, 50);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.5, "#bbb");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    mask = own(new CanvasTexture(canvas));
    return mask;
  };

  /* ---- Lit props, merged by finish: matte / gloss / metal (3 draw calls) ---- */
  const matte = [];
  const gloss = [];
  const metal = [];
  const graphite = "#2b2d34";
  const steel = "#b9bcc4";

  // Desk lamp (right, behind) — metal arms, lathed shade with a lip.
  const lampBase = new Vector3(-3.15, 0.1, -2.4);
  const elbow = new Vector3(-3.3, 1.95, -2.85);
  const headAt = new Vector3(-2.4, 2.05, -1.7);
  metal.push(part(lathe([[0, 0], [0.5, 0], [0.56, 0.03], [0.55, 0.08], [0.47, 0.11], [0.12, 0.13], [0, 0.13]], n(40)), { position: [lampBase.x, 0, lampBase.z], color: graphite }));
  const brass = "#c9a24a";
  metal.push(rod(lampBase, elbow, 0.036, graphite, n(16)));
  metal.push(rod(elbow, headAt, 0.036, graphite, n(16)));
  // brass joints: elbow knuckle, base collar, head swivel
  metal.push(part(new SphereGeometry(0.075, n(18), n(14)), { position: elbow.toArray(), color: brass }));
  metal.push(part(lathe([[0.075, 0], [0.085, 0.02], [0.085, 0.07], [0.06, 0.09]], n(24)), { position: [lampBase.x, 0.125, lampBase.z], color: brass }));
  metal.push(part(new SphereGeometry(0.06, n(16), n(12)), { position: headAt.toArray(), color: brass }));
  const shadeDir = new Vector3(LAMP_SPOT.x, 0, LAMP_SPOT.z).sub(headAt).normalize();
  // profile runs inner-top → inner rim → outer rim → outer top, so the outside
  // faces out and the inside (seen from below) faces in.
  // Shade: one outward-facing shell (rim → crown → cap); its inside is the
  // glowing detail surface below, and a thin brass ring finishes the rim.
  const shadeAt = headAt.clone().addScaledVector(shadeDir, 0.3);
  const shadeGeo = lathe([[0.42, 0], [0.3, 0.12], [0.16, 0.27], [0.11, 0.31], [0.06, 0.335], [0, 0.34]], n(48));
  orient(shadeGeo, shadeAt, new Vector3(0, -1, 0), shadeDir);
  metal.push(part(shadeGeo, { color: graphite }));
  const rim = new TorusGeometry(0.42, 0.012, n(8), n(48));
  rim.rotateX(Math.PI / 2);
  orient(rim, shadeAt, new Vector3(0, -1, 0), shadeDir);
  metal.push(part(rim, { color: brass }));

  // Plant (far right) — glazed pot, curved leaves.
  const plant = { x: -4.45, z: -1.75 };
  gloss.push(part(lathe([[0, 0.02], [0.3, 0.02], [0.33, 0], [0.36, 0.04], [0.44, 0.74], [0.46, 0.79], [0.43, 0.81], [0.4, 0.76], [0.38, 0.7]], n(40)), { position: [plant.x, 0, plant.z], color: "#ece7de" }));
  matte.push(part(new CylinderGeometry(0.385, 0.385, 0.02, n(28)), { position: [plant.x, 0.7, plant.z], color: "#1c130d" }));
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + rand() * 0.45;
    const tilt = 0.18 + rand() * 0.4;
    const len = 0.7 + rand() * 0.6;
    const leaf = new SphereGeometry(0.5, n(12), n(14));
    leaf.applyMatrix4(new Matrix4().makeScale(0.3, len * 1.7, 0.06));
    // arch the leaf outward (z) and pinch the tip
    const p = leaf.attributes.position;
    for (let v = 0; v < p.count; v += 1) {
      const t = (p.getY(v) / (len * 0.85) + 1) / 2; // 0 base → 1 tip
      p.setX(v, p.getX(v) * (1 - t * 0.45));
      p.setZ(v, p.getZ(v) + t * t * len * 0.35);
    }
    leaf.computeVertexNormals();
    leaf.applyMatrix4(new Matrix4().makeTranslation(0, len * 0.82, 0));
    part(leaf, {
      position: [plant.x + Math.cos(a) * 0.08, 0.68, plant.z + Math.sin(a) * 0.08],
      rotation: [Math.sin(a) * tilt, a + Math.PI / 2, -Math.cos(a) * tilt],
      color: ["#4f8f5c", "#3d7a4b", "#5ea06b", "#46855a"][i % 4],
    });
    matte.push(leaf);
  }

  // Mug — lathed ceramic with a real rim and inside, coffee, handle.
  const mug = { x: 2.85, z: -0.95 };
  gloss.push(
    part(
      lathe([[0, 0], [0.31, 0], [0.335, 0.015], [0.35, 0.05], [0.36, 0.8], [0.352, 0.83], [0.335, 0.83], [0.325, 0.8], [0.315, 0.08], [0, 0.07]], n(48)),
      { position: [mug.x, 0, mug.z], color: "#f3f1ec" }
    )
  );
  gloss.push(part(new CylinderGeometry(0.318, 0.318, 0.01, n(32)), { position: [mug.x, 0.66, mug.z], color: "#2b170c" }));
  gloss.push(part(new TorusGeometry(0.19, 0.055, n(12), n(24), Math.PI), { position: [mug.x + 0.34, 0.42, mug.z], rotation: [0, 0, -Math.PI / 2], color: "#f3f1ec" }));

  // Notebook + pen (left, in front) — rounded covers, lathed pen.
  const book = { x: -2.65, z: 0.95, ry: 0.28 };
  const bookAt = (dx, dy, dz) => {
    const c = Math.cos(book.ry);
    const s = Math.sin(book.ry);
    return [book.x + dx * c + dz * s, dy, book.z - dx * s + dz * c];
  };
  matte.push(part(new RoundedBoxGeometry(1.5, 0.05, 2.05, 2, 0.02), { position: bookAt(0, 0.025, 0), rotation: [0, book.ry, 0], color: "#ff7a1a" }));
  matte.push(part(new RoundedBoxGeometry(1.42, 0.07, 1.98, 1, 0.01), { position: bookAt(0.02, 0.085, 0), rotation: [0, book.ry, 0], color: "#f4efe4" }));
  matte.push(part(new RoundedBoxGeometry(1.5, 0.035, 2.05, 2, 0.015), { position: bookAt(0, 0.137, 0), rotation: [0, book.ry, 0], color: "#ff7a1a" }));
  matte.push(part(new RoundedBoxGeometry(0.05, 0.165, 2.07, 1, 0.012), { position: bookAt(0.5, 0.08, 0), rotation: [0, book.ry, 0], color: "#1f2937" }));
  const penA = new Vector3(...bookAt(-0.45, 0.19, 0.75));
  const penB = new Vector3(...bookAt(0.35, 0.19, -0.75));
  const penLen = penA.distanceTo(penB);
  const pen = lathe([[0, 0], [0.012, 0.02], [0.03, 0.12], [0.036, 0.16], [0.036, penLen - 0.02], [0.03, penLen], [0, penLen]], n(18));
  orient(pen, penA, new Vector3(0, 1, 0), new Vector3().subVectors(penB, penA));
  gloss.push(part(pen, { color: "#14161c" }));
  const clip = new RoundedBoxGeometry(0.02, 0.02, 0.42, 1, 0.008);
  const clipAt = penA.clone().lerp(penB, 0.82).add(new Vector3(0, 0.04, 0));
  clip.applyMatrix4(new Matrix4().compose(clipAt, new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3().subVectors(penB, penA).normalize()), new Vector3(1, 1, 1)));
  metal.push(part(clip, { color: "#d4b25a" }));

  // iPhone (right, beside the laptop): rounded titanium body + buttons.
  const phone = { x: 2.4, z: 0.4, ry: -0.18, w: 0.72, d: 1.48, h: 0.075 };
  const body = new ExtrudeGeometry(roundedRectShape(phone.w, phone.d, 0.12), {
    depth: phone.h - 0.02,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: n(8),
  });
  body.rotateX(Math.PI / 2); // extrude along -y → lies flat
  body.translate(0, phone.h - 0.01, 0);
  metal.push(part(body, { position: [phone.x, MAT_TOP, phone.z], rotation: [0, phone.ry, 0], color: "#cfc9bf" }));
  const phoneAt = (dx, dy, dz) => {
    const c = Math.cos(phone.ry);
    const s = Math.sin(phone.ry);
    return [phone.x + dx * c + dz * s, dy, phone.z - dx * s + dz * c];
  };
  [
    [-phone.w / 2 - 0.012, -0.28, 0.16],
    [-phone.w / 2 - 0.012, -0.08, 0.16],
    [phone.w / 2 + 0.012, -0.18, 0.24],
  ].forEach(([dx, dz, len]) =>
    metal.push(part(new RoundedBoxGeometry(0.02, 0.03, len, 1, 0.008), { position: phoneAt(dx, 0.038 + MAT_TOP, dz), rotation: [0, phone.ry, 0], color: "#cfc9bf" }))
  );

  // External monitor (left, behind): thin glossy display on a metal stand.
  const mon = { x: 3.5, z: -2.75, ry: -0.36, w: 4.3, h: 2.45, y: 0.62 };
  const monAt = (dx, dy, dz) => {
    const c = Math.cos(mon.ry);
    const s = Math.sin(mon.ry);
    return [mon.x + dx * c + dz * s, dy, mon.z - dx * s + dz * c];
  };
  metal.push(part(new RoundedBoxGeometry(1.55, 0.06, 1.05, 2, 0.025), { position: monAt(0, 0.03, -0.15), rotation: [0, mon.ry, 0], color: steel }));
  metal.push(part(new RoundedBoxGeometry(0.34, 1.2, 0.09, 2, 0.04), { position: monAt(0, 0.66, -0.4), rotation: [0.1, mon.ry, 0], color: steel }));
  gloss.push(part(new RoundedBoxGeometry(mon.w, mon.h, 0.07, 3, 0.03), { position: monAt(0, mon.y + mon.h / 2, 0), rotation: [0, mon.ry, 0], color: "#0d0e12" }));
  matte.push(part(new RoundedBoxGeometry(mon.w * 0.62, mon.h * 0.62, 0.12, 2, 0.05), { position: monAt(0, mon.y + mon.h / 2, -0.07), rotation: [0, mon.ry, 0], color: "#1a1b20" }));

  // Felt desk mat under the laptop, phone and mouse.
  matte.push(part(new RoundedBoxGeometry(MAT.w, MAT_TOP, MAT.d, 2, 0.005), { position: [MAT.x, MAT_TOP / 2, MAT.z], color: "#26272c" }));

  // Magic Mouse (right of the laptop): a flattened glossy shell.
  const mouse = { x: 2.02, z: -0.42, ry: -0.2 };
  const mouseGeo = new SphereGeometry(0.5, n(32), n(16), 0, Math.PI * 2, 0, Math.PI / 2);
  mouseGeo.applyMatrix4(new Matrix4().makeScale(0.36, 0.2, 0.62));
  gloss.push(part(mouseGeo, { position: [mouse.x, MAT_TOP, mouse.z], rotation: [0, mouse.ry, 0], color: "#f3f3f1" }));

  // Wireless keyboard in front of the monitor: aluminium base + white keys.
  const kb = { x: 2.55, z: -1.85, ry: -0.3 };
  const kbAt = (dx, dy, dz) => {
    const c = Math.cos(kb.ry);
    const s = Math.sin(kb.ry);
    return [kb.x + dx * c + dz * s, dy, kb.z - dx * s + dz * c];
  };
  metal.push(part(new RoundedBoxGeometry(2.25, 0.05, 0.74, 2, 0.02), { position: kbAt(0, 0.025, 0), rotation: [0, kb.ry, 0], color: steel }));
  const pitch = 0.148;
  const rows = [Array(14).fill(1), Array(14).fill(1), Array(14).fill(1), Array(14).fill(1), [1, 1, 1, 1.3, 5.4, 1.3, 1, 1, 1]];
  rows.forEach((row, r) => {
    const total = row.reduce((a, b) => a + b, 0);
    let x = -(total * pitch) / 2;
    row.forEach((units) => {
      const w = units * pitch;
      matte.push(
        part(new BoxGeometry(w - 0.022, 0.024, pitch - 0.026), {
          position: kbAt(x + w / 2, 0.062, -0.27 + r * 0.135),
          rotation: [0, kb.ry, 0],
          color: "#f4f4f2",
        })
      );
      x += w;
    });
  });

  // USB-C cable: laptop's right side → behind the keyboard → monitor stand.
  const cablePath = new CatmullRomCurve3(
    [
      [1.58, 0.05, -0.85],
      [1.74, 0.03, -1.05],
      [1.38, 0.019, -1.55],
      [1.1, 0.018, -2.3],
      [1.45, 0.018, -2.78],
      [2.6, 0.018, -2.9],
      [3.3, 0.03, -3.05],
      [3.58, 0.3, -3.13],
      [3.62, 0.62, -3.15],
    ].map((p) => new Vector3(...p))
  );
  matte.push(part(new TubeGeometry(cablePath, n(90), 0.018, n(6), false), { color: "#e9e9e6" }));

  const finish = (list, options) => {
    // ExtrudeGeometry is non-indexed; merging needs one layout for all parts.
    const indexed = list.map((g) => (g.index ? g : mergeVertices(g)));
    const geometry = mergeGeometries(indexed, false);
    indexed.forEach((g) => g.dispose());
    list.forEach((g) => g.dispose());
    return new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, ...options }));
  };
  const props = [
    finish(matte, { roughness: 0.78, metalness: 0, envMapIntensity: 0.5 }),
    finish(gloss, { roughness: 0.2, metalness: 0, envMapIntensity: 0.9 }),
    finish(metal, { roughness: 0.34, metalness: 0.85, envMapIntensity: 1 }),
  ];
  props.forEach((mesh) => group.add(mesh));

  /* ---- Mug print: a textured sleeve hugging the mug's outer wall ---- */
  // Circumference ≈ 2π·0.356 ≈ 2.24 vs 0.64 tall → a 1024×292 canvas.
  const printCanvas = makeCanvas(1024, 292);
  const pctx = printCanvas.getContext("2d");
  pctx.fillStyle = "#f3f1ec";
  pctx.fillRect(0, 0, 1024, 292);
  pctx.textAlign = "center";
  pctx.fillStyle = "#1f2937";
  pctx.font = `italic 600 40px Georgia, "Times New Roman", serif`;
  ["Make it work,", "make it right,", "make it fast."].forEach((line, i) => pctx.fillText(line, 512, 92 + i * 50));
  pctx.fillStyle = "#4f46e5";
  pctx.font = `600 20px ${FONT_UI}`;
  pctx.fillText("— KENT BECK", 512, 262);
  // a small brand mark on the far side
  pctx.fillStyle = "#4f46e5";
  pctx.font = `800 46px "Space Grotesk", ${FONT_UI}`;
  // drawn across the seam (u = 0 = 1), directly opposite the quote
  pctx.fillText("nk.", 0, 168);
  pctx.fillText("nk.", 1024, 168);
  const printTexture = own(toTexture(printCanvas));
  printTexture.anisotropy = anisotropy;
  // Centre the quote toward the camera's side, away from the handle (+x).
  const facing = MathUtils.degToRad(-8);
  const sleeve = new Mesh(
    new CylinderGeometry(0.3612, 0.3527, 0.64, n(64), 1, true, facing - Math.PI, Math.PI * 2),
    new MeshStandardMaterial({ map: printTexture, roughness: 0.2, metalness: 0, envMapIntensity: 0.9 })
  );
  sleeve.position.set(mug.x, 0.42, mug.z);
  group.add(sleeve);

  /* ---- Unlit details: screens, sticky notes, bulb (one draw call) ---- */
  const atlasCanvas = makeCanvas(ATLAS_W, ATLAS_H);
  const atlasCtx = atlasCanvas.getContext("2d");
  drawAtlas(atlasCtx, null);
  const atlas = own(toTexture(atlasCanvas));
  atlas.anisotropy = anisotropy;
  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    drawAtlas(atlasCtx, image);
    atlas.needsUpdate = true;
    onChange?.();
  };
  image.src = memojiUrl;

  const detailParts = [];
  const ranges = {}; // vertex ranges for per-theme tinting
  let cursor = 0;
  const addDetail = (key, geometry) => {
    ranges[key] = [...(ranges[key] ?? []), [cursor, geometry.attributes.position.count]];
    cursor += geometry.attributes.position.count;
    detailParts.push(geometry);
  };
  // phone screen (top of the screen points away from the camera)
  // Rounded to match the body's corners (a plain rectangle would poke out).
  const sw = phone.w - 0.024;
  const sd = phone.d - 0.024;
  const screenGeo = new ShapeGeometry(roundedRectShape(sw, sd, 0.108), n(10));
  const suv = screenGeo.attributes.uv;
  const spos = screenGeo.attributes.position;
  for (let i = 0; i < suv.count; i += 1) suv.setXY(i, spos.getX(i) / sw + 0.5, spos.getY(i) / sd + 0.5);
  addDetail("screen", part(atlasUV(screenGeo, REGION.phone, ATLAS_W, ATLAS_H), { position: [phone.x, phone.h + 0.004 + MAT_TOP, phone.z], rotation: [-Math.PI / 2, 0, phone.ry], color: "#ffffff" }));
  // monitor screen
  addDetail("monitor", part(atlasUV(new PlaneGeometry(mon.w - 0.12, (mon.w - 0.12) * (504 / 896)), REGION.monitor, ATLAS_W, ATLAS_H), { position: monAt(0, mon.y + mon.h / 2 + 0.03, 0.037), rotation: [0, mon.ry, 0], color: "#ffffff" }));
  // sticky notes: two on the monitor's bezel, two on the desk
  const noteSize = 0.5;
  addDetail("notes", part(atlasUV(new PlaneGeometry(noteSize, noteSize), REGION.notes[0], ATLAS_W, ATLAS_H), { position: monAt(-mon.w / 2 + 0.22, mon.y + mon.h - 0.15, 0.04), rotation: [0, mon.ry, 0.12], color: "#ffffff" }));
  addDetail("notes", part(atlasUV(new PlaneGeometry(noteSize, noteSize), REGION.notes[3], ATLAS_W, ATLAS_H), { position: monAt(mon.w / 2 - 0.27, mon.y + 0.2, 0.041), rotation: [0, mon.ry, -0.09], color: "#ffffff" }));
  [
    [-1.45, 1.85, 0.2, 1],
    [-0.85, 2.15, -0.14, 2],
  ].forEach(([x, z, r, i], k) => {
    addDetail("notes", part(atlasUV(new PlaneGeometry(0.62, 0.62), REGION.notes[i], ATLAS_W, ATLAS_H), { position: [x, 0.004 + k * 0.001, z], rotation: [-Math.PI / 2, 0, r], color: "#ffffff" }));
  });
  const bulbGeometry = new SphereGeometry(0.12, n(14), n(10));
  const [bx, by, bw, bh] = REGION.bulb;
  const bulbUV = bulbGeometry.attributes.uv;
  for (let i = 0; i < bulbUV.count; i += 1) bulbUV.setXY(i, (bx + bw / 2) / ATLAS_W, 1 - (by + bh / 2) / ATLAS_H);
  addDetail("bulb", part(bulbGeometry, { position: headAt.clone().addScaledVector(shadeDir, 0.2).toArray(), color: "#ffffff" }));
  // Inside of the shade (just inside the metal shell), lit by the bulb.
  // runs downward (crown → rim) so it faces inward: seen only from inside
  const glowGeo = lathe([[0, 0.325], [0.06, 0.322], [0.11, 0.298], [0.16, 0.258], [0.3, 0.108], [0.412, 0.004]], n(48));
  for (let i = 0; i < glowGeo.attributes.uv.count; i += 1) glowGeo.attributes.uv.setXY(i, (bx + bw / 2) / ATLAS_W, 1 - (by + bh / 2) / ATLAS_H);
  orient(glowGeo, headAt.clone().addScaledVector(shadeDir, 0.3), new Vector3(0, -1, 0), shadeDir);
  addDetail("shade", part(glowGeo, { color: "#ffffff" }));

  const detailsGeometry = mergeGeometries(detailParts, false);
  detailParts.forEach((g) => g.dispose());
  const details = new Mesh(detailsGeometry, new MeshBasicMaterial({ map: atlas, vertexColors: true, toneMapped: false }));
  group.add(details);

  /* ---- Baked contact shadows (one draw call) ---- */
  const blob = makeCanvas(128, 128);
  const bctx = blob.getContext("2d");
  const bg = bctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  bg.addColorStop(0, "rgba(0,0,0,1)");
  bg.addColorStop(0.5, "rgba(0,0,0,0.55)");
  bg.addColorStop(1, "rgba(0,0,0,0)");
  bctx.fillStyle = bg;
  bctx.fillRect(0, 0, 128, 128);
  const blobTexture = own(toTexture(blob));
  // [x, z, width, depth, rotation, strength]
  const xz = (p) => [p[0], p[2]];
  // A cast shadow: stretched away from the key light, longer for taller props.
  const keyAngle = Math.atan2(-KEY_DIR.x, -KEY_DIR.z); // plane rotation aligning its depth with KEY_DIR
  const cast = (x, z, foot, height, strength) => [x + KEY_DIR.x * height * 0.42, z + KEY_DIR.z * height * 0.42, foot, foot + height * 0.85, keyAngle, strength];
  const shadowList = [
    // soft contact blobs
    [lampBase.x, lampBase.z, 1.5, 1.5, 0, 1],
    [plant.x, plant.z, 1.4, 1.4, 0, 1],
    [mug.x + 0.05, mug.z + 0.05, 1.15, 1.15, 0, 1],
    [book.x, book.z, 2.0, 2.55, book.ry, 1],
    [phone.x, phone.z, 0.98, 1.75, phone.ry, 1],
    [...xz(monAt(0, 0, -0.15)), 2.1, 1.5, mon.ry, 1],
    [...xz(monAt(0, 0, 0.35)), mon.w + 0.6, 0.9, mon.ry, 1],
    [mouse.x, mouse.z, 0.55, 0.85, mouse.ry, 0.9],
    [...xz(kbAt(0, 0, 0)), 2.6, 1.0, kb.ry, 0.75],
    [MAT.x, MAT.z, MAT.w + 0.25, MAT.d + 0.25, 0, 0.35],
    // tight ambient occlusion right at the contact points
    [lampBase.x, lampBase.z, 1.2, 1.2, 0, 0.7],
    [plant.x, plant.z, 0.98, 0.98, 0, 0.7],
    [mug.x, mug.z, 0.78, 0.78, 0, 0.75],
    [mouse.x, mouse.z, 0.4, 0.66, mouse.ry, 0.6],
    // directional shadows cast away from the key light
    cast(lampBase.x, lampBase.z, 0.55, 2.1, 0.32),
    cast(plant.x, plant.z, 0.85, 2.0, 0.34),
    cast(mug.x, mug.z, 0.7, 0.85, 0.42),
    cast(...xz(monAt(0, 0, -0.4)), 0.6, 1.8, 0.28),
  ];
  const shadowParts = shadowList.map(([x, z, w, d, ry, a]) => {
    const g = part(new PlaneGeometry(w, d), { position: [x, MAT_TOP + 0.003, z], rotation: [-Math.PI / 2, 0, ry] });
    // black, with the strength in the vertex alpha (one draw call for all)
    const rgba = new Float32Array(g.attributes.position.count * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = a;
    g.setAttribute("color", new Float32BufferAttribute(rgba, 4));
    return g;
  });
  const shadowGeometry = mergeGeometries(shadowParts, false);
  shadowParts.forEach((g) => g.dispose());
  const shadows = new Mesh(
    shadowGeometry,
    new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, map: blobTexture, transparent: true, depthWrite: false, toneMapped: false })
  );
  shadows.renderOrder = 1;
  group.add(shadows);

  /* ---- Fake bloom: additive glow quads (night only, one draw call) ---- */
  const glowCanvas = makeCanvas(64, 64);
  const gctx = glowCanvas.getContext("2d");
  const gg = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gg.addColorStop(0, "rgba(255,255,255,1)");
  gg.addColorStop(0.25, "rgba(255,255,255,0.45)");
  gg.addColorStop(0.6, "rgba(255,255,255,0.1)");
  gg.addColorStop(1, "rgba(255,255,255,0)");
  gctx.fillStyle = gg;
  gctx.fillRect(0, 0, 64, 64);
  const glowTexture = own(toTexture(glowCanvas));
  const bulbAt = headAt.clone().addScaledVector(shadeDir, 0.2);
  const faceCam = (at) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(CAM0, at, new Vector3(0, 1, 0)));
  const glowSpecs = {
    bulb: { color: new Color("#ffb168").multiplyScalar(0.7), build: () => new PlaneGeometry(1.7, 1.7).applyMatrix4(new Matrix4().compose(bulbAt.clone().addScaledVector(shadeDir, 0.15), faceCam(bulbAt), new Vector3(1, 1, 1))) },
    monitor: { color: new Color("#4b63ff").multiplyScalar(0.32), build: () => part(new PlaneGeometry(mon.w + 2.2, mon.h + 1.9), { position: monAt(0, mon.y + mon.h / 2, -0.07), rotation: [0, mon.ry, 0] }) },
    phone: { color: new Color("#6f6bff").multiplyScalar(0.34), build: () => part(new PlaneGeometry(1.5, 2.25), { position: [phone.x, MAT_TOP + 0.004, phone.z], rotation: [-Math.PI / 2, 0, phone.ry] }) },
  };
  const glowRanges = {};
  let glowCursor = 0;
  const glowParts = Object.entries(glowSpecs).map(([key, spec]) => {
    const g = spec.build();
    glowRanges[key] = [glowCursor, g.attributes.position.count];
    glowCursor += g.attributes.position.count;
    g.setAttribute("color", new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    return g;
  });
  const glows = new Mesh(
    mergeGeometries(glowParts, false),
    new MeshBasicMaterial({ map: glowTexture, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })
  );
  glowParts.forEach((g) => g.dispose());
  glows.renderOrder = 2;
  group.add(glows);

  /* ---- Steam rising from the mug (one draw call, animated in the shader) ---- */
  const steamUniforms = { uTime: { value: 0 } };
  const steamParts = [-0.07, 0.04, 0.12].map((dx, i) => {
    const g = new PlaneGeometry(0.26, 0.85, 1, 12);
    g.translate(0, 0.425, 0);
    const uv = g.attributes.uv.array.slice();
    g.setAttribute("aUv", new Float32BufferAttribute(uv, 2));
    g.setAttribute("aPhase", new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i * 2.1), 1));
    const at = new Vector3(mug.x + dx, 0.7, mug.z + i * 0.03);
    g.applyMatrix4(new Matrix4().compose(at, new Quaternion().setFromEuler(new Euler(0, Math.atan2(CAM0.x - at.x, CAM0.z - at.z), 0)), new Vector3(1, 1, 1)));
    return g;
  });
  const steamMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false });
  steamMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = steamUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aUv;\nattribute float aPhase;\nuniform float uTime;\nvarying vec2 vSt;\nvarying float vPh;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float rise = aUv.y;
        transformed.x += sin(rise * 4.5 - uTime * 1.2 + aPhase) * 0.07 * rise;
        transformed.z += cos(rise * 3.0 - uTime * 0.9 + aPhase) * 0.04 * rise;
        vSt = aUv;
        vPh = aPhase;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec2 vSt;\nvarying float vPh;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float cx = (vSt.x - 0.5) * 2.0;
        float across = exp(-cx * cx * 3.5);
        float along = smoothstep(0.0, 0.2, vSt.y) * (1.0 - smoothstep(0.35, 1.0, vSt.y));
        float puffs = 0.45 + 0.55 * sin(vSt.y * 8.0 - uTime * 1.6 + vPh);
        diffuseColor.a *= across * along * puffs;`
      );
  };
  steamMaterial.customProgramCacheKey = () => "desk-steam";
  const steam = new Mesh(mergeGeometries(steamParts, false), steamMaterial);
  steamParts.forEach((g) => g.dispose());
  steam.renderOrder = 3;
  group.add(steam);

  /* ---- Blinking caret on the monitor's editor ---- */
  const monPW = mon.w - 0.12;
  const monPH = monPW * (504 / 896);
  const [mrx, mry] = REGION.monitor;
  const [cpx, cpy, cpw, cph] = caretRect;
  const caretLocal = { x: ((cpx + cpw / 2 - mrx) / 896 - 0.5) * monPW, y: (0.5 - (cpy + cph / 2 - mry) / 504) * monPH };
  const caret = new Mesh(
    new PlaneGeometry((cpw / 896) * monPW * 1.4, (cph / 504) * monPH),
    new MeshBasicMaterial({ color: "#9fc3e6", toneMapped: false })
  );
  caret.position.set(...monAt(caretLocal.x, mon.y + mon.h / 2 + 0.03 + caretLocal.y, 0.039));
  caret.rotation.set(0, mon.ry, 0);
  group.add(caret);

  /* ---- Desk edge: a rounded front lip + the top's thickness ---- */
  const edgeMaterial = new MeshStandardMaterial({ roughness: 0.55, metalness: 0, envMapIntensity: 0.4 });
  const nose = new CylinderGeometry(0.06, 0.06, WALL_W, n(16), 1, true);
  nose.rotateZ(Math.PI / 2); // along x; its back half hides under the desk top
  nose.translate(0, -0.06, edgeZ);
  const face = new PlaneGeometry(WALL_W, 0.34);
  face.translate(0, -0.06 - 0.17, edgeZ + 0.06);
  const edge = new Mesh(mergeGeometries([nose.toNonIndexed(), face.toNonIndexed()], false), edgeMaterial);
  nose.dispose();
  face.dispose();
  group.add(edge);

  /* ---- Signs of life (desk view only): lamp flickers on, phone wakes ---- */
  const life = { start: null, lamp: reduced ? 1 : 0, wake: reduced ? 1 : 0, caretOn: true, steamAt: -1 };
  let themeKey = "dark";
  const LAMP_OFF = { bulb: new Color("#4a4540"), shade: new Color("#2a2b30") };
  // Once, ~0.5 s after the scene is revealed: two stutters, then on.
  const flicker = (t) => {
    if (t < 0.45) return 0;
    if (t < 0.52) return 0.9;
    if (t < 0.66) return 0.1;
    if (t < 0.72) return 1;
    if (t < 0.84) return 0.35;
    return 1;
  };

  // Per-theme tint of the unlit details (they don't react to scene lights),
  // including the lamp (flickering on at night) and the phone (waking up).
  const tint = (name) => {
    const p = PALETTE[name];
    const night = name === "dark";
    const lamp = night ? life.lamp : 1;
    const colors = detailsGeometry.attributes.color;
    const paint = (key, color) =>
      ranges[key]?.forEach(([start, count]) => {
        for (let i = start; i < start + count; i += 1) colors.setXYZ(i, color.r, color.g, color.b);
      });
    paint("screen", new Color().setScalar(p.screen * (0.06 + 0.94 * life.wake)));
    paint("monitor", new Color().setScalar(p.monitor));
    paint("notes", new Color().setScalar(p.notes));
    paint("bulb", night ? LAMP_OFF.bulb.clone().lerp(new Color(p.bulb), lamp) : new Color(p.bulb));
    paint("shade", night ? LAMP_OFF.shade.clone().lerp(new Color(p.shadeInner), lamp) : new Color(p.shadeInner));
    colors.needsUpdate = true;

    const gc = glows.geometry.attributes.color;
    const glowPaint = (key, scale) => {
      const [start, count] = glowRanges[key];
      const c = glowSpecs[key].color;
      for (let i = start; i < start + count; i += 1) gc.setXYZ(i, c.r * scale, c.g * scale, c.b * scale);
    };
    glowPaint("bulb", lamp);
    glowPaint("monitor", 1);
    glowPaint("phone", life.wake);
    gc.needsUpdate = true;
    glows.visible = night;
  };

  const caretVisible = (on) => {
    if (caret.visible === on) return false;
    caret.visible = on;
    return true;
  };

  return {
    group,
    /** Paint the theme onto the wall, the desk plane and the details. */
    applyTheme: (name, deskMaterial, deskPlane, sheenMaterial) => {
      const key = PALETTE[name] ? name : "dark";
      themeKey = key;
      wall.material.map = wallFor(key);
      wall.material.needsUpdate = true;
      deskMaterial.map = woodFor(key);
      deskMaterial.lightMap = lightFor(key, deskPlane.size, deskPlane.centerZ);
      deskMaterial.lightMapIntensity = Math.PI; // basic material: lightMap × π⁻¹
      deskMaterial.needsUpdate = true;
      if (sheenMaterial) {
        // Varnish (see introScene): grain bump, masked to the work area.
        sheenMaterial.bumpMap = woodFor(key);
        sheenMaterial.bumpScale = 2;
        sheenMaterial.alphaMap = sheenMask();
        sheenMaterial.roughness = key === "dark" ? 0.36 : 0.42;
        sheenMaterial.envMapIntensity = key === "dark" ? 0.7 : 0.45;
        sheenMaterial.opacity = key === "dark" ? 0.55 : 0.3;
        sheenMaterial.needsUpdate = true;
      }
      edgeMaterial.color.set(PALETTE[key].wood.base).multiplyScalar(key === "dark" ? 0.7 : 0.85);
      shadows.material.opacity = PALETTE[key].shadow;
      steamMaterial.opacity = key === "dark" ? 0.26 : 0.4;
      tint(key);
    },
    /**
     * Small signs of life while the desk is in view (`state.screen` = 0):
     * steam (~24 fps), a blinking caret, the lamp flickering on and the
     * phone waking up once. Returns true when the picture changed.
     */
    tick: (time, state) => {
      let changed = false;
      if (life.start === null) {
        if ((state.reveal ?? 1) < 0.3) return false; // still behind the preloader
        life.start = time;
      }
      const t = time - life.start;
      const onDesk = (state.screen ?? 0) < 0.01;
      const lamp = onDesk && !reduced ? flicker(t) : 1;
      const wake = onDesk && !reduced ? Math.min(1, Math.max(0, Math.round(((t - 2.2) / 0.35) * 20) / 20)) : 1;
      if (lamp !== life.lamp || wake !== life.wake) {
        life.lamp = lamp;
        life.wake = Math.max(life.wake, wake);
        tint(themeKey);
        changed = true;
      }
      if (!onDesk || reduced) return caretVisible(true) || changed;
      if (caretVisible(Math.floor(t / 0.55) % 2 === 0)) changed = true;
      if (time - life.steamAt >= 1 / 24) {
        life.steamAt = time;
        steamUniforms.uTime.value = time;
        changed = true;
      }
      return changed;
    },
    dispose: () => {
      textures.forEach((texture) => texture.dispose());
      [wall, ...props, sleeve, details, shadows, glows, steam, caret, edge].forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      image.onload = null;
    },
  };
}
