/*
 * measure_lines.js — objective line metrics for a rendered harness.
 *
 * Run this IN THE PAGE (via your browser tool's "evaluate" call) after the page
 * reports data-ready. It measures, per title box, how the text actually wrapped:
 * line count and the rendered width of each line. Feed the result to the
 * balance-quality-evaluator so its C1/C2 scoring rests on numbers, not eyeballs.
 *
 * It works on both before.html and after.html because it measures the RENDERED
 * text, regardless of whether wrap-balancer wrapped the children in a span.
 *
 * Usage (returns a JSON-serialisable array):
 *   __wbMeasure()                 // default selector ".wbox .title"
 *   __wbMeasure(".hero")          // custom selector
 *
 * Each entry:
 *   {
 *     index, container_px,        // box ordinal + its CSS width
 *     line_count,
 *     line_widths,                // px width of each rendered line, top→bottom
 *     max_minus_min,              // spread of line widths (lower = more even)
 *     stdev,                      // stddev of line widths (lower = more even)
 *     last_line_ratio,            // last line width / widest line  (low = orphan risk)
 *     text
 *   }
 */
(function () {
  function lineMetrics(el) {
    var rects = [];
    // A Range over the element's full text gives one client rect per line
    // fragment; distinct top bands = distinct lines.
    var range = document.createRange();
    range.selectNodeContents(el);
    var list = range.getClientRects();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.width === 0 && r.height === 0) continue;
      rects.push(r);
    }
    // Group rects into lines by rounded top (tolerance for sub-pixel j/anti-alias).
    var bands = []; // {top, left, right}
    var TOL = 4;
    for (var j = 0; j < rects.length; j++) {
      var r2 = rects[j];
      var placed = false;
      for (var b = 0; b < bands.length; b++) {
        if (Math.abs(bands[b].top - r2.top) <= TOL) {
          bands[b].left = Math.min(bands[b].left, r2.left);
          bands[b].right = Math.max(bands[b].right, r2.right);
          placed = true;
          break;
        }
      }
      if (!placed) bands.push({ top: r2.top, left: r2.left, right: r2.right });
    }
    bands.sort(function (a, b2) { return a.top - b2.top; });
    var widths = bands.map(function (bd) { return Math.round((bd.right - bd.left) * 10) / 10; });
    var n = widths.length || 1;
    var mean = widths.reduce(function (s, w) { return s + w; }, 0) / n;
    var variance = widths.reduce(function (s, w) { return s + (w - mean) * (w - mean); }, 0) / n;
    var stdev = Math.round(Math.sqrt(variance) * 10) / 10;
    var maxW = widths.length ? Math.max.apply(null, widths) : 0;
    var minW = widths.length ? Math.min.apply(null, widths) : 0;
    var last = widths.length ? widths[widths.length - 1] : 0;
    return {
      line_count: widths.length,
      line_widths: widths,
      max_minus_min: Math.round((maxW - minW) * 10) / 10,
      stdev: stdev,
      last_line_ratio: maxW ? Math.round((last / maxW) * 100) / 100 : null,
      text: (el.textContent || "").trim(),
    };
  }

  window.__wbMeasure = function (selector) {
    selector = selector || ".wbox .title";
    var els = document.querySelectorAll(selector);
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var box = el.closest(".wbox") || el.parentElement;
      var containerPx = box ? Math.round(box.getBoundingClientRect().width) : null;
      var m = lineMetrics(el);
      m.index = i;
      m.container_px = containerPx;
      out.push(m);
    }
    return out;
  };

  // Convenience: return a JSON string (some eval bridges serialize strings best).
  window.__wbMeasureJSON = function (selector) {
    return JSON.stringify(window.__wbMeasure(selector));
  };

  return window.__wbMeasure();
})();
