/* Parallax Editorial 主题层 · 视差幽灵字
   仅做外观增强：监视 .view.active 切换（不改 app.js），滚动视差 transform-only + rAF 节流。
   prefers-reduced-motion 与 <=900px 视口自动禁用。 */
(function () {
  "use strict";

  var GLYPHS = {
    dashboard: "今",
    calendar: "历",
    review: "复",
    analytics: "析",
    essay: "论",
    mistakes: "错",
    idioms: "成",
    courses: "课",
    articles: "读",
    exams: "考"
  };

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var layer = document.createElement("div");
  layer.className = "pe-ghost-layer";
  layer.setAttribute("aria-hidden", "true");
  var ghost = document.createElement("div");
  ghost.className = "pe-ghost";
  layer.appendChild(ghost);
  document.body.appendChild(layer);

  function currentView() {
    var active = document.querySelector(".view.active");
    return active ? active.id.replace("view-", "") : "";
  }

  function applyGlyph() {
    var view = currentView();
    var glyph = GLYPHS[view];
    if (!glyph) { ghost.textContent = ""; return; }
    if (ghost.textContent === glyph) return;
    ghost.classList.add("is-switching");
    window.setTimeout(function () {
      ghost.textContent = glyph;
      ghost.classList.remove("is-switching");
    }, 200);
  }

  /* --- 视差：单层速率 0.06，量测未变换基准位置，避免反馈回路 --- */
  var baseTop = 0, baseH = 0;
  function measure() {
    ghost.style.setProperty("--pe-y", "0px");
    var r = ghost.getBoundingClientRect();
    baseTop = r.top + window.scrollY;
    baseH = r.height;
    update();
  }
  function update() {
    if (reduceMotion || !ghost.textContent) return;
    if (window.innerWidth <= 900) return;
    var c = baseTop + baseH / 2 - window.scrollY - window.innerHeight / 2;
    ghost.style.setProperty("--pe-y", (c * 0.06).toFixed(1) + "px");
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (!ticking) {
      window.requestAnimationFrame(function () { update(); ticking = false; });
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener("resize", measure);

  /* --- 视图切换观察：不侵入 app.js --- */
  var observer = new MutationObserver(function () {
    applyGlyph();
    window.setTimeout(measure, 240);
  });
  var content = document.querySelector(".content");
  if (content) {
    observer.observe(content, { attributes: true, attributeFilter: ["class"], subtree: true });
  }

  applyGlyph();
  if (document.readyState === "complete") {
    measure();
  } else {
    window.addEventListener("load", measure);
  }
})();
