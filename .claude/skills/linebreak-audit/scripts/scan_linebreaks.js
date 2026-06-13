/*
 * scan_linebreaks.js — 페이지 전체의 "어색한 줄바꿈"을 렌더 기반으로 찾아내는 스캐너.
 *
 * 브라우저 도구의 "evaluate" 로 페이지 안에서 실행한다(폰트 로드 + 레이아웃 정착 후).
 * 정적 HTML/CSS만 보면 텍스트가 "실제로 어떻게 줄바꿈됐는지" 알 수 없다 — 줄바꿈은
 * 컨테이너 너비·폰트·언어 규칙이 합쳐진 렌더 결과다. 그래서 이 스크립트는 DOM의
 * 텍스트 블록을 훑으며 Range/getClientRects 로 "실제 줄 박스"를 측정하고, 줄 경계의
 * 글자를 복원해 문제를 분류한다. 측정값(사실)에 근거하므로 눈대중보다 재현성이 높다.
 *
 * 분류하는 문제(자세한 정의는 references/linebreak-rubric.md):
 *   P1 midword_break   어절(단어) 중간이 끊김 — 한국어 keep-all 누락의 전형. 가장 거슬림.
 *   P2 orphan          마지막 줄이 한 단어/짧은 토막으로 외롭게 떨어짐(고아/외톨이).
 *   P3 imbalance       줄 길이가 들쭉날쭉(가장 긴 줄과 짧은 줄 차이가 큼).
 *   P4 overflow        텍스트가 컨테이너를 넘치거나 …로 잘림.
 *   P5 semantic_split  의미 단위가 갈림 — 숫자+단위 분리, 조사로 시작 등.
 *   P6 excess_lines    짧은 제목이 너무 여러 줄로 쪼개짐.
 *
 * 출력: 줄 단위 측정 + 문제 분류 + (제공정) severity·prominence 가중 + 페이지 점수까지.
 * severity/가중/점수는 "기하 + 폰트크기"에서 결정적으로 계산한 1차 값이다. 평가 에이전트는
 * 스크린샷으로 오탐(의도된 줄바꿈 등)을 걸러 최종 확정한다(agents/linebreak-auditor.md).
 *
 * 사용:
 *   __scanLineBreaks()                       // 자동 후보 탐지(기본)
 *   __scanLineBreaks({ selector: ".slide h1,.slide h2" })  // 셀렉터 한정
 *   __scanLineBreaksJSON(opts)               // JSON 문자열(일부 eval 브리지는 문자열이 안전)
 *   __lbRevealAll()                          // (프레임워크 덱) 숨은 슬라이드를 임시로 모두 표시
 *
 * browser-harness 의 js() 는 함수 정의가 섞인 다중문에서 완료값을 잃는다(None 반환). 그러니
 * 먼저 js(<이 파일 전체>) 로 정의(부수효과)하고, 이어서
 * js("JSON.stringify(window.__scanLineBreaks())") 로 결과 문자열을 받아 파싱한다.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    selector: null, // null = 자동 후보 탐지
    bandTol: 4, // 줄 그룹핑 시 top 허용 오차(px)
    orphanRatio: 0.45, // 마지막 줄너비/가장 넓은 줄 < 이 값 => 고아 의심
    imbalanceRatio: 0.5, // (max-min)/컨테이너 > 이 값 => 불균형 의심(고아가 아닌 경우만)
    overflowTol: 2, // 넘침 판정 여유(px)
    longWords: 16, // 어절 수 > 이 값이면 "긴 문단"(고아·넘침만 검사)
    detailMaxChars: 800, // 줄별 텍스트 복원(글자별 측정) 상한 — 그 이상은 기하만
    maxCandidates: 600, // 후보 상한(과대 DOM 방어)
    largeFontRatio: 1.4, // root 폰트의 이 배 이상이면 "헤딩급 짧은 블록"으로 취급
    heroFontRatio: 2.2, // 이 배 이상이면 prominence 최상(3)
  };

  // ---------- 문자 분류 ----------
  function isHangul(ch) {
    var c = ch.charCodeAt(0);
    return (
      (c >= 0xac00 && c <= 0xd7a3) || // 음절
      (c >= 0x1100 && c <= 0x11ff) || // 자모
      (c >= 0x3130 && c <= 0x318f) // 호환 자모
    );
  }
  function isCJK(ch) {
    var c = ch.charCodeAt(0);
    return (
      isHangul(ch) ||
      (c >= 0x4e00 && c <= 0x9fff) || // 한자
      (c >= 0x3040 && c <= 0x30ff) // 가나
    );
  }
  function isLatinNum(ch) {
    return /[0-9A-Za-zÀ-ɏ]/.test(ch);
  }
  function isWordChar(ch) {
    return isLatinNum(ch) || isCJK(ch);
  }
  function isSpace(ch) {
    return /\s/.test(ch);
  }

  // 숫자에서 떨어지면 어색한 단위/의존명사(앞 토큰이 숫자로 끝날 때만 본다)
  var UNITS = ["년","월","일","시","분","초","%","퍼센트","원","달러","개","명","건","회","번","배","위","등","차","호","쪽","주","점","대","장","권","kg","g","mg","t","km","m","cm","mm","TB","GB","MB","KB","px","ms","fps","억","만","천","조","월","주","분기"];

  // ---------- 줄 박스 측정 ----------
  function textNodesIn(el) {
    var out = [];
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeValue && n.nodeValue.length) out.push(n);
    }
    return out;
  }

  // 요소의 렌더된 텍스트를 줄(밴드)로 묶는다: {top,left,right,bottom}[]
  function lineBands(el, tol) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var list = range.getClientRects();
    var rects = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.width < 1) continue; // 0/서브픽셀 폭은 글자 없는 artifact(밸런서 래퍼 등) — 가짜 빈 줄 방지
      rects.push(r);
    }
    var bands = [];
    for (var j = 0; j < rects.length; j++) {
      var r2 = rects[j];
      var placed = false;
      for (var b = 0; b < bands.length; b++) {
        if (Math.abs(bands[b].top - r2.top) <= tol) {
          bands[b].left = Math.min(bands[b].left, r2.left);
          bands[b].right = Math.max(bands[b].right, r2.right);
          bands[b].bottom = Math.max(bands[b].bottom, r2.bottom);
          placed = true;
          break;
        }
      }
      if (!placed) bands.push({ top: r2.top, left: r2.left, right: r2.right, bottom: r2.bottom });
    }
    bands.sort(function (a, b2) { return a.top - b2.top; });
    return bands;
  }

  // 각 글자를 가장 가까운 밴드(줄)에 배정해 줄별 텍스트를 복원한다(글자 순서 보존).
  // 줄 경계의 공백 유무를 정확히 보려면 원문 순서대로 모든 글자를 담아야 한다.
  function lineTexts(el, bands) {
    if (bands.length <= 1) {
      return [(el.textContent || "")];
    }
    var nodes = textNodesIn(el);
    var lines = [];
    for (var i = 0; i < bands.length; i++) lines.push("");
    var centers = bands.map(function (b) { return (b.top + b.bottom) / 2; });
    var range = document.createRange();
    for (var k = 0; k < nodes.length; k++) {
      var node = nodes[k];
      var s = node.nodeValue;
      for (var p = 0; p < s.length; p++) {
        range.setStart(node, p);
        range.setEnd(node, p + 1);
        var rc = range.getBoundingClientRect();
        var mid = rc.top + rc.height / 2;
        // 공백 등으로 0높이면 직전 글자 줄에 붙인다(경계 공백 보존).
        var bi = 0;
        if (rc.height === 0 && rc.width === 0) {
          bi = lastNonEmptyLine(lines);
        } else {
          var best = Infinity;
          for (var c = 0; c < centers.length; c++) {
            var d = Math.abs(centers[c] - mid);
            if (d < best) { best = d; bi = c; }
          }
        }
        lines[bi] += s[p];
      }
    }
    return lines;
  }
  function lastNonEmptyLine(lines) {
    for (var i = lines.length - 1; i >= 0; i--) if (lines[i].length) return i;
    return 0;
  }

  function tokens(str) {
    var t = (str || "").trim();
    if (!t) return [];
    return t.split(/\s+/);
  }

  // ---------- 후보 선정 ----------
  function rootFontPx() {
    var fs = getComputedStyle(document.documentElement).fontSize;
    var v = parseFloat(fs);
    return v && !isNaN(v) ? v : 16;
  }

  function isVisible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  }

  // 텍스트를 "직접" 들고 있는 잎 성격인가(자식 블록으로 또 쪼개지지 않는가).
  function isTextLeaf(el) {
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      var tag = c.tagName;
      // 인라인 꾸밈 요소는 허용(밸런서가 만든 span 포함)
      if (tag === "SPAN" || tag === "A" || tag === "B" || tag === "I" || tag === "EM" || tag === "STRONG" || tag === "U" || tag === "SMALL" || tag === "MARK" || tag === "CODE" || tag === "SUP" || tag === "SUB" || tag === "BR" || tag === "WBR" || tag === "ABBR" || tag === "TIME" || tag === "Q" || tag === "S" || tag === "DEL" || tag === "INS") {
        continue;
      }
      var d = getComputedStyle(c).display;
      if (d === "inline" || d === "inline-block") continue;
      return false; // 블록 자식이 있으면 잎이 아님 → 그 자식들이 후보가 된다
    }
    return true;
  }

  var SEED = [
    "h1","h2","h3","h4","h5","h6","p","li","figcaption","blockquote",
    "dt","dd","caption","th","td","button","summary",
    '[class*="title" i]','[class*="heading" i]','[class*="headline" i]',
    '[class*="subtitle" i]','[class*="caption" i]','[class*="lead" i]',
    '[class*="eyebrow" i]','[class*="label" i]','[class*="quote" i]'
  ].join(",");

  function collectCandidates(selector, cfg) {
    var set = [];
    var seen = [];
    function add(el) {
      if (seen.indexOf(el) !== -1) return;
      seen.push(el);
      set.push(el);
    }
    var rootFp = rootFontPx();
    var nodes;
    if (selector) {
      nodes = document.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) add(nodes[i]);
      return set;
    }
    // 1) 시드 셀렉터
    nodes = document.querySelectorAll(SEED);
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      var txt = (el.textContent || "").replace(/\s+/g, "").length;
      if (txt < 2) continue;
      if (!isVisible(el)) continue;
      if (!isTextLeaf(el)) continue;
      add(el);
    }
    // 2) 보강: 시드에 안 걸린 (a) 큰 폰트의 짧은 텍스트(디스플레이 숫자/콜아웃 등)와
    //    (b) 지금 실제로 잘리고 있는 텍스트 잎 요소(배지·고정폭 라벨 등 — 잘림은 클래스·폰트와
    //    무관하게 거슬리는 문제다). 블록 자식을 가진 컨테이너(의도된 스크롤 영역 등)는 제외.
    var all = document.querySelectorAll("div,span,strong,em,a,dt,th,output,b,label,figcaption");
    for (var m = 0; m < all.length && set.length < cfg.maxCandidates; m++) {
      var e2 = all[m];
      if (seen.indexOf(e2) !== -1) continue;
      if (e2.children.length > 0 && !isTextLeaf(e2)) continue;
      var t2 = (e2.textContent || "").trim();
      var tl = t2.replace(/\s+/g, "").length;
      if (tl < 2) continue;
      if (!isVisible(e2)) continue;
      var cs2 = getComputedStyle(e2);
      var fp = parseFloat(cs2.fontSize) || rootFp;
      var big = fp >= rootFp * cfg.largeFontRatio && tl <= 120;
      var clipsX = e2.scrollWidth > e2.clientWidth + cfg.overflowTol;
      var clipsY = e2.scrollHeight > e2.clientHeight + cfg.overflowTol;
      var hides = cs2.overflow !== "visible" || cs2.overflowX !== "visible" || cs2.overflowY !== "visible";
      var clipping = e2.clientWidth > 0 && (clipsX || clipsY) && hides && tl <= 200;
      if (big || clipping) add(e2);
    }
    return set.slice(0, cfg.maxCandidates);
  }

  // 부모/자식 중복 제거: 같은 텍스트를 가진 조상 후보가 있으면 안쪽(자손)은 버린다.
  // wrap-balancer가 텍스트를 inline-block <span>으로 감싸면 부모와 그 span이 둘 다 잡히는데,
  // 의미 단위인 부모만 남기고 래퍼 span은 제거해 이중 카운트를 막는다.
  function dedupNested(cands) {
    var norm = cands.map(function (el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); });
    var drop = [];
    for (var i = 0; i < cands.length; i++) {
      if (!norm[i]) { drop[i] = true; continue; }
      for (var j = 0; j < cands.length; j++) {
        if (i === j || drop[j]) continue;
        if (norm[i] === norm[j] && cands[i].contains(cands[j])) drop[j] = true; // i가 j의 조상
      }
    }
    return cands.filter(function (_, k) { return !drop[k]; });
  }

  // ---------- 위치/슬라이드/경로 ----------
  var SLIDE_SEL = 'section,[class*="slide" i],[class*="step" i],[data-slide],.reveal section,li.slide';
  function slideInfo(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.matches && node.matches(SLIDE_SEL)) {
        var parent = node.parentElement;
        var idx = -1, count = 0;
        if (parent) {
          for (var i = 0; i < parent.children.length; i++) {
            if (parent.children[i].matches && parent.children[i].matches(SLIDE_SEL)) {
              if (parent.children[i] === node) idx = count;
              count++;
            }
          }
        }
        return { index: idx, label: shortName(node) };
      }
      node = node.parentElement;
    }
    return null;
  }
  function shortName(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    if (el.className && typeof el.className === "string") {
      var first = el.className.trim().split(/\s+/)[0];
      if (first) s += "." + first;
    }
    return s;
  }
  function cssPath(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 5) {
      if (node.id) { parts.unshift("#" + cssEsc(node.id)); break; }
      var seg = node.tagName.toLowerCase();
      if (node.className && typeof node.className === "string") {
        var cls = node.className.trim().split(/\s+/).filter(Boolean)[0];
        if (cls) seg += "." + cssEsc(cls);
      }
      var parent = node.parentElement;
      if (parent) {
        var same = 0, idx = 0;
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === node.tagName) {
            same++;
            if (parent.children[i] === node) idx = same;
          }
        }
        if (same > 1) seg += ":nth-of-type(" + idx + ")";
      }
      parts.unshift(seg);
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }
  function cssEsc(s) {
    return s.replace(/([^a-zA-Z0-9_\- -￿])/g, "\\$1");
  }

  // ---------- prominence(중요도) & class ----------
  function roleOf(el, rootFp) {
    var tag = el.tagName.toLowerCase();
    var fp = parseFloat(getComputedStyle(el).fontSize) || rootFp;
    if (tag === "h1" || fp >= rootFp * DEFAULTS.heroFontRatio) return { role: "hero", weight: 3 };
    if (tag === "h2" || tag === "h3" || fp >= rootFp * DEFAULTS.largeFontRatio) return { role: "title", weight: 2 };
    if (tag === "h4" || tag === "h5" || tag === "h6" || tag === "blockquote") return { role: "subtitle", weight: 2 };
    return { role: "body", weight: 1 };
  }

  // 줄 기하를 측정할 실제 대상. wrap-balancer 등은 텍스트를 단일 inline-block <span>으로
  // 감싸므로, 부모를 직접 재면 래퍼 박스 때문에 가짜 빈 줄이 생긴다. 단일 래퍼를 벗겨
  // 그 안쪽을 측정한다(보고/역할은 바깥 의미 요소 el 그대로 사용).
  function measureTarget(el) {
    var cur = el;
    for (var guard = 0; guard < 3; guard++) {
      if (cur.children.length !== 1) break;
      var ownText = "";
      for (var n = 0; n < cur.childNodes.length; n++) {
        if (cur.childNodes[n].nodeType === 3) ownText += cur.childNodes[n].nodeValue;
      }
      if (ownText.replace(/\s/g, "").length > 0) break; // 래퍼 밖에 직접 텍스트가 있으면 중단
      var child = cur.children[0];
      var d = getComputedStyle(child).display;
      if (d !== "inline-block" && d !== "inline" && d !== "block") break;
      if ((child.textContent || "").trim() !== (cur.textContent || "").trim()) break;
      cur = child;
    }
    return cur;
  }

  // ---------- 한 요소 분석 ----------
  function analyze(el, cfg, rootFp) {
    var target = measureTarget(el);
    var bands = lineBands(target, cfg.bandTol);
    var lineCount = bands.length;
    var widths = bands.map(function (b) { return Math.round((b.right - b.left) * 10) / 10; });
    var n = widths.length || 1;
    var maxW = widths.length ? Math.max.apply(null, widths) : 0;
    var minW = widths.length ? Math.min.apply(null, widths) : 0;
    var last = widths.length ? widths[widths.length - 1] : 0;
    var mean = widths.reduce(function (s, w) { return s + w; }, 0) / n;
    var variance = widths.reduce(function (s, w) { return s + (w - mean) * (w - mean); }, 0) / n;
    var stdev = Math.round(Math.sqrt(variance) * 10) / 10;

    var rect = el.getBoundingClientRect();
    var containerPx = Math.round(el.clientWidth || rect.width);
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    var words = text ? text.split(/\s+/).length : 0;
    var roleInfo = roleOf(el, rootFp);
    var tag = el.tagName.toLowerCase();
    var isHeading = /^h[1-6]$/.test(tag);
    var isShort = isHeading || roleInfo.weight >= 2 || words <= cfg.longWords;

    // 넘침/잘림 (어떤 블록이든 본다)
    var overflow = false, overflowDetail = "";
    var cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + cfg.overflowTol) {
      overflow = true;
      overflowDetail = "가로 넘침(scrollWidth " + el.scrollWidth + " > clientWidth " + el.clientWidth + ")";
      if (cs.textOverflow === "ellipsis") overflowDetail += ", … 말줄임 적용됨";
    } else if (el.scrollHeight > el.clientHeight + cfg.overflowTol && cs.overflowY !== "visible" && cs.overflow !== "visible") {
      overflow = true;
      overflowDetail = "세로 넘침/잘림(scrollHeight " + el.scrollHeight + " > clientHeight " + el.clientHeight + ")";
    }

    var problems = [];

    if (overflow) {
      problems.push({ type: "overflow", severity: 3, detail: overflowDetail });
    }

    // 줄별 텍스트 복원(짧은~중간 블록만; 길면 기하만)
    var lines = null;
    var rawTextLen = (el.textContent || "").length;
    if (lineCount >= 2 && rawTextLen <= cfg.detailMaxChars && lineCount <= 16) {
      lines = lineTexts(target, bands);
    }

    if (lineCount >= 2) {
      // 고아(P2): 마지막 줄이 외톨이인가
      var lastRatio = maxW ? Math.round((last / maxW) * 100) / 100 : null;
      var lastWords = lines ? tokens(lines[lines.length - 1]).length : null;
      var lastTokTrim = lines ? (tokens(lines[lines.length - 1])[0] || "") : "";
      if (lastRatio !== null && (lastRatio < cfg.orphanRatio || lastWords === 1)) {
        var sev = 1;
        if (lastWords === 1 && lastTokTrim.length <= 3) sev = 3; // 한 단어 + 짧으면 매우 거슬림
        else if (lastRatio < 0.2 || lastWords === 1) sev = 2;
        // 긴 문단의 마지막 한 단어(widow)는 한 단계 낮춰본다(헤딩만큼 거슬리지 않음)
        if (!isShort && sev > 2) sev = 2;
        problems.push({
          type: "orphan",
          severity: sev,
          detail: "마지막 줄 너비비 " + lastRatio + (lastWords !== null ? ", 단어수 " + lastWords : "") + (lastTokTrim ? " ('" + lastTokTrim + "')" : ""),
        });
      }

      // 불균형(P3): 줄 너비가 들쭉날쭉. 단, 고아로 이미 잡혔으면 그쪽이 대표하므로 건너뛴다
      // (2줄 블록이 살짝 짧은 마지막 줄을 갖는 건 흔하고 거슬리지 않으니, 임계값을 높게 둔다).
      // 기준 분모는 "가장 긴 줄"(maxW). shrink-wrap되는 밸런싱 결과에도 강건하다
      // (밸런싱이 잘 되면 줄들이 고르므로 max-min이 작아 자연히 통과).
      var hasOrphanNow = problems.some(function (p) { return p.type === "orphan"; });
      if (isShort && maxW && !hasOrphanNow) {
        var spread = maxW - minW;
        var spreadRatio = Math.round((spread / maxW) * 100) / 100;
        if (spreadRatio > cfg.imbalanceRatio) {
          problems.push({
            type: "imbalance",
            severity: spreadRatio > 0.65 ? 2 : 1,
            detail: "가장 긴 줄 대비 줄너비 편차 " + spreadRatio + " (max-min " + Math.round(spread) + "px, stdev " + stdev + ")",
          });
        }
      }

      // 과다 줄 수(P6): 짧은 제목이 4줄 이상이면서 줄들이 컨테이너를 잘 안 채울 때만(여백 많음).
      // 줄이 거의 꽉 차는데도 여러 줄이면 그냥 텍스트가 많은 것이라 문제가 아니다.
      if (isShort && lineCount >= 4 && words <= 10) {
        var meanW = widths.reduce(function (s, w) { return s + w; }, 0) / (widths.length || 1);
        var avgFill = containerPx ? meanW / containerPx : 1;
        if (avgFill < 0.55) {
          problems.push({ type: "excess_lines", severity: 1, detail: words + "어절 제목이 " + lineCount + "줄로 쪼개짐(평균 채움 " + Math.round(avgFill * 100) + "%)" });
        }
      }

      // 줄 경계 기반 분석(어절 끊김/의미 분리) — lines 복원된 경우만
      if (lines) {
        var joined = lines.join("");
        var boundary = 0;
        for (var li = 0; li < lines.length - 1; li++) {
          boundary += lines[li].length;
          // 줄이 갈리는 바로 그 지점의 두 글자. 둘 중 하나가 공백이면 공백(어절 경계)에서
          // 끊긴 정상 줄바꿈이다. 둘 다 단어 글자면 어절(토큰) 내부가 끊긴 것.
          var before = joined.charAt(boundary - 1);
          var after = joined.charAt(boundary);
          var cleanBreak = !before || !after || isSpace(before) || isSpace(after);
          var midword =
            !cleanBreak && isWordChar(before) && isWordChar(after) &&
            // 한국어 어절 보존이 목표이므로 한글이 끼면 끊김으로 본다. 라틴 단어 내부 분절도 본다.
            // (순수 한자/가나 사이 분절은 그 언어에선 정상 조판이므로 제외)
            (isHangul(before) || isHangul(after) || (isLatinNum(before) && isLatinNum(after)));
          if (midword) {
            problems.push({
              type: "midword_break",
              severity: isShort ? 3 : 2,
              detail: "'…" + tailCtx(lines[li]) + "' | '" + headCtx(lines[li + 1]) + "…' 사이에서 어절 중간이 끊김 (word-break:keep-all 누락 의심)",
            });
          } else if (cleanBreak) {
            // 의미 분리(P5): 공백에서 끊겼지만 숫자와 그 단위가 줄을 넘어 갈린 경우(의미상 어색)
            var lastTok = tokens(lines[li]).slice(-1)[0] || "";
            var firstNext = tokens(lines[li + 1])[0] || "";
            if (/[0-9]$/.test(lastTok) && firstNext && startsWithUnit(firstNext)) {
              problems.push({ type: "semantic_split", severity: 2, detail: "숫자 '" + lastTok + "' 와 단위 '" + firstNext + "' 가 다른 줄로 분리됨" });
            }
          }
        }
      }
    }

    // class별 범위 제한: 긴 문단은 고아·넘침만 남긴다(사용자 설정: 짧은 블록 집중)
    if (!isShort) {
      problems = problems.filter(function (p) { return p.type === "orphan" || p.type === "overflow"; });
    }

    // dedupe: 같은 type은 가장 높은 severity 하나로
    problems = dedupeProblems(problems);

    var sumSev = problems.reduce(function (s, p) { return s + p.severity; }, 0);
    var cleanliness = Math.max(0, 1 - Math.min(3, sumSev) / 3);

    return {
      tag: tag,
      role: roleInfo.role,
      weight: roleInfo.weight,
      klass: isShort ? "short" : "long",
      text: text.length > 140 ? text.slice(0, 140) + "…" : text,
      words: words,
      line_count: lineCount,
      line_widths: widths,
      container_px: containerPx,
      max_minus_min: Math.round((maxW - minW) * 10) / 10,
      stdev: stdev,
      last_line_ratio: maxW ? Math.round((last / maxW) * 100) / 100 : null,
      lines: lines ? lines.map(function (s) { return s.replace(/\s+/g, " ").trim(); }) : null,
      problems: problems,
      cleanliness: Math.round(cleanliness * 100) / 100,
      scored: lineCount >= 2 || overflow,
    };
  }

  function startsWithUnit(tok) {
    for (var i = 0; i < UNITS.length; i++) {
      if (tok.indexOf(UNITS[i]) === 0) return true;
    }
    return false;
  }
  function tailCtx(s) {
    var t = s.replace(/\s+$/, "");
    return t.slice(-6);
  }
  function headCtx(s) {
    var t = s.replace(/^\s+/, "");
    return t.slice(0, 6);
  }
  function dedupeProblems(problems) {
    var byType = {};
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      if (!byType[p.type] || p.severity > byType[p.type].severity) byType[p.type] = p;
    }
    var out = [];
    for (var k in byType) if (byType.hasOwnProperty(k)) out.push(byType[k]);
    // severity 내림차순
    out.sort(function (a, b) { return b.severity - a.severity; });
    return out;
  }

  // ---------- 메인 ----------
  function scan(opts) {
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    if (opts) for (var k2 in opts) cfg[k2] = opts[k2];

    var rootFp = rootFontPx();
    var cands = dedupNested(collectCandidates(cfg.selector, cfg));
    var findings = [];
    var scoredW = 0, scoredWC = 0;
    var scanned = 0, wrapped = 0;
    var byProblem = {};

    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      var a;
      try { a = analyze(el, cfg, rootFp); } catch (e) { continue; }
      scanned++;
      if (a.scored) {
        wrapped++;
        scoredW += a.weight;
        scoredWC += a.weight * a.cleanliness;
      }
      if (a.problems.length === 0) continue;
      a.id = findings.length;
      a.path = cssPath(el);
      a.slide = slideInfo(el);
      findings.push(a);
      for (var pi = 0; pi < a.problems.length; pi++) {
        var ty = a.problems[pi].type;
        byProblem[ty] = (byProblem[ty] || 0) + 1;
      }
    }

    var pageScore = scoredW > 0 ? Math.round((100 * scoredWC) / scoredW) : 100;
    var grade = pageScore >= 90 ? "A" : pageScore >= 80 ? "B" : pageScore >= 70 ? "C" : pageScore >= 60 ? "D" : "F";
    var verdict = pageScore >= 90 ? "clean" : pageScore >= 80 ? "minor" : pageScore >= 60 ? "needs_work" : "poor";

    // 가장 심각한 항목: weight×최대severity 내림차순
    var ranked = findings.slice().sort(function (a, b) {
      var sa = a.weight * (a.problems[0] ? a.problems[0].severity : 0);
      var sb = b.weight * (b.problems[0] ? b.problems[0].severity : 0);
      return sb - sa;
    });
    var worst = ranked.slice(0, 5).map(function (f) { return f.id; });

    return {
      summary: {
        scanned: scanned,
        wrapped: wrapped,
        findings: findings.length,
        page_score: pageScore,
        grade: grade,
        verdict: verdict,
        by_problem: byProblem,
        worst: worst,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        root_font_px: rootFp,
      },
      findings: findings,
      config: cfg,
    };
  }

  // ---------- 프레임워크 덱: 숨은 슬라이드 임시 표시 ----------
  // reveal.js/impress.js 등은 활성 슬라이드만 렌더한다(나머지는 display:none/translate).
  // 스캔 전에 호출하면 모든 섹션을 흐름에 펼쳐 한 번에 측정할 수 있다.
  // 주의: 레이아웃을 임시로 바꾸므로, 스캔 후 페이지를 새로고침하거나 __lbRevealUndo()로 되돌린다.
  var REVEAL_ID = "__lb_reveal_style";
  function revealAll() {
    if (document.getElementById(REVEAL_ID)) return "already";
    var st = document.createElement("style");
    st.id = REVEAL_ID;
    st.textContent =
      ".reveal .slides,.reveal{position:static!important;height:auto!important;overflow:visible!important;}" +
      ".reveal .slides section,.reveal section,section.slide,.slide,.step,[data-slide]{" +
      "display:block!important;position:static!important;transform:none!important;opacity:1!important;" +
      "visibility:visible!important;height:auto!important;top:auto!important;left:auto!important;" +
      "margin:0 0 24px 0!important;pointer-events:auto!important;}";
    document.head.appendChild(st);
    return "revealed";
  }
  function revealUndo() {
    var st = document.getElementById(REVEAL_ID);
    if (st) st.parentNode.removeChild(st);
    return "undone";
  }

  // ---------- export ----------
  window.__scanLineBreaks = scan;
  window.__scanLineBreaksJSON = function (opts) { return JSON.stringify(scan(opts)); };
  window.__lbRevealAll = revealAll;
  window.__lbRevealUndo = revealUndo;

  return window.__scanLineBreaks();
})();
