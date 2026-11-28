import {
  siBootstrap,
  siCss,
  siDocker,
  siFastapi,
  siFigma,
  siGit,
  siHtml5,
  siJavascript,
  siJira,
  siLaravel,
  siMongodb,
  siMysql,
  siPhp,
  siPostgresql,
  siPostman,
  siPython,
  siReact,
  siTailwindcss,
  siVuedotjs,
} from "./brandIcons";

/*
 * Logos for the skills table, keyed by the skill name in content.js. Brand
 * marks are simple-icons paths (24×24, filled), copied into brandIcons.js by
 * scripts/gen-brand-icons.mjs so the 5 MB package never reaches the browser.
 * Skills without a usable brand mark (concepts, plus Java and Photoshop —
 * Oracle and Adobe had theirs pulled from simple-icons) get simple stroked glyphs tinted with the group
 * colour. Brand colours too dark to read on the dark tiles fall back to the
 * text colour (`tone: "ink"`); dim ones are brightened (`tone: "lift"`).
 */
const brand = (icon, tone) => ({ type: "brand", path: icon.path, color: `#${icon.hex}`, title: icon.title, tone });

const ICONS = {
  // Front-end
  HTML5: brand(siHtml5),
  CSS3: brand(siCss, "ink"),
  JavaScript: brand(siJavascript),
  React: brand(siReact),
  "Vue.js": brand(siVuedotjs),
  "Tailwind CSS": brand(siTailwindcss),
  Bootstrap: brand(siBootstrap, "lift"),
  // Back-end
  PHP: brand(siPhp, "lift"),
  Laravel: brand(siLaravel),
  Python: brand(siPython, "lift"),
  FastAPI: brand(siFastapi),
  // Data & tools
  MySQL: brand(siMysql, "lift"),
  PostgreSQL: brand(siPostgresql, "lift"),
  MongoDB: brand(siMongodb),
  Git: brand(siGit),
  Postman: brand(siPostman),
  Docker: brand(siDocker),
  Jira: brand(siJira),
  // Design
  Figma: brand(siFigma),
  // Stroked glyphs.
  Java: { type: "glyph", path: "M9.5 2.5c-1.2 1.3 1.2 2.2 0 3.8M13 2.5c-1.2 1.3 1.2 2.2 0 3.8M4.5 9.5h11v4.5a5.5 5.5 0 0 1-5.5 5.5 5.5 5.5 0 0 1-5.5-5.5zM15.5 11h1.25a2.25 2.25 0 0 1 0 4.5H15M3 21.5h15" },
  "REST APIs": { type: "glyph", path: "M8 3.5C6 3.5 5 4.5 5 6.5v2.6c0 1.6-.8 2.4-2 2.9 1.2.5 2 1.3 2 2.9v2.6c0 2 1 3 3 3M16 3.5c2 0 3 1 3 3v2.6c0 1.6.8 2.4 2 2.9-1.2.5-2 1.3-2 2.9v2.6c0 2-1 3-3 3M10 12h.01M14 12h.01" },
  Photoshop: { type: "glyph", path: "M6 3.5h12a2.5 2.5 0 0 1 2.5 2.5v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5zM7.5 16V8h2.3a2 2 0 0 1 0 4H7.5M16.6 11.1c-.4-.5-1-.7-1.6-.7-.8 0-1.4.4-1.4 1.1 0 1.5 3.1.9 3.1 2.6 0 .8-.7 1.3-1.6 1.3-.7 0-1.3-.3-1.7-.8" },
  Wireframing: { type: "glyph", path: "M3.5 3.5h7v7h-7zM13.5 13.5h7v7h-7zM10.5 7h3.5a3 3 0 0 1 3 3v3.5" },
  "UI Design": { type: "glyph", path: "M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM20.5 17a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" },
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
