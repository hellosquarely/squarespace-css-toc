!function () {
  class CssToc {
    constructor() {
      this.win = window.top;
      this.doc = this.win.document;
      this.targetPaths = ["/config/pages/custom-css", "/config/pages/custom-css-popup"];
      this.pollIntervalMs = 800;
      this.locationPollHandle = null;
      this.lastPathname = null;
      this.inserted = false;

      // DOM refs
      this.cmRootEl = null;
      this.cm = null;
      this.containerEl = null;
      this.sidebarEl = null;
      this.toggleBtn = null;
      this.listEl = null;
      this.emptyEl = null;
      this.searchEl = null;

      // State
      this.sections = []; // [{label, line, ch}]
      this.activeIndex = -1;
      this.cmChangeHandler = null;
      this.cmCursorHandler = null;
      this.refreshTimer = null;
    }

    init() {
      try {
        this.startWatchingParentLocation();
        this.handleLocationChange(this.win.location.pathname);
      } catch (e) {
        console.warn("CssToc init failed:", e);
      }
    }

    startWatchingParentLocation() {
      if (this.locationPollHandle) return;
      this.lastPathname = this.win.location.pathname;
      this.locationPollHandle = this.win.setInterval(() => {
        const p = this.win.location.pathname;
        if (p !== this.lastPathname) {
          this.lastPathname = p;
          this.handleLocationChange(p);
        }
      }, this.pollIntervalMs);
    }

    handleLocationChange(pathname) {
      if (this.targetPaths.includes(pathname)) {
        this.ensureInserted();
      } else if (this.inserted) {
        this.removeSidebar();
      }
    }

    ensureInserted() {
      if (this.inserted) return;
      if (this.doc.getElementById("css-toc-container")) {
        this.inserted = true;
        return;
      }

      const cmRoot = this.doc.querySelector(".CodeMirror");
      if (!cmRoot || !cmRoot.CodeMirror) {
        // CodeMirror not ready yet, retry shortly
        this.win.setTimeout(() => this.ensureInserted(), 400);
        return;
      }

      this.cmRootEl = cmRoot;
      this.cm = cmRoot.CodeMirror;

      this.buildUI();
      this.attachCmListeners();
      this.refreshSections();
      this.inserted = true;
    }

    buildUI() {
      const container = this.doc.createElement("div");
      container.id = "css-toc-container";
      container.classList.add("css-toc--collapsed");

      // Toggle button (always visible, pinned to right edge)
      const toggle = this.doc.createElement("button");
      toggle.type = "button";
      toggle.className = "css-toc-toggle";
      toggle.setAttribute("aria-label", "Toggle CSS table of contents");
      toggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
      this.toggleBtn = toggle;

      // Sidebar
      const sidebar = this.doc.createElement("aside");
      sidebar.className = "css-toc-sidebar";
      this.sidebarEl = sidebar;

      // Header
      const header = this.doc.createElement("div");
      header.className = "css-toc-header";
      const title = this.doc.createElement("h3");
      title.className = "css-toc-title";
      title.textContent = "Sections";
      const closeBtn = this.doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "css-toc-close";
      closeBtn.setAttribute("aria-label", "Close sidebar");
      closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      header.appendChild(title);
      header.appendChild(closeBtn);

      // Search/filter input
      const searchWrap = this.doc.createElement("div");
      searchWrap.className = "css-toc-search-wrap";
      const search = this.doc.createElement("input");
      search.type = "search";
      search.className = "css-toc-search";
      search.placeholder = "Filter sections…";
      search.autocomplete = "off";
      this.searchEl = search;
      searchWrap.appendChild(search);

      // List
      const list = this.doc.createElement("ul");
      list.className = "css-toc-list";
      this.listEl = list;

      // Empty state
      const empty = this.doc.createElement("div");
      empty.className = "css-toc-empty";
      empty.innerHTML = '<p class="css-toc-empty-title">No sections found</p><p class="css-toc-empty-hint">Add comments like<br><code>/* === Header === */</code><br>or<br><code>/* --- Footer --- */</code><br>to your CSS.</p>';
      this.emptyEl = empty;

      // Credit
      const credit = this.doc.createElement("div");
      credit.className = "css-toc-credit";
      credit.innerHTML = '<span>CSS TOC</span>';

      sidebar.appendChild(header);
      sidebar.appendChild(searchWrap);
      sidebar.appendChild(list);
      sidebar.appendChild(empty);
      sidebar.appendChild(credit);

      container.appendChild(toggle);
      container.appendChild(sidebar);

      this.doc.body.appendChild(container);
      this.containerEl = container;

      // Wire events
      toggle.addEventListener("click", () => this.setOpen(true));
      closeBtn.addEventListener("click", () => this.setOpen(false));
      search.addEventListener("input", () => this.applyFilter(search.value));

      // Restore last open state from sessionStorage
      try {
        const last = this.win.sessionStorage.getItem("cssTocOpen");
        if (last === "1") this.setOpen(true);
      } catch (e) {}
    }

    attachCmListeners() {
      if (!this.cm) return;

      this.cmChangeHandler = () => {
        // Debounce refreshes during typing
        if (this.refreshTimer) this.win.clearTimeout(this.refreshTimer);
        this.refreshTimer = this.win.setTimeout(() => this.refreshSections(), 300);
      };
      this.cm.on("change", this.cmChangeHandler);

      this.cmCursorHandler = () => this.updateActiveFromCursor();
      this.cm.on("cursorActivity", this.cmCursorHandler);
    }

    detachCmListeners() {
      if (this.cm) {
        if (this.cmChangeHandler) this.cm.off("change", this.cmChangeHandler);
        if (this.cmCursorHandler) this.cm.off("cursorActivity", this.cmCursorHandler);
      }
      this.cmChangeHandler = null;
      this.cmCursorHandler = null;
    }

    refreshSections() {
      if (!this.cm) return;
      const value = typeof this.cm.getValue === "function" ? this.cm.getValue() : "";
      this.sections = this.parseSections(value);
      this.renderList();
      this.updateActiveFromCursor();
    }

    parseSections(text) {
      // Match comments on their own line that use === or --- delimiters
      // Examples matched:
      //   /* === Header === */
      //   /* === Header */
      //   /*=== Header ===*/
      //   /* --- Footer --- */
      //   /* ---- Section ---- */
      // Captures the inner label (trimmed of delimiters)
      const sections = [];
      const lines = text.split("\n");
      const re = /^\s*\/\*\s*(?:={2,}|-{2,})\s*(.+?)\s*(?:={2,}|-{2,})?\s*\*\/\s*$/;

      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (m && m[1]) {
          const label = m[1].replace(/[=\-]+$/g, "").replace(/^[=\-]+/g, "").trim();
          if (label.length === 0) continue;
          sections.push({
            label: label,
            line: i,
            ch: 0,
          });
        }
      }
      return sections;
    }

    renderList() {
      if (!this.listEl) return;
      this.listEl.innerHTML = "";

      if (!this.sections.length) {
        this.listEl.style.display = "none";
        if (this.emptyEl) this.emptyEl.style.display = "block";
        return;
      }
      this.listEl.style.display = "block";
      if (this.emptyEl) this.emptyEl.style.display = "none";

      const filterRaw = this.searchEl ? this.searchEl.value : "";
      const filter = filterRaw ? filterRaw.toLowerCase().trim() : "";

      this.sections.forEach((s, idx) => {
        if (filter && s.label.toLowerCase().indexOf(filter) === -1) return;

        const li = this.doc.createElement("li");
        li.className = "css-toc-item";
        if (idx === this.activeIndex) li.classList.add("css-toc-item--active");

        const btn = this.doc.createElement("button");
        btn.type = "button";
        btn.className = "css-toc-link";
        btn.dataset.idx = String(idx);

        const labelSpan = this.doc.createElement("span");
        labelSpan.className = "css-toc-label";
        labelSpan.textContent = s.label;

        const lineSpan = this.doc.createElement("span");
        lineSpan.className = "css-toc-line";
        lineSpan.textContent = "L" + (s.line + 1);

        btn.appendChild(labelSpan);
        btn.appendChild(lineSpan);

        btn.addEventListener("click", () => this.jumpTo(idx));
        li.appendChild(btn);
        this.listEl.appendChild(li);
      });
    }

    applyFilter(value) {
      this.renderList();
    }

    jumpTo(idx) {
      if (!this.cm) return;
      const s = this.sections[idx];
      if (!s) return;

      const pos = { line: s.line, ch: s.ch };
      try {
        this.cm.focus();
        this.cm.setCursor(pos);
        // Center the line in the viewport
        const margin = Math.floor((this.cm.getScrollInfo().clientHeight || 400) / 2);
        this.cm.scrollIntoView({ line: s.line, ch: 0 }, margin);
      } catch (e) {}

      this.activeIndex = idx;
      this.updateActiveStyles();
    }

    updateActiveFromCursor() {
      if (!this.cm || !this.sections.length) {
        this.activeIndex = -1;
        this.updateActiveStyles();
        return;
      }
      const cursor = this.cm.getCursor();
      let active = -1;
      for (let i = 0; i < this.sections.length; i++) {
        if (this.sections[i].line <= cursor.line) active = i;
        else break;
      }
      if (active !== this.activeIndex) {
        this.activeIndex = active;
        this.updateActiveStyles();
      }
    }

    updateActiveStyles() {
      if (!this.listEl) return;
      const items = this.listEl.querySelectorAll(".css-toc-item");
      items.forEach((el) => {
        const link = el.querySelector(".css-toc-link");
        if (!link) return;
        const idx = parseInt(link.dataset.idx, 10);
        el.classList.toggle("css-toc-item--active", idx === this.activeIndex);
      });
    }

    setOpen(open) {
      if (!this.containerEl) return;
      this.containerEl.classList.toggle("css-toc--open", !!open);
      this.containerEl.classList.toggle("css-toc--collapsed", !open);
      try {
        this.win.sessionStorage.setItem("cssTocOpen", open ? "1" : "0");
      } catch (e) {}
    }

    removeSidebar() {
      this.detachCmListeners();
      if (this.containerEl && this.containerEl.parentNode) {
        this.containerEl.parentNode.removeChild(this.containerEl);
      }
      this.containerEl = null;
      this.sidebarEl = null;
      this.toggleBtn = null;
      this.listEl = null;
      this.emptyEl = null;
      this.searchEl = null;
      this.cmRootEl = null;
      this.cm = null;
      this.sections = [];
      this.activeIndex = -1;
      this.inserted = false;
    }
  }

  // Initialize. Works whether script is loaded in admin window directly
  // or inside the site preview iframe. Safe to run anywhere because
  // the script only acts when the CSS panel CodeMirror element is found.
  try {
    new CssToc().init();
  } catch (e) {
    console.warn("CssToc failed to start:", e);
  }
}();
