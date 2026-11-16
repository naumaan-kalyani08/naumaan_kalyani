import {
  siCss,
  siDocker,
  siFigma,
  siGit,
  siGreensock,
  siHtml5,
  siJavascript,
  siJira,
  siLaravel,
  siMysql,
  siPhp,
  siReact,
  siThreedotjs,
  siVite,
} from "simple-icons";

/*
 * Logos for the skills table. Brand marks come from simple-icons (official
 * SVG paths, 24×24, filled). Concepts without a brand (REST, prototyping,
 * design systems, motion) get simple stroked glyphs tinted with the group
 * colour. Brand colours too dark to read on the dark tiles fall back to the
 * text colour (`tone: "ink"`); dim ones are brightened (`tone: "lift"`).
 */
const brand = (icon, tone) => ({ type: "brand", path: icon.path, color: `#${icon.hex}`, title: icon.title, tone });

const ICONS = {
  HTML: brand(siHtml5),
  CSS: brand(siCss, "ink"),
  JavaScript: brand(siJavascript),
  React: brand(siReact),
  GSAP: brand(siGreensock),
  "Three.js": brand(siThreedotjs, "ink"),
  PHP: brand(siPhp, "lift"),
  Laravel: brand(siLaravel),
  MySQL: brand(siMysql, "lift"),
  Git: brand(siGit),
  Docker: brand(siDocker),
  Vite: brand(siVite),
  Jira: brand(siJira),
  Figma: brand(siFigma),
  // Concepts — stroked glyphs.
  "REST APIs": { type: "glyph", path: "M8 3.5C6 3.5 5 4.5 5 6.5v2.6c0 1.6-.8 2.4-2 2.9 1.2.5 2 1.3 2 2.9v2.6c0 2 1 3 3 3M16 3.5c2 0 3 1 3 3v2.6c0 1.6.8 2.4 2 2.9-1.2.5-2 1.3-2 2.9v2.6c0 2-1 3-3 3M10 12h.01M14 12h.01" },
  Prototyping: { type: "glyph", path: "M3.5 3.5h7v7h-7zM13.5 13.5h7v7h-7zM10.5 7h3.5a3 3 0 0 1 3 3v3.5" },
  "Design systems": { type: "glyph", path: "M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM20.5 17a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" },
  Motion: { type: "glyph", path: "M3 20C10 20 11 4 21 4M3 20h.01M21 4h.01M3 4h4M17 20h4" },
};

export function SkillIcon({ name, className = "" }) {
  const icon = ICONS[name];
  if (!icon) return null;
  const isBrand = icon.type === "brand";
  return (
    <svg
      className={`skill-icon ${isBrand ? "skill-icon--brand" : "skill-icon--glyph"} ${icon.tone ? `skill-icon--${icon.tone}` : ""} ${className}`}
      viewBox="0 0 24 24"
      style={isBrand ? { "--brand": icon.color } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {isBrand ? (
        <path d={icon.path} />
      ) : (
        <path d={icon.path} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
