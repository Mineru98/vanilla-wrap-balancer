---
name: linebreak-audit
description: >-
  HTML로 만든 페이지·발표 자료(슬라이드 덱)를 헤드리스로 렌더해 줄바꿈이 어색한 곳을
  전수로 찾아내고(어절 중간 끊김·마지막 줄 외톨이(고아)·줄 길이 불균형·넘침/잘림·숫자단위
  분리), 페이지 단위 루브릭으로 0–100 채점한 뒤 wrap-balancer와 word-break:keep-all로 고치고
  적용 전/후를 재스캔해 개선을 검증하는 스킬. 사용자가 "발표자료 줄바꿈 점검/감사/검수",
  "HTML 페이지에서 줄바꿈 이상한 곳 찾아줘", "슬라이드 줄바꿈 어색한 데 개선", "타이포
  줄바꿈 품질 평가/루브릭", "deck/page line-break audit", "고아 단어/어절 끊김/오버플로
  점검"을 원할 때 — 라이브러리 이름을 직접 말하지 않아도 — 적극적으로 사용한다. 특정 제목
  하나만 밸런싱하는 게 아니라, 페이지/덱 전체를 훑어 줄바꿈 문제를 발견·채점·개선하려는
  의도면 이 스킬이다.
---

# 발표 자료 줄바꿈 감사 & 개선 (linebreak-audit)

HTML 페이지(특히 발표 자료)는 **줄바꿈이 어색한 곳**이 많다 — 단어가 중간에 끊기고, 마지막
줄에 단어 하나만 외롭게 떨어지고, 줄 길이가 들쭉날쭉하고, 텍스트가 칸을 넘쳐 잘린다. 이 스킬은
페이지를 **렌더해서 실제 줄바꿈을 측정**해 그런 곳을 전수로 찾아내고, **루브릭으로 채점**한 뒤,
**wrap-balancer + keep-all로 고치고**, 적용 전/후를 **재스캔해 개선을 검증**한다.

> 줄바꿈은 정적 HTML만 봐선 알 수 없는 **렌더 결과**다. 그래서 항상 브라우저로 띄워 측정한다.
> 밸런싱/keep-all을 적용하면 줄바꿈이 눈에 띄게 바뀌는데, 이는 실패가 아니라 **성공 신호**다.

> 이 스킬 디렉터리(아래 `SKILL_DIR`)는 `.codex/skills/linebreak-audit/`. 경로는 이 기준.

---

## 언제 쓰나 (그리고 형제 스킬과의 구분)

- **이 스킬:** 페이지/덱 **전체를 훑어** 줄바꿈 문제를 *발견*하고, 루브릭으로 *채점*하고, *개선*까지.
  "발표자료 줄바꿈 점검해줘", "이 HTML에서 줄바꿈 이상한 데 찾아서 고쳐줘"가 전형.
- **`wrap-balancer`(형제):** 이미 *아는 제목 하나*에 밸런싱을 적용하고 전/후를 본다. 대상이
  정해져 있고 발견·채점이 필요 없으면 그쪽.
- **`slide-ko-polish`(형제):** 한국어 **표현(번역체·명사 나열)** 을 다시 쓴다. 어절이 끊기는 게
  *문구를 고쳐야 할* 문제면 그쪽, *조판(CSS/밸런싱)* 으로 풀 문제면 이 스킬.

단순한 한 줄 제목·짧은 라벨만 있는 페이지는 고칠 줄바꿈이 없다(정상).

---

## 워크플로

### Phase 1 — 렌더 & 스캔 (발견)

1. **대상 확정.** 점검할 HTML 파일/URL을 받는다. 발표 덱이면 슬라이드 폭(보통 1280×720 또는
   1920×1080)을, 일반 페이지면 대표 뷰포트를 정한다. 특정 영역만 보려면 셀렉터를 받는다.
2. **렌더 + 스캔.** 번들 런너를 쓴다(렌더/스캔이 한 번에, 결정적):
   ```bash
   node SKILL_DIR/scripts/run_audit.cjs <파일|URL> --label before --viewport 1280x720 --out <WORKDIR>
   ```
   - 프레임워크 덱(reveal.js/impress.js 등 활성 슬라이드만 렌더)이면 `--reveal`을 더해 숨은
     슬라이드까지 펼쳐 전수 스캔한다.
   - 런너가 Playwright/크로미움을 자동 탐색한다. 없다고 하면(`종료코드 2`) `references/rendering.md`의
     설치 안내나 browser-harness / chrome-devtools MCP 대안을 쓴다(스캔 스크립트는 동일).
3. 산출: `<WORKDIR>/before.scan.json`(요소별 줄 수·줄별 너비·렌더된 줄 텍스트·문제·severity·
   weight·페이지 점수) + `<WORKDIR>/before.png`. 런너가 **심각도순 상위 문제(셀렉터·줄·수정
   힌트)**도 콘솔에 출력한다.

### Phase 2 — 루브릭 감사 & 리포트 (채점)

`scan.json`은 기하만 본다. **스크린샷으로 의도/맥락을 교차 확인**해 오탐(연출용 의도된 줄바꿈
등)을 걸러내고 확정 점수를 내는 것이 평가의 핵심이다.

가능하면 Codex native subagent로 **전용 평가 에이전트**를 띄운다(스폰 불가 환경이면 인라인으로 동일 절차):

> `SKILL_DIR/agents/linebreak-auditor.md`와 `SKILL_DIR/references/linebreak-rubric.md`를 파일로
> 읽고, `<WORKDIR>/before.scan.json`과 `<WORKDIR>/before.png`를 근거로 루브릭 §8 JSON 계약대로
> 페이지 감사 결과를 반환하라.

별도 에이전트가 좋은 이유: 렌더/스캔 맥락에 오염되지 않고 루브릭만으로 독립 판정해 더 공정하다.
결과는 `<WORKDIR>/audit.json`으로 저장.

**사용자 보고:** 페이지 점수·등급(A–F)·verdict + 유형별 집계(예: `어절끊김 7 · 고아 7 · 넘침 4`)
+ **심각도순 상위 문제**(슬라이드/셀렉터·렌더된 줄·권장 조치) + before 스크린샷. 무엇이 왜
어색한지 구체적으로(어느 단어가 어디서 끊겼는지) 보여준다.

### Phase 3 — 개선 (수정)

`references/fixing.md`의 문제→조치 매핑대로 고친다. 비용 대비 효과 순:

1. **전역 `word-break: keep-all; overflow-wrap: anywhere;`** (텍스트 컨테이너에 한 번) → 어절 끊김 대량 해소.
2. **CDN `<script>` 한 줄 + 짧은 블록에 `data-br-balance`** → 고아·불균형 해소.
3. **넘침(P4)** 은 스캔이 가리킨 요소만 골라 레이아웃 수정(nowrap/고정높이 제거 등).
4. **의미 분리·과다 줄 수(P5/P6)** 는 남은 개별 케이스만 핀포인트(`&nbsp;`/`<wbr>`).

> 남의 발표 자료 파일을 바꾸는 것은 되돌리기 번거롭다. 명시적 위임이 없으면 **무엇을 어디에
> 넣을지 보여주고 확인**한 뒤 적용한다. 원문 텍스트·마크업은 최대한 보존한다.

### Phase 4 — 재스캔 & 개선 검증 (루프)

1. 수정한 파일을 **같은 조건으로 다시 스캔**:
   ```bash
   node SKILL_DIR/scripts/run_audit.cjs <수정한 파일> --label after --viewport 1280x720 --out <WORKDIR>
   ```
2. 평가 에이전트에 `before.*`·`after.*` 두 벌을 주고 **개선 검증**을 시킨다(루브릭 §4 게이트 +
   §6 판정). 결과 `verdict`:
   - `improved`(after ≥ 85 · severity-3 0개 · 게이트 통과 · 점수 상승) → 적용 유지. 끝.
   - `marginal`(올랐지만 부족) → fixing.md 조치를 한 번 더 적용하고 Phase 3–4 **재실행**.
   - `regression`(게이트 위반/점수 하락) → 수정을 되돌리고 원인 분석.
3. 사용자에게: **Δ(점수 변화)** + 유형별 변화(예: `어절끊김 7→0`) + 전/후 스크린샷(또는 경로) + 남은 항목.

---

## 파일 맵

```
SKILL_DIR/
├── SKILL.md                          # (이 파일) 오케스트레이션
├── scripts/
│   ├── run_audit.cjs                 # 렌더+스캔 실행 엔진(Playwright 자동탐색) — 보통 이것만 호출
│   └── scan_linebreaks.js            # 페이지 안에서 도는 줄바꿈 스캐너(문제 분류·측정·점수)
├── references/
│   ├── linebreak-rubric.md           # 문제 분류(P1–P6)·채점식·게이트·개선 판정·JSON 계약
│   ├── rendering.md                  # 렌더/스캔 방법(런너 우선, browser-harness/MCP 대안, 덱 펼치기)
│   └── fixing.md                     # 문제→조치 매핑(keep-all·밸런싱·넘침·핀포인트)
├── agents/
│   └── linebreak-auditor.md          # 루브릭으로 채점하는 전용 평가 에이전트
├── assets/
│   └── wrap-balancer.min.js          # 오프라인/CSP로 CDN이 막힐 때 쓰는 로컬 복사본
└── evals/
    ├── evals.json                    # 테스트 프롬프트·기준
    └── fixtures/                     # 줄바꿈 문제를 의도적으로 심은 합성 발표 덱
```

- 렌더/스캔이 헷갈리면 → `references/rendering.md`
- 채점 기준·판정 규칙 → `references/linebreak-rubric.md`
- 어떻게 고치나 → `references/fixing.md`
- 평가를 단독으로 돌리려면 → `agents/linebreak-auditor.md`를 읽혀 스폰

## 기본값·주의

- **항상 렌더해서 측정한다.** 정적 HTML만 보고 줄바꿈을 추정하지 말 것.
- 한국어에서 단어 중간이 끊기면 거의 항상 `word-break: keep-all` 누락(또는 `break-all`)이다 — 먼저 의심.
- 주입은 **CDN `<script>` 한 줄**이 기본(jsDelivr). 오프라인/CSP면 `assets/wrap-balancer.min.js` 로컬 복사.
- **긴 본문 문단은 대상이 아니다.** 제목·헤드라인·짧은 카피·캡션·큰 숫자에 집중. 본문은 고아·넘침만 본다.
- before/after는 **같은 뷰포트·DPR**로 찍는다. 폭이 다르면 줄바꿈이 달라져 비교가 무의미.
