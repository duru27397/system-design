(() => {
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("mobile-toggle");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const currentTopic = document.getElementById("current-topic");
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
      targetId = "core-concepts-networking-essentials";
      targetPage = document.getElementById(targetId);
    }

    // Hide all pages, show target page
    pages.forEach((page) => {
      const isActive = page.id === targetId;
      page.classList.toggle("active", isActive);
      page.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    // Reset window scroll to top unless subTargetId is being scrolled to
    if (!subTargetId) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }

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
      const isL3 = item.classList.contains("l3-link");

      let isActive = false;
      if (subTargetId) {
        if (isL3) {
          isActive = targetSub === subTargetId;
        } else {
          isActive = href === `#${targetId}`;
        }
      } else {
        if (!isL3) {
          isActive = href === `#${targetId}`;
        }
      }

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

    // Handle subTargetId highlighting within page with reflow delay
    if (subTargetId) {
      setTimeout(() => {
        const subElem = document.getElementById(subTargetId);
        if (subElem) {
          document.querySelectorAll(".highlighted").forEach((c) => c.classList.remove("highlighted"));
          subElem.classList.add("highlighted");
          subElem.scrollIntoView({ behavior: "smooth", block: "start" });
          setTimeout(() => {
            subElem.classList.remove("highlighted");
          }, 2500);
        }
      }, 50);
    }

    if (updateUrl) {
      const newHash = subTargetId ? `#${targetId}?sub=${subTargetId}` : `#${targetId}`;
      history.replaceState(null, "", newHash);
    }

    closeSidebar();
  };

  // Toggle tree node expansion on chevron click
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
      const treeNode = item.closest(".tree-node");

      // If clicking an L1 or L2 link, toggle or ensure expansion
      if (item.classList.contains("l1-link")) {
        treeNode?.classList.toggle("expanded");
      } else if (item.classList.contains("l2-link")) {
        if (item.classList.contains("active")) {
          treeNode?.classList.toggle("expanded");
        } else {
          treeNode?.classList.add("expanded");
        }
      }

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
    }
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
      showPage("core-concepts-networking-essentials", false);
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
