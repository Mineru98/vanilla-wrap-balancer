# 전/후 렌더링 & 스크린샷 가이드

목표: **같은 텍스트·너비·폰트**에서 밸런싱 전(before)과 후(after)를 각각 PNG로 찍어
`/oh-my-claudecode:visual-verdict`와 `balance-quality-evaluator`에 넘길 수 있게 한다.
한국어 폰트가 로드된 뒤 밸런싱이 끝난 시점에 찍는 것이 핵심이다.

## 1. 하니스 생성

```bash
python3 .claude/skills/wrap-balancer/scripts/make_harness.py \
  --title "모든 화면 크기에서 더 읽기 좋은 제목을 만들어 보세요" \
  --width 360 --font-size 28 --line-height 1.35 \
  --out <WORKDIR>/harness
```

여러 제목·여러 너비도 가능(`--title` 반복, `--width 320,375,480`). 출력:
`before.html`, `after.html`, `compare.html`, `wrap-balancer.min.js`(헤르메틱 복사본).

> 하니스의 `after.html`은 일부러 **JS 경로(`prefer-native="false"`)** 로 밸런싱한다 —
> 스크린샷 브라우저의 네이티브 `text-wrap:balance` 지원 여부와 무관하게 결과가 결정적이게
> 하려는 것. 실제 프로젝트 주입은 기본(네이티브 우선)을 쓴다. `compare.html`에 네이티브
> 열도 있어 사람이 눈으로 비교할 수 있다.

## 2. 준비 신호: `[data-ready]`

두 페이지 모두 **웹폰트 로드 + (after는) 밸런싱 정착** 후에야
`document.documentElement[data-ready]`를 `"1"`로 만든다. 스크린샷 전에 이 속성을 기다리면
`sleep` 추측 없이 안정적으로 찍을 수 있다.

## 3. 고정 조건 (결정성)

- **같은 뷰포트**로 before/after 모두 찍는다(예: 980×760). 폭이 다르면 비교가 무의미.
- 한국어 폰트가 시스템에 있어야 한다(macOS: `Apple SD Gothic Neo` 기본 존재).
- 가능하면 `devicePixelRatio`도 동일하게.
- **모바일 폭은 CDP 디바이스 에뮬레이션으로 흉내 내지 말 것.** 측정 대상 폭은 하니스의
  `--width`로 컨테이너에 직접 박으면 된다(에뮬레이션 불필요·결정적). 일부 환경에서
  `cdp('Emulation.setDeviceMetricsOverride')`는 sessionId 오류를 내므로 피한다 — 뷰포트는
  박스를 다 담을 만큼만(예: 980×760) 잡고, 좁은 폭 재현은 `--width 335` 식으로 처리한다.

## 4. 도구별 렌더링 방법 (있는 것 사용)

아래 중 환경에 존재하는 것을 쓴다. 우선순위는 상황에 따라 다르나, **browser-harness**가
가장 손이 덜 가고(데몬 자동 기동), **chrome-devtools MCP**는 Chrome이 디버그 포트로 떠 있을
때 쓴다. 둘 다 없으면 Playwright 폴백.

### A) browser-harness (권장, CDP 데몬 자동)

```bash
browser-harness -c '
import time
def wait_ready(t=8):
    t0=time.time()
    while time.time()-t0<t:
        try:
            if js("document.documentElement.getAttribute(\"data-ready\")")=="1": return True
        except Exception: pass
        time.sleep(0.15)
    return False

new_tab("file://<WORKDIR>/harness/before.html"); wait_for_load(); wait_ready()
capture_screenshot("<WORKDIR>/harness/before.png", max_dim=1800)

goto_url("file://<WORKDIR>/harness/after.html"); wait_for_load(); wait_ready()
capture_screenshot("<WORKDIR>/harness/after.png", max_dim=1800)
'
```

`new_tab`은 새 탭에서 열어 사용자의 작업 탭을 건드리지 않는다(첫 내비게이션은 항상 `new_tab`).

> **browser-harness `js()` 함정 (검증됨).** `js()`는 단일 표현식·`JSON.stringify(...)` 문자열·
> 단순 배열은 그대로 돌려주지만, 함수 정의가 섞인 다중문은 완료값을 잃고 `None`을 반환한다.
> 따라서 측정 스크립트는 **두 번에 나눠** 호출한다: 먼저 `js(measure)`로 `window.__wbMeasure`를
> 정의(부수효과)하고, 이어 `js("JSON.stringify(window.__wbMeasure())")`로 문자열을 받아
> 파이썬에서 `json.loads`로 파싱한다(아래 §5 참조).

### B) chrome-devtools MCP

전제: Chrome이 `--remote-debugging-port=9222`로 실행 중이어야 한다(아니면 연결 실패).
사용 도구: `mcp__chrome-devtools__new_page` → `resize_page(980,760)` →
`wait_for(["적용 후"])` 또는 `[data-ready]` 폴링 → `take_screenshot(filePath=…, fullPage=true)`.
before/after 각각 `new_page`로 연다.

### C) Playwright 폴백 (Node)

```bash
npx -y playwright@latest install chromium >/dev/null 2>&1
node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 980, height: 760 } });
  for (const name of ["before","after"]) {
    await p.goto("file://<WORKDIR>/harness/"+name+".html");
    await p.waitForFunction(() => document.documentElement.getAttribute("data-ready")==="1", {timeout: 8000});
    await p.screenshot({ path: "<WORKDIR>/harness/"+name+".png", fullPage: true });
  }
  await b.close();
})();
'
```

## 5. (선택) 객관 지표 → metrics.json

`scripts/measure_lines.js`를 **before/after 각 페이지에서** 평가해 줄 수·줄별 너비를 얻는다.
이를 합쳐 `metrics.json`으로 저장하면 평가 에이전트가 수치 근거로 채점한다.

검증된 browser-harness 스니펫(정의/측정 2단계 호출):

```bash
browser-harness -c '
import time, json
def wait_ready(t=8):
    t0=time.time()
    while time.time()-t0<t:
        try:
            if js("document.documentElement.getAttribute(\"data-ready\")")=="1": return True
        except Exception: pass
        time.sleep(0.15)
    return False
m = open(".claude/skills/wrap-balancer/scripts/measure_lines.js").read()
new_tab("file://<WORKDIR>/harness/before.html"); wait_for_load(); wait_ready()
js(m); before = json.loads(js("JSON.stringify(window.__wbMeasure())"))
goto_url("file://<WORKDIR>/harness/after.html"); wait_for_load(); wait_ready()
js(m); after = json.loads(js("JSON.stringify(window.__wbMeasure())"))
open("<WORKDIR>/harness/metrics.json","w").write(json.dumps({"before":before,"after":after}, ensure_ascii=False, indent=2))
print("metrics.json written")
'
```

저장되는 `metrics.json` 형태:

```json
{
  "before": [ { "index":0, "container_px":360, "line_count":2,
               "line_widths":[300,150], "max_minus_min":150, "last_line_ratio":0.5, "text":"…" } ],
  "after":  [ { "index":0, "container_px":360, "line_count":2,
               "line_widths":[230,225], "max_minus_min":5,  "last_line_ratio":0.98, "text":"…" } ]
}
```

`last_line_ratio`가 낮을수록(전) 마지막 줄 외톨이 위험이 크고, `max_minus_min`이
작을수록(후) 줄 너비가 고르다 — C1·C2 채점의 직접 근거.

## 6. 산출물 정리

한 평가 단위(WORKDIR)에 다음이 있으면 충분하다:

```
<WORKDIR>/harness/before.png      # visual-verdict reference / 에이전트 입력
<WORKDIR>/harness/after.png       # visual-verdict generated / 에이전트 입력
<WORKDIR>/harness/metrics.json    # (선택) 객관 지표
<WORKDIR>/harness/compare.html    # 사람이 보는 나란히 비교
```
