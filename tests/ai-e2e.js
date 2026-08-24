const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const baseUrl = "http://127.0.0.1:4137";
const artifacts = path.join(root, "artifacts");
const dbFile = path.join(root, "data", "db.json");
const uploadsDir = path.join(root, "data", "uploads");
const runMarker = `__AI_E2E__${Date.now()}`;
const providerLabels = { codex: "本机 Codex", anthropic: "第三方 API" };
const providerSelection = String(process.env.AI_E2E_PROVIDERS || "").trim();
const requestedProviders = String(providerSelection || "anthropic,codex")
  .split(",")
  .map((item) => item.trim())
  .filter((item) => Object.prototype.hasOwnProperty.call(providerLabels, item));
const supportedCapabilities = new Set(["deep", "web", "ocr"]);
const requestedCapabilities = String(process.env.AI_E2E_CAPABILITIES || "deep,web,ocr")
  .split(",")
  .map((item) => item.trim())
  .filter((item) => supportedCapabilities.has(item));

fs.mkdirSync(artifacts, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function elapsed(startedAt) {
  return Math.round((Date.now() - startedAt) / 1000);
}

function log(event, detail = {}) {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...detail })}\n`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "msedge", headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

function cleanupTestData() {
  if (!fs.existsSync(dbFile)) return { essays: 0, mistakes: 0, images: 0 };
  const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  const isTestEssay = (item) => /^__(AI_E2E|PROBE_DUAL)__/.test(String(item.title || ""));
  const isTestMistake = (item) => /^__(AI_E2E|PROBE_DUAL)__/.test(String(item.fileName || ""));
  const removedEssays = (db.essays || []).filter(isTestEssay);
  const removedMistakes = (db.mistakes || []).filter(isTestMistake);

  db.essays = (db.essays || []).filter((item) => !isTestEssay(item));
  db.mistakes = (db.mistakes || []).filter((item) => !isTestMistake(item));
  fs.writeFileSync(dbFile, `${JSON.stringify(db, null, 2)}\n`, "utf8");

  let images = 0;
  for (const item of removedMistakes) {
    const imagePath = path.resolve(String(item.imagePath || ""));
    if (!imagePath.startsWith(path.resolve(uploadsDir) + path.sep)) continue;
    try {
      fs.unlinkSync(imagePath);
      images += 1;
    } catch {}
  }
  return { essays: removedEssays.length, mistakes: removedMistakes.length, images };
}

async function createOcrFixture(browser) {
  const fixture = path.join(artifacts, "ai-e2e-question.png");
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1.5 });
  await page.setContent(`
    <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body { margin: 0; background: #eef1f4; font-family: "Microsoft YaHei", sans-serif; color: #111827; }
      main { width: 900px; margin: 55px auto; padding: 44px 52px; background: white; border: 1px solid #ccd3dc; }
      h1 { margin: 0 0 28px; font-size: 30px; }
      p { font-size: 25px; line-height: 1.75; margin: 12px 0; }
      .options { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 32px; margin: 24px 0; }
      .mark { margin-top: 28px; padding-top: 22px; border-top: 2px solid #dc2626; color: #991b1b; }
    </style></head><body><main>
      <h1>资料分析练习题</h1>
      <p>2025年，某市新能源汽车产量为120万辆，同比增长20%。</p>
      <p><strong>问题：</strong>2024年该市新能源汽车产量约为多少万辆？</p>
      <div class="options"><p>A. 80</p><p>B. 90</p><p>C. 100</p><p>D. 110</p></div>
      <p class="mark">考生作答：D　正确答案：C</p>
    </main></body></html>
  `);
  await page.screenshot({ path: fixture, fullPage: true });
  await page.close();
  return fixture;
}

async function activateEssayProvider(page, provider, mode) {
  await page.locator('[data-view="essay"]').click();
  await page.waitForSelector("#view-essay.active");
  const modeInput = page.locator(`input[name="essay_mode"][value="${mode}"]`);
  await modeInput.check();
  const providerInput = page.locator(`input[name="essay_provider"][value="${provider}"]`);
  assert(!(await providerInput.isDisabled()), `${provider} essay provider is disabled`);
  await providerInput.check();
  assert(await providerInput.isChecked(), `${provider} essay provider did not activate`);
  assert((await page.locator("#essay-provider-detail").textContent()).includes(providerLabels[provider]), `${provider} essay provider detail is stale`);
}

async function submitEssay(page, provider, mode) {
  await activateEssayProvider(page, provider, mode);
  const isWeb = mode === "web";
  const title = isWeb ? "联网答案比对" : "深度批改";
  const prompt = isWeb
    ? "围绕‘调查研究是谋事之基、成事之道’，联系基层工作实际，自拟标题写一篇议论文。"
    : "请概括某地推进基层数字治理过程中存在的问题，并提出改进建议。不超过300字。材料要点包括平台重复建设、数据壁垒、基层填表负担和群众适老化使用困难。";
  const answer = isWeb
    ? "以深入调研提升基层治理效能。调查研究连接决策与实践。基层情况复杂，只有走进群众、掌握真问题，政策才能有的放矢。要坚持问题导向，综合运用走访、座谈和数据分析，既听干部意见，也听群众呼声；要反对走马观花，形成问题清单并跟踪整改；还要把调研成果转化为制度和服务流程。以求真务实的调查研究发现问题、破解难题，才能不断提升基层治理的精准度和群众获得感。"
    : "该地数字治理主要存在四方面问题：一是平台重复建设，标准不一，造成资源浪费；二是部门间数据壁垒突出，信息共享不足；三是基层重复录入、填表留痕，增加工作负担；四是部分系统忽视老年群体需求，群众使用不便。建议统一平台建设和数据标准，建立跨部门共享机制，清理重复报表并以实际成效评价基层工作；同时保留线下服务，优化适老化界面，加强人员培训和反馈整改。";

  await page.locator("#essay-title").fill(`${runMarker}-${provider}-${title}`);
  await page.locator("#essay-prompt").fill(prompt);
  await page.locator("#essay-answer").fill(answer);

  const startedAt = Date.now();
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/essay/grade") && response.request().method() === "POST",
    { timeout: 960000 }
  );
  await page.locator("#essay-grade-btn").click();
  assert(await page.locator("#essay-grade-btn").isDisabled(), `${provider} ${mode} submit did not enter loading state`);
  assert((await page.locator("#essay-progress").textContent()).includes(providerLabels[provider]), `${provider} ${mode} progress is not visible`);
  log("essay-started", { provider, mode });

  const response = await responsePromise;
  const payload = await response.json();
  if (!response.ok()) {
    const error = new Error(`${provider} ${mode} failed: ${payload.error || response.status()}`);
    error.code = payload.code || "REQUEST_FAILED";
    error.payload = payload;
    throw error;
  }

  const grade = payload.grade;
  const meta = payload.aiMeta;
  assert(Number.isInteger(grade?.score), `${provider} ${mode} score is missing`);
  assert(Array.isArray(grade?.dimensions) && grade.dimensions.length >= 3, `${provider} ${mode} dimensions are incomplete`);
  assert(String(grade?.revisedAnswer || "").length >= 50, `${provider} ${mode} revised answer is too short`);
  assert(meta?.provider === provider, `${provider} ${mode} returned the wrong provider`);
  assert(String(meta?.model || "").length > 0, `${provider} ${mode} model provenance is missing`);
  assert(Number(meta?.latencyMs) > 0, `${provider} ${mode} latency provenance is missing`);
  assert(!Number.isNaN(Date.parse(meta?.verifiedAt)), `${provider} ${mode} verification timestamp is invalid`);

  if (isWeb) {
    assert(String(meta.webSearch?.engine || "").includes("Bing RSS"), `${provider} web search engine provenance is missing`);
    assert(Number(meta.webSearch?.evidenceCount) > 0, `${provider} web retrieval returned no evidence`);
    assert(Number(meta.webSearch?.candidateCount) >= Number(meta.webSearch?.evidenceCount), `${provider} web candidate count is invalid`);
    assert(Number(meta.webSearch?.averageRelevance) >= Number(meta.webSearch?.relevanceThreshold), `${provider} web evidence relevance is below threshold`);
    assert(Array.isArray(grade.webSources) && grade.webSources.length > 0, `${provider} web comparison returned no sources`);
    assert(grade.webSources.every((item) => /^https?:\/\//i.test(item.url)), `${provider} web comparison returned an invalid source URL`);
    assert(grade.webSources.every((item) => Number(item.relevanceScore) >= Number(meta.webSearch.relevanceThreshold)), `${provider} web comparison exposed low-relevance evidence`);
    assert(grade.webSources.every((item) => !/AI\s*工具|AI\s*助手|工具导航|软件下载|应用下载|广告|推广/i.test(`${item.title} ${item.note}`)), `${provider} web comparison exposed an advertisement source`);
    assert(grade.webSources.some((item) => /调查|调研|谋事|成事|基层治理/.test(`${item.title} ${item.note}`)), `${provider} web sources do not match the essay topic`);
    assert(Array.isArray(grade.comparisons) && grade.comparisons.length > 0, `${provider} web comparison returned no comparisons`);
  } else {
    assert(Array.isArray(grade.comparisons) && grade.comparisons.length === 0, `${provider} deep mode claimed unverified answer comparisons`);
    assert(Array.isArray(grade.webSources) && grade.webSources.length === 0, `${provider} deep mode claimed unverified web sources`);
  }

  await page.locator("#essay-result:not([hidden])").waitFor({ timeout: 15000 });
  const provenance = await page.locator("#essay-result .ai-provenance").textContent();
  assert(provenance.includes(providerLabels[provider]) && provenance.includes(meta.model), `${provider} ${mode} provenance was not rendered`);
  if (!isWeb) assert(await page.locator("#essay-result .source-list").count() === 0, `${provider} deep UI rendered unverified sources`);
  if (isWeb) assert((await page.locator("#essay-result").textContent()).includes("高相关证据"), `${provider} web evidence quality was not rendered`);

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
  });
  await page.screenshot({ path: path.join(artifacts, `ai-${provider}-${mode}-essay.png`), fullPage: true });
  const result = {
    seconds: elapsed(startedAt),
    score: grade.score,
    dimensions: grade.dimensions.length,
    model: meta.model,
    corrected: Boolean(meta.corrected),
    comparisons: grade.comparisons.length,
    sources: grade.webSources.length,
    evidence: Number(meta.webSearch?.evidenceCount || 0),
    verifiedPages: Number(meta.webSearch?.verifiedPageCount || 0),
    authoritySources: Number(meta.webSearch?.authorityCount || 0),
    averageRelevance: Number(meta.webSearch?.averageRelevance || 0)
  };
  log("essay-completed", { provider, mode, ...result });
  return result;
}

async function submitOcr(page, provider, fixture) {
  await page.locator('[data-view="mistakes"]').click();
  await page.waitForSelector("#view-mistakes.active");
  const providerInput = page.locator(`input[name="ocr_provider"][value="${provider}"]`);
  assert(!(await providerInput.isDisabled()), `${provider} OCR provider is disabled`);
  await providerInput.check();
  assert((await page.locator("#ocr-provider-detail").textContent()).includes(providerLabels[provider]), `${provider} OCR provider detail is stale`);
  await page.locator("#mistake-file").setInputFiles({
    name: `${runMarker}-${provider}-question.png`,
    mimeType: "image/png",
    buffer: fs.readFileSync(fixture)
  });
  await page.locator("#mistake-preview img").waitFor({ timeout: 20000 });
  await page.locator("#mistake-text").fill("自动化验收：请核对增长率基期量计算、考生选项和正确答案。");

  const startedAt = Date.now();
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/mistakes") && response.request().method() === "POST",
    { timeout: 960000 }
  );
  await page.locator("#mistake-btn").click();
  assert(await page.locator("#mistake-btn").isDisabled(), `${provider} OCR submit did not enter loading state`);
  assert((await page.locator("#mistake-progress").textContent()).includes(providerLabels[provider]), `${provider} OCR progress is not visible`);
  log("ocr-started", { provider });

  const response = await responsePromise;
  const payload = await response.json();
  if (!response.ok()) {
    const error = new Error(`${provider} OCR failed: ${payload.error || response.status()}`);
    error.code = payload.code || "REQUEST_FAILED";
    error.payload = payload;
    throw error;
  }
  const mistake = payload.mistake;
  const analysis = mistake?.analysis;
  const meta = mistake?.aiMeta || payload.aiMeta;
  assert(analysis && String(analysis.transcription || "").length >= 30, `${provider} OCR transcription is missing or too short`);
  assert(/资料|数量/.test(String(mistake.module || "")), `${provider} OCR module is unexpected: ${mistake.module}`);
  assert(/120/.test(analysis.transcription) && /20%|20％/.test(analysis.transcription) && /100/.test(analysis.transcription), `${provider} OCR missed key numerical text`);
  assert(Array.isArray(analysis.tags) && analysis.tags.length > 0, `${provider} OCR tags are missing`);
  assert(meta?.provider === provider, `${provider} OCR returned the wrong provider`);
  assert(String(meta?.model || "").length > 0 && Number(meta?.latencyMs) > 0, `${provider} OCR provenance is incomplete`);
  assert(!Number.isNaN(Date.parse(meta?.verifiedAt)), `${provider} OCR verification timestamp is invalid`);

  const first = page.locator("#mistake-list .mistake-item").first();
  await first.waitFor({ timeout: 15000 });
  const provenance = await first.locator(".mistake-provenance").textContent();
  assert(provenance.includes(providerLabels[provider]) && provenance.includes(meta.model), `${provider} OCR provenance was not rendered`);
  await page.screenshot({ path: path.join(artifacts, `ai-${provider}-ocr.png`), fullPage: true });
  const result = {
    seconds: elapsed(startedAt),
    model: meta.model,
    module: mistake.module,
    questionType: mistake.type,
    transcriptionLength: analysis.transcription.length,
    tags: analysis.tags
  };
  log("ocr-completed", { provider, ...result });
  return result;
}

async function main() {
  const staleCleaned = cleanupTestData();
  log("stale-test-data-cleaned", staleCleaned);
  const browser = await launchBrowser();
  const errors = [];
  const results = {};

  try {
    const fixture = await createOcrFixture(browser);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("#view-dashboard.active");
    const aiChipText = String(await page.locator("#ai-chip").textContent()).trim();
    assert(aiChipText.includes("AI") && !aiChipText.includes("检测"), "AI provider status did not finish loading");

    const initial = await page.evaluate(async () => {
      const [status, bootstrap] = await Promise.all([
        fetch("/api/ai/status").then((response) => response.json()),
        fetch("/api/bootstrap").then((response) => response.json())
      ]);
      return { status, serialized: JSON.stringify({ status, bootstrap }) };
    });
    assert(!/ANTHROPIC_API_KEY|x-api-key|"apiKey"\s*:/i.test(initial.serialized), "A server credential leaked into a browser response");

    assert(requestedProviders.length > 0, "AI_E2E_PROVIDERS did not contain a supported provider");
    assert(requestedCapabilities.length > 0, "AI_E2E_CAPABILITIES did not contain a supported capability");
    const unavailableProviders = requestedProviders.filter((provider) => !initial.status.providers[provider]?.available);
    if (providerSelection) {
      assert(
        unavailableProviders.length === 0,
        unavailableProviders
          .map((provider) => `${providerLabels[provider]} is unavailable: ${initial.status.providers[provider]?.lastError || "unknown"}`)
          .join("\n")
      );
    }
    const activeProviders = requestedProviders.filter((provider) => initial.status.providers[provider]?.available);
    assert(activeProviders.length > 0, "No requested AI provider is currently available");
    for (const provider of unavailableProviders) {
      log("provider-skipped", {
        provider,
        state: initial.status.providers[provider]?.state || "unavailable",
        reason: initial.status.providers[provider]?.lastError || "unknown",
        retryAt: initial.status.providers[provider]?.retryAt || null
      });
    }
    for (const provider of activeProviders) {
      results[provider] = {};
      if (requestedCapabilities.includes("deep")) results[provider].deep = await submitEssay(page, provider, "deep");
      if (requestedCapabilities.includes("web")) results[provider].web = await submitEssay(page, provider, "web");
      if (requestedCapabilities.includes("ocr")) results[provider].ocr = await submitOcr(page, provider, fixture);
    }

    const finalStatus = await page.evaluate(async () => (await fetch("/api/ai/status")).json());
    for (const provider of activeProviders) {
      const status = finalStatus.providers[provider];
      assert(status.verified, `${provider} was not marked as verified`);
      if (requestedCapabilities.includes("deep")) assert(status.textVerified, `${provider} text output was not marked as verified`);
      if (requestedCapabilities.includes("web")) assert(status.webVerified, `${provider} web comparison was not marked as verified`);
      if (requestedCapabilities.includes("ocr")) assert(status.visionVerified, `${provider} vision output was not marked as verified`);
    }
    assert(errors.length === 0, errors.join("\n"));
    log("ai-e2e-completed", {
      ok: true,
      status: `${activeProviders.length} provider(s) x ${requestedCapabilities.length} capability(s) verified`,
      skippedProviders: unavailableProviders,
      results
    });
  } finally {
    await browser.close();
    const cleaned = cleanupTestData();
    log("test-data-cleaned", cleaned);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
