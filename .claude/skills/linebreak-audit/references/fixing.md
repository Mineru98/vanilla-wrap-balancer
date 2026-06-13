# 수정 플레이북 (라이브러리 + CSS 위주)

원칙: **원문 텍스트·마크업은 최대한 보존**한다. 줄바꿈은 (1) 한국어 어절 보존 CSS와 (2) 짧은
블록 자동 밸런싱으로 고치고, 라이브러리가 못 잡는 특수 케이스만 핀포인트로 `&nbsp;`/`<wbr>`를
더한다. 큰 비용 대비 효과: **덱 전역 keep-all 한 번 + 짧은 블록 일괄 밸런싱**이 문제 대부분을 없앤다.

> 남의 발표 자료 파일을 바꾸는 것은 되돌리기 번거로운 변경이다. 명시적 위임이 없으면 무엇을
> 어디에 넣을지 **보여주고 확인**한 뒤 적용한다. 적용 후엔 반드시 재스캔해 개선을 검증한다(rubric §6).

---

## 1. P1 어절 끊김 → `word-break: keep-all` (가장 먼저, 가장 효과적)

한국어는 기본적으로 글자 사이에서도 줄바꿈돼 **어절 중간이 끊긴다**(`방\|법`, `이\|해`). 텍스트
컨테이너에 다음을 주면 공백(어절 경계)에서만 끊긴다:

```css
/* 발표 덱 전역: 텍스트가 담기는 요소에 한 번에 */
h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,th,td,
.title,[class*="title"],[class*="heading"],[class*="subtitle"],[class*="caption"],[class*="lead"]{
  word-break: keep-all;
  overflow-wrap: anywhere;   /* URL처럼 컨테이너보다 긴 단일 토큰만 예외적으로 끊어 넘침 방지 */
}
```

- 어딘가 `word-break: break-all`이 있으면 그게 범인이다. 위 규칙을 더 구체적인 셀렉터로
  주거나 `!important`로 덮는다.
- 이 한 줄짜리 전역 규칙이 보통 P1을 **대량으로** 없앤다.

## 2. P2 고아 / P3 불균형 → wrap-balancer

균형 잡기(줄 수를 늘리지 않으면서 줄 너비를 고르게, 마지막 줄 외톨이 제거)는 라이브러리가 한다.

**CDN 한 줄** (`</body>` 직전, 문서당 한 번):

```html
<script src="https://cdn.jsdelivr.net/gh/Mineru98/react-wrap-balancer@main/wrap-balancer.min.js"></script>
```

**짧은 블록에 마커** (제목·헤드라인·짧은 카피에만; 긴 본문 문단엔 쓰지 않는다):

```html
<h1 data-br-balance>…</h1>
```

- 스크립트는 로드되면 `[data-br-balance]`를 자동 밸런싱하고, 폰트 로드·리사이즈 시 재밸런싱한다.
- 덱 전체에 한 번에 켜려면 마커를 일괄로 달거나, 로드 후 셀렉터로 호출한다:
  ```html
  <script>window.WrapBalancer && WrapBalancer.balance('h1,h2,h3,.title,figcaption,blockquote');</script>
  ```
- 압축 정도는 `data-br-ratio="1"`(가장 압축, 기본)~`"0"`. 결과를 결정적으로 하려면
  `data-br-prefer-native="false"`(JS 경로 고정).
- **react-wrap-balancer를 이미 쓰는 요소엔 중복 적용 금지.**

> 오프라인/CSP(`script-src`)로 CDN이 막히면 알리고, 로컬 복사본(`assets/wrap-balancer.min.js`)을
> 같은 폴더에 두고 상대경로 `<script src="wrap-balancer.min.js">`로 넣는다.

## 3. P4 넘침/잘림 → 레이아웃 풀어주기 (요소별)

밸런싱·keep-all로 안 풀린다. 원인을 보고 개별 대응:

```css
/* 한 줄 고정으로 …잘리던 라벨: 줄바꿈 허용 */
.label{ white-space: normal; }                 /* nowrap 제거 */
/* 고정 높이로 세로 잘리던 인용/본문 박스: 높이를 내용에 맞게 */
.clip-box{ height: auto; max-height: none; overflow: visible; }
/* 좁은 칸에서 긴 토큰이 삐져나올 때 */
.cell{ min-width: 0; overflow-wrap: anywhere; }
```

폭/높이가 의도된 디자인이면(잘림이 의도) 건드리지 않는다 — 스크린샷으로 의도를 확인한다.

## 4. P5 의미 분리 → 핀포인트 (`&nbsp;` / `<wbr>`)

숫자와 단위, 떼면 어색한 짧은 묶음이 줄을 넘어 갈릴 때만 **국소적으로**:

```html
100&nbsp;MB        <!-- 숫자+단위를 한 덩어리로 묶어 분리 방지 -->
2025&nbsp;년
서울특별시<wbr>강남구   <!-- 길면 여기서 끊어도 좋다고 힌트(필요 시) -->
```

`<br>`로 의미 단위를 강제 줄바꿈하는 것은 **반응형에서 깨지기 쉬우니** 최후수단이다. 폭이 고정된
슬라이드에서 꼭 필요할 때만 쓰고, 가능하면 `&nbsp;`(묶기)·`<wbr>`(끊기 힌트)를 먼저 시도한다.

## 5. P6 과다 줄 수

짧은 제목이 여백 많은 채 여러 줄로 쪼개지면, 컨테이너 폭을 넓히거나 폰트를 줄여 줄 수를 줄인 뒤
wrap-balancer로 균형을 맞춘다. 줄 수 자체가 불가피하면(좁은 칼럼) 균형만 맞추고 둔다.

---

## 적용 순서 (덱 기준)

1. **전역 keep-all CSS** 한 번 추가 → P1 대량 해소.
2. **CDN 스크립트 한 줄 + 짧은 블록 밸런싱** → P2/P3 해소.
3. **P4 넘침**은 스캔이 가리킨 요소만 골라 레이아웃 수정.
4. **P5/P6**는 남은 개별 케이스만 핀포인트.
5. **재스캔**(`--label after`) → rubric §6으로 개선 검증. `improved` 아니면 한 번 더 반복.

> 프로젝트 타입별(정적 HTML / Next.js / Vue 등) 스크립트 배치 위치가 헷갈리면, 형제 스킬
> `.claude/skills/wrap-balancer/references/integration.md`에 타입별 배치가 자세히 있다.
