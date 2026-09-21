# System Design Cheat Sheet

A compact, dependency-free interactive revision cheat sheet for System Design featuring a 3-level hierarchical navigation tree (Category $\to$ Topic $\to$ Sub-Section/Deep Dive), LeetCode Monaco editor syntax highlighting, and discrete non-scrolling page views across five core domains:

1. **Core Concepts** (9 topics: Networking essentials, API design, data modeling, database indexing, caching, sharding, consistent hashing, CAP theorem, numbers to know)
2. **System Design Patterns** (7 topics: Realtime updates, dealing with contention, multi-step processes, scaling reads/writes, large blobs, long-running tasks)
3. **Technology Deep Dives** (14 topics: Kafka, Redis, Cassandra, DynamoDB, Postgres, Elasticsearch, Flink, ZooKeeper, Vector DBs, Time-series DBs, CDC)
4. **Problem Breakdowns** (32 end-to-end architectures: Yelp, Instagram, Uber, WhatsApp, LeetCode, YouTube, Ticketmaster, Distributed Cache, Rate Limiter, etc.)
5. **Real-World Architecture** (6 production case studies: Shopify, Discord, Slack, Figma, Spotify, Meta)

---

## Structure

```text
.
├── AGENTS.md                  # Comprehensive design system & agent working rules
├── README.md                  # Overview & guide
├── system_design.html         # Primary single-page entry point with pre-rendered page views
└── assets/
    ├── favicon.svg            # Distributed systems nodes SVG favicon
    ├── css/
    │   └── system-design.css  # Dark LeetCode-style theme, responsive layout & 3-level tree styles
    └── js/
        └── system-design.js   # Tree navigation, page switching, search filter, copy logic & drawer controls
```

---

## Navigation Hierarchy (A $\to$ B $\to$ C)

The sidebar is organized into a clean 3-level taxonomy:

- **Level 1 (Category - A)**: Core Concepts, System Design Patterns, Technology Deep Dives, Problem Breakdowns, Real-World Architecture
- **Level 2 (Topic / Problem - B)**: Specific problem or concept (e.g. Yelp, Instagram, Distributed Cache, Sharding, Kafka)
- **Level 3 (Sub-Section / Deep Dive - C)**: Specific section anchors (e.g. Functional Requirements, Core Entities, API Design, High-Level Architecture, Potential Deep Dives, Final Design)

---

## Key Features

- **100% Offline & `file://` Compatible**: Zero server, zero build step, and no package manager required. Opens instantly in any modern browser (Safari, Chrome, Firefox, Edge).
- **Space-Optimized Architecture Cards**: Clean cards with embedded SVG/WebP architecture diagrams, schemas, and API definitions.
- **Code & Schema Copy Buttons**: One-click copy with automatic fallback support for `file://` environments.
- **Mobile Responsive Drawer**: Off-canvas drawer with smooth slide-in, blurred backdrop overlay, and keyboard accessibility (`Escape`).
- **Shareable Hash Routing**: Direct URL deep links support both page views and sub-technique anchors (e.g. `system_design.html#problem-breakdowns-yelp?sub=yelp-potential-deep-dives`).

---

## Open it

Open [system_design.html](system_design.html) directly in any web browser:

```bash
open system_design.html
```
