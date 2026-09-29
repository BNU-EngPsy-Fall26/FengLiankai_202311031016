/*!
 * module-industrial.js —— 场景三：工业探伤（焊缝缺陷检测）
 * ---------------------------------------------------------------------------
 * 场景设定：
 *   你是工厂质检线上的超声探伤员。探头扫过焊缝时，回波波形上会出现一个
 *   特征信号。它可能是真实的内部缺陷（气孔、夹渣、未熔合），
 *   也可能只是晶粒噪声、表面粗糙或耦合不良造成的伪信号。
 *
 *   把"存在真实缺陷"当作信号（SN），"无缺陷"当作噪音（N）。
 *   波形幅值就是内部感觉量 x。
 *
 * 代价结构（工业场景特有的不对称）：
 *   漏报缺陷 → 缺陷件出厂 → 可能引发断裂事故，赔偿极高
 *   虚报 → 好件被误判报废 → 损失一个工件与工时
 *   ⇒ 与雷达类似，标准应偏松；但典型工程实践会用两道检验来压低虚报。
 *
 *   这里额外体现一个工程现实：判废需要"复核"，
 *   所以虚报的代价并非完全可忽略 —— 请自行权衡。
 *
 * 视觉：A 型显示（A-scan）波形图，缺陷回波表现为特征位置的波峰。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var UI = global.UI;

  var CONFIG = {
    id: 'industrial',
    name: '工业探伤',
    tag: 'Weld Inspection',
    icon: 'industrial',
    accent: '#1a7f4f',
    accentSoft: '#dcf1e4',
    accentDeep: '#0f5132',

    desc: '超声探头扫过焊缝，波形上出现一个回波。它可能是真实内部缺陷，'
      + '也可能只是晶粒噪声或耦合不良。你要判断：这个波形是否表明存在缺陷？',

    signalMeaning: '焊缝内部存在真实缺陷',
    noiseMeaning: '无缺陷（晶粒噪声 / 表面粗糙 / 耦合不良）',

    payoff: { hit: 14, miss: -38, fa: -14, cr: 5 },
    payoffNote: '漏报缺陷可能造成断裂事故，代价远高于误判报废一个工件。',

    prompt: '这段波形：是否存在真实缺陷回波？',
    yesLabel: '判定有缺陷',
    noLabel: '判定合格',

    // 开局前与整局中常驻的"判读标准"
    guide: {
      title: '判读标准 · 怎么读这段 A 型波形',
      rows: [
        {
          swatch: '#4fd694',
          key: '① 起始脉冲',
          text: '最左边那道高而窄的波——探头自己发出的发射脉冲，每一段都有，不是缺陷。'
        },
        {
          swatch: '#4fd694',
          key: '② 底面回波',
          text: '最右边那道（约 90mm 处）——声波打到工件底面反射回来，也是每段都有。'
        },
        {
          swatch: '#f2c14e',
          key: '③ 闸门 GATE',
          text: '中间橙色的虚线框：只有落在闸门里的回波才算数，框外的噪声不计。'
        },
        {
          swatch: '#4fd694',
          key: '④ 闸门内的波峰',
          text: '这正是不确定的地方——它可能是真实缺陷，也可能只是噪声偶然堆出来的峰。'
        }
      ],
      note: '判断闸门内那个波峰的高度：<strong>缺陷回波通常又高又窄、棱角清楚</strong>；'
        + '晶粒噪声、耦合不良形成的假峰则矮而毛糙，高度和普通噪声差不多。'
        + '注意强度是连续的，没有"合格线"这种硬标准，得自己权衡。',
      bullets: [
        '按「判定有缺陷」＝认定该波峰是真实缺陷；按「判定合格」＝认定只是噪声。',
        '漏检缺陷可能造成断裂事故（漏报 −38），标准应偏宽松，但误判报废工件也有成本（虚报 −14）。'
      ]
    },

    timing: { scan: 950, feedback: 660 }
  };

  /**
   * 生成 A 型显示波形。
   * 波形 = 起始脉冲 + 底面回波 + 噪声 + （若有信号）缺陷回波
   * evidence 决定缺陷回波的幅值，其余成分与 evidence 无关。
   */
  function evidenceToVisual(evidence, rng) {
    var N = 220;
    var noise = [];
    for (var i = 0; i < N; i++) {
      // 平滑噪声：叠加两个不同频率的分量 + 随机相位
      noise.push(
        0.055 * Math.sin(i * 0.42 + rng() * 0.4)
        + 0.032 * Math.sin(i * 1.13 + rng() * 0.7)
        + (rng() - 0.5) * 0.03
      );
    }

    // 缺陷回波位置：在探头行程中段，随机偏移（不泄露答案）
    var defectPos = 0.46 + (rng() - 0.5) * 0.16;

    // 幅值：evidence 越大越高
    var amp = clamp(0.16 + (evidence + 2.6) / 5.6 * 0.78, 0.1, 0.96);

    // 回波宽度
    var width = 5.2 + rng() * 2.6;

    return {
      noise: noise,
      defectPos: defectPos,
      amp: amp,
      width: width,
      // 探头是否良好耦合（影响整体噪声水平，与答案无关）
      coupling: rng() < 0.72,
      // 底面回波高度（伪随机）
      backwall: 0.52 + rng() * 0.2
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------------------------------------------
   * 绘制 A 型显示
   * ---------------------------------------------------------------- */
  function render(canvas, trial, phase) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;
    var P = UI.PALETTE;

    // 屏幕底色（工业仪器灰）
    ctx.fillStyle = '#0c1512';
    ctx.fillRect(0, 0, W, H);

    var padL = 46;
    var padR = 20;
    var padT = 40;
    var padB = 42;

    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var baseY = padT + plotH * 0.78;

    // 网格
    ctx.strokeStyle = 'rgba(120, 220, 170, .12)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= 10; gx++) {
      var x = padL + plotW * gx / 10;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    }
    for (var gy = 0; gy <= 8; gy++) {
      var y = padT + plotH * gy / 8;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    }

    // 声程刻度
    ctx.fillStyle = 'rgba(150, 240, 190, .55)';
    ctx.font = '10px ' + UI.FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var t = 0; t <= 10; t += 2) {
      ctx.fillText((t * 10) + 'mm', padL + plotW * t / 10, padT + plotH + 7);
    }

    // 增益刻度
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [0, .5, 1].forEach(function (k) {
      ctx.fillText((k * 100).toFixed(0) + '%', padL - 8, baseY - plotH * 0.62 * k);
    });

    var v = trial.visual;
    var noiseLevel = v.coupling ? 1 : 1.7;

    // 组装波形
    function waveAt(t) {  // t ∈ [0,1]
      var idx = t * (v.noise.length - 1);
      var i0 = Math.floor(idx);
      var i1 = Math.min(v.noise.length - 1, i0 + 1);
      var fr = idx - i0;
      var n = v.noise[i0] * (1 - fr) + v.noise[i1] * fr;

      // 起始脉冲
      var start = Math.exp(-Math.pow(t / 0.022, 2)) * 0.72;
      // 底面回波
      var bw = Math.exp(-Math.pow((t - 0.9) / 0.03, 2)) * v.backwall;
      // 缺陷回波
      var dp = Math.exp(-Math.pow((t - v.defectPos) / (v.width / 200), 2)) * v.amp;

      return start + bw + dp + n * noiseLevel;
    }

    // 绘制波形
    var grad = ctx.createLinearGradient(0, padT, 0, baseY);
    grad.addColorStop(0, '#7ef0b4');
    grad.addColorStop(1, '#2fa86c');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var steps = 560;
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var amp = waveAt(t);
      var px = padL + plotW * t;
      var py = baseY - plotH * 0.62 * amp;
      if (s === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
    }
    ctx.stroke();

    // 波形填充（探伤仪常见的实心填充感）
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.lineTo(padL + plotW, baseY);
    ctx.lineTo(padL, baseY);
    ctx.closePath();
    ctx.fillStyle = '#4fd694';
    ctx.fill();
    ctx.restore();

    // 基线
    ctx.strokeStyle = 'rgba(150, 240, 190, .38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(padL, baseY + 0.5);
    ctx.lineTo(padL + plotW, baseY + 0.5);
    ctx.stroke();

    // 扫描门（在"呈现"阶段显示，模拟闸门设置；反馈阶段让位给结论）
    if (phase !== 'feedback') {
      var gateL = padL + plotW * 0.34;
      var gateR = padL + plotW * 0.66;
      ctx.strokeStyle = 'rgba(224, 149, 29, .55)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(gateL, padT + 6); ctx.lineTo(gateL, baseY);
      ctx.moveTo(gateR, padT + 6); ctx.lineTo(gateR, baseY);
      ctx.moveTo(gateL, padT + 6); ctx.lineTo(gateR, padT + 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(224, 149, 29, .8)';
      ctx.font = '10px ' + UI.FONT_MONO;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('GATE', (gateL + gateR) / 2, padT + 10);
    }

    // 仪器信息
    ctx.fillStyle = 'rgba(150, 240, 190, .62)';
    ctx.font = '11px ' + UI.FONT_MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('UT  A-SCAN', 14, 12);

    ctx.textAlign = 'right';
    ctx.fillText('GAIN ' + (v.coupling ? '42.0' : '38.5') + ' dB', W - 14, 12);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(150, 240, 190, .45)';
    ctx.font = '10px ' + UI.FONT_MONO;
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(14, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('回波幅值', 0, 0);
    ctx.restore();

    return { padL: padL, padT: padT, plotW: plotW, baseY: baseY };
  }

  function renderFeedbackOverlay(canvas, trial, resultKind) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;

    ctx.fillStyle = 'rgba(12,21,18,.92)';
    ctx.fillRect(0, 0, W, 36);

    var rc = UI.RESULT_COLORS[resultKind];
    ctx.fillStyle = rc.stroke;
    ctx.font = '600 13px ' + UI.FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      resultKind === 'hit' ? '击中：确实存在缺陷，你判出了缺陷'
        : resultKind === 'miss' ? '漏报：确实存在缺陷，你却判为合格'
          : resultKind === 'fa' ? '虚报：实际无缺陷，你误判为有缺陷'
            : '正确拒斥：实际无缺陷，你也判为合格',
      W / 2, 19
    );
  }

  function renderExample(canvas) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;

    ctx.fillStyle = '#0c1512';
    ctx.fillRect(0, 0, W, H);

    var rows = [
      { label: 'DEFECT · 真实缺陷回波', amp: 0.78, y: H * 0.27, gate: true },
      { label: 'NOISE · 晶粒噪声', amp: 0.16, y: H * 0.73, gate: false }
    ];

    rows.forEach(function (r) {
      var padL = 12;
      var plotW = W - 24;
      var plotH = H * 0.3;
      var baseY = r.y + plotH * 0.3;

      ctx.strokeStyle = 'rgba(120,220,170,.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(padL, r.y - plotH * 0.7, plotW, plotH);

      ctx.strokeStyle = '#3fbf7c';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (var s = 0; s <= 300; s++) {
        var t = s / 300;
        var a = Math.exp(-Math.pow(t / 0.02, 2)) * 0.6
          + Math.exp(-Math.pow((t - 0.92) / 0.03, 2)) * 0.6
          + Math.exp(-Math.pow((t - 0.5) / 0.26, 2)) * r.amp
          + 0.04 * Math.sin(t * 60);
        var px = padL + plotW * t;
        var py = baseY - plotH * 0.8 * a;
        if (s === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();

      ctx.fillStyle = 'rgba(150,240,190,.8)';
      ctx.font = '600 11px ' + UI.FONT_UI;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(r.label, padL + 2, r.y - plotH * 0.68);
    });
  }

  global.SceneIndustrial = {
    config: CONFIG,
    evidenceToVisual: evidenceToVisual,
    render: render,
    renderFeedbackOverlay: renderFeedbackOverlay,
    renderExample: renderExample
  };
}(typeof window !== 'undefined' ? window : globalThis));
