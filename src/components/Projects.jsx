import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import { projects } from "../data/content";
import { isFinePointer, prefersReducedMotion } from "../lib/scroll";
import ProjectCase from "./ProjectCase";
import RevealHeading from "./RevealHeading";
import "../style/Projects.css";

gsap.registerPlugin(Flip);

export default function Projects() {
  const sectionRef = useRef(null);
  const [openIndex, setOpenIndex] = useState(null);
  const openState = useRef(null); // Flip state of the clicked card's image
  const closing = useRef(null); // { state, slug } while flying back to the grid

  useGSAP(
    () => {
      if (prefersReducedMotion()) return undefined;

      gsap.utils.toArray(".project").forEach((card) => {
        const media = card.querySelector(".project__media, .project__panel");
        const img = card.querySelector(".project__img");

        // Clip-path wipe reveal as the card enters.
        gsap.fromTo(
          media,
          { clipPath: "inset(18% 8% 18% 8% round 24px)" },
          {
            clipPath: "inset(0% 0% 0% 0% round 20px)",
            ease: "power2.out",
            scrollTrigger: { trigger: card, start: "top 92%", end: "top 45%", scrub: 0.6 },
          }
        );

        // Inner image parallax.
        if (img) gsap.fromTo(
          img,
          { yPercent: -8, scale: 1.18 },
          {
            yPercent: 8,
            scale: 1.08,
            ease: "none",
            scrollTrigger: { trigger: card, start: "top bottom", end: "bottom top", scrub: true },
          }
        );
      });

      // 3D tilt on hover — desktop / fine pointers only.
      if (!isFinePointer()) return undefined;
      const cleanups = gsap.utils.toArray(".project__link").map((link) => {
        const rotX = gsap.quickTo(link, "rotationX", { duration: 0.6, ease: "power3" });
        const rotY = gsap.quickTo(link, "rotationY", { duration: 0.6, ease: "power3" });
        gsap.set(link, { transformPerspective: 900 });

        const onMove = (event) => {
          const rect = link.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width - 0.5;
          const py = (event.clientY - rect.top) / rect.height - 0.5;
          rotY(px * 8);
          rotX(-py * 8);
        };
        const onLeave = () => {
          rotX(0);
          rotY(0);
        };

        link.addEventListener("pointermove", onMove);
        link.addEventListener("pointerleave", onLeave);
        return () => {
          link.removeEventListener("pointermove", onMove);
          link.removeEventListener("pointerleave", onLeave);
        };
      });

      return () => cleanups.forEach((fn) => fn());
    },
    { scope: sectionRef }
  );

  // Fly the image back from the case study into its card.
  useLayoutEffect(() => {
    if (openIndex !== null || !closing.current) return;
    const { state, slug } = closing.current;
    closing.current = null;
    const target = sectionRef.current.querySelector(`.project__media[data-flip-id="${slug}"]`);
    if (!target) return;
    Flip.from(state, {
      targets: target,
      duration: 0.9,
      ease: "expo.inOut",
      absolute: true,
      zIndex: 60,
      onComplete: () => target.closest(".project__link")?.focus({ preventScroll: true }),
    });
  }, [openIndex]);

  const openCase = (event, index) => {
    event.preventDefault();
    const link = event.currentTarget;
    gsap.killTweensOf(link);
    gsap.set(link, { rotationX: 0, rotationY: 0 });
    const media = link.querySelector(".project__media");
    if (media && !prefersReducedMotion()) openState.current = Flip.getState(media);
    setOpenIndex(index);
  };

  const closeCase = (state) => {
    if (state) closing.current = { state, slug: projects[openIndex].slug };
    setOpenIndex(null);
  };

  return (
    <section id="work" className="section projects" ref={sectionRef}>
      <header className="section-head">
        <p className="eyebrow" data-reveal>
          03 — Selected work
        </p>
        <RevealHeading className="section-title" gradientWords={["projects"]}>
          Featured projects
        </RevealHeading>
      </header>

      <div className="projects__grid">
        {projects.map((project, index) => (
          <article
            className={`project ${project.image ? "" : "project--text"} ${openIndex === index ? "is-open" : ""}`}
            key={project.slug}
          >
            <a
              className="project__link"
              href={`#${project.slug}`}
              data-cursor="Open"
              aria-haspopup="dialog"
              onClick={(event) => openCase(event, index)}
            >
              {project.image ? (
                <ImageCard project={project} index={index} />
              ) : (
                <TextCard project={project} index={index} />
              )}
            </a>
          </article>
        ))}
      </div>

      {openIndex !== null && (
        <ProjectCase
          index={openIndex}
          flipState={openState}
          onClose={closeCase}
          onNext={() => setOpenIndex((openIndex + 1) % projects.length)}
        />
      )}
    </section>
  );
}

const pad = (n) => String(n).padStart(2, "0");

const Tags = ({ tags }) => (
  <ul className="project__tags" aria-label="Technologies">
    {tags.map((tag) => (
      <li key={tag}>{tag}</li>
    ))}
  </ul>
);

// Description-only card, used while a project has no `image`.
function TextCard({ project, index }) {
  return (
    <div className="project__panel">
      <div className="project__panel-top">
        <span className="project__num">{pad(index + 1)}</span>
        <span className="project__year">{project.year}</span>
      </div>
      <h3 className="project__title">{project.title}</h3>
      <p className="project__category">{project.category}</p>
      <p className="project__desc">{project.description}</p>
      <Tags tags={project.tags} />
      <span className="project__more">
        Case study <span aria-hidden="true">↗</span>
      </span>
    </div>
  );
}

function ImageCard({ project, index }) {
  return (
    <>
      <div className="project__media" data-flip-id={project.slug}>
        <img
          className="project__img"
          src={project.image}
          alt={`${project.title} preview`}
          width="1200"
          height="1200"
          loading="lazy"
          decoding="async"
        />
        <span className="project__num">{pad(index + 1)}</span>
        <span className="project__open" aria-hidden="true">
          Case study ↗
        </span>
      </div>
      <div className="project__info">
        <div>
          <h3 className="project__title">{project.title}</h3>
          <p className="project__category">{project.category}</p>
        </div>
        <span className="project__year">{project.year}</span>
      </div>
      <Tags tags={project.tags} />
    </>
  );
}
