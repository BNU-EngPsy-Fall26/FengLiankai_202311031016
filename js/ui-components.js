/*!
 * ui-components.js —— 界面构建与 Canvas 绘图工具
 * ---------------------------------------------------------------------------
 * 提供三类可复用能力：
 *   1. 调色板 / 主题常量（与 css 变量语义保持一致）
 *   2. Canvas 绘图原语：坐标变换、正态分布曲线、高斯钟形填充、ROC 曲线、图例
 *   3. 轻量 DOM 工具：元素创建、图标、格式化
 *
 * 所有绘图函数都接收"逻辑坐标系"参数，内部按 devicePixelRatio 做高清适配，
 * 因此在不同缩放的屏幕上都不会发虚。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* ======================================================================
   * 1. 调色板（语义与 css/main.css 一致）
   * ==================================================================== */
  var PALETTE = {
    brand900: '#0d2137',
    brand800: '#123152',
    brand700: '#1a4571',
    brand600: '#235a91',
    brand500: '#2f76b8',
    brand300: '#8fbde3',
    brand100: '#dceaf7',
    brand050: '#f0f6fc',

    accent700: '#9a5b09',
    accent600: '#c07812',
    accent500: '#e0951d',
    accent300: '#f3c877',
    accent100: '#fdf1d8',

    hit700: '#0f5132', hit500: '#1a7f4f', hit100: '#dcf1e4',
    miss700: '#7a4b06', miss500: '#b8801a', miss100: '#fbeed3',
    fa700: '#8a2521', fa500: '#c0392b', fa100: '#fbe2df',
    cr700: '#1d4d78', cr500: '#2f76b8', cr100: '#dfeaf6',

    ink900: '#10161d', ink700: '#2b3644', ink500: '#56636f',
    ink400: '#78848f', ink300: '#9aa5af', ink200: '#c8d0d8',
    ink100: '#e4e9ee', ink050: '#f2f5f8',

    paper: '#ffffff',
    paperSunk: '#f7f9fb',
    lineStrong: '#b9c3cd',
    line: '#d5dce3',
    lineSoft: '#e7ecf1'
  };

  // 结果四类的统一色（图形中复用）
  var RESULT_COLORS = {
    hit: { fill: 'rgba(26,127,79,.34)', stroke: PALETTE.hit500, label: '击中' },
    miss: { fill: 'rgba(184,128,26,.34)', stroke: PALETTE.miss500, label: '漏报' },
    fa: { fill: 'rgba(192,57,43,.34)', stroke: PALETTE.fa500, label: '虚报' },
    cr: { fill: 'rgba(47,118,184,.30)', stroke: PALETTE.cr500, label: '正确拒斥' }
  };

  var FONT_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  var FONT_MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, "SF Mono", monospace';

  /* ======================================================================
   * 2. Canvas 高清适配
   * ==================================================================== */

  /**
   * 让 canvas 的绘制缓冲与 CSS 尺寸匹配（考虑 devicePixelRatio），
   * 并返回一个已按 CSS 像素建立坐标系的 2D 上下文。
   */
  function setupCanvas(canvas) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    // 清掉上一次写入的行内高度：否则 rect.height 永远是首次绘制时的值，
    // 窗口变窄/变宽后画布高度不再跟着 aspect-ratio 变化（横向被拉伸）。
    canvas.style.height = '';
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width || canvas.width;
    var cssH = rect.height || canvas.height;

    // 若 CSS 没给出高度（例如尚未布局），按内在比例推算
    if (!rect.height && canvas.width) {
      cssH = cssW * (canvas.height / canvas.width);
    }
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return { ctx: ctx, w: cssW, h: cssH };
  }

  /** 线性映射工厂：把逻辑区间映射到像素区间 */
  function makeScale(d0, d1, p0, p1) {
    var k = (d1 - d0) === 0 ? 1 : (p1 - p0) / (d1 - d0);
    return function (v) { return p0 + (v - d0) * k; };
  }

  /* ======================================================================
   * 3. 正态分布绘图
   * ==================================================================== */

  /**
   * 绘制一条高斯钟形曲线路径（不描边，只建路径）。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Function} sx 逻辑 x → 像素 x
   * @param {Function} sy 逻辑 y → 像素 y
   * @param {number} mu 均值（逻辑坐标）
   * @param {number} sd 标准差
   * @param {number} x0 绘制区间起点
   * @param {number} x1 绘制区间终点
   */
  function gaussPath(ctx, sx, sy, mu, sd, x0, x1, steps) {
    steps = steps || 260;
    ctx.beginPath();
    for (var i = 0; i <= steps; i++) {
      var x = x0 + (x1 - x0) * i / steps;
      var y = Math.exp(-0.5 * Math.pow((x - mu) / sd, 2)) / (sd * Math.sqrt(2 * Math.PI));
      var px = sx(x);
      var py = sy(y);
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
  }

  /**
   * 填充"曲线下方某区间"的面积（用于表示四种结果的概率）。
   * @param {number} a 区间起点（逻辑 x）
   * @param {number} b 区间终点
   */
  function gaussArea(ctx, sx, sy, mu, sd, a, b, x0, x1, fillStyle, strokeStyle, steps) {
    steps = steps || 200;
    var lo = Math.max(a, x0);
    var hi = Math.min(b, x1);
    if (hi <= lo) { return; }

    ctx.beginPath();
    ctx.moveTo(sx(lo), sy(0));
    for (var i = 0; i <= steps; i++) {
      var x = lo + (hi - lo) * i / steps;
      var y = Math.exp(-0.5 * Math.pow((x - mu) / sd, 2)) / (sd * Math.sqrt(2 * Math.PI));
      ctx.lineTo(sx(x), sy(y));
    }
    ctx.lineTo(sx(hi), sy(0));
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** 绘制坐标轴 + 刻度（理论演示主图用） */
  function drawAxes(ctx, sx, sy, cfg) {
    var left = cfg.left; var right = cfg.right;
    var top = cfg.top; var bottom = cfg.bottom;

    ctx.save();

    // 竖向网格线
    ctx.strokeStyle = PALETTE.lineSoft;
    ctx.lineWidth = 1;
    (cfg.xTicks || []).forEach(function (t) {
      var px = Math.round(sx(t.v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
    });

    // 基线（y = 0）
    ctx.strokeStyle = PALETTE.lineStrong;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(sy(0)) + 0.5);
    ctx.lineTo(right, Math.round(sy(0)) + 0.5);
    ctx.stroke();

    // 左轴
    ctx.beginPath();
    ctx.moveTo(Math.round(left) + 0.5, top);
    ctx.lineTo(Math.round(left) + 0.5, bottom);
    ctx.stroke();

    // x 刻度标签
    ctx.fillStyle = PALETTE.ink400;
    ctx.font = '11px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    (cfg.xTicks || []).forEach(function (t) {
      var px = sx(t.v);
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, bottom);
      ctx.lineTo(Math.round(px) + 0.5, bottom + 4);
      ctx.strokeStyle = PALETTE.lineStrong;
      ctx.stroke();
      if (t.label !== '') {
        ctx.fillText(t.label === undefined ? String(t.v) : t.label, px, bottom + 7);
      }
    });

    // 轴名
    if (cfg.xLabel) {
      ctx.font = '11.5px ' + FONT_UI;
      ctx.fillStyle = PALETTE.ink500;
      ctx.textAlign = 'right';
      ctx.fillText(cfg.xLabel, right, bottom + 25);
    }
    if (cfg.yLabel) {
      ctx.save();
      ctx.translate(13, top);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = PALETTE.ink500;
      ctx.font = '11.5px ' + FONT_UI;
      ctx.fillText(cfg.yLabel, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /** 在画布右上角绘制图例（本项目的图注约定：说明放在右上角） */
  function drawLegend(ctx, items, x, y, opts) {
    opts = opts || {};
    var pad = 9;
    var lineH = opts.lineH || 17;
    var swatch = opts.swatch || 11;
    var font = opts.font || ('12px ' + FONT_UI);
    var gap = opts.gap || 12;

    ctx.save();
    ctx.font = font;

    // 计算宽度：横向排列
    var widths = items.map(function (it) {
      return swatch + 6 + ctx.measureText(it.label).width;
    });
    var totalW = widths.reduce(function (a, b) { return a + b; }, 0)
      + gap * Math.max(0, items.length - 1);

    var boxW = totalW + pad * 2;
    var boxH = lineH + pad;
    var bx = (opts.alignRight === false) ? x : x - boxW;
    var by = y;

    if (opts.background !== false) {
      ctx.fillStyle = opts.bgColor || 'rgba(255,255,255,.92)';
      ctx.strokeStyle = PALETTE.line;
      ctx.lineWidth = 1;
      roundRect(ctx, bx, by, boxW, boxH, 5);
      ctx.fill();
      ctx.stroke();
    }

    var cx = bx + pad;
    var cy = by + pad + lineH / 2;
    items.forEach(function (it, i) {
      ctx.fillStyle = it.color;
      if (it.dash) {
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + swatch, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (it.line) {
        ctx.strokeStyle = it.color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + swatch, cy);
        ctx.stroke();
      } else {
        roundRect(ctx, cx, cy - swatch / 2, swatch, swatch, 2.5);
        ctx.fill();
        if (it.border) {
          ctx.strokeStyle = it.border;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.fillStyle = it.textColor || PALETTE.ink700;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.label, cx + swatch + 6, cy + 0.5);
      cx += widths[i] + gap;
    });

    ctx.restore();
    return { x: bx, y: by, w: boxW, h: boxH };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dashedLine(ctx, x1, y1, x2, y2, color, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash || [3, 3]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /** 曲线外标签（带轻微白底，避免压线） */
  function curveLabel(ctx, text, x, y, color, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = opts.font || ('600 12px ' + FONT_UI);
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = 'middle';
    if (opts.pill !== false) {
      var w = ctx.measureText(text).width;
      var padX = 5;
      var padY = 3.5;
      var bx = opts.align === 'right' ? x - w - padX * 2 : (opts.align === 'center' ? x - w / 2 - padX : x - padX);
      ctx.fillStyle = 'rgba(255,255,255,.86)';
      roundRect(ctx, bx, y - 8 - padY / 2, w + padX * 2, 16 + padY, 4);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /* ======================================================================
   * 4. ROC 曲线绘图
   * ==================================================================== */

  /**
   * 通用 ROC 面板绘制。
   * @param {Object} o
   *   canvas, d, c, showFamily, zSpace,
   *   points 额外叠加的经验点 [{fa,hit,label}]
   *   curveOverride 可选：直接给 {fa:[],hit:[]} 覆盖理论曲线
   */
  function drawROC(o) {
    var sc = setupCanvas(o.canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;

    var L = 58;
    var R = W - 16;
    var TP = 18;
    var B = H - 40;
    var size = Math.min(R - L, B - TP);
    R = L + size;
    B = TP + size;

    var zSpace = !!o.zSpace;

    // 逻辑坐标范围
    var xLo = zSpace ? -3.2 : 0;
    var xHi = zSpace ? 3.2 : 1;
    var yLo = zSpace ? -3.2 : 0;
    var yHi = zSpace ? 3.2 : 1;

    var sx = makeScale(xLo, xHi, L, R);
    var sy = makeScale(yLo, yHi, B, TP);

    // 底板
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(L, TP, size, size);

    // 网格
    ctx.strokeStyle = PALETTE.lineSoft;
    ctx.lineWidth = 1;
    var gridVals = zSpace ? [-3, -2, -1, 0, 1, 2, 3] : [0, .2, .4, .6, .8, 1];
    gridVals.forEach(function (v) {
      var px = Math.round(sx(v)) + 0.5;
      var py = Math.round(sy(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, TP); ctx.lineTo(px, B); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L, py); ctx.lineTo(R, py); ctx.stroke();
    });

    // 边框
    ctx.strokeStyle = PALETTE.lineStrong;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(L + 0.5, TP + 0.5, size - 1, size - 1);

    // 几率对角线（仅在概率坐标下有意义）
    if (!zSpace) {
      dashedLine(ctx, sx(0), sy(0), sx(1), sy(1), PALETTE.ink300, [5, 4]);
    } else {
      dashedLine(ctx, sx(0), sy(0), sx(0), sy(3.2), PALETTE.ink300, [5, 4]);
    }

    // d' 曲线族
    if (o.showFamily) {
      var family = [
        { d: 0, color: '#b9c3cd', label: "d′ = 0" },
        { d: 1, color: PALETTE.brand300, label: "d′ = 1" },
        { d: 2, color: PALETTE.brand500, label: "d′ = 2" },
        { d: 3, color: PALETTE.brand700, label: "d′ = 3" }
      ];
      family.forEach(function (f) {
        drawROCCurve(ctx, f.d, sx, sy, zSpace, f.color, 1.6, true);
      });
    }

    // 主曲线（当前 d'）
    drawROCCurve(ctx, o.d, sx, sy, zSpace, PALETTE.accent600, 2.6, false);

    // 经验点（结算页用）
    if (o.points && o.points.length) {
      o.points.forEach(function (p) {
        var x = zSpace ? SDT.normInv(clamp01(p.fa)) : p.fa;
        var y = zSpace ? SDT.normInv(clamp01(p.hit)) : p.hit;
        if (!isFinite(x) || !isFinite(y)) { return; }
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), 4.2, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.fa500;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      });
    }

    // 当前操作点
    var hit = SDT.normCdf(o.d / 2 - o.c);
    var fa = SDT.normCdf(-o.d / 2 - o.c);
    var px = sx(zSpace ? SDT.normInv(clamp01(fa)) : fa);
    var py = sy(zSpace ? SDT.normInv(clamp01(hit)) : hit);

    // 引导虚线
    dashedLine(ctx, L, py, px, py, PALETTE.accent600, [4, 3]);
    dashedLine(ctx, px, py, px, B, PALETTE.accent600, [4, 3]);

    ctx.beginPath();
    ctx.arc(px, py, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.accent500;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 轴刻度
    ctx.fillStyle = PALETTE.ink400;
    ctx.font = '10.5px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    gridVals.forEach(function (v) {
      ctx.fillText(zSpace ? String(v) : v.toFixed(1), sx(v), B + 6);
    });
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    gridVals.forEach(function (v) {
      ctx.fillText(zSpace ? String(v) : v.toFixed(1), L - 6, sy(v));
    });

    // 轴名
    ctx.fillStyle = PALETTE.ink500;
    ctx.font = '11.5px ' + FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(zSpace ? 'Z(虚报率)' : '虚报率 P(FA)', L + size / 2, B + 22);

    ctx.save();
    ctx.translate(15, TP + size / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(zSpace ? 'Z(击中率)' : '击中率 P(Hit)', 0, 0);
    ctx.restore();

    // 右上角图例
    var legendItems = [
      { color: PALETTE.accent600, line: true, label: "当前 d′ = " + SDT.fmt(o.d, 2) },
      { color: PALETTE.accent500, label: '操作点' }
    ];
    if (o.showFamily) {
      legendItems.push({ color: PALETTE.ink300, dash: true, label: 'd′ 曲线族' });
    }
    if (o.points && o.points.length) {
      legendItems.push({ color: PALETTE.fa500, label: '实测点' });
    }
    drawLegend(ctx, legendItems, R - 6, TP + 6, { font: '11.5px ' + FONT_UI, lineH: 16 });

    return { hit: hit, fa: fa, px: px, py: py };
  }

  function drawROCCurve(ctx, d, sx, sy, zSpace, color, width, thin) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = thin ? 0.85 : 1;
    ctx.beginPath();
    var N = 220;
    for (var i = 0; i <= N; i++) {
      var c = -4 + 8 * i / N;
      var h = SDT.normCdf(d / 2 - c);
      var f = SDT.normCdf(-d / 2 - c);
      var x = zSpace ? SDT.normInv(clamp01(f)) : f;
      var y = zSpace ? SDT.normInv(clamp01(h)) : h;
      if (!isFinite(x) || !isFinite(y)) { continue; }
      var px = sx(x); var py = sy(y);
      if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();
    ctx.restore();
  }

  function clamp01(p) {
    return p < 1e-9 ? 1e-9 : (p > 1 - 1e-9 ? 1 - 1e-9 : p);
  }

  /* ======================================================================
   * 5. 迷你分布图（首页 / 结算页）
   * ==================================================================== */

  /**
   * 绘制简洁的 N / SN 双分布图，可标注当前标准与四种结果。
   * @param {Object} o {canvas, d, c, showAreas, compact}
   */
  function drawDistribution(o) {
    var sc = setupCanvas(o.canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;

    var xLo = -4;
    var xHi = 6;
    var yMax = 0.44;

    // 手机宽度（~360–420px）下把留白与字号降一档，
    // 否则图例那三项（含括号说明）会宽过画布、被两端裁掉。
    var narrow = W < 520;

    var padL = narrow ? 30 : 40;
    var padR = narrow ? 12 : 18;
    var padT = narrow ? 38 : 46;
    var padB = narrow ? 34 : 38;

    var sx = makeScale(xLo, xHi, padL, W - padR);
    var sy = makeScale(0, yMax, H - padB, padT);

    // 底板
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(padL, padT, W - padL - padR, H - padT - padB);

    var d = o.d;
    var cAbs = o.c + d / 2;  // C 的 Z 轴刻度 → 绝对轴位置

    // 四种结果面积
    if (o.showAreas !== false) {
      // N 分布：右侧（x > cAbs）= 虚报
      gaussArea(ctx, sx, sy, 0, 1, cAbs, xHi, xLo, xHi, RESULT_COLORS.fa.fill);
      // N 分布：左侧 = 正确拒斥
      gaussArea(ctx, sx, sy, 0, 1, xLo, cAbs, xLo, xHi, RESULT_COLORS.cr.fill);
      // SN 分布：右侧 = 击中
      gaussArea(ctx, sx, sy, d, 1, cAbs, xHi, xLo, xHi, RESULT_COLORS.hit.fill);
      // SN 分布：左侧 = 漏报
      gaussArea(ctx, sx, sy, d, 1, xLo, cAbs, xLo, xHi, RESULT_COLORS.miss.fill);
    }

    // 曲线
    ctx.strokeStyle = PALETTE.ink400;
    ctx.lineWidth = 2;
    gaussPath(ctx, sx, sy, 0, 1, xLo, xHi);
    ctx.stroke();

    ctx.strokeStyle = PALETTE.brand600;
    ctx.lineWidth = 2.4;
    gaussPath(ctx, sx, sy, d, 1, xLo, xHi);
    ctx.stroke();

    // 基线
    ctx.strokeStyle = PALETTE.lineStrong;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(sy(0)) + 0.5);
    ctx.lineTo(W - padR, Math.round(sy(0)) + 0.5);
    ctx.stroke();

    // 判断标准竖线
    var cpx = sx(cAbs);
    ctx.save();
    ctx.strokeStyle = PALETTE.accent600;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cpx, padT + 2);
    ctx.lineTo(cpx, sy(0));
    ctx.stroke();
    ctx.restore();

    // 分布中心标记
    ctx.setLineDash([]);
    [[0, PALETTE.ink400, 'N'], [d, PALETTE.brand600, 'SN']].forEach(function (m) {
      var px = sx(m[0]);
      var py = sy(Math.exp(0) / Math.sqrt(2 * Math.PI));

      ctx.strokeStyle = m[1];
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, sy(0));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(px, py, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = m[1];
      ctx.fill();

      curveLabel(ctx, m[2], px, py - (narrow ? 13 : 15), m[1], {
        align: 'center', pill: false,
        font: (narrow ? '700 11px ' : '700 12.5px ') + FONT_MONO
      });
    });

    // C 标注
    if (o.showAreas !== false) {
      curveLabel(ctx, 'C', cpx, padT + 12, PALETTE.accent700, {
        align: 'center', pill: false, font: '700 13px ' + FONT_MONO
      });
    }

    // 轴刻度
    ctx.fillStyle = PALETTE.ink400;
    ctx.font = '10.5px ' + FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var v = Math.ceil(xLo); v <= Math.floor(xHi); v++) {
      ctx.fillText(String(v), sx(v), H - padB + 7);
    }
    ctx.fillStyle = PALETTE.ink500;
    ctx.font = '11px ' + FONT_UI;
    ctx.textAlign = 'right';
    ctx.fillText(o.xLabel || '内部感觉量 x', W - padR, H - padB + 24);

    // 右上角图例（窄屏换成短标签，否则整条图例会宽过画布被裁掉）
    drawLegend(ctx, narrow ? [
      { color: PALETTE.ink400, line: true, label: 'N' },
      { color: PALETTE.brand600, line: true, label: 'SN' },
      { color: PALETTE.accent600, dash: true, label: '判据 C' }
    ] : [
      { color: PALETTE.ink400, line: true, label: 'N 分布（纯噪音）' },
      { color: PALETTE.brand600, line: true, label: 'SN 分布（噪音+信号）' },
      { color: PALETTE.accent600, dash: true, label: '判断标准 C' }
    ], W - padR, narrow ? 5 : 8, {
      font: (narrow ? '10px ' : '11.5px ') + FONT_UI,
      lineH: narrow ? 13 : 16,
      swatch: narrow ? 9 : 11,
      gap: narrow ? 8 : 12
    });

    return { sx: sx, sy: sy, cAbs: cAbs };
  }

  /* ======================================================================
   * 6. 轻量 DOM 工具
   * ==================================================================== */

  /** 用 HTML 字符串创建元素（内容由本文件内的固定模板提供，不含外部输入） */
  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') { node.className = attrs[k]; }
        else if (k === 'text') { node.textContent = attrs[k]; }
        else if (k === 'html') { node.innerHTML = attrs[k]; }
        else if (k.indexOf('on') === 0) { node.addEventListener(k.slice(2), attrs[k]); }
        else { node.setAttribute(k, attrs[k]); }
      });
    }
    (children || []).forEach(function (c) {
      if (typeof c === 'string') { node.appendChild(document.createTextNode(c)); }
      else if (c) { node.appendChild(c); }
    });
    return node;
  }

  /* ======================================================================
   * 6.5 数学公式片段
   *     —— 全站的除法一律走 frac()，不要再写 "a / b" 这种斜杠表示法；
   *        公式块一律走 formula()，每一行 white-space: nowrap 保证不断行。
   * ==================================================================== */

  /**
   * 分数写法：上下两行 + 中间一条横线。
   * @param {string} num 分子（HTML 片段，单字母变量请自己包 <i>）
   * @param {string} den 分母
   * @param {string} [size] 传 'xs' 用于指标瓦片/表格这类小字号环境
   */
  function frac(num, den, size) {
    var cls = 'frac' + (size === 'xs' ? ' frac--xs' : '');
    return '<span class="' + cls + '">'
      + '<span class="frac__num">' + num + '</span>'
      + '<span class="frac__den">' + den + '</span></span>';
  }

  /** 公式块：rows 为若干条 HTML 片段，一行一条，整体不折行 */
  function formula(rows, extraClass) {
    var box = el('div', { class: 'formula' + (extraClass ? ' ' + extraClass : '') });
    (rows || []).forEach(function (r) {
      box.appendChild(el('span', { class: 'formula__row', html: r }));
    });
    return box;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  /** 场景图标（内联 SVG，避免外部资源依赖） */
  var ICONS = {
    radar: '<svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">'
      + '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="6" opacity=".55"/>'
      + '<path d="M16 16 L24.5 8.5"/><circle cx="22" cy="21" r="1.6" fill="currentColor" stroke="none"/></svg>',

    legal: '<svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M16 5v20"/><path d="M7 26h18"/><path d="M16 9 L6 13"/>'
      + '<path d="M16 9 L26 13"/><path d="M3 18.5 a4 4 0 0 0 6 0" opacity=".7"/>'
      + '<path d="M23 18.5 a4 4 0 0 0 6 0" opacity=".7"/></svg>',

    industrial: '<svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
      + '<rect x="4" y="9" width="17" height="14" rx="2"/>'
      + '<path d="M21 14 h5 l2 3 v4 h-7"/>'
      + '<path d="M9 22 l3-3 l2.5 2 l3-5 l3 4"/>'
      + '<circle cx="8.5" cy="25.5" r="2"/><circle cx="24.5" cy="25.5" r="2"/></svg>'
  };

  /* ======================================================================
   * 7. 导出
   * ==================================================================== */
  global.UI = {
    PALETTE: PALETTE,
    RESULT_COLORS: RESULT_COLORS,
    FONT_UI: FONT_UI,
    FONT_MONO: FONT_MONO,
    ICONS: ICONS,
    setupCanvas: setupCanvas,
    makeScale: makeScale,
    gaussPath: gaussPath,
    gaussArea: gaussArea,
    drawAxes: drawAxes,
    drawLegend: drawLegend,
    roundRect: roundRect,
    dashedLine: dashedLine,
    curveLabel: curveLabel,
    drawROC: drawROC,
    drawDistribution: drawDistribution,
    h: h,
    el: el,
    frac: frac,
    formula: formula,
    clear: clear
  };
}(typeof window !== 'undefined' ? window : globalThis));
