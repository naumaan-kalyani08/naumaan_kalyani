import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Box3,
  CircleGeometry,
  ClampToEdgeWrapping,
  TextureLoader,
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
  NormalBlending,
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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import plantUrl from "../assets/models/desk-plant.glb?url";
import walnutUrl from "../assets/wood/walnut.webp";
import walnutNormalUrl from "../assets/wood/walnut-normal.webp";
import m3Url from "../assets/art/bmw-m3-gtr.webp";
import m8Url from "../assets/art/bmw-m8.webp";
import memojiUrl from "../assets/memoji/smile.webp?url";

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
/*
 * Baked lighting (Blender → scripts/bake/bake_desk.py): soft shadows, bounce
 * light, the lamp's pool and the monitor's glow, stored as lightmaps for the
 * desk top (+ mat) and the wall. The regions must match the bake script.
 * Stored value = irradiance / RANGE (sRGB-encoded). Loaded after the scene
 * shows; until then (or if missing) the painted fallbacks are used.
 */
const BAKE = {
  range: 2,
  desk: { x0: -7.5, x1: 7.5, z0: -4.2, z1: 3 },
  wall: { x0: -7.5, x1: 7.5, y0: 0, y1: 6 },
};
const BAKED = import.meta.glob("../assets/bake/*.webp", { eager: true, import: "default" });

// Second UV set (channel 1) mapping a mesh's world position into a bake region.
function bakeUV(mesh, toUV) {
  mesh.updateMatrix();
  const p = mesh.geometry.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const v = new Vector3();
  for (let i = 0; i < p.count; i += 1) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix);
    const [a, b] = toUV(v);
    uv[i * 2] = a;
    uv[i * 2 + 1] = b;
  }
  mesh.geometry.setAttribute("uv1", new Float32BufferAttribute(uv, 2));
}
const deskUV = (v) => [(v.x - BAKE.desk.x0) / (BAKE.desk.x1 - BAKE.desk.x0), (BAKE.desk.z1 - v.z) / (BAKE.desk.z1 - BAKE.desk.z0)];
const wallUV = (v) => [(v.x - BAKE.wall.x0) / (BAKE.wall.x1 - BAKE.wall.x0), (v.y - BAKE.wall.y0) / (BAKE.wall.y1 - BAKE.wall.y0)];

/** Padded leather desk mat under the laptop (and phone/mouse): its top is at MAT_TOP. */
export const MAT_TOP = 0.032;
// r = outer corner radius (concentric with the stitch line in leatherTexture)
const MAT = { x: 0.6, z: 0.375, w: 6.3, d: 3.8, r: 0.17 };
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
    wood: { base: "#4a3122", light: "#6b4a33", grain: "#24160d" }, // same wood as night: only the light changes
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

/* --------------------------------------------------------------- leather */

// Navy leather desk mat: pebbled grain, burnished edges and a tan saddle
// stitch inset from the border. Drawn at the mat's aspect (it maps once over
// the top face; the colour is baked in, the material colour stays white).
const LEATHER = { base: [27, 38, 88], stitch: "rgba(214, 196, 160, 0.9)" };
function leatherTexture(width, height) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const [r, g, b] = LEATHER.base;
  const k = width / 2048; // detail scale
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, width, height);

  // Seeded random → the same grain on every load.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Pebbles: small irregular cells, each a touch lighter or darker.
  const count = Math.round((width * height) / (26 * k * k));
  for (let i = 0; i < count; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const shade = (rand() - 0.5) * 22;
    ctx.fillStyle = `rgb(${r + shade}, ${g + shade}, ${b + shade * 1.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, (1.6 + rand() * 1.6) * k, (1.3 + rand() * 1.4) * k, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Creases between the pebbles: fine dark flecks.
  ctx.fillStyle = "rgba(6, 9, 26, 0.35)";
  for (let i = 0; i < count * 0.6; i += 1) {
    ctx.fillRect(rand() * width, rand() * height, (0.8 + rand()) * k, (0.8 + rand()) * k);
  }

  // Per-pixel noise breaks up the regularity (and any banding).
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    px[i] += n;
    px[i + 1] += n;
    px[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);

  // Soft, broad tonal variation (hide-like), then burnished darker edges.
  for (let i = 0; i < 14; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const rad = (0.15 + rand() * 0.25) * width;
    const blot = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const light = rand() > 0.5;
    blot.addColorStop(0, light ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.06)");
    blot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = blot;
    ctx.fillRect(0, 0, width, height);
  }
  const edge = 46 * k;
  // [gradient from → to, fill rect] for the top, bottom, left, right edges
  [
    [0, 0, 0, edge, 0, 0, width, edge],
    [0, height, 0, height - edge, 0, height - edge, width, edge],
    [0, 0, edge, 0, 0, 0, edge, height],
    [width, 0, width - edge, 0, width - edge, 0, edge, height],
  ].forEach(([gx0, gy0, gx1, gy1, x, y, w, h]) => {
    const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    grad.addColorStop(0, "rgba(0, 0, 0, 0.38)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  });

  // Saddle stitch: the stitching pinches the padding into a soft groove (the
  // pad puffs up either side of it), with the thread running along it.
  const inset = 30 * k;
  const radius = 26 * k;
  ctx.lineCap = "round";
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 9 * k;
  ctx.strokeStyle = "rgba(4, 6, 18, 0.4)";
  ctx.lineWidth = 5 * k;
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
  ctx.stroke();
  ctx.restore();
  // puffed padding: a faint highlight on the inner side of the groove
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 14 * k;
  const puff = inset + 11 * k;
  roundRect(ctx, puff, puff, width - puff * 2, height - puff * 2, Math.max(1, radius - 11 * k));
  ctx.stroke();
  ctx.setLineDash([9 * k, 6 * k]);
  ctx.strokeStyle = LEATHER.stitch;
  ctx.lineWidth = 2.4 * k;
  roundRect(ctx, inset, inset - 0.6 * k, width - inset * 2, height - inset * 2, radius);
  ctx.stroke();
  ctx.setLineDash([]);
  return toTexture(canvas);
}

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
    wash.addColorStop(0, "#0b0d16");
    wash.addColorStop(0.45, "#080a12");
    wash.addColorStop(1, bg);
  } else {
    wash.addColorStop(0, "#1c1a1d");
    wash.addColorStop(0.6, "#211f22");
    wash.addColorStop(1, bg);
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  // (The slat wall in front of it is 3D: see createDeskSetup. This is the
  // dark felt backing that shows between the slats.)

  // Contact shadow where the desk meets the wall.
  const base = ctx.createLinearGradient(0, Y(0), 0, Y(0.7));
  base.addColorStop(0, night ? "rgba(0,0,0,0.55)" : "rgba(80,60,40,0.18)");
  base.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, Y(0.7), width, 0.7 * u);

  // Out of focus: the camera is focused on the laptop.
  softBlur(canvas, 2);

  // (The neon "nk" sign is its own sharp mesh: see neonTexture.)


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

/* ------------------------------------------------------------ neon sign */

// The "nk" neon sign on the wall: its own high-res texture (not part of the
// blurred wall), so the tubes stay crisp. Night: glowing white-violet tubes
// with a halo. Day: the same tubes lit, with a softer coloured glow that
// still reads against the light wall.
const NEON = { x: -5.1, y: 1.95, w: 3.2, h: 1.8 };
// Studio wall: vertical wooden slats on dark felt (design inspired by
// acoustic slat panels), in front of the wall plane.
const SLAT = { w: 0.19, gap: 0.075, d: 0.09, h: 7.5, x0: -9.2, x1: 9.2 };
// A tall window cut into the slats on the left.
const WIN = { x0: -7.75, x1: -5.75, y0: 0.7, y1: 4.8 };

// The view through the window: night city (bokeh) or a soft daytime garden.
function windowView(name) {
  const w = 256;
  const h = 512;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const night = name === "dark";
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  if (night) {
    sky.addColorStop(0, "#070b1d");
    sky.addColorStop(0.6, "#16224d");
    sky.addColorStop(1, "#2a2f5c");
  } else {
    sky.addColorStop(0, "#bcd9f2");
    sky.addColorStop(0.55, "#e7f1f7");
    sky.addColorStop(1, "#cfdcc4");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  let seed = 11;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (night) {
    // distant towers with lit windows, then out-of-focus city lights
    for (let i = 0; i < 9; i += 1) {
      const bw = 24 + r() * 40;
      const bh = 120 + r() * 220;
      const bx = r() * w;
      ctx.fillStyle = "rgba(8,10,24,0.9)";
      ctx.fillRect(bx, h - bh, bw, bh);
      for (let k = 0; k < 18; k += 1) {
        ctx.fillStyle = r() > 0.5 ? "rgba(255,206,140,0.75)" : "rgba(150,180,255,0.45)";
        ctx.fillRect(bx + 3 + r() * (bw - 8), h - bh + 6 + r() * (bh - 12), 3, 4);
      }
    }
    for (let i = 0; i < 40; i += 1) {
      const bx = r() * w;
      const by = h * (0.45 + r() * 0.55);
      const rad = 4 + r() * 16;
      const c = r() < 0.6 ? "255,190,120" : "130,165,255";
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
      g.addColorStop(0, `rgba(${c},0.85)`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
    }
    const moon = ctx.createRadialGradient(w * 0.7, h * 0.14, 0, w * 0.7, h * 0.14, 46);
    moon.addColorStop(0, "rgba(230,236,255,0.95)");
    moon.addColorStop(0.18, "rgba(230,236,255,0.5)");
    moon.addColorStop(1, "rgba(230,236,255,0)");
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, w, h);
  } else {
    for (let i = 0; i < 26; i += 1) {
      const bx = r() * w;
      const by = h * (0.45 + r() * 0.6);
      const rad = 30 + r() * 60;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
      const c = r() < 0.5 ? "96,140,88" : "132,168,110";
      g.addColorStop(0, `rgba(${c},0.8)`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
    }
  }
  return toTexture(canvas);
}

function neonTexture(name, width) {
  const height = Math.round((width * NEON.h) / NEON.w);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const u = width / NEON.w; // px per world unit
  const night = name === "dark";
  const cx = width / 2;
  const cy = height / 2;

  // halo on the wall behind the tubes
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, height * 0.5);
  halo.addColorStop(0, night ? "rgba(99,102,241,0.34)" : "rgba(99,102,241,0.16)");
  halo.addColorStop(1, "rgba(99,102,241,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  ctx.font = `700 ${Math.round(1.1 * u)}px "Space Grotesk", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // outer glow
  ctx.shadowColor = night ? "rgba(129,140,248,1)" : "rgba(99,102,241,0.9)";
  ctx.shadowBlur = u * (night ? 0.35 : 0.22);
  ctx.strokeStyle = night ? "rgba(165,180,252,1)" : "#7c83f5";
  ctx.lineWidth = u * 0.075;
  ctx.strokeText("nk", cx, cy);
  ctx.strokeText("nk", cx, cy); // twice: a denser glow
  // hot white core of the tube
  ctx.shadowBlur = u * 0.08;
  ctx.shadowColor = night ? "rgba(199,210,254,1)" : "rgba(129,140,248,0.8)";
  ctx.strokeStyle = night ? "#f4f5ff" : "#eef0ff";
  ctx.lineWidth = u * 0.032;
  ctx.strokeText("nk", cx, cy);
  ctx.shadowBlur = 0;
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

// Stuffed desk pad: a rounded slab whose edges roll over (a deep, soft bevel),
// lying on y = 0 with its top at `thickness`. UVs are a top-down projection,
// so the leather map lands once over the top and the rolled edges pick up its
// burnished border. The material is unlit (baked light), so the roll is
// shaded with vertex colours: 1 on the flat top, darker as the edge turns
// away from the room's key light.
function paddedMatGeometry(w, d, thickness, radius, curveSegments, bevelSegments) {
  const roll = Math.min(0.045, radius * 0.6); // how far the edge rounds in
  const bevel = thickness * 0.45;
  const geometry = new ExtrudeGeometry(roundedRectShape(w - roll * 2, d - roll * 2, radius - roll), {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: roll,
    bevelSegments,
    curveSegments,
  });
  geometry.rotateX(-Math.PI / 2); // extrusion (+z) → up
  geometry.translate(0, bevel, 0);

  const p = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const colors = new Float32Array(p.count * 3);
  const light = new Vector3(-3, 5, 4).normalize();
  const n = new Vector3();
  for (let i = 0; i < p.count; i += 1) {
    uv[i * 2] = p.getX(i) / w + 0.5;
    uv[i * 2 + 1] = 0.5 - p.getZ(i) / d;
    n.fromBufferAttribute(nrm, i);
    const shade = MathUtils.clamp(n.dot(light) / light.y, 0.42, 1);
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geometry;
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

export function createDeskSetup({ isMobile, reduced = false, renderer, onChange, edgeZ = 3, deskMesh = null }) {
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
  // The wall backing, with the window opening cut out (local coords: the
  // plane is centred at y = WALL_H / 2).
  const wallShape = roundedRectShape(WALL_W, WALL_H, 0.0001);
  const wallHole = new Shape();
  const hy = (y) => y - WALL_H / 2;
  wallHole.moveTo(WIN.x0, hy(WIN.y0));
  wallHole.lineTo(WIN.x0, hy(WIN.y1));
  wallHole.lineTo(WIN.x1, hy(WIN.y1));
  wallHole.lineTo(WIN.x1, hy(WIN.y0));
  wallHole.lineTo(WIN.x0, hy(WIN.y0));
  wallShape.holes.push(wallHole);
  const wallGeo = new ShapeGeometry(wallShape);
  {
    const wp = wallGeo.attributes.position;
    const wuv = wallGeo.attributes.uv;
    for (let i = 0; i < wp.count; i += 1) wuv.setXY(i, wp.getX(i) / WALL_W + 0.5, wp.getY(i) / WALL_H + 0.5);
  }
  const wall = new Mesh(wallGeo, new MeshBasicMaterial({ toneMapped: false }));
  wall.position.set(0, WALL_H / 2, WALL_Z);
  group.add(wall);
  bakeUV(wall, wallUV);
  if (deskMesh) bakeUV(deskMesh, deskUV);

  // Scanned wood textures (cached per url).
  const WOOD = {
    dark: { map: walnutUrl, normal: walnutNormalUrl, tint: "#b98463" },
    light: { map: walnutUrl, normal: walnutNormalUrl, tint: "#b98463" }, // same walnut by day
  };
  const scannedCache = {};
  const scannedTex = (url, color) =>
    (scannedCache[url] ??= new Promise((resolve) => {
      new TextureLoader().load(
        url,
        (texture) => {
          if (color) texture.colorSpace = SRGBColorSpace;
          texture.wrapS = texture.wrapT = RepeatWrapping;
          texture.repeat.set(4, 4); // one veneer sheet ≈ 6 units (≈ 60 cm)
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          resolve(own(texture));
        },
        undefined,
        () => resolve(null)
      );
    }));

  // Baked lightmaps, loaded on demand per theme (cached).
  const bakedCache = {};
  const loader = new TextureLoader();
  const baked = (name) =>
    (bakedCache[name] ??= new Promise((resolve) => {
      const url = BAKED[`../assets/bake/${name}.webp`];
      if (!url) return resolve(null);
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          texture.channel = 1;
          texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
          resolve(own(texture));
        },
        undefined,
        () => resolve(null)
      );
    }));

  // Neon "nk" sign: a sharp plane just off the wall, visible in every
  // viewport (low on the wall, above the laptop) and in both themes.
  const neonCache = {};
  const neonFor = (name) => (neonCache[name] ??= own(neonTexture(name, isMobile ? 512 : 1024)));
  const neon = new Mesh(
    new PlaneGeometry(NEON.w, NEON.h),
    new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
  );
  // high on the wall: phones frame more wall, so it can sit higher there
  // Phones frame the wall's centre (higher): the sign goes above the prints.
  // High on the wall behind the monitor (a whiteboard hangs below the M3).
  const neonAt = isMobile ? new Vector3(-1.75, 3.7, 0) : new Vector3(1.75, 3.3, 0);
  neonAt.z = WALL_Z + SLAT.d + 0.03;
  neon.position.copy(neonAt);
  neon.renderOrder = 1;
  group.add(neon);
  // The tubes are drawn in the brand face: redraw once it has loaded.
  if (document.fonts && !document.fonts.check(`700 20px "Space Grotesk"`)) {
    document.fonts.ready.then(() => {
      Object.keys(neonCache).forEach((name) => {
        textures.delete(neonCache[name]);
        neonCache[name].dispose();
        delete neonCache[name];
      });
      neon.material.map = neonFor(themeKey);
      neon.material.needsUpdate = true;
      onChange?.();
    });
  }

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

  // Desk lamp — graphite arms with brass joints, a lathed shade with a brass
  // rim and a glowing inside (code-made, no download).
  const lampBase = new Vector3(-3.15, 0.1, -2.4);
  const elbow = new Vector3(-3.3, 1.95, -2.85);
  const headAt = new Vector3(-2.4, 2.05, -1.7);
  // matte black + brushed steel, with an architect-lamp head: a deep
  // rounded dome ending in a short cylindrical neck at the back
  const brass = "#c9ccd2";
  metal.push(part(lathe([[0, 0], [0.42, 0], [0.47, 0.025], [0.46, 0.07], [0.39, 0.095], [0.1, 0.11], [0, 0.11]], n(40)), { position: [lampBase.x, 0, lampBase.z], color: graphite }));
  metal.push(rod(lampBase, elbow, 0.032, graphite, n(16)));
  metal.push(rod(elbow, headAt, 0.032, graphite, n(16)));
  // the parallel spring rods typical of an architect lamp
  const side = new Vector3().subVectors(elbow, lampBase).cross(new Vector3(0, 0, 1)).normalize().multiplyScalar(0.07);
  metal.push(rod(lampBase.clone().add(side).setY(0.3), elbow.clone().add(side), 0.012, steel, n(8)));
  metal.push(rod(elbow.clone().add(side), headAt.clone().add(side), 0.012, steel, n(8)));
  metal.push(part(new CylinderGeometry(0.075, 0.075, 0.13, n(18)).rotateX(Math.PI / 2), { position: elbow.toArray(), color: brass }));
  metal.push(part(lathe([[0.07, 0], [0.078, 0.02], [0.078, 0.07], [0.055, 0.09]], n(24)), { position: [lampBase.x, 0.105, lampBase.z], color: brass }));
  metal.push(part(new SphereGeometry(0.055, n(16), n(12)), { position: headAt.toArray(), color: brass }));
  const shadeDir = new Vector3(LAMP_SPOT.x, 0, LAMP_SPOT.z).sub(headAt).normalize();
  const shadeAt = headAt.clone().addScaledVector(shadeDir, 0.3);
  // dome bell: flared lip, rounded shoulder, then a narrow neck (r × y)
  const shadeGeo = lathe([[0.36, 0], [0.355, 0.03], [0.33, 0.12], [0.28, 0.2], [0.2, 0.26], [0.13, 0.285], [0.12, 0.3], [0.12, 0.4], [0.1, 0.42], [0, 0.42]], n(48));
  orient(shadeGeo, shadeAt, new Vector3(0, -1, 0), shadeDir);
  metal.push(part(shadeGeo, { color: graphite }));
  const rim = new TorusGeometry(0.358, 0.01, n(8), n(48));
  rim.rotateX(Math.PI / 2);
  orient(rim, shadeAt, new Vector3(0, -1, 0), shadeDir);
  metal.push(part(rim, { color: brass }));
  const bulbAt = headAt.clone().addScaledVector(shadeDir, 0.2);

  // Plant: a real scanned model (Poly Haven, CC0), loaded once the scene is up.
  const PLANT = { x: -5.35, z: -1.45, ry: 0.6, scale: 1.9 }; // well clear of the mug
  const plant = { x: PLANT.x, z: PLANT.z };

  // Mug — lathed ceramic with a real rim and inside, coffee, handle.
  const mug = { x: -3.55, z: -0.85 }; // left, between the vase and the notebook
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
  const phone = { x: isMobile ? 2.4 : 2.75, z: isMobile ? 0.4 : -0.2, ry: -0.18, w: 0.72, d: 1.48, h: 0.075 };
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
  const mon = { x: 3.5, z: -3.1, ry: -0.36, w: 4.3, h: 2.45, y: 0.62 };
  const monAt = (dx, dy, dz) => {
    const c = Math.cos(mon.ry);
    const s = Math.sin(mon.ry);
    return [mon.x + dx * c + dz * s, dy, mon.z - dx * s + dz * c];
  };
  // Stand (same footprint as the baked shadow): a thin slab base, a slim arm
  // leaning forward from the back of the base (with a cable cutout) up to a
  // hinge + mounting plate on the back of the display housing.
  {
    const turn = [0, mon.ry, 0];
    metal.push(part(new RoundedBoxGeometry(1.55, 0.03, 1.05, 3, 0.014), { position: monAt(0, 0.015, -0.15), rotation: turn, color: steel }));
    const foot = { y: 0.03, z: -0.52 };
    const hinge = { y: 1.36, z: -0.2 };
    const rise = hinge.y - foot.y;
    const lean = Math.atan2(hinge.z - foot.z, rise); // top leans toward the screen
    const arm = new RoundedBoxGeometry(0.4, Math.hypot(rise, hinge.z - foot.z), 0.06, 3, 0.028).rotateX(lean);
    metal.push(part(arm, { position: monAt(0, (foot.y + hinge.y) / 2, (foot.z + hinge.z) / 2), rotation: turn, color: steel }));
    // where the arm meets the base
    metal.push(part(new RoundedBoxGeometry(0.44, 0.05, 0.17, 2, 0.022), { position: monAt(0, 0.045, foot.z), rotation: turn, color: steel }));
    // cable cutout: a dark slot through the arm (pokes out of both faces)
    const t = (0.42 - foot.y) / rise;
    const slot = new RoundedBoxGeometry(0.2, 0.11, 0.066, 2, 0.03).rotateX(lean);
    matte.push(part(slot, { position: monAt(0, 0.42, foot.z + t * (hinge.z - foot.z)), rotation: turn, color: "#202228" }));
    // hinge barrel + the plate that mounts it to the housing (back at z -0.13)
    const barrel = new CylinderGeometry(0.052, 0.052, 0.48, n(18)).rotateZ(Math.PI / 2);
    metal.push(part(barrel, { position: monAt(0, hinge.y, hinge.z + 0.02), rotation: turn, color: "#9da0a8" }));
    metal.push(part(new RoundedBoxGeometry(0.52, 0.34, 0.05, 2, 0.02), { position: monAt(0, hinge.y, -0.15), rotation: turn, color: "#9da0a8" }));
  }
  gloss.push(part(new RoundedBoxGeometry(mon.w, mon.h, 0.07, 3, 0.03), { position: monAt(0, mon.y + mon.h / 2, 0), rotation: [0, mon.ry, 0], color: "#0d0e12" }));
  matte.push(part(new RoundedBoxGeometry(mon.w * 0.62, mon.h * 0.62, 0.12, 2, 0.05), { position: monAt(0, mon.y + mon.h / 2, -0.07), rotation: [0, mon.ry, 0], color: "#1a1b20" }));

  // Navy leather desk mat under the laptop, phone and mouse: unlit like the
  // desk, so it takes the same baked light and shadows.
  const leather = own(leatherTexture(isMobile ? 1024 : 2048, Math.round((isMobile ? 1024 : 2048) * (MAT.d / MAT.w))));
  leather.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() ?? 1);
  const mat = new Mesh(
    paddedMatGeometry(MAT.w, MAT.d, MAT_TOP, MAT.r, n(12), isMobile ? 4 : 8),
    new MeshBasicMaterial({ map: leather, vertexColors: true, toneMapped: false })
  );
  mat.position.set(MAT.x, 0, MAT.z);
  group.add(mat);
  bakeUV(mat, deskUV);

  // Magic Mouse (right of the keyboard): a flattened glossy shell.
  // right of the keyboard, on the desk itself (off the mat), turned with the keyboard
  const mouse = { x: 4.2, z: -1.84, ry: -0.3 };
  // Magic Mouse: a low, gently domed white shell (flatter at the front) on a
  // thin aluminium base that shows as a silver line all around.
  // Footprint is a squircle (|x|³+|z|³=1) 0.3 × 0.58; the top is a low arch
  // that peaks just behind the middle and falls off softly at the edges.
  const MOUSE = { w: 0.3, l: 0.58, h: 0.075, base: 0.02 };
  const squircle = (t) => Math.pow(Math.abs(Math.cos(t)) ** 3 + Math.abs(Math.sin(t)) ** 3, -1 / 3);
  const mouseGeo = new SphereGeometry(1, n(48), n(16), 0, Math.PI * 2, 0, Math.PI / 2);
  {
    const mp = mouseGeo.attributes.position;
    for (let i = 0; i < mp.count; i += 1) {
      const x = mp.getX(i);
      const z = mp.getZ(i);
      const r = Math.min(1, Math.hypot(x, z));
      const k = squircle(Math.atan2(z, x));
      const zz = z * k; // -1 (front, toward the monitor) … 1 (palm end)
      const arch = Math.max(0.35, 1 - 0.55 * (zz - 0.15) ** 2);
      mp.setXYZ(i, x * k * (MOUSE.w / 2), MOUSE.h * arch * Math.pow(Math.max(0, 1 - r ** 2.4), 0.5), zz * (MOUSE.l / 2));
    }
    mouseGeo.computeVertexNormals();
  }
  gloss.push(part(mouseGeo, { position: [mouse.x, MOUSE.base, mouse.z], rotation: [0, mouse.ry, 0], color: "#f7f6f2" }));
  const footprint = new Shape();
  for (let i = 0; i <= 64; i += 1) {
    const t = (i / 64) * Math.PI * 2;
    const k = squircle(t) * 0.985;
    footprint[i ? "lineTo" : "moveTo"](Math.cos(t) * k * (MOUSE.w / 2), Math.sin(t) * k * (MOUSE.l / 2));
  }
  const baseGeo = new ExtrudeGeometry(footprint, { depth: MOUSE.base, bevelEnabled: false, curveSegments: 1 });
  baseGeo.rotateX(Math.PI / 2).translate(0, MOUSE.base, 0);
  metal.push(part(baseGeo, { position: [mouse.x, 0, mouse.z], rotation: [0, mouse.ry, 0], color: "#c8cacf" }));

  // Wireless keyboard in front of the monitor: aluminium base + white keys.
  const kb = { x: 2.55, z: -2.35, ry: -0.3 }; // fully behind the desk mat (its back edge is z -1.525)
  const kbAt = (dx, dy, dz) => {
    const c = Math.cos(kb.ry);
    const s = Math.sin(kb.ry);
    return [kb.x + dx * c + dz * s, dy, kb.z - dx * s + dz * c];
  };
  // Magic Keyboard style: a wedge of aluminium (thin at the front, rising to
  // the back) with low-profile rounded keycaps following its slope: a
  // half-height function row with Touch ID, inverted-T arrows. Same footprint
  // as the baked contact shadow.
  const KB = { w: 2.25, d: 0.86, front: 0.03, back: 0.058 };
  const slope = (KB.back - KB.front) / KB.d;
  const tilt = Math.atan(slope);
  const topAt = (z) => KB.front + (KB.back - KB.front) * (0.5 - z / KB.d); // local z: back = -d/2
  {
    const base = new RoundedBoxGeometry(KB.w, KB.front, KB.d, 3, 0.012);
    base.translate(0, KB.front / 2, 0);
    const p = base.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      if (p.getY(i) > KB.front / 2) p.setY(i, p.getY(i) + topAt(p.getZ(i)) - KB.front);
    }
    base.computeVertexNormals();
    metal.push(part(base, { position: kbAt(0, 0, 0), rotation: [0, kb.ry, 0], color: steel }));
  }
  // Layout in key units (u): rows of [width…], "ud" = stacked ▲/▼.
  const KB_ROWS = [
    { h: 0.5, keys: [1.5, ...Array(12).fill(1), 1.5], labels: ["esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "tid"] },
    { h: 1, keys: [...Array(13).fill(1), 2], labels: ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "delete"] },
    { h: 1, keys: [1.5, ...Array(12).fill(1), 1.5], labels: ["tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\"] },
    { h: 1, keys: [1.75, ...Array(11).fill(1), 2.25], labels: ["caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "return"] },
    { h: 1, keys: [2.25, ...Array(10).fill(1), 2.75], labels: ["shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "shift"] },
    { h: 1, keys: [1, 1, 1, 1.25, 5.5, 1.25, 1, 1, "ud", 1], labels: ["fn", "⌃", "⌥", "⌘", "", "⌘", "⌥", "◀", "▲", "▼", "▶"] },
  ];
  const P = (KB.w - 0.1) / 15; // key pitch (world units)
  const PX = 64; // legend atlas px per key unit: the atlas is the keyboard's plan view
  const ATLAS = { w: 1024, h: 384 };
  const keyRects = []; // [x, z, w, d] in key units, + label
  {
    let zu = 0;
    KB_ROWS.forEach(({ h, keys, labels }) => {
      let xu = 0;
      let li = 0;
      keys.forEach((units) => {
        if (units === "ud") {
          keyRects.push([xu, zu, 1, h / 2, labels[li++]], [xu, zu + h / 2, 1, h / 2, labels[li++]]);
          xu += 1;
          return;
        }
        keyRects.push([xu, zu, units, h, labels[li++]]);
        xu += units;
      });
      zu += h;
    });
  }
  const legendCanvas = makeCanvas(ATLAS.w, ATLAS.h);
  {
    const lc = legendCanvas.getContext("2d");
    lc.fillStyle = "#f6f6f4";
    lc.fillRect(0, 0, ATLAS.w, ATLAS.h);
    lc.fillStyle = "#2b2d33";
    lc.strokeStyle = "#8d9099";
    lc.textBaseline = "middle";
    keyRects.forEach(([x, z, w, d, label]) => {
      const cx = (x + w / 2) * PX;
      const cy = (z + d / 2) * PX;
      if (label === "tid") {
        // Touch ID: a fine ring
        lc.lineWidth = 2;
        lc.beginPath();
        lc.arc(cx, cy, d * PX * 0.3, 0, Math.PI * 2);
        lc.stroke();
        return;
      }
      if (!label) return;
      const single = label.length === 1;
      const size = d < 1 ? 13 : single ? 26 : 14;
      lc.font = `600 ${size}px ${FONT_UI}`;
      // letters centred; modifier words bottom-left, like Apple's keycaps
      lc.textAlign = single || d < 1 ? "center" : "left";
      lc.fillText(label, single || d < 1 ? cx : x * PX + 9, single || d < 1 ? cy + 1 : (z + d) * PX - 14);
    });
  }
  const legendTexture = own(toTexture(legendCanvas));
  legendTexture.anisotropy = anisotropy;
  const keyParts = [];
  const blank = [1000 / ATLAS.w, 1 - 375 / ATLAS.h]; // a plain keycap pixel
  const originX = -7.5 * P;
  const originZ = -KB.d / 2 + 0.035;
  const KEY_H = 0.02;
  keyRects.forEach(([xu, zu, wu, du]) => {
    const gap = du < 1 ? 0.016 : 0.024;
    const g = new RoundedBoxGeometry(wu * P - 0.024, KEY_H, du * P - gap, 2, 0.007);
    // Top-facing vertices sample the plan-view atlas; sides are plain.
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k += 1) {
      if (nrm.getY(k) > 0.7) {
        uv.setXY(k, ((xu + wu / 2) * PX + (pos.getX(k) / P) * PX) / ATLAS.w, 1 - ((zu + du / 2) * PX + (pos.getZ(k) / P) * PX) / ATLAS.h);
      } else uv.setXY(k, blank[0], blank[1]);
    }
    g.rotateX(tilt); // follow the wedge's slope
    const cx = originX + (xu + wu / 2) * P;
    const cz = originZ + (zu + du / 2) * P;
    keyParts.push(part(g, { position: kbAt(cx, topAt(cz) + KEY_H / 2 - 0.004, cz), rotation: [0, kb.ry, 0] }));
  });
  const keys = new Mesh(mergeGeometries(keyParts, false), new MeshStandardMaterial({ map: legendTexture, roughness: 0.45, metalness: 0, envMapIntensity: 0.6 }));
  keyParts.forEach((g) => g.dispose());
  group.add(keys);

  // USB-C cable: plugged into the laptop's right side → behind the keyboard →
  // behind the monitor stand → up into a port on the back of the display.
  // USB-C plug: a white strain-relief boot with a metal collar where it meets
  // the port, built along +x and turned to `dir`.
  const CABLE = "#e9e9e6";
  const plug = (port, dir) => {
    const d = dir.clone().normalize();
    const along = (k) => port.clone().addScaledVector(d, k);
    const turn = (geometry, at) => orient(geometry, at, new Vector3(1, 0, 0), d);
    metal.push(part(turn(new RoundedBoxGeometry(0.03, 0.036, 0.07, 1, 0.012), along(0.015)), { color: "#c9ccd2" }));
    matte.push(part(turn(new RoundedBoxGeometry(0.15, 0.05, 0.088, 2, 0.022), along(0.105)), { color: CABLE }));
    matte.push(part(turn(new CylinderGeometry(0.026, 0.02, 0.06, n(10)).rotateZ(Math.PI / 2), along(0.205)), { color: CABLE }));
    return along(0.23); // where the cable leaves the boot
  };
  // Laptop: right side (x ≈ 1.573 world), mid-height of the aluminium shell.
  // The port sits toward the back of the side so the cable can turn behind
  // the mouse (body ≈ x 1.83 → 2.13, z -1.06 → -0.5) instead of through it.
  const laptopOut = plug(new Vector3(1.574, MAT_TOP + 0.06, -0.97), new Vector3(1, 0, 0));
  const R = 0.018; // cable radius: resting heights are surface + R
  const matBack = MAT.z - MAT.d / 2;
  // Monitor: a down-facing port on the display's bottom edge, left of the
  // stand (base spans local x ±0.775), so the plug is in view from the front.
  const monitorOut = plug(new Vector3(...monAt(-0.95, mon.y, -0.012)), new Vector3(0, -1, 0));
  const cablePath = new CatmullRomCurve3(
    [
      laptopOut,
      [1.83, MAT_TOP + 0.036, -1.03],
      [1.84, MAT_TOP + R, -1.24],
      // over the pad's rolled back edge, down onto the desk
      [1.7, MAT_TOP + R - 0.004, matBack + 0.06],
      [1.5, R + 0.004, matBack - 0.1],
      // round the keyboard's front-left corner (≈ x 1.35, z -2.27), between
      // its back-left corner (≈ 1.6, -3.09) and the speaker (≈ 1.25, -3.12)
      [1.22, R, -1.8],
      [1.08, R, -2.35],
      [1.42, R, -3.12],
      [1.9, R, -3.35],
      monAt(-1.2, 0.018, -0.1),
      monAt(-1.0, 0.07, -0.04),
      monAt(-0.955, 0.24, -0.015),
      monitorOut,
    ].map((p) => (p.isVector3 ? p : new Vector3(...p)))
  );
  matte.push(part(new TubeGeometry(cablePath, n(110), 0.018, n(6), false), { color: CABLE }));

  /* ---- Framed car prints on the slats ---- */
  const frontZ = WALL_Z + SLAT.d;
  // M3 GTR high in the centre (the neon sits below it), the white M8 on its left.
  const ART = [
    { url: m3Url, x: -0.75, y: isMobile ? 2.4 : 2.85, w: isMobile ? 2.1 : 1.9, ratio: 719 / 1280 }, // BMW M3 GTR
    { url: m8Url, x: -2.95, y: isMobile ? 2.5 : 2.55, w: 0.85, ratio: 1137 / 640 }, // BMW M8
  ];
  const FRAME = { pad: 0.022, rim: 0.055, depth: 0.09 };
  const frameShadowParts = [];
  const glassParts = [];
  const artMeshes = ART.map((a) => {
    const h = a.w * a.ratio;
    const iw = a.w + 2 * FRAME.pad; // inside of the moulding
    const ih = h + 2 * FRAME.pad;
    const ow = iw + 2 * FRAME.rim;
    const oh = ih + 2 * FRAME.rim;
    // moulding: a deep black ring (the print sits recessed inside it)
    const ring = roundedRectShape(ow, oh, 0.012);
    const hole = new Shape();
    hole.moveTo(-iw / 2, -ih / 2);
    hole.lineTo(-iw / 2, ih / 2);
    hole.lineTo(iw / 2, ih / 2);
    hole.lineTo(iw / 2, -ih / 2);
    hole.lineTo(-iw / 2, -ih / 2);
    ring.holes.push(hole);
    const moulding = new ExtrudeGeometry(ring, { depth: FRAME.depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 });
    matte.push(part(moulding, { position: [a.x, a.y, frontZ], color: "#0e0f11" }));
    // thin white mat, recessed
    matte.push(part(new BoxGeometry(iw, ih, 0.01), { position: [a.x, a.y, frontZ + FRAME.depth * 0.55], color: "#f3f1ec" }));
    const mesh = new Mesh(new PlaneGeometry(a.w, h), new MeshBasicMaterial({ toneMapped: false, color: 0x222222 }));
    mesh.position.set(a.x, a.y, frontZ + FRAME.depth * 0.55 + 0.006);
    mesh.userData.tint = true;
    // soft drop shadow on the slats (light from above-left)
    frameShadowParts.push(part(new PlaneGeometry(ow + 0.5, oh + 0.5), { position: [a.x + 0.07, a.y - 0.12, frontZ + 0.002] }));
    // glass: a faint diagonal reflection over the print
    glassParts.push(part(new PlaneGeometry(iw, ih), { position: [a.x, a.y, frontZ + FRAME.depth - 0.004] }));
    group.add(mesh);
    new TextureLoader().load(a.url, (texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = anisotropy;
      mesh.material.map = own(texture);
      mesh.material.color.setScalar(themeKey === "dark" ? 0.82 : 0.97);
      mesh.material.needsUpdate = true;
      onChange?.();
    });
    return mesh;
  });
  {
    const sc = makeCanvas(128, 128);
    const c = sc.getContext("2d");
    c.fillStyle = "#000";
    c.fillRect(30, 30, 68, 68);
    softBlur(sc, 4);
    const frameShadows = new Mesh(
      mergeGeometries(frameShadowParts, false),
      new MeshBasicMaterial({ color: 0x000000, map: own(toTexture(sc)), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false })
    );
    frameShadows.renderOrder = 1;
    group.add(frameShadows);
    const gc = makeCanvas(128, 128);
    const g2 = gc.getContext("2d");
    const sheen = g2.createLinearGradient(0, 0, 128, 128);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.42, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.55)");
    sheen.addColorStop(0.62, "rgba(255,255,255,0)");
    sheen.addColorStop(0.75, "rgba(255,255,255,0.2)");
    sheen.addColorStop(0.8, "rgba(255,255,255,0)");
    g2.fillStyle = sheen;
    g2.fillRect(0, 0, 128, 128);
    const frameGlass = new Mesh(
      mergeGeometries(glassParts, false),
      new MeshBasicMaterial({ map: own(toTexture(gc)), transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    frameGlass.renderOrder = 2;
    group.add(frameGlass);
    artMeshes.push(frameShadows, frameGlass);
  }

  /* ---- Whiteboard under the M3 GTR print: a to-do list + a thought ---- */
  const board = { x: -0.75, y: isMobile ? 1.15 : 1.6, w: 2.0, h: 0.98 };
  const boardCanvas = makeCanvas(1024, 512);
  {
    const b = boardCanvas.getContext("2d");
    b.fillStyle = "#fbfbf8";
    b.fillRect(0, 0, 1024, 512);
    // faint marker ghosting, like a used board
    b.fillStyle = "rgba(120,130,150,0.05)";
    for (let i = 0; i < 6; i += 1) b.fillRect(80 + i * 140, 120 + (i % 3) * 90, 160, 26);
    b.lineCap = "round";
    b.lineJoin = "round";
    b.textBaseline = "middle";
    b.fillStyle = "#1f4fd6";
    b.font = `700 54px ${FONT_HAND}`;
    b.fillText("TO-DO", 48, 66);
    b.strokeStyle = "#1f4fd6";
    b.lineWidth = 5;
    b.beginPath();
    b.moveTo(48, 100);
    b.quadraticCurveTo(140, 92, 232, 102);
    b.stroke();
    const items = [
      [true, "Reply to emails"],
      [true, "Ship portfolio v2"],
      [false, "Polish the 3D desk"],
      [false, "Learn WebGL shaders"],
    ];
    b.font = `600 36px ${FONT_HAND}`;
    items.forEach(([done, text], i) => {
      const y = 160 + i * 74;
      b.strokeStyle = "#22252c";
      b.lineWidth = 4;
      b.strokeRect(52, y - 18, 34, 34);
      if (done) {
        b.strokeStyle = "#16a34a";
        b.lineWidth = 6;
        b.beginPath();
        b.moveTo(56, y);
        b.lineTo(68, y + 14);
        b.lineTo(94, y - 22);
        b.stroke();
      }
      b.fillStyle = "#22252c";
      b.fillText(text, 108, y + 2);
      if (done) {
        b.strokeStyle = "#22252c";
        b.lineWidth = 3;
        b.beginPath();
        b.moveTo(104, y + 2);
        b.lineTo(104 + b.measureText(text).width, y);
        b.stroke();
      }
    });
    // the thought, in red, on the right
    b.save();
    b.translate(760, 250);
    b.rotate(-0.06);
    b.fillStyle = "#d9342b";
    b.textAlign = "center";
    b.font = `700 44px ${FONT_HAND}`;
    ["Done is", "better than", "perfect."].forEach((line, i) => b.fillText(line, 0, -70 + i * 58));
    b.strokeStyle = "#d9342b";
    b.lineWidth = 4;
    b.beginPath();
    b.ellipse(0, -12, 190, 130, 0, 0, Math.PI * 2);
    b.stroke();
    b.restore();
  }
  const boardTexture = own(toTexture(boardCanvas));
  boardTexture.anisotropy = anisotropy;
  const boardFace = new Mesh(new PlaneGeometry(board.w, board.h), new MeshBasicMaterial({ map: boardTexture, toneMapped: false }));
  boardFace.position.set(board.x, board.y, frontZ + 0.035);
  boardFace.userData.tint = true;
  group.add(boardFace);
  artMeshes.push(boardFace);
  // aluminium frame + marker tray
  const bf = 0.045;
  metal.push(part(new BoxGeometry(board.w + 2 * bf, bf, 0.05), { position: [board.x, board.y + board.h / 2 + bf / 2, frontZ + 0.025], color: "#c9ccd2" }));
  metal.push(part(new BoxGeometry(board.w + 2 * bf, bf, 0.05), { position: [board.x, board.y - board.h / 2 - bf / 2, frontZ + 0.025], color: "#c9ccd2" }));
  metal.push(part(new BoxGeometry(bf, board.h, 0.05), { position: [board.x - board.w / 2 - bf / 2, board.y, frontZ + 0.025], color: "#c9ccd2" }));
  metal.push(part(new BoxGeometry(bf, board.h, 0.05), { position: [board.x + board.w / 2 + bf / 2, board.y, frontZ + 0.025], color: "#c9ccd2" }));
  metal.push(part(new BoxGeometry(board.w * 0.5, 0.025, 0.12), { position: [board.x + 0.3, board.y - board.h / 2 - bf - 0.0125, frontZ + 0.06], color: "#b4b7bd" }));
  [["#1f4fd6", 0.15], ["#d9342b", 0.42]].forEach(([color, dx]) => {
    const marker = new CylinderGeometry(0.022, 0.022, 0.28, n(10));
    marker.rotateZ(Math.PI / 2);
    gloss.push(part(marker, { position: [board.x + dx, board.y - board.h / 2 - bf + 0.012, frontZ + 0.07], color }));
  });

  /* ---- The window (left): frame, mullions, sill, the view ---- */
  const winW = WIN.x1 - WIN.x0;
  const winH = WIN.y1 - WIN.y0;
  const winCx = (WIN.x0 + WIN.x1) / 2;
  const winCy = (WIN.y0 + WIN.y1) / 2;
  // A recessed opening: the glass sits ~0.45 deep in the wall, with lit
  // reveals (jambs, head, sill) around it, a deep black steel frame with
  // mullions, a protruding sill, glass reflections and a sheer curtain.
  const REVEAL = 0.45;
  const glassZ = WALL_Z - REVEAL;
  const revealMat = "#d9d5cc";
  matte.push(part(new BoxGeometry(0.04, winH, REVEAL), { position: [WIN.x0, winCy, WALL_Z - REVEAL / 2], color: revealMat })); // left reveal
  matte.push(part(new BoxGeometry(0.04, winH, REVEAL), { position: [WIN.x1, winCy, WALL_Z - REVEAL / 2], color: revealMat })); // right reveal
  matte.push(part(new BoxGeometry(winW, 0.04, REVEAL), { position: [winCx, WIN.y1, WALL_Z - REVEAL / 2], color: revealMat })); // head
  matte.push(part(new BoxGeometry(winW, 0.04, REVEAL), { position: [winCx, WIN.y0, WALL_Z - REVEAL / 2], color: "#cfc9bd" })); // inner sill
  const winBar = (w, h, x, y, depth = 0.07) => matte.push(part(new BoxGeometry(w, h, depth), { position: [x, y, glassZ + depth / 2], color: "#111214" }));
  winBar(winW, 0.09, winCx, WIN.y1 - 0.045); // frame
  winBar(winW, 0.09, winCx, WIN.y0 + 0.045);
  winBar(0.09, winH, WIN.x0 + 0.045, winCy);
  winBar(0.09, winH, WIN.x1 - 0.045, winCy);
  winBar(0.045, winH, winCx, winCy, 0.06); // mullion
  winBar(winW, 0.045, winCx, WIN.y0 + winH * 0.64, 0.06); // transom
  // casing around the opening, on the slat face
  const caseZ = WALL_Z + SLAT.d;
  matte.push(part(new BoxGeometry(winW + 0.3, 0.12, 0.05), { position: [winCx, WIN.y1 + 0.06, caseZ], color: "#141518" }));
  matte.push(part(new BoxGeometry(0.12, winH + 0.24, 0.05), { position: [WIN.x0 - 0.06, winCy, caseZ], color: "#141518" }));
  matte.push(part(new BoxGeometry(0.12, winH + 0.24, 0.05), { position: [WIN.x1 + 0.06, winCy, caseZ], color: "#141518" }));
  // the room-side sill (walnut), protruding
  matte.push(part(new RoundedBoxGeometry(winW + 0.45, 0.07, 0.42, 2, 0.02), { position: [winCx, WIN.y0 - 0.02, WALL_Z + 0.12], color: "#3a2a1e" }));
  const view = new Mesh(new PlaneGeometry(winW, winH), new MeshBasicMaterial({ toneMapped: false }));
  view.position.set(winCx, winCy, glassZ - 0.02);
  group.add(view);
  // reflections on the glass (two soft diagonal streaks)
  {
    const rc = makeCanvas(128, 256);
    const rx = rc.getContext("2d");
    const streak = rx.createLinearGradient(0, 0, 128, 256);
    streak.addColorStop(0.2, "rgba(255,255,255,0)");
    streak.addColorStop(0.32, "rgba(255,255,255,0.5)");
    streak.addColorStop(0.4, "rgba(255,255,255,0)");
    streak.addColorStop(0.55, "rgba(255,255,255,0)");
    streak.addColorStop(0.6, "rgba(255,255,255,0.25)");
    streak.addColorStop(0.66, "rgba(255,255,255,0)");
    rx.fillStyle = streak;
    rx.fillRect(0, 0, 128, 256);
    const glass = new Mesh(
      new PlaneGeometry(winW, winH),
      new MeshBasicMaterial({ map: own(toTexture(rc)), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    glass.position.set(winCx, winCy, glassZ + 0.075);
    glass.renderOrder = 2;
    group.add(glass);
    artMeshes.push(glass);
  }
  // sheer linen curtain gathered on the left, gently folded
  {
    const cw = 0.75;
    const ch = WIN.y1 - WIN.y0 + 0.9;
    const g = new PlaneGeometry(cw, ch, 24, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 1) pos.setZ(i, Math.sin((pos.getX(i) / cw) * Math.PI * 7) * 0.05);
    g.computeVertexNormals();
    const curtain = new Mesh(g, new MeshStandardMaterial({ color: "#efe9df", roughness: 0.95, transparent: true, opacity: 0.82, side: 2, envMapIntensity: 0.4 }));
    curtain.position.set(WIN.x0 + 0.2, (WIN.y0 + WIN.y1) / 2 + 0.25, WALL_Z + 0.2);
    group.add(curtain);
    artMeshes.push(curtain);
  }
  const viewCache = {};
  const viewFor = (name) => (viewCache[name] ??= own(windowView(name)));

  // Beside the plant: a small stack of design books.
  const stack = { x: -4.6, z: 0.55, ry: 0.3 }; // beside the notebook
  const stackAt = (dx, dy, dz) => {
    const c = Math.cos(stack.ry);
    const sn = Math.sin(stack.ry);
    return [stack.x + dx * c + dz * sn, dy, stack.z - dx * sn + dz * c];
  };
  [
    { w: 1.35, d: 1.0, t: 0.13, cover: "#2f3b3b", rot: 0, dx: 0, dz: 0 },
    { w: 1.2, d: 0.9, t: 0.11, cover: "#c8653b", rot: -0.12, dx: 0.04, dz: 0.03 },
    { w: 1.05, d: 0.78, t: 0.1, cover: "#e9e3d6", rot: 0.1, dx: -0.03, dz: -0.02 },
  ].reduce((y, b) => {
    const r = stack.ry + b.rot;
    matte.push(part(new RoundedBoxGeometry(b.w - 0.03, b.t - 0.02, b.d - 0.04, 1, 0.004), { position: stackAt(b.dx + 0.01, y + b.t / 2, b.dz), rotation: [0, r, 0], color: "#f3eee2" })); // pages
    matte.push(part(new RoundedBoxGeometry(b.w, 0.014, b.d, 1, 0.005), { position: stackAt(b.dx, y + 0.007, b.dz), rotation: [0, r, 0], color: b.cover }));
    matte.push(part(new RoundedBoxGeometry(b.w, 0.014, b.d, 1, 0.005), { position: stackAt(b.dx, y + b.t - 0.007, b.dz), rotation: [0, r, 0], color: b.cover }));
    matte.push(part(new RoundedBoxGeometry(0.03, b.t, b.d, 1, 0.008), { position: stackAt(b.dx - b.w / 2 + 0.015, y + b.t / 2, b.dz), rotation: [0, r, 0], color: b.cover })); // spine
    return y + b.t;
  }, 0);

  // Bookshelf speaker between the laptop and the monitor.
  const spk = { x: 1.05, z: -3.45, ry: -0.25, w: 0.55, h: 0.85, d: 0.55 };
  matte.push(part(new RoundedBoxGeometry(spk.w, spk.h, spk.d, 2, 0.04), { position: [spk.x, spk.h / 2 + 0.06, spk.z], rotation: [0, spk.ry, 0], color: "#16171a" }));
  matte.push(part(new CylinderGeometry(0.2, 0.22, 0.06, n(20)), { position: [spk.x, 0.03, spk.z], color: "#2a2b2f" })); // isolation pad
  const spkFront = (dy, r, color, depth) => {
    const g = new CylinderGeometry(r, r, depth, n(28));
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, spk.d / 2);
    return part(g, { position: [spk.x, spk.h / 2 + 0.06 + dy, spk.z], rotation: [0, spk.ry, 0], color });
  };
  gloss.push(spkFront(-0.12, 0.17, "#2e3036", 0.02)); // woofer
  metal.push(spkFront(-0.12, 0.05, "#9a9ca3", 0.03)); // dust cap
  gloss.push(spkFront(0.24, 0.06, "#3a3c42", 0.02)); // tweeter

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

  /* ---- Slat wall (one draw call) ---- */
  const slatParts = [];
  let slatIndex = 0;
  for (let x = SLAT.x0; x <= SLAT.x1; x += SLAT.w + SLAT.gap, slatIndex += 1) {
    if (x + SLAT.w / 2 > WIN.x0 - 0.12 && x - SLAT.w / 2 < WIN.x1 + 0.12) continue; // the window
    const g = new BoxGeometry(SLAT.w, SLAT.h, SLAT.d, 1, isMobile ? 10 : 18, 1);
    // Grain runs along the slat; each slat starts at another spot of the veneer.
    const uv = g.attributes.uv;
    const off = (slatIndex * 0.137) % 1;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getY(i) * 0.4 + off * 3, off + uv.getX(i) * 0.06);
    g.translate(x, SLAT.h / 2, WALL_Z + SLAT.d / 2);
    slatParts.push(g);
  }
  const slatGeo = mergeGeometries(slatParts, false);
  slatParts.forEach((g) => g.dispose());
  slatGeo.setAttribute("color", new Float32BufferAttribute(new Float32Array(slatGeo.attributes.position.count * 3), 3));
  const slats = new Mesh(slatGeo, new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  group.add(slats);
  // Light on the slats, computed once per theme into the vertex colours:
  // a dim room, plus the neon, the lamp and the monitor glowing on them.
  const monCenter = new Vector3(...monAt(0, mon.y + mon.h / 2, 0));
  const lightSlats = (key) => {
    const night = key === "dark";
    const lamps = night
      ? [
          { at: neonAt, color: new Color("#7c74ff"), k: 1.5, r: 2.8 },
          { at: bulbAt, color: new Color("#ffb36b"), k: 1.25, r: 3.4 },
          { at: monCenter, color: new Color("#4d6bff"), k: 0.8, r: 3.8 },
          { at: new Vector3(winCx, 2.6, WALL_Z + 0.4), color: new Color("#6f86ff"), k: 0.5, r: 3.6 },
        ]
      : [
          { at: new Vector3(-9, 5, 2), color: new Color("#fff3e2"), k: 0.35, r: 16 },
          { at: new Vector3(winCx, 2.6, WALL_Z + 0.4), color: new Color("#fff6ea"), k: 0.55, r: 5 },
        ];
    const pos = slatGeo.attributes.position;
    const nor = slatGeo.attributes.normal;
    const col = slatGeo.attributes.color;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const front = nor.getZ(i) > 0.5;
      const fall = Math.min(1, v.y / (night ? 6 : 9));
      let amb = night ? 0.2 * (1.2 - fall * 0.75) : 0.82 * (1.06 - fall * 0.3);
      if (!front) amb *= 0.55; // slat sides sit in shadow
      let r = amb;
      let g = amb;
      let b = amb;
      for (const L of lamps) {
        const f = L.k * Math.max(0, 1 - v.distanceTo(L.at) / L.r) ** 2 * (front ? 1 : 0.6);
        r += L.color.r * f;
        g += L.color.g * f;
        b += L.color.b * f;
      }
      const foot = 0.55 + 0.45 * Math.min(1, v.y / 0.7); // darker where it meets the desk
      col.setXYZ(i, r * foot, g * foot, b * foot);
    }
    col.needsUpdate = true;
  };

  /* ---- Live wall clock (hands follow the visitor's real time) ---- */
  const clock = new Group();
  const clockR = isMobile ? 0.34 : 0.36;
  clock.position.set(isMobile ? 0.78 : 0.85, isMobile ? 1.35 : 2.55, WALL_Z + SLAT.d + 0.03);
  const faceCanvas = makeCanvas(256, 256);
  {
    const c = faceCanvas.getContext("2d");
    c.fillStyle = "#f4f2ec";
    c.beginPath();
    c.arc(128, 128, 128, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#1b1c20";
    for (let i = 0; i < 60; i += 1) {
      const a = (i / 60) * Math.PI * 2;
      const big = i % 5 === 0;
      c.save();
      c.translate(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
      c.rotate(a);
      c.fillRect(big ? -3 : -1, -6, big ? 6 : 2, big ? 18 : 9);
      c.restore();
    }
    c.font = `700 22px "Space Grotesk", ${FONT_UI}`;
    c.textAlign = "center";
    c.fillText("nk", 128, 182);
  }
  const clockFace = new Mesh(new CircleGeometry(clockR, n(48)), new MeshBasicMaterial({ map: own(toTexture(faceCanvas)), toneMapped: false }));
  const clockRim = new Mesh(new TorusGeometry(clockR, 0.035, n(10), n(48)), new MeshStandardMaterial({ color: "#121316", roughness: 0.35, metalness: 0.6 }));
  clockRim.position.z = 0.012;
  const hand = (len, width, color, z) => {
    const g = new BoxGeometry(width, len, 0.008);
    g.translate(0, len / 2 - len * 0.16, z);
    return new Mesh(g, new MeshBasicMaterial({ color, toneMapped: false }));
  };
  const hourHand = hand(clockR * 0.55, 0.035, "#141518", 0.01);
  const minuteHand = hand(clockR * 0.82, 0.024, "#141518", 0.016);
  const secondHand = hand(clockR * 0.9, 0.008, "#e0352b", 0.022);
  clock.add(clockFace, clockRim, hourHand, minuteHand, secondHand);
  group.add(clock);
  let lastSecond = -1;
  let lastMinute = -1;
  // Quartz sweep: the second hand glides (fractional seconds). With reduced
  // motion it ticks once a second instead.
  const setClock = (now) => {
    const sec = now.getSeconds() + (reduced ? 0 : now.getMilliseconds() / 1000);
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;
    secondHand.rotation.z = -(sec / 60) * Math.PI * 2;
    minuteHand.rotation.z = -(min / 60) * Math.PI * 2;
    hourHand.rotation.z = -(hr / 12) * Math.PI * 2;
  };
  setClock(new Date());

  /* ---- Scanned models (lamp, plant): lit like the props ---- */
  const models = [];
  let lampLight = null; // the bulb's material: glows at night (flickers on)
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const placeModel = (url, cfg, onMesh, onLoad) =>
    gltfLoader
      .loadAsync(url)
      .then((gltf) => {
        const root = gltf.scene;
        root.position.set(cfg.x, 0, cfg.z);
        root.rotation.y = cfg.ry;
        root.scale.setScalar(cfg.scale);
        root.traverse((obj) => obj.isMesh && onMesh?.(obj));
        group.add(root);
        root.updateMatrixWorld(true);
        onLoad?.(root);
        models.push(root);
        tint(themeKey);
        onChange?.();
      })
      .catch((error) => console.warn("desk model:", error));
  placeModel(
    plantUrl,
    PLANT,
    (mesh) => {
      mesh.material.envMapIntensity = 0.6;
    },
    (root) => {
      // The scanned plant stands in a slim, tall white ceramic vase (its
      // scanned pot and soil are hidden); the plant is lifted to the vase mouth.
      let potMesh = null;
      root.traverse((obj) => {
        if (!obj.isMesh) return;
        if (/_pot$/i.test(obj.material.name)) potMesh = obj;
        if (/dirt|soil/i.test(obj.name) || /dirt|soil/i.test(obj.material.name)) obj.visible = false;
      });
      if (!potMesh) return;
      const box = new Box3().setFromObject(potMesh);
      potMesh.visible = false;
      const VASE = { r: 0.27, h: 0.95 };
      root.position.y += VASE.h - (box.max.y - box.min.y) * 0.92;
      // r × VASE.r, y × VASE.h: a gently swelling cylinder with a rolled lip
      const profile = [[0, 0.004], [0.8, 0.004], [0.86, 0], [0.92, 0.02], [0.99, 0.25], [1.0, 0.62], [0.93, 0.9], [0.88, 0.975], [0.93, 0.995], [0.9, 1.0], [0.82, 0.985], [0.8, 0.9]];
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const vase = new Mesh(
        lathe(profile.map(([x, y]) => [x * VASE.r, y * VASE.h]), n(56)),
        new MeshStandardMaterial({ color: "#e6dccb", roughness: 0.55, metalness: 0, envMapIntensity: 1 })
      );
      vase.position.set(cx, 0, cz);
      // dark inside of the mouth
      const mouth = new Mesh(new CircleGeometry(VASE.r * 0.8, n(32)), new MeshBasicMaterial({ color: "#1a1410", toneMapped: false }));
      mouth.rotation.x = -Math.PI / 2;
      mouth.position.set(cx, VASE.h * 0.9, cz);
      group.add(vase, mouth);
      models.push(vase);
    }
  );

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
  const facing = MathUtils.degToRad(36); // the quote faces the camera from the mug's spot
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
    // fully on the mat (front edge z = MAT.z + MAT.d / 2 ≈ 2.28)
    [-1.45, 1.66, 0.2, 1],
    [-0.85, 1.86, -0.14, 2],
  ].forEach(([x, z, r, i], k) => {
    addDetail("notes", part(atlasUV(new PlaneGeometry(0.62, 0.62), REGION.notes[i], ATLAS_W, ATLAS_H), { position: [x, MAT_TOP + 0.004 + k * 0.001, z], rotation: [-Math.PI / 2, 0, r], color: "#ffffff" }));
  });

  {
    const bulbGeometry = new SphereGeometry(0.12, n(14), n(10));
    const [bx, by, bw, bh] = REGION.bulb;
    const bulbUV = bulbGeometry.attributes.uv;
    for (let i = 0; i < bulbUV.count; i += 1) bulbUV.setXY(i, (bx + bw / 2) / ATLAS_W, 1 - (by + bh / 2) / ATLAS_H);
    addDetail("bulb", part(bulbGeometry, { position: bulbAt.toArray(), color: "#ffffff" }));
    // inside of the shade, lit by the bulb (faces inward)
    const glowGeo = lathe([[0, 0.405], [0.1, 0.4], [0.105, 0.295], [0.115, 0.278], [0.19, 0.252], [0.27, 0.192], [0.32, 0.115], [0.343, 0.03], [0.346, 0.004]], n(48));
    for (let i = 0; i < glowGeo.attributes.uv.count; i += 1) glowGeo.attributes.uv.setXY(i, (bx + bw / 2) / ATLAS_W, 1 - (by + bh / 2) / ATLAS_H);
    orient(glowGeo, shadeAt, new Vector3(0, -1, 0), shadeDir);
    addDetail("shade", part(glowGeo, { color: "#ffffff" }));
  }
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
    [stack.x, stack.z, 1.7, 1.35, stack.ry, 0.85],
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
  const life = { start: null, lamp: reduced ? 1 : 0, wake: reduced ? 1 : 0, caretOn: true, steamAt: -1, clockAt: -1 };
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
    if (lampLight) lampLight.emissiveIntensity = night ? 3 * lamp : 0;
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
    /** Light-blocking props (dev export for the Blender light bake). */
    casters: () => [...props, sleeve, keys, ...models],
    /** Paint the theme onto the wall, the desk plane and the details. */
    applyTheme: (name, deskMaterial, deskPlane, sheenMaterial) => {
      const key = PALETTE[name] ? name : "dark";
      themeKey = key;
      wall.material.map = wallFor(key);
      wall.material.needsUpdate = true;
      neon.material.map = neonFor(key);
      // night: light adds up (a glow); day: painted over the light wall
      neon.material.blending = key === "dark" ? AdditiveBlending : NormalBlending;
      neon.material.needsUpdate = true;
      deskMaterial.map = woodFor(key);
      // Scanned wood veneer (Poly Haven, CC0): walnut at night, white oak by
      // day; the drawn wood shows until it has loaded.
      const wood = WOOD[key];
      scannedTex(wood.map, true).then((texture) => {
        if (themeKey !== key || !texture) return;
        deskMaterial.map = texture;
        deskMaterial.color.set(wood.tint);
        deskMaterial.needsUpdate = true;
        onChange?.();
      });
      if (sheenMaterial) {
        scannedTex(wood.normal, false).then((texture) => {
          if (themeKey !== key || !texture) return;
          sheenMaterial.bumpMap = null;
          sheenMaterial.normalMap = texture;
          sheenMaterial.normalScale.set(0.8, 0.8);
          sheenMaterial.needsUpdate = true;
          onChange?.();
        });
      }
      lightSlats(key);
      view.material.map = viewFor(key);
      view.material.needsUpdate = true;
      slats.material.color.set(PALETTE[key].wood.light);
      slats.material.map = null;
      slats.material.needsUpdate = true;
      scannedTex(wood.map, true).then((texture) => {
        if (themeKey !== key || !texture) return;
        slats.material.map = texture;
        slats.material.color.set(wood.tint);
        slats.material.needsUpdate = true;
        onChange?.();
      });
      artMeshes.forEach((m) => m.userData.tint && m.material.color.setScalar(key === "dark" ? 0.82 : 0.97));
      // Painted fallback first; the baked maps swap in once loaded.
      const fallback = lightFor(key, deskPlane.size, deskPlane.centerZ);
      fallback.channel = 0;
      deskMaterial.lightMap = fallback;
      deskMaterial.lightMapIntensity = Math.PI; // basic material: lightMap × π⁻¹
      deskMaterial.needsUpdate = true;
      mat.material.color.set("#ffffff"); // the navy is in the leather map
      mat.material.lightMap = null;
      mat.material.needsUpdate = true;
      wall.material.lightMap = null;
      shadows.visible = true;
      Promise.all([baked(`desk-${key}`), baked(`wall-${key}`)]).then(([deskMap, wallMap]) => {
        if (themeKey !== key || !deskMap) return;
        const k = Math.PI * BAKE.range;
        for (const m of [deskMaterial, mat.material]) {
          m.lightMap = deskMap;
          m.lightMapIntensity = k;
          m.needsUpdate = true;
        }
        if (wallMap) {
          wall.material.lightMap = wallMap;
          wall.material.lightMapIntensity = k;
          wall.material.needsUpdate = true;
        }
        shadows.visible = false; // the bake has the real ones
        onChange?.();
      });
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
      edgeMaterial.color.set(PALETTE[key].wood.base).multiplyScalar(0.7);
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
      // Live time: the wall clock sweeps (~30 fps; ticks each second with
      // reduced motion), the phone updates every minute.
      if (onDesk) {
        const now = new Date();
        const sweep = !reduced && time - life.clockAt >= 1 / 30;
        if (sweep || now.getSeconds() !== lastSecond) {
          life.clockAt = time;
          lastSecond = now.getSeconds();
          setClock(now);
          changed = true;
        }
        if (now.getMinutes() !== lastMinute) {
          if (lastMinute !== -1) {
            drawPhone(atlasCtx, image.complete && image.naturalWidth ? image : null);
            atlas.needsUpdate = true;
          }
          lastMinute = now.getMinutes();
          changed = true;
        }
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
      [wall, neon, mat, slats, view, keys, ...artMeshes, clockFace, clockRim, hourHand, minuteHand, secondHand, ...props, sleeve, details, shadows, glows, steam, caret, edge].forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      image.onload = null;
    },
  };
}
