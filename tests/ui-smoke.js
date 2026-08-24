const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4137";
const artifacts = path.join(__dirname, "..", "output", "playwright");
fs.mkdirSync(artifacts, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launchBrowser() {
  const installedBrowsers = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter((executablePath) => fs.existsSync(executablePath));
  const attempts = [
    { channel: "msedge", headless: true },
    ...installedBrowsers.map((executablePath) => ({ executablePath, headless: true })),
    { headless: true }
  ];
  let lastError;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function assertNoBodyOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  assert(dimensions.scrollWidth <= dimensions.clientWidth + 1, label + " has body horizontal overflow");
}

function waitForProgressResponse(page) {
  return page.waitForResponse(
    (response) => response.url().endsWith("/api/progress") && response.ok(),
    { timeout: 10000 }
  );
}

async function main() {
  const browser = await launchBrowser();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("pageerror", (error) => errors.push("page: " + error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#view-dashboard.active");
  const courseMeta = await page.evaluate(async () => {
    const data = await fetch("/api/bootstrap").then((response) => response.json());
    return {
      videoCount: (data.cloudCourses.courses || []).reduce((sum, course) => sum + Number(course.videoCount || 0), 0),
      root: data.cloudCourses.source,
      strategyCount: (data.cloudCourses.teacherStrategies || []).length,
      planStart: data.plan[0] && data.plan[0].date,
      planEnd: data.plan[data.plan.length - 1] && data.plan[data.plan.length - 1].date,
      planDays: data.plan.length,
      completedCount: Object.values((data.db && data.db.progress) || {}).reduce((total, day) =>
        total + Object.values(day || {}).filter((item) => item && item.done).length, 0)
    };
  });
  assert(courseMeta.planStart === "2026-07-17", "Study plan should start on 2026-07-17");
  assert(courseMeta.planEnd === "2026-11-06", "Study plan should end on 2026-11-06");
  assert(courseMeta.planDays === 113, "Study plan should contain 113 calendar days");
  assert(courseMeta.completedCount === 0, "Initial study plan should have no completed tasks");
  assert((await page.locator("#ai-chip").textContent()).includes("AI"), "AI provider status is missing");
  assert(await page.locator(".task-row").count() === 3, "Dashboard should show three time blocks");
  assert(await page.locator("[data-open-course]").count() >= 2, "Today should include exact cloud course links");
  await assertNoBodyOverflow(page, "dashboard");
  await page.screenshot({ path: path.join(artifacts, "dashboard-desktop.png"), fullPage: true });

  const selectedDateKey = await page.locator("#date-picker").inputValue();
  const morning = page.locator('[data-task-check][data-task-date="' + selectedDateKey + '"][data-task-slot="morning"]');
  const initiallyChecked = await morning.isChecked();
  if (!initiallyChecked) {
    await Promise.all([
      waitForProgressResponse(page),
      morning.click()
    ]);
  }

  await page.locator('[data-view="calendar"]').click();
  await page.waitForSelector("#view-calendar.active");
  assert(await page.locator(".calendar-day").count() === 42, "Calendar should render six weeks");
  const selectedDay = page.locator('.calendar-day[data-calendar-date="' + selectedDateKey + '"]');
  assert(await selectedDay.locator(".calendar-task.done").count() >= 1, "Completed Todo is not struck through in calendar");
  await assertNoBodyOverflow(page, "calendar");
  await page.screenshot({ path: path.join(artifacts, "calendar-desktop.png"), fullPage: true });

  await page.locator('[data-view="dashboard"]').click();
  if (!initiallyChecked) {
    const restoredMorning = page.locator('[data-task-check][data-task-date="' + selectedDateKey + '"][data-task-slot="morning"]');
    await Promise.all([
      waitForProgressResponse(page),
      restoredMorning.click()
    ]);
  }

  const views = ["review", "analytics", "essay", "mistakes", "idioms", "courses", "articles", "exams"];
  for (const view of views) {
    await page.locator('[data-view="' + view + '"]').click();
    await page.waitForSelector("#view-" + view + ".active");
    await assertNoBodyOverflow(page, view);
  }
  await page.locator('[data-view="idioms"]').click();
  await page.waitForSelector("#view-idioms.active");
  const idiomTotal = Number((await page.locator("#idiom-stats strong").first().textContent()).trim());
  assert(idiomTotal >= 1400, "Expanded idiom library should contain at least 1,400 entries");
  assert(await page.locator("#idiom-list .idiom-item").count() <= 48, "Idiom pagination should cap the initial render");
  await page.locator("#idiom-search").fill("蔚然成风");
  assert((await page.locator("#idiom-list").textContent()).includes("四海高频成语实词1000词·下册"), "Shihai source entry is not searchable");
  await page.locator("#idiom-kind-filter").selectOption("词语辨析");
  await page.locator("#idiom-search").fill("哀怜");
  assert((await page.locator("#idiom-list").textContent()).includes("哀怜"), "Word-discrimination source entry is not searchable");
  await page.locator("#idiom-recall-toggle").click();
  assert(await page.locator("#idiom-list .idiom-answer").count() === 0, "Recall mode should hide explanations");
  await page.locator("#idiom-list [data-reveal-idiom]").first().click();
  assert(await page.locator("#idiom-list .idiom-answer").count() === 1, "Recall mode should reveal one selected explanation");
  await assertNoBodyOverflow(page, "idioms");
  await page.screenshot({ path: path.join(artifacts, "idioms-desktop.png"), fullPage: true });
  await page.locator("#idiom-recall-toggle").click();
  await page.locator('[data-view="essay"]').click();
  assert(await page.locator('input[name="essay_provider"]').count() === 2, "Essay provider switch is missing");
  await page.locator('input[name="essay_provider"][value="anthropic"]').check();
  assert((await page.locator("#essay-provider-detail").textContent()).includes("第三方 API"), "Third-party essay provider did not activate");
  await page.screenshot({ path: path.join(artifacts, "ai-provider-switch-current.png"), fullPage: true });
  await page.locator('input[name="essay_mode"][value="rule"]').check();
  assert(await page.locator('input[name="essay_provider"][value="codex"]').isDisabled(), "Rule mode should disable AI provider controls");
  await page.locator('input[name="essay_mode"][value="deep"]').check();
  await page.locator('[data-view="mistakes"]').click();
  assert(await page.locator('input[name="ocr_provider"]').count() === 2, "OCR provider switch is missing");
  assert(!(await page.locator('input[name="ocr_provider"][value="anthropic"]').isDisabled()), "Available third-party OCR provider is disabled");
  await page.locator('input[name="ocr_provider"][value="anthropic"]').check();
  await page.screenshot({ path: path.join(artifacts, "ocr-provider-switch-current.png"), fullPage: true });
  await page.locator("#mistake-list .mistake-stack").evaluate((node) => {
    node.insertAdjacentHTML("afterbegin", '<article class="mistake-item" data-overflow-fixture><span class="teacher-avatar"></span><div class="mistake-content"><span class="module-chip">资料分析</span><h3>基期量计算</h3><p class="mistake-reason"><strong>错因：</strong>考生误将增长率当作基期量直接相乘，并连续写入一段很长的模型分析结果，用于校验任意长度文字都必须限制在错题卡片内部并正常换行。</p><p>题干识别结果与复习建议也应当在当前列宽内完整展示。</p></div></article>');
  });
  const mistakeOverflow = await page.locator('[data-overflow-fixture]').evaluate((node) => ({
    selfOverflow: node.scrollWidth > node.clientWidth + 1,
    contentOverflow: node.querySelector(".mistake-content").scrollWidth > node.querySelector(".mistake-content").clientWidth + 1,
    right: node.getBoundingClientRect().right,
    panelRight: node.closest(".panel").getBoundingClientRect().right
  }));
  assert(!mistakeOverflow.selfOverflow && !mistakeOverflow.contentOverflow && mistakeOverflow.right <= mistakeOverflow.panelRight + 1,
    "Long OCR analysis overflows the mistake card");
  await page.screenshot({ path: path.join(artifacts, "ocr-long-text-regression.png"), fullPage: true });
  await page.locator('[data-overflow-fixture]').evaluate((node) => node.remove());
  assert((await page.locator("#course-summary").textContent()).includes(String(courseMeta.videoCount)), "Cloud video count is missing");
  assert((await page.locator("#essay-count").textContent()).trim() === "835", "Essay library count is incorrect");
  await page.locator('[data-view="courses"]').click();
  assert(courseMeta.root === "/考公资料/26名师课程", "Cloud course root should point to the 2026 collection");
  assert(await page.locator("#course-strategy-list .strategy-row").count() === courseMeta.strategyCount, "Teacher study strategies should render");
  assert(await page.locator('#course-strategy-list a[href*="bilibili.com"]').count() >= 6, "Teacher Bilibili links are missing");
  assert((await page.locator("#course-strategy-list").textContent()).includes("60天第9-21讲直接跳"), "White Egret skip guidance is missing");
  assert(await page.locator('[data-open-course*="/26名师课程/"]').count() >= 10, "Direct 2026 cloud folder links are missing");
  await page.screenshot({ path: path.join(artifacts, "courses-desktop.png"), fullPage: true });

  await page.locator('[data-view="mistakes"]').click();
  await page.locator("#mistake-file").setInputFiles(path.join(artifacts, "courses-desktop.png"));
  const optimizedImage = page.locator("#mistake-preview img");
  await optimizedImage.waitFor();
  const optimized = await optimizedImage.evaluate((image) => ({
    source: image.src.slice(0, 24),
    longestSide: Math.max(image.naturalWidth, image.naturalHeight)
  }));
  assert(optimized.source.startsWith("data:image/jpeg"), "Mistake image was not normalized to JPEG");
  assert(optimized.longestSide <= 2200, "Mistake image was not resized before OCR");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  mobile.on("console", (message) => {
    if (message.type() === "error") errors.push("mobile console: " + message.text());
  });
  mobile.on("pageerror", (error) => errors.push("mobile page: " + error.message));
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  await mobile.waitForSelector("#view-dashboard.active");
  await assertNoBodyOverflow(mobile, "mobile dashboard");
  await mobile.screenshot({ path: path.join(artifacts, "dashboard-mobile.png"), fullPage: true });
  await mobile.locator("#menu-button").click();
  assert(await mobile.locator("body").evaluate((node) => node.classList.contains("sidebar-open")), "Mobile sidebar did not open");
  await mobile.locator('[data-view="calendar"]').click();
  await mobile.waitForSelector("#view-calendar.active");
  await mobile.waitForTimeout(1000);
  assert(!(await mobile.locator("body").evaluate((node) => node.classList.contains("sidebar-open"))), "Mobile sidebar did not close after navigation");
  await assertNoBodyOverflow(mobile, "mobile calendar");
  await mobile.screenshot({ path: path.join(artifacts, "calendar-mobile.png"), fullPage: true });
  await mobile.locator("#menu-button").click();
  await mobile.locator('[data-view="idioms"]').click();
  await mobile.waitForSelector("#view-idioms.active");
  await mobile.waitForTimeout(1000);
  assert(!(await mobile.locator("body").evaluate((node) => node.classList.contains("sidebar-open"))), "Mobile sidebar did not close before idiom interaction");
  await mobile.locator("#idiom-search").fill("蔚然成风");
  assert(await mobile.locator("#idiom-list .idiom-item").count() >= 1, "Mobile idiom search returned no results");
  await assertNoBodyOverflow(mobile, "mobile idioms");
  await mobile.screenshot({ path: path.join(artifacts, "idioms-mobile.png"), fullPage: true });
  await mobile.locator("#menu-button").click();
  await mobile.locator('[data-view="courses"]').click();
  await mobile.waitForSelector("#view-courses.active");
  await mobile.waitForTimeout(500);
  assert(!(await mobile.locator("body").evaluate((node) => node.classList.contains("sidebar-open"))), "Mobile sidebar did not close before course interaction");
  assert(await mobile.locator("#course-strategy-list .strategy-row").count() === courseMeta.strategyCount, "Mobile teacher strategies are missing");
  assert(await mobile.locator('[data-open-course*="/26名师课程/"]').count() >= 10, "Mobile 2026 cloud links are missing");
  await assertNoBodyOverflow(mobile, "mobile courses");
  await mobile.screenshot({ path: path.join(artifacts, "courses-mobile.png"), fullPage: true });

  const rollover = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  rollover.on("console", (message) => {
    if (message.type() === "error") errors.push("rollover console: " + message.text());
  });
  rollover.on("pageerror", (error) => errors.push("rollover page: " + error.message));
  await rollover.clock.install({ time: new Date("2026-07-18T09:00:00+08:00") });
  await rollover.goto(baseUrl, { waitUntil: "networkidle" });
  await rollover.waitForSelector("#view-dashboard.active");
  assert(await rollover.locator("#date-picker").inputValue() === "2026-07-18", "Rollover view should open on 2026-07-18");
  assert(await rollover.locator(".task-row").count() === 6, "Three unfinished tasks should roll into the next day's three tasks");
  assert(await rollover.locator(".task-row.overdue").count() === 3, "Rolled tasks should be visually marked overdue");
  const delayLabels = await rollover.locator(".task-delay").allTextContents();
  assert(delayLabels.length === 3 && delayLabels.every((label) => label.includes("已拖延 1 天")),
    "Rolled tasks should show a one-day delay badge");
  await assertNoBodyOverflow(rollover, "rollover dashboard");
  await rollover.screenshot({ path: path.join(artifacts, "rollover-desktop.png"), fullPage: true });
  await rollover.locator('[data-view="calendar"]').click();
  await rollover.waitForSelector("#view-calendar.active");
  const july17 = rollover.locator('.calendar-day[data-calendar-date="2026-07-17"]');
  const july18 = rollover.locator('.calendar-day[data-calendar-date="2026-07-18"]');
  assert(await july17.locator(".calendar-task.postponed").count() === 3,
    "Original calendar day should retain three postponed task records");
  assert(await july18.locator(".calendar-task.overdue").count() === 3,
    "Next calendar day should display three carried tasks");
  await assertNoBodyOverflow(rollover, "rollover calendar");
  await rollover.screenshot({ path: path.join(artifacts, "rollover-calendar-desktop.png"), fullPage: true });
  await rollover.close();

  assert(errors.length === 0, errors.join("\n"));
  process.stdout.write(JSON.stringify({
    ok: true,
    screenshots: fs.readdirSync(artifacts).filter((name) => name.endsWith(".png")),
    imageOptimization: "jpeg <= 2200px",
    consoleErrors: errors
  }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(error.stack || String(error));
  process.exitCode = 1;
});
