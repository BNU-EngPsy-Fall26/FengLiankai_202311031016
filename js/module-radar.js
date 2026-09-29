/*!
 * module-radar.js —— 场景一：雷达操作员探测来袭目标（SDT 的历史出处）
 * ---------------------------------------------------------------------------
 * 场景设定（来自课程 PPT 的经典引例）：
 *   凌晨值班的雷达操作员在荧光屏上寻找敌方轰炸机的回波。
 *   屏幕上的光点既可能是飞机，也可能只是海鸥、云层杂波或设备噪声。
 *   他必须判断：这一次的回波，是真正的目标，还是背景噪音？
 *
 * 代价结构（这是本案的关键）：
 *   漏报敌机 → 城市被轰炸，代价极高
 *   虚报 → 防空部队白跑一趟，代价相对低
 *   ⇒ 理论上应当把判断标准放得较松（C 偏负），宁可虚报不可漏报。
 *
 * 视觉：P 型显示器（PPI）。每个试次 = 天线完整地转一圈：
 *   ① 光束从某个方位出发，顺时针扫过整个 360°；
 *   ② 光束照到某个方位的瞬间，那里的回波才被"点亮"；
 *   ③ 之后按荧光余辉指数衰减（刚扫过的最亮，早扫过的暗下去）；
 *   ④ 转满一圈后余辉整体熄灭，屏幕回到空白的默认待机界面，此时才让操作员作答。
 *
 * 为什么第 ④ 步必须清空（这一点直接决定实验成不成立）：
 *   如果作答时屏上还留着点迹，被试就成了"看着静态截图判断"，
 *   判断依据变成"我能不能看见这个亮点"，而不是"刚才那次回波有多强"——
 *   余辉残留还会随目标所处方位剧烈变化（刚扫过的亮、一圈前扫过的暗），
 *   引入一个与信号强度完全无关的判断线索，d′ 会被污染。
 *   清空之后，判断只能依据扫描过程中在脑中留下的印象，
 *   这与真实雷达观测的情形一致，也让 d′ 真正衡量"辨别力"。
 *
 *   一圈的真实雷达要 2~10 秒，教学演示压缩到 1.2 秒一圈，
 *   扫完另有 0.3 秒的熄屏过渡；没看清可以按 R 再看一圈。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var UI = global.UI;
  // 捕获加载时的真实定时器：无头测试会把 window.setTimeout 换成假时钟，
  // 动画帧退路若走假时钟会自我排队，所以这里保留原生的那个。
  var NATIVE_SET_TIMEOUT = global.setTimeout;
  var TAU = Math.PI * 2;

  var CONFIG = {
    id: 'radar',
    name: '雷达操作员',
    tag: 'Radar Operator',
    icon: 'radar',
    accent: '#235a91',
    accentSoft: '#dceaf7',
    accentDeep: '#123152',

    desc: '天线转一圈扫完整片空域。光束扫过之处回波才亮起，'
      + '并按荧光余辉慢慢暗下去。转满一圈后余辉熄灭、屏幕回到空白待机状态，'
      + '你得凭这一圈的印象作答 —— 它可能刚才确实是来袭敌机，也可能只是海鸥或杂波。',

    signalMeaning: '真实来袭目标（轰炸机）',
    noiseMeaning: '海鸥 / 云层杂波 / 设备噪声',

    payoff: { hit: 12, miss: -40, fa: -6, cr: 4 },
    payoffNote: '漏报敌机的代价远高于虚报，故理想标准应偏宽松（宁可多报几次）。',

    prompt: '屏幕已回到空白待机状态。凭刚才那一圈的印象判断：是真实目标，还是背景杂波？',
    yesLabel: '确认目标',
    noLabel: '判定杂波',

    // "呈现动画"专属的两句提示。只有本场景有"转一圈 → 熄屏 → 凭印象作答"这套流程，
    // 所以这两句文案跟着场景走，而不是写在 app.js 里当通用文案——
    // 否则法律 / 探伤那两个根本没有熄屏环节的场景也会看到"屏幕已消隐"。
    introBusy: '天线扫描中… 转完一圈会熄屏，回到空白界面再判断（空格可提前熄屏）',
    introReady: '已定格 · 屏幕已消隐，凭刚才这一圈的印象作答',
    introReplayBusy: '天线重新扫描中… 转完一圈会熄屏，回到空白界面再判断',

    // 开局前与整局中常驻的"判读标准"，用大白话把屏幕元素讲清楚
    guide: {
      title: '判读标准 · 怎么读这块荧光屏',
      rows: [
        {
          swatch: '#daffea',
          key: '目标回波',
          text: '亮且实心的光点，带一圈光晕。越亮、光晕越大，说明回波越强。'
        },
        {
          swatch: '#96f0b4',
          key: '杂波',
          text: '暗而弥散的小点，成片出现，没有光晕 —— 这是海鸥、云层或设备噪声。'
        },
        {
          swatch: '#7a7a7a',
          key: '刻度',
          text: '一圈同心圆是距离环，辐条是方位线（外圈 000/090/180/270 为罗盘方位）。'
        }
      ],
      note: '顺序：天线从随机方位起转，扫满一圈 → 余辉整体熄灭、屏幕回到空白 → 这时才判断。'
        + '强度是渐变而非"有/无"：弱信号也可能只是一个暗点，强杂波也可能看着挺亮，所以每一试次都得自己权衡。',
      bullets: [
        '按「确认目标」＝你认为这是真实来袭目标（宁可虚报也尽量别漏报）；',
        '按「判定杂波」＝你认为那只是海鸥 / 杂波。',
        '没看清可以按 R 再看一圈（同一份回波重播，不算作答）。'
      ]
    },

    // 试次间的时间节奏（毫秒）。
    //   sweep —— 天线转满一圈
    //   fade  —— 一圈扫完后的熄屏过渡（余辉整体淡出），结束后屏幕彻底回到默认界面
    // 判断一定发生在 sweep + fade 之后，作答时屏上不会再有任何回波。
    timing: { sweep: 1200, fade: 300, feedback: 620 },

    // 扫描的观感参数
    beam: {
      wedge: 0.62,        // 扇形余辉张角（弧度，约 35°）
      trails: 16,         // CRT 拖影线数量
      persistence: 0.55,  // 荧光余辉时间常数（单位：圈）
      clockwise: true
    }
  };

  /* ------------------------------------------------------------------
   * 工具
   * ---------------------------------------------------------------- */
  function now() {
    return (global.performance && global.performance.now)
      ? global.performance.now()
      : Date.now();
  }

  // 惰性查找：不在加载时缓存引用，这样后加载的 polyfill（或无头测试里
  // 替换的假 rAF）也能生效。
  function raf(fn) {
    if (global.requestAnimationFrame) { return global.requestAnimationFrame(fn); }
    return NATIVE_SET_TIMEOUT(fn, 16);
  }

  function caf(id) {
    if (typeof id !== 'number' && !id) { return; }
    if (global.cancelAnimationFrame) { global.cancelAnimationFrame(id); return; }
    global.clearTimeout(id);
  }

  /** 把角度归一化到 [0, 2π) */
  function norm(a) {
    var x = a % TAU;
    return x < 0 ? x + TAU : x;
  }

  /**
   * 某个方位上的回波在 elapsed 时刻的余辉亮度。
   * 光束只在经过该方位的瞬间"点亮"它，之后按余辉指数衰减。
   * @returns 0 表示还没被扫到；1 表示刚被扫到
   */
  function litAt(bearing, elapsed, opts) {
    var frac = norm(bearing - opts.start) / TAU;   // 该方位在整圈中的位置 0~1
    var tHit = frac * opts.period;                 // 被照到的时刻
    if (elapsed < tHit) { return 0; }
    var age = elapsed - tHit;
    return Math.exp(-age / (opts.persistence * opts.period));
  }

  /**
   * 某个方位的回波在"这一帧"到底有多亮 —— 绘制与测试共用这一个口径，
   * 免得出现"画面看着清空了、但判据里还有残留"这种不一致。
   *
   * st.mode：
   *   sweep —— 正在扫描，按荧光余辉衰减
   *   fade  —— 一圈扫完后的熄屏过渡，剩余余辉继续淡出（st.fade: 0→1）
   *   blank —— 默认待机屏，恒为 0：作答时屏上一个回波都没有
   *   hold  —— 冻结显示全部点迹，仅供反馈/结算看真相用，判断阶段绝不出现
   *
   * @returns 0 ~ 1
   */
  function echoBrightness(bearing, st) {
    if (st.mode === 'hold') { return 1; }
    if (st.mode === 'blank') { return 0; }
    if (st.mode === 'fade') {
      // elapsed 停在"刚好扫完"那一刻，让余辉先呈现真实的衰减分布，
      // 再整体乘以淡出系数，视觉上就是整屏点迹一起暗下去。
      var lit = litAt(bearing, st.opts.period, st.opts);
      var k = Math.max(0, Math.min(1, st.fade));
      return lit * Math.pow(1 - k, 1.35);
    }
    return litAt(bearing, st.elapsed, st.opts);
  }

  /* ------------------------------------------------------------------
   * 证据渲染：把内部感觉量 evidence 映射为屏幕回波的"可信度"
   * evidence 越大 → 回波越亮、光斑越大；方位与距离随机（不泄露答案）
   * ---------------------------------------------------------------- */
  function evidenceToVisual(evidence, rng) {
    // 亮度：evidence 经 logistic 压缩到 0.14 ~ 1
    var bright = 1 / (1 + Math.exp(-(evidence - 0.6) * 1.25));
    bright = 0.14 + 0.86 * bright;

    // 方位：均匀分布（与信号无关，避免泄露答案）
    var angle = rng() * TAU;

    // 距离：轻微随机，略靠外围
    var radiusRatio = 0.34 + rng() * 0.52;

    // 光斑大小
    var size = 3.2 + bright * 4.4;

    return {
      bright: bright,
      // 余辉长度：evidence 越大，回波在屏上"留得住"的时间越长
      tailLen: Math.max(0, Math.min(1, (evidence + 2) / 5.5)),
      angle: angle,
      radiusRatio: radiusRatio,
      size: size,
      // 杂波的散布纹理（与是否有信号无关）
      clutter: Array.from({ length: 22 + Math.floor(rng() * 10) }, function () {
        return {
          a: rng() * TAU,
          r: 0.16 + rng() * 0.78,
          s: 0.6 + rng() * 1.8,
          o: 0.10 + rng() * 0.30
        };
      })
    };
  }

  /* ------------------------------------------------------------------
   * 单次扫描的运行时状态（全局只维护这一套，够用且易于中断）
   * ---------------------------------------------------------------- */
  var anim = {
    handle: 0,
    running: false,
    canvas: null,
    trial: null,
    opts: null,
    startedAt: 0,
    onDone: null
  };

  function stopIntro() {
    if (anim.handle) { caf(anim.handle); }
    anim.handle = 0;
    anim.running = false;
    anim.canvas = null;
    anim.trial = null;
    anim.onDone = null;
  }

  /** 一圈扫描 + 熄屏淡出共需多久（毫秒）—— 由 App 用来安排"何时开放作答" */
  function introDuration() {
    return CONFIG.timing.sweep + CONFIG.timing.fade;
  }

  function frameOpts(trial) {
    // 画面一律用数学角；约定 -π/2（屏幕正北）为方位 0°，
    // 与屏上 000/030/… 的刻度读数保持一致。
    // 每圈再叠一个随机起始偏移，免得被试记住"起点那片总是刚扫过的"。
    var off = (trial && typeof trial.sweepAngle === 'number') ? trial.sweepAngle : 0;
    return {
      period: CONFIG.timing.sweep,
      fade: CONFIG.timing.fade,
      start: -Math.PI / 2 + off,
      persistence: CONFIG.beam.persistence,
      clockwise: CONFIG.beam.clockwise
    };
  }

  /** 装配一帧的画面状态 st */
  function state(mode, frac, elapsed, fadeP, opts) {
    var dir = opts.clockwise ? 1 : -1;
    var showedElapsed = (mode === 'fade' || mode === 'blank' || mode === 'hold')
      ? opts.period
      : elapsed;
    return {
      mode: mode,
      frac: frac,
      elapsed: showedElapsed,
      fade: fadeP,
      opts: opts,
      angle: norm(opts.start + dir * TAU * frac)
    };
  }

  function drawAt(elapsed) {
    if (!anim.canvas || !anim.trial) { return; }
    var opts = anim.opts;

    if (elapsed >= opts.period + opts.fade) {
      drawFrame(anim.canvas, anim.trial, state('blank', 1, opts.period, 1, opts));
      return;
    }
    if (elapsed >= opts.period) {
      var p = (elapsed - opts.period) / opts.fade;
      drawFrame(anim.canvas, anim.trial, state('fade', 1, opts.period, p, opts));
      return;
    }
    drawFrame(anim.canvas, anim.trial,
      state('sweep', Math.max(0, elapsed / opts.period), elapsed, 0, opts));
  }

  function step() {
    if (!anim.running) { return; }
    var elapsed = now() - anim.startedAt;
    if (elapsed >= anim.opts.period + anim.opts.fade) {
      finishIntro();
      return;
    }
    drawAt(elapsed);
    anim.handle = raf(step);
  }

  function finishIntro() {
    anim.running = false;
    if (anim.handle) { caf(anim.handle); anim.handle = 0; }
    // 关键：判断阶段的画面必须是"空白默认屏"，不能残留任何点迹
    drawFrame(anim.canvas, anim.trial, state('blank', 1, anim.opts.period, 1, anim.opts));
    var cb = anim.onDone;
    anim.onDone = null;
    if (cb) { cb(); }
  }

  /** 开始转一圈。done 在"转满一圈 + 余辉散尽"（或被跳过）后回调一次。 */
  function startIntro(canvas, trial, done) {
    stopIntro();
    anim.canvas = canvas;
    anim.trial = trial;
    anim.opts = frameOpts(trial);
    anim.onDone = done;
    anim.startedAt = now();
    anim.running = true;
    drawAt(0);
    anim.handle = raf(step);
  }

  /**
   * 跳过剩余扫描（按空格 / 点"跳过"时调用）：立即熄屏并进入判断。
   * 注意这时被跳过的一段方位是没看过的，被试可以再看一圈（R）。
   */
  function skipIntro() {
    if (!anim.running) { return false; }
    finishIntro();
    return true;
  }

  /* ------------------------------------------------------------------
   * 绘制：一个 PPI 画面
   * st = { mode, frac, elapsed, fade, opts, angle }
   *   mode: sweep 扫描中 | fade 熄屏中 | blank 默认待机屏（作答时就是这个）
   *         hold 冻结显示全部点迹（仅反馈/结算，判断阶段不会出现）
   * ---------------------------------------------------------------- */
  function drawFrame(canvas, trial, st) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;
    var P = UI.PALETTE;
    var v = trial.visual;
    var opts = st.opts;

    var cx = W / 2;
    var cy = H / 2 + 6;
    var R = Math.min(W, H) * 0.42;
    var outer = R * 1.14;

    ctx.clearRect(0, 0, W, H);

    /* ---------- 荧光屏底 ---------- */
    var bg = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, outer);
    bg.addColorStop(0, '#0d2b1c');
    bg.addColorStop(0.62, '#0a2116');
    bg.addColorStop(1, '#061510');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.fill();

    /* ---------- 距离圈 ---------- */
    ctx.strokeStyle = 'rgba(120, 235, 165, .17)';
    ctx.lineWidth = 1;
    [0.24, 0.48, 0.72, 0.96].forEach(function (k) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * k, 0, TAU);
      ctx.stroke();
    });

    /* ---------- 方位线 + 方位刻度 ---------- */
    ctx.font = '10px ' + UI.FONT_MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < 12; i++) {
      // 屏幕上 0° 指向正上（正北），数学角需要 -90° 偏移
      var scr = -Math.PI / 2 + i * Math.PI / 6;
      var long8 = (i % 3 === 0);
      ctx.strokeStyle = 'rgba(120, 235, 165, ' + (long8 ? 0.2 : 0.11) + ')';
      ctx.lineWidth = long8 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(scr) * R * 0.24, cy + Math.sin(scr) * R * 0.24);
      ctx.lineTo(cx + Math.cos(scr) * R, cy + Math.sin(scr) * R);
      ctx.stroke();

      if (long8) {
        ctx.fillStyle = 'rgba(150, 240, 180, .5)';
        ctx.fillText(
          String(i * 30).padStart(3, '0'),
          cx + Math.cos(scr) * outer * 0.93,
          cy + Math.sin(scr) * outer * 0.93
        );
      }
    }

    /* ---------- 回波：只在扫描期间可见，余辉散尽后屏上一个点都不留 ---------- */
    v.clutter.forEach(function (c) {
      var lit = echoBrightness(c.a, st);
      if (lit <= 0.012) { return; }
      var x = cx + Math.cos(c.a) * R * c.r;
      var y = cy + Math.sin(c.a) * R * c.r;
      ctx.fillStyle = 'rgba(150, 240, 180, ' + (c.o * 0.62 * lit) + ')';
      ctx.beginPath();
      ctx.arc(x, y, c.s, 0, TAU);
      ctx.fill();
    });

    var targetLit = echoBrightness(v.angle, st);
    var ex = cx + Math.cos(v.angle) * R * v.radiusRatio;
    var ey = cy + Math.sin(v.angle) * R * v.radiusRatio;

    if (targetLit > 0.012) {
      var peak = v.bright * targetLit;
      var halo = v.size * (2.6 + 1.4 * v.tailLen);
      var glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, halo);
      glow.addColorStop(0, 'rgba(205, 255, 225, ' + peak + ')');
      glow.addColorStop(0.34, 'rgba(120, 240, 165, ' + (peak * 0.48) + ')');
      glow.addColorStop(1, 'rgba(120, 240, 165, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ex, ey, halo, 0, TAU);
      ctx.fill();

      ctx.fillStyle = 'rgba(236, 255, 243, ' + Math.min(1, peak + 0.12) + ')';
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(1.2, v.size * (0.55 + 0.45 * targetLit)), 0, TAU);
      ctx.fill();
    }

    /* ---------- 光束：只在扫描期间存在；熄屏与待机时屏上是干净的 ---------- */
    var dir = opts.clockwise ? -1 : 1;   // 拖影落在光束"后方"
    if (st.mode === 'sweep') {
      var wedge = CONFIG.beam.wedge;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, st.angle + dir * wedge, st.angle, dir > 0);
      ctx.closePath();
      var wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      wg.addColorStop(0, 'rgba(150, 255, 200, .20)');
      wg.addColorStop(1, 'rgba(150, 255, 200, .03)');
      ctx.fillStyle = wg;
      ctx.fill();
      ctx.restore();

      for (var t = 1; t <= CONFIG.beam.trails; t++) {
        var k = t / CONFIG.beam.trails;
        var ta = st.angle + dir * wedge * k;
        ctx.strokeStyle = 'rgba(160, 255, 195, ' + (0.16 * (1 - k)) + ')';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ta) * R, cy + Math.sin(ta) * R);
        ctx.stroke();
      }

      var lg = ctx.createLinearGradient(
        cx, cy, cx + Math.cos(st.angle) * R, cy + Math.sin(st.angle) * R
      );
      lg.addColorStop(0, 'rgba(190, 255, 215, .55)');
      lg.addColorStop(1, 'rgba(150, 255, 195, .08)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(st.angle) * R, cy + Math.sin(st.angle) * R);
      ctx.stroke();
    } else if (st.mode === 'hold') {
      // 冻结态（反馈时）：光束停在起点，画一条淡淡的参考线，提示"这一圈已经扫完"
      ctx.strokeStyle = 'rgba(150, 255, 195, .12)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(opts.start) * R,
        cy + Math.sin(opts.start) * R
      );
      ctx.stroke();
    }

    /* ---------- 中心（本站）标记 ---------- */
    ctx.strokeStyle = 'rgba(160, 255, 195, .5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
    ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
    ctx.stroke();

    /* ---------- 扫描进度弧（只在扫描期间） ---------- */
    if (st.mode === 'sweep') {
      ctx.strokeStyle = 'rgba(160, 255, 195, .55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, outer + 8, -Math.PI / 2, -Math.PI / 2 + TAU * st.frac);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160, 255, 195, .12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, outer + 8, -Math.PI / 2 + TAU * st.frac, -Math.PI / 2 + TAU);
      ctx.stroke();
    }

    /* ---------- 边角仪器读数 ---------- */
    ctx.fillStyle = 'rgba(150, 240, 180, .62)';
    ctx.font = '11px ' + UI.FONT_MONO;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('RNG  PPI  MODE-A', 14, 12);
    ctx.fillText('GAIN ' + (trial.gainLabel || '7.2'), 14, 28);
    ctx.fillText('RPM  50  (演示速率)', 14, 44);

    // 画面右下角的机器状态，四种口径各一句，避免被试误读当前处于哪一段
    var sweepLabel = st.mode === 'sweep' ? 'SWEEP  ACTIVE'
      : st.mode === 'fade' ? 'PLOT  CLEARING'
        : st.mode === 'hold' ? 'SWEEP  HOLD'
          : 'STANDBY  /  PLOT CLR';

    ctx.textAlign = 'right';
    // 数学角 → 罗盘方位（0° = 正北）
    var brg = st.mode === 'sweep'
      ? Math.round(norm(st.angle + Math.PI / 2) * 180 / Math.PI) % 360
      : 0;
    ctx.fillText(st.mode === 'sweep' ? 'BRG ' + String(brg).padStart(3, '0') + '°' : 'BRG  ---', W - 14, 12);
    ctx.fillText(sweepLabel, W - 14, 28);
    ctx.fillText('SCAN ' + (st.mode === 'sweep' ? Math.round(st.frac * 100) : 100) + '%', W - 14, 44);

    /* ---------- 屏幕边框 ---------- */
    ctx.strokeStyle = P.brand800;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, TAU);
    ctx.stroke();

    return {
      cx: cx, cy: cy, R: R, ex: ex, ey: ey,
      bright: v.bright, mode: st.mode, lit: targetLit
    };
  }

  /**
   * 静态画面。
   *   phase === 'feedback' —— 作答之后：冻结显示全部点迹，让被试看清真相
   *   其它（含 'show'）     —— 判断之前：空白的默认待机屏，屏上不留任何回波
   * 无动画环境下也走这条路径，所以不会退化成"答案直接印在屏幕上"。
   */
  function render(canvas, trial, phase) {
    var opts = frameOpts(trial);
    var reveal = phase === 'feedback';
    return drawFrame(canvas, trial, state(
      reveal ? 'hold' : 'blank',
      1, opts.period, 1, opts
    ));
  }

  /** 反馈阶段的画面叠加：标出正确判断应为哪一类 */
  function renderFeedbackOverlay(canvas, trial, resultKind) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var rc = UI.RESULT_COLORS[resultKind];

    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, 0, W, 34);

    ctx.fillStyle = rc.stroke;
    ctx.font = '600 13px ' + UI.FONT_UI;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      resultKind === 'hit' ? '击中：确实是目标，你也报出了目标'
        : resultKind === 'miss' ? '漏报：确实是目标，但你判成了杂波'
          : resultKind === 'fa' ? '虚报：只是杂波，你却报了目标'
            : '正确拒斥：只是杂波，你也判作杂波',
      W / 2, 18
    );
  }

  /** 结算页的小型示例图（说明本场景的信号/噪音长什么样） */
  function renderExample(canvas) {
    var sc = UI.setupCanvas(canvas);
    var ctx = sc.ctx;
    var W = sc.w;
    var H = sc.h;

    var rows = [
      { label: 'SIGNAL · 真实目标', bright: 0.96, tail: 0.95, y: H * 0.28 },
      { label: 'NOISE · 海鸥杂波', bright: 0.42, tail: 0.25, y: H * 0.72 }
    ];

    ctx.fillStyle = '#0a2116';
    ctx.fillRect(0, 0, W, H);

    rows.forEach(function (r) {
      var cx = W * 0.5;
      var cy = r.y;
      var R = Math.min(W * 0.42, H * 0.3);

      ctx.strokeStyle = 'rgba(120,235,165,.16)';
      ctx.lineWidth = 1;
      [0.4, 0.75, 1].forEach(function (k) {
        ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, TAU); ctx.stroke();
      });

      for (var i = 0; i < 16; i++) {
        var a = i * 1.7;
        ctx.fillStyle = 'rgba(150,240,180,.13)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * R * (0.3 + (i % 5) * 0.16),
          cy + Math.sin(a) * R * (0.3 + (i % 4) * 0.2), 1.3, 0, TAU);
        ctx.fill();
      }

      var halo = 22 * r.bright;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, halo);
      g.addColorStop(0, 'rgba(215,255,230,' + r.bright + ')');
      g.addColorStop(1, 'rgba(120,240,165,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, halo, 0, TAU); ctx.fill();

      ctx.fillStyle = 'rgba(235,255,242,' + Math.min(1, r.bright + 0.2) + ')';
      ctx.beginPath(); ctx.arc(cx, cy, 3 + r.bright * 3.4, 0, TAU); ctx.fill();

      ctx.fillStyle = 'rgba(150,240,180,.8)';
      ctx.font = '600 11px ' + UI.FONT_UI;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.label, 12, r.y);
    });
  }

  global.SceneRadar = {
    config: CONFIG,
    evidenceToVisual: evidenceToVisual,
    render: render,
    startIntro: startIntro,
    stopIntro: stopIntro,
    skipIntro: skipIntro,
    introDuration: introDuration,
    renderFeedbackOverlay: renderFeedbackOverlay,
    renderExample: renderExample,
    // 回波亮度的唯一口径：绘制与测试共用，保证"看着清空了"与"数据上清空了"一致
    echoBrightness: echoBrightness
  };
}(typeof window !== 'undefined' ? window : globalThis));
