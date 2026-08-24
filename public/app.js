(function () {
  "use strict";

  var state = {
    data: null,
    view: "dashboard",
    date: "",
    calendarMonth: null,
    recommendation: null,
    articles: null,
    selectedArticle: null,
    suiteResult: null,
    essayResult: null,
    mistakeImage: null,
    essaySubmitting: false,
    mistakeSubmitting: false,
    activeTimer: null,
    timerTick: null,
    idiomLimit: 48,
    idiomRecall: false,
    idiomRevealed: {}
  };

  var viewMeta = {
    dashboard: ["今日执行", "今日计划", "按时段推进课程、刷题与复盘。"],
    calendar: ["逐日排课", "复习日历", "未完成任务会自动顺延到今天，完成后与 Todo 同步划线。"],
    review: ["训练与复盘", "套题复盘", "把答题明细转换为模块正确率、耗时和补强顺序。"],
    analytics: ["学习反馈", "学习数据", "用完成度、学习时长和套题表现检查执行质量。"],
    essay: ["写作训练", "申论批改", "可选择本机 Codex 或第三方模型，结合本地范文与真实网页证据批改。"],
    mistakes: ["错因管理", "错题识别", "可选择本机 Codex 或第三方视觉模型完成 OCR、分类和复习建议。"],
    exams: ["关键节点", "选调倒计时", "集中管理报名、笔试日期与题型分布。"],
    idioms: ["言语积累", "成语背诵", "快速检索、标记熟悉度并持续复习。"],
    courses: ["课程资产", "名师课程", "查看百度网盘云端课程数量并直达精确目录。"],
    articles: ["申论素材", "每日精读", "每天精读一篇人民网或求是网文章并沉淀表达。"]
  };

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function safeUrl(value) {
    var url = String(value || "").trim();
    if (/^https?:\/\//i.test(url) || /^\/api\//.test(url)) return esc(url);
    return "#";
  }

  function icon(name, className) {
    return '<i data-lucide="' + esc(name) + '"' + (className ? ' class="' + esc(className) + '"' : "") + "></i>";
  }

  function syncIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
    }
  }

  async function api(url, options) {
    var config = options || {};
    config.headers = Object.assign({ "Content-Type": "application/json" }, config.headers || {});
    var response = await fetch(url, config);
    var payload;
    try {
      payload = await response.json();
    } catch (error) {
      payload = { error: "服务器返回了无法解析的结果" };
    }
    if (!response.ok || payload.error) {
      var requestError = new Error(payload.error || "请求失败");
      requestError.code = payload.code || "REQUEST_FAILED";
      requestError.retryAt = payload.retryAt || "";
      requestError.ai = payload.ai || null;
      requestError.codex = payload.codex || null;
      requestError.anthropic = payload.anthropic || null;
      requestError.provider = payload.provider || "";
      throw requestError;
    }
    return payload;
  }

  function applyAiError(error) {
    if (!error || !state.data) return;
    if (!state.data.capabilities) state.data.capabilities = {};
    if (error.ai) state.data.capabilities.ai = error.ai;
    if (error.codex) state.data.capabilities.codex = error.codex;
    if (error.anthropic) state.data.capabilities.anthropic = error.anthropic;
    if (error.ai && error.ai.providers) {
      state.data.capabilities.codex = error.ai.providers.codex;
      state.data.capabilities.anthropic = error.ai.providers.anthropic;
    }
    renderShell();
    syncEssayAiAvailability();
    syncMistakeAiAvailability();
    syncIcons();
  }

  async function refreshAiStatus() {
    if (!state.data) return;
    try {
      var ai = await api("/api/ai/status");
      if (!state.data.capabilities) state.data.capabilities = {};
      state.data.capabilities.ai = ai;
      state.data.capabilities.codex = ai.providers.codex;
      state.data.capabilities.anthropic = ai.providers.anthropic;
      renderShell();
      syncEssayAiAvailability();
      syncMistakeAiAvailability();
      syncIcons();
    } catch (error) {
      // The regular refresh button remains available if this lightweight status check fails.
    }
  }

  function aiStatus() {
    var capabilities = state.data && state.data.capabilities ? state.data.capabilities : {};
    if (capabilities.ai && capabilities.ai.providers) return capabilities.ai;
    var codex = capabilities.codex || {};
    var anthropic = capabilities.anthropic || {};
    var providers = { codex: codex, anthropic: anthropic };
    var availableProviders = Object.keys(providers).filter(function (name) { return Boolean(providers[name].available); });
    return { providers: providers, availableProviders: availableProviders, anyAvailable: availableProviders.length > 0 };
  }

  function providerStatus(name) {
    return (aiStatus().providers || {})[name] || {};
  }

  function providerLabel(name) {
    return name === "anthropic" ? "第三方 API" : "本机 Codex";
  }

  function providerModel(name, task) {
    var status = providerStatus(name);
    if (name === "anthropic") {
      var modelTask = task === "deep" ? "essay" : task;
      return (status.models && status.models[modelTask]) || status.lastModel || "已配置模型";
    }
    return status.model || "账号默认模型";
  }

  function providerVerifiedForTask(name, task) {
    var status = providerStatus(name);
    if (name === "anthropic") {
      if (task === "ocr") return Boolean(status.visionVerified);
      if (task === "web") return Boolean(status.webVerified);
      return Boolean(status.textVerified);
    }
    if (task === "ocr") return Boolean(status.visionVerified);
    if (task === "web") return Boolean(status.webVerified);
    return Boolean(status.textVerified);
  }

  function providerStateText(name, task) {
    var status = providerStatus(name);
    if (status.busy) return "处理中";
    if (status.available && providerVerifiedForTask(name, task)) return "已实测";
    if (status.available) return "已配置，待首次实测";
    if (status.usageLimited) return "账号额度受限";
    if (status.rateLimited) return "API 限流或额度不足";
    if (status.state === "auth") return "鉴权失败";
    return "不可用";
  }

  function storedProvider(fieldName) {
    try {
      return localStorage.getItem("gongkao.aiProvider." + fieldName) || "";
    } catch (error) {
      return "";
    }
  }

  function rememberProvider(fieldName, name) {
    try {
      localStorage.setItem("gongkao.aiProvider." + fieldName, name);
    } catch (error) {
      // Private browsing can disable storage; the current selection still works.
    }
  }

  function selectedProvider(fieldName) {
    var selected = $('input[name="' + fieldName + '"]:checked');
    return selected ? selected.value : "";
  }

  function syncProviderControl(fieldName, task, active, detailSelector) {
    var inputs = $$('input[name="' + fieldName + '"]');
    var available = inputs.filter(function (input) { return Boolean(providerStatus(input.value).available); });
    var current = selectedProvider(fieldName);
    if (!providerStatus(current).available) {
      var preferred = storedProvider(fieldName);
      var preferredInput = inputs.find(function (input) {
        return input.value === preferred && providerStatus(input.value).available;
      });
      var replacement = preferredInput || available[0];
      if (replacement) {
        replacement.checked = true;
        current = replacement.value;
      }
    }
    inputs.forEach(function (input) {
      input.disabled = !active || !providerStatus(input.value).available;
    });
    var control = inputs[0] ? inputs[0].closest(".provider-control") : null;
    if (control) control.classList.toggle("is-inactive", !active);

    var detail = $(detailSelector);
    if (!detail) return current;
    detail.classList.remove("error");
    if (!active) {
      detail.innerHTML = "<strong>本地规则评分</strong> · 不调用大模型，不进行联网答案比对";
      return current;
    }
    if (!current || !providerStatus(current).available) {
      detail.textContent = "没有可用的 AI 通道，请检查 Codex 登录或服务端第三方 API 配置";
      detail.classList.add("error");
      return "";
    }
    var status = providerStatus(current);
    var endpoint = current === "anthropic" && status.endpointHost ? " · " + status.endpointHost : "";
    detail.innerHTML = "<strong>" + esc(providerLabel(current)) + "</strong> · " + esc(providerModel(current, task)) +
      " · " + esc(providerStateText(current, task)) + esc(endpoint);
    return current;
  }

  var toastTimer;
  function toast(message, isError) {
    var node = $("#toast");
    node.textContent = message;
    node.classList.toggle("error", Boolean(isError));
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.classList.remove("show");
    }, 3200);
  }

  function keyFromDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function dateFromKey(key) {
    var parts = String(key || "").split("-").map(Number);
    return new Date(parts[0] || 2026, (parts[1] || 1) - 1, parts[2] || 1);
  }

  function addDays(date, amount) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function formatDate(key, options) {
    return new Intl.DateTimeFormat("zh-CN", options || {
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(dateFromKey(key));
  }

  function diffDays(targetKey, fromKey) {
    var target = dateFromKey(targetKey).getTime();
    var from = dateFromKey(fromKey || keyFromDate(new Date())).getTime();
    return Math.ceil((target - from) / 86400000);
  }

  function formatMinutes(value) {
    var minutes = Math.max(0, Math.round(Number(value || 0)));
    if (minutes < 60) return minutes + " 分钟";
    return Math.floor(minutes / 60) + "小时" + (minutes % 60 ? minutes % 60 + "分" : "");
  }

  function formatClock(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds || 0)));
    var hours = String(Math.floor(total / 3600)).padStart(2, "0");
    var minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    var secs = String(total % 60).padStart(2, "0");
    return hours + ":" + minutes + ":" + secs;
  }

  function currentDb() {
    return state.data && state.data.db ? state.data.db : {};
  }

  function todayKey() {
    return keyFromDate(new Date());
  }

  function progressFor(date, slot) {
    var progress = currentDb().progress || {};
    return (progress[date] && progress[date][slot]) || {};
  }

  function timerFor(date, slot) {
    var timers = currentDb().timers || {};
    return Number((timers[date] && timers[date][slot]) || 0);
  }

  function dayPlan(date) {
    var plan = state.data && state.data.plan ? state.data.plan : [];
    return plan.find(function (item) { return item.date === date; }) || null;
  }

  function allPlanTasks() {
    var plan = state.data && state.data.plan ? state.data.plan : [];
    return plan.reduce(function (tasks, day) {
      return tasks.concat(day.tasks || []);
    }, []);
  }

  function taskById(taskId) {
    return allPlanTasks().find(function (task) { return task.id === taskId; }) || null;
  }

  function progressForTask(task) {
    return task ? progressFor(task.date, task.slot) : {};
  }

  function timerForTask(task) {
    return task ? timerFor(task.date, task.slot) : 0;
  }

  function decorateTask(task, displayDate) {
    var current = todayKey();
    var done = Boolean(progressForTask(task).done);
    var isPastDue = !done && task.date < current;
    return Object.assign({}, task, {
      delayDays: isPastDue ? Math.max(1, diffDays(current, task.date)) : 0,
      isCarried: displayDate === current && task.date < current && !done,
      isRolledOut: displayDate === task.date && task.date < current && !done
    });
  }

  function displayTasksForDate(date) {
    var day = dayPlan(date);
    var scheduled = day && day.tasks ? day.tasks.slice() : [];
    if (date === todayKey()) {
      var carried = allPlanTasks().filter(function (task) {
        return task.date < date && !progressForTask(task).done;
      });
      scheduled = carried.concat(scheduled);
    }
    return scheduled.map(function (task) { return decorateTask(task, date); });
  }

  function completionForTasks(tasks) {
    if (!tasks || !tasks.length) return { done: 0, total: 0, percent: 0 };
    var done = tasks.filter(function (task) {
      return Boolean(progressForTask(task).done);
    }).length;
    return { done: done, total: tasks.length, percent: Math.round(done / tasks.length * 100) };
  }

  function planRangeText() {
    var plan = state.data && state.data.plan ? state.data.plan : [];
    if (!plan.length) return "当前备考周期";
    return formatDate(plan[0].date, { month: "numeric", day: "numeric" }) + "至" +
      formatDate(plan[plan.length - 1].date, { month: "numeric", day: "numeric" });
  }

  function metric(iconName, tone, value, label) {
    return '<div class="metric"><span class="metric-icon ' + esc(tone || "") + '">' + icon(iconName) +
      '</span><div><strong>' + esc(value) + '</strong><small>' + esc(label) + "</small></div></div>";
  }

  function renderShell() {
    var ai = aiStatus();
    var codex = providerStatus("codex");
    var anthropic = providerStatus("anthropic");
    var chip = $("#ai-chip");
    var count = (ai.availableProviders || []).length;
    var busy = Boolean(codex.busy || anthropic.busy);
    var label = busy ? "AI 处理中" :
      (count === 2 ? "AI 双通道可用" :
        (count === 1 ? (codex.available ? "AI Codex 可用" : "AI 第三方可用") : "AI 通道不可用"));
    var iconName = busy ? "loader-circle" : (count ? "sparkles" : "triangle-alert");
    chip.classList.toggle("ready", count === 2);
    chip.classList.toggle("partial", count === 1);
    chip.classList.toggle("limited", count === 0);
    chip.innerHTML = icon(iconName, busy ? "loading-spin" : "") + "<span>" + label + "</span>";
    chip.title = "本机 Codex：" + providerStateText("codex", "deep") +
      "；第三方 API：" + providerStateText("anthropic", "deep") +
      "。密钥仅保存在服务端。";

    var cloudStats = state.data.cloudCourseStats || {};
    var sidebar = $("#sidebar-status");
    var ready = Number(cloudStats.selectedCourseCount || 0) > 0;
    sidebar.innerHTML = '<span class="status-dot ' + (ready ? "" : "warning") + '"></span><div><strong>' +
      (ready ? esc(cloudStats.selectedCourseCount + " 门课程已索引") : "云端课程待索引") +
      "</strong><small>" + (ready ? esc(cloudStats.videoCount + " 个视频，仅保存元数据") : "请在课程页重新读取") + "</small></div>";
    var datePicker = $("#date-picker");
    var plan = state.data.plan || [];
    datePicker.value = state.date;
    if (plan.length) {
      datePicker.min = plan[0].date;
      datePicker.max = plan[plan.length - 1].date;
      var rangeLabel = $("#calendar-range-label");
      if (rangeLabel) rangeLabel.textContent = plan.length + " 天逐日计划";
    }
    populateProgressModules();
  }

  function setView(view, pushHash) {
    if (!viewMeta[view]) view = "dashboard";
    state.view = view;
    $$(".view").forEach(function (node) {
      node.classList.toggle("active", node.id === "view-" + view);
    });
    $$("#nav [data-view]").forEach(function (node) {
      node.classList.toggle("active", node.dataset.view === view);
      if (node.dataset.view === view) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    });
    var meta = viewMeta[view];
    $("#page-eyebrow").textContent = meta[0];
    $("#page-title").textContent = meta[1];
    $("#page-subtitle").textContent = meta[2];
    document.title = meta[1] + " · 公考备战台";
    document.body.classList.remove("sidebar-open");
    if (pushHash && location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    renderCurrentView();
  }

  function renderCurrentView() {
    if (!state.data) return;
    var renderers = {
      dashboard: renderDashboard,
      calendar: renderCalendar,
      review: renderSuiteResult,
      analytics: renderAnalytics,
      essay: renderEssay,
      mistakes: renderMistakes,
      exams: renderExams,
      idioms: renderIdioms,
      courses: renderCourses,
      articles: renderArticles
    };
    if (renderers[state.view]) renderers[state.view]();
    syncIcons();
  }

  function completionForDay(day) {
    return completionForTasks(day && day.tasks ? day.tasks : []);
  }

  function renderDashboard() {
    var plannedDay = dayPlan(state.date);
    var tasksForDisplay = displayTasksForDate(state.date);
    var summary = $("#dashboard-summary");
    var panel = $("#today-panel");
    if (!plannedDay && !tasksForDisplay.length) {
      summary.innerHTML = metric("calendar-x", "amber", "无排课", "当前日期不在 " + planRangeText() + " 计划内");
      panel.innerHTML = '<div class="empty-state">' + icon("calendar-search") +
        "<h3>这一天没有计划</h3><p>请通过右上角日期或复习日历选择备考周期内的日期。</p></div>";
      $("#recommendation-panel").innerHTML = "";
      renderDeadlines();
      syncIcons();
      return;
    }
    var day = Object.assign({
      date: state.date,
      stage: "顺延任务",
      note: "优先清理未完成任务，再恢复新计划。"
    }, plannedDay || {}, { tasks: tasksForDisplay });
    var completion = completionForTasks(day.tasks);
    var planned = day.tasks.reduce(function (sum, task) { return sum + Number(task.plannedMinutes || 0); }, 0);
    var recorded = day.tasks.reduce(function (sum, task) { return sum + Number(progressForTask(task).minutes || 0); }, 0);
    var timed = day.tasks.reduce(function (sum, task) { return sum + timerForTask(task); }, 0);
    var coursePaths = new Set();
    day.tasks.forEach(function (task) {
      (task.courses || []).forEach(function (course) {
        coursePaths.add(course.remotePath || course.courseName || task.id);
      });
    });
    var courseCount = coursePaths.size;
    var isToday = state.date === todayKey();
    summary.innerHTML =
      metric("circle-check-big", "", completion.done + "/" + completion.total, (isToday ? "今日" : "当日") + " Todo 完成") +
      metric("clock-3", "blue", formatMinutes(recorded || timed / 60), "已记录学习时长") +
      metric("target", "amber", formatMinutes(planned), "计划学习时长") +
      metric("folder-play", "coral", courseCount + " 节", "今日云端视频");

    var taskRows = day.tasks.map(function (task) {
      var progress = progressForTask(task);
      var done = Boolean(progress.done);
      var seconds = timerForTask(task);
      var courses = (task.courses || []).map(function (course) {
        return '<div class="course-assignment"><div><span class="course-video">' + esc(course.videoName || course.courseName) +
          '</span><span class="course-folder">' + esc(course.teacher || "") + " · " + esc(course.remoteFolder || "") +
          '</span></div><button class="icon-button course-open" type="button" data-open-course="' +
          esc(course.remoteFolder || "") + '" title="在百度网盘打开此目录" aria-label="在百度网盘打开此目录">' +
          icon("external-link") + "</button></div>";
      }).join("");
      var taskClass = done ? "done" : (task.isCarried ? "overdue" : (task.isRolledOut ? "rolled-out" : ""));
      var delayBadge = task.delayDays
        ? '<span class="task-delay">' + icon("clock-alert") + '<span>已拖延 <b>' + task.delayDays + "</b> 天</span></span>"
        : "";
      var originalDate = task.delayDays
        ? '<span class="task-origin">原计划 ' + esc(formatDate(task.date, { month: "numeric", day: "numeric" })) + "</span>"
        : "";
      return '<article class="task-row ' + taskClass + '" data-task-row="' + esc(task.id) + '">' +
        '<div class="task-time"><strong>' + esc(task.label) + "</strong><span>" + esc(task.time) + "</span>" + originalDate + "</div>" +
        '<div class="task-main"><div class="task-title-line"><input type="checkbox" data-task-check="' + esc(task.id) +
        '" data-task-slot="' + esc(task.slot) + '" data-task-date="' + esc(task.date) +
        '" aria-label="标记' + esc(task.label) + '任务完成" ' + (done ? "checked" : "") + '><div class="task-copy"><span class="module-chip">' +
        esc(task.module) + "</span><p>" + esc(task.text) + "</p>" + courses + "</div></div></div>" +
        '<div class="task-actions">' + delayBadge + '<div class="timer-readout">' + icon("timer") + '<span data-timer-display="' + esc(task.id) +
        '" data-base-seconds="' + seconds + '">' + formatClock(seconds) + "</span></div>" +
        (state.activeTimer && state.activeTimer.taskId === task.id
          ? '<button class="button danger" type="button" data-stop-timer="' + esc(task.id) + '">' + icon("square") + "停止计时</button>"
          : '<button class="button secondary" type="button" data-start-timer="' + esc(task.id) + '">' + icon("play") + "开始计时</button>") +
        '<button class="button secondary" type="button" data-edit-progress="' + esc(task.id) + '">' + icon("notebook-pen") +
        "记录进度</button></div></article>";
    }).join("");

    var carriedCount = day.tasks.filter(function (task) { return task.isCarried; }).length;
    var carriedNotice = carriedCount
      ? '<div class="rollover-notice">' + icon("calendar-clock") + '<span><b>' + carriedCount +
        "</b> 项历史任务已顺延至今天，请优先清理。</span></div>"
      : "";
    panel.innerHTML = '<div class="day-header"><div><p class="section-kicker">' + esc(day.stage || day.phase || "逐日计划") +
      "</p><h2>" + esc(formatDate(day.date)) + "</h2><p>" + esc(day.note || day.focus || day.goal || "按计划推进，完成后及时复盘。") +
      "</p>" + carriedNotice + '</div><div class="completion-ring" aria-label="完成度 ' + completion.percent + '%">' + completion.percent +
      '%</div></div><div class="task-list">' + taskRows + "</div>";
    renderRecommendation(day);
    renderDeadlines();
    updateTimerDisplays();
    syncIcons();
  }

  function renderRecommendation(day) {
    var completion = completionForDay(day);
    var reviews = (currentDb().suiteReviews || []).slice(-3);
    var weak = [];
    reviews.forEach(function (review) {
      weak = weak.concat((review.analysis && review.analysis.weakModules) || []);
    });
    weak = Array.from(new Set(weak)).slice(0, 3);
    var advice = state.recommendation && state.recommendation.advice
      ? state.recommendation.advice.slice()
      : [];
    if (!advice.length) {
      advice.push(completion.percent < 70
        ? "先完成今天的核心任务；未完成内容顺延时，下一日训练量下调 20%。"
        : "完成度达标，保留 30 分钟集中复盘今日错题。");
      advice.push(weak.length
        ? "最近薄弱模块：" + weak.join("、") + "，下一轮各追加 20 至 30 道限时题。"
        : "完成第一套套题后，这里会根据正确率自动生成补强建议。");
      if (!(currentDb().essays || []).some(function (item) { return item.date === day.date; })) {
        advice.push("今天尚未记录申论输出，晚上至少完成一道小题或一个作文提纲。");
      }
    }
    $("#recommendation-panel").innerHTML = '<div class="section-heading compact"><div><p class="section-kicker">执行反馈</p><h2>规划调整建议</h2></div><span class="tag ' +
      (completion.percent >= 70 ? "green" : "amber") + '">' + completion.percent + '%</span></div><ul class="recommendation-list">' +
      advice.map(function (item) { return "<li>" + icon("arrow-right-circle") + "<span>" + esc(item) + "</span></li>"; }).join("") + "</ul>";
  }

  function renderDeadlines() {
    var exams = currentDb().exams || [];
    var today = keyFromDate(new Date());
    $("#deadline-panel").innerHTML = '<div class="section-heading compact"><div><p class="section-kicker">关键节点</p><h2>最近笔试</h2></div></div><div class="deadline-list">' +
      exams.slice().sort(function (a, b) { return String(a.writtenDate).localeCompare(String(b.writtenDate)); }).map(function (exam) {
        var days = diffDays(exam.writtenDate, today);
        return '<div class="deadline-item"><strong>' + esc(exam.name) + "</strong><span>" +
          (days >= 0 ? days + "天" : "已结束") + "</span><small>" + esc(exam.writtenDate || "待公布") + "</small></div>";
      }).join("") + "</div>";
  }

  function openProgressDialog(taskId) {
    var task = taskById(taskId);
    if (!task) return;
    var progress = progressForTask(task);
    $("#progress-dialog-title").textContent = task.label + " · " + task.time +
      (task.date !== state.date ? " · 原计划 " + formatDate(task.date, { month: "numeric", day: "numeric" }) : "");
    $("#progress-slot").value = task.id;
    $("#progress-module").value = progress.module || task.module || "综合";
    $("#progress-minutes").value = progress.minutes != null ? progress.minutes : task.plannedMinutes;
    $("#progress-notes").value = progress.notes || "";
    $("#progress-done").checked = Boolean(progress.done);
    $("#progress-dialog").showModal();
  }

  function populateProgressModules() {
    var select = $("#progress-module");
    var modules = (state.data && state.data.modules) || [];
    var current = select.value;
    select.innerHTML = modules.map(function (item) {
      return '<option value="' + esc(item) + '">' + esc(item) + "</option>";
    }).join("");
    if (modules.indexOf("综合") < 0) select.insertAdjacentHTML("beforeend", '<option value="综合">综合</option>');
    if (current) select.value = current;
  }

  async function saveProgress(taskId, values) {
    var task = taskById(taskId);
    if (!task) return;
    var result = await api("/api/progress", {
      method: "POST",
      body: JSON.stringify({
        date: task.date,
        slot: task.slot,
        done: Boolean(values.done),
        minutes: Number(values.minutes || 0),
        module: values.module || task.module,
        task: task.text,
        notes: values.notes || ""
      })
    });
    state.data.db = result.db;
    state.recommendation = state.date === task.date ? result.recommendation : null;
    renderDashboard();
    toast("学习进度已同步到 Todo、日历与统计");
  }

  async function toggleTask(taskId, done) {
    var task = taskById(taskId);
    if (!task) return;
    var existing = progressForTask(task);
    await saveProgress(taskId, {
      done: done,
      minutes: existing.minutes != null ? existing.minutes : (done ? task.plannedMinutes : 0),
      module: existing.module || task.module,
      notes: existing.notes || ""
    });
  }

  function startTimer(taskId) {
    if (state.activeTimer) {
      toast("已有计时任务正在运行，请先停止", true);
      return;
    }
    var task = taskById(taskId);
    if (!task) return;
    state.activeTimer = { taskId: task.id, date: task.date, slot: task.slot, startedAt: Date.now() };
    state.timerTick = setInterval(updateTimerDisplays, 1000);
    renderDashboard();
    toast("计时已开始");
  }

  async function stopTimer() {
    if (!state.activeTimer) return;
    var active = state.activeTimer;
    var elapsed = Math.max(1, Math.round((Date.now() - active.startedAt) / 1000));
    clearInterval(state.timerTick);
    state.timerTick = null;
    state.activeTimer = null;
    try {
      var result = await api("/api/timer", {
        method: "POST",
        body: JSON.stringify({ date: active.date, slot: active.slot, seconds: elapsed })
      });
      state.data.db = result.db;
      renderDashboard();
      toast("已记录 " + formatClock(elapsed) + " 的学习时长");
    } catch (error) {
      toast(error.message, true);
      renderDashboard();
    }
  }

  function updateTimerDisplays() {
    $$("[data-timer-display]").forEach(function (node) {
      var seconds = Number(node.dataset.baseSeconds || 0);
      if (state.activeTimer && state.activeTimer.taskId === node.dataset.timerDisplay) {
        seconds += Math.floor((Date.now() - state.activeTimer.startedAt) / 1000);
      }
      node.textContent = formatClock(seconds);
    });
  }

  function renderCalendar() {
    var selected = dateFromKey(state.date);
    var month = state.calendarMonth || new Date(selected.getFullYear(), selected.getMonth(), 1);
    state.calendarMonth = month;
    $("#calendar-heading").textContent = month.getFullYear() + " 年 " + (month.getMonth() + 1) + " 月";
    var first = new Date(month.getFullYear(), month.getMonth(), 1);
    var mondayIndex = (first.getDay() + 6) % 7;
    var gridStart = addDays(first, -mondayIndex);
    var today = todayKey();
    var html = "";
    for (var i = 0; i < 42; i += 1) {
      var date = addDays(gridStart, i);
      var key = keyFromDate(date);
      var day = dayPlan(key);
      var displayTasks = displayTasksForDate(key);
      var hasPlan = Boolean(day || displayTasks.length);
      var outside = date.getMonth() !== month.getMonth();
      var completion = completionForTasks(displayTasks);
      var visibleTasks = displayTasks.slice(0, 4);
      var tasks = visibleTasks.map(function (task) {
        var done = Boolean(progressForTask(task).done);
        var taskClass = done ? "done" : (task.isCarried ? "overdue" : (task.isRolledOut ? "postponed" : ""));
        var status = task.isCarried ? " · 拖延" + task.delayDays + "天" : (task.isRolledOut ? " · 已顺延" : "");
        return '<span class="calendar-task ' + taskClass + '" title="' + esc(task.text + status) + '">' +
          esc(task.label + " · " + task.summary + status) + "</span>";
      }).join("");
      if (displayTasks.length > visibleTasks.length) {
        tasks += '<span class="calendar-more">+' + (displayTasks.length - visibleTasks.length) + " 项待处理</span>";
      }
      html += '<button type="button" class="calendar-day ' + (outside ? "outside " : "") +
        (key === state.date ? "selected " : "") + (key === today ? "today " : "") + (!hasPlan ? "no-plan" : "") +
        '" data-calendar-date="' + esc(key) + '" ' + (!hasPlan ? 'aria-label="' + esc(key + "，无计划") + '"' : "") + ">" +
        '<span class="calendar-number">' + date.getDate() + '</span><span class="calendar-phase">' +
        esc(day ? day.stage || day.phase || "" : (displayTasks.length ? "顺延任务" : "")) + '</span><div class="calendar-tasks">' + tasks + "</div>" +
        (hasPlan ? '<span class="calendar-completion">' + completion.done + "/" + completion.total + " 已完成</span>" : "") + "</button>";
    }
    $("#calendar-grid").innerHTML = html;
    syncIcons();
  }

  function renderSuiteResult() {
    var target = $("#suite-result");
    var result = state.suiteResult;
    if (!result) {
      target.innerHTML = '<div class="empty-state">' + icon("scan-line") +
        "<h3>等待套题数据</h3><p>每行一题，系统会计算模块正确率、平均耗时和优先补强项。</p></div>";
      syncIcons();
      return;
    }
    var analysis = result.analysis || {};
    var modules = Object.entries(analysis.byModule || {});
    target.innerHTML = '<div class="section-heading"><div><p class="section-kicker">复盘结果</p><h2>' + esc(result.title) +
      '</h2></div><span class="tag ' + (analysis.accuracy >= 70 ? "green" : "amber") + '">' + esc(analysis.accuracy + "% 正确率") +
      '</span></div><div class="metric-strip">' +
      metric("list-ordered", "", analysis.total || 0, "总题数") +
      metric("circle-check", "blue", analysis.correct || 0, "答对") +
      metric("gauge", "amber", analysis.accuracy + "%", "总体正确率") +
      metric("triangle-alert", "coral", (analysis.weakModules || []).length, "薄弱模块") +
      '</div><h3>模块表现</h3><div class="analysis-bars">' +
      modules.map(function (entry) {
        var name = entry[0];
        var item = entry[1];
        return '<div class="analysis-row"><strong>' + esc(name) + '</strong><span class="bar-track"><span class="bar-fill ' +
          (item.accuracy < 70 ? "warning" : "") + '" style="width:' + Math.max(2, item.accuracy) +
          '%"></span></span><small>' + item.accuracy + "% · " + item.avgSeconds + "秒/题</small></div>";
      }).join("") + '</div><div class="notice-line" style="margin-top:18px">' +
      ((analysis.weakModules || []).length
        ? "优先补强：" + esc(analysis.weakModules.join("、")) + "。先回看错因，再做同类限时题。"
        : "当前各模块正确率均达到 70%，下一轮重点压缩平均用时。") + "</div>";
    syncIcons();
  }

  async function submitSuite(event) {
    event.preventDefault();
    var button = event.submitter;
    if (button) button.disabled = true;
    try {
      var file = $("#suite-file").files[0];
      var text = $("#suite-text").value;
      if (file) text = await file.text();
      if (!text.trim()) throw new Error("请上传文件或粘贴答题明细");
      var result = await api("/api/suite-review", {
        method: "POST",
        body: JSON.stringify({
          date: state.date,
          title: $("#suite-title").value,
          fileName: file ? file.name : "",
          text: text
        })
      });
      state.data.db = result.db;
      state.suiteResult = result.review;
      renderSuiteResult();
      toast("套题复盘已生成并写入学习数据");
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function aggregateAnalytics() {
    var db = currentDb();
    var progress = db.progress || {};
    var completed = 0;
    var entries = 0;
    var minutes = 0;
    var modules = {};
    Object.keys(progress).forEach(function (date) {
      Object.values(progress[date] || {}).forEach(function (item) {
        entries += 1;
        if (item.done) completed += 1;
        minutes += Number(item.minutes || 0);
        var module = item.module || "综合";
        modules[module] = (modules[module] || 0) + Number(item.minutes || 0);
      });
    });
    Object.values(db.studyLogs || []).forEach(function (item) {
      minutes += Number(item.minutes || 0);
      modules[item.module || "综合"] = (modules[item.module || "综合"] || 0) + Number(item.minutes || 0);
    });
    var timerSeconds = 0;
    Object.values(db.timers || {}).forEach(function (day) {
      Object.values(day || {}).forEach(function (value) { timerSeconds += Number(value || 0); });
    });
    var reviews = db.suiteReviews || [];
    var totalQuestions = reviews.reduce(function (sum, review) { return sum + Number(review.analysis && review.analysis.total || 0); }, 0);
    var totalCorrect = reviews.reduce(function (sum, review) { return sum + Number(review.analysis && review.analysis.correct || 0); }, 0);
    return {
      completed: completed,
      entries: entries,
      completion: entries ? Math.round(completed / entries * 100) : 0,
      minutes: minutes,
      timerSeconds: timerSeconds,
      modules: modules,
      reviews: reviews,
      totalQuestions: totalQuestions,
      accuracy: totalQuestions ? Math.round(totalCorrect / totalQuestions * 100) : 0
    };
  }

  function renderAnalytics() {
    var info = aggregateAnalytics();
    $("#analytics-summary").innerHTML =
      metric("circle-check-big", "", info.completed, "已完成 Todo") +
      metric("clock-3", "blue", formatMinutes(info.minutes + info.timerSeconds / 60), "累计学习") +
      metric("files", "amber", info.reviews.length, "套题复盘") +
      metric("badge-percent", "coral", info.accuracy + "%", "累计套题正确率");
    var moduleEntries = Object.entries(info.modules).sort(function (a, b) { return b[1] - a[1]; });
    var max = Math.max.apply(null, [1].concat(moduleEntries.map(function (entry) { return entry[1]; })));
    $("#analytics-panel").innerHTML = '<div class="section-heading"><div><p class="section-kicker">时间投入</p><h2>模块学习分布</h2></div><span class="tag blue">' +
      esc(formatMinutes(info.minutes)) + '</span></div>' +
      (moduleEntries.length ? '<div class="analysis-bars">' + moduleEntries.map(function (entry) {
        return '<div class="analysis-row"><strong>' + esc(entry[0]) + '</strong><span class="bar-track"><span class="bar-fill" style="width:' +
          Math.max(3, Math.round(entry[1] / max * 100)) + '%"></span></span><small>' + esc(formatMinutes(entry[1])) + "</small></div>";
      }).join("") + "</div>" : '<div class="empty-state">' + icon("chart-no-axes-combined") +
      "<h3>尚无有效数据</h3><p>完成今日 Todo 或记录学习进度后，这里会形成模块投入分布。</p></div>");
    var weak = [];
    info.reviews.slice(-5).forEach(function (review) {
      weak = weak.concat((review.analysis && review.analysis.weakModules) || []);
    });
    var frequency = {};
    weak.forEach(function (name) { frequency[name] = (frequency[name] || 0) + 1; });
    var ranked = Object.entries(frequency).sort(function (a, b) { return b[1] - a[1]; });
    $("#weak-panel").innerHTML = '<div class="section-heading compact"><div><p class="section-kicker">训练诊断</p><h2>薄弱项优先级</h2></div></div>' +
      (ranked.length ? '<ul class="plain-list">' + ranked.map(function (entry, index) {
        return "<li><strong>" + (index + 1) + ". " + esc(entry[0]) + "</strong><br><small>近五次复盘出现 " + entry[1] + " 次，建议专项限时训练。</small></li>";
      }).join("") + "</ul>" : '<div class="empty-state">' + icon("target") +
      "<h3>等待套题样本</h3><p>至少完成一套套题复盘后生成薄弱项排序。</p></div>");
    syncIcons();
  }

  function essayItems() {
    return state.data.essayLibrary && state.data.essayLibrary.items ? state.data.essayLibrary.items : [];
  }

  function renderEssayLibrary() {
    var items = essayItems();
    var query = ($("#essay-search").value || "").trim().toLowerCase();
    var filtered = items.filter(function (item) {
      return !query || [item.name, item.year, item.province, item.level, item.channel].join(" ").toLowerCase().includes(query);
    });
    $("#essay-count").textContent = filtered.length;
    $("#essay-library").innerHTML = filtered.slice(0, 120).map(function (item) {
      return '<a class="library-item" href="' + safeUrl(item.url) + '" target="_blank" rel="noopener"><strong>' +
        esc(item.name) + "</strong><small>" + esc([item.year, item.province, item.level, item.channel].filter(Boolean).join(" · ")) +
        "</small></a>";
    }).join("") || '<div class="empty-state"><p>没有匹配的范文。</p></div>';
  }

  function renderEssayReferenceOptions() {
    var select = $("#essay-reference");
    if (select.dataset.ready === "1") return;
    var items = essayItems();
    select.innerHTML = '<option value="">不指定，由 AI 自主比对</option>' + items.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc([item.year, item.province, item.level, item.name].filter(Boolean).join(" · ")) + "</option>";
    }).join("");
    select.dataset.ready = "1";
  }

  function syncEssayAiAvailability() {
    var available = Boolean(aiStatus().anyAvailable);
    $$('input[name="essay_mode"]').forEach(function (input) {
      if (input.value !== "rule") input.disabled = !available;
    });
    var selected = $('input[name="essay_mode"]:checked');
    if (!available && selected && selected.value !== "rule") {
      $('input[name="essay_mode"][value="rule"]').checked = true;
      selected = $('input[name="essay_mode"]:checked');
    }
    var mode = selected ? selected.value : "rule";
    var active = mode !== "rule";
    var provider = syncProviderControl("essay_provider", mode, active, "#essay-provider-detail");
    var status = $("#essay-ai-status");
    status.textContent = !active ? "本地规则可用" :
      (provider ? providerLabel(provider) + " · " + providerStateText(provider, mode) : "AI 通道不可用");
    status.className = "tag " + (active && provider ? "green" : "amber");
    status.title = provider ? (providerStatus(provider).lastError || "") : "";
    $("#essay-grade-btn").disabled = state.essaySubmitting || (active && !provider);
  }

  function renderEssay() {
    syncEssayAiAvailability();
    renderEssayReferenceOptions();
    renderEssayLibrary();
    if (state.essayResult) renderEssayResult(state.essayResult);
    syncIcons();
  }

  function arrayHtml(items, fallback) {
    var list = Array.isArray(items) ? items : [];
    if (!list.length) return "<li>" + esc(fallback || "暂无") + "</li>";
    return list.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("");
  }

  function formatAiTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function aiProvenanceHtml(meta, mode) {
    if (!meta) return "";
    var verifiedAt = formatAiTime(meta.verifiedAt);
    var parts = [
      "<strong>" + esc(meta.providerLabel || providerLabel(meta.provider)) + "</strong>",
      esc(meta.model || "未知模型"),
      esc((Number(meta.latencyMs || 0) / 1000).toFixed(1) + " 秒")
    ];
    if (verifiedAt) parts.push(esc("校验于 " + verifiedAt));
    if (meta.corrected) parts.push("结构校验后自动纠正");
    if (mode === "web" && meta.webSearch) {
      parts.push("高相关证据 " + esc(meta.webSearch.evidenceCount || 0) + " 条");
      parts.push("正文验证 " + esc(meta.webSearch.verifiedPageCount || 0) + " 页");
      if (meta.webSearch.authorityCount) parts.push("权威来源 " + esc(meta.webSearch.authorityCount) + " 条");
      if (meta.webSearch.averageRelevance) parts.push("相关度 " + esc(meta.webSearch.averageRelevance));
    }
    return '<div class="ai-provenance" aria-label="AI 结果来源">' + parts.map(function (item) {
      return "<span>" + item + "</span>";
    }).join("") + "</div>";
  }

  function renderEssayResult(record) {
    var grade = record.grade || record;
    var result = $("#essay-result");
    var dimensions = Array.isArray(grade.dimensions) ? grade.dimensions : [];
    var suggestions = grade.revisionSteps || grade.suggestions || [];
    var strengths = grade.strengths || ["已完成有效作答，继续通过材料要点校准表达。"];
    var missing = grade.missingPoints || ["本地快速评分不提供材料级缺失要点，请使用 AI 深度批改。"];
    var comparisons = Array.isArray(grade.comparisons) ? grade.comparisons : [];
    var sources = Array.isArray(grade.webSources) ? grade.webSources : [];
    result.hidden = false;
    result.innerHTML = aiProvenanceHtml(record.aiMeta, record.mode) +
      '<div class="score-summary"><div class="score-number">' + esc(grade.score || 0) +
      "<small>/ 100</small></div><div><p class=\"section-kicker\">" + esc(grade.questionType || "申论作答") +
      "</p><h2>批改结果</h2><p>" + esc(grade.summary || ("字数 " + (grade.charCount || 0) + "，共 " + (grade.paragraphs || 0) + " 个段落。")) +
      '</p></div></div><div class="dimension-grid">' + dimensions.map(function (item) {
        var percent = Math.round(Number(item.score || 0) / Math.max(1, Number(item.max || 1)) * 100);
        return '<div class="dimension"><div class="dimension-head"><span>' + esc(item.name) + "</span><span>" +
          esc(item.score + "/" + item.max) + '</span></div><span class="bar-track"><span class="bar-fill ' +
          (percent < 65 ? "warning" : "") + '" style="width:' + Math.max(2, percent) +
          '%"></span></span>' + (item.comment ? "<p>" + esc(item.comment) + "</p>" : "") + "</div>";
      }).join("") + '</div><div class="feedback-columns"><section><h3>做得较好</h3><ul>' +
      arrayHtml(strengths, "暂无") + "</ul></section><section><h3>遗漏与问题</h3><ul>" +
      arrayHtml(missing, "暂无") + "</ul></section><section><h3>修改步骤</h3><ul>" +
      arrayHtml(suggestions, "暂无") + "</ul></section></div>" +
      (grade.revisedAnswer ? '<div class="revised-answer"><h3>参考改写</h3>' + esc(grade.revisedAnswer) + "</div>" : "") +
      (comparisons.length ? '<h3 class="result-section-title">答案对比</h3><div class="source-list">' +
        comparisons.map(function (item) {
          return '<div class="source-item"><strong>' + esc(item.source + " · " + item.title) +
            "</strong><small>相同：" + esc(item.similarities) + "</small><small>差异：" + esc(item.differences) +
            "</small><small>可吸收：" + esc(item.adoptable) + "</small></div>";
        }).join("") + "</div>" : "") +
      (sources.length ? '<h3 class="result-section-title">联网来源</h3><div class="source-list">' +
        sources.map(function (item) {
          return '<a class="source-item" href="' + safeUrl(item.url) + '" target="_blank" rel="noopener"><strong>' +
            esc(item.title) + "</strong><small>" + esc(item.note) + "</small></a>";
        }).join("") + "</div>" : "");
    result.scrollIntoView({ behavior: "smooth", block: "start" });
    syncIcons();
  }

  async function submitEssay(event) {
    event.preventDefault();
    var answer = $("#essay-answer").value.trim();
    if (!answer) {
      toast("请先填写申论答案", true);
      return;
    }
    var modeNode = $('input[name="essay_mode"]:checked');
    var mode = modeNode ? modeNode.value : "deep";
    var provider = mode === "rule" ? "local" : selectedProvider("essay_provider");
    if (mode !== "rule" && (!provider || !providerStatus(provider).available)) {
      toast("请选择可用的 AI 模型来源", true);
      syncEssayAiAvailability();
      return;
    }
    var button = $("#essay-grade-btn");
    var progress = $("#essay-progress");
    var failed = false;
    state.essaySubmitting = true;
    syncEssayAiAvailability();
    progress.classList.remove("error");
    var providerName = provider === "local" ? "本地规则" : providerLabel(provider);
    progress.innerHTML = icon("loader-circle", "loading-spin") + " " +
      (mode === "web" ? "正在检索真实网页证据，随后由 " + esc(providerName) + " 交叉比对，通常需要 1 至 5 分钟…" :
        mode === "deep" ? esc(providerName) + " 正在读取题干和作答并进行结构化批改，通常需要 1 至 4 分钟…" : "正在执行本地规则评分…");
    syncIcons();
    try {
      var result = await api("/api/essay/grade", {
        method: "POST",
        body: JSON.stringify({
          date: state.date,
          mode: mode,
          provider: provider,
          title: $("#essay-title").value,
          prompt: $("#essay-prompt").value,
          answer: answer,
          referenceId: $("#essay-reference").value
        })
      });
      state.data.db = result.db;
      state.essayResult = result.record;
      renderEssayResult(result.record);
      toast(mode === "web" ? "全网答案比对完成" : "申论批改完成");
    } catch (error) {
      failed = true;
      applyAiError(error);
      progress.textContent = error.message;
      progress.classList.add("error");
      toast(error.message, true);
    } finally {
      state.essaySubmitting = false;
      syncEssayAiAvailability();
      if (!failed) {
        progress.textContent = "";
        progress.classList.remove("error");
      }
      if (mode !== "rule") refreshAiStatus();
    }
  }

  function syncMistakeAiAvailability() {
    var provider = syncProviderControl("ocr_provider", "ocr", true, "#ocr-provider-detail");
    var status = $("#ocr-status");
    status.textContent = provider ? providerLabel(provider) + " · " + providerStateText(provider, "ocr") : "AI OCR 不可用";
    status.className = "tag " + (provider ? "green" : "amber");
    status.title = provider ? (providerStatus(provider).lastError || "") : "";
    var button = $("#mistake-btn");
    button.disabled = state.mistakeSubmitting || !provider;
    button.title = provider ? "" : "请先配置至少一个可用的 AI 通道";
  }

  function renderMistakes() {
    syncMistakeAiAvailability();
    var mistakes = (currentDb().mistakes || []).slice().reverse();
    $("#mistake-list").innerHTML = '<div class="section-heading compact"><div><p class="section-kicker">自动归档</p><h2>错题集</h2></div><span class="count-badge">' +
      mistakes.length + '</span></div><div class="mistake-stack">' +
      (mistakes.length ? mistakes.slice(0, 40).map(function (item) {
        var image = item.imageUrl ? '<img src="' + safeUrl(item.imageUrl) + '" alt="错题照片">' :
          '<span class="teacher-avatar">' + icon("file-question") + "</span>";
        var analysis = item.analysis || {};
        var meta = item.aiMeta || null;
        var provenance = meta ? '<span class="mistake-provenance">' + esc(meta.providerLabel || providerLabel(meta.provider)) +
          " · " + esc(meta.model || "未知模型") + " · " + esc((Number(meta.latencyMs || 0) / 1000).toFixed(1) + " 秒") + "</span>" : "";
        return '<article class="mistake-item">' + image + '<div class="mistake-content"><span class="module-chip">' +
          esc(item.module) + "</span><h3>" + esc(item.type) + "</h3>" + provenance +
          '<p class="mistake-reason"><strong>错因：</strong>' + esc(item.reason) + "</p><p>" +
          esc(item.text || "未识别出清晰文字") + "</p>" +
          (analysis.reviewAdvice ? "<p><strong>复习建议：</strong>" + esc(analysis.reviewAdvice) + "</p>" : "") + "</div></article>";
      }).join("") : '<div class="empty-state">' + icon("camera") + "<h3>还没有错题</h3><p>上传错题照片后，OCR 结果和错因会保存在这里。</p></div>") +
      "</div>";
    syncIcons();
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("图片读取失败")); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("图片格式无法解析")); };
      image.src = dataUrl;
    });
  }

  async function prepareMistakeImage(file) {
    var dataUrl = await readFileAsDataUrl(file);
    var image = await loadImage(dataUrl);
    var longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    var scale = Math.min(1, 2200 / Math.max(1, longestSide));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    var context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  async function setMistakeFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      toast("仅支持 PNG、JPEG 或 WebP 图片", true);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("图片不能超过 10MB", true);
      return;
    }
    var preview = $("#mistake-preview");
    preview.hidden = false;
    preview.innerHTML = '<div class="empty-state">' + icon("loader-circle", "loading-spin") + "<p>正在优化图片…</p></div>";
    syncIcons();
    try {
      var data = await prepareMistakeImage(file);
      state.mistakeImage = { data: data, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
      preview.hidden = false;
      preview.innerHTML = '<img src="' + esc(data) + '" alt="待识别错题预览">';
    } catch (error) {
      state.mistakeImage = null;
      preview.hidden = true;
      preview.innerHTML = "";
      toast(error.message, true);
    }
  }

  async function submitMistake(event) {
    event.preventDefault();
    var provider = selectedProvider("ocr_provider");
    var providerInfo = providerStatus(provider);
    if (!provider || !providerInfo.available) {
      toast(providerInfo.lastError || "所选 AI OCR 通道当前不可用", true);
      syncMistakeAiAvailability();
      return;
    }
    if (!state.mistakeImage) {
      toast("请先选择错题照片", true);
      return;
    }
    var button = $("#mistake-btn");
    var progress = $("#mistake-progress");
    var failed = false;
    state.mistakeSubmitting = true;
    syncMistakeAiAvailability();
    progress.classList.remove("error");
    progress.innerHTML = icon("loader-circle", "loading-spin") + " " + esc(providerLabel(provider)) +
      " 正在识别图片文字并分析错因，通常需要 1 至 5 分钟…";
    syncIcons();
    try {
      var result = await api("/api/mistakes", {
        method: "POST",
        body: JSON.stringify({
          date: state.date,
          fileName: state.mistakeImage.name,
          imageData: state.mistakeImage.data,
          text: $("#mistake-text").value,
          ai: true,
          provider: provider
        })
      });
      state.data.db = result.db;
      state.mistakeImage = null;
      $("#mistake-file").value = "";
      $("#mistake-text").value = "";
      $("#mistake-preview").hidden = true;
      $("#mistake-preview").innerHTML = "";
      renderMistakes();
      toast("错题已完成 OCR、分类并归档");
    } catch (error) {
      failed = true;
      applyAiError(error);
      progress.textContent = error.message;
      progress.classList.add("error");
      toast(error.message, true);
    } finally {
      state.mistakeSubmitting = false;
      syncMistakeAiAvailability();
      if (!failed) {
        progress.textContent = "";
        progress.classList.remove("error");
      }
      refreshAiStatus();
    }
  }

  function renderExams() {
    var today = keyFromDate(new Date());
   var exams = (currentDb().exams || []).slice().sort(function (a, b) {
      var aDate = a.writtenDate && !String(a.writtenDate).startsWith("待") ? a.writtenDate : "9999";
      var bDate = b.writtenDate && !String(b.writtenDate).startsWith("待") ? b.writtenDate : "9999";
      return String(aDate).localeCompare(String(bDate));
   });
    $("#exam-panel").innerHTML = exams.map(function (exam) {
      var days = exam.writtenDate ? diffDays(exam.writtenDate, today) : null;
      var dateDisplay = days != null ? (days >= 0 ? days : "0") + "<small> 天至笔试</small>" : "待公布";
      var dateNoteHtml = exam.dateNote ? '<p class="date-note">' + icon("info") + ' ' + esc(exam.dateNote) + '</p>' : "";
      var linksHtml = "";
      if (exam.officialArticleUrl) {
        var yearLabel = exam.officialArticleYear ? esc(exam.officialArticleYear) + "年公告全文" : "最新公告全文";
        linksHtml += '<a class="exam-notice-link official-article" href="' + safeUrl(exam.officialArticleUrl) + '" target="_blank" rel="noopener" title="查看' + yearLabel + '">' + icon("file-text") + yearLabel + '</a>';
      }
      if (exam.agencyNoticeUrl) {
        linksHtml += '<a class="exam-notice-link agency-article" href="' + safeUrl(exam.agencyNoticeUrl) + '" target="_blank" rel="noopener" title="查看公考机构解读">' + icon("newspaper") + esc(exam.agencyNoticeLabel || "公考机构解读") + '</a>';
      }
      if (exam.noticeUrl) {
        linksHtml += '<a class="exam-notice-link portal-link" href="' + safeUrl(exam.noticeUrl) + '" target="_blank" rel="noopener" title="查看官网公告列表">' + icon("external-link") + esc(exam.noticeLabel || "官网入口") + '</a>';
      }
      var linkHtml = linksHtml ? '<div class="exam-links">' + linksHtml + '</div>' : "";
      return '<article class="countdown-item"><div class="section-heading compact"><div><p class="section-kicker">' +
        esc(exam.province || "选调") + "</p><h2>" + esc(exam.name) + '</h2></div><button class="icon-button" type="button" data-edit-exam="' +
        esc(exam.id) + '" title="编辑考试" aria-label="编辑考试">' + icon("pencil") +
        '</button></div><div class="countdown-value">' + dateDisplay +
        "</div><p>报名：" + esc(exam.signupDate || "待公布") +
        " · 笔试：" + esc(exam.writtenDate || "待公布") + "</p>" + dateNoteHtml +
        "<p>" + esc(exam.distribution || "题型分布待补充") + "</p>" + linkHtml + "</article>";
    }).join("");
    syncIcons();
  }

  function editExam(id) {
    var exam = (currentDb().exams || []).find(function (item) { return item.id === id; });
    if (!exam) return;
    $("#exam-form").dataset.editId = exam.id;
    $("#exam-name").value = exam.name || "";
    $("#exam-province").value = exam.province || "";
    $("#exam-signup").value = exam.signupDate || "";
    $("#exam-written").value = exam.writtenDate || "";
   $("#exam-distribution").value = exam.distribution || "";
    $("#exam-notice-url").value = exam.noticeUrl || "";
    $("#exam-notice-label").value = exam.noticeLabel || "";
    $("#exam-official-url").value = exam.officialArticleUrl || "";
    $("#exam-official-year").value = exam.officialArticleYear || "";
    $("#exam-agency-url").value = exam.agencyNoticeUrl || "";
    $("#exam-agency-label").value = exam.agencyNoticeLabel || "";
   $(".exam-editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitExam(event) {
    event.preventDefault();
    var form = event.currentTarget;
    try {
      var result = await api("/api/exams", {
        method: "POST",
        body: JSON.stringify({
          id: form.dataset.editId || "",
          name: $("#exam-name").value,
          province: $("#exam-province").value,
          signupDate: $("#exam-signup").value,
         writtenDate: $("#exam-written").value,
          distribution: $("#exam-distribution").value,
          noticeUrl: $("#exam-notice-url").value,
          noticeLabel: $("#exam-notice-label").value,
          officialArticleUrl: $("#exam-official-url").value,
          officialArticleYear: $("#exam-official-year").value,
          agencyNoticeUrl: $("#exam-agency-url").value,
          agencyNoticeLabel: $("#exam-agency-label").value
        })
      });
      state.data.db = result.db;
      form.reset();
      delete form.dataset.editId;
      renderExams();
      toast("考试信息已保存");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderIdioms() {
    var query = ($("#idiom-search").value || "").trim().toLowerCase();
    var db = currentDb();
    var progress = db.idiomProgress || {};
    var library = state.data.idiomLibrary || { items: [], metadata: {} };
    var merged = [];
    var words = {};
    (library.items || []).concat(db.idioms || []).forEach(function (item) {
      var key = String(item.word || "").trim();
      if (!key || words[key]) return;
      words[key] = true;
      merged.push(item);
    });
    var kind = $("#idiom-kind-filter").value;
    var statusFilter = $("#idiom-status-filter").value;
    var today = state.data.appDate || keyFromDate(new Date());
    var items = merged.filter(function (item) {
      var itemProgress = progress[item.id] || {};
      var due = itemProgress.nextReview && itemProgress.nextReview <= today && itemProgress.status !== "熟悉";
      var searchText = [item.word, (item.terms || []).join(" "), item.meaning, item.example,
        (item.examples || []).join(" "), item.source, item.group, item.topic, (item.tags || []).join(" ")].join(" ").toLowerCase();
      if (query && !searchText.includes(query)) return false;
      if (kind && item.kind !== kind) return false;
      if (statusFilter === "due" && !due) return false;
      if (statusFilter && statusFilter !== "due" && (itemProgress.status || "不熟") !== statusFilter) return false;
      return true;
    });
    var familiar = merged.filter(function (item) { return progress[item.id] && progress[item.id].status === "熟悉"; }).length;
    var reviewing = merged.filter(function (item) { return progress[item.id] && progress[item.id].status === "复习中"; }).length;
    var dueCount = merged.filter(function (item) {
      var itemProgress = progress[item.id] || {};
      return itemProgress.nextReview && itemProgress.nextReview <= today && itemProgress.status !== "熟悉";
    }).length;
    var visible = items.slice(0, state.idiomLimit);
    var metadata = library.metadata || {};
    $("#idiom-stats").innerHTML = "<span>总词库 <strong>" + merged.length + "</strong></span><span>四海词条 <strong>" +
      Number(metadata.shihaiUnique || 0) + "</strong></span><span>辨析组 <strong>" + Number(metadata.wordDiscriminationGroups || 0) +
      "</strong></span><span>到期 <strong>" + dueCount + "</strong></span><span>熟悉 <strong>" + familiar +
      "</strong></span><span>复习中 <strong>" + reviewing + "</strong></span><span>匹配 <strong>" + items.length + "</strong></span>";
    $("#idiom-list").innerHTML = visible.map(function (item) {
      var status = progress[item.id] && progress[item.id].status || "不熟";
      var revealed = !state.idiomRecall || state.idiomRevealed[item.id];
      var sourceLabel = item.source || (item.kind === "词语辨析" ? "公务员行测词语辨析456组" : "内置词库");
      var meta = [sourceLabel, item.group, item.topic && item.topic !== item.word ? item.topic : ""].filter(Boolean).join(" · ");
      return '<article class="idiom-item ' + (item.kind === "词语辨析" ? "distinction" : "") + '"><div class="idiom-item-head"><div class="idiom-title"><span class="idiom-word">' + esc(item.word) +
        '</span><span class="tag ' + (item.kind === "词语辨析" ? "amber" : "blue") + '">' + esc(item.kind || "成语") +
        '</span></div><div class="status-menu" aria-label="' +
        esc(item.word + "熟悉度") + '">' + ["不熟", "复习中", "熟悉"].map(function (name) {
          return '<button type="button" data-idiom-id="' + esc(item.id) + '" data-idiom-status="' + esc(name) +
            '" class="' + (status === name ? "active" : "") + '">' + esc(name) + "</button>";
        }).join("") + '</div></div><p class="idiom-meta">' + esc(meta) + '</p>' +
        (revealed ? '<div class="idiom-answer"><p><strong>' + (item.kind === "词语辨析" ? "辨析" : "释义") +
          '</strong>' + esc(item.meaning) + '</p>' + (item.example ? '<p class="example"><strong>例句</strong>' +
          esc(item.example) + "</p>" : "") + '</div>' : '<button class="idiom-reveal" type="button" data-reveal-idiom="' +
          esc(item.id) + '">' + icon("eye") + "显示释义</button>") + "</article>";
    }).join("") || '<div class="empty-state"><p>没有匹配的词条。</p></div>';
    $("#idiom-footer").innerHTML = items.length > visible.length ? '<button class="button secondary" id="idiom-load-more" type="button">' +
      icon("chevrons-down") + "继续加载（" + visible.length + " / " + items.length + "）</button>" :
      (items.length ? "<span>已显示全部 " + items.length + " 条</span>" : "");
    var recallButton = $("#idiom-recall-toggle");
    recallButton.setAttribute("aria-pressed", String(state.idiomRecall));
    recallButton.classList.toggle("active", state.idiomRecall);
    recallButton.innerHTML = icon(state.idiomRecall ? "eye-off" : "brain") + (state.idiomRecall ? "退出背诵" : "背诵模式");
    syncIcons();
  }

  async function saveIdiom(id, status) {
    try {
      var next = new Date();
      next.setDate(next.getDate() + (status === "熟悉" ? 14 : status === "复习中" ? 3 : 1));
      var result = await api("/api/idiom-progress", {
        method: "POST",
        body: JSON.stringify({ id: id, status: status, nextReview: keyFromDate(next) })
      });
      state.data.db = result.db;
      renderIdioms();
      toast("成语熟悉度已更新");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function teacherName(course) {
    if (course && typeof course === "object" && course.teacher) return course.teacher;
    var courseName = course && typeof course === "object" ? course.name : course;
    var names = ["花生十三", "时政是条线", "半月谈", "郭熙", "高照", "龙飞", "白鹭"];
    return names.find(function (name) { return String(courseName || "").includes(name); }) || "课程";
  }

  function courseModule(course) {
    var explicit = course && typeof course === "object" ? course.module : "";
    var explicitMap = { "言语": "言语理解", "资料": "资料分析", "图推": "判断推理", "判断": "判断推理", "类比": "判断推理", "数量": "数量关系", "常识": "常识时政", "申论": "申论" };
    if (explicitMap[explicit]) return explicitMap[explicit];
    var courseName = course && typeof course === "object" ? course.name : course;
    if (/申论|白鹭/.test(courseName) && !/常识|政治/.test(courseName)) return "申论";
    if (/资料/.test(courseName)) return "资料分析";
    if (/数量|数字/.test(courseName)) return "数量关系";
    if (/言语|郭熙/.test(courseName)) return "言语理解";
    if (/常识|政治/.test(courseName)) return "常识时政";
    return "判断推理";
  }

  function renderCourses() {
    var index = state.data.cloudCourses || {};
    var stats = state.data.cloudCourseStats || {};
    var query = ($("#course-search").value || "").trim().toLowerCase();
    var courses = (index.courses || []).filter(function (course) {
      return !query || [course.name, course.series, teacherName(course), courseModule(course), course.path].join(" ").toLowerCase().includes(query);
    });
    $("#course-summary").innerHTML =
      metric("folder-cloud", "", stats.selectedCourseCount || 0, "已选课程目录") +
      metric("video", "blue", stats.videoCount || 0, "云端视频") +
      metric("calendar-range", "amber", (state.data.plan || []).length, "已排课天数") +
      metric("hard-drive", "coral", "0 GB", "本地视频占用");
    var missing = (stats.missingRecommendedTeachers || []);
    $("#course-notice").textContent = missing.length
      ? "云端未找到：" + missing.join("、")
      : (index.strategyNote || "");
    var strategies = index.teacherStrategies || [];
    $("#course-strategy-list").innerHTML = strategies.map(function (strategy) {
      var bilibili = (strategy.bilibili || []).map(function (item) {
        return '<a href="' + safeUrl(item.url) + '" target="_blank" rel="noopener">' + icon("play-circle") + esc(item.title) + "</a>";
      }).join("");
      var research = (strategy.research || []).map(function (item) {
        return '<a href="' + safeUrl(item.url) + '" target="_blank" rel="noopener">' + icon("notebook-tabs") + esc(item.title) + "</a>";
      }).join("");
      return '<article class="strategy-row"><header><span class="teacher-avatar">' + esc(strategy.teacher.slice(0, 1)) +
        '</span><div><strong>' + esc(strategy.teacher) + '</strong><small>' + esc(strategy.module) +
        '</small></div></header><div class="strategy-main"><span class="strategy-label">主线与年份</span><p>' +
        esc(strategy.yearChoice) + '</p><details><summary>学习方法与跳课清单</summary><div class="strategy-detail"><div><b>怎么学</b><p>' +
        esc(strategy.studyMethod) + '</p></div><div><b>直接跳过</b><p>' + esc(strategy.skipAdvice) +
        '</p></div></div></details></div><div class="strategy-links"><div>' + bilibili + '</div><div>' + research + "</div></div></article>";
    }).join("");
    $("#course-list").innerHTML = courses.map(function (course) {
      var folders = (course.folders || []).filter(function (folder) {
        return Number(folder.directVideos || 0) > 0;
      });
      var sourceYear = String(course.path || "").includes("/25年名师课程/") ? "25年保留课" : "26年云盘";
      return '<article class="course-row"><div class="teacher-cell"><span class="teacher-avatar">' +
        esc(teacherName(course).slice(0, 1)) + "</span><span>" + esc(teacherName(course)) +
        '</span></div><div class="course-name"><strong>' + esc(course.series || course.name) + "</strong><small>" +
        esc(courseModule(course) + " · " + sourceYear + " · " + course.folderCount + " 个目录") + '</small></div><span class="course-count">' +
        esc(course.videoCount + " 节") + '</span><button class="button secondary" type="button" data-open-course="' +
        esc(course.path) + '">' + icon("folder-open") + "云盘</button>" +
        (folders.length ? '<details><summary>展开 ' + folders.length + ' 个含视频目录</summary><div class="folder-list">' +
          folders.slice(0, 80).map(function (folder) {
            return '<button class="folder-link" type="button" data-open-course="' + esc(folder.path) +
              '"><span>' + esc(folder.name) + "</span><small>" + folder.directVideos + " 节 " + icon("external-link") +
              "</small></button>";
          }).join("") + "</div></details>" : "") + "</article>";
    }).join("") || '<div class="empty-state">' + icon("search-x") + "<h3>没有匹配课程</h3><p>可按老师、模块或课程名称搜索。</p></div>";
    var links = currentDb().links || [];
    $("#link-panel").innerHTML = '<div class="section-heading compact"><div><p class="section-kicker">外部资料</p><h2>百度网盘 / B站 / 素材站</h2></div></div><div class="resource-link-grid">' +
      links.map(function (item) {
        return '<a class="resource-link" href="' + safeUrl(item.url) + '" target="_blank" rel="noopener">' +
          icon(item.type === "B站" ? "play-circle" : "link") + '<span><strong>' + esc(item.title) +
          "</strong><br><small>" + esc(item.module + " · " + item.type) + "</small></span></a>";
      }).join("") + "</div>";
    syncIcons();
  }

  async function openCloudCourse(remotePath, button) {
    if (!remotePath) return;
    if (button) button.disabled = true;
    try {
      await api("/api/open-cloud-course", {
        method: "POST",
        body: JSON.stringify({ remotePath: remotePath })
      });
      toast("已在百度网盘打开对应云端目录");
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function rescanCloud() {
    var button = $("#cloud-rescan-btn");
    button.disabled = true;
    button.innerHTML = icon("loader-circle", "loading-spin") + "读取中";
    syncIcons();
    try {
      var result = await api("/api/rescan-cloud", {
        method: "POST",
        body: JSON.stringify({})
      });
      state.data.cloudCourses = result.cloudCourses;
      state.data.cloudCourseStats = result.cloudCourseStats;
      state.data.plan = result.plan;
      renderShell();
      renderCourses();
      toast("云端课程元数据已重新读取，排课已同步更新");
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.innerHTML = icon("cloud-download") + "重读云端";
      syncIcons();
    }
  }

  async function loadArticles(force) {
    try {
      state.articles = await api("/api/articles" + (force ? "?force=1" : ""));
      selectDailyArticle();
      if (state.view === "articles") renderArticles();
    } catch (error) {
      if (state.view === "articles") {
        $("#article-panel").innerHTML = '<div class="empty-state">' + icon("wifi-off") +
          "<h3>文章列表暂时不可用</h3><p>" + esc(error.message) + "</p></div>";
        syncIcons();
      }
    }
  }

  function selectDailyArticle() {
    var items = state.articles && state.articles.articles ? state.articles.articles : [];
    if (!items.length) {
      state.selectedArticle = null;
      return;
    }
    var start = dateFromKey("2026-07-09");
    var index = Math.abs(Math.floor((dateFromKey(state.date) - start) / 86400000)) % items.length;
    state.selectedArticle = items[index];
  }

  function renderArticles() {
    if (!state.articles) {
      $("#article-panel").innerHTML = '<div class="empty-state">' + icon("loader-circle", "loading-spin") +
        "<h3>正在获取最新文章</h3><p>从人民网观点与求是网读取公开文章标题。</p></div>";
      syncIcons();
      loadArticles(false);
      return;
    }
    selectDailyArticle();
    var items = state.articles.articles || [];
    var featured = state.selectedArticle;
    var fetched = state.articles.fetchedAt ? new Date(state.articles.fetchedAt).toLocaleString("zh-CN") : "未知";
    $("#article-panel").innerHTML = '<div class="section-heading"><div><p class="section-kicker">今日推荐</p><h2>精读一篇</h2></div><span class="tag blue">更新于 ' +
      esc(fetched) + "</span></div>" + (featured ? '<article class="featured-article"><span class="module-chip">' +
        esc(featured.source) + "</span><h3>" + esc(featured.title) + "</h3><p>阅读后提炼主旨句、案例、政策表达和可迁移分论点。</p>" +
        '<a class="button primary" href="' + safeUrl(featured.url) + '" target="_blank" rel="noopener">' +
        icon("external-link") + "打开原文</a></article>" : '<div class="empty-state"><p>当前没有可用文章。</p></div>') +
      '<div class="section-heading compact" style="margin-top:18px"><div><p class="section-kicker">更多候选</p><h2>最新文章</h2></div></div><div class="article-list">' +
      items.slice(0, 20).map(function (item, index) {
        return '<article class="article-item"><a href="' + safeUrl(item.url) + '" target="_blank" rel="noopener">' +
          esc(item.title) + "</a><small>" + esc(item.source) + ' · <button type="button" class="button secondary" data-article-index="' +
          index + '" style="min-height:26px;padding:2px 7px">设为今日</button></small></article>';
      }).join("") + "</div>";
    var read = (currentDb().articleReads || []).slice().reverse().find(function (item) {
      return item.date === state.date && (!featured || item.url === featured.url);
    });
    $("#article-notes").value = read ? read.notes || "" : "";
    syncIcons();
  }

  async function saveArticleNotes(event) {
    event.preventDefault();
    if (!state.selectedArticle) {
      toast("当前没有选中的文章", true);
      return;
    }
    try {
      var result = await api("/api/article-read", {
        method: "POST",
        body: JSON.stringify({
          date: state.date,
          title: state.selectedArticle.title,
          url: state.selectedArticle.url,
          notes: $("#article-notes").value
        })
      });
      state.data.db = result.db;
      toast("精读笔记已保存");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadBootstrap(showMessage) {
    var refresh = $("#refresh-btn");
    refresh.disabled = true;
    refresh.classList.add("loading-spin");
    try {
      var data = await api("/api/bootstrap");
      data.db = data.db || {};
      data.plan = data.plan || [];
      data.cloudCourses = data.cloudCourses || { courses: [] };
      data.essayLibrary = data.essayLibrary || { items: [] };
      state.data = data;
      if (!state.date) state.date = todayKey();
      if (!dayPlan(state.date) && !displayTasksForDate(state.date).length && data.plan.length) state.date = data.plan[0].date;
      state.calendarMonth = new Date(dateFromKey(state.date).getFullYear(), dateFromKey(state.date).getMonth(), 1);
      renderShell();
      setView(state.view, false);
      if (showMessage) toast("数据已刷新");
      loadArticles(false);
    } catch (error) {
      toast("启动失败：" + error.message, true);
      $("#sidebar-status").innerHTML = '<span class="status-dot warning"></span><div><strong>服务读取失败</strong><small>' +
        esc(error.message) + "</small></div>";
    } finally {
      refresh.disabled = false;
      refresh.classList.remove("loading-spin");
      syncIcons();
    }
  }

  function bindEvents() {
    $("#nav").addEventListener("click", function (event) {
      var button = event.target.closest("[data-view]");
      if (button) setView(button.dataset.view, true);
    });
    $("#menu-button").addEventListener("click", function () { document.body.classList.add("sidebar-open"); });
    $("#sidebar-close").addEventListener("click", function () { document.body.classList.remove("sidebar-open"); });
    $("#sidebar-scrim").addEventListener("click", function () { document.body.classList.remove("sidebar-open"); });
    $("#refresh-btn").addEventListener("click", function () { loadBootstrap(true); });
    $("#date-picker").addEventListener("change", function (event) {
      state.date = event.target.value;
      var selected = dateFromKey(state.date);
      state.calendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
      state.recommendation = null;
      renderCurrentView();
      if (state.view === "articles") selectDailyArticle();
    });
    window.addEventListener("hashchange", function () {
      setView(location.hash.slice(1) || "dashboard", false);
    });
    window.setInterval(function () {
      if (document.hidden) return;
      if (state.data && state.data.appDate !== todayKey()) {
        state.date = todayKey();
        loadBootstrap(false);
      }
      else refreshAiStatus();
    }, 60000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshAiStatus();
    });

    document.addEventListener("click", function (event) {
      var openButton = event.target.closest("[data-open-course]");
      if (openButton) return openCloudCourse(openButton.dataset.openCourse, openButton);
      var startButton = event.target.closest("[data-start-timer]");
      if (startButton) return startTimer(startButton.dataset.startTimer);
      var stopButton = event.target.closest("[data-stop-timer]");
      if (stopButton) return stopTimer();
      var progressButton = event.target.closest("[data-edit-progress]");
      if (progressButton) return openProgressDialog(progressButton.dataset.editProgress);
      var dayButton = event.target.closest("[data-calendar-date]");
      if (dayButton && (dayPlan(dayButton.dataset.calendarDate) || displayTasksForDate(dayButton.dataset.calendarDate).length)) {
        state.date = dayButton.dataset.calendarDate;
        $("#date-picker").value = state.date;
        setView("dashboard", true);
        return;
      }
      var revealIdiomButton = event.target.closest("[data-reveal-idiom]");
      if (revealIdiomButton) {
        state.idiomRevealed[revealIdiomButton.dataset.revealIdiom] = true;
        renderIdioms();
        return;
      }
      var loadMoreIdioms = event.target.closest("#idiom-load-more");
      if (loadMoreIdioms) {
        state.idiomLimit += 48;
        renderIdioms();
        return;
      }
      var idiomButton = event.target.closest("[data-idiom-id]");
      if (idiomButton) return saveIdiom(idiomButton.dataset.idiomId, idiomButton.dataset.idiomStatus);
      var examButton = event.target.closest("[data-edit-exam]");
      if (examButton) return editExam(examButton.dataset.editExam);
      var articleButton = event.target.closest("[data-article-index]");
      if (articleButton && state.articles) {
        state.selectedArticle = state.articles.articles[Number(articleButton.dataset.articleIndex)];
        renderArticles();
      }
    });

    document.addEventListener("change", function (event) {
      if (event.target.matches("[data-task-check]")) {
        toggleTask(event.target.dataset.taskCheck, event.target.checked).catch(function (error) {
          toast(error.message, true);
          renderDashboard();
        });
      }
      if (event.target.matches('input[name="essay_mode"]')) {
        syncEssayAiAvailability();
      }
      if (event.target.matches('input[name="essay_provider"]')) {
        rememberProvider("essay_provider", event.target.value);
        syncEssayAiAvailability();
      }
      if (event.target.matches('input[name="ocr_provider"]')) {
        rememberProvider("ocr_provider", event.target.value);
        syncMistakeAiAvailability();
      }
    });

    $("#progress-form").addEventListener("submit", function (event) {
      event.preventDefault();
      if (event.submitter && event.submitter.value === "cancel") {
        $("#progress-dialog").close();
        return;
      }
      var taskId = $("#progress-slot").value;
      saveProgress(taskId, {
        done: $("#progress-done").checked,
        minutes: $("#progress-minutes").value,
        module: $("#progress-module").value,
        notes: $("#progress-notes").value
      }).then(function () {
        $("#progress-dialog").close();
      }).catch(function (error) {
        toast(error.message, true);
      });
    });

    $("#calendar-prev").addEventListener("click", function () {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    $("#calendar-next").addEventListener("click", function () {
      state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    $("#calendar-today").addEventListener("click", function () {
      var today = dateFromKey(todayKey());
      state.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      state.date = keyFromDate(today);
      $("#date-picker").value = state.date;
      renderCalendar();
    });

    $("#suite-form").addEventListener("submit", submitSuite);
    $("#suite-example-btn").addEventListener("click", function () {
      $("#suite-title").value = "行测模块训练示例";
      $("#suite-text").value = [
        "模块,正确,用时",
        "言语理解,对,52",
        "言语理解,错,67",
        "言语理解,对,44",
        "资料分析,对,71",
        "资料分析,对,76",
        "资料分析,错,103",
        "判断推理,对,49",
        "判断推理,错,82",
        "判断推理,错,74",
        "数量关系,对,92",
        "数量关系,错,138",
        "常识时政,错,18"
      ].join("\n");
    });
    $("#essay-form").addEventListener("submit", submitEssay);
    $("#essay-search").addEventListener("input", renderEssayLibrary);
    $("#mistake-form").addEventListener("submit", submitMistake);
    $("#mistake-file").addEventListener("change", function (event) { setMistakeFile(event.target.files[0]); });
    var dropzone = $("#mistake-dropzone");
    ["dragenter", "dragover"].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.remove("dragover");
      });
    });
    dropzone.addEventListener("drop", function (event) {
      setMistakeFile(event.dataTransfer.files[0]);
    });
    $("#exam-form").addEventListener("submit", submitExam);
    $("#idiom-search").addEventListener("input", function () {
      state.idiomLimit = 48;
      renderIdioms();
    });
    ["#idiom-kind-filter", "#idiom-status-filter"].forEach(function (selector) {
      $(selector).addEventListener("change", function () {
        state.idiomLimit = 48;
        renderIdioms();
      });
    });
    $("#idiom-recall-toggle").addEventListener("click", function () {
      state.idiomRecall = !state.idiomRecall;
      state.idiomRevealed = {};
      renderIdioms();
    });
    $("#course-search").addEventListener("input", renderCourses);
    $("#cloud-rescan-btn").addEventListener("click", rescanCloud);
    $("#article-form").addEventListener("submit", saveArticleNotes);

    window.addEventListener("beforeunload", function () {
      if (!state.activeTimer) return;
      var active = state.activeTimer;
      var elapsed = Math.max(1, Math.round((Date.now() - active.startedAt) / 1000));
      var blob = new Blob([JSON.stringify({ date: active.date, slot: active.slot, seconds: elapsed })], { type: "application/json" });
      navigator.sendBeacon("/api/timer", blob);
    });
  }

  async function init() {
    state.view = viewMeta[location.hash.slice(1)] ? location.hash.slice(1) : "dashboard";
    bindEvents();
    syncIcons();
    await loadBootstrap(false);
  }

  init();
}());
