import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import modelUrl from "../assets/models/macbook.glb?url";
import { createBase, lerp } from "./base";
import { createDeskSetup, MAT_TOP } from "./deskSetup";

/*
 * "Laptop on a desk" intro scene.
 *
 * The scene owns the camera move and the laptop; the scroll timeline lives in
 * LaptopIntro.jsx and only tweens a plain `state` object of 0 → 1 phase values
 * (bound with `bind()`). Every pose is derived from those values plus the
 * current viewport, so resizing mid-intro and scrolling backwards just work.
 *
 * After each render the scene projects the screen's content rect and hands
 * LaptopIntro a CSS `matrix3d` that maps the real DOM hero onto it. The final
 * pose is solved so that matrix becomes the identity → a seamless hand-off.
 *
 * Model: src/assets/models/macbook.glb (meshopt + quantized, webp normal map).
 * The lid node ("screen") pivots on the hinge: rotation.x = π is closed,
 * π/2 is upright. "matte" is the display surface (faces the lid's local +y).
 */

const FOV = 35;
const SCALE = 0.1; // model units → world units (laptop ≈ 3.15 wide)
const LID_OPEN = MathUtils.degToRad(108);
// Camera notch, measured from the bezel geometry (lid space, model units):
// x -1.865 → 1.880, from the display's top edge down to z -20.6745.
const NOTCH = { x0: -1.865, x1: 1.88, z1: -20.6745 };
const TAN_HALF_FOV = Math.tan(MathUtils.degToRad(FOV / 2));

const THEMES = {
  dark: {
    bg: "#05070f",
    desk: "#ffffff",
    shell: "#80838c",
    keys: "#15161b",
    hemiSky: "#a9b4ff",
    hemiGround: "#05070f",
    hemi: 0.5,
    key: 2.4,
    keyColor: "#e9ecff",
    rim: 5,
    rimColor: "#6366f1",
    env: 0.55,
    shadow: 0.85,
    logo: 0.32,
    glow: "#8b90ff",
    glowIntensity: 4,
  },
  light: {
    bg: "#f4f3ef",
    desk: "#ffffff",
    shell: "#c9cbd1",
    keys: "#16171b",
    hemiSky: "#ffffff",
    hemiGround: "#d9d4c7",
    hemi: 1.1,
    key: 2.6,
    keyColor: "#fff4e3",
    rim: 2.2,
    rimColor: "#8f95ff",
    env: 0.9,
    shadow: 0.42,
    logo: 0.55,
    glow: "#6366f1",
    glowIntensity: 2.2,
  },
};

const SCREEN_OFF = new Color("#030304");

const smoothstep = (e0, e1, x) => {
  const t = MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Power-on: a short stutter, then a smooth ramp. A function of the scrubbed
// value (not time), so it plays identically forwards and backwards.
const screenLuminance = (s) => {
  if (s <= 0) return 0;
  const stutter = s < 0.28 && (s * 23) % 1 < 0.38 ? 0.3 : 1;
  return smoothstep(0, 1, s) * stutter;
};

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// Soft rounded-rect shadow. shadowBlur (unlike ctx.filter) works everywhere:
// the shape is drawn off-canvas and only its blurred shadow lands inside.
const shadowTexture = (blur, rectW, rectH) =>
  canvasTexture(256, 192, (ctx, w, h) => {
    const off = 2000;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = off;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    const x = (w - rectW) / 2 - off;
    const y = (h - rectH) / 2;
    if (ctx.roundRect) ctx.roundRect(x, y, rectW, rectH, 10);
    else ctx.rect(x, y, rectW, rectH);
    ctx.fill();
  });

// Keyboard (the model's deck is flat): one InstancedMesh → one draw call.
// Rows in key units (each row sums to 15u); "ud" = stacked up/down arrows,
// "tid" = the square Touch ID key (as wide as its row is tall).
const FN_H = 0.55;
const KEY_ROWS = [
  { h: FN_H, keys: [1.5, ...Array(12).fill((15 - 1.5 - FN_H) / 12), "tid"] },
  { h: 1, keys: [...Array(13).fill(1), 2] },
  { h: 1, keys: [1.5, ...Array(12).fill(1), 1.5] },
  { h: 1, keys: [1.75, ...Array(11).fill(1), 2.25] },
  { h: 1, keys: [2.25, ...Array(10).fill(1), 2.75] },
  { h: 1, keys: [1, 1, 1, 1.25, 5.5, 1.25, 1, 1, "ud", 1] },
];

// Built in the model's own units: deck top ≈ y 0.017, keyboard outline
// x ±14, z -9.9 (hinge side) → 1.4.
const KEY_LABELS = [
  ["esc", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", ""],
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "delete"],
  ["tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\"],
  ["caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", ";", "'", "return"],
  ["shift", "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/", "shift"],
  ["fn", "ctrl", "opt", "cmd", "", "cmd", "opt", "◀", "▲", "▼", "▶"],
];

function buildKeyboard(keyMaterial, wellMaterial, legendResolution = 1024) {
  const group = new Group();
  const pitch = 27.2 / 15;
  const gap = pitch * 0.13;
  const z0 = -9.5;
  const keyHeight = 0.09;
  const rects = [];
  let touchIndex = -1;
  let z = z0;
  KEY_ROWS.forEach(({ h, keys }) => {
    let x = -7.5 * pitch;
    const depth = h * pitch;
    keys.forEach((key) => {
      const width = (key === "ud" ? 1 : key === "tid" ? h : key) * pitch;
      if (key === "tid") touchIndex = rects.length;
      if (key === "ud") {
        rects.push([x, z, width, depth / 2], [x, z + depth / 2, width, depth / 2]);
      } else {
        rects.push([x, z, width, depth]);
      }
      x += width;
    });
    z += depth;
  });

  const keysMesh = new InstancedMesh(new BoxGeometry(1, keyHeight, 1), keyMaterial, rects.length);
  const m = new Matrix4();
  const scale = new Vector3();
  const position = new Vector3();
  const identity = new Quaternion();
  rects.forEach(([x, rz, w, d], i) => {
    const half = gap / 2;
    // the half-height arrow keys share one gap, not two
    const dGap = d < pitch * 0.6 ? half : gap;
    position.set(x + w / 2, 0.03 + keyHeight / 2, rz + d / 2);
    // Touch ID is its own rounded mesh (below): hide its instance.
    if (i === touchIndex) scale.set(0, 0, 0);
    else scale.set(w - gap, 1, d - dGap);
    keysMesh.setMatrixAt(i, m.compose(position, identity, scale));
  });
  keysMesh.instanceMatrix.needsUpdate = true;

  const depth = z - z0;
  const well = new Mesh(new PlaneGeometry(15 * pitch + gap * 2, depth + gap * 2), wellMaterial);
  well.rotation.x = -Math.PI / 2;
  well.position.set(0, 0.022, z0 + depth / 2);

  // Legends: one transparent texture just above the key tops, glyphs drawn at
  // each key's position (one draw call, no per-instance UVs needed).
  const width = 15 * pitch + gap * 2;
  const top = z0 - gap;
  const cw = legendResolution;
  const ch = Math.round((cw * (depth + gap * 2)) / width);
  const legends = KEY_LABELS.flat();
  const texture = canvasTexture(cw, ch, (ctx) => {
    ctx.fillStyle = "#d4d7e0";
    ctx.textBaseline = "middle";
    rects.forEach(([x, rz, w, d], i) => {
      const label = legends[i];
      if (!label) return;
      const px = ((x + width / 2) / width) * cw;
      const py = ((rz - top) / (depth + gap * 2)) * ch;
      const pw = (w / width) * cw;
      const ph = (d / (depth + gap * 2)) * ch;
      const single = label.length === 1;
      ctx.font = `600 ${Math.round(ph * (single ? 0.34 : 0.2))}px system-ui, sans-serif`;
      ctx.textAlign = single ? "center" : "left";
      ctx.fillText(label, single ? px + pw / 2 : px + pw * 0.16, py + ph * (single ? 0.48 : 0.7));
    });
  });
  texture.anisotropy = 4;
  const legend = new Mesh(
    new PlaneGeometry(width, depth + gap * 2),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.85 })
  );
  legend.rotation.x = -Math.PI / 2;
  legend.position.set(0, 0.03 + keyHeight + 0.004, z0 + depth / 2);

  group.add(well, keysMesh, legend);

  // Touch ID (the function row's last key): a rounded-square power button —
  // a brushed-metal rim around a glossy black sensor with a fingerprint.
  const [tx, tz, tw, td] = rects[touchIndex];
  const side = Math.min(tw, td) - gap;
  const cx = tx + tw / 2;
  const cz = tz + td / 2;
  const rim = new Mesh(
    new RoundedBoxGeometry(side, keyHeight, side, 3, side * 0.2),
    new MeshStandardMaterial({ color: "#a7abb4", roughness: 0.3, metalness: 0.9 })
  );
  rim.position.set(cx, 0.03 + keyHeight / 2, cz);
  const inner = side * 0.84;
  const sensorGeometry = new ShapeGeometry(roundedSquare(inner, inner * 0.17), 6);
  // ShapeGeometry's UVs are the shape's own coordinates: normalise to 0..1.
  const uv = sensorGeometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) / inner + 0.5, uv.getY(i) / inner + 0.5);
  // Unlit: a lit dark surface turns grey at this grazing angle (the room's
  // reflections), and the sensor should read as black glass.
  const sensor = new Mesh(
    sensorGeometry,
    new MeshBasicMaterial({ map: canvasTexture(256, 256, drawFingerprint), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
  );
  sensor.rotation.x = -Math.PI / 2;
  sensor.position.set(cx, 0.03 + keyHeight + 0.008, cz);
  group.add(rim, sensor);
  return group;
}

// Rounded square in the xy plane, centred.
function roundedSquare(size, r) {
  const s = size / 2;
  const shape = new Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return shape;
}

// Touch ID sensor face: near-black glass with faint fingerprint ridges.
function drawFingerprint(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const glass = ctx.createRadialGradient(cx * 0.8, cy * 0.7, 0, cx, cy, w / 2);
  glass.addColorStop(0, "#22242b");
  glass.addColorStop(1, "#0b0c0f");
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(170, 176, 190, 0.3)";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  // Loops around an off-centre core, each broken at a different angle.
  for (let i = 0; i < 9; i += 1) {
    const r = 12 + i * 11;
    const gapAt = 0.9 + i * 1.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 10 - i * 1.2, r * 0.82, r, 0, gapAt + 0.45, gapAt + Math.PI * 2 - 0.25);
    ctx.stroke();
  }
}

// MacBook Pro speaker grilles (either side of the keyboard): a fine hex grid
// of perforations, drawn dark on a transparent texture.
function drawSpeakerGrille(ctx, w, h, { cols, rows }) {
  const px = w / cols;
  const py = h / rows;
  const r = Math.min(px, py) * 0.27;
  for (let row = 0; row < rows; row += 1) {
    const shift = row % 2 ? px / 2 : 0;
    for (let col = 0; col < cols; col += 1) {
      const x = px / 2 + col * px + shift;
      if (x + r > w) continue;
      const y = py / 2 + row * py;
      // hole + a lit lower lip (light falls into the perforation)
      ctx.fillStyle = "rgba(4, 5, 8, 0.92)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.beginPath();
      ctx.arc(x, y + r * 0.25, r, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineTo(x, y + r * 0.1);
      ctx.fill();
    }
  }
}

// Deck details in model units (deck top ≈ y 0.016): the speaker grilles beside
// the keyboard (x ±13.84).
function buildDeckDetails(anisotropy) {
  const group = new Group();

  const grille = { w: 0.9, d: 10, x: 14.6, z: -4.6, cols: 6, rows: 62 };
  const grilleMap = canvasTexture(96, 1024, (ctx, w, h) => drawSpeakerGrille(ctx, w, h, grille));
  grilleMap.anisotropy = anisotropy;
  const grilleMaterial = new MeshStandardMaterial({
    map: grilleMap,
    transparent: true,
    depthWrite: false,
    roughness: 0.6,
    metalness: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const grilleGeometry = new PlaneGeometry(grille.w, grille.d);
  [-1, 1].forEach((side) => {
    const mesh = new Mesh(grilleGeometry, grilleMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(side * grille.x, 0.02, grille.z);
    group.add(mesh);
  });

  return group;
}

// Apple silhouette (drawn from scratch): body, bite, leaf. Canvas "up" maps
// toward the hinge, so it reads upright on the closed lid from the front.
function drawAppleLogo(ctx) {
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(128, 86);
  ctx.bezierCurveTo(146, 70, 196, 66, 210, 116);
  ctx.bezierCurveTo(222, 168, 190, 226, 162, 230);
  ctx.bezierCurveTo(148, 232, 140, 224, 128, 224);
  ctx.bezierCurveTo(116, 224, 108, 232, 94, 230);
  ctx.bezierCurveTo(66, 226, 34, 168, 46, 116);
  ctx.bezierCurveTo(60, 66, 110, 70, 128, 86);
  ctx.fill();
  // bite
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(226, 130, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  // leaf
  ctx.beginPath();
  ctx.ellipse(146, 50, 12, 28, 0.65, 0, Math.PI * 2);
  ctx.fill();
}

// "<Naumaan/>" laptop sticker: orange vinyl, white die-cut border, bold
// black code-style label (high contrast).
function drawSticker(ctx, w, h) {
  const r = h * 0.3;
  const shape = (inset) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r - inset / 2);
    else ctx.rect(inset, inset, w - inset * 2, h - inset * 2);
  };
  ctx.fillStyle = "#ffffff"; // die-cut border
  shape(2);
  ctx.fill();
  ctx.fillStyle = "#ff7a1a";
  shape(12);
  ctx.fill();
  ctx.fillStyle = "#111111";
  ctx.font = "800 72px ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("<Naumaan/>", w / 2, h / 2 + 4);
  // Monospace fonts rarely ship an 800 weight: embolden with a matching stroke.
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111111";
  ctx.strokeText("<Naumaan/>", w / 2, h / 2 + 4);
}

// Bounding box of `object`'s meshes in `space`'s local coordinates (a glTF node
// with several primitives loads as a Group, so walk the meshes).
function boundsIn(object, space) {
  const box = new Box3();
  const toSpace = new Matrix4().copy(space.matrixWorld).invert();
  const m = new Matrix4();
  object.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.computeBoundingBox();
    box.union(obj.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(toSpace, obj.matrixWorld)));
  });
  return box;
}

// Unit square → quad homography, as a CSS matrix3d for an element of size
// (w × h) with transform-origin 0 0. Corners: TL, TR, BR, BL in CSS px.
function quadToMatrix3d(q, w, h) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let k = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    k = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  const A = a / w;
  const B = b / h;
  const D = d / w;
  const E = e / h;
  const G = g / w;
  const H = k / h;
  return `matrix3d(${A},${D},0,${G},${B},${E},0,${H},0,0,1,0,${x0},${y0},0,1)`;
}

export function createScene(container, { isMobile, reduced = false }) {
  const base = createBase(container, { isMobile, fov: FOV, z: 6 });
  const { renderer, scene, camera } = base;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const textures = [];
  const track = (texture) => {
    textures.push(texture);
    return texture;
  };

  // ---- Environment: soft studio reflections for the aluminium ----
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.traverse((obj) => {
    obj.geometry?.dispose?.();
    if (obj.material) [].concat(obj.material).forEach((m) => m.dispose());
  });
  pmrem.dispose();
  scene.environment = envTarget.texture;

  scene.background = new Color(THEMES.dark.bg);
  scene.fog = new Fog(THEMES.dark.bg, 5, 15);

  // ---- Workspace: wooden desk (baked light pool) + back wall + props ----
  // All static and baked (see deskSetup.js): no extra lights, no shadow maps.
  // toneMapped: false keeps fully-fogged pixels identical to the CSS --bg.
  // The top ends at a rounded front edge (EDGE_Z); UVs keep the full
  // DESK square's mapping so the baked light pool stays put.
  const DESK = { size: 24, centerZ: -0.6 };
  const EDGE_Z = isMobile ? 7 : 3.0; // phones frame more desk: keep the edge out of view
  const zFar = DESK.centerZ - DESK.size / 2;
  const deskGeometry = new PlaneGeometry(DESK.size, EDGE_Z - zFar);
  const deskUV = deskGeometry.attributes.uv;
  for (let i = 0; i < deskUV.count; i += 1) deskUV.setY(i, 1 - (1 - deskUV.getY(i)) * ((EDGE_Z - zFar) / DESK.size));
  const desk = new Mesh(deskGeometry, new MeshBasicMaterial({ color: THEMES.dark.desk, toneMapped: false }));
  desk.rotation.x = -Math.PI / 2;
  desk.position.set(0, 0, (zFar + EDGE_Z) / 2);
  scene.add(desk);
  // Desktop: a varnish layer drawn additively over the baked wood — black
  // albedo, so it only adds reflections (lights + environment) with the grain
  // as a bump, fading out away from the laptop. Phones skip it.
  const sheen = isMobile
    ? null
    : new Mesh(
        deskGeometry,
        new MeshStandardMaterial({ color: 0x000000, metalness: 0, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })
      );
  if (sheen) {
    sheen.rotation.copy(desk.rotation);
    sheen.position.copy(desk.position);
    sheen.renderOrder = 0.5;
    scene.add(sheen);
  }
  let dirty = true; // see update(): unchanged frames are not re-rendered
  const workspace = createDeskSetup({ isMobile, reduced, renderer, edgeZ: EDGE_Z, deskMesh: desk, onChange: () => (dirty = true) });
  scene.add(workspace.group);

  // ---- Contact shadow (baked, two layers: soft spread + tight core) ----
  const shadowMaterial = (texture, opacity) =>
    new MeshBasicMaterial({ color: 0x000000, map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity });
  const softShadow = new Mesh(new PlaneGeometry(4.6, 3.45), shadowMaterial(track(shadowTexture(26, 186, 128)), 0.6));
  const coreShadow = new Mesh(new PlaneGeometry(4.6, 3.45), shadowMaterial(track(shadowTexture(6, 176, 118)), 0.7));
  [softShadow, coreShadow].forEach((mesh, i) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = MAT_TOP + 0.002 + i * 0.001; // on the desk mat
    mesh.renderOrder = 1;
    scene.add(mesh);
  });

  // ---- Lights ----
  const hemi = new HemisphereLight(THEMES.dark.hemiSky, THEMES.dark.hemiGround, THEMES.dark.hemi);
  const key = new DirectionalLight(THEMES.dark.keyColor, THEMES.dark.key);
  key.position.set(-3, 5, 4);
  const rim = new DirectionalLight(THEMES.dark.rimColor, THEMES.dark.rim);
  rim.position.set(3.5, 2.5, -4.5);
  const glow = new PointLight(THEMES.dark.glow, 0, 4.5, 2);
  scene.add(hemi, key, rim, glow);

  // ---- Laptop ----
  const laptop = new Group();
  laptop.scale.setScalar(SCALE);
  laptop.position.y = MAT_TOP; // sits on the padded desk mat
  scene.add(laptop);

  const panelMaterial = new MeshBasicMaterial({ color: SCREEN_OFF.clone(), toneMapped: false });
  const panelOn = new Color(THEMES.dark.bg);
  let shellMaterial = null;
  let logoMaterial = null;
  let bezelMaterial = null;
  let glass = null;
  const keysMaterial = new MeshStandardMaterial({ color: THEMES.dark.keys, roughness: 0.5, metalness: 0.15 });
  const wellMaterial = new MeshStandardMaterial({ color: "#030305", roughness: 0.85, metalness: 0 });
  let lid = null;
  // Display rect in the lid's local space (model units).
  const rect = { x0: -15, x1: 15, z0: -21, z1: -2, y: -0.44 };

  // ---- State bound from LaptopIntro ----
  let state = { reveal: 1, orbit: 0, dolly: 0, lid: 0, screen: 0, align: 0, push: 0, out: 0 };
  let onFrame = null;
  let active = true;
  let theme = THEMES.dark;
  let vw = 1;
  let vh = 1;
  let boxW = 1;
  let boxH = 1;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  // Scratch vectors (no per-frame allocation).
  const v = new Vector3();
  const viewPoint = new Vector3();
  const target = new Vector3();
  const pos = new Vector3();
  const up = new Vector3();
  const p0 = new Vector3();
  const p1 = new Vector3();
  const p2 = new Vector3();
  const p3 = new Vector3();
  // Opening shot aims a little above the desk so the studio wall shows too.
  const t0 = new Vector3(-0.6, 1.05, -1.2);
  const t1 = new Vector3(0, 0.95, -0.75);
  const t3 = new Vector3();
  const normalW = new Vector3();
  const upW = new Vector3();
  const WORLD_UP = new Vector3(0, 1, 0);
  const quad = new Array(8).fill(0);
  const content = { cx: 0, cw: 1, czTop: 0, ch: 1 };
  const UV = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  // Cover-fit the DOM box over the display (centred), so the screen is always
  // full — a portrait phone hero fills the laptop screen too. What falls
  // outside the display is clipped (getClip) until the final push opens it.
  const fitContent = () => {
    const W = rect.x1 - rect.x0;
    const H = rect.z1 - rect.z0;
    const aspect = boxW / boxH;
    if (aspect > W / H) {
      content.ch = H;
      content.cw = H * aspect;
    } else {
      content.cw = W;
      content.ch = W / aspect;
    }
    content.cx = (rect.x0 + rect.x1) / 2;
    content.czTop = (rect.z0 + rect.z1) / 2 - content.ch / 2;
  };

  // DOM-box coordinates (0..1) → world point on the display.
  const contentPoint = (u, w, out) =>
    out
      .set(content.cx - content.cw / 2 + u * content.cw, rect.y, content.czTop + w * content.ch)
      .applyMatrix4(lid.matrixWorld);

  // Distance at which a world width `width` exactly spans the viewport.
  const fitWidth = (width) => width / 2 / (TAN_HALF_FOV * (vw / vh));

  const spherical = (out, origin, radius, azimuthDeg, elevationDeg) => {
    const az = MathUtils.degToRad(azimuthDeg);
    const el = MathUtils.degToRad(elevationDeg);
    return out.set(
      origin.x + radius * Math.cos(el) * Math.sin(az),
      origin.y + radius * Math.sin(el),
      origin.z + radius * Math.cos(el) * Math.cos(az)
    );
  };

  const placeCamera = () => {
    const s = state;
    const portrait = vw / vh < 0.9;

    // Lid on its hinge (slight overshoot comes from the timeline: lid > 1).
    lid.rotation.x = Math.PI - LID_OPEN * s.lid;
    laptop.updateMatrixWorld(true);

    // Screen basis (world): normal out of the display, "up" along the lid.
    normalW.set(0, 1, 0).transformDirection(lid.matrixWorld);
    upW.set(0, 0, -1).transformDirection(lid.matrixWorld);

    // P3 — the hand-off pose: square to the screen, its content rect exactly
    // filling the viewport (top of the DOM box at the top of the viewport).
    contentPoint(0.5, Math.min(1, vh / 2 / boxH), t3);
    const visibleH = content.ch * SCALE * Math.min(1, vh / boxH);
    const d3 = visibleH / 2 / TAN_HALF_FOV;
    p3.copy(t3).addScaledVector(normalW, d3);

    // P2 — square to the screen, a little further back (screen ≈ 80%).
    const screenW = (rect.x1 - rect.x0) * SCALE;
    const d2 = Math.max(d3 * 1.22, Math.min(fitWidth(screenW * 1.04), d3 * 2.4));
    p2.copy(t3).addScaledVector(normalW, d2);

    // P0 — establishing shot (closed lid), orbit drifts while scrolling.
    // (portrait: a shallower ¾ angle so the near corner isn't clipped)
    // desktop: aim a touch right and come in a little so the dark far-left
    // corner beyond the window doesn't eat the frame
    t0.x = portrait ? -0.6 : 0.35;
    t0.y = portrait ? 1.05 : 1.5;
    const r0 = Math.max(portrait ? 7.4 : 9.0, fitWidth(portrait ? 5.2 : 5.5)) * (1 + (1 - s.reveal) * 0.18);
    const azimuth = portrait ? lerp(22, 12, s.orbit) : lerp(34, 20, s.orbit);
    spherical(p0, t0, r0, azimuth - (1 - s.reveal) * 6, portrait ? 34 : 22);

    // P1 — dollied in, lid open, nearly square to the screen.
    spherical(p1, t1, Math.max(5.1, fitWidth(3.8)), 5, portrait ? 22 : 16);

    pos.lerpVectors(p0, p1, s.dolly).lerp(p2, s.align).lerp(p3, s.push);
    target.lerpVectors(t0, t1, s.dolly).lerp(t3, s.align);
    up.lerpVectors(WORLD_UP, upW, s.align).normalize();

    // Pointer parallax, fading out as the camera locks onto the screen.
    const parallax = 1 - s.align;
    pos.x += pointer.x * 0.35 * parallax;
    pos.y += pointer.y * 0.18 * parallax;

    camera.up.copy(up);
    camera.position.copy(pos);
    camera.lookAt(target);
    camera.updateMatrixWorld();

    // Fog follows the framing: the workspace stays clear and only far
    // surfaces haze toward the page colour (the wall itself fades at its edges).
    const distance = pos.distanceTo(target);
    scene.fog.near = distance + 1.8;
    scene.fog.far = distance + 16;
  };

  // Project the content rect → CSS px quad → matrix3d (null if not drawable).
  const screenMatrix = () => {
    for (let i = 0; i < 4; i += 1) {
      contentPoint(UV[i][0], UV[i][1], v);
      // behind / too close to the camera → not drawable
      if (viewPoint.copy(v).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) return null;
      v.project(camera);
      quad[i * 2] = (v.x + 1) * 0.5 * vw;
      quad[i * 2 + 1] = (1 - v.y) * 0.5 * vh;
    }
    return quadToMatrix3d(quad, boxW, boxH);
  };

  const ready = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(modelUrl)
    .then((gltf) => {
      const model = gltf.scene;
      lid = model.getObjectByName("screen");
      const display = model.getObjectByName("matte");
      const body = model.getObjectByName("body");
      if (!lid || !display || !body) throw new Error("macbook.glb: unexpected node names");

      // Sit the body on the desk (y = 0), centred on the origin.
      model.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(body);
      model.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);

      // Display rect in lid space.
      model.updateMatrixWorld(true);
      const box = boundsIn(display, lid);
      // The content runs to the display's top edge, like macOS; the camera
      // notch is drawn over it by LaptopIntro (see getNotch).
      Object.assign(rect, { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z, y: box.max.y + 0.004 });
      fitContent();

      // Lid bezel: glossy black glass (its own material — "blackmatte" is
      // shared with the body's feet and hinge).
      lid.traverse((obj) => {
        if (!obj.isMesh || obj.material.name !== "blackmatte") return;
        bezelMaterial ??= Object.assign(obj.material.clone(), { name: "bezel", metalness: 0.1, roughness: 0.3, envMap: envTarget.texture, envMapIntensity: 0.45 });
        obj.material = bezelMaterial;
      });

      // Screen glass: reflects the room while the display is dark, fades out
      // as it wakes (the live hero sits on top of it).
      glass = new Mesh(
        new PlaneGeometry(box.max.x - box.min.x, box.max.z - box.min.z),
        new MeshStandardMaterial({
          color: 0x000000,
          roughness: 0.04,
          metalness: 0,
          // explicit envMap: with only scene.environment, envMapIntensity is ignored
          envMap: envTarget.texture,
          envMapIntensity: 0.12,
          transparent: true,
          depthWrite: false,
          opacity: 0.7,
        })
      );
      glass.rotation.x = -Math.PI / 2; // face the lid's local +y
      glass.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.008, (box.min.z + box.max.z) / 2);
      lid.add(glass);

      model.traverse((obj) => {
        if (!obj.isMesh) return;
        const name = obj.material.name;
        if (obj === display) {
          obj.material.dispose();
          obj.material = panelMaterial;
        } else if (name === "aluminium") {
          shellMaterial = obj.material;
          shellMaterial.metalness = 1;
          shellMaterial.roughness = 0.32;
          shellMaterial.emissive?.set(0x000000);
          if (isMobile && shellMaterial.normalMap) {
            shellMaterial.normalMap.dispose();
            shellMaterial.normalMap = null;
            shellMaterial.needsUpdate = true;
          }
        } else if (name === "blackmatte") {
          // bezel, hinge, feet
          obj.material.metalness = 0.4;
          obj.material.roughness = 0.55;
        }
      });

      model.add(buildKeyboard(keysMaterial, wellMaterial, isMobile ? 512 : 1024));
      model.add(buildDeckDetails(Math.min(8, renderer.capabilities.getMaxAnisotropy())));

      // Apple logo on the back of the lid (a hand-drawn silhouette; the model
      // has none). Dim at rest, it glows white once scrolling starts (state.glow).
      const logo = new Mesh(
        new PlaneGeometry(4.6, 4.6),
        (logoMaterial = new MeshBasicMaterial({
          map: track(canvasTexture(256, 256, drawAppleLogo)),
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          opacity: theme.logo,
        }))
      );
      const backBox = boundsIn(lid.getObjectByName("back") ?? lid, lid);
      const backY = backBox.min.y;
      logo.rotation.x = Math.PI / 2; // face the lid's local -y (its back)
      logo.position.set(0, backY - 0.02, (rect.z0 + rect.z1) / 2);
      lid.add(logo);

      // "<Naumaan/>" sticker near the bottom-right corner of the closed lid
      // (lid space: +x = right, z → -21.8 = the front edge).
      const sticker = new Mesh(
        new PlaneGeometry(7, 2.2),
        new MeshStandardMaterial({
          map: track(canvasTexture(512, 160, drawSticker)),
          transparent: true,
          depthWrite: false,
          roughness: 0.55,
          metalness: 0,
        })
      );
      sticker.material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); // crisp at grazing angles
      sticker.rotation.set(Math.PI / 2, 0, 0.1); // on the back, slightly tilted
      sticker.position.set(10.4, backY - 0.03, -18.9);
      lid.add(sticker);

      laptop.add(model);
      applyTheme();
      placeCamera();
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
    });

  const applyTheme = () => {
    const t = theme;
    scene.background.set(t.bg);
    scene.fog.color.set(t.bg);
    desk.material.color.set(t.desk);
    workspace.applyTheme(t === THEMES.light ? "light" : "dark", desk.material, DESK, sheen?.material);
    dirty = true;
    softShadow.material.opacity = t.shadow * 0.7;
    coreShadow.material.opacity = t.shadow;
    hemi.color.set(t.hemiSky);
    hemi.groundColor.set(t.hemiGround);
    hemi.intensity = t.hemi;
    key.color.set(t.keyColor);
    key.intensity = t.key;
    rim.color.set(t.rimColor);
    rim.intensity = t.rim;
    glow.color.set(t.glow);
    scene.environmentIntensity = t.env;
    panelOn.set(t.bg);
    shellMaterial?.color.set(t.shell);
    keysMaterial.color.set(t.keys);
  };

  const resize = (width, height) => {
    base.resize(width, height);
    dirty = true;
    vw = width;
    vh = height;
  };

  // Opt-in perf readout (?introStats): draw calls, triangles, GPU resources
  // and the JS cost of update(), for comparing scene changes.
  // Dev only (?exportDesk): the props + closed laptop as a GLB, the input of
  // the Blender light bake (scripts/bake). Loaded on demand; never in normal use.
  if (typeof location !== "undefined" && /[?&]exportDesk(&|$)/.test(location.search)) {
    window.__exportDesk = async () => {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const root = new Group();
      const plain = new MeshStandardMaterial({ color: 0xffffff });
      workspace.casters().forEach((mesh) => root.add(mesh.clone()));
      root.add(laptop.clone(true));
      root.updateMatrixWorld(true);
      const drop = [];
      root.traverse((obj) => {
        if (obj.isInstancedMesh || obj.isSprite) drop.push(obj);
        else if (obj.isMesh) obj.material = plain;
      });
      drop.forEach((obj) => obj.parent.remove(obj));
      const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
      const bytes = new Uint8Array(buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };
  }

  const stats = typeof location !== "undefined" && /[?&]introStats(&|$)/.test(location.search) ? { ms: 0, n: 0 } : null;
  if (stats) {
    window.__introStats = () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length,
      updateMs: +(stats.ms / Math.max(1, stats.n)).toFixed(3),
    });
  }

  const update = (time, dt) => {
    const t0 = stats ? performance.now() : 0;
    updateFrame(time, dt);
    if (stats) {
      stats.ms += performance.now() - t0;
      stats.n += 1;
    }
  };

  // Frame signature: camera matrix + all scrubbed phase values. When nothing
  // moved (scroll idle, pointer settled) the frame is skipped entirely: no
  // GPU work and no DOM writes. Anything else that changes the picture sets
  // `dirty` (theme, resize, texture loads, screen box).
  const signature = new Float64Array(48);
  let signatureKeys = Object.keys(state);
  const frameChanged = () => {
    let changed = false;
    let i = 0;
    const e = camera.matrixWorld.elements;
    for (; i < 16; i += 1) {
      if (signature[i] !== e[i]) {
        signature[i] = e[i];
        changed = true;
      }
    }
    for (const key of signatureKeys) {
      const value = state[key] ?? 0;
      if (signature[i] !== value) {
        signature[i] = value;
        changed = true;
      }
      i += 1;
    }
    return changed;
  };

  const updateFrame = (time, dt) => {
    if (!active || !lid) {
      if (!lid) renderer.render(scene, camera);
      return;
    }
    const k = 1 - Math.pow(0.002, dt || 0.016);
    pointer.x = Math.abs(pointer.tx - pointer.x) < 1e-4 ? pointer.tx : lerp(pointer.x, pointer.tx, k);
    pointer.y = Math.abs(pointer.ty - pointer.y) < 1e-4 ? pointer.ty : lerp(pointer.y, pointer.ty, k);

    placeCamera();
    if (workspace.tick(time, state)) dirty = true;
    if (!frameChanged() && !dirty) return;
    dirty = false;

    const lum = screenLuminance(state.screen);
    panelMaterial.color.copy(SCREEN_OFF).lerp(panelOn, lum);
    if (glass) glass.material.opacity = 0.7 * (1 - lum);
    glow.intensity = lum * theme.glowIntensity * (1 - state.out);

    // Lid logo: dim → glowing white as soon as scrolling starts.
    const logoGlow = state.glow ?? 0;
    if (logoMaterial) logoMaterial.opacity = lerp(theme.logo, 1, logoGlow);
    v.copy(normalW).multiplyScalar(0.7);
    contentPoint(0.5, 0.5, glow.position).add(v);

    renderer.render(scene, camera);
    onFrame?.(lum > 0 ? screenMatrix() : null, lum);
  };

  return {
    resize,
    update,
    ready,
    setPointer: (x, y) => {
      pointer.tx = x;
      pointer.ty = y;
    },
    setProgress: () => {},
    setTheme: (name) => {
      theme = THEMES[name] ?? THEMES.dark;
      applyTheme();
    },
    /** Bind the scrubbed phase values and the per-frame DOM callback. */
    bind: (nextState, frameCallback) => {
      state = nextState;
      onFrame = frameCallback;
      signatureKeys = Object.keys(state).slice(0, 32);
      dirty = true;
    },
    /** Size of the DOM element mapped onto the screen (CSS px). */
    setScreenBox: (width, height) => {
      if (!width || !height) return;
      boxW = width;
      boxH = height;
      fitContent();
      dirty = true;
    },
    /** The notch in DOM-box px ({ left, width, height }), for the overlay. */
    getNotch: () => {
      const left = content.cx - content.cw / 2;
      return {
        left: ((NOTCH.x0 - left) / content.cw) * boxW,
        top: ((rect.z0 - content.czTop) / content.ch) * boxH,
        width: ((NOTCH.x1 - NOTCH.x0) / content.cw) * boxW,
        height: ((NOTCH.z1 - rect.z0) / content.ch) * boxH,
      };
    },
    /** Insets (DOM-box px) that clip the cover-fitted box to the display. */
    getClip: () => {
      const left = content.cx - content.cw / 2;
      return {
        top: ((rect.z0 - content.czTop) / content.ch) * boxH,
        bottom: ((content.czTop + content.ch - rect.z1) / content.ch) * boxH,
        left: ((rect.x0 - left) / content.cw) * boxW,
        right: ((left + content.cw - rect.x1) / content.cw) * boxW,
      };
    },
    /** false → stop rendering (the intro is finished and hidden). */
    setActive: (value) => {
      active = value;
      dirty = true;
    },
    dispose: () => {
      onFrame = null;
      textures.forEach((texture) => texture.dispose());
      workspace.dispose();
      scene.traverse((obj) => obj.material?.map?.dispose?.()); // key legends
      envTarget.dispose();
      shellMaterial?.normalMap?.dispose();
      base.dispose();
    },
  };
}
