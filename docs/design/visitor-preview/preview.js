(() => {
  const copy = window.ELO_PREVIEW_COPY;
  const formats = window.ELO_PREVIEW_FORMATS;
  const page = document.getElementById("page");
  const site = document.getElementById("site");
  const controls = document.getElementById("preview-options");
  const params = new URLSearchParams(location.search);
  const state = {
    phase: ["open", "upcoming", "closed"].includes(params.get("state"))
      ? params.get("state")
      : "open",
    width: params.get("width") === "mobile" ? "mobile" : "desktop",
    language: ["en", "es", "both"].includes(params.get("lang")) ? params.get("lang") : "both",
    format: "papers",
  };
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );
  const visible = () => (state.language === "both" ? [0, 1] : [state.language === "es" ? 1 : 0]);
  function pair(values, css = "") {
    if (values?.length !== 2) throw new Error("Missing bilingual copy");
    return `<span class="pair ${css}">${visible()
      .map(
        (i) =>
          `<span lang="${i ? "es" : "en"}" class="${i ? "es" : "en"}">${escapeHtml(values[i])}</span>`,
      )
      .join("")}</span>`;
  }
  const t = (key, css = "") => pair(copy[key], css);
  const plain = (values) =>
    visible()
      .map((i) => values[i])
      .join(" / ");
  const label = (key) => escapeHtml(plain(copy[key]));
  const parallel = (values) =>
    `<div class="parallel-copy">${visible()
      .map((i) => `<p lang="${i ? "es" : "en"}">${escapeHtml(values[i])}</p>`)
      .join("")}</div>`;
  const official = (key, css = "text-link", section = "submit") =>
    `<a class="${css}" href="https://elo27.eliterature.org/#${section}" target="_blank" rel="noopener noreferrer">${t(key, "stack")}<span class="external-mark" aria-hidden="true">→</span></a>`;
  const go = (screen, key, css = "") => `<a class="${css}" href="#/${screen}">${t(key)}</a>`;
  function start(key = "start", css = "button", selected = "") {
    if (state.phase === "closed") return go("resume", "myProposals", css);
    if (state.phase === "upcoming") return go("guide", "prepare", css);
    return `<a class="${css}" href="#/start${selected ? `/${selected}` : ""}">${t(key, "stack")}<span class="action-mark" aria-hidden="true">→</span></a>`;
  }
  const back = () => `<a class="back" href="#/home">← ${t("back")}</a>`;
  function sectionHead(key, number, heading = "h2") {
    return `<div class="section-head"><${heading}>${t(key)}</${heading}><span class="section-number" aria-hidden="true">${number}</span></div>`;
  }
  function title() {
    const spanish = state.language === "es";
    const heading = spanish
      ? 'Ecologías<br><span class="light">de la atención</span>'
      : 'Ecologies<br><span class="light">of Attention</span>';
    return `<div class="attention-title${spanish ? " hero-es-only" : ""}"><span class="attention-blur" aria-hidden="true">${heading}</span><h1 lang="${spanish ? "es" : "en"}">${heading}</h1></div>${state.language === "both" ? '<p class="hero-title-es" lang="es">Ecologías de la atención</p>' : ""}`;
  }
  function home() {
    const status =
      state.phase === "open" ? "open" : state.phase === "upcoming" ? "upcoming" : "closed";
    const deadline =
      state.phase === "closed"
        ? t("windowClosed")
        : `${t("due")}<a href="#/dates">${t("deadline")}</a>`;
    return `<section class="frame hero"><p class="eyebrow">ELO 2027 · ${t(status)}</p><div class="hero-grid"><div>${title()}<div class="hero-mobile-actions">${start()}</div><div class="event"><p>${t("eventDate")}</p><p>Barranquilla, Colombia<br>Universidad del Norte<br>${t("firstLatin")}</p></div></div><div class="glass hero-card">${parallel(copy.invite)}<div class="actions hero-actions">${start()}${official("cfp", "button secondary")}</div><p class="deadline">${deadline}</p></div></div></section>
      <section class="frame contributions">${sectionHead("bring", "01")}<p class="welcome">${t("welcomeLanguages")}</p><div class="contribution-grid"><section class="contribution"><h3>${t("ideas")}</h3><p>${t("ideasList")}</p><a href="#/guide/papers">${t("explore")} →</a></section><section class="contribution"><h3>${t("art")}</h3><p>${t("artList")}</p><a href="#/guide/performances">${t("explore")} →</a></section><section class="contribution"><h3>${t("workshops")}</h3><p>${t("workshopList")}</p><a href="#/guide/workshops">${t("requirements")} →</a></section></div></section>
      <div class="frame returning"><span>${t("already")}</span>${go("resume", "continue")}${go("reviewer", "organizers")}</div>`;
  }
  function formatPanel(format) {
    const index = formats.indexOf(format);
    return `<div class="glass format-panel"><div class="panel-meta"><span>${t("format")} ${String(index + 1).padStart(2, "0")} / ${String(formats.length).padStart(2, "0")}</span><span>${t(format.track)}</span></div><h2>${pair(format.name)}</h2>${format.stats.length ? `<div class="stats">${format.stats.map(([value, unit]) => `<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${t(unit)}</span></div>`).join("")}</div>` : `<span class="eyebrow">${t("byEmail")}</span>`}<div class="panel-copy">${parallel(format.description)}</div><div class="format-start">${format.email ? official("officialFormats", "button secondary") : start("startFormat", "button", format.key)}</div><div class="panel-actions"><button type="button" class="button secondary" data-step="-1">← ${t("previous", "stack")}</button><button type="button" class="button" data-step="1">${t("next", "stack")} →</button></div></div>`;
  }
  function guide() {
    const selected = formats.find((f) => f.key === state.format);
    return `<section class="frame page">${back()}${sectionHead("formatsTitle", "02", "h1")}<div class="page-intro">${parallel(copy.formatIntro)}</div><div class="guide-actions"><span class="eyebrow">${t("welcomeLanguages")}</span>${official("officialFormats")}</div><div class="format-select"><label for="format-select">${t("format")}</label><select id="format-select">${formats.map((f, i) => `<option value="${f.key}"${f === selected ? " selected" : ""}>${String(i + 1).padStart(2, "0")} · ${escapeHtml(plain(f.name))}</option>`).join("")}</select></div><div class="guide-layout"><nav class="format-list" aria-label="${label("formatsTitle")}">${formats.map((f, i) => `<button type="button" class="format-choice" data-format="${f.key}" aria-pressed="${f === selected}"><span class="format-num">${String(i + 1).padStart(2, "0")}</span><span class="format-name">${pair(f.name)}</span><span class="tag">${t(f.track)}</span></button>`).join("")}</nav><div id="format-detail">${formatPanel(selected)}</div></div><p class="guide-note">${t("pending")}</p></section>`;
  }
  function dates() {
    const localDate = new Date("2027-02-14T23:59:00-12:00");
    const local = ["en", "es"].map((lang) =>
      new Intl.DateTimeFormat(lang, { dateStyle: "full", timeStyle: "long" }).format(localDate),
    );
    return `<section class="frame page">${back()}${sectionHead("datesTitle", "03", "h1")}<div class="paper-section"><div class="date-grid"><section><h2>${t("deadlineTitle")}</h2><p>${t("deadline")}</p><small>${t("aoe")}</small><details><summary>${t("localTime")}</summary><p>${pair(local)}</p></details></section><section><h2>${t("meet")}</h2><p>${t("eventDate")}<br>Universidad del Norte</p><small>${t("encounter")}<br>${t("conferenceDates")}</small></section></div><div class="actions">${start()}${official("details", "button secondary")}</div></div></section>`;
  }
  function signin(kind) {
    const format = formats.find((f) => f.key === state.format);
    const reviewer = kind === "reviewer";
    const returning = kind === "resume";
    if (!reviewer && !returning && (state.phase !== "open" || format?.email)) return guide();
    const heading = reviewer ? "reviewerTitle" : returning ? "continue" : "startTitle";
    const intro = reviewer ? "reviewerIntro" : returning ? "continueIntro" : "draftIntro";
    return `<section class="frame page"><div class="signin">${back()}<p class="eyebrow">ELO 2027 · ${t("theme")}</p><h1>${t(heading)}</h1><div class="page-intro">${parallel(copy[intro])}</div>${!reviewer && !returning && format ? `<p class="guide-note">${t("selectedFormat")}: ${pair(format.name)}</p>` : ""}<form aria-label="${label("signInPreview")}"><label>${t("email", "stack")}<input type="email" placeholder="you@example.org" readonly></label><button class="button" type="button" disabled>${t("emailLink", "stack")}</button><p class="explain">${t("passwordless", "stack")}</p></form><p class="aside">${t(reviewer ? "accountRoles" : returning ? "afterContinue" : "afterStart", "stack")}</p></div></section>`;
  }
  function renderChrome() {
    document.documentElement.lang = state.language === "es" ? "es" : "en";
    document.body.dataset.language = state.language;
    site.dataset.width = state.width;
    document.getElementById("study").innerHTML =
      `<span>${t("preview")}</span><a href="#preview-options" data-options>${t("options")}</a>`;
    const nav = document.getElementById("navigation");
    nav.setAttribute("aria-label", plain(copy.mainNav));
    nav.innerHTML = `${go("guide", "submit")}${official("conference", "", "top")}${go("reviewer", "reviewers")}`;
    document.getElementById("language-legend").textContent = plain(copy.languages);
    for (const button of document.querySelectorAll("[data-language]"))
      button.setAttribute("aria-pressed", String(button.dataset.language === state.language));
    document.getElementById("footer").innerHTML =
      `<span>ELOchair · ${t("organization")}</span>${official("website")}`;
    controls.innerHTML = `<summary>${t("options")}</summary><form aria-label="${label("settings")}"><label>${t("width")}<select id="preview-width"><option value="desktop"${state.width === "desktop" ? " selected" : ""}>${label("desktop")}</option><option value="mobile"${state.width === "mobile" ? " selected" : ""}>${label("mobile")}</option></select></label><label>${t("callState")}<select id="preview-state">${["open", "upcoming", "closed"].map((phase, i) => `<option value="${phase}"${phase === state.phase ? " selected" : ""}>${label(["stateOpen", "stateUpcoming", "stateClosed"][i])}</option>`).join("")}</select></label><button type="button" id="reset-preview">${t("reset", "stack")}</button></form><p>${t("previewNote", "stack")}</p>`;
  }
  function saveSettings() {
    const url = new URL(location.href);
    url.searchParams.delete("concept");
    url.searchParams.set("lang", state.language);
    url.searchParams.set("width", state.width);
    url.searchParams.set("state", state.phase);
    history.replaceState(null, "", url);
  }
  const attentionQuery = window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
  );
  let releaseAttention = () => {};
  function bindAttention() {
    releaseAttention();
    const hero = page.querySelector(".hero");
    const heading = hero?.querySelector(".attention-title");
    if (!hero || !heading) return;
    let frame = 0;
    let pointer;
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      hero.classList.remove("is-attending");
    };
    const move = (event) => {
      if (!attentionQuery.matches || event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!attentionQuery.matches) return;
        const bounds = heading.getBoundingClientRect();
        heading.style.setProperty("--attention-x", `${pointer.x - bounds.left}px`);
        heading.style.setProperty("--attention-y", `${pointer.y - bounds.top}px`);
        hero.classList.add("is-attending");
      });
    };
    hero.addEventListener("pointermove", move);
    hero.addEventListener("pointerleave", reset);
    attentionQuery.addEventListener("change", reset);
    releaseAttention = () => {
      reset();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", reset);
      attentionQuery.removeEventListener("change", reset);
    };
  }
  function render(focus = false) {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    const screen = ["home", "guide", "dates", "start", "resume", "reviewer"].includes(parts[0])
      ? parts[0]
      : "home";
    if (formats.some((f) => f.key === parts[1])) state.format = parts[1];
    renderChrome();
    page.innerHTML =
      screen === "home"
        ? home()
        : screen === "guide"
          ? guide()
          : screen === "dates"
            ? dates()
            : signin(screen);
    bindAttention();
    const headingText =
      [...page.querySelector("h1").querySelectorAll("[lang]")]
        .map((part) => part.textContent)
        .join(" / ") || page.querySelector("h1").textContent;
    document.title = `${screen === "home" ? plain(copy.theme) : headingText} · ELO 2027`;
    for (const link of document.querySelectorAll(".site-nav a")) {
      if (link.hash === `#/${screen}`) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (focus) {
      const heading = page.querySelector("h1");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      site.scrollIntoView({ block: "start" });
    }
  }
  function chooseFormat(key, restoreFocus) {
    if (!formats.some((f) => f.key === key)) return;
    state.format = key;
    history.replaceState(null, "", `${location.pathname}${location.search}#/guide/${key}`);
    render();
    const target =
      restoreFocus === "select"
        ? document.getElementById("format-select")
        : restoreFocus === "previous"
          ? page.querySelector('[data-step="-1"]')
          : restoreFocus === "next"
            ? page.querySelector('[data-step="1"]')
            : page.querySelector(`[data-format="${key}"]`);
    target?.focus({ preventScroll: true });
  }
  document.addEventListener("click", (event) => {
    const language = event.target.closest("[data-language]");
    if (language) {
      state.language = language.dataset.language;
      saveSettings();
      render();
      document.getElementById("language-status").textContent = plain(copy.languageStatus);
      return;
    }
    const format = event.target.closest("[data-format]");
    if (format) {
      chooseFormat(format.dataset.format);
      return;
    }
    const step = event.target.closest("[data-step]");
    if (step) {
      const next =
        (formats.findIndex((f) => f.key === state.format) +
          Number(step.dataset.step) +
          formats.length) %
        formats.length;
      chooseFormat(formats[next].key, step.dataset.step === "1" ? "next" : "previous");
      return;
    }
    if (event.target.closest("[data-options]")) {
      event.preventDefault();
      controls.open = true;
      controls.scrollIntoView({ block: "start" });
      controls.querySelector("summary").focus({ preventScroll: true });
      return;
    }
    if (event.target.closest("#reset-preview")) {
      if (location.hash === "#/home") render(true);
      else location.hash = "/home";
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "format-select") {
      chooseFormat(event.target.value, "select");
      return;
    }
    if (event.target.id === "preview-width") state.width = event.target.value;
    else if (event.target.id === "preview-state") state.phase = event.target.value;
    else return;
    saveSettings();
    render();
    document.getElementById(event.target.id)?.focus({ preventScroll: true });
  });
  document.addEventListener("submit", (event) => event.preventDefault());
  window.addEventListener("hashchange", () => render(true));
  saveSettings();
  render();
})();
