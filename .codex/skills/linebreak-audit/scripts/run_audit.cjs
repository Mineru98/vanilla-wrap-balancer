#!/usr/bin/env node
/*
 * run_audit.cjs — 줄바꿈 감사 실행 엔진 (헤드리스 렌더 + 스캔 + 스크린샷).
 *
 * 줄바꿈은 렌더 결과라서 정적 분석으론 알 수 없다. 이 스크립트는 페이지를 헤드리스
 * 크로미움으로 띄워 폰트·레이아웃이 정착한 뒤 scan_linebreaks.js 를 주입해 측정한다.
 * "수정"은 이 스크립트가 하지 않는다 — 모델이 원본 HTML을 고친 뒤 같은 명령으로 다시
 * 스캔해(label after) 점수 변화를 비교한다.
 *
 * 사용:
 *   node run_audit.cjs <파일경로|URL> [옵션]
 *     --label <이름>      출력 파일 접두사(기본 scan). 보통 before / after.
 *     --selector "<css>"  검사 대상을 한정(기본: 자동 후보 탐지).
 *     --viewport WxH      뷰포트(기본 1280x720). 슬라이드 덱은 1280x720 또는 1920x1080.
 *     --dpr <n>           devicePixelRatio(기본 2).
 *     --reveal            프레임워크 덱(reveal.js 등)의 숨은 슬라이드를 모두 펼쳐 스캔.
 *     --no-full           전체 페이지 대신 뷰포트만 스크린샷.
 *     --out <dir>         산출물 디렉터리(기본 현재 폴더).
 *     --json              사람용 요약 대신 JSON만 출력.
 *
 * 산출물: <out>/<label>.scan.json, <out>/<label>.png
 * 종료코드: 0 정상 / 2 렌더 불가(브라우저 없음 등) — 메시지로 대안 안내.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

function parseArgs(argv) {
  const a = { target: null, label: "scan", selector: null, viewport: "1280x720", dpr: 2, reveal: false, full: true, out: process.cwd(), json: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--label") a.label = rest[++i];
    else if (t === "--selector") a.selector = rest[++i];
    else if (t === "--viewport") a.viewport = rest[++i];
    else if (t === "--dpr") a.dpr = parseFloat(rest[++i]);
    else if (t === "--reveal") a.reveal = true;
    else if (t === "--no-full") a.full = false;
    else if (t === "--out") a.out = rest[++i];
    else if (t === "--json") a.json = true;
    else if (!t.startsWith("--") && !a.target) a.target = t;
  }
  return a;
}

// playwright 모듈을 여러 후보 경로에서 찾는다(로컬/글로벌/중첩 의존성).
function loadPlaywright() {
  const cands = ["playwright", "playwright-core"];
  let groot = null;
  try { groot = execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) {}
  if (groot) {
    cands.push(
      path.join(groot, "playwright"),
      path.join(groot, "playwright-core"),
      path.join(groot, "@playwright", "test"),
      path.join(groot, "@playwright", "mcp", "node_modules", "playwright"),
      path.join(groot, "@playwright", "cli", "node_modules", "playwright"),
      path.join(groot, "playwright-cli", "node_modules", "playwright")
    );
  }
  for (const c of cands) {
    try {
      const pw = require(c);
      if (pw && pw.chromium) return pw;
    } catch (e) {}
  }
  return null;
}

// 캐시된 크로미움/헤드리스셸 실행 파일을 최신 빌드 순으로 찾는다(버전 불일치 폴백).
function findCachedChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
  ].filter(Boolean);
  const found = [];
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (e) { continue; }
    for (const d of dirs) {
      const m = /^chromium(_headless_shell)?-(\d+)$/.exec(d);
      if (!m) continue;
      const build = parseInt(m[2], 10);
      const headless = !!m[1];
      const base = path.join(root, d);
      const guesses = [
        path.join(base, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        path.join(base, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        path.join(base, "chrome-headless-shell-linux", "chrome-headless-shell"),
        path.join(base, "chrome-headless-shell-win", "chrome-headless-shell.exe"),
        path.join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(base, "chrome-linux", "chrome"),
        path.join(base, "chrome-win", "chrome.exe"),
      ];
      for (const g of guesses) {
        if (fs.existsSync(g)) { found.push({ exe: g, build, headless }); break; }
      }
    }
  }
  // 헤드리스셸 우선, 그다음 최신 빌드
  found.sort((a, b) => (b.headless - a.headless) || (b.build - a.build));
  return found.length ? found[0].exe : null;
}

async function launch(pw) {
  try {
    return await pw.chromium.launch();
  } catch (e) {
    const exe = findCachedChromium();
    if (!exe) throw e;
    return await pw.chromium.launch({ executablePath: exe });
  }
}

const FIX_HINT = {
  midword_break: "대상 요소에 word-break: keep-all; overflow-wrap: anywhere; (break-all 제거)",
  orphan: "wrap-balancer 적용(data-br-balance) — 마지막 줄 외톨이 해소",
  imbalance: "wrap-balancer 적용(data-br-balance) — 줄 너비 균형",
  overflow: "white-space:normal로 줄바꿈 허용 / 고정 height·width 제거 / overflow-wrap:anywhere",
  semantic_split: "숫자와 단위 사이를 &nbsp; 또는 <wbr> 로 묶기",
  excess_lines: "컨테이너 폭을 넓히거나 폰트를 줄여 줄 수 축소 + wrap-balancer로 균형",
};

async function main() {
  const a = parseArgs(process.argv);
  if (!a.target) {
    console.error("사용법: node run_audit.cjs <파일경로|URL> [--label before] [--selector S] [--viewport 1280x720] [--reveal]");
    process.exit(2);
  }
  const pw = loadPlaywright();
  if (!pw) {
    console.error("[render unavailable] Playwright를 찾지 못했습니다.\n" +
      "  해결: `npm i -D playwright && npx playwright install chromium` 또는\n" +
      "  references/rendering.md 의 browser-harness / chrome-devtools MCP 경로를 사용하세요.");
    process.exit(2);
  }
  const scanSrc = fs.readFileSync(path.join(__dirname, "scan_linebreaks.js"), "utf8");
  const [vw, vh] = a.viewport.split("x").map((n) => parseInt(n, 10));
  const url = /^https?:|^file:/.test(a.target) ? a.target : "file://" + path.resolve(a.target);

  let browser;
  try {
    browser = await launch(pw);
  } catch (e) {
    console.error("[render unavailable] 크로미움 실행 실패: " + e.message + "\n" +
      "  `npx playwright install chromium` 로 브라우저를 설치하거나 rendering.md 의 대안을 사용하세요.");
    process.exit(2);
  }
  const page = await browser.newPage({ viewport: { width: vw || 1280, height: vh || 720 }, deviceScaleFactor: a.dpr || 2 });
  await page.goto(url, { waitUntil: "load" }).catch(() => {});
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ready") === "1", { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : true).catch(() => {});
  await page.waitForTimeout(250);

  await page.evaluate(scanSrc); // 전역 정의(+1회 실행, 반환값 무시)
  if (a.reveal) {
    await page.evaluate(() => window.__lbRevealAll && window.__lbRevealAll());
    await page.waitForTimeout(250);
  }
  const opts = a.selector ? { selector: a.selector } : {};
  const res = await page.evaluate((o) => window.__scanLineBreaks(o), opts);

  fs.mkdirSync(a.out, { recursive: true });
  const jsonPath = path.join(a.out, a.label + ".scan.json");
  const pngPath = path.join(a.out, a.label + ".png");
  fs.writeFileSync(jsonPath, JSON.stringify(res, null, 2));
  await page.screenshot({ path: pngPath, fullPage: a.full }).catch(() => {});
  await browser.close();

  if (a.json) {
    console.log(JSON.stringify(res));
    return;
  }
  const s = res.summary;
  const L = [];
  L.push("== 줄바꿈 감사: " + a.label + " ==");
  L.push("점수 " + s.page_score + "/100 (" + s.grade + ", " + s.verdict + ")  |  검사 " + s.scanned + " · 줄바꿈 " + s.wrapped + " · 문제 " + s.findings);
  L.push("문제유형: " + (Object.keys(s.by_problem).length ? JSON.stringify(s.by_problem) : "없음"));
  L.push("산출물: " + path.relative(process.cwd(), jsonPath) + " , " + path.relative(process.cwd(), pngPath));
  if (res.findings.length) {
    L.push("");
    L.push("심각도순 상위:");
    const ranked = res.findings.slice().sort((x, y) =>
      (y.weight * (y.problems[0] ? y.problems[0].severity : 0)) - (x.weight * (x.problems[0] ? x.problems[0].severity : 0)));
    for (const f of ranked.slice(0, 12)) {
      const sl = f.slide ? (f.slide.label + (f.slide.index >= 0 ? "[" + f.slide.index + "]" : "")) : "-";
      const probs = f.problems.map((p) => p.type + "(" + p.severity + ")").join(", ");
      L.push("  • [" + sl + "] " + f.tag + " w" + f.weight + " — " + probs);
      L.push("    \"" + (f.text.length > 50 ? f.text.slice(0, 50) + "…" : f.text) + "\"");
      if (f.lines) L.push("    줄: " + JSON.stringify(f.lines));
      L.push("    경로: " + f.path);
      const hints = [...new Set(f.problems.map((p) => FIX_HINT[p.type]).filter(Boolean))];
      if (hints.length) L.push("    → " + hints.join(" / "));
    }
  }
  console.log(L.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
