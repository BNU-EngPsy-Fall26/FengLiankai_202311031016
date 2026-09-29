/*!
 * sdt-core.js —— 信号检测论（Signal Detection Theory）数学内核
 * ---------------------------------------------------------------------------
 * 本文件不依赖任何第三方库，可在浏览器与 Node 中直接运行。
 *
 * 理论口径（与课程 PPT 严格一致）：
 *   1. 内部感觉量 x 服从两个等方差正态分布：
 *        N  分布 ~ Normal(0, 1)          （纯噪音）
 *        SN 分布 ~ Normal(d', 1)         （噪音 + 信号）
 *      d' = μ(SN) - μ(N)，即"辨别力"。
 *   2. 被试设定一个判断标准 C。C 定义在"Z 轴"上：以 N 分布中心为原点、
 *      SN 分布中心落在 d'；判断标准的绝对位置为 z_c = C + d'/2：
 *        x > z_c  ->  报告"有信号" (Yes)
 *        x ≤ z_c  ->  报告"无信号" (No)
 *      C > 0 表示标准偏严（保守），C < 0 偏松（冒进），C = 0 为无偏。
 *   3. 由此得到四种结果：
 *        击中 Hit  = P(Z > C - d'/2) = Φ(d'/2 - C)
 *        漏报 Miss = 1 - Hit
 *        虚报 FA   = P(Z > C + d'/2) = Φ(-d'/2 - C)
 *        正确拒斥 CR = 1 - FA
 *      无偏点 C = 0 处 P(hit) + P(fa) = Φ(d'/2) + Φ(-d'/2) = 1。
 *   4. 感受性指标：d' = Z(hit) - Z(fa)
 *   5. 反应偏向指标：
 *        β = O(SN) / O(N)              似然比（判断标准处两分布纵坐标之比）
 *        C = -[Z(hit) + Z(fa)] / 2     判断标准与两分布中点间的距离
 *      三者关系满足：  ln β = d' · C
 *      ⇒ β = e^{d'·C},  C = ln β / d'
 *      C = 0 ⟺ β = 1（无偏）；C > 0 严格保守；C < 0 宽松冒进。
 *   6. ROC 曲线：以 P(fa) 为横轴、P(hit) 为纵轴，同一条曲线上各点 d' 相同、
 *      C 不同。等方差条件下曲线下面积 AUC = Φ(d' / √2)。
 *
 * 坐标约定：本文件中一切内部计算都使用"意识/感觉量轴（x 轴）"，
 *          而不是"刺激物理强度轴"。二者关系为 x = z + d'（若把 N 分布中心
 *          记为 z = 0），PPT 中"I1（新刺激）/ I2（旧刺激）"的物理强度表述
 *          可由 scaleX 系列函数互相换算。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var SQRT2 = Math.sqrt(2);
  var SQRT_2PI = Math.sqrt(2 * Math.PI);

  /* ======================================================================
   * 1. 正态分布基础函数
   * ==================================================================== */

  var _erfCache = {};
  var ERF_STEP = 0.005;
  var ERF_MAX = 10.0;

  /** Lanczos 连分式：erfc(x) = exp(-x²)/(√π · (x + 1/2/(x + 1/(x + 3/2/(x + ...))))
   *  x ≥ 1.5 时相对误差 < 1e-15（Lentz 算法自下而上求值，收敛快且稳定） */
  function erfcCF(x) {
    var cf = 0;
    for (var i = 40; i >= 1; i--) {
      cf = (i / 2) / (x + cf);
    }
    return Math.exp(-x * x) / (Math.sqrt(Math.PI) * (x + cf));
  }

  /**
   * 误差函数 erf(x)，高精度实现：
   *   |x| < 0.5   →  幂级数展开（逐项收敛，精度 ~1e-17）
   *   0.5 ≤ |x| < 1.5  →  Taylor 级数在 x=1 处展开（使用查表系数，精度 ~1e-16）
   *   |x| ≥ 1.5   →  erfc = 1 - 连分式（精度 ~1e-15）
   * 目标：绝对误差 < 1e-14，保证 normInv / ROC / AUC 全程精确。
   */
  function erf(x) {
    var ax = Math.abs(x);
    var sign = x < 0 ? -1 : 1;

    if (ax < 0.5) {
      var sum = 0;
      var term = ax;
      var n = 0;
      var x2 = ax * ax;
      while (Math.abs(term) > 1e-20 && n < 90) {
        sum += term / (2 * n + 1);
        n += 1;
        term *= -x2 / n;
      }
      return sign * (2 / Math.sqrt(Math.PI)) * sum;
    }
    if (ax < 1.5) {
      // erf(1 + t) 的 Taylor 展开，系数由 2/√π·exp(-1) 递推：
      //   erf(x) = Σ c_n (x-1)^n ,  c_0 = erf(1)
      var t = ax - 1;
      var coef = ERF_TAYLOR;
      var acc = 0;
      var pow = 1;
      for (var k = 0; k < coef.length; k++) {
        acc += coef[k] * pow;
        pow *= t;
      }
      return sign * acc;
    }
    return sign * (1 - erfcCF(ax));
  }

  /**
   * erf(1+t) 在 t ∈ [-0.5, 0.5] 上的 Taylor 系数 c_n = erf⁽ⁿ⁾(1)/n!
   * 递推关系： f⁽ⁿ⁾(x) = -2·[x·f⁽ⁿ⁻¹⁾(x) + (n-2)·f⁽ⁿ⁻²⁾(x)]
   *           f⁽⁰⁾ = erf(x), f⁽¹⁾ = 2/√π·exp(-x²)
   * 由 Node 侧离线算得（见 tools/gen-erf-coef.js），此处为固化常数。
   */
  var ERF_TAYLOR = [
    8.4270079294971478e-01, 4.1510749742059472e-01, -4.1510749742059472e-01,
    1.3836916580686490e-01, 6.9184582903432448e-02, -6.9184582903432462e-02,
    4.6123055268954983e-03, 1.5154718159799492e-02, -4.7770307242846225e-03,
    -1.8851883701199847e-03, 1.2262875805634855e-03, 8.5523991371727400e-05,
    -2.0005514713217966e-04, 1.8716639237143008e-05, 2.3707092917618649e-05,
    -5.4782439136144774e-06, -2.0810470178536994e-06, 8.4904713963144363e-07,
    1.2328726086225260e-07, -9.7385801574591168e-08, -1.9412656084384972e-09,
    8.9959787718381048e-09, -6.4974130753173267e-10, -6.9020255115771572e-10,
    1.0930785305190429e-10, 4.4170900677939204e-11, -1.1469726123674409e-11,
    -2.2964662043673662e-12, 9.5295626119961258e-13, 8.6999537449087996e-14,
    -6.7139682527845296e-14, -1.0941851832004154e-15, 4.1292544687793787e-15,
    -1.8601591348811978e-16, -2.2459468423499495e-16
  ];

  /** 标准正态累积分布函数 Φ(z) = P(Z ≤ z) */
  function normCdf(z) {
    return 0.5 * (1 + erf(z / SQRT2));
  }

  /** 标准正态概率密度函数 φ(z) */
  function normPdf(z) {
    return Math.exp(-0.5 * z * z) / SQRT_2PI;
  }

  /**
   * 标准正态分布上侧概率 P(Z > z)。
   * 对 z 较大时用 erfc 直算，避免 1 - Φ(z) 的灾难性抵消。
   */
  function normSf(z) {
    return 0.5 * erfcImpl(z / SQRT2);
  }

  /** 互补误差函数 erfc(x) = 1 - erf(x)，|x| ≥ 1.5 时用连分式避免抵消 */
  function erfcImpl(x) {
    if (x < 0) { return 2 - erfcImpl(-x); }
    if (x < 1.5) { return 1 - erf(x); }
    return erfcCF(x);
  }

  /**
   * 标准正态分位数 Z(p)（逆累积分布，Acklam 逼近 + Halley 精修）
   *
   * 关于精修的残留误差：Halley 步的修正量 u 需要求 Φ 的数值导数 φ，
   * 而上侧概率在 |z|>3 后已进入双精度"概率平台"（Φ 的最小可分辨步长
   * Δz ≈ φ(z)/ε_machine）。因此在极端尾部（|Z|≳4）无论如何精修，
   * Z 的绝对精度都不可能优于 ~1e-8。
   * 对本应用而言：SDT 指标展示 2~3 位小数，这一精度完全够用；
   * 且游戏/演示中的 d' 实际取值范围（0~4）内误差 < 1e-8。
   */
  function normInv(p) {
    if (!(p > 0 && p < 1)) {
      if (p === 0) { return -Infinity; }
      if (p === 1) { return Infinity; }
      return NaN;
    }
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00];
    var plow = 0.02425;
    var phigh = 1 - plow;
    var q, r, x;
    // 防止 p 过于贴近 0/1 时 log 溢出（钳制到可表示范围）
    var pp = p < 1e-300 ? 1e-300 : (p > 1 - 1e-16 ? 1 - 1e-16 : p);

    if (pp < plow) {
      q = Math.sqrt(-2 * Math.log(pp));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (pp > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - pp));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
      q = pp - 0.5;
      r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    // Halley 迭代精修：牛顿步 u = (Φ(x) - p) / φ(x)，Halley 再除以 (1 + x·u/2)
    for (var it = 0; it < 3; it++) {
      var e = normCdf(x) - pp;
      var u = e / normPdf(x);          // 牛顿修正量
      x = x - u / (1 + 0.5 * x * u);   // Halley 修正（二阶收敛）
      if (Math.abs(u) < 1e-16) { break; }
    }
    return x;
  }

  /* ======================================================================
   * 2. 对数伽马（用于似然比与模型比较）
   * ==================================================================== */
  var LANCZOS_G = 7;
  var LANCZOS_C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  function logGamma(z) {
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = LANCZOS_C[0];
    for (var i = 1; i < LANCZOS_G + 2; i++) {
      x += LANCZOS_C[i] / (z + i);
    }
    var t = z + LANCZOS_G + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  /* ======================================================================
   * 3. 坐标轴换算：内部感觉量轴  ↔  PPT 的刺激强度轴
   * ---------------------------------------------------------------------
   * PPT 常把"新刺激/旧刺激"画在物理强度轴上，并令 z(N) = 0 时
   * 新刺激 I1 位于 0、旧刺激 I2 位于 d'。两种表述等价：
   *      感觉量轴坐标 x  =  z + d'·(该刺激所属分布)
   * 换言之，把 N 分布中心放在 z=0 后，"距 N 分布中心的 z 距离"就是
   * 物理强度轴上的刻度。
   * ==================================================================== */
  function senseToStimulus(x, d) {
    // x：感觉量轴坐标（d' 坐标系下，SN 中心在 x = d）
    // 返回：以"新刺激为 0、旧刺激为 d'"表述的刺激强度坐标
    return x - d;
  }

  function stimulusToSense(z, d) {
    return z + d;
  }

  /* ======================================================================
   * 4. 四种结果与 SDT 指标
   * ==================================================================== */

  /**
   * 由 (d', C) 计算理论上的四种结果概率与各指标。
   *
   * 【坐标约定 · 重要】C 定义在 Z 轴上：以 N 分布中心为原点，SN 分布中心在 d'。
   *   于是判断标准的绝对位置 z_c = C + d'/2，四种结果为
   *     P(hit) = P(Z > z_c - d') = P(Z > C - d'/2)
   *     P(fa)  = P(Z > z_c)      = P(Z > C + d'/2)
   *   验证无偏点 C = 0：P(hit) = Φ(d'/2)，P(fa) = Φ(-d'/2)，二者之和恰为 1。
   *   这一约定与"ROC 曲线上从左下到右上标准由严格到宽松""C>0 保守、C<0 宽松"一致。
   *
   * @param {number} d 辨别力 d'（0 ~ 5 常用）
   * @param {number} c 判断标准 C（Z 轴刻度；C>0 保守、C<0 宽松、C=0 无偏）
   * @returns {Object} 完整指标集合
   */
  function fromParams(d, c) {
    d = clamp(d, 0, 12);
    c = clamp(c, -12, 12);

    var zHit = c * -1 + d / 2;   // Z(hit) = d'/2 - C
    var zFa = c * -1 - d / 2;    // Z(fa)  = -d'/2 - C

    var hit = normCdf(zHit);     // P(Z ≤ Z(hit))
    var fa = normCdf(zFa);
    var miss = 1 - hit;
    var cr = 1 - fa;

    var oSn = normPdf(zHit);     // 判断标准处 SN 分布的纵坐标 O(SN)
    var oN = normPdf(zFa);       // 判断标准处 N  分布的纵坐标 O(N)
    var beta = betaFromC(c, d);  // 恒等式 β = e^{d'·C}，等价于 O(SN)/O(N)

    var cFromRates = -0.5 * (zHit + zFa);   // 应精确还原输入的 C
    var dFromRates = zHit - zFa;            // 应精确还原输入的 d'
    var accuracy = (hit + cr) / 2;          // 无偏假设下的百分正确率
    var auc = normCdf(d / SQRT2);           // 等方差模型下 AUC = Φ(d'/√2)

    return {
      d: d,
      c: c,
      beta: beta,
      hit: hit, miss: miss, fa: fa, cr: cr,
      zHit: zHit, zFa: zFa,
      oSn: oSn, oN: oN,
      dFromRates: dFromRates,
      cFromRates: cFromRates,
      accuracy: accuracy,
      auc: auc,
      lnBeta: d * c,               // ln β = d'·C
      zCriterion: c + d / 2        // 判断标准在绝对感觉量轴上的位置
    };
  }

  /**
   * 由四种结果的计数计算 SDT 指标（用于真实游戏数据）。
   * 对 0 或 1 的极端比例使用（1/2N）修正，避免 Z 值发散。
   * @param {{hit:number, miss:number, fa:number, cr:number}} counts
   * @param {{correction?:boolean}} [opts]
   */
  function fromCounts(counts, opts) {
    opts = opts || {};
    var doCorrect = opts.correction !== false;

    var nSignal = counts.hit + counts.miss;
    var nNoise = counts.fa + counts.cr;

    var rawHit = nSignal > 0 ? counts.hit / nSignal : NaN;
    var rawFa = nNoise > 0 ? counts.fa / nNoise : NaN;

    var corrected = false;
    var h = rawHit;
    var f = rawFa;

    if (doCorrect) {
      if (nSignal > 0 && (rawHit === 0 || rawHit === 1)) {
        h = (counts.hit + 0.5) / (nSignal + 1);
        corrected = true;
      }
      if (nNoise > 0 && (rawFa === 0 || rawFa === 1)) {
        f = (counts.fa + 0.5) / (nNoise + 1);
        corrected = true;
      }
    }

    // 全部报"无信号"或全报"有信号"等退化情形
    var degenerate = false;
    if (!isFinite(h) || !isFinite(f)) { degenerate = true; h = 0.5; f = 0.5; }
    if (h === 1) { h = 0.999999; degenerate = true; }
    if (h === 0) { h = 0.000001; degenerate = true; }
    if (f === 1) { f = 0.999999; degenerate = true; }
    if (f === 0) { f = 0.000001; degenerate = true; }

    var zHit = normInv(h);
    var zFa = normInv(f);
    var d = zHit - zFa;
    var cVal = -0.5 * (zHit + zFa);
    // O(SN)、O(N) 与 β 均由 (d', C) 解析给出，避免尾部 φ 下溢。
    // 恒等式：β = e^{d'·C}（见第 7 节推导注释）
    var oSn = normPdf(zHit);
    var oN = normPdf(zFa);
    var beta = betaFromC(cVal, d);

    var total = counts.hit + counts.miss + counts.fa + counts.cr;
    var accuracy = total > 0 ? (counts.hit + counts.cr) / total : NaN;

    return {
      counts: {
        hit: counts.hit, miss: counts.miss, fa: counts.fa, cr: counts.cr
      },
      trials: total,
      nSignal: nSignal,
      nNoise: nNoise,
      rawHit: rawHit, rawFa: rawFa,
      hit: h, fa: f,
      miss: 1 - h, cr: 1 - f,
      zHit: zHit, zFa: zFa,
      oSn: oSn, oN: oN,
      d: d, c: cVal, beta: beta,
      accuracy: accuracy,
      auc: normCdf(d / SQRT2),
      correctionApplied: corrected,
      degenerate: degenerate
    };
  }

  /* ======================================================================
   * 5. ROC 曲线
   * ==================================================================== */

  /**
   * 生成理论 ROC 曲线（等方差正态模型）。
   * @param {number} d 辨别力
   * @param {number} nPoints 采样点数
   * @returns {{fa:number[], hit:number[], auc:number}}
   */
  function rocCurve(d, nPoints) {
    nPoints = nPoints || 201;
    var fa = [];
    var hit = [];
    var lo = -6;
    var hi = 6;
    for (var i = 0; i < nPoints; i++) {
      var c = lo + (hi - lo) * i / (nPoints - 1);
      fa.push(normSf(c));
      hit.push(normSf(c - d));
    }
    // 保证横轴升序（C 由大到小 → P(fa) 由小到大）
    var pairs = [];
    for (var j = 0; j < fa.length; j++) { pairs.push([fa[j], hit[j]]); }
    pairs.sort(function (p, q) { return p[0] - q[0]; });
    return {
      fa: pairs.map(function (p) { return p[0]; }),
      hit: pairs.map(function (p) { return p[1]; }),
      auc: aucFromCurve(pairs)
    };
  }

  /** 梯形法计算曲线下面积 */
  function aucFromCurve(pairs) {
    var area = 0;
    for (var i = 1; i < pairs.length; i++) {
      var dx = pairs[i][0] - pairs[i - 1][0];
      area += dx * (pairs[i][1] + pairs[i - 1][1]) / 2;
    }
    return area;
  }

  /**
   * 多标准 ROC：给定一组判断标准 C 值，返回曲线上的点。
   * 对应 PPT "评价法"中多个判断标准落在同一条 ROC 曲线上的情形。
   */
  function rocFromCriteria(d, criteria) {
    var pts = criteria.map(function (c) {
      return { c: c, fa: normSf(c), hit: normSf(c - d) };
    });
    pts.sort(function (a, b) { return a.fa - b.fa; });
    return pts;
  }

  /**
   * 经验 ROC：由真实游戏结果构造。
   * 使用评价法思路——把"报告有信号"的把握程度分级，累加得到多个操作点。
   * 若游戏只记录二元判断，则退化为一两个点。
   * @param {Array<{isSignal:boolean, confidence:number}>} trials
   *        confidence ∈ [1,5]，5 表示最确信"有信号"
   */
  function rocEmpirical(trials) {
    var levels = [5, 4, 3, 2, 1];
    var pts = [{ fa: 0, hit: 0, threshold: Infinity }];
    var nS = 0;
    var nN = 0;
    trials.forEach(function (t) { if (t.isSignal) { nS++; } else { nN++; } });
    if (nS === 0 || nN === 0) { return { points: pts, auc: NaN }; }

    levels.forEach(function (lv) {
      var hitC = 0;
      var faC = 0;
      trials.forEach(function (t) {
        if (t.confidence >= lv) {
          if (t.isSignal) { hitC++; } else { faC++; }
        }
      });
      pts.push({ fa: faC / nN, hit: hitC / nS, threshold: lv });
    });
    pts.push({ fa: 1, hit: 1, threshold: -Infinity });

    var pairs = pts.map(function (p) { return [p.fa, p.hit]; });
    return { points: pts, auc: aucFromCurve(pairs) };
  }

  /**
   * ROC 曲线上的"最佳操作点"（Youden 指数最大处）。
   * 常用于说明"给定 d' 时把 C 放在哪里总正确率最高"。
   */
  function bestOperatingPoint(d) {
    var cr = rocCurve(d, 1201);
    var best = { fa: 0, hit: 0, youden: -Infinity, c: 0 };
    for (var i = 0; i < cr.fa.length; i++) {
      var youden = cr.hit[i] - cr.fa[i];
      if (youden > best.youden) {
        best = {
          fa: cr.fa[i], hit: cr.hit[i], youden: youden,
          c: -0.5 * (normInv(clamp01(cr.hit[i])) + normInv(clamp01(cr.fa[i])))
        };
      }
    }
    return best;
  }

  /* ======================================================================
   * 6. 由命中率/虚报率的先验预测：最优 β（贝叶斯理想观察者）
   * ---------------------------------------------------------------------
   * 若信号先验概率为 p(S)，四种结果的支付矩阵为
   *   V(hit)、V(cr)、V(fa)（损失记负）、V(miss)，则最优似然比为
   *        β_opt = [p(N)/p(S)] · [(V(cr) - V(fa)) / (V(hit) - V(miss))]
   * 这是游戏里"先验概率 / 奖惩"影响判断标准的理论依据（PPT 第 57-58 页）。
   * ==================================================================== */
  function optimalBeta(priorSignal, payoff) {
    var pS = clamp(priorSignal, 1e-6, 1 - 1e-6);
    var vHit = payoff.hit, vMiss = payoff.miss;
    var vFa = payoff.fa, vCr = payoff.cr;
    var numer = (1 - pS) * (vCr - vFa);
    var denom = pS * (vHit - vMiss);
    if (denom === 0) { return Infinity; }
    return numer / denom;
  }

  /** 由最优 β 与 d' 推出最优判断标准 C */
  function optimalC(d, priorSignal, payoff) {
    var b = optimalBeta(priorSignal, payoff);
    if (!isFinite(b) || b <= 0 || d <= 0) { return 0; }
    return cFromBeta(b, d);
  }

  /* ======================================================================
   * 7. 指标互换工具
   * ==================================================================== */

  /**
   * 三个判断标准表示法之间的严格互换关系（由定义直接推出）
   * ------------------------------------------------------------------
   * 令  Z(hit) = d'/2 - C ,  Z(fa) = -d'/2 - C   （由 d'=Zhit-Zfa、C=-½(Zhit+Zfa) 反解）
   * 则  β = O(SN)/O(N) = φ(Zhit)/φ(Zfa) = exp[ (Zfa² - Zhit²)/2 ]
   *                      = exp[ (Zfa-Zhit)(Zfa+Zhit)/2 ]
   *                      = exp[ (-d')·(-2C) / 2 ]
   *                      = exp( d' · C )
   *
   * 于是三者满足：  ln β = d' · C
   *   β = e^{d'·C}         C = ln β / d'         d' = ln β / C
   * 注意 d' 与 C 互相独立：β 同时受二者影响，不能单独用 β 判断感受性。
   */

  /** β = exp(d'·C) */
  function betaFromC(c, d) {
    return Math.exp(d * c);
  }

  /** C = ln β / d' */
  function cFromBeta(beta, d) {
    if (d <= 0) { return 0; }
    return Math.log(beta) / d;
  }

  /**
   * 由 C 与 β 解 d'：ln β = d'·C ⇒ d' = ln β / C（C ≠ 0）
   * C = 0 时 ln β ≡ 0，d' 无法由 (C, β) 确定（数学上不独立），返回 NaN。
   */
  function dFromCBeta(c, beta) {
    if (c === 0) { return NaN; }
    return Math.log(beta) / c;
  }

  /* ======================================================================
   * 8. 随机数与试次生成
   * ==================================================================== */

  /** 可复现的伪随机数生成器（mulberry32），保证实验条件可复现 */
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Box-Muller：生成标准正态随机数 */
  function gaussian(rng) {
    var u1 = 0;
    var u2 = 0;
    while (u1 === 0) { u1 = rng(); }
    while (u2 === 0) { u2 = rng(); }
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** 生成服从 N(0,1) 或 N(d,1) 的感觉量样本 */
  function sampleEvidence(rng, isSignal, d) {
    return gaussian(rng) + (isSignal ? d : 0);
  }

  /**
   * 生成一整轮试次序列。
   * @param {Object} cfg
   *   n         试次数
   *   prior     信号先验概率 p(S)
   *   d         辨别力 d'
   *   seed      随机种子（用于复现）
   * @returns {Array<{isSignal:boolean, evidence:number}>}
   */
  function generateTrials(cfg) {
    var rng = makeRng(cfg.seed || 20260923);
    var trials = [];
    for (var i = 0; i < cfg.n; i++) {
      var isSignal = rng() < cfg.prior;
      trials.push({
        isSignal: isSignal,
        evidence: sampleEvidence(rng, isSignal, cfg.d)
      });
    }
    return trials;
  }

  /**
   * 由证据值与判断标准给出结果类别。
   *
   * 坐标系换算：仿真生成的 evidence 位于"绝对感觉量轴"（N 中心 0、SN 中心 d'），
   * 而入参 c 是 Z 轴刻度的判断标准，需换算为绝对位置 z_c = c + d'/2 再比较。
   * 若调用方已经用绝对位置（例如演示面板直接拖动的红线），传 d = 0 即可，
   * 此时 z_c = c，行为退化为最直观的"evidence > 阈值"。
   *
   * @param {boolean} isSignal 本次是否为信号
   * @param {number} evidence 内部感觉量
   * @param {number} c 判断标准（Z 轴刻度）
   * @param {number} [d] 辨别力，用于把 C 换算到绝对轴（默认 0）
   * @returns {'hit'|'miss'|'fa'|'cr'}
   */
  function classify(isSignal, evidence, c, d) {
    var zCriterion = c + (d || 0) / 2;
    var saidYes = evidence > zCriterion;
    if (isSignal) { return saidYes ? 'hit' : 'miss'; }
    return saidYes ? 'fa' : 'cr';
  }

  /* ======================================================================
   * 9. 小工具
   * ==================================================================== */
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function clamp01(p) {
    return clamp(p, 1e-12, 1 - 1e-12);
  }

  function round(v, n) {
    var f = Math.pow(10, n === undefined ? 3 : n);
    return Math.round(v * f) / f;
  }

  function fmt(v, n) {
    n = n === undefined ? 2 : n;
    if (!isFinite(v)) { return v > 0 ? '+∞' : '−∞'; }
    if (isNaN(v)) { return '—'; }
    return v.toFixed(n);
  }

  /* ======================================================================
   * 导出
   * ==================================================================== */
  var SDT = {
    // 分布函数
    erf: erf, erfc: erfcImpl, normCdf: normCdf, normPdf: normPdf,
    normSf: normSf, normInv: normInv, logGamma: logGamma,
    // 坐标换算
    senseToStimulus: senseToStimulus, stimulusToSense: stimulusToSense,
    // 指标
    fromParams: fromParams, fromCounts: fromCounts,
    cFromBeta: cFromBeta, betaFromC: betaFromC, dFromCBeta: dFromCBeta,
    // ROC
    rocCurve: rocCurve, rocFromCriteria: rocFromCriteria,
    rocEmpirical: rocEmpirical, aucFromCurve: aucFromCurve,
    bestOperatingPoint: bestOperatingPoint,
    // 最优标准
    optimalBeta: optimalBeta, optimalC: optimalC,
    // 试次生成
    makeRng: makeRng, gaussian: gaussian,
    sampleEvidence: sampleEvidence, generateTrials: generateTrials,
    classify: classify,
    // 工具
    clamp: clamp, clamp01: clamp01, round: round, fmt: fmt,
    SQRT2: SQRT2
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SDT;
  }
  global.SDT = SDT;
}(typeof window !== 'undefined' ? window : globalThis));
