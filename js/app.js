/*!
 * app.js —— 应用主控：路由、游戏流程、结算报告
 * ---------------------------------------------------------------------------
 * 结构：
 *   1. 路由与视图切换
 *   2. 首页渲染（场景卡片、公式速查）
 *   3. 游戏配置（场景 / 试次数 / 先验概率 / 难度 / 支付矩阵）
 *   4. 游戏主循环（呈现证据 → 等待作答 → 判定 → 下一试次）
 *   5. 结算报告（计数、SDT 指标、ROC、逐试次明细）
 *   6. 历史记录（同场景多次实验对比）
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var SDT = global.SDT;
  var UI = global.UI;

  /* ======================================================================
   * 场景注册表
   * ==================================================================== */
  var SCENES = [
    { key: 'radar', mod: function () { return global.SceneRadar; } },
    { key: 'legal', mod: function () { return global.SceneLegal; } },
    { key: 'industrial', mod: function () { return global.SceneIndustrial; } }
  ];

  var DIFFICULTY = [
    { label: '极易', d: 3.0, hint: '两分布几乎分开，几乎不会出错（d′ = 3.00）' },
    { label: '较易', d: 2.4, hint: '重叠较少，大部分试次能判断正确（d′ = 2.40）' },
    { label: '中等', d: 1.5, hint: '有明显重叠，是本平台默认难度（d′ = 1.50）' },
    { label: '较难', d: 0.8, hint: '重叠严重，判断常靠猜（d′ = 0.80）' },
    { label: '极难', d: 0.5, hint: '几乎无法分辨，接近随机作答（d′ = 0.50）' }
  ];

  var DEFAULT_PAYOFF = { radar: { hit: 12, miss: -40, fa: -6, cr: 4 } };

  var app = {
    route: 'home',
    scene: null,
    nTrials: 20,
    prior: 0.5,
    diffIndex: 2,
    payoff: null,
    session: null,
    history: []
  };

  /* ======================================================================
   * 1. 路由
   * ==================================================================== */
  function go(route) {
    app.route = route;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('is-active', v.id === 'view-' + route);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.app-nav__btn'), function (b) {
      var on = b.getAttribute('data-route') === route;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    global.scrollTo({ top: 0, behavior: 'smooth' });

    if (route === 'games') {
      // 步骤条按当前画面重新推导（可能是中途切回来，画面停在半局）
      updateSteps();
    }
    if (route === 'theory' && global.TheoryDemo) {
      // 视图显示后尺寸才可测，需延后一帧绘制
      global.requestAnimationFrame(function () {
        global.TheoryDemo.renderAll();
      });
    }
    if (route === 'runs' && global.RunHistory) {
      // 每次进入都重画：上一次进入之后可能又玩了新的一轮
      global.RunHistory.render();
    }
  }

  function bindRouting() {
    Array.prototype.forEach.call(document.querySelectorAll('.app-nav__btn'), function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-route')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-goto')); });
    });
  }

  /* ======================================================================
   * 2. 首页渲染
   * ==================================================================== */
  function sceneModule(key) {
    var entry = SCENES.filter(function (s) { return s.key === key; })[0];
    return entry ? entry.mod() : null;
  }

  function renderHomeScenarios() {
    var box = document.getElementById('home-scenarios');
    if (!box) { return; }
    UI.clear(box);

    SCENES.forEach(function (s) {
      var mod = s.mod();
      var cfg = mod.config;

      var card = UI.el('article', { class: 'scene-card' });
      card.appendChild(UI.el('div', { class: 'scene-card__top' }, [
        UI.el('span', {
          class: 'scene-card__icon',
          html: UI.ICONS[cfg.icon],
          style: 'color:' + cfg.accent + ';background:' + cfg.accentSoft + ';border-color:' + cfg.accent + '33'
        }),
        UI.el('div', {}, [
          UI.el('h3', { class: 'scene-card__title', text: cfg.name }),
          UI.el('span', { class: 'scene-card__tag', text: cfg.tag })
        ])
      ]));

      var pair = UI.el('dl', { class: 'scene-card__pair' }, [
        UI.el('div', {}, [
          UI.el('dt', { text: '信号 (SN)' }),
          UI.el('dd', { text: cfg.signalMeaning })
        ]),
        UI.el('div', {}, [
          UI.el('dt', { text: '噪音 (N)' }),
          UI.el('dd', { text: cfg.noiseMeaning })
        ])
      ]);

      card.appendChild(UI.el('div', { class: 'scene-card__body' }, [
        UI.el('p', { class: 'scene-card__desc', text: cfg.desc }),
        pair
      ]));

      card.appendChild(UI.el('div', { class: 'scene-card__foot' }, [
        UI.el('span', { class: 'scene-card__cost', text: cfg.payoffNote }),
        UI.el('button', {
          class: 'btn btn--primary btn--tiny',
          text: '进入',
          onclick: function () { selectScene(s.key); go('games'); }
        })
      ]));

      box.appendChild(card);
    });
  }

  /**
   * 公式速查表。
   * rows 是若干条 HTML 片段，每条渲染成一行，行内不折行；
   * 排版约定：单字母变量用 <i> 斜体，多字母函数名（AUC / ln）与 Φ、√ 保持正体。
   * 除法一律用 UI.frac() 写成上下两行的分数，不再用 "a / b"。
   */
  var F = UI.frac;

  var FORMULAS = [
    { name: '辨别力 d′',
      rows: ['<i>d</i>′ = <i>Z</i>(hit) − <i>Z</i>(fa)',
             '<i>d</i>′ = <i>μ</i>(SN) − <i>μ</i>(N)'],
      note: '两个感觉分布中心的距离（等方差正态假设下）。d′ 越大，感受性越高。' },

    { name: '判断标准 C',
      rows: ['<i>C</i> = −' + F('<i>Z</i>(hit) + <i>Z</i>(fa)', '2')],
      note: '标准到两分布中点的距离（Z 轴刻度）。C > 0 偏严、C < 0 偏松、C = 0 无偏。' },

    { name: '似然比 β',
      rows: ['<i>β</i> = ' + F('<i>O</i>(SN)', '<i>O</i>(N)')
             + ' = <i>e</i><sup><i>d</i>′·<i>C</i></sup>'],
      note: '标准处两分布纵坐标之比。β 同时受 d′ 与 C 影响，因此不宜单独用来判断感受性。' },

    { name: '三者的关系',
      rows: ['ln <i>β</i> = <i>d</i>′ · <i>C</i>',
             '<i>β</i> = <i>e</i><sup><i>d</i>′·<i>C</i></sup>'],
      note: 'C = 0 ⟺ β = 1。C 与 β 单调同向，但 C 是可跨条件比较的距离刻度。' },

    { name: '四种结果',
      rows: ['<i>P</i>(Hit) + <i>P</i>(Miss) = 1',
             '<i>P</i>(FA) + <i>P</i>(CR) = 1'],
      note: '同一行的两个概率互补。只看总正确率无法区分感受性与反应偏向。' },

    { name: '曲线下面积 AUC',
      rows: ['AUC = Φ' + F('<i>d</i>′', '√2')],
      note: '等方差模型下的解析解，取值 (0.5, 1)。d′ = 0 时 AUC = 0.5，即几率水平。' },

    { name: 'Z 坐标下的 ROC',
      rows: ['<i>Z</i>(hit) = <i>d</i>′ + <i>Z</i>(fa)'],
      note: '把 ROC 坐标换成 Z 分数后曲线变成直线：斜率 1、截距 d′。斜率明显小于 1 说明方差不齐。' },

    { name: '最优判断标准',
      rows: ['<i>β</i><sub>opt</sub> = ' + F('<i>P</i>(N)', '<i>P</i>(S)')
             + ' × ' + F('<i>V</i><sub>CR</sub> − <i>V</i><sub>FA</sub>',
                         '<i>V</i><sub>Hit</sub> − <i>V</i><sub>Miss</sub>')],
      note: '贝叶斯理想观察者。先验概率越高或漏报代价越大，最优标准越低。' }
  ];

  function renderFormulas() {
    var box = document.getElementById('formula-grid');
    if (!box) { return; }
    UI.clear(box);
    FORMULAS.forEach(function (f) {
      box.appendChild(UI.el('div', { class: 'formula-card' }, [
        UI.el('div', { class: 'formula-card__name', text: f.name }),
        UI.formula(f.rows, 'formula-card__expr'),
        UI.el('p', { class: 'formula-card__note', text: f.note })
      ]));
    });
  }

  /* ======================================================================
   * 3. 游戏配置
   * ==================================================================== */
  function renderPicker() {
    var box = document.getElementById('scene-picker');
    if (!box) { return; }
    UI.clear(box);

    // 选定场景后，整块选卡区让位给"该场景的判读标准"（见 renderSceneBrief），
    // 规则就出现在刚才点卡片的地方，不再另起一节堆在设置面板里。
    box.hidden = !!app.scene;

    SCENES.forEach(function (s) {
      var cfg = s.mod().config;
      var btn = UI.el('button', {
        class: 'picker__card' + (app.scene === s.key ? ' is-active' : ''),
        type: 'button',
        onclick: function () { selectScene(s.key); }
      }, [
        UI.el('span', { class: 'picker__check', text: '✓' }),
        UI.el('div', { class: 'picker__head' }, [
          UI.el('span', {
            class: 'picker__icon',
            html: UI.ICONS[cfg.icon],
            style: 'color:' + cfg.accent + ';background:' + cfg.accentSoft + ';border-color:' + cfg.accent + '33'
          }),
          UI.el('div', {}, [
            UI.el('div', { class: 'picker__name', text: cfg.name }),
            UI.el('div', { class: 'picker__tag', text: cfg.tag })
          ])
        ]),
        UI.el('p', { class: 'picker__desc', text: cfg.desc })
      ]);
      box.appendChild(btn);
    });

    renderSceneBrief();
  }

  /**
   * 选场景后、开始实验前，把该场景的"判读标准"完整摊开给玩家看。
   * 后两个场景（法律 / 探伤）的证据强度是连续量，不预先说明该看哪里，
   * 玩家只能靠猜 —— 那测到的是"会不会读图"而不是辨别力 d′。
   *
   * 这张卡占的就是原来的选卡区（.scene-slot）：选完场景，三张卡片收起，
   * 原地换成这个场景的规则，玩家不用再往下翻去找说明。
   */
  function renderSceneBrief() {
    var box = document.getElementById('scene-brief');
    if (!box) { return; }
    UI.clear(box);

    if (!app.scene) { box.hidden = true; return; }
    var cfg = sceneModule(app.scene).config;
    var g = cfg.guide;
    if (!g) { box.hidden = true; return; }

    box.hidden = false;

    box.appendChild(UI.el('div', { class: 'scene-brief__head' }, [
      UI.el('span', {
        class: 'scene-brief__icon',
        html: UI.ICONS[cfg.icon],
        style: 'color:' + cfg.accent + ';background:' + cfg.accentSoft
          + ';border-color:' + cfg.accent + '33'
      }),
      UI.el('div', {}, [
        UI.el('div', { class: 'scene-brief__name', text: cfg.name }),
        UI.el('div', { class: 'scene-brief__tag', text: cfg.tag })
      ]),
      UI.el('span', { class: 'scene-brief__spacer' }),
      UI.el('button', {
        class: 'btn btn--tiny btn--ghost',
        type: 'button',
        text: '↩ 换一个场景',
        onclick: function () { clearScene(); }
      })
    ]));

    // 规则正文折叠起来放：手机上一整块说明能把第一屏占满，而开局后玩家其实已经读过了。
    // 场景名与「换一个场景」按钮留在折叠框外，随时能切回去。
    var det = collapsible('brief-box', 'brief__toggle',
      UI.el('span', { class: 'brief__title', text: '开始前请先看清：' + g.title }));
    box.appendChild(det);

    var rows = UI.el('div', { class: 'brief__rows' });
    g.rows.forEach(function (r) {
      var line = UI.el('div', { class: 'brief__row' });
      if (r.swatch) {
        line.appendChild(UI.el('i', { class: 'brief__swatch', style: 'background:' + r.swatch }));
      }
      line.appendChild(UI.el('span', { class: 'brief__key', text: r.key }));
      var body = UI.el('span', { class: 'brief__text' });
      body.innerHTML = r.text;
      line.appendChild(body);
      rows.appendChild(line);
    });
    det.appendChild(rows);

    if (g.note) {
      var note = UI.el('p', { class: 'brief__note' });
      note.innerHTML = g.note;
      det.appendChild(note);
    }

    if (g.bullets && g.bullets.length) {
      var ul = UI.el('ul', { class: 'brief__list' });
      g.bullets.forEach(function (b) {
        var li = UI.el('li', {});
        li.innerHTML = b;
        ul.appendChild(li);
      });
      det.appendChild(ul);
    }
  }

  /* ======================================================================
   * 流程阶段：三大区块互斥显示 + 顶部步骤条同步
   * --------------------------------------------------------------------
   * 原先这三个区块的显隐散落在 selectScene / startGame / finishGame / clearScene
   * 四处各写一遍，只要漏改一处，顶部的流程步骤条就会指错路。
   * 这里收成一个入口：显隐与步骤号由同一份数据决定，不可能不同步。
   * 值表示该区块的 hidden（true = 隐藏）。
   * ==================================================================== */
  var PHASE = {
    pick:   { setup: true,  stage: true,  report: true,  step: 1 },
    setup:  { setup: false, stage: true,  report: true,  step: 2 },
    play:   { setup: true,  stage: false, report: true,  step: 3 },
    report: { setup: false, stage: true,  report: false, step: 4 }
  };

  function showGamePhase(name) {
    var cfg = PHASE[name] || PHASE.pick;
    Object.keys(PHASE.pick).forEach(function (k) {
      if (k === 'step') { return; }
      var el = document.getElementById('game-' + k);
      if (el) { el.hidden = cfg[k]; }
    });
    updateSteps(cfg.step);
  }

  /**
   * 更新顶部的流程指引条：小于当前步的标记为"已完成"，当前步高亮。
   * 结算阶段同时展示参数面板（方便改参数再来一轮），故 report 与 setup 可共存。
   */
  function updateSteps(cur) {
    var bar = document.getElementById('game-steps');
    if (!bar) { return; }

    // 不传当前步时，直接由三大区块的显隐推导——步骤号永远与实际画面一致
    if (cur == null) {
      cur = 1;
      if (!document.getElementById('game-report').hidden) { cur = 4; }
      else if (!document.getElementById('game-stage').hidden) { cur = 3; }
      else if (!document.getElementById('game-setup').hidden) { cur = 2; }
    }

    Array.prototype.forEach.call(bar.children, function (li) {
      var n = parseInt(li.getAttribute('data-step'), 10);
      var on = n === cur;
      li.classList.toggle('is-current', on);
      li.classList.toggle('is-done', n < cur);
      if (on) { li.setAttribute('aria-current', 'step'); }
      else { li.removeAttribute('aria-current'); }
    });
  }

  function selectScene(key) {
    app.scene = key;
    var cfg = sceneModule(key).config;
    app.payoff = Object.assign({}, cfg.payoff);
    renderPicker();
    renderSetup();
    showGamePhase('setup');
  }

  /**
   * 取消场景选择：规则卡收起、三张选卡回到原位，设置面板一并隐藏。
   * 规则卡右上角的「换一个场景」与结算页的「换个场景」都走这里。
   */
  function clearScene() {
    app.scene = null;
    app.session = null;
    var guideBox = document.getElementById('stage-guide');
    if (guideBox) { guideBox.hidden = true; }
    renderPicker();   // 内部会调 renderSceneBrief()，把规则卡一并收起
    showGamePhase('pick');
  }

  function renderSetup() {
    if (!app.scene) { return; }
    var cfg = sceneModule(app.scene).config;
    var p = app.payoff || cfg.payoff;

    // 支付矩阵
    var box = document.getElementById('payoff-panel');
    UI.clear(box);
    var rows = [
      { k: 'hit', label: '击中收益', cls: 'hit' },
      { k: 'miss', label: '漏报损失', cls: 'miss' },
      { k: 'fa', label: '虚报损失', cls: 'fa' },
      { k: 'cr', label: '正确拒斥收益', cls: 'cr' }
    ];
    var grid = UI.el('div', { class: 'payoff__grid' });
    rows.forEach(function (r) {
      var input = UI.el('input', {
        type: 'number', value: String(p[r.k]), step: '1',
        'aria-label': r.label
      });
      input.addEventListener('change', function () {
        var v = parseFloat(input.value);
        if (isNaN(v)) { v = 0; }
        app.payoff[r.k] = v;
        updateOptimalHint();
      });
      grid.appendChild(UI.el('div', { class: 'payoff__item payoff__item--' + r.cls }, [
        UI.el('label', { text: r.label }),
        input
      ]));
    });

    box.appendChild(UI.el('p', { class: 'payoff__title', text: '支付矩阵（本场景的代价结构）' }));
    box.appendChild(UI.el('p', {
      class: 'payoff__sub',
      text: cfg.payoffNote + ' 你可以修改下列数值，观察"最优标准"如何随之移动。'
    }));
    box.appendChild(grid);

    var hint = UI.el('p', { class: 'setup__hint', id: 'optimal-hint', style: 'margin-top:11px' });
    box.appendChild(hint);

    updateOptimalHint();
    updateDiffHint();
    updatePriorHint();
  }

  function updateOptimalHint() {
    var hint = document.getElementById('optimal-hint');
    if (!hint || !app.payoff) { return; }
    var d = DIFFICULTY[app.diffIndex].d;
    var cOpt = SDT.optimalC(d, app.prior, app.payoff);
    var bOpt = SDT.optimalBeta(app.prior, app.payoff);

    var tone;
    if (cOpt < -0.12) { tone = '偏松'; }
    else if (cOpt > 0.12) { tone = '偏严'; }
    else { tone = '接近无偏'; }

    hint.textContent = '按当前先验概率 P(S)=' + app.prior.toFixed(2)
      + ' 与支付矩阵计算，理论最优标准为 C_opt = ' + SDT.fmt(cOpt, 3)
      + '（β_opt = ' + SDT.fmt(bOpt, 3) + '，即应当' + tone + '）。'
      + ' 这只是一个参照——实验结束后可以把你的实际 C 与它对比。';
  }

  function updateDiffHint() {
    var el = document.getElementById('diff-hint');
    var out = document.getElementById('diff-out');
    if (out) { out.textContent = DIFFICULTY[app.diffIndex].label; }
    if (el) { el.textContent = DIFFICULTY[app.diffIndex].hint; }
  }

  function updatePriorHint() {
    var el = document.getElementById('prior-hint');
    var out = document.getElementById('prior-out');
    if (out) { out.textContent = app.prior.toFixed(2); }
    if (el) {
      el.textContent = app.prior > 0.65
        ? '信号很常见。此时最优标准会下降——多说几次"有"反而更划算。'
        : app.prior < 0.35
          ? '信号很少见。此时最优标准会上升——不要轻易说"有"，否则虚报会很多。'
          : '先验概率居中，最优标准大致在无偏附近。';
    }
    updateOptimalHint();
  }

  function bindSetup() {
    var seg = document.getElementById('length-seg');
    if (seg) {
      Array.prototype.forEach.call(seg.querySelectorAll('.seg__btn'), function (b) {
        b.addEventListener('click', function () {
          app.nTrials = parseInt(b.getAttribute('data-len'), 10);
          Array.prototype.forEach.call(seg.querySelectorAll('.seg__btn'), function (x) {
            var on = x === b;
            x.classList.toggle('is-active', on);
            x.setAttribute('aria-checked', on ? 'true' : 'false');
          });
        });
      });
    }

    var pr = document.getElementById('prior-range');
    if (pr) {
      pr.addEventListener('input', function () {
        app.prior = parseFloat(pr.value);
        updatePriorHint();
      });
    }

    var dr = document.getElementById('diff-range');
    if (dr) {
      dr.addEventListener('input', function () {
        app.diffIndex = parseInt(dr.value, 10);
        updateDiffHint();
        updateOptimalHint();
      });
    }

    var reset = document.getElementById('btn-reset-setup');
    if (reset) {
      reset.addEventListener('click', function () {
        app.nTrials = 20;
        app.prior = 0.5;
        app.diffIndex = 2;
        if (pr) { pr.value = '0.5'; }
        if (dr) { dr.value = '2'; }
        Array.prototype.forEach.call(seg.querySelectorAll('.seg__btn'), function (x) {
          var on = x.getAttribute('data-len') === '20';
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        if (app.scene) {
          app.payoff = Object.assign({}, sceneModule(app.scene).config.payoff);
          renderSetup();
        }
        updatePriorHint();
        updateDiffHint();
      });
    }

    var start = document.getElementById('btn-start-game');
    if (start) { start.addEventListener('click', startGame); }
  }

  /* ======================================================================
   * 4. 游戏主循环
   * ==================================================================== */

  /**
   * 地址栏里的随机种子：`index.html?seed=20260923`
   * 写了就用它，于是同一组参数 + 同一个种子 = 完全相同的一批试次，
   * 写报告或复现别人的一轮数据时用得上；不写则每次随机。
   */
  function urlSeed() {
    try {
      var m = /[?&]seed=(\d+)/.exec(global.location.search || '');
      return m ? (parseInt(m[1], 10) >>> 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function startGame() {
    if (!app.scene) { return; }
    var mod = sceneModule(app.scene);
    var cfg = mod.config;
    var d = DIFFICULTY[app.diffIndex].d;

    var seed = urlSeed() || ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    var trials = SDT.generateTrials({ n: app.nTrials, prior: app.prior, d: d, seed: seed });

    var rng = SDT.makeRng(seed ^ 0x9e3779b9);
    trials.forEach(function (t) {
      t.visual = mod.evidenceToVisual(t.evidence, rng);
      t.sweepAngle = rng() * Math.PI * 2;
      t.gainLabel = (7.0 + rng() * 0.6).toFixed(1);
    });

    app.session = {
      scene: app.scene,
      sceneName: cfg.name,
      n: app.nTrials,
      prior: app.prior,
      d: d,
      difficulty: DIFFICULTY[app.diffIndex].label,
      payoff: Object.assign({}, app.payoff),
      seed: seed,
      trials: trials,
      index: 0,
      counts: { hit: 0, miss: 0, fa: 0, cr: 0 },
      log: [],
      waiting: false,
      startedAt: new Date()
    };

    showGamePhase('play');
    var stageBox = document.getElementById('game-stage');

    // 开局把舞台顶到粘性导航下面：画布和右侧的 Y / N 按钮一屏都在，
    // 不必先手动往下滑才能作答。
    global.requestAnimationFrame(function () {
      var rect = stageBox.getBoundingClientRect();
      var y = (global.scrollY || 0) + rect.top - 76;
      global.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    });

    // 初始化舞台 DOM（每次开局重建，避免残留状态）
    var body = document.getElementById('stage-body');
    UI.clear(body);
    var wrap = UI.el('div', { class: 'stage__canvas-wrap' });
    var canvas = UI.el('canvas', { id: 'trial-canvas', width: '1560', height: '900' });
    wrap.appendChild(canvas);
    body.appendChild(wrap);

    var legend = UI.el('div', { class: 'stage__legend' });
    legend.appendChild(UI.el('span', {}, [
      UI.el('i', { style: 'background:' + cfg.accentSoft }),
      document.createTextNode('信号：' + cfg.signalMeaning)
    ]));
    legend.appendChild(UI.el('span', {}, [
      UI.el('i', { style: 'background:#e4e9ee' }),
      document.createTextNode('噪音：' + cfg.noiseMeaning)
    ]));
    body.appendChild(legend);

    // 判读标准：开局前与整局中常驻，明确告诉玩家屏幕上的东西该怎么读
    renderGuide(cfg);

    // 按钮文案
    document.getElementById('btn-yes').innerHTML = '<kbd>Y</kbd> ' + cfg.yesLabel;
    document.getElementById('btn-no').innerHTML = '<kbd>N</kbd> ' + cfg.noLabel;
    document.getElementById('hud-total').textContent = String(app.nTrials);

    showTrial();
  }

  /**
   * 渲染「判读标准」说明条。
   * 后两个场景（法律 / 探伤）的证据是"强度渐变"而不是"有/无"，
   * 不先说清楚屏幕元素各代表什么、该看哪几处、怎么权衡，玩家只能瞎猜 —— 
   * 那样测出来的其实是"会不会读图"，而不是辨别力 d′。
   * 说明条不随试次隐藏，中途忘了可以随时低头看。
   */
  function renderGuide(cfg) {
    var box = document.getElementById('stage-guide');
    if (!box) { return; }
    UI.clear(box);

    var g = cfg.guide;
    if (!g) { box.hidden = true; return; }
    box.hidden = false;

    // 局内判读标准同样折叠：手机屏幕只有 390px 宽，这块说明能占掉大半个屏，
    // 玩家得先滑过它才够得着判定按钮。
    var det = collapsible('stage__guide-box', 'stage__guide-toggle',
      UI.el('strong', {}, [document.createTextNode(g.title)]));
    box.appendChild(det);

    var rows = UI.el('div', { class: 'stage__guide-rows' });
    (g.rows || []).forEach(function (r) {
      var line = UI.el('div', { class: 'stage__guide-row' });
      if (r.swatch) {
        line.appendChild(UI.el('span', { class: 'stage__guide-swatch', style: 'background:' + r.swatch }));
      }
      line.appendChild(UI.el('span', { class: 'stage__guide-key' }, [document.createTextNode(r.key)]));
      // 说明体里允许少量 <strong>，其余按纯文本处理
      var body = UI.el('span', {});
      body.innerHTML = r.text;
      line.appendChild(body);
      rows.appendChild(line);
    });
    det.appendChild(rows);

    if (g.note) {
      var note = UI.el('p', { class: 'stage__guide-note' });
      note.innerHTML = g.note;
      det.appendChild(note);
    }

    if (g.bullets && g.bullets.length) {
      var ul = UI.el('ul', { class: 'stage__guide-list' });
      g.bullets.forEach(function (b) {
        var li = UI.el('li', {});
        li.innerHTML = b;
        ul.appendChild(li);
      });
      det.appendChild(ul);
    }
  }

  /**
   * 折叠框工厂：手机屏幕上说明文字能占掉大半屏，两处说明（场景规则卡、局内判读标准）
   * 都用它包一层。桌面默认展开（竖向空间富余），触屏默认收起。
   * 提示文字只有「展开 / 收起」两个字，窄屏也不会换行。
   * @param {string} cls         容器类名，summary 为 cls + '__sum'
   * @param {string} labelCls    提示文字类名（触屏才显示）
   * @param {Node}   titleNode   标题节点
   */
  function collapsible(cls, labelCls, titleNode) {
    var det = UI.el('details', { class: cls });
    var openByDefault = !isTouchDevice();
    if (openByDefault) { det.setAttribute('open', ''); }

    var lab = UI.el('span', { class: labelCls, text: openByDefault ? '收起' : '展开' });
    det.appendChild(UI.el('summary', { class: cls + '__sum' }, [titleNode, lab]));
    det.addEventListener('toggle', function () {
      lab.textContent = det.open ? '收起' : '展开';
    });
    return det;
  }

  /** 触屏？与 CSS 的 (hover: none) and (pointer: coarse) 同一判据，只此一处 */
  function isTouchDevice() {
    var mq = coarsePointerQuery();
    return !!(mq && mq.matches);
  }

  function showTrial() {
    var s = app.session;
    if (!s) { return; }
    if (s.index >= s.n) { finishGame(); return; }

    var t = s.trials[s.index];

    updateHUD();
    renderTrialCanvas(t, 'show');

    var fb = document.getElementById('stage-feedback');
    fb.textContent = '';
    fb.className = 'stage__feedback';
    fb.removeAttribute('data-kind');

    // 先撤掉上一试次的状态条，等 beginIntro / endIntro 按本试次节奏重新设置
    setStatus('', '');

    var mod = sceneModule(s.scene);
    document.getElementById('stage-prompt').textContent = mod.config.prompt;

    s.showStart = performance.now();
    s.readyAt = null;
    s.introTimer = null;
    s.introDone = false;
    // 本试次是否真的播过"呈现动画"（雷达的转一圈）。没有动画的场景不该
    // 出现"屏幕已消隐"这类只对动画成立的提示 —— 见 endIntro()。
    s.introRan = false;
    s.minRtReached = false;

    // 有些场景（雷达）需要先把一段动画放完才轮到被试判断：
    //   这段时间里作答按钮是禁用的，由 beginIntro 负责呈现并在结束后开放作答。
    beginIntro(t);
  }

  /* ------------------------------------------------------------------
   * 试次前的"呈现动画"（目前只有雷达用：天线转一圈）
   * 动画放完之前不开放作答，避免被试在回波还没全部扫出来时就抢答。
   * ---------------------------------------------------------------- */
  function beginIntro(t) {
    var s = app.session;
    var mod = sceneModule(s.scene);
    var canvas = document.getElementById('trial-canvas');

    var ms = (mod.introDuration && mod.startIntro) ? mod.introDuration(t) : 0;
    if (ms <= 0) {
      // 本场景没有呈现动画（法律卷宗 / 探伤波形一出来就能看）：
      // 直接开放作答，并且不设状态条 —— 屏幕从来没有被清空过。
      s.introRan = false;
      endIntro();
      return;
    }

    s.introRan = true;
    s.waiting = false;
    setAnswersEnabled(false);
    setScanHint(true);
    setStatus('busy', mod.config.introBusy || '正在呈现…');

    if (mod.startIntro) {
      mod.startIntro(canvas, t, function () { endIntro(); });
    }

    // 兜底：标签页切到后台时 rAF 会暂停，用定时器保证一定能开放作答
    s.introTimer = global.setTimeout(function () {
      if (app.session === s && !s.introDone) { endIntro(); }
    }, ms + 80);
  }

  function endIntro() {
    var s = app.session;
    if (!s || s.introDone) { return; }
    s.introDone = true;

    if (s.introTimer) { global.clearTimeout(s.introTimer); s.introTimer = null; }

    var mod = sceneModule(s.scene);
    if (mod.stopIntro) { mod.stopIntro(); }

    s.waiting = true;
    setAnswersEnabled(true);
    setScanHint(false);
    // 判断阶段：只有真的播过"转一圈 → 熄屏"的场景才有这句话。
    // 法律 / 探伤的画面从头到尾没消隐过，出现"屏幕已消隐"只会让人以为是 bug。
    if (s.introRan) {
      setStatus('ready', mod.config.introReady || '可以作答了');
    }
    // 反应时从"可以作答"这一刻起算，扫描时间不计入
    s.readyAt = performance.now();
  }

  /**
   * 画布下方的状态条。放在画布之外而不是画在画布上——
   * 之前那行提示是画在荧光屏里的半透明绿字，既和底部方位刻度 180 叠在一起，
   * 又因为低对比度几乎读不出来。
   */
  function setStatus(tone, text) {
    var box = document.getElementById('stage-status');
    var txt = document.getElementById('stage-status-text');
    if (!box || !txt) { return; }
    if (!text) { box.hidden = true; txt.textContent = ''; return; }
    box.hidden = false;
    box.setAttribute('data-tone', tone || 'ready');
    txt.textContent = text;
  }

  function setAnswersEnabled(on) {
    document.getElementById('btn-yes').disabled = !on;
    document.getElementById('btn-no').disabled = !on;
  }

  /**
   * 扫描类控件（"正在扫描…" / "再看一圈"）只服务于带呈现动画的场景。
   * 法律 / 探伤没有这一段，整块容器直接收起 —— 否则会留下一块 30px 的空白。
   * 提示语本身取自场景 config（introBusy），不在 HTML 里再抄一遍，避免两处走词。
   */
  function setScanHint(scanning) {
    var s = app.session;
    var mod = s ? sceneModule(s.scene) : null;
    var canScan = !!(mod && mod.startIntro);   // 只有带扫描动画的场景才显示这几个控件
    var box = document.getElementById('stage-scan');
    var hint = document.getElementById('stage-scan-hint');
    var txt = document.getElementById('stage-scan-hint-text');
    var rescan = document.getElementById('btn-rescan');
    if (box) { box.hidden = !canScan; }
    if (hint) { hint.hidden = !(scanning && canScan); }
    if (txt && scanning && canScan) {
      txt.textContent = mod.config.introBusy || '正在呈现…';
    }
    if (rescan) { rescan.hidden = !(!scanning && canScan); }
  }

  function renderTrialCanvas(t, phase, resultKind) {
    var canvas = document.getElementById('trial-canvas');
    if (!canvas) { return; }
    var mod = sceneModule(app.session.scene);
    // phase: 'show' 判断前（雷达此时是空白待机屏）| 'feedback' 作答后（雷达回放真相）
    mod.render(canvas, t, phase === 'feedback' ? 'feedback' : 'show');
    if (phase === 'feedback' && resultKind) {
      mod.renderFeedbackOverlay(canvas, t, resultKind);
    }
  }

  function answer(saidYes) {
    var s = app.session;
    if (!s || !s.waiting) { return; }
    s.waiting = false;

    // 作答后锁住按钮，进入反馈
    document.getElementById('btn-yes').disabled = true;
    document.getElementById('btn-no').disabled = true;
    var scanBtn = document.getElementById('btn-rescan');
    if (scanBtn) { scanBtn.hidden = true; }
    setStatus('', '');   // 反馈阶段由画面里的结论条说明，状态条收起来

    var t = s.trials[s.index];
    var kind;

    // 玩家是"人"，不是模型：四种结果只由"真值 × 玩家回答"决定，
    // 不经过 SDT.classify（那是给"理想观察者自动作答"用的路径）。
    if (t.isSignal) {
      kind = saidYes ? 'hit' : 'miss';
    } else {
      kind = saidYes ? 'fa' : 'cr';
    }

    s.counts[kind] += 1;
    s.log.push({
      i: s.index + 1,
      isSignal: t.isSignal,
      saidYes: saidYes,
      evidence: t.evidence,
      kind: kind,
      // 反应时只算"画面准备好之后"的那段，场景自身的演示动画不计入
      rt: performance.now() - (s.readyAt || s.showStart || performance.now())
    });

    // 反馈
    var label = { hit: '击中', miss: '漏报', fa: '虚报', cr: '正确拒斥' }[kind];
    var fb = document.getElementById('stage-feedback');
    fb.textContent = label + '（' + (t.isSignal ? '本试次有信号' : '本试次只有噪音') + '）';
    fb.className = 'stage__feedback is-shown';
    fb.setAttribute('data-kind', kind);

    renderTrialCanvas(t, 'feedback', kind);
    updateHUD();

    var mod = sceneModule(s.scene);
    var delay = mod.config.timing.feedback || 650;
    global.setTimeout(function () {
      var ss = app.session;
      if (!ss) { return; }
      ss.index += 1;
      showTrial();
    }, delay);
  }

  function updateHUD() {
    var s = app.session;
    if (!s) { return; }
    document.getElementById('hud-trial').textContent = String(Math.min(s.index + 1, s.n));
    document.getElementById('hud-hit').textContent = String(s.counts.hit);
    document.getElementById('hud-miss').textContent = String(s.counts.miss);
    document.getElementById('hud-fa').textContent = String(s.counts.fa);
    document.getElementById('hud-cr').textContent = String(s.counts.cr);
    var pct = (s.index / s.n) * 100;
    document.getElementById('hud-bar').style.width = pct.toFixed(1) + '%';
  }

  function bindGameKeys() {
    document.addEventListener('keydown', function (e) {
      if (!app.session || document.getElementById('game-stage').hidden) { return; }
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { return; }

      // 演示动画还没放完：空格/回车跳过等待，直接进入判断
      if (!app.session.waiting) {
        if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
          var mIntro = sceneModule(app.session.scene);
          if (mIntro.skipIntro && mIntro.skipIntro()) { e.preventDefault(); }
        }
        return;
      }

      var k = e.key.toLowerCase();
      if (k === 'y' || e.key === 'ArrowUp') { answer(true); e.preventDefault(); }
      else if (k === 'n' || e.key === 'ArrowDown') { answer(false); e.preventDefault(); }
      else if (k === 'r') { replayIntro(); e.preventDefault(); }
    });

    document.getElementById('btn-yes').addEventListener('click', function () { answer(true); });
    document.getElementById('btn-no').addEventListener('click', function () { answer(false); });
    document.getElementById('btn-quit').addEventListener('click', function () {
      if (app.session) { finishGame(true); }
    });

    // 雷达：没看清可以再转一圈；扫描中可以按空格跳过
    var rescan = document.getElementById('btn-rescan');
    if (rescan) {
      rescan.addEventListener('click', function () { replayIntro(); });
    }
  }

  /* ======================================================================
   * 4.5 设备层：输入方式标记 + 视口变化重绘
   * ----------------------------------------------------------------------
   * 跨设备运行要处理三件"桌面端不存在"的事：
   *   ① 输入方式：手机上没有键盘，键盘提示要换说法（.is-touch + CSS 判定）
   *   ② 视口抖动：iOS 地址栏收起/展开、转屏、分屏都会触发 resize，
   *      不防抖会在一秒内重绘十几次；且多数时候宽度根本没变，不必重绘
   *   ③ 可视视口：键盘/缩放用的是 visualViewport，比 window 的 resize 更准
   * ------------------------------------------------------------------- */
  /** 粗指针（手机 / 平板 / 触屏本）查询，全局只有这一处字面量 */
  function coarsePointerQuery() {
    return global.matchMedia ? global.matchMedia('(hover: none) and (pointer: coarse)') : null;
  }

  function markInputMode() {
    var root = document.documentElement;
    var mq = coarsePointerQuery();
    var apply = function () { root.classList.toggle('is-touch', !!(mq && mq.matches)); };
    apply();
    // 二合一设备（可触屏的笔记本、接了鼠标的平板）会在使用中切换
    if (mq && mq.addEventListener) { mq.addEventListener('change', apply); }
    else if (mq && mq.addListener) { mq.addListener(apply); }
    return apply;
  }

  function bindViewportRedraw() {
    var timer = null;
    var lastKey = '';

    function key() {
      // 只有"真正影响布局"的量变了才重绘：宽 + DPR（跨屏拖窗口、浏览器缩放）
      // 高度变化被忽略——手机上地址栏一缩一放就会改高度，重绘纯属浪费。
      return global.innerWidth + '×' + ((global.devicePixelRatio || 1).toFixed(2));
    }

    function redraw() {
      if (app.route === 'home') { drawTeaser(); }
      else if (app.route === 'theory' && global.TheoryDemo) {
        // 理论页自己的 resize 监听会重绘；这里只在"跨屏导致 DPR 变化"时补一次，
        // 因为那种情况模块内只比较宽度、可能不触发。
        global.TheoryDemo.renderAll();
      }
    }

    function schedule() {
      var k = key();
      if (k === lastKey) { return; }
      lastKey = k;
      if (timer) { global.clearTimeout(timer); }
      timer = global.setTimeout(function () { timer = null; redraw(); }, 140);
    }

    lastKey = key();
    global.addEventListener('resize', schedule);
    // 转屏：老浏览器不派发 resize，必须单独监听
    global.addEventListener('orientationchange', function () {
      lastKey = '';           // 转屏必然换布局，强制走一次
      schedule();
    });
    if (global.visualViewport && global.visualViewport.addEventListener) {
      global.visualViewport.addEventListener('resize', schedule);
    }
  }

  /** 再看一圈：重放本试次的扫描动画，evidence 不变，不计入作答次数 */
  function replayIntro() {
    var s = app.session;
    if (!s || !s.waiting) { return; }
    var mod = sceneModule(s.scene);
    if (!mod.startIntro) { return; }
    var t = s.trials[s.index];

    s.waiting = false;
    s.introDone = false;
    s.introRan = true;      // 重放动画后，endIntro 仍应给出"已定格"提示
    setAnswersEnabled(false);
    setScanHint(true);
    setStatus('busy', mod.config.introReplayBusy || mod.config.introBusy || '正在重新呈现…');

    var canvas = document.getElementById('trial-canvas');
    mod.startIntro(canvas, t, function () { endIntro(); });

    if (s.introTimer) { global.clearTimeout(s.introTimer); }
    s.introTimer = global.setTimeout(function () {
      if (app.session === s && !s.introDone) { endIntro(); }
    }, (mod.introDuration ? mod.introDuration(t) : 0) + 80);
  }

  /* ======================================================================
   * 5. 结算报告
   * ==================================================================== */
  function finishGame(early) {
    var s = app.session;
    if (!s) { return; }
    s.waiting = false;
    s.endedAt = new Date();

    // 停掉可能还在跑的扫描动画，避免它往已经废弃的画布上继续画
    if (s.introTimer) { global.clearTimeout(s.introTimer); s.introTimer = null; }
    var prevMod = sceneModule(s.scene);
    if (prevMod && prevMod.stopIntro) { prevMod.stopIntro(); }

    var guideBox = document.getElementById('stage-guide');
    if (guideBox) { guideBox.hidden = true; }
    setStatus('', '');
    showGamePhase('setup');   // 先回到参数步骤；有作答时下面会再推进到结算步骤

    var answered = s.log.length;
    if (answered === 0) {
      // 一个试次都没答就不该出现空报表，停在参数页让玩家重来
      app.session = null;
      return;
    }

    var result = SDT.fromCounts(s.counts);
    s.result = result;

    renderReport(s, result, early);
    pushHistory(s, result, early);

    showGamePhase('report');
    document.getElementById('game-report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderReport(s, r, early) {
    var box = document.getElementById('game-report');
    UI.clear(box);
    var cfg = sceneModule(s.scene).config;

    /* ---------- 顶部横幅 ---------- */
    var banner = UI.el('div', { class: 'report__banner' }, [
      UI.el('div', {}, [
        UI.el('h3', { class: 'report__title', text: cfg.name + ' · 本轮实验结果' }),
        UI.el('p', {
          class: 'report__meta',
          html: '共 ' + r.trials + ' 试次'
            + (early ? '（提前结束）' : '')
            + '　·　P(S) = ' + s.prior.toFixed(2)
            + '　·　难度 ' + s.difficulty + '（理论 d′ = ' + SDT.fmt(s.d, 2) + '）'
            + '　·　随机种子 <code>' + s.seed + '</code>'
        })
      ]),
      UI.el('div', { class: 'report__actions' }, [
        UI.el('button', { class: 'btn btn--primary', text: '再玩一轮', onclick: function () { startGame(); } }),
        UI.el('button', {
          class: 'btn btn--ghost',
          text: '换个场景',
          onclick: function () { clearScene(); go('games'); }
        }),
        UI.el('button', { class: 'btn btn--ghost', text: '去理论页看解释', onclick: function () { go('theory'); } })
      ])
    ]);
    box.appendChild(banner);

    /* ---------- 一句话小结 ----------
       指标表有十几行，但玩家最先想知道的其实只有三件事：
       我看得准不准（实测 d′ vs 设定 d′）、我的松紧偏了吗（C vs C_opt）、
       以及为什么不能只看正确率。放在横幅下面，不用往下翻就能读到。
       ------------------------------------------------------------------ */
    var cOpt = SDT.optimalC(s.d, s.prior, s.payoff);
    var diffC = r.c - cOpt;
    var diffD = r.d - s.d;
    var biasWord = diffC > 0.05 ? '偏保守'
      : diffC < -0.05 ? '偏冒进'
        : '恰到好处';

    var verdict = UI.el('div', { class: 'report__verdict' }, [
      UI.el('p', { class: 'verdict__lead', text: '本轮小结' }),
      UI.el('div', { class: 'verdict__grid' }, [
        UI.el('div', { class: 'verdict__item' }, [
          UI.el('span', { class: 'verdict__k', text: '你的辨别力 d′' }),
          UI.el('span', { class: 'verdict__v', text: SDT.fmt(r.d, 2) }),
          UI.el('span', {
            class: 'verdict__sub',
            text: '设定 ' + SDT.fmt(s.d, 2) + '，差 '
              + (diffD >= 0 ? '+' : '') + SDT.fmt(diffD, 2)
          })
        ]),
        UI.el('div', { class: 'verdict__item' }, [
          UI.el('span', { class: 'verdict__k', text: '你的判断标准 C' }),
          UI.el('span', { class: 'verdict__v', text: (r.c > 0 ? '+' : '') + SDT.fmt(r.c, 2) }),
          UI.el('span', {
            class: 'verdict__sub',
            text: '理论最优 ' + SDT.fmt(cOpt, 2) + '，' + biasWord
          })
        ]),
        UI.el('div', { class: 'verdict__item' }, [
          UI.el('span', { class: 'verdict__k', text: '百分正确率' }),
          UI.el('span', { class: 'verdict__v', text: (r.accuracy * 100).toFixed(1) + '%' }),
          UI.el('span', { class: 'verdict__sub', text: '只看它会漏掉偏向' })
        ])
      ]),
      UI.el('p', {
        class: 'verdict__note',
        html: diffC > 0.05
          ? '你比理论最优更<strong>保守</strong>：宁可漏报，也不愿意虚报。'
            + '在这个场景的支付矩阵下，"该报有却没报"付出的代价可能比虚报更大。'
          : diffC < -0.05
            ? '你比理论最优更<strong>冒进</strong>：宁愿多报几次"有"。'
              + '虚报换来的少量收益，未必抵得上因此而增加的虚报损失。'
            : '你的松紧基本贴住理论最优标准 —— 先验概率与奖惩都被你用上了。'
      })
    ]);
    box.appendChild(verdict);

    /* ---------- 左：计数 + 指标 / 右：ROC ---------- */
    var grid = UI.el('div', { class: 'report__grid' });

    // 计数卡
    var countCard = UI.el('div', { class: 'card' });
    countCard.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '刺激—反应 2×2 计数' }),
      UI.el('span', { text: '行内两格之和 = 该行总试次' })
    ]));

    var cg = UI.el('div', { class: 'count-grid' });
    [
      { k: 'hit', label: '击中 Hit', n: r.counts.hit, base: r.nSignal },
      { k: 'miss', label: '漏报 Miss', n: r.counts.miss, base: r.nSignal },
      { k: 'fa', label: '虚报 False Alarm', n: r.counts.fa, base: r.nNoise },
      { k: 'cr', label: '正确拒斥 Corr. Rej.', n: r.counts.cr, base: r.nNoise }
    ].forEach(function (c) {
      cg.appendChild(UI.el('div', { class: 'count-tile count-tile--' + c.k }, [
        UI.el('span', { class: 'count-tile__label', text: c.label }),
        UI.el('span', { class: 'count-tile__val', text: String(c.n) }),
        UI.el('span', {
          class: 'count-tile__rate',
          text: c.base > 0 ? (c.n / c.base * 100).toFixed(1) + '% ／ ' + c.base + ' 次' : '—'
        })
      ]));
    });

    countCard.appendChild(UI.el('div', { class: 'card__body' }, [cg]));

    // 指标表
    var metricCard = UI.el('div', { class: 'card' });
    metricCard.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '信号检测论指标' })
    ]));

    var rows = [
      { k: '信号试次 / 噪音试次', v: r.nSignal + ' / ' + r.nNoise, unit: '' },
      { k: '击中率 P(Hit)', v: SDT.fmt(r.rawHit, 4), unit: '', primary: true },
      { k: '虚报率 P(FA)', v: SDT.fmt(r.rawFa, 4), unit: '', primary: true },
      { k: '漏报率 P(Miss) = 1 − P(Hit)', v: SDT.fmt(1 - r.rawHit, 4), unit: '' },
      { k: '正确拒斥 P(CR) = 1 − P(FA)', v: SDT.fmt(1 - r.rawFa, 4), unit: '' },
      { k: '辨别力 <i>d</i>′ = <i>Z</i>(Hit) − <i>Z</i>(FA)', v: SDT.fmt(r.d, 3), unit: '', primary: true },
      { k: '判断标准 <i>C</i> = −' + UI.frac('<i>Z</i>(Hit) + <i>Z</i>(FA)', '2', 'xs'),
        v: (r.c > 0 ? '+' : '') + SDT.fmt(r.c, 3), unit: '', primary: true },
      { k: '似然比 <i>β</i> = ' + UI.frac('<i>O</i>(SN)', '<i>O</i>(N)', 'xs'),
        v: SDT.fmt(r.beta, 3), unit: '', primary: true },
      { k: 'Z(Hit)', v: SDT.fmt(r.zHit, 3), unit: '' },
      { k: 'Z(FA)', v: SDT.fmt(r.zFa, 3), unit: '' },
      { k: '百分正确率', v: (r.accuracy * 100).toFixed(1), unit: '%' },
      { k: '理论 AUC = Φ' + UI.frac('<i>d</i>′', '√2', 'xs'), v: SDT.fmt(r.auc, 4), unit: '' }
    ];

    var table = UI.el('table', { class: 'metric-table' });
    var tb = UI.el('tbody');
    rows.forEach(function (x) {
      tb.appendChild(UI.el('tr', { class: x.primary ? 'is-primary' : '' }, [
        UI.el('th', { html: x.k }),
        UI.el('td', { html: x.v + (x.unit ? '<span class="unit">' + x.unit + '</span>' : '') })
      ]));
    });
    table.appendChild(tb);

    var notes = [];
    if (r.correctionApplied) {
      notes.push(UI.el('p', {
        class: 'metric-note metric-note--warn',
        html: '<strong>已启用极端值修正</strong>：本轮有比例为 0 或 1 的单元格，'
          + '直接取 Z 会得到 ±∞。这里采用 ' + UI.frac('<i>k</i> + 0.5', '<i>N</i> + 1', 'xs')
          + ' 修正后再换算指标，'
          + '因此 d′ 与 β 是有限估计值，稳定性低于常规情形。'
      }));
    }
    if (r.d < 0) {
      notes.push(UI.el('p', {
        class: 'metric-note metric-note--warn',
        html: '<strong>d′ 出现负值</strong>：意味着虚报率反而高于击中率，'
          + '在本轮试次中"信号"与"噪音"的作答方向是反的。'
          + '在 20 试次的短实验中，这通常是小样本波动；试次越多越不应出现。'
      }));
    }

    // C 与最优标准的对比（cOpt / diffC 已在上方小结中算出，此处复用）
    notes.push(UI.el('p', {
      class: 'metric-note',
      html: '<strong>你的标准 vs 理论最优标准</strong>：本轮实际 C = '
        + (r.c > 0 ? '+' : '') + SDT.fmt(r.c, 3)
        + '；按 P(S)=' + s.prior.toFixed(2) + ' 与支付矩阵计算的最优 C_opt = '
        + SDT.fmt(cOpt, 3) + '。'
        + '你比最优标准' + (diffC > 0.05 ? '更保守（更不愿意报"有"）' : (diffC < -0.05 ? '更冒进（更愿意报"有"）' : '基本一致'))
        + '。'
        + '<br>理论上，先验概率与奖惩只应影响 C，不应影响 d′——'
        + '这也是信号检测论相对传统阈限概念的关键优势。'
    }));

    metricCard.appendChild(UI.el('div', { class: 'card__body' }, [table].concat(notes)));

    var leftCol = UI.el('div', {}, [countCard, metricCard]);

    // ROC 卡
    var rocCard = UI.el('div', { class: 'card roc-card' });
    rocCard.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '本轮 ROC 曲线' }),
      UI.el('span', { text: '横轴 P(FA)，纵轴 P(Hit)' })
    ]));

    var rocWrap = UI.el('div', { class: 'roc-card__canvas' });
    var rocCanvas = UI.el('canvas', { id: 'report-roc', width: '1000', height: '900' });
    rocWrap.appendChild(rocCanvas);
    rocCard.appendChild(rocWrap);

    var rocFoot = UI.el('div', { class: 'roc-card__foot' });
    rocFoot.appendChild(UI.el('span', { class: 'chip chip--neutral', text: '实测点 (' + SDT.fmt(r.rawFa, 3) + ', ' + SDT.fmt(r.rawHit, 3) + ')' }));
    rocFoot.appendChild(UI.el('span', { class: 'chip chip--neutral', text: 'd′ 拟合曲线' }));
    rocFoot.appendChild(UI.el('span', { class: 'chip chip--neutral', text: 'AUC = ' + SDT.fmt(r.auc, 4) }));
    rocCard.appendChild(rocFoot);

    var rocNote = UI.el('p', {
      class: 'metric-note',
      style: 'margin:0 20px 18px',
      html: '单轮实验只能得到<strong>一个操作点</strong>，因此单点无法定义一条 ROC 曲线。'
        + '图中橙点是你的实测结果，曲线是<strong>用本轮 d′ 拟合出的理论曲线</strong>'
        + '（在等方差正态假设下，d′ 唯一决定整条曲线）。'
        + '若想让实验本身产出多个操作点，需要改用<strong>评价法</strong>：'
        + '用多个 C 跑多轮，或让被试给出多等级确信度。'
    });
    rocCard.appendChild(rocNote);

    grid.appendChild(leftCol);
    grid.appendChild(rocCard);
    box.appendChild(grid);

    /* ---------- 逐试次明细 ---------- */
    var logCard = UI.el('div', { class: 'card trial-log' });
    logCard.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '逐试次明细' }),
      UI.el('span', { text: '共 ' + s.log.length + ' 条记录' })
    ]));

    var scroll = UI.el('div', { class: 'trial-log__scroll' });
    var lt = UI.el('table');
    var thead = UI.el('thead', {}, [UI.el('tr', {}, [
      UI.el('th', { text: '#' }),
      UI.el('th', { text: '实际' }),
      UI.el('th', { text: '你的回答' }),
      UI.el('th', { text: '结果' }),
      UI.el('th', { text: '反应时' })
    ])]);
    var ltb = UI.el('tbody');
    s.log.forEach(function (g) {
      var label = { hit: '击中', miss: '漏报', fa: '虚报', cr: '正确拒斥' }[g.kind];
      ltb.appendChild(UI.el('tr', {}, [
        UI.el('td', { text: String(g.i) }),
        UI.el('td', { text: g.isSignal ? '有信号' : '仅噪音' }),
        UI.el('td', { text: g.saidYes ? '报"有"' : '报"无"' }),
        UI.el('td', { html: '<span class="trial-log__badge trial-log__badge--' + g.kind + '">' + label + '</span>' }),
        UI.el('td', { text: (g.rt / 1000).toFixed(2) + ' s' })
      ]));
    });
    lt.appendChild(thead);
    lt.appendChild(ltb);
    scroll.appendChild(lt);
    logCard.appendChild(scroll);
    box.appendChild(logCard);

    /* ---------- 历史对比 ----------
       这里只放"同场景最近几轮"的速览，完整表格、两两对比与导出都在「历史对比」视图。
       数据取自 localStorage（RunHistory），所以刷新后回来还看得到。
       ------------------------------------------------------------------ */
    var RH = global.RunHistory;
    var persisted = RH ? RH.load() : null;
    var mineSrc = persisted
      ? persisted.filter(function (x) { return x.scene === s.scene; })
      : app.history.filter(function (x) { return x.scene === s.scene; });
    var mine = mineSrc.slice(-6).reverse();   // 最近 6 轮，新的在上

    var histCard = UI.el('div', { class: 'card' });
    histCard.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '历史对比' }),
      UI.el('span', {
        text: '已保存 ' + (RH ? RH.count() : app.history.length) + ' 轮，其中本场景 ' + mineSrc.length + ' 轮'
      })
    ]));
    var hbody = UI.el('div', { class: 'card__body' });
    var hlist = UI.el('div', { class: 'history-list' });

    if (mine.length <= 1) {
      hlist.appendChild(UI.el('p', {
        class: 'empty-note',
        text: '这是本场景的第一轮。改一下先验概率或奖励设置再玩一轮，就能对照 d′ 稳不稳、判断标准有没有移动。'
      }));
    } else {
      mine.forEach(function (x) {
        var stamp = persisted
          ? RH.fmtTime(x.ts)
          : (x.time || '');
        var diffLabel = x.diffLabel || x.difficulty;
        hlist.appendChild(UI.el('div', { class: 'history-item' }, [
          UI.el('div', { class: 'history-item__name' }, [
            document.createTextNode(diffLabel + ' · ' + x.n + ' 试次'),
            UI.el('small', { text: 'P(S)=' + x.prior.toFixed(2) + '　' + stamp })
          ]),
          UI.el('div', { class: 'history-item__stat' }, [
            UI.el('b', { text: SDT.fmt(x.d, 2) }),
            UI.el('small', { text: "d′" })
          ]),
          UI.el('div', { class: 'history-item__stat' }, [
            UI.el('b', { text: (x.c > 0 ? '+' : '') + SDT.fmt(x.c, 2) }),
            UI.el('small', { text: 'C' })
          ]),
          UI.el('div', { class: 'history-item__stat' }, [
            UI.el('b', { text: SDT.fmt(x.beta, 2) }),
            UI.el('small', { text: 'β' })
          ])
        ]));
      });
    }
    hbody.appendChild(hlist);

    hbody.appendChild(UI.el('div', { class: 'runs-empty__actions' }, [
      UI.el('span', {
        class: 'runs-note',
        text: s.savedRun ? '本轮已存入历史对比（刷新也不会丢）。' : '本轮未能写入本地存储，仅在本会话内可见。'
      }),
      UI.el('button', {
        class: 'btn btn--ghost',
        text: '查看全部对比',
        onclick: function () { go('runs'); }
      })
    ]));

    histCard.appendChild(hbody);
    box.appendChild(histCard);

    /* ---------- 绘制 ROC ---------- */
    var needsDraw = function () {
      if (!document.getElementById('report-roc')) { return; }
      UI.drawROC({
        canvas: rocCanvas,
        d: r.d,
        c: 0,
        showFamily: true,
        zSpace: false,
        points: [{ fa: r.rawFa, hit: r.rawHit }]
      });
    };
    global.requestAnimationFrame(function () {
      global.requestAnimationFrame(needsDraw);
    });
  }

  function pushHistory(s, r, early) {
    // 内存里这份只服务结算页那一小段"同场景回顾"，刷新即丢；
    // 真正的长期存档交给 RunHistory（localStorage），两边各管一件事。
    app.history.push({
      scene: s.scene,
      n: r.trials,
      prior: s.prior,
      d: r.d,
      c: r.c,
      beta: r.beta,
      difficulty: s.difficulty,
      time: s.endedAt.toTimeString().slice(0, 8)
    });
    if (app.history.length > 40) { app.history.shift(); }

    if (global.RunHistory) {
      try {
        s.savedRun = global.RunHistory.save(s, r, early);
      } catch (e) {
        s.savedRun = null;   // 存档失败不该影响结算本身
      }
    }
  }

  /* ======================================================================
   * 6. 首页小图（N/SN 重叠示意）
   * ==================================================================== */
  function drawTeaser() {
    var canvas = document.getElementById('home-teaser-canvas');
    if (!canvas) { return; }
    UI.drawDistribution({
      canvas: canvas,
      d: 1.5,
      c: 0,
      showAreas: true
    });
  }

  /* ======================================================================
   * 启动
   * ==================================================================== */
  function boot() {
    bindRouting();
    bindSetup();
    bindGameKeys();
    markInputMode();        // 触屏设备去掉键盘提示，换成手指操作说法
    bindViewportRedraw();   // 转屏 / 跨屏 / 浏览器缩放后重绘画布

    renderHomeScenarios();
    renderFormulas();
    renderPicker();

    if (global.TheoryDemo) { global.TheoryDemo.init(); }

    global.requestAnimationFrame(function () {
      drawTeaser();
    });

    var build = document.getElementById('footer-build');
    if (build) {
      build.innerHTML = 'SDT 数学内核已通过 57 项数值自检 · 教材 P84 表可复现 · '
        + '<span class="formula-inline">AUC = Φ' + UI.frac('<i>d</i>′', '√2') + '</span>';
    }

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = {
    go: go,
    state: app,
    startGame: startGame
  };
}(typeof window !== 'undefined' ? window : globalThis));
