// ---------------------------------------------------------------------------
// All editable portfolio content lives here.
// ---------------------------------------------------------------------------

import shivLogo from "../assets/logos/shiv-technolabs.webp";
import savitriyaLogo from "../assets/logos/savitriya.jpg";

export const profile = {
  name: "Naumaan Kalyani",
  initials: "nk",
  role: "Full Stack Developer",
  city: "Ahmedabad",
  coords: [23.0225, 72.5714], // [latitude, longitude] — the contact globe's "home" pin
  email: "naumaankalyani08@gmail.com",
  site: "portfolio-nk08.pages.dev", // shown in the laptop intro's address bar
  available: true,
  tagline:
    "I build production web apps end to end — from Figma designs and React or Vue front-ends to Laravel and FastAPI back-ends.",
};

// Cities the contact globe draws arcs to from profile.coords. Decorative
// ("open to work worldwide") — swap in places that mean something to you.
export const reach = [
  { label: "London", coords: [51.5072, -0.1276] },
  { label: "New York", coords: [40.7128, -74.006] },
  { label: "Dubai", coords: [25.2048, 55.2708] },
  { label: "Singapore", coords: [1.3521, 103.8198] },
  { label: "Sydney", coords: [-33.8688, 151.2093] },
];

export const socials = [
  { label: "LinkedIn", href: "https://linkedin.com/in/naumaan-kalyani-245983266" },
  { label: "GitHub", href: "https://github.com/naumaan-kalyani08" },
];

export const navItems = [
  { href: "#home", label: "Home" },
  { href: "#about", label: "About" },
  { href: "#work", label: "Work" },
  { href: "#experience", label: "Journey" },
  { href: "#skills", label: "Skills" },
  { href: "#contact", label: "Contact" },
];

// Segments: `hl: true` words get highlighted during the scroll reveal.
export const aboutText = [
  { text: "I'm a " },
  { text: "full stack developer", hl: true },
  { text: " who started as a " },
  { text: "web designer", hl: true },
  { text: " — so I take features from " },
  { text: "Figma", hl: true },
  { text: " to " },
  { text: "database", hl: true },
  { text: ", shipping production apps for clients in content, accounting, supply chain, events and " },
  { text: "travel.", hl: true },
];

export const aboutImages = [
  { src: "./Images/flat-creativity-concept-illustration.webp", alt: "Creative concept illustration" },
  { src: "./Images/image2.webp", alt: "Workspace snapshot" },
  { src: "./Images/image3.webp", alt: "Design exploration" },
  { src: "./Images/image4.webp", alt: "Project detail" },
];

export const stats = [
  { value: 3, suffix: "+", label: "Years building for the web" },
  { value: 5, suffix: "", label: "Client platforms shipped" },
  { value: 18, suffix: " mo", label: "From Frontend to Full Stack" },
  { value: 100, suffix: "%", label: "Responsive by default" },
];

export const marqueeItems = ["React", "Vue.js", "Laravel", "FastAPI", "Tailwind CSS", "PHP", "Python", "PostgreSQL", "Figma"];

// Rotating line under the hero title.
export const heroRoles = ["full stack web apps", "React & Vue front-ends", "Laravel & FastAPI back-ends", "RESTful APIs", "Figma-to-code UIs"];

// Kinetic intro strip: words, with an image "pill" after each one (except the last).
export const processWords = [
  { word: "Think.", image: "./Images/image3.webp" },
  { word: "Design.", image: "./Images/image4.webp" },
  { word: "Build.", image: "./Images/image5.webp" },
  { word: "Ship." },
];

export const services = [
  {
    title: "Front-end Development",
    text: "Responsive, cross-device interfaces and single-page apps in React.js and Vue.js, styled with Tailwind CSS or Bootstrap.",
    tags: ["React", "Vue.js", "Tailwind CSS", "SPA"],
    image: "./Images/image2.webp",
  },
  {
    title: "Back-end & APIs",
    text: "RESTful APIs, user authentication and well-designed databases in Laravel (PHP) and FastAPI (Python).",
    tags: ["Laravel", "FastAPI", "PostgreSQL", "MySQL"],
    image: "./Images/image3.webp",
  },
  {
    title: "UI/UX Design",
    text: "Wireframes and UI designs in Figma and Photoshop, turned into reusable, component-based front-ends.",
    tags: ["Figma", "Photoshop", "Wireframing", "Components"],
    image: "./Images/image4.webp",
  },
  {
    title: "End-to-end Delivery",
    text: "Client requirements tracked in Jira through to tested, version-controlled releases with Git, Postman and Docker.",
    tags: ["Jira", "Git", "Postman", "Docker"],
    image: "./Images/image5.webp",
  },
];

// Client projects (no public links). `year` values are estimates — adjust if needed.
export const projects = [
  {
    slug: "gsa-connect",
    title: "GSA Connect",
    category: "Full stack · Client: Adani",
    year: "2025",
    image: "./Images/image2.webp",
    tags: ["React", "FastAPI", "PostgreSQL", "Bootstrap"],
    role: "Full stack developer",
    description:
      "A scalable content management system for Adani for uploading, managing and viewing articles and videos.",
    highlights: [
      "User authentication and content categorisation",
      "Responsive UI for cross-device access",
      "Performance optimised for growing user engagement",
    ],
  },
  {
    slug: "accounting-with-ai",
    title: "Accounting With AI",
    category: "Full stack · Fintech",
    year: "2025",
    image: "./Images/image4.webp",
    tags: ["React", "Laravel", "MySQL", "Bootstrap"],
    role: "Full stack developer",
    description:
      "An accounting platform for individuals and small businesses, built with data security and standard accounting practices as core requirements.",
    highlights: ["Bookkeeping and account reconciliation", "Invoice generation", "Financial reporting modules"],
  },
  {
    slug: "parts-consignment",
    title: "Parts Consignment",
    category: "Full stack · Supply chain",
    year: "2024",
    image: "./Images/image5.webp",
    tags: ["React", "Laravel", "MySQL", "Bootstrap"],
    role: "Developer",
    description:
      "A centralised supply chain platform for parts consignment and distribution, with real-time inventory tracking and order processing.",
    highlights: ["Real-time inventory tracking", "Vendor management and salesperson tracking", "Reporting modules"],
  },
  {
    slug: "family-fun-events",
    title: "Family Fun Events",
    category: "Full stack · Event management",
    year: "2025",
    image: "./Images/image3.webp",
    tags: ["React", "FastAPI", "PostgreSQL", "Tailwind CSS"],
    role: "Full stack developer",
    description:
      "An event management app where clients book events, manage guest lists and coordinate venues, catering and activities — streamlining the organiser's internal workflows.",
    highlights: ["Event booking", "Guest list management", "Venue, catering and activity coordination"],
  },
  {
    slug: "planiteasy",
    title: "Planiteasy",
    category: "Full stack · Travel",
    year: "2025",
    image: "./Images/flat-creativity-concept-illustration.webp",
    tags: ["Vue.js", "Laravel", "MySQL", "Bootstrap"],
    role: "Full stack developer",
    description:
      "A travel business platform that lets travel agencies, tour operators, concierge services and destination management companies run their operations from one place.",
    highlights: ["Built for agencies and tour operators", "Concierge and DMC workflows", "One place for daily operations"],
  },
];

export const experience = [
  {
    year: "2023",
    title: "Bachelor of Computer Applications",
    place: "Gujarat University",
    text: "Graduated with a BCA — the foundation in programming, databases and software design behind everything since.",
  },
  {
    year: "2023",
    title: "Web Designer",
    place: "Shiv Technolabs",
    logo: shivLogo,
    period: "Jun 2023 – Dec 2023",
    location: "Ahmedabad, Gujarat, India",
    text: "Designed website layouts and UI mockups in Figma and Photoshop, then built the approved designs into responsive pages with HTML5, CSS3 and JavaScript.",
  },
  {
    year: "2023",
    title: "Frontend Developer",
    place: "Savitriya Technologies",
    logo: savitriyaLogo,
    period: "Dec 2023 – May 2025",
    location: "Ahmedabad, Gujarat, India",
    text: "Turned Figma designs into reusable, component-based React.js front-ends with Tailwind CSS and Bootstrap, integrated with RESTful APIs.",
  },
  {
    year: "2025",
    title: "Full Stack Developer",
    place: "Savitriya Technologies",
    logo: savitriyaLogo,
    period: "Jun 2025 – Present",
    location: "Ahmedabad, Gujarat, India",
    text: "Promoted within 18 months. Delivering client apps end to end — React and Vue front-ends, Laravel and FastAPI back-ends, including an enterprise content platform for Adani.",
  },
];

// Skills render as a periodic table: each group is a column, each tool an
// "element" with a two-letter symbol. `since` values are estimates.
//   level: 3 = daily driver · 2 = confident · 1 = exploring
//   tag:   project tag to match when it differs from the name ("Used in")
//   everywhere: true → shown as used across every project
export const skillLevels = {
  3: "Daily driver",
  2: "Confident",
  1: "Exploring",
};

export const skillGroups = [
  {
    id: "frontend",
    title: "Front-end",
    rgb: "99 102 241",
    text: "Responsive, cross-device interfaces.",
    items: [
      { symbol: "Ht", name: "HTML5", since: 2021, level: 3, everywhere: true, note: "Semantic, accessible markup — the foundation every interface stands on." },
      { symbol: "Cs", name: "CSS3", since: 2021, level: 3, everywhere: true, note: "Responsive layouts and cross-browser styling, responsive by default." },
      { symbol: "Js", name: "JavaScript", since: 2021, level: 3, everywhere: true, note: "Modern ES6+ JavaScript, with or without a framework." },
      { symbol: "Re", name: "React", since: 2023, level: 3, note: "Component-based SPAs — and this very portfolio is built with it." },
      { symbol: "Vu", name: "Vue.js", since: 2024, level: 2, note: "Single-page front-ends, like the Planiteasy travel platform." },
      { symbol: "Tw", name: "Tailwind CSS", since: 2023, level: 3, note: "Utility-first styling that keeps UIs consistent across pages and devices." },
      { symbol: "Bs", name: "Bootstrap", since: 2023, level: 3, note: "Fast, responsive layouts for client dashboards and admin panels." },
    ],
  },
  {
    id: "backend",
    title: "Back-end",
    rgb: "6 182 212",
    text: "RESTful APIs and the logic behind them.",
    items: [
      { symbol: "Ph", name: "PHP", since: 2023, level: 3, note: "Clean, modern PHP that is easy to read and maintain." },
      { symbol: "Lv", name: "Laravel", since: 2024, level: 3, note: "MVC apps, authentication and RESTful APIs shipped to production." },
      { symbol: "Py", name: "Python", since: 2024, level: 2, note: "The language behind my FastAPI services." },
      { symbol: "Fa", name: "FastAPI", since: 2024, level: 3, note: "Fast, typed Python APIs — like the one behind GSA Connect for Adani." },
      { symbol: "Ap", name: "REST APIs", tag: "REST", since: 2023, level: 3, note: "Predictable endpoints with user authentication, tested in Postman." },
      { symbol: "Jv", name: "Java", tag: "Spring Boot", since: 2025, level: 1, note: "Working knowledge of Java and Spring Boot." },
    ],
  },
  {
    id: "data",
    title: "Data & tools",
    rgb: "139 92 246",
    text: "Databases and the workflow around them.",
    items: [
      { symbol: "My", name: "MySQL", since: 2023, level: 3, note: "Well-designed schemas for accounting and supply chain platforms." },
      { symbol: "Pg", name: "PostgreSQL", since: 2024, level: 3, note: "Relational data for content and event management apps." },
      { symbol: "Mg", name: "MongoDB", since: 2024, level: 1, note: "Document storage where a flexible schema fits." },
      { symbol: "Gt", name: "Git", since: 2023, level: 3, everywhere: true, note: "Version control with Git and GitHub on every project." },
      { symbol: "Pm", name: "Postman", since: 2023, level: 3, note: "Testing and documenting APIs before the front-end touches them." },
      { symbol: "Dk", name: "Docker", since: 2024, level: 2, note: "Reproducible development environments." },
      { symbol: "Ji", name: "Jira", since: 2023, level: 2, note: "Turning client requirements into tracked, deliverable features." },
    ],
  },
  {
    id: "design",
    title: "Design",
    rgb: "236 72 153",
    text: "Where every feature starts.",
    items: [
      { symbol: "Fg", name: "Figma", since: 2023, level: 3, note: "UI/UX design and handoff — and turning design files into faithful builds." },
      { symbol: "Ps", name: "Photoshop", since: 2023, level: 2, note: "Website layouts and UI mockups for client sites." },
      { symbol: "Wf", name: "Wireframing", since: 2023, level: 2, note: "Low-fidelity flows that settle structure before visuals." },
      { symbol: "Ui", name: "UI Design", since: 2023, level: 3, note: "Clean, consistent interfaces — where my career started." },
    ],
  },
];

// Second marquee tape: every skill that isn't already on the first one.
export const marqueeItemsAlt = skillGroups
  .flatMap((group) => group.items.map((item) => item.name))
  .filter((name) => !marqueeItems.includes(name));
