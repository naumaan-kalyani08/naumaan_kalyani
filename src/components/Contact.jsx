import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { profile, socials } from "../data/content";
import { isFinePointer, prefersReducedMotion, scrollToTarget } from "../lib/scroll";
import RevealHeading from "./RevealHeading";
import ContactForm from "./ContactForm";
import Globe from "./Globe";
import "../style/Contact.css";

function MagneticButton({ href, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!isFinePointer() || prefersReducedMotion()) return undefined;

    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "power3" });

    const onMove = (event) => {
      const rect = el.getBoundingClientRect();
      xTo((event.clientX - (rect.left + rect.width / 2)) * 0.35);
      yTo((event.clientY - (rect.top + rect.height / 2)) * 0.35);
    };
    const onLeave = () => {
      gsap.to(el, { x: 0, y: 0, duration: 1, ease: "elastic.out(1, 0.35)", overwrite: "auto" });
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <a ref={ref} className="magnetic" href={href}>
      <span className="magnetic__label">{children}</span>
    </a>
  );
}

const getTime = () =>
  new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

function GlobeHint({ globeApi, dragged }) {
  const [touch] = useState(() => !isFinePointer());
  const text = dragged
    ? "Double-click it to find me"
    : touch
      ? "Swipe the globe sideways"
      : "Drag the globe to spin it";

  return (
    <button
      type="button"
      className={`globe-hint ${dragged ? "is-done" : ""}`}
      onClick={() => globeApi.current?.spin()}
      aria-label="Spin the globe"
    >
      <span className="globe-hint__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />
        </svg>
      </span>
      <span className="globe-hint__text" key={text}>
        {text}
      </span>
    </button>
  );
}

export default function Contact() {
  const globeApi = useRef(null);
  const [dragged, setDragged] = useState(false);
  const toastRef = useRef(null);
  const [time, setTime] = useState(getTime);
  const [toast, setToast] = useState("");

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(profile.email);
      setToast("Email copied to clipboard ✓");
    } catch {
      setToast(profile.email);
    }
    const el = toastRef.current;
    gsap.killTweensOf(el);
    gsap
      .timeline()
      .fromTo(el, { yPercent: 120, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.5, ease: "back.out(1.8)" })
      .to(el, { yPercent: 120, autoAlpha: 0, duration: 0.4, ease: "power2.in" }, "+=1.8");
  };

  useEffect(() => {
    const id = window.setInterval(() => setTime(getTime()), 30000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section id="contact" className="contact">
      <Globe background className="contact__globe" apiRef={globeApi} onFirstDrag={() => setDragged(true)} />

      <div className="contact__inner">
        <p className="eyebrow" data-reveal>
          06 — Contact
        </p>
        <RevealHeading className="contact__title" gradientWords={["together."]}>
          Let&apos;s build something great together.
        </RevealHeading>

        <div className="contact__cta" data-reveal>
          <MagneticButton href={`mailto:${profile.email}`}>Say hello ↗</MagneticButton>
          <button type="button" className="contact__copy" onClick={copyEmail} data-magnetic="0.2">
            <span className="contact__copy-icon" aria-hidden="true">
              ⧉
            </span>
            Copy email
          </button>
          <GlobeHint globeApi={globeApi} dragged={dragged} />
        </div>

        <div className="contact__grid">
          <div className="contact__col" data-reveal>
            <span className="contact__label">Email</span>
            <a href={`mailto:${profile.email}`}>{profile.email}</a>
          </div>
          <div className="contact__col" data-reveal>
            <span className="contact__label">Socials</span>
            <div className="contact__links">
              {socials.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer noopener">
                  {link.label}
                </a>
              ))}
            </div>
          </div>
          <div className="contact__col" data-reveal>
            <span className="contact__label">Local time</span>
            <span>
              {profile.city} · {time}
            </span>
          </div>
        </div>

        <ContactForm />
      </div>

      <div className="toast" ref={toastRef} role="status" aria-live="polite">
        {toast}
      </div>

      <footer className="site-footer">
        <span>
          © {new Date().getFullYear()} {profile.name}
        </span>
        <span className="site-footer__built">Built with React, GSAP & Three.js</span>
        <button type="button" className="site-footer__top" onClick={() => scrollToTarget("#home", { duration: 2 })}>
          Back to top ↑
        </button>
      </footer>
    </section>
  );
}
