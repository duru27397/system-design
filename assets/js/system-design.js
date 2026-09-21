(() => {
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("mobile-toggle");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const currentTopic = document.getElementById("current-topic");
  const searchInput = document.getElementById("sidebar-search");
  const pages = [...document.querySelectorAll(".page-view")];
  const navItems = [...document.querySelectorAll(".nav-item")];

  // Mobile sidebar drawer
  const closeSidebar = () => {
    sidebar?.classList.remove("open");
    sidebarBackdrop?.classList.remove("active");
    menuButton?.setAttribute("aria-expanded", "false");
  };

  const openSidebar = () => {
    sidebar?.classList.add("open");
    sidebarBackdrop?.classList.add("active");
    menuButton?.setAttribute("aria-expanded", "true");
  };

  const toggleSidebar = () => {
    if (sidebar?.classList.contains("open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  };

  // Page switcher
  const showPage = (rawTargetId, updateUrl = true, subTargetId = null) => {
    let targetId = rawTargetId;
    let targetPage = document.getElementById(targetId);

    // Fallback if targetPage doesn't exist
    if (!targetPage || !targetPage.classList.contains("page-view")) {
      targetId = "in-a-hurry-introduction";
      targetPage = document.getElementById(targetId);
    }

    // Hide all pages, show target page
    pages.forEach((page) => {
      const isActive = page.id === targetId;
      page.classList.toggle("active", isActive);
      page.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    // Reset window scroll to top
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    // Update breadcrumb in topbar
    if (currentTopic && targetPage) {
      const topicTitle = targetPage.dataset.topicTitle || "System Design";
      const pageTitle = targetPage.dataset.pageTitle || "";
      if (pageTitle) {
        currentTopic.innerHTML = `
          <span class="breadcrumb-category">${topicTitle}</span>
          <span class="breadcrumb-divider" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </span>
          <span class="breadcrumb-page">${pageTitle}</span>
        `;
      } else {
        currentTopic.innerHTML = `<span class="breadcrumb-category">${topicTitle}</span>`;
      }
    }

    // Update active state in sidebar nav items
    navItems.forEach((item) => {
      const href = item.getAttribute("href");
      const targetSub = item.dataset.targetSub;
      const isActive = (href === `#${targetId}` && (!subTargetId || targetSub === subTargetId)) ||
                       (!subTargetId && href === `#${targetId}`);

      item.classList.toggle("active", isActive);
      item.setAttribute("aria-current", isActive ? "page" : "false");

      // If active, ensure all ancestor tree nodes are expanded
      if (isActive) {
        let parentNode = item.closest(".tree-node");
        while (parentNode) {
          parentNode.classList.add("expanded");
          parentNode = parentNode.parentElement?.closest(".tree-node");
        }
      }
    });

    // Handle subTargetId highlighting within page if specified
    if (subTargetId) {
      const subElem = document.getElementById(subTargetId);
      if (subElem) {
        document.querySelectorAll(".highlighted").forEach((c) => c.classList.remove("highlighted"));
        subElem.classList.add("highlighted");
        subElem.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => {
          subElem.classList.remove("highlighted");
        }, 2500);
      }
    }

    if (updateUrl) {
      const newHash = subTargetId ? `#${targetId}?sub=${subTargetId}` : `#${targetId}`;
      history.replaceState(null, "", newHash);
    }

    closeSidebar();
  };

  // Toggle tree node expansion
  document.querySelectorAll(".tree-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const node = btn.closest(".tree-node");
      if (node) {
        node.classList.toggle("expanded");
      }
    });
  });

  // Nav item click handler
  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      const href = item.getAttribute("href");
      if (!href || !href.startsWith("#")) return;
      e.preventDefault();
      const targetId = href.slice(1);
      const subTargetId = item.dataset.targetSub || null;
      showPage(targetId, true, subTargetId);
    });
  });

  // Mobile menu toggle & backdrop dismissal
  menuButton?.addEventListener("click", toggleSidebar);
  sidebarBackdrop?.addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sidebar?.classList.contains("open")) {
        closeSidebar();
      }
      if (searchInput && document.activeElement === searchInput) {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input"));
        searchInput.blur();
      }
    }
    // '/' to focus search
    if (e.key === "/" && document.activeElement !== searchInput && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  // Search filter across sidebar navigation
  searchInput?.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    const l1Nodes = document.querySelectorAll(".l1-node");

    if (!query) {
      // Reset visibility
      document.querySelectorAll(".tree-node").forEach((node) => {
        node.style.display = "";
      });
      // Collapse Level 3 by default, keep Level 1 expanded
      return;
    }

    l1Nodes.forEach((l1) => {
      let l1Match = false;
      const l2Nodes = l1.querySelectorAll(".l2-node");

      l2Nodes.forEach((l2) => {
        const l2Text = l2.querySelector(".l2-link")?.textContent.toLowerCase() || "";
        const l3Links = l2.querySelectorAll(".l3-link");
        let l2Match = l2Text.includes(query);

        l3Links.forEach((l3) => {
          const l3Text = l3.textContent.toLowerCase();
          const l3Match = l3Text.includes(query);
          l3.style.display = l3Match || l2Match ? "" : "none";
          if (l3Match) l2Match = true;
        });

        l2.style.display = l2Match ? "" : "none";
        if (l2Match) {
          l1Match = true;
          l2.classList.add("expanded");
        }
      });

      l1.style.display = l1Match ? "" : "none";
      if (l1Match) {
        l1.classList.add("expanded");
      }
    });
  });

  // Copy button logic (preserves file:// fallback)
  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  };

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".copy-button");
    if (!btn) return;
    const codeId = btn.dataset.code;
    const targetCode = codeId ? document.getElementById(codeId) : btn.closest(".code-wrap")?.querySelector("pre code, pre");
    if (!targetCode) return;

    await copyText(targetCode.innerText.trim());
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span>✓</span> Copied`;
    btn.classList.add("copied");
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove("copied");
    }, 2000);
  });

  // Hash-based initialization
  const initFromHash = () => {
    const hash = window.location.hash.slice(1);
    if (!hash) {
      showPage("in-a-hurry-introduction", false);
      return;
    }

    const [pageId, queryPart] = hash.split("?");
    let subId = null;
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      subId = params.get("sub");
    }
    showPage(pageId, false, subId);
  };

  window.addEventListener("hashchange", initFromHash);
  initFromHash();
})();
