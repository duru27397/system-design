# System Design Cheat Sheet & Web App Agent Guide

## Purpose

This repository is a fast, dependency-free interactive guide and revision application for System Design interviews, based on Hello Interview's complete curriculum (including all Premium-unlocked deep dives and architectures). It is designed to open instantly from local `file://` paths in any modern browser (Safari, Chrome, Firefox, Edge) without any build step, server, or runtime dependencies.

---

## Project Shape & Key Files

- `index.html`: Primary single-page entry point serving discrete page views (`.page-view`), 3-level tree navigation, topbar breadcrumbs, search, and mobile drawer backdrop.
- `system_design.html`: Direct alias of `index.html` for consistency with `dsa_revision.html`.
- `assets/css/system-design.css`: Modern dark theme matching LeetCode / IDE aesthetics, 3-level tree navigation, architecture card styling, code wraps, tables, and mobile responsive queries.
- `assets/js/system-design.js`: Tree node expansion/collapse, discrete page switching, URL hash routing (`#<page-id>?sub=<anchor-id>`), live search filtering, copy buttons with `file://` fallback, and mobile drawer controls.
- `assets/favicon.svg`: Distributed systems nodes SVG favicon.
- `in-a-hurry/`: 7 foundational guides (Delivery Framework, Core Concepts, etc.).
- `core-concepts/`: 9 foundational concept deep dives (Networking, Indexing, Sharding, CAP, etc.).
- `patterns/`: 7 system design patterns (Realtime updates, Contention, Scaling, etc.).
- `deep-dives/`: 14 technology deep dives (Kafka, Redis, Cassandra, Postgres, etc.).
- `problem-breakdowns/`: 32 end-to-end system design problem breakdowns (Yelp, Instagram, Uber, WhatsApp, etc.).
- `in-the-wild/`: 6 real-world production architectures (Shopify, Discord, Figma, etc.).

---

## Design System & UI Specifications

### 1. Color Palette & Theme Tokens
```css
--bg-main: #141414;        /* Page background */
--bg-surface: #1b1b1b;     /* Sidebar & topbar background */
--bg-card: #202020;        /* Architecture card & component background */
--bg-code: #181818;        /* Code & schema block background */
--border: #353535;         /* Primary borders */
--border-soft: #2a2a2a;    /* Subtle dividers & card borders */
--text: #eff1f6;           /* High-contrast primary text */
--muted: #9ea0a5;          /* Secondary labels & subtitle text */
--faint: #64748b;          /* Chevrons, leaf dots, icons */
--orange: #ffa116;         /* LeetCode accent / active brand color */
--easy: #00b8a3;           /* Success / copied state / functional requirements */
--cyan: #2dd4bf;           /* Key highlights & architectural takeaways */
--blue: #38bdf8;           /* Non-functional requirements & network calls */
--pink: #f472b6;           /* Out of scope items & storage */
```

### 2. Topbar & Breadcrumbs
- Topbar (`.topbar`) is sticky at the top of the content area (`height: 56px`).
- Breadcrumbs dynamically reflect the active Category and Subcategory/Page:
  ```html
  <div class="breadcrumb">
    <span id="current-topic">
      <span class="breadcrumb-category">Problem Breakdowns</span>
      <span class="breadcrumb-divider" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </span>
      <span class="breadcrumb-page">Yelp</span>
    </span>
  </div>
  ```

### 3. Sidebar 3-Level Hierarchy
1. **Level 1 (Category)**:
   - Structure: `.tree-node.l1-node` > `.tree-header.l1-header` > `.tree-toggle` + `.nav-item.l1-link`
   - Categories: `🚀 System Design in a Hurry`, `🧱 Core Concepts`, `📐 System Design Patterns`, `🔍 Technology Deep Dives`, `💡 Problem Breakdowns`, `🌍 Real-World Architecture`.
2. **Level 2 (Topic / Problem)**:
   - Structure: `.tree-node.l2-node` > `.tree-header.l2-header` > `.tree-toggle` + `.nav-item.l2-link`
   - Content: Topic name (e.g. "Yelp", "Instagram", "Sharding", "Kafka").
3. **Level 3 (Section / Sub-Anchor)**:
   - Structure: `.tree-children.l3-children` > `.nav-item.l3-link`
   - Content: Leaf dot (`•`) + section name (e.g. "Functional Requirements", "High-Level Design", "Potential Deep Dives").
   - Attribute: `data-target-sub="<section-id>"` scrolls to and briefly highlights the target section.

### 4. Interactive Features
- **Live Search**: Type into the sidebar search bar (or press `/`) to instantly filter across all 75 topics and subtopics.
- **Copy Code**: Every architecture snippet, API schema, and code snippet features a copy button with automatic clipboard copy and `file://` fallback.
- **Hash Routing**: Shareable URL hashes such as `index.html#problem-breakdowns-yelp` or `index.html#problem-breakdowns-yelp?sub=yelp-potential-deep-dives`.
- **Mobile Responsive Drawer**: On screens $\le 860\text{px}$, the sidebar slides off-canvas and opens with the `☰ Topics` button and a blurred backdrop.

---

## How to Add New Content
1. Place new markdown documents into the corresponding category folder (`in-a-hurry/`, `core-concepts/`, `patterns/`, `deep-dives/`, `problem-breakdowns/`, `in-the-wild/`).
2. Run `PYTHONPATH=/Users/ganesan/Library/Python/3.9/lib/python/site-packages python3 scratch/generate_app.py` to regenerate `index.html` and `system_design.html`.
