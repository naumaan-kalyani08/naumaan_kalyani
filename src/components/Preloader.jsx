import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { profile } from "../data/content";
import { isAppReady, setAppReady } from "../lib/ready";
import { introEnabled, whenIntroSceneReady } from "../lib/intro";
import { prefersReducedMotion } from "../lib/scroll";
import "../style/Preloader.css";

const WORDS = ["Think", "Design", "Build", "Ship"];
const MIN_DURATION = 1.4; // s — never flash
// ms — never get stuck. Past this the counter runs out to 100 and the
// curtain lifts whatever is still loading (each task below is capped too).
const FAILSAFE = 10000;
const SCENE_CAP = 8000; // ms — the 3D scene (chunk + model + shader compile)
// Curtain lift: power4.inOut as a CSS curve (Web Animations, see exit()).
const LIFT = { duration: 1150, easing: "cubic-bezier(0.86, 0, 0.07, 1)" };
const CURVE_FLAT = "M0,0 L1000,0 L1000,0 Q500,0 0,0 Z";
const CURVE_BULGE = "M0,0 L1000,0 L1000,0 Q500,160 0,0 Z";

// Each task is capped: a slow font CDN must never hold the site hostage
// (text simply swaps in when the webfont arrives).
// Odometer: three digit columns (hundreds, tens, ones). Each strip holds 0–9
// plus a trailing 0, so a column can roll 9 → 0 without jumping back.
const COLUMNS = 3;
const STRIP = Array.from({ length: 11 }, (_, n) => n % 10);

// Digits rest on whole numbers and only flick over in the last part of each
// step — so a pause in loading never leaves a digit stuck halfway.
const ROLL = 0.35; // share of each step spent rolling
const settle = (value) => {
  const base = Math.floor(value);
  const t = Math.min(1, Math.max(0, (value - base - (1 - ROLL)) / ROLL));
  return base + t * t * (3 - 2 * t); // smoothstep
};

// Mechanical carry: a column only turns while every column to its right is
// rolling over its last digit (…098 → 099 → 100), like a real counter.
const odometer = (value) => {
  const ones = value % 10;
  return [
    Math.floor(value / 100) + Math.max(0, (value % 100) - 99),
    Math.floor(value / 10) - Math.floor(value / 100) * 10 + Math.max(0, ones - 9),
    ones,
  ];
};

const capped = (promise, ms) =>
  Promise.race([Promise.resolve(promise).catch(() => null), new Promise((resolve) => setTimeout(resolve, ms))]);

// Real progress: fonts, window load (images, incl. the hero's Memoji) and —
// when the laptop intro runs — its scene (chunk + model + shader compile).
const loadTasks = () =>
  [
    capped(document.fonts?.ready, 2200),
    capped(
      document.readyState === "complete"
        ? null
        : new Promise((resolve) => window.addEventListener("load", resolve, { once: true })),
      3000
    ),
    // The scene's shader compile blocks the main thread: let it finish behind
    // the curtain rather than freeze the curtain halfway up.
    introEnabled() && capped(whenIntroSceneReady(), SCENE_CAP),
  ].filter(Boolean);

// The word / shimmer loops are CSS (compositor) animations, started by the
// static copy in index.html at first paint: continue them in the same phase.
const loopDelay = () => {
  const t0 = typeof window !== "undefined" ? window.__preloaderT0 : undefined;
  return `${-Math.max(0, performance.now() - (t0 ?? performance.now())).toFixed(0)}ms`;
};

export default function Preloader() {
  const [done, setDone] = useState(isAppReady);
  const [delay] = useState(loopDelay);
  const rootRef = useRef(null);

  // Layout effect: initial animation states are applied before React's first
  // paint, so the hand-off from the static HTML preloader (index.html) is seamless.
  useLayoutEffect(() => {
    if (done) return undefined;
    const root = rootRef.current;
    const q = (selector) => root.querySelector(selector);
    const cols = [...root.querySelectorAll(".preloader__col")];
    const strips = cols.map((col) => col.querySelector(".preloader__strip"));
    const fill = q(".preloader__fill");
    const html = document.documentElement;
    html.classList.add("is-locked");

    const ctx = gsap.context(() => {}, root);
    let finished = false;
    let complete = () => {}; // run the counter out to 100, then exit (set below)

    const exit = () => {
      if (finished) return;
      finished = true;

      ctx.add(() => {
        const tl = gsap.timeline({
          onComplete: () => {
            html.classList.remove("is-locked");
            setDone(true);
          },
        });

        if (prefersReducedMotion()) {
          tl.add(setAppReady).to(root, { autoAlpha: 0, duration: 0.4 });
          return;
        }

        // The lift itself is a Web Animation (compositor): setAppReady() kicks
        // off the hero / 3D intro, whose first frames can block the main
        // thread — a GSAP tween would stall the curtain halfway up.
        const panel = q(".preloader__panel");
        const lift = () =>
          panel.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], { ...LIFT, fill: "forwards" });

        tl.to(".preloader__mask > *", { yPercent: -110, duration: 0.6, ease: "power3.in", stagger: 0.04 })
          .to(".preloader__bar", { scaleX: 0, transformOrigin: "100% 50%", duration: 0.5, ease: "power3.in" }, "<")
          .add(lift, "-=0.05")
          .add(setAppReady, "<") // hero intro starts while the curtain lifts
          .to(".preloader__curve path", { attr: { d: CURVE_BULGE }, duration: 0.55, ease: "power2.in" }, "<")
          .to(".preloader__curve path", { attr: { d: CURVE_FLAT }, duration: 0.6, ease: "power2.out" })
          .to({}, { duration: LIFT.duration / 1000 }, "<-0.55"); // the timeline ends with the lift
      });
    };

    ctx.add(() => {
      const start = performance.now();
      const progress = { value: 0 };
      let target = 0.12;
      let completed = 0;
      const tasks = loadTasks();

      const render = () => {
        const value = Math.min(100, progress.value);
        const digits = odometer(settle(value));
        let leading = true; // no leading zeros: 0 → 10 → 100
        digits.forEach((d, c) => {
          leading = leading && d === 0 && c < COLUMNS - 1;
          cols[c].classList.toggle("is-off", leading);
          strips[c].style.transform = `translateY(${(-d).toFixed(3)}em)`;
        });
        fill.style.transform = `scaleX(${value / 100})`;
      };

      const advance = () => {
        gsap.to(progress, {
          value: Math.round(target * 100), // always come to rest on a whole number
          duration: target >= 1 ? 0.9 : 1.2,
          ease: "power2.out",
          overwrite: true,
          onUpdate: render,
          onComplete: () => {
            if (target < 1) return;
            const elapsed = (performance.now() - start) / 1000;
            gsap.delayedCall(Math.max(0, MIN_DURATION - elapsed), exit);
          },
        });
      };
      // Failsafe: never cut away mid-count — roll on to 100%, then exit.
      complete = () => {
        if (finished || target >= 1) return;
        target = 1;
        advance();
      };

      tasks.forEach((task) =>
        Promise.resolve(task).finally(() => {
          completed += 1;
          target = Math.max(target, completed / tasks.length);
          advance();
        })
      );
      advance();

      // While waiting on a slow task, keep creeping forward (never past 90%)
      // so the counter never looks frozen.
      const trickle = () => {
        if (finished || target >= 1) return;
        if (target < 0.9) {
          target = Math.min(0.9, target + 0.02 + Math.random() * 0.03);
          advance();
        }
        gsap.delayedCall(0.45 + Math.random() * 0.3, trickle);
      };
      gsap.delayedCall(0.5, trickle);
      // (The cycling word is a CSS animation: see Preloader.css.)
    });

    const failsafe = window.setTimeout(() => complete(), FAILSAFE);

    return () => {
      window.clearTimeout(failsafe);
      ctx.revert();
      html.classList.remove("is-locked");
    };
  }, [done]);

  if (done) return null;

  return (
    <div
      className="preloader"
      ref={rootRef}
      role="status"
      aria-live="polite"
      aria-label="Loading portfolio"
      style={{ "--pre-delay": delay }}
    >
      <div className="preloader__panel">
        <div className="preloader__top">
          <span className="preloader__brand">
            {profile.initials}
            <sup>®</sup>
          </span>
          <span className="preloader__meta">
            {profile.role} — ©{new Date().getFullYear()}
          </span>
        </div>

        <div className="preloader__center" aria-hidden="true">
          <span className="preloader__mask">
            <span className="preloader__words">
              {WORDS.map((word) => (
                <span className="preloader__word" key={word}>
                  {word}
                </span>
              ))}
            </span>
          </span>
        </div>

        <div className="preloader__bottom">
          <span className="preloader__bar" aria-hidden="true">
            <span className="preloader__fill" />
          </span>
          <span className="preloader__mask">
            <span className="preloader__count">
              {Array.from({ length: COLUMNS }, (_, c) => (
                <span className={`preloader__col${c < COLUMNS - 1 ? " is-off" : ""}`} key={c}>
                  <span className="preloader__strip">
                    {STRIP.map((n, i) => (
                      <span key={i}>{n}</span>
                    ))}
                  </span>
                </span>
              ))}
              <span className="preloader__pct">%</span>
            </span>
          </span>
        </div>

        <svg className="preloader__curve" viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">
          <path d={CURVE_FLAT} />
        </svg>
      </div>
    </div>
  );
}
