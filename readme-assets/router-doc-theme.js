(function () {
  function slugify(text, fallback) {
    const base = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return base || fallback;
  }

  function splitList(value) {
    return String(value || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function pickSource(doc) {
    const selectors = [
      "[data-doc-root]",
      ".col-lg-9",
      "main.content",
      ".doc-content",
      ".content",
      ".container",
      ".wrap",
      "main",
      "body"
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      if (node) return node;
    }
    return doc.body;
  }

  function directSections(source, doc) {
    const children = Array.from(source.children).filter((node) => {
      if (node.matches("script, style, aside, nav, footer")) return false;
      const text = node.textContent && node.textContent.trim();
      return text;
    });

    const blocks = children.filter((node) => node.matches("section, .section, .section-card, .card"));
    if (blocks.length >= 2) return blocks;

    if (children.length >= 2 && children.some((node) => /H2/i.test(node.tagName))) {
      const sections = [];
      let current = null;
      children.forEach((node) => {
        if (/H2/i.test(node.tagName)) {
          current = doc.createElement("section");
          current.appendChild(node.cloneNode(true));
          sections.push(current);
          return;
        }
        if (!current) {
          current = doc.createElement("section");
          sections.push(current);
        }
        current.appendChild(node.cloneNode(true));
      });
      if (sections.length) return sections;
    }

    const nested = Array.from(source.querySelectorAll("section, .section, .section-card"));
    if (nested.length >= 2) return nested;

    return children.length ? children : Array.from(source.childNodes).filter((node) => node.nodeType === 1);
  }

  function extractHero(source, doc) {
    const heroTitle = doc.body.dataset.docTitle || doc.title || "Documentation";
    const titleNode = source.querySelector("h1");
    const summaryNode = source.querySelector("p, .lead, .sub");
    return {
      title: (titleNode && titleNode.textContent.trim()) || heroTitle,
      summary:
        doc.body.dataset.docSummary ||
        (summaryNode && summaryNode.textContent.trim()) ||
        "Documentation styled to match the router guide."
    };
  }

  function buildSectionCard(node, index, doc) {
    const card = doc.createElement("section");
    card.className = "section-card";

    const heading = node.matches("h2") ? node : node.querySelector("h2");
    const label = doc.createElement("div");
    label.className = "section-label";
    label.textContent = index === 0 ? "Overview" : "Guide";
    card.appendChild(label);

    if (node.matches("section, .section, .section-card, .card")) {
      const clone = node.cloneNode(true);
      clone.removeAttribute("class");
      clone.querySelectorAll(".section-title").forEach((title) => {
        const promoted = doc.createElement("h2");
        promoted.innerHTML = title.innerHTML;
        title.replaceWith(promoted);
      });
      if (!clone.querySelector("h2")) {
        const fallback = doc.createElement("h2");
        fallback.textContent = "Section";
        clone.prepend(fallback);
      }
      if (clone.id) {
        card.id = clone.id;
      } else {
        const h2 = clone.querySelector("h2");
        card.id = slugify(h2 && h2.textContent, "section-" + (index + 1));
      }
      card.append.apply(card, Array.from(clone.childNodes));
    } else {
      const clone = node.cloneNode(true);
      if (clone.id) card.id = clone.id;
      else card.id = slugify(clone.textContent, "section-" + (index + 1));
      card.appendChild(clone);
    }

    const h2 = card.querySelector("h2");
    if (h2 && !card.id) card.id = slugify(h2.textContent, "section-" + (index + 1));
    if (h2 && !h2.id) h2.id = card.id;

    card.querySelectorAll("table").forEach((table) => {
      if (!table.parentElement.classList.contains("table-wrap")) {
        const wrap = doc.createElement("div");
        wrap.className = "table-wrap";
        table.parentElement.insertBefore(wrap, table);
        wrap.appendChild(table);
      }
    });

    return card;
  }

  const doc = document;
  const source = pickSource(doc);
  const heroMeta = extractHero(source, doc);
  const blocks = directSections(source, doc);
  const sectionCards = blocks.map((node, index) => buildSectionCard(node, index, doc));
  const navItems = sectionCards
    .map((card, index) => {
      const h2 = card.querySelector("h2");
      return {
        id: card.id || "section-" + (index + 1),
        label: h2 ? h2.textContent.trim() : "Section " + (index + 1)
      };
    })
    .filter((item) => item.label);

  const badges = splitList(doc.body.dataset.docBadges);
  const highlights = splitList(doc.body.dataset.docHighlights);
  const metrics = splitList(doc.body.dataset.docMetrics).map((item) => {
    const parts = item.split("::");
    return {
      value: (parts[0] || "").trim(),
      label: (parts[1] || "").trim()
    };
  });

  const shell = doc.createElement("div");
  shell.className = "page-shell";

  const header = doc.createElement("header");
  header.className = "hero";

  const topline = doc.createElement("div");
  topline.className = "hero-topline";
  const eyebrow = doc.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = doc.body.dataset.docProduct || heroMeta.title;
  topline.appendChild(eyebrow);
  badges.forEach((badgeText) => {
    const chip = doc.createElement("span");
    chip.className = "chip";
    chip.textContent = badgeText;
    topline.appendChild(chip);
  });
  header.appendChild(topline);

  const heroGrid = doc.createElement("div");
  heroGrid.className = "hero-grid";
  const heroCopy = doc.createElement("div");
  heroCopy.className = "hero-copy";
  const h1 = doc.createElement("h1");
  h1.textContent = heroMeta.title;
  const summary = doc.createElement("p");
  summary.textContent = heroMeta.summary;
  heroCopy.appendChild(h1);
  heroCopy.appendChild(summary);

  const actions = doc.createElement("div");
  actions.className = "hero-actions";
  navItems.slice(0, 3).forEach((item, index) => {
    const link = doc.createElement("a");
    link.className = "hero-link" + (index === 0 ? " primary" : "");
    link.href = "#" + item.id;
    link.textContent = index === 0 ? "Start reading" : item.label;
    actions.appendChild(link);
  });
  if (actions.children.length) heroCopy.appendChild(actions);

  const panel = doc.createElement("aside");
  panel.className = "hero-panel";
  const panelTitle = doc.createElement("h2");
  panelTitle.textContent = "Highlights";
  panel.appendChild(panelTitle);
  const list = doc.createElement("ul");
  const panelItems = highlights.length ? highlights : navItems.slice(0, 3).map((item) => item.label);
  panelItems.forEach((text) => {
    const li = doc.createElement("li");
    const span = doc.createElement("span");
    span.textContent = text;
    li.appendChild(span);
    list.appendChild(li);
  });
  panel.appendChild(list);

  heroGrid.appendChild(heroCopy);
  heroGrid.appendChild(panel);
  header.appendChild(heroGrid);

  if (metrics.length) {
    const metricsWrap = doc.createElement("div");
    metricsWrap.className = "metrics";
    metrics.forEach((metric) => {
      const box = doc.createElement("div");
      box.className = "metric";
      const strong = doc.createElement("strong");
      strong.textContent = metric.value;
      const span = doc.createElement("span");
      span.textContent = metric.label;
      box.appendChild(strong);
      box.appendChild(span);
      metricsWrap.appendChild(box);
    });
    header.appendChild(metricsWrap);
  }

  shell.appendChild(header);

  const mainGrid = doc.createElement("div");
  mainGrid.className = "main-grid";
  const sidebar = doc.createElement("aside");
  sidebar.className = "sidebar";
  const sidebarHeading = doc.createElement("h2");
  sidebarHeading.textContent = "On this page";
  const sidebarCopy = doc.createElement("p");
  sidebarCopy.textContent =
    doc.body.dataset.docSidebar ||
    "Router-style documentation layout with preserved content structure and section links.";
  sidebar.appendChild(sidebarHeading);
  sidebar.appendChild(sidebarCopy);
  const nav = doc.createElement("nav");
  const navList = doc.createElement("ul");
  navItems.forEach((item) => {
    const li = doc.createElement("li");
    const link = doc.createElement("a");
    link.href = "#" + item.id;
    link.textContent = item.label;
    li.appendChild(link);
    navList.appendChild(li);
  });
  nav.appendChild(navList);
  sidebar.appendChild(nav);
  const callout = doc.createElement("div");
  callout.className = "sidebar-callout";
  callout.innerHTML =
    "<strong>Design note:</strong> this page now uses the shared router-style README theme.";
  sidebar.appendChild(callout);

  const content = doc.createElement("main");
  content.className = "content";
  sectionCards.forEach((card) => content.appendChild(card));

  mainGrid.appendChild(sidebar);
  mainGrid.appendChild(content);
  shell.appendChild(mainGrid);

  doc.body.innerHTML = "";
  doc.body.appendChild(shell);
})();
