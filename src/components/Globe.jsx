import { useEffect, useRef } from "react";
import gsap from "gsap";
import { profile, reach } from "../data/content";
import { prefersReducedMotion, isSmallScreen } from "../lib/scroll";
import { getTheme, onThemeChange } from "../lib/theme";
import "../style/Globe.css";

/*
 * Interactive dotted globe (cobe, ~5KB, loaded on demand).
 *
 *  - Drag to spin, with inertia; vertical drag tilts (clamped).
 *  - Idles with a slow auto-rotation, then eases back to face "home".
 *  - Double-click / the "Home" button flies to profile.coords.
 *  - Home marker pulses; arcs reach out to the `reach` cities.
 *  - Palette follows the light / dark theme live.
 *  - Renders on the shared GSAP ticker, only while on-screen and the tab is visible.
 *  - Reduced motion: no auto-rotation or pulse; dragging still works.
 */

const THEMES = {
  dark: {
    dark: 1,
    diffuse: 1.2,
    mapBrightness: 6,
    mapBaseBrightness: 0,
    baseColor: [0.32, 0.33, 0.48],
    markerColor: [0.37, 0.84, 0.96], // #5fd6f6
    glowColor: [0.26, 0.27, 0.62], // indigo haze
    arcColor: [0.39, 0.4, 0.95], // #6366f1
    opacity: 0.9,
  },
  light: {
    dark: 0,
    diffuse: 1.6,
    mapBrightness: 2.4,
    mapBaseBrightness: 0.04,
    baseColor: [1, 1, 1],
    markerColor: [0.31, 0.27, 0.9], // #4f46e5
    glowColor: [0.93, 0.92, 0.98],
    arcColor: [0.03, 0.57, 0.7], // #0891b2
    opacity: 0.95,
  },
};

const TAU = Math.PI * 2;
const toRad = (deg) => (deg * Math.PI) / 180;
// cobe's camera: these angles bring [lat, lng] to the centre of the view.
const facing = ([lat, lng]) => ({ phi: Math.PI - (toRad(lng) - Math.PI / 2), theta: toRad(lat) });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Shortest signed angle from a to b.
const angleTo = (a, b) => ((((b - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;

// In background mode, drags start from empty space in the section — never
// from controls, the form or text people may want to select.
const NO_DRAG = "a, button, input, textarea, select, label, .cform, p, h1, h2, h3, li, .contact__col, .site-footer";

export default function Globe({ className = "", background = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const goHomeRef = useRef(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    // Background: the canvas sits under the content, so listen on the section.
    const dragTarget = background ? wrap.closest("section") ?? wrap.parentElement : canvas;
    const reduced = prefersReducedMotion();
    const home = facing(profile.coords);
    const dpr = Math.min(window.devicePixelRatio || 1, isSmallScreen() ? 1.5 : 2);

    // Spin state. `phi`/`theta` are what's rendered; drag writes velocity.
    const s = {
      phi: home.phi - 1.2, // start turned away, then glide home on reveal
      theta: 0.3,
      vPhi: 0,
      thetaTarget: home.theta * 0.6,
      dragging: false,
      lastX: 0,
      lastY: 0,
      idle: 0, // seconds since the last interaction
      homing: 1, // 1 = steer toward home, 0 = free spin
      t: 0,
    };

    let globe = null;
    let disposed = false;
    let running = false;
    let inView = false;
    let size = 0;

    const markers = () => {
      const pulse = reduced ? 0 : (Math.sin(s.t * 2.4) + 1) * 0.5;
      return [
        { location: profile.coords, size: 0.06 + pulse * 0.03, id: "home" },
        ...reach.map((c) => ({ location: c.coords, size: 0.025 })),
      ];
    };
    const arcs = reach.map((c) => ({ from: profile.coords, to: c.coords }));

    const render = () => {
      globe?.update({ phi: s.phi, theta: s.theta, markers: markers() });
    };

    const tick = (_time, deltaMs) => {
      const dt = Math.min(deltaMs, 64) / 1000;
      s.t += dt;
      if (!s.dragging) {
        s.idle += dt;
        s.phi += s.vPhi;
        s.vPhi *= Math.pow(0.04, dt); // inertia decay
        if (s.homing > 0) {
          // Critically-damped-ish glide toward home.
          const k = 1 - Math.pow(0.08, dt);
          s.phi += angleTo(s.phi, home.phi) * k * s.homing;
          s.thetaTarget = home.theta * 0.6;
          if (Math.abs(angleTo(s.phi, home.phi)) < 0.002 && Math.abs(s.vPhi) < 0.0005) s.homing = 0;
        } else if (!reduced) {
          // Gentle auto-rotation that ramps in after the visitor lets go.
          s.phi += dt * 0.12 * clamp((s.idle - 1.5) / 2, 0, 1);
        }
      }
      s.theta += (s.thetaTarget - s.theta) * (1 - Math.pow(0.02, dt));
      render();
    };

    const start = () => {
      if (running || !globe || !inView || document.hidden) return;
      running = true;
      gsap.ticker.add(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      gsap.ticker.remove(tick);
    };

    const applyTheme = (theme) => {
      globe?.update(THEMES[theme] ?? THEMES.dark);
      render();
    };

    const resize = () => {
      const next = Math.round(wrap.clientWidth);
      if (!next || next === size) return;
      size = next;
      globe?.update({ width: size * dpr, height: size * dpr });
      render();
    };

    // ---------- Interaction ----------
    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (background && e.target.closest?.(NO_DRAG)) return;
      s.dragging = true;
      s.homing = 0;
      s.vPhi = 0;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      wrap.classList.add("is-dragging");
      dragTarget.classList.add("is-globe-dragging");
      if (!background) canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      const delta = (dx / Math.max(size, 1)) * Math.PI;
      s.phi += delta;
      s.vPhi = delta * 0.9;
      // Tilt only with a mouse / pen — on touch, vertical moves scroll the page.
      if (e.pointerType !== "touch") s.thetaTarget = clamp(s.thetaTarget + (dy / Math.max(size, 1)) * 2, -0.9, 0.9);
      s.idle = 0;
      if (!running) render();
    };
    const onUp = () => {
      if (!s.dragging) return;
      s.dragging = false;
      s.idle = 0;
      wrap.classList.remove("is-dragging");
      dragTarget.classList.remove("is-globe-dragging");
    };
    const onDblClick = (e) => {
      if (background && e.target.closest?.(NO_DRAG)) return;
      goHome();
    };
    const goHome = () => {
      s.homing = 1;
      s.vPhi = 0;
      s.idle = 0;
      start();
    };
    goHomeRef.current = goHome;

    dragTarget.classList.add("globe-drag");
    dragTarget.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    dragTarget.addEventListener("dblclick", onDblClick);

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) start();
        else stop();
      },
      { rootMargin: "100px 0px" }
    );
    io.observe(wrap);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const offTheme = onThemeChange(applyTheme);

    import("cobe")
      .then(({ default: createGlobe }) => {
        if (disposed) return;
        size = Math.round(wrap.clientWidth) || 400;
        globe = createGlobe(canvas, {
          devicePixelRatio: 1, // width/height below are already in device px
          width: size * dpr,
          height: size * dpr,
          phi: s.phi,
          theta: s.theta,
          mapSamples: isSmallScreen() ? 12000 : 20000,
          markers: markers(),
          arcs,
          arcWidth: 0.6,
          arcHeight: 0.28,
          markerElevation: 0.02,
          scale: 1,
          ...(THEMES[getTheme()] ?? THEMES.dark),
        });
        wrap.classList.add("is-ready");
        render();
        start();
      })
      .catch((error) => {
        console.warn("[globe] disabled:", error);
        wrap.classList.add("is-failed");
      });

    return () => {
      disposed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      offTheme();
      document.removeEventListener("visibilitychange", onVisibility);
      dragTarget.removeEventListener("pointerdown", onDown);
      dragTarget.removeEventListener("dblclick", onDblClick);
      dragTarget.classList.remove("globe-drag", "is-globe-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      globe?.destroy();
      globe = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`globe ${background ? "globe--bg" : ""} ${className}`} ref={wrapRef}>
      <canvas className="globe__canvas" ref={canvasRef} aria-hidden="true" />
      <span className="globe__pin" aria-hidden="true">
        <span className="globe__pin-dot" />
        {profile.city}
      </span>
      {!background && (
        <div className="globe__hud">
          <span className="globe__hint" aria-hidden="true">
            Drag to spin
          </span>
          <button type="button" className="globe__home" onClick={() => goHomeRef.current()}>
            <span aria-hidden="true">⌖</span> Find me
          </button>
        </div>
      )}
    </div>
  );
}
