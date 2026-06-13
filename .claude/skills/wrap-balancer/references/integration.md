# wrap-balancer 주입 가이드 (CDN 기본)

이 스킬의 기본 주입 방식은 **항상 jsDelivr CDN `<script>` 한 줄**이다. 빌드 단계가
필요 없고 어떤 프로젝트 타입에서도 동작한다. 대상 프로젝트의 종류만 파악해 "스크립트를
어디에 넣고, 어떤 요소에 마커를 달고, 한국어 CSS를 어떻게 줄지"를 정하면 된다.

## CDN 스니펫 (정본)

```html
<script src="https://cdn.jsdelivr.net/gh/Mineru98/react-wrap-balancer@main/wrap-balancer.min.js"></script>
```

- 버전을 고정하려면 `@main`을 태그/커밋으로 바꾼다(예: `@v1.0.0`). 프로덕션은 고정 권장.
- 스크립트는 로드되면 `[data-br-balance]` 요소를 **자동으로** 밸런싱하고, 웹폰트 로드 후·
  리사이즈 시 자동 재밸런싱한다. 전역 `WrapBalancer`(UMD)도 노출한다.

## 한국어 필수 페어링: `word-break: keep-all`

한국어는 기본적으로 어절(공백) 경계뿐 아니라 글자 사이에서도 줄바꿈될 수 있어, 밸런싱을
해도 **단어 중간이 끊겨** 보기 나쁠 수 있다. 대상 제목 요소에 다음을 반드시 함께 준다:

```css
/* 한국어 제목: 어절은 통째로 유지하되, 컨테이너보다 긴 단일 토큰은 끊어 넘침 방지 */
.balance-target { word-break: keep-all; overflow-wrap: anywhere; }
```

`keep-all`은 어절(단어)을 통으로 유지해 공백에서만 줄바꿈하게 하고, `overflow-wrap: anywhere`는
URL처럼 컨테이너보다 긴 단일 토큰이 있을 때만 예외적으로 끊어 넘침을 막는다. 이 둘이
밸런싱과 결합되어 "고르고, 어절이 안 깨지는" 한국어 제목을 만든다.

## 마커 부착: 어디에 `data-br-balance`를 다는가

- **텍스트를 담은 요소 자체**(예: `<h1>`, `<h2>`, 카드 제목 `<h3>`)에 단다. 라이브러리가 그
  요소의 자식을 인라인블록 `<span>`으로 감싸 그 안에서 밸런싱한다(React의
  `<h1><Balancer>…</Balancer></h1>`와 구조적으로 동일).
- 본문 단락(긴 문단)에는 보통 쓰지 않는다 — 제목·헤드라인·짧은 카피에 가장 효과적이다.

```html
<h1 data-br-balance>모든 화면 크기에서 더 읽기 좋은 제목</h1>
```

## 프로젝트 타입별 배치

기본은 CDN 스크립트지만, "어디에 넣는가"는 타입마다 다르다.

### 1) 정적 HTML / 서버 템플릿 (가장 단순)
`</body>` 직전에 CDN 스크립트 한 줄. 제목 요소에 `data-br-balance` + 한국어 CSS.

```html
  <h1 class="hero-title" data-br-balance>…</h1>
  <style>.hero-title{ word-break:keep-all; overflow-wrap:anywhere; }</style>
  <script src="https://cdn.jsdelivr.net/gh/Mineru98/react-wrap-balancer@main/wrap-balancer.min.js"></script>
</body>
```

### 2) React / Next.js / Vue 등 SPA·SSR
- CDN 스크립트는 문서에 한 번만 넣는다:
  - Next.js(App Router): `app/layout.tsx`의 `<body>` 안에 `next/script`로
    `<Script src="…wrap-balancer.min.js" strategy="afterInteractive" />`.
  - Next.js(Pages): `pages/_document.tsx`의 `<body>` 끝, 또는 `_app`에서 `next/script`.
  - Vite/CRA/Vue: `index.html`의 `</body>` 직전에 `<script>` 한 줄.
- 마커는 JSX/템플릿에서 `data-br-balance`로 단다:
  ```jsx
  <h1 className="hero" data-br-balance>{title}</h1>
  ```
- **클라이언트에서 동적으로 나타나는 제목**(라우팅·조건부 렌더 후 마운트)은 자동 초기화가
  못 잡을 수 있다. 그럴 땐 마운트 후 한 번 호출한다:
  ```js
  // 예: 컴포넌트 mount/업데이트 후
  window.WrapBalancer && WrapBalancer.balance('.hero')
  ```
- 한국어 CSS는 전역 CSS나 컴포넌트 스타일에 `word-break:keep-all; overflow-wrap:anywhere;`.

### 3) 동적으로 텍스트가 바뀌는 경우
라이브러리가 `MutationObserver`로 텍스트 변경을 감지해 자동 재밸런싱하므로 보통 추가 작업이
필요 없다. 관찰 밖의 레이아웃 변화(탭 전환 등)에는 `WrapBalancer.rebalanceAll()`을 호출.

## 옵션 (필요할 때만)

| 목적 | 방법 |
|------|------|
| 압축 정도 조절 | `data-br-ratio="1"`(가장 압축, 기본) ~ `"0"`(밸런싱 안 함) |
| JS 경로 강제(네이티브 무시) | `data-br-prefer-native="false"` — 결과를 결정적으로 만들고 싶을 때 |
| 자동 초기화 끄기 | `<script … data-auto="false">` 후 `WrapBalancer.balance(...)` 수동 호출 |

## 주의 / 함정

- **CDN 차단/오프라인 환경**: jsDelivr에 접근 못 하면 동작하지 않는다. 그런 환경은
  사용자에게 알리고 로컬 복사 방식(스킬 `assets/wrap-balancer.min.js`)을 제안한다.
- **CSP**: `script-src`에 `https://cdn.jsdelivr.net`을 허용해야 한다. 인라인 스크립트를
  쓰지 않으므로 `unsafe-inline`은 불필요.
- **react-wrap-balancer와 혼용 금지(요소 단위)**: 같은 요소에 둘 다 적용하지 말 것. 이미
  React `<Balancer>`로 처리되는 요소에는 이 라이브러리를 또 붙이지 않는다.
- **본문/긴 문단**: 밸런싱 대상이 아니다. 제목·헤드라인에 한정.
