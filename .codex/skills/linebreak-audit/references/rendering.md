# 렌더링 & 스캔 가이드

줄바꿈은 렌더 결과라서 **반드시 브라우저로 띄워 측정**해야 한다. 정적 HTML만 읽고 줄바꿈을
추정하지 말 것 — 컨테이너 폭·폰트·언어 규칙이 합쳐져야 실제 줄이 정해진다.

## 1. 권장: 번들 런너 (`scripts/run_audit.cjs`)

가장 손이 덜 가고 결정적이다. Playwright 모듈과 캐시된 크로미움을 **자동 탐색**하고, 폰트·레이아웃
정착 후 `scan_linebreaks.js`를 주입해 측정한 뒤 `*.scan.json` + `*.png`를 남긴다.

```bash
node SKILL_DIR/scripts/run_audit.cjs <파일|URL> --label before --viewport 1280x720 --out <WORKDIR>
```

옵션: `--selector "<css>"`(대상 한정) · `--viewport WxH`(슬라이드는 1280x720/1920x1080) ·
`--reveal`(프레임워크 덱 펼치기) · `--dpr 2` · `--no-full`(뷰포트만) · `--json`(요약 대신 JSON).

출력은 점수·등급·유형별 집계 + **심각도순 상위 문제(셀렉터 경로·렌더된 줄·수정 힌트 포함)**.
수정 후 같은 명령을 `--label after`로 다시 돌려 `before.scan.json`↔`after.scan.json`을 비교한다.

> **브라우저가 없을 때:** 런너가 종료코드 2와 함께 안내한다. `npm i -D playwright && npx
> playwright install chromium` 로 설치하거나, 아래 2/3의 대안을 쓴다. 이미 받아둔 크로미움
> 캐시가 있으면 런너가 알아서 그 실행 파일을 찾아 쓴다(버전 불일치도 폴백).

## 2. 대안: browser-harness (CDP 데몬)

사용자 환경에 browser-harness가 있으면 이걸 써도 된다. `js()`는 함수 정의가 섞인 다중문에서
완료값을 잃으므로, **정의와 호출을 2단계로** 나눈다(검증된 패턴):

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
SCAN=open("SKILL_DIR/scripts/scan_linebreaks.js").read()
new_tab("file://<파일경로>"); wait_for_load(); wait_ready()
capture_screenshot("<WORKDIR>/before.png", max_dim=1800)
js(SCAN)                                              # 전역 정의(부수효과)
res = json.loads(js("JSON.stringify(window.__scanLineBreaks())"))
open("<WORKDIR>/before.scan.json","w").write(json.dumps(res, ensure_ascii=False, indent=2))
print(res["summary"])
'
```

처음 여는 페이지는 항상 `new_tab`(사용자 탭을 건드리지 않음). 프레임워크 덱이면 스캔 전에
`js("window.__lbRevealAll()")`를 호출하고 잠깐 기다린다. (첫 연결 시 Chrome에서 "원격 디버깅
허용"을 한 번 켜야 할 수 있다.)

## 3. 대안: chrome-devtools MCP

Chrome이 `--remote-debugging-port`로 떠 있을 때. `new_page` → `resize_page(1280,720)` →
`[data-ready]` 대기 → `evaluate_script`로 `scan_linebreaks.js` 정의 후
`window.__scanLineBreaksJSON()` 호출 → `take_screenshot`.

## 4. 고정 조건 (결정성)

- **같은 뷰포트·DPR**로 before/after를 찍는다. 폭이 다르면 줄바꿈이 달라져 비교가 무의미.
- 한국어 폰트가 시스템에 있어야 한다(macOS `Apple SD Gothic Neo` 기본). 없으면 폴백 폰트로
  폭이 달라질 수 있음을 보고에 명시.
- `[data-ready]`가 있으면 그 신호를 기다린다. 없으면 `load` + `document.fonts.ready` + 짧은
  여유(약 250ms) 후 측정.

## 5. 프레임워크 덱 (reveal.js / impress.js / Swiper 등)

활성 슬라이드만 렌더되고 나머지는 `display:none`/`translate`로 숨겨져 **측정에서 빠진다**.
전수 점검하려면:

- 런너에 `--reveal` 플래그(내부에서 `__lbRevealAll()` 호출 — 모든 섹션을 흐름에 펼침), 또는
- 슬라이드를 한 장씩 넘기며(`?print-pdf` 모드, 키 입력 등) 각 화면을 스캔.

`__lbRevealAll()`은 레이아웃을 임시로 바꾸므로, 스크린샷이 실제 보기와 다를 수 있다 — 슬라이드별
정밀 확인이 필요하면 한 장씩 넘기는 방식을 쓰고, 빠른 전수 탐지는 `--reveal`을 쓴다.

## 6. 산출물 정리

한 감사 단위(WORKDIR)에 다음이면 충분하다:

```
<WORKDIR>/before.scan.json   # 원본 스캔(필수 근거)
<WORKDIR>/before.png         # 원본 스크린샷
<WORKDIR>/after.scan.json    # 수정 후 스캔(개선 검증 시)
<WORKDIR>/after.png          # 수정 후 스크린샷
```
