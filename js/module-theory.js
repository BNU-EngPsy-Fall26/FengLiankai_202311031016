/*!
 * module-theory.js —— 理论演示：分布拖拽、指标联动、ROC 变化
 * ---------------------------------------------------------------------------
 * 本模块只负责"画"与"绑事件"，一切数值都来自 js/sdt-core.js，
 * 确保网页显示与内核公式严格一致（内核已独立通过 57 项数值测试）。
 *
 * 演示内容：
 *   ① N 分布与 SN 分布的形状、中心、重叠区
 *   ② 拖动 C → 四种结果的面积如何此消彼长，P(hit)/P(fa)/β/C 如何联动
 *   ③ 拖动 d' → 两个分布分离程度变化，ROC 曲线整体抬升
 *   ④ ROC 曲线上当前操作点的位置随 C 移动
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var UI = global.UI;
  var SDT = global.SDT;

  var state = {
    d: 1.5,
    c: 0,
    showFamily: true,
    zSpace: false
  };

  var els = {};

  // 最近一次分布画布的几何信息（拖拽命中判定要用）。
  // 放在模块级而不是闭包参数里，这样 resize / 切页重绘后无需重复绑定事件。
  var geom = null;

  /* ======================================================================
   * 主分布画布
   * ==================================================================== */

  /**
   * 窄屏图例：原图例是单行 7 项、带长括号说明，宽度 ~500px，
   * 在 390px 的画布上会被两端裁掉。这里拆成两行、去掉解释性文字，
   * 只保留「哪条线是什么、哪块颜色是什么」这两件必要信息。
   */
  function drawNarrowLegend(ctx, rightX, P) {
    var opts = { font: '10px ' + UI.FONT_UI, lineH: 12, swatch: 9, gap: 8, background: false };
    UI.drawLegend(ctx, [
      { color: P.ink500, line: true, label: 'N' },
      { color: P.brand600, line: true, label: 'SN' },
      { color: P.accent600, line: true, label: '判据 C' }
    ], rightX - 6, 2, opts);
    UI.drawLegend(ctx, [
      { color: UI.RESULT_COLORS.hit.stroke, label: '击中' },
      { color: UI.RESULT_COLORS.fa.stroke, label: '虚报' },
      { color: UI.RESULT_COLORS.miss.stroke, label: '漏报' },
      { color: UI.RESULT_COLORS.cr.stroke, label: '正确拒斥' }
    ], rightX - 6, 15, opts);
  }

  function drawDistributionCanvas() {
    var canvas = els.distCanvas;
    if (!canvas || !canvas.getBoundingClientRect().width) { return; }

    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;
    var P = UI.PALETTE;

    var d = state.d;
    var cAbs = state.c + d / 2;   // C 的 Z 轴刻度 → 绝对感觉量轴位置

    // 逻辑坐标范围：覆盖两个分布（留出右侧空间）
    var xLo = -4.0;
    var xHi = Math.max(5.0, d + 4.0);
    var yMax = 0.45;

    // 窄屏（手机）画布只有 ~360–420px 宽：留白收紧、字号降一档、贴图标签改短，
    // 保证曲线主体仍然占满视口——数值一个不少，只是搬到了下面的指标瓦片里。
    var narrow = W < 560;

    var padL = narrow ? 34 : 52;
    var padR = narrow ? 12 : 24;
    var padT = narrow ? 34 : 46;   // 画布被压扁成 2.5:1，上下留白相应收紧，把高度让给曲线本身
    var padB = narrow ? 40 : 42;

    var plotL = padL;
    var plotR = W - padR;
    var plotT = padT;
    var plotB = H - padB;

    var sx = UI.makeScale(xLo, xHi, plotL, plotR);
    var sy = UI.makeScale(0, yMax, plotB, plotT);

    ctx.fillStyle = P.paper;
    ctx.fillRect(plotL, plotT, plotR - plotL, plotB - plotT);

    // ---------- 四种结果的面积 ----------
    // N 分布（中心 0）：左侧 = 正确拒斥，右侧 = 虚报
    UI.gaussArea(ctx, sx, sy, 0, 1, xLo, cAbs, xLo, xHi, UI.RESULT_COLORS.cr.fill);
    UI.gaussArea(ctx, sx, sy, 0, 1, cAbs, xHi, xLo, xHi, UI.RESULT_COLORS.fa.fill);

    // SN 分布（中心 d）：左侧 = 漏报，右侧 = 击中
    UI.gaussArea(ctx, sx, sy, d, 1, xLo, cAbs, xLo, xHi, UI.RESULT_COLORS.miss.fill);
    UI.gaussArea(ctx, sx, sy, d, 1, cAbs, xHi, xLo, xHi, UI.RESULT_COLORS.hit.fill);

    // ---------- 曲线轮廓 ----------
    ctx.strokeStyle = P.ink400;
    ctx.lineWidth = 2.2;
    UI.gaussPath(ctx, sx, sy, 0, 1, xLo, xHi);
    ctx.stroke();

    ctx.strokeStyle = P.brand600;
    ctx.lineWidth = 2.6;
    UI.gaussPath(ctx, sx, sy, d, 1, xLo, xHi);
    ctx.stroke();

    // ---------- 坐标轴 ----------
    var ticks = [];
    for (var v = Math.ceil(xLo); v <= Math.floor(xHi); v++) {
      ticks.push({ v: v, label: String(v) });
    }
    UI.drawAxes(ctx, sx, sy, {
      left: plotL, right: plotR, top: plotT, bottom: plotB,
      xTicks: ticks,
      xLabel: '内部感觉量 x（以 N 分布中心为原点）',
      yLabel: '概率密度'
    });

    // ---------- d' 的双向箭头 ----------
    var yArrow = sy(0.30);
    var x0 = sx(0);
    var x1 = sx(d);
    if (x1 - x0 > 26) {
      ctx.save();
      ctx.strokeStyle = P.brand700;
      ctx.fillStyle = P.brand700;
      ctx.lineWidth = 1.7;

      ctx.beginPath();
      ctx.moveTo(x0, yArrow);
      ctx.lineTo(x1, yArrow);
      ctx.stroke();

      [[x0, 1], [x1, -1]].forEach(function (p) {
        var dir = p[1];
        ctx.beginPath();
        ctx.moveTo(p[0], yArrow);
        ctx.lineTo(p[0] + dir * 8, yArrow - 4.5);
        ctx.lineTo(p[0] + dir * 8, yArrow + 4.5);
        ctx.closePath();
        ctx.fill();
      });

      // 端点竖线
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.5;
      [x0, x1].forEach(function (px) {
        ctx.beginPath();
        ctx.moveTo(px, sy(0));
        ctx.lineTo(px, plotT + 8);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.restore();

      // 窄屏给 d′ 数值加白色底衬：箭头的正上方正是判据竖线所在，
      // 橙色线会穿过文字；有底衬就不会"人字打架"。
      UI.curveLabel(ctx, "d′ = " + SDT.fmt(d, 2), (x0 + x1) / 2, yArrow - (narrow ? 14 : 13),
        P.brand700, {
          align: 'center', pill: narrow,
          font: (narrow ? '700 11px ' : '700 12.5px ') + UI.FONT_MONO
        });
    }

    // ---------- 分布中心竖线与标签 ----------
    [[0, P.ink400, 'N'], [d, P.brand600, 'SN']].forEach(function (m) {
      var mu = m[0];
      var px = sx(mu);
      var peakY = sy(1 / Math.sqrt(2 * Math.PI));

      ctx.save();
      ctx.strokeStyle = m[1];
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, peakY);
      ctx.lineTo(px, sy(0));
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(px, peakY, 4, 0, Math.PI * 2);
      ctx.fillStyle = m[1];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 窄屏两个峰值挨得近（d 小时只差几十像素），标签要向各自外侧让开，
      // 否则「N μ=0.00」和「SN μ=1.50」会叠在一起。
      // 窄屏只留分布名：μ 的差就是 d′，而 d′ 已经标在下面的双向箭头上，
      // 换成短标签后顶部这一条带子就彻底清爽了。
      var label = narrow ? m[2] : (m[2] + '  μ=' + SDT.fmt(mu, 2));
      var away = sx(d) - sx(0) < 68;
      var align = (narrow && away) ? (mu < d / 2 ? 'right' : 'left') : 'center';
      var dx = (narrow && away) ? (mu < d / 2 ? -7 : 7) : 0;

      UI.curveLabel(ctx, label, px + dx, peakY - (narrow ? 13 : 16), m[1], {
        align: align, pill: false,
        font: (narrow ? '700 10.5px ' : '700 12.5px ') + UI.FONT_MONO
      });
    });

    // ---------- 判断标准竖线（可拖拽把手） ----------
    var cpx = sx(cAbs);
    ctx.save();
    ctx.strokeStyle = P.accent600;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(cpx, plotT + 4);
    ctx.lineTo(cpx, sy(0));
    ctx.stroke();
    ctx.restore();

    // 拖拽把手
    ctx.beginPath();
    ctx.arc(cpx, plotT + 14, 9, 0, Math.PI * 2);
    ctx.fillStyle = P.accent500;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    // 抓手纹
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1.4;
    [-3, 0, 3].forEach(function (dy) {
      ctx.beginPath();
      ctx.moveTo(cpx - 3.5, plotT + 14 + dy);
      ctx.lineTo(cpx + 3.5, plotT + 14 + dy);
      ctx.stroke();
    });

    // 窄屏把 C 的数值标签从图顶挪到判据线底部（基线附近）：
    // 图顶那一条带子要同时放 N / SN 峰值点，三个东西挤在一处必然互相压字。
    // 底部有白色底衬，压在填充色上也看得清。
    UI.curveLabel(ctx, 'C = ' + SDT.fmt(state.c, 2), cpx,
      narrow ? sy(0) - 13 : plotT + 34, P.accent700, {
        align: 'center', pill: narrow,
        font: (narrow ? '700 11px ' : '700 12.5px ') + UI.FONT_MONO
      });

    // ---------- 概率数值直接标注在轴上 ----------
    var m = SDT.fromParams(d, state.c);

    if (narrow) {
      // 窄屏四块面积太窄，塞不下四个 P(...) 标签（会互相压字）。
      // 这四个数在下方「实时数值」里已经是独立瓦片，图上不再重复；
      // 图形本身仍用同一套结果配色，颜色与数值一一对应。
      drawNarrowLegend(ctx, plotR, P);
      return { sx: sx, plotL: plotL, plotR: plotR, plotT: plotT, plotB: plotB, xLo: xLo, xHi: xHi };
    }

    // 虚报区标注
    var faX = sx(cAbs + 0.55);
    UI.curveLabel(ctx, 'P(FA)=' + SDT.fmt(m.fa, 3), faX, sy(0.075), P.fa700,
      { align: 'center', font: '600 11.5px ' + UI.FONT_MONO });

    // 击中区标注（放在 SN 分布右侧）
    var hitX = sx(Math.max(cAbs + 0.6, d + 0.6));
    UI.curveLabel(ctx, 'P(Hit)=' + SDT.fmt(m.hit, 3), hitX, sy(0.165), P.hit700,
      { align: 'center', font: '600 11.5px ' + UI.FONT_MONO });

    // 正确拒斥标注
    var crX = sx(0 - 1.35);
    UI.curveLabel(ctx, 'P(CR)=' + SDT.fmt(m.cr, 3), crX, sy(0.075), P.cr700,
      { align: 'center', font: '600 11.5px ' + UI.FONT_MONO });

    // 漏报标注
    var missX = sx(Math.min(cAbs - 0.6, d - 0.7));
    UI.curveLabel(ctx, 'P(Miss)=' + SDT.fmt(m.miss, 3), missX, sy(0.165), P.miss700,
      { align: 'center', font: '600 11.5px ' + UI.FONT_MONO });

    // ---------- 右上角图例 ----------
    UI.drawLegend(ctx, [
      { color: P.ink500, line: true, label: 'N 分布（纯噪音）' },
      { color: P.brand600, line: true, label: 'SN 分布（噪音 + 信号）' },
      { color: P.accent600, line: true, label: '判断标准 C（可拖动）' },
      { color: UI.RESULT_COLORS.hit.stroke, label: '击中' },
      { color: UI.RESULT_COLORS.fa.stroke, label: '虚报' },
      { color: UI.RESULT_COLORS.miss.stroke, label: '漏报' },
      { color: UI.RESULT_COLORS.cr.stroke, label: '正确拒斥' }
    ], plotR - 8, 10, { font: '11.5px ' + UI.FONT_UI, lineH: 16, gap: 9 });

    return { sx: sx, plotL: plotL, plotR: plotR, plotT: plotT, plotB: plotB, xLo: xLo, xHi: xHi };
  }

  /* ======================================================================
   * 指标面板
   * ==================================================================== */
  /** 把一段算式包成行内公式（统一衬线体 + 不折行），中文标签留在外面 */
  function IN(html) {
    return '<span class="formula-inline">' + html + '</span>';
  }

  function renderMetrics() {
    var m = SDT.fromParams(state.d, state.c);
    var box = els.metrics;
    if (!box) { return; }
    UI.clear(box);

    /* sub 走 HTML：除法用 UI.frac() 写成真分数，指数用 <sup>。
       小字号环境统一加 frac--xs，免得把瓦片撑高。 */
    var tiles = [
      { k: '击中率 P(Hit)', v: SDT.fmt(m.hit, 4), sub: '信号出现时报"有"', cls: 'hit' },
      { k: '虚报率 P(FA)', v: SDT.fmt(m.fa, 4), sub: '仅噪音时报"有"', cls: 'fa' },
      { k: '漏报率 P(Miss)', v: SDT.fmt(m.miss, 4), sub: '= 1 − ' + IN('P(Hit)'), cls: 'miss' },
      { k: '正确拒斥 P(CR)', v: SDT.fmt(m.cr, 4), sub: '= 1 − ' + IN('P(FA)'), cls: 'cr' },

      { k: '辨别力 d′', v: SDT.fmt(m.d, 3), sub: IN('<i>Z</i>(Hit) − <i>Z</i>(FA)') + '，感受性', cls: 'primary' },
      { k: '判断标准 C', v: (m.c > 0 ? '+' : '') + SDT.fmt(m.c, 3), sub: 'Z 轴刻度，0 = 无偏', cls: 'accent' },
      { k: '似然比 β', v: SDT.fmt(m.beta, 3),
        sub: IN(UI.frac('<i>O</i>(SN)', '<i>O</i>(N)', 'xs')
               + ' = <i>e</i><sup><i>d</i>′·<i>C</i></sup>'), cls: 'accent' },
      { k: 'Z(Hit) / Z(FA)', v: SDT.fmt(m.zHit, 3) + ' / ' + SDT.fmt(m.zFa, 3), sub: '两分布上的 Z 分数', cls: '' },

      { k: '曲线下面积 AUC', v: SDT.fmt(m.auc, 4),
        sub: '等方差下 = ' + IN('Φ' + UI.frac('<i>d</i>′', '√2', 'xs')), cls: 'primary' },
      { k: '百分正确率', v: (m.accuracy * 100).toFixed(1) + '%',
        sub: '= ' + IN(UI.frac('<i>P</i>(Hit) + <i>P</i>(CR)', '2', 'xs')), cls: '' },
      { k: '最佳正确率上限', v: (SDT.normCdf(state.d / 2) * 100).toFixed(1) + '%', sub: 'C = 0 时的最高值', cls: '' },
      { k: '最优标准 β_opt', v: SDT.fmt(SDT.optimalBeta(0.5, { hit: 1, miss: -1, fa: -1, cr: 1 }), 3), sub: '等先验对称支付下 = 1', cls: '' }
    ];

    tiles.forEach(function (t) {
      var cls = 'metric-tile';
      if (t.cls === 'primary') { cls += ' metric-tile--accent'; }
      else if (t.cls === 'accent') { cls += ' metric-tile--accent'; }
      else if (t.cls) { cls += ' metric-tile--' + t.cls; }
      box.appendChild(UI.el('div', { class: cls }, [
        UI.el('span', { class: 'metric-tile__k', text: t.k }),
        UI.el('span', { class: 'metric-tile__v', text: t.v }),
        UI.el('span', { class: 'metric-tile__sub', html: t.sub })
      ]));
    });

    if (els.dOut) { els.dOut.textContent = SDT.fmt(state.d, 2); }
    if (els.cOut) { els.cOut.textContent = (state.c > 0 ? '+' : '') + SDT.fmt(state.c, 2); }
  }

  /* ======================================================================
   * ROC 画布
   * ==================================================================== */
  function drawROCCanvas() {
    if (!els.rocCanvas || !els.rocCanvas.getBoundingClientRect().width) { return; }
    UI.drawROC({
      canvas: els.rocCanvas,
      d: state.d,
      c: state.c,
      showFamily: state.showFamily,
      zSpace: state.zSpace
    });
  }

  /* ======================================================================
   * 统一刷新
   * ==================================================================== */
  function renderAll() {
    var g = drawDistributionCanvas();
    if (g) { geom = g; }          // 视图未显示时量不到宽度，此时保留上一次的几何
    renderMetrics();
    drawROCCanvas();
    syncControls();
  }

  function syncControls() {
    if (els.dRange && els.dRange.value !== String(state.d)) {
      els.dRange.value = String(state.d);
    }
    if (els.cRange && els.cRange.value !== String(state.c)) {
      els.cRange.value = String(state.c);
    }
  }

  /* ======================================================================
   * 画布拖拽：直接拖动 C 竖线
   * ==================================================================== */
  function bindDrag() {
    var canvas = els.distCanvas;
    if (!canvas) { return; }
    var dragging = false;
    var startX = 0;
    var moved = false;

    // 触屏没有 hover、手指也比鼠标粗：命中范围放宽到 40px，
    // 并且允许在绘图区任意位置起手（手机上很难精准点到那条细线上）。
    function isCoarse() {
      return !!(global.matchMedia
        && global.matchMedia('(hover: none) and (pointer: coarse)').matches);
    }
    function hitTol() { return isCoarse() ? 40 : 26; }

    function toC(clientX) {
      if (!geom) { return state.c; }
      var rect = canvas.getBoundingClientRect();
      var cssX = clientX - rect.left;
      // 反推逻辑坐标：x 轴像素 → 逻辑
      var ratio = (cssX - geom.plotL) / (geom.plotR - geom.plotL);
      var xAbs = geom.xLo + ratio * (geom.xHi - geom.xLo);
      // 绝对位置 → Z 轴刻度 C
      return xAbs - state.d / 2;
    }

    function apply(clientX) {
      var c = toC(clientX);
      c = Math.max(-2.5, Math.min(2.5, c));
      state.c = Math.round(c * 100) / 100;
      renderAll();
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (!geom) { return; }
      var rect = canvas.getBoundingClientRect();
      var cssX = e.clientX - rect.left;
      var cssY = e.clientY - rect.top;
      var cpx = (function () {
        var ratio = (state.c + state.d / 2 - geom.xLo) / (geom.xHi - geom.xLo);
        return geom.plotL + ratio * (geom.plotR - geom.plotL);
      }());
      // 命中判定：鼠标要靠近竖线；触屏则是绘图区内任意位置都能起手
      var inPlot = cssY > geom.plotT && cssY < geom.plotB;
      var near = Math.abs(cssX - cpx) < hitTol() && inPlot;
      if (near || (isCoarse() && inPlot)) {
        dragging = true;
        startX = e.clientX;
        moved = false;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!geom) { return; }
      if (dragging) {
        // 触屏上"竖向滑屏"也会先派发一两个 pointermove，
        // 因此要越过 6px 阈值才认定是在拖判据，避免滑屏时误改标准。
        if (isCoarse()) {
          if (Math.abs(e.clientX - startX) < 6 && !moved) { return; }
          moved = true;
        }
        apply(e.clientX);
        return;
      }
      // 悬停反馈（只有鼠标环境有意义）
      var rect = canvas.getBoundingClientRect();
      var cssX = e.clientX - rect.left;
      var cssY = e.clientY - rect.top;
      var ratio = (state.c + state.d / 2 - geom.xLo) / (geom.xHi - geom.xLo);
      var cpx = geom.plotL + ratio * (geom.plotR - geom.plotL);
      var near = Math.abs(cssX - cpx) < hitTol() && cssY > geom.plotT && cssY < geom.plotB;
      canvas.style.cursor = near ? 'grab' : 'default';
    });

    function end(e) {
      // 触屏上"轻点一下"是主要的移动方式（没有双击键盘），落点即新标准
      if (dragging && !moved && isCoarse() && e && e.type === 'pointerup') {
        apply(e.clientX);
      }
      if (!dragging) { return; }
      dragging = false;
      canvas.style.cursor = 'default';
      if (e && e.pointerId !== undefined) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', function (e) {
      if (!dragging) { canvas.style.cursor = 'default'; }
      end(e);
    });

    // 点击绘图区任意位置，直接把标准移过去
    canvas.addEventListener('dblclick', function (e) {
      if (!geom) { return; }
      var rect = canvas.getBoundingClientRect();
      var cssY = e.clientY - rect.top;
      if (cssY > geom.plotT && cssY < geom.plotB) { apply(e.clientX); }
    });
  }

  /* ======================================================================
   * 初始化
   * ==================================================================== */
  function init() {
    els.distCanvas = document.getElementById('dist-canvas');
    els.rocCanvas = document.getElementById('roc-canvas');
    els.dRange = document.getElementById('d-range');
    els.cRange = document.getElementById('c-range');
    els.dOut = document.getElementById('d-out');
    els.cOut = document.getElementById('c-out');
    els.metrics = document.getElementById('theory-metrics');
    els.showFamily = document.getElementById('roc-show-family');
    els.zSpace = document.getElementById('roc-zspace');

    if (!els.distCanvas) { return; }

    // 滑块
    if (els.dRange) {
      els.dRange.addEventListener('input', function () {
        state.d = parseFloat(els.dRange.value);
        renderAll();
      });
    }
    if (els.cRange) {
      els.cRange.addEventListener('input', function () {
        state.c = parseFloat(els.cRange.value);
        renderAll();
      });
    }

    // 快捷标准按钮
    Array.prototype.forEach.call(document.querySelectorAll('.quick-c .pill'), function (btn) {
      btn.addEventListener('click', function () {
        state.c = parseFloat(btn.getAttribute('data-c'));
        renderAll();
      });
    });

    // ROC 开关
    if (els.showFamily) {
      els.showFamily.addEventListener('change', function () {
        state.showFamily = els.showFamily.checked;
        drawROCCanvas();
      });
    }
    if (els.zSpace) {
      els.zSpace.addEventListener('change', function () {
        state.zSpace = els.zSpace.checked;
        drawROCCanvas();
      });
    }

    // 键盘微调（左右方向键调整 C）
    document.addEventListener('keydown', function (e) {
      if (document.getElementById('view-theory').classList.contains('is-active')
        && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        if (e.key === 'ArrowLeft') {
          state.c = Math.max(-2.5, Math.round((state.c - 0.05) * 100) / 100);
          renderAll(); e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          state.c = Math.min(2.5, Math.round((state.c + 0.05) * 100) / 100);
          renderAll(); e.preventDefault();
        }
      }
    });

    // 首次绘制（画布几何信息存到模块级 geom，供拖拽命中判定复用）
    renderAll();
    bindDrag();

    var resizeTimer = null;
    global.addEventListener('resize', function () {
      if (resizeTimer) { clearTimeout(resizeTimer); }
      resizeTimer = setTimeout(function () {
        if (document.getElementById('view-theory').classList.contains('is-active')) {
          renderAll();
        }
      }, 140);
    });
  }

  global.TheoryDemo = {
    init: init,
    renderAll: renderAll,
    state: state
  };
}(typeof window !== 'undefined' ? window : globalThis));
