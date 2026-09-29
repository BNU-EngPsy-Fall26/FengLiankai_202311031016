/*!
 * module-legal.js —— 场景二：法律证据判断（庭审中的"有罪 / 无罪"）
 * ---------------------------------------------------------------------------
 * 场景设定（依据课程 PPT「SDT 和法律判决」一节）：
 *   你是法庭上的裁判者。检方提交了一组证据（指纹、监控、证人证词等），
 *   你需要判断：这些证据是否足以认定被告有罪？
 *
 *   把"被告确实有罪"当作信号（SN），"被告实际无罪"当作噪音（N）。
 *   证据的证明力就是内部感觉量 x。
 *
 * PPT 明确指出两个影响判断标准的因素：
 *   ① 先定概率：犯罪率 / 起诉标准越高，越倾向作有罪判断（标准降低）
 *   ② 奖惩办法：若"正确惩罚犯罪"的收益大于"冤枉无辜"的代价，
 *      裁判者会降低标准、追求击中、提高虚报率——意味着更多无辜者被冤枉。
 *
 *   而辨别力 d′ 取决于法律素养与经验；提高 d′ 才能同时减少冤判与放纵。
 *
 * 视觉：一份证据卷宗卡片，逐项列出证据条目，每条带强度条与可信度。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var UI = global.UI;

  var CONFIG = {
    id: 'legal',
    name: '法律证据判断',
    tag: 'Legal Evidence',
    icon: 'legal',
    accent: '#9a5b09',
    accentSoft: '#fdf1d8',
    accentDeep: '#7a4b06',

    desc: '检方提交一份证据卷宗。被告确实有罪时，证据链通常更完整、指向更一致；'
      + '但无罪的人也可能因巧合留下疑点。你要判断：证据是否足以认定有罪？',

    signalMeaning: '被告确实有罪',
    noiseMeaning: '被告实际无罪（巧合形成疑点）',

    payoff: { hit: 10, miss: -30, fa: -22, cr: 6 },
    payoffNote: '本场景把"冤枉无辜"的代价设得较高。若你更看重打击犯罪，可自行调低虚报惩罚。',

    prompt: '这份卷宗：证据是否足以认定被告有罪？',
    yesLabel: '认定有罪',
    noLabel: '证据不足',

    // 开局前与整局中常驻的"判读标准"
    guide: {
      title: '判读标准 · 怎么读这份卷宗',
      rows: [
        {
          swatch: '#e0a52c',
          key: '单条强度条',
          text: '每条证据右侧的黄条＝这条证据本身有多强（百分比越大越硬）。'
        },
        {
          swatch: '#c0392b',
          key: '「存疑」标记',
          text: '该条证据自身有出入或需要复核，可信度要打折。'
        }
      ],
      note: '这里没有"确凿"的证据，两条线索一起看：<strong>条目多少</strong>（证据链是否完整、'
        + '有几条互相印证）+ <strong>底部「证据链指向一致性」</strong>（这些证据是否指向同一个人、'
        + '同一套说法）。有罪时通常条目更多、强度更高、一致性也更高；'
        + '无罪的人也可能因巧合留下两三条疑点，但强度低、彼此对不上、常带「存疑」。',
      bullets: [
        '按「认定有罪」＝证据已足以定罪；按「证据不足」＝疑点不足以定罪。',
        '本场景把<strong>冤枉无辜</strong>的代价设得很高（虚报 −22），标准应偏审慎。'
      ]
    },

    timing: { reveal: 900, feedback: 700 }
  };

  var EVIDENCE_POOL = [
    { name: '现场指纹比对', detail: '鉴定报告 · 三级特征点' },
    { name: '监控录像片段', detail: '时间戳连续 · 分辨率一般' },
    { name: '目击者证词', detail: '两名证人 · 陈述基本一致' },
    { name: '通讯记录', detail: '基站定位 · 时间窗重合' },
    { name: '物证残留', detail: '微量纤维 · 需进一步复核' },
    { name: '被告供述', detail: '有罪供述 · 细节存在出入' },
    { name: '资金往来记录', detail: '转账时间与案发接近' },
    { name: '现场足迹', detail: '鞋印尺码与被告相符' }
  ];

  /**
   * 把证据证明力映射为"卷宗外观"。
   * 关键：条目数量、强度分布、指向一致性都随 evidence 变化，
   * 但不出现任何能直接读出答案的标记。
   */
  function evidenceToVisual(evidence, rng) {
    // 条目数量：2 ~ 6 条
    var n = Math.round(2 + clamp((evidence + 2.2) / 5, 0, 1) * 4);
    n = Math.max(2, Math.min(6, n));

    // 证据条目：优先从池中抽取，顺序随机
    var pool = EVIDENCE_POOL.slice();
    var items = [];
    for (var i = 0; i < n; i++) {
      var k = Math.floor(rng() * pool.length);
      var src = pool.splice(k, 1)[0];
      // 单条强度：围绕整体 evidence 波动
      var strength = clamp(0.5 + (evidence / 4) * 0.42 + (rng() - 0.5) * 0.42, 0.06, 1);
      items.push({
        name: src.name,
        detail: src.detail,
        strength: strength,
        // 疑似矛盾点：evidence 低时更容易出现"存疑"标记
        flagged: rng() < (0.6 - evidence * 0.12)
      });
    }

    // 结论摘要
    var consistency = clamp(0.5 + evidence * 0.14 + (rng() - 0.5) * 0.2, 0.05, 1);

    return {
      items: items,
      consistency: consistency,
      caseNo: 'CASE-' + String(Math.floor(rng() * 9000) + 1000),
      // 卷宗纸面上的轻微随机纹理，避免每张完全一样
      stampAngle: (rng() - 0.5) * 0.22
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------------------------------------------
   * 绘制证据卷宗
   * ---------------------------------------------------------------- */
  function render(canvas, trial, phase) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;
    var P = UI.PALETTE;

    // 桌面底色
    ctx.fillStyle = '#efe7d8';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(154,91,9,.045)';
    for (var g = 0; g < 40; g++) {
      ctx.fillRect(0, g * 9, W, 1);
    }

    var v = trial.visual;
    var padX = Math.max(22, W * 0.06);
    var cardX = padX;
    var cardW = W - padX * 2;
    var cardY = 20;
    var cardH = H - 40;

    // 卷宗纸张
    ctx.save();
    ctx.shadowColor = 'rgba(90,70,35,.22)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#fffdf7';
    UI.roundRect(ctx, cardX, cardY, cardW, cardH, 6);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#d9cdb4';
    ctx.lineWidth = 1;
    UI.roundRect(ctx, cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, 6);
    ctx.stroke();

    // 头部
    var hdY = cardY + 16;
    ctx.fillStyle = P.accent700;
    ctx.font = '700 12px ' + UI.FONT_MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('EVIDENCE DOSSIER', cardX + 18, hdY);

    ctx.fillStyle = P.ink400;
    ctx.font = '11px ' + UI.FONT_MONO;
    ctx.textAlign = 'right';
    ctx.fillText(v.caseNo, cardX + cardW - 18, hdY);

    // 分隔线（双线，公文感）
    var lineY = hdY + 20;
    ctx.strokeStyle = P.ink700;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cardX + 18, lineY); ctx.lineTo(cardX + cardW - 18, lineY);
    ctx.stroke();
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 18, lineY + 2.5); ctx.lineTo(cardX + cardW - 18, lineY + 2.5);
    ctx.stroke();

    // 证据条目
    var listTop = lineY + 14;
    var rowH = Math.min(31, (cardH - (listTop - cardY) - 66) / Math.max(1, v.items.length));
    var barX = cardX + 18;
    var barW = Math.min(96, cardW * 0.24);

    v.items.forEach(function (it, i) {
      var y = listTop + i * rowH;

      // 序号
      ctx.fillStyle = P.ink300;
      ctx.font = '10.5px ' + UI.FONT_MONO;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1).padStart(2, '0'), barX, y + rowH / 2 - 3);

      // 名称
      ctx.fillStyle = P.ink900;
      ctx.font = '600 12.5px ' + UI.FONT_UI;
      ctx.fillText(it.name, barX + 22, y + rowH / 2 - 7);

      // 说明
      ctx.fillStyle = P.ink400;
      ctx.font = '10.5px ' + UI.FONT_UI;
      ctx.fillText(it.detail, barX + 22, y + rowH / 2 + 7);

      // 强度条
      var sbX = barX + cardW - barW - 74;
      var sbY = y + rowH / 2 - 4;
      var sbW = barW;
      var sbH = 7;

      ctx.fillStyle = P.ink100;
      UI.roundRect(ctx, sbX, sbY, sbW, sbH, 3.5);
      ctx.fill();

      var grd = ctx.createLinearGradient(sbX, 0, sbX + sbW, 0);
      grd.addColorStop(0, '#e0a52c');
      grd.addColorStop(1, '#b5760f');
      ctx.fillStyle = grd;
      UI.roundRect(ctx, sbX, sbY, Math.max(3, sbW * it.strength), sbH, 3.5);
      ctx.fill();

      // 强度数值
      ctx.fillStyle = P.accent700;
      ctx.font = '600 11px ' + UI.FONT_MONO;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText((it.strength * 100).toFixed(0) + '%', sbX + sbW + 34, y + rowH / 2);

      // 存疑标记
      if (it.flagged) {
        ctx.fillStyle = '#c0392b';
        ctx.font = '600 10px ' + UI.FONT_UI;
        ctx.textAlign = 'left';
        ctx.fillText('存疑', sbX + sbW + 40, y + rowH / 2);
      }

      // 行分隔
      if (i < v.items.length - 1) {
        ctx.strokeStyle = 'rgba(200,190,168,.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barX, y + rowH - 1.5);
        ctx.lineTo(cardX + cardW - 18, y + rowH - 1.5);
        ctx.stroke();
      }
    });

    // 底部：指向一致性
    var footY = cardY + cardH - 46;
    ctx.strokeStyle = P.ink700;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cardX + 18, footY); ctx.lineTo(cardX + cardW - 18, footY);
    ctx.stroke();

    ctx.fillStyle = P.ink500;
    ctx.font = '11.5px ' + UI.FONT_UI;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('证据链指向一致性', cardX + 18, footY + 18);

    var cbX = cardX + 18 + 132;
    var cbW = cardW - 18 - 132 - 18 - 52;
    ctx.fillStyle = P.ink100;
    UI.roundRect(ctx, cbX, footY + 13, cbW, 9, 4.5);
    ctx.fill();
    ctx.fillStyle = P.accent600;
    UI.roundRect(ctx, cbX, footY + 13, Math.max(4, cbW * v.consistency), 9, 4.5);
    ctx.fill();

    ctx.fillStyle = P.accent700;
    ctx.font = '700 12px ' + UI.FONT_MONO;
    ctx.textAlign = 'right';
    ctx.fillText((v.consistency * 100).toFixed(0) + '%', cardX + cardW - 18, footY + 18);

    // 印章
    ctx.save();
    ctx.translate(cardX + cardW - 78, cardY + cardH - 92);
    ctx.rotate(v.stampAngle);
    ctx.strokeStyle = 'rgba(192,57,43,.34)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(192,57,43,.34)';
    ctx.font = '700 9.5px ' + UI.FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('证据卷宗', 0, -5);
    ctx.fillText('已受理', 0, 7);
    ctx.restore();

    return { cardX: cardX, cardY: cardY, cardW: cardW, cardH: cardH };
  }

  function renderFeedbackOverlay(canvas, trial, resultKind) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var rc = UI.RESULT_COLORS[resultKind];

    ctx.fillStyle = 'rgba(255,253,247,.9)';
    ctx.fillRect(0, 0, W, 36);

    ctx.fillStyle = rc.stroke;
    ctx.font = '600 13px ' + UI.FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      resultKind === 'hit' ? '击中：被告确实有罪，你作出了有罪认定'
        : resultKind === 'miss' ? '漏报：被告确实有罪，你却因证据不足放过了'
          : resultKind === 'fa' ? '虚报：被告实际无罪，你冤枉了他'
            : '正确拒斥：被告实际无罪，你也未认定有罪',
      W / 2, 19
    );
  }

  function renderExample(canvas) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;

    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#d9cdb4';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    var rows = [
      { label: '有罪 · 证据链完整', n: 5, base: 0.82, y: H * 0.26 },
      { label: '无罪 · 巧合形成疑点', n: 2, base: 0.24, y: H * 0.72 }
    ];

    rows.forEach(function (r) {
      ctx.fillStyle = '#9a5b09';
      ctx.font = '600 11px ' + UI.FONT_UI;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.label, 12, r.y - 26);

      for (var i = 0; i < 5; i++) {
        var on = i < r.n;
        var s = on ? r.base * (0.8 + (i % 3) * 0.1) : 0.14;
        var bw = (W - 30) * 0.36;

        ctx.fillStyle = '#e4e9ee';
        ctx.fillRect(14 + i * (bw + 10), r.y - 5, bw, 10);

        if (on) {
          var grd = ctx.createLinearGradient(14 + i * (bw + 10), 0, 14 + i * (bw + 10) + bw, 0);
          grd.addColorStop(0, '#e0a52c');
          grd.addColorStop(1, '#b5760f');
          ctx.fillStyle = grd;
        } else {
          ctx.fillStyle = '#c8d0d8';
        }
        ctx.fillRect(14 + i * (bw + 10), r.y - 5, Math.max(4, bw * s), 10);
      }
    });
  }

  global.SceneLegal = {
    config: CONFIG,
    evidenceToVisual: evidenceToVisual,
    render: render,
    renderFeedbackOverlay: renderFeedbackOverlay,
    renderExample: renderExample
  };
}(typeof window !== 'undefined' ? window : globalThis));
