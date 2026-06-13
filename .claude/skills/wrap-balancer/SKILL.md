---
name: wrap-balancer
description: >-
  단일 제목·헤드라인(또는 몇 개의 제목 요소)에 wrap-balancer.js(react-wrap-balancer의
  무의존성 바닐라 포트)를 CDN <script>로 주입해 줄바꿈을 균형 잡고, 한국어로 적용 전/후를
  렌더링·스크린샷해 /oh-my-claudecode:visual-verdict와 전용 루브릭 평가 에이전트로 개선
  여부를 채점하는 스킬. 사용자가 특정 제목·타이틀·히어로 카피의 줄바꿈을 '예쁘게/균형있게'
  만들고 싶을 때, 마지막 줄에 단어 하나만 외롭게 떨어지는 고아(orphan)를 없애고 싶을 때,
  한국어 제목이 단어 중간에서 끊기는 걸 고치고 싶을 때, 사이트에 wrap-balancer나
  react-wrap-balancer를 붙이고 싶을 때, 한 제목의 적용 전/후 모습을 비교·평가하고 싶을 때
  — 라이브러리 이름을 직접 말하지 않아도 — 적극적으로 사용한다. "제목 줄바꿈 예쁘게",
  "타이틀 밸런싱", "마지막 줄에 단어 하나만 떨어져", "헤드라인 균형", "wrap-balancer 적용",
  "text-wrap balance 줬는데 한국어가 단어 중간에서 끊겨" 같은 요청에 트리거된다. Also triggers
  in English for "balance the heading line wrapping", "fix the orphan word on the last line",
  "add wrap-balancer". 경계(이 스킬이 아님): 페이지나 슬라이드 덱 '전체'를 훑어 줄바꿈 문제를
  전수로 찾아 감사·채점(scan/audit)하려는 경우는 linebreak-audit을 쓴다. text-align의 양쪽
  정렬(justify), line-height(줄간격) 조정, 레이아웃 정렬, 번역은 이 스킬과 무관하다.
---

# wrap-balancer 적용 & 한국어 전/후 시각 평가

이 스킬은 두 가지를 한 흐름으로 한다:

1. **주입** — 대상 프로젝트에 `wrap-balancer`(react-wrap-balancer의 바닐라 포트)를 **CDN
   `<script>` 한 줄**로 넣고, 제목 요소에 `data-br-balance` + 한국어 줄바꿈 CSS를 단다.
2. **검증** — 한국어 텍스트로 **적용 전/후를 렌더링·스크린샷**해서, `/oh-my-claudecode:visual-verdict`
   (무엇이 바뀌었나)와 **전용 루브릭 평가 에이전트**(개선됐나·몇 점인가)로 평가한다.

밸런싱은 "줄 수를 늘리지 않으면서 각 줄 너비를 고르게, 마지막 줄 외톨이를 없애는" 것이 목표다.
줄바꿈이 눈에 띄게 바뀌는 것은 실패가 아니라 **성공 신호**다.

> 이 스킬 디렉터리(아래 `SKILL_DIR`)는
> `.claude/skills/wrap-balancer/`. 경로는 이 기준으로 읽는다.

---

## 언제 쓰나

- 사용자가 제목/헤드라인 줄바꿈을 "예쁘게/균형 있게" 만들고 싶을 때
- 마지막 줄에 단어 하나만 떨어지는 고아(orphan) 문제를 고치고 싶을 때
- 한국어 제목 조판(어절 단위 줄바꿈)을 개선하고 싶을 때
- 어떤 사이트/프로젝트에 wrap-balancer를 적용하고 그 효과를 전/후로 확인하고 싶을 때

단순 한 줄 제목, 본문 긴 문단은 대상이 아니다(효과 없음).

---

## 워크플로

### Phase 1 — 주입 (CDN, 항상)

1. **대상 확정.** 어느 프로젝트의 어떤 제목 요소를 밸런싱할지 정한다(사용자 지정 파일/셀렉터,
   또는 hero/카드 제목 등). 외부 프로젝트면 그 경로를 받는다.
2. `references/integration.md`를 읽고 **프로젝트 타입에 맞게** 적용한다:
   - CDN 스크립트 한 줄을 문서에 한 번 추가(`</body>` 직전 / Next는 `next/script`).
   - 대상 제목 요소에 `data-br-balance` 부착.
   - **한국어 필수:** 대상 요소에 `word-break: keep-all; overflow-wrap: anywhere;`
     (어절은 통으로 유지, 너무 긴 토큰만 예외적으로 끊어 넘침 방지). 누락하면 단어 중간이
     끊겨 밸런싱 품질이 떨어진다.
3. 변경한 파일/내용을 사용자에게 보여준다. (남의 프로젝트 파일을 바꾸는 것은 되돌리기 어려운
   변경이므로, 명시적 위임이 없으면 적용 전에 확인한다.)

### Phase 2 — 한국어 전/후 렌더링

1. **밸런싱 대상의 실제 표시 조건 수집:** 제목 텍스트(들), 컨테이너 너비(px), 폰트, 폰트 크기,
   줄간격. 대상 프로젝트의 실제 CSS에 최대한 맞춘다(없으면 합리적 기본: 360px / 28px / 1.35).
   - **너비 선택 팁:** 고아·불균형은 보통 좁은 폭에서 드러난다. 데스크톱 자연 폭에서 이미
     한 줄이거나 균형이면 효과가 안 보이니, **모바일 폭(예: 335/360/375px)** 또는 제목이
     2~3줄로 줄바꿈되는 폭을 골라 전/후 차이가 드러나게 한다. 반응형이면 여러 폭을
     `--width 360,480`처럼 함께 넣어도 된다.
2. **하니스 생성:**
   ```bash
   python3 SKILL_DIR/scripts/make_harness.py \
     --title "<한국어 제목1>" [--title "<한국어 제목2>" ...] \
     --width <px>[,px2] --font-size <px> --line-height <lh> \
     --out <WORKDIR>/harness
   ```
   `before.html`(미적용) / `after.html`(밸런싱·JS 경로 고정) / `compare.html`(나란히) 생성.
3. **스크린샷 + (선택) 지표:** `references/rendering.md`의 방법으로 고정 뷰포트에서
   `[data-ready]`를 기다린 뒤 `before.png` / `after.png`를 찍는다. 가능하면
   `scripts/measure_lines.js`로 `metrics.json`(줄 수·줄별 너비)도 만든다 — 평가가 수치 근거를
   갖게 된다.

### Phase 3 — 평가 (두 갈래, 역할이 다름)

**(A) `/oh-my-claudecode:visual-verdict` — "무엇이 어떻게 바뀌었나"**

`reference_images = [before.png]`, `generated_screenshot = after.png`로 호출한다.
이 도구는 "reference와의 유사도"를 점수화하므로, **밸런싱을 잘 할수록 score가 낮게** 나올 수
있다(줄바꿈이 바뀌니까). 그러니 **score/verdict를 합·불로 쓰지 말고**, 반환된
`differences[]`/`reasoning`을 "전→후 시각 변화 목록"으로 활용한다.

```
/oh-my-claudecode:visual-verdict
reference: <WORKDIR>/harness/before.png
generated: <WORKDIR>/harness/after.png
category_hint: korean-headline-balance
task: 텍스트 밸런싱 적용 전(reference)→후(generated)의 줄바꿈 변화를 differences로 나열하라.
       유사도가 아니라 "무엇이 바뀌었는지"가 관심사다.
```

**(B) 전용 루브릭 평가 에이전트 — "개선됐나, 몇 점인가" (권위 있는 판정)**

**루브릭 기반 채점**을 한다. 가능하면 `Agent` 도구로 별도 서브에이전트를 띄워 다음을 시킨다
(서브에이전트 스폰이 불가한 환경 — 중첩 호출 제한·Claude.ai 등 — 이면 **인라인으로** 동일
절차를 직접 수행한다):

> `SKILL_DIR/agents/balance-quality-evaluator.md`와 `SKILL_DIR/references/balance-rubric.md`를
> Read로 읽고, `<WORKDIR>/harness/before.png`·`after.png`(있으면 `metrics.json`)를 근거로
> 루브릭 §6 JSON 계약대로 평가 결과를 반환하라.

별도 에이전트로 띄우는 편이 좋은 이유: 평가자가 주입·렌더링 맥락에 오염되지 않고 루브릭만으로
독립적으로 판정하므로 더 공정하다. 결과 JSON은 `<WORKDIR>/verdict.json`으로 저장한다.

이 에이전트는 하드 게이트(줄 수 보존·넘침 없음·내용 보존)와 5개 채점 기준(고아 제거·줄 균형·
한국어 어절 보존·가독성·부작용)으로 0–100점과 `verdict`(improved/marginal/noop/regression)를
낸다. **이 verdict가 적용 유지/재적용/설정 변경을 결정하는 권위 있는 근거다.**

### Phase 4 — 보고 & 루프

- 사용자에게: 적용한 변경 요약 + 전/후 스크린샷(또는 compare.html 경로) + 루브릭 verdict·점수 +
  visual-verdict의 differences + 필요한 suggestions.
- `verdict`가 `improved`/`noop` → 적용을 유지. 끝.
- `marginal`/`regression` → 루브릭 §5의 조치(보통 `word-break: keep-all` 추가 또는
  `data-br-ratio="1"`)를 적용하고 Phase 2–3을 **재실행**한다. 합격선은 80점.

---

## visual-verdict vs 루브릭 에이전트 (왜 둘 다인가)

| | `/oh-my-claudecode:visual-verdict` | balance-quality-evaluator (이 스킬) |
|---|---|---|
| 묻는 것 | 두 이미지가 무엇이 다른가 | 후가 전보다 **나아졌는가**, 몇 점인가 |
| score 의미 | reference와의 유사도(밸런싱 시 낮아짐이 정상) | 밸런싱 품질(높을수록 좋음, 합격 80) |
| 한국어 특화 | 일반 시각 QA | 어절 보존(keep-all)·고아·줄 균형을 1급 기준으로 |
| 쓰임 | `differences[]`로 변화 서술 | 합/불 판정(권위) |

둘은 보완 관계다. visual-verdict로 "무엇이 바뀌었는지" 서술하고, 루브릭 에이전트로 "그 변화가
개선인지" 판정한다.

---

## 파일 맵

```
SKILL_DIR/
├── SKILL.md                              # (이 파일) 오케스트레이션
├── assets/
│   └── wrap-balancer.min.js              # 헤르메틱 렌더용 로컬 복사본(오프라인/CDN 차단 시도 대안)
├── scripts/
│   ├── make_harness.py                   # 전/후 한국어 비교 하니스 생성기
│   └── measure_lines.js                  # 페이지에서 줄 수·줄별 너비 측정(→ metrics.json)
├── references/
│   ├── integration.md                    # CDN 우선 주입 + 한국어 keep-all (프로젝트 타입별)
│   ├── rendering.md                       # 렌더/스크린샷/지표 수집 방법(도구별)
│   └── balance-rubric.md                 # 한국어 밸런싱 품질 루브릭(게이트·기준·판정)
└── agents/
    └── balance-quality-evaluator.md      # 루브릭으로 채점하는 전용 평가 에이전트
```

- 주입 방법이 헷갈리면 → `references/integration.md`
- 렌더/스크린샷이 헷갈리면 → `references/rendering.md`
- 채점 기준/판정 규칙 → `references/balance-rubric.md`
- 평가 에이전트를 단독으로 돌리고 싶으면 → `agents/balance-quality-evaluator.md`를 읽혀 스폰

## 기본값·주의

- 주입은 **항상 CDN `<script>`**(jsDelivr). 오프라인/CSP 차단 환경은 사용자에게 알리고
  `assets/wrap-balancer.min.js` 로컬 복사 방식을 제안.
- 하니스의 after는 결정성을 위해 **JS 경로 고정**(`prefer-native="false"`). 실제 주입은 기본
  (네이티브 우선). 둘은 같은 균형 결과로 수렴한다.
- 한국어에서 단어 중간이 끊기면 거의 항상 `word-break: keep-all` 누락이다 — 먼저 의심.
