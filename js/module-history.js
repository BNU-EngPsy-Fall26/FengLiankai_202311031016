/*!
 * module-history.js —— 多轮实验结果的保存与对比
 * ---------------------------------------------------------------------------
 * 解决的事：玩家连玩几轮后，想知道「我这几轮到底有没有变准 / 我的标准有没有变松」，
 * 但原来 app.js 里的 app.history 只活在内存里，一刷新就没了，而且只在结算页角落里
 * 列一小段。这里把每一轮落盘到 localStorage，并给一个独立的对比视图。
 *
 * 对比围绕三件事（也是本页三列主角的由来）：
 *   1. 难度设定（理论 d′）—— 这一轮"题有多难"是怎么设的；
 *   2. 实测辨别力 d′ —— 你实际分辨得怎么样，与设定值差多少；
 *   3. 判断标准 C —— 你这一轮偏松还是偏紧，离理论最优判据 C_opt 差多少。
 *
 * 对外接口（挂在 window.RunHistory）：
 *   save(session, result, early)  记一轮（结算时由 app.js 调用）
 *   count() / load() / remove(id) / clear()
 *   render()                      重画 #runs-body（切到该视图时由 app.js 调用）
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var SDT = global.SDT;
  var UI = global.UI;

  var KEY = 'sdt_lab_runs_v1';
  var VERSION = 1;
  var MAX_RUNS = 200;        // localStorage 只有几 MB，一轮约 300 字节，200 轮足够且安全
  var MAX_COMPARE = 2;       // 并排对比最多两两比

  /* localStorage 在隐私模式 / 被禁用 / file:// 的个别浏览器里会抛异常，
     这时降级到内存数组：页面关掉就没了，但至少本会话内的对比功能不崩。 */
  var memoryFallback = null;
  var storageBroken = false;

  function canUseStorage() {
    if (storageBroken) { return false; }
    try {
      var t = '__sdt_probe__';
      global.localStorage.setItem(t, '1');
      global.localStorage.removeItem(t);
      return true;
    } catch (e) {
      storageBroken = true;
      return false;
    }
  }

  /** 读取全部轮次（新的在后） */
  function load() {
    if (!canUseStorage()) { return memoryFallback || []; }
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) { return []; }
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.runs)) { return []; }
      return data.runs.filter(isValidRun);
    } catch (e) {
      // 数据被别的东西写坏了：别让整页挂掉，当作空历史
      return [];
    }
  }

  function write(runs) {
    if (!canUseStorage()) { memoryFallback = runs; return false; }
    try {
      global.localStorage.setItem(KEY, JSON.stringify({ v: VERSION, runs: runs }));
      return true;
    } catch (e) {
      // 配额满了：砍掉最早的一半再试一次
      var half = runs.slice(Math.floor(runs.length / 2));
      try {
        global.localStorage.setItem(KEY, JSON.stringify({ v: VERSION, runs: half }));
        memoryFallback = half;
        return false;
      } catch (e2) {
        memoryFallback = half;
        return false;
      }
    }
  }

  function isValidRun(r) {
    return !!r && typeof r.ts === 'number'
      && typeof r.d === 'number' && isFinite(r.d)
      && typeof r.c === 'number' && isFinite(r.c);
  }

  /** 记一轮。session 来自 app.js 的 app.session，result 来自 SDT.fromCounts */
  function save(s, r, early) {
    if (!s || !r) { return null; }

    var cOpt = NaN;
    if (SDT && SDT.optimalC) {
      try { cOpt = SDT.optimalC(s.d, s.prior, s.payoff); } catch (e) { cOpt = NaN; }
    }

    var ended = s.endedAt || new Date();
    var started = s.startedAt || ended;

    var run = {
      v: VERSION,
      id: 'r' + ended.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: ended.getTime(),
      scene: s.scene,
      sceneName: s.sceneName || s.scene,
      diffLabel: s.difficulty,
      dTheory: s.d,
      prior: s.prior,
      n: r.trials || s.n,
      seed: s.seed,
      early: !!early,
      counts: {
        hit: r.counts.hit, miss: r.counts.miss, fa: r.counts.fa, cr: r.counts.cr
      },
      hit: r.hit, fa: r.fa,          // P(Hit)、P(FA)，已含 (k+0.5)/(N+1) 修正
      d: r.d, c: r.c, beta: r.beta,
      auc: r.auc, acc: r.accuracy,
      cOpt: cOpt,
      durMs: Math.max(0, ended - started)
    };

    var runs = load();
    runs.push(run);
    if (runs.length > MAX_RUNS) { runs = runs.slice(runs.length - MAX_RUNS); }
    write(runs);
    return run;
  }

  function remove(id) {
    var runs = load().filter(function (r) { return r.id !== id; });
    write(runs);
    // 选中态里也要摘掉，否则对比卡会残留一条已被删掉的轮次
    state.picked = state.picked.filter(function (p) { return p !== id; });
  }

  function clear() {
    write([]);
    state.picked = [];
  }

  function count() { return load().length; }

  /* ======================================================================
   * 视图状态（筛选 / 排序 / 选中）
   * ==================================================================== */
  var state = {
    scene: 'all',      // all | radar | legal | industrial
    n: 'all',          // all | 20 | 100
    sort: 'recent',    // recent | dDesc | cDesc | gapAsc
    picked: []         // 参与并排对比的 run id（最多 MAX_COMPARE 个）
  };

  var SCENE_LABELS = {
    radar: '雷达探测',
    legal: '法律证据',
    industrial: '工业探伤'
  };

  var SORTERS = {
    recent: function (a, b) { return b.ts - a.ts; },
    dDesc: function (a, b) { return b.d - a.d; },
    cDesc: function (a, b) { return b.c - a.c; },
    gapAsc: function (a, b) {
      return Math.abs(a.d - a.dTheory) - Math.abs(b.d - b.dTheory);
    }
  };

  function fmt(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) { return '—'; }
    return v.toFixed(digits === undefined ? 2 : digits);
  }

  function fmtSigned(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) { return '—'; }
    var s = v.toFixed(digits === undefined ? 2 : digits);
    return v > 0 ? '+' + s : s;
  }

  function fmtTime(ts) {
    var t = new Date(ts);
    var p = function (x) { return x < 10 ? '0' + x : String(x); };
    return (t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
  }

  function fmtDur(ms) {
    if (!isFinite(ms) || ms <= 0) { return '—'; }
    var s = Math.round(ms / 1000);
    if (s < 60) { return s + ' s'; }
    return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' s';
  }

  function visibleRuns() {
    var runs = load().slice();
    if (state.scene !== 'all') {
      runs = runs.filter(function (r) { return r.scene === state.scene; });
    }
    if (state.n !== 'all') {
      runs = runs.filter(function (r) { return String(r.n) === String(state.n); });
    }
    runs.sort(SORTERS[state.sort] || SORTERS.recent);
    return runs;
  }

  function togglePick(id) {
    var i = state.picked.indexOf(id);
    if (i >= 0) { state.picked.splice(i, 1); return; }
    state.picked.push(id);
    if (state.picked.length > MAX_COMPARE) { state.picked.shift(); }
  }

  /* ======================================================================
   * 渲染
   * ==================================================================== */
  function render() {
    var box = document.getElementById('runs-body');
    if (!box) { return; }
    UI.clear(box);

    var all = load();
    renderStats(box, all);

    if (all.length === 0) {
      renderEmpty(box);
      return;
    }

    renderToolbar(box);
    var runs = visibleRuns();
    if (runs.length === 0) {
      box.appendChild(UI.el('p', {
        class: 'empty-note',
        text: '当前筛选下没有轮次。把筛选调回「全部」试试。'
      }));
      return;
    }

    renderTable(box, runs);
    renderCompare(box);
  }

  /* ---------- 顶部：几句话概括全部轮次 ---------- */
  function renderStats(box, all) {
    var bar = UI.el('div', { class: 'runs-stats' });

    function stat(value, label, hint) {
      return UI.el('div', { class: 'runs-stat' }, [
        UI.el('b', { text: value }),
        UI.el('span', { text: label }),
        hint ? UI.el('small', { text: hint }) : null
      ]);
    }

    var dAvg = NaN, cAvg = NaN, gapAvg = NaN;
    if (all.length) {
      var sd = 0, sc = 0, sg = 0, k = 0;
      all.forEach(function (r) {
        sd += r.d; sc += r.c;
        if (isFinite(r.dTheory)) { sg += Math.abs(r.d - r.dTheory); }
        k++;
      });
      dAvg = sd / k; cAvg = sc / k; gapAvg = sg / k;
    }

    var scenes = {};
    all.forEach(function (r) { scenes[r.scene] = 1; });

    bar.appendChild(stat(String(all.length), '已保存轮次', all.length ? '刷新页面也不会丢' : '去玩一轮就会出现'));
    bar.appendChild(stat(String(Object.keys(scenes).length), '覆盖场景', '雷达 / 法律 / 工业'));
    bar.appendChild(stat(all.length ? fmt(dAvg) : '—', '实测 d′ 均值', '越高越能分辨'));
    bar.appendChild(stat(all.length ? fmtSigned(cAvg) : '—', '判断标准 C 均值', '负=偏松，正=偏紧'));
    bar.appendChild(stat(all.length ? fmt(gapAvg) : '—', '与设定难度平均偏差', '越小说明发挥越稳'));
    box.appendChild(bar);
  }

  /* ---------- 空态 ---------- */
  function renderEmpty(box) {
    var card = UI.el('div', { class: 'card' });
    card.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '还没有保存过任何一轮' }),
      UI.el('span', { text: '每轮结束都会自动存到这里' })
    ]));
    var body = UI.el('div', { class: 'card__body' }, [
      UI.el('p', {
        class: 'empty-note',
        text: '去「探测游戏」玩满一轮（哪怕只答几题再点结束本轮），这一轮的难度设定、实测辨别力 d′ 和判断标准 C 就会自动记录。'
      }),
      UI.el('div', { class: 'runs-empty__actions' }, [
        UI.el('button', {
          class: 'btn btn--primary',
          text: '去玩一轮',
          onclick: function () { if (global.App && global.App.go) { global.App.go('games'); } }
        }),
        UI.el('button', {
          class: 'btn btn--ghost',
          text: '先看理论演示',
          onclick: function () { if (global.App && global.App.go) { global.App.go('theory'); } }
        })
      ])
    ]);
    card.appendChild(body);
    box.appendChild(card);

    box.appendChild(UI.el('div', { class: 'card' }, [
      UI.el('div', { class: 'card__head' }, [
        UI.el('h3', { text: '存下来之后能做什么' })
      ]),
      UI.el('div', { class: 'card__body' }, [
        UI.el('ul', { class: 'runs-tips' }, [
          UI.el('li', {}, [
            UI.el('b', { text: '看稳定性：' }),
            document.createTextNode('同一难度连玩几轮，实测 d′ 应该在设定值附近小幅波动，而不是忽高忽低。')
          ]),
          UI.el('li', {}, [
            UI.el('b', { text: '看标准漂移：' }),
            document.createTextNode('改先验概率 P(S) 或奖励设置再玩一轮，C 会明显移动——这就是判断标准，和辨别力是两回事。')
          ]),
          UI.el('li', {}, [
            UI.el('b', { text: '两两对比：' }),
            document.createTextNode('勾选任意两轮，下方会并排列出 Δd′ 与 ΔC，并说明这一变化意味着什么。')
          ])
        ])
      ])
    ]));
  }

  /* ---------- 工具条：筛选 + 排序 + 导出 / 清空 ---------- */
  function renderToolbar(box) {
    var bar = UI.el('div', { class: 'runs-toolbar' });

    /* 场景筛选：复用 games 页的分段控件样式 */
    var sceneSeg = UI.el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '按场景筛选' });
    [['all', '全部场景'], ['radar', '雷达'], ['legal', '法律'], ['industrial', '工业']]
      .forEach(function (p) {
        var btn = UI.el('button', {
          class: 'seg__btn' + (state.scene === p[0] ? ' is-active' : ''),
          type: 'button',
          text: p[1],
          onclick: function () { state.scene = p[0]; render(); }
        });
        sceneSeg.appendChild(btn);
      });

    var nSeg = UI.el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '按试次数筛选' });
    [['all', '全部试次'], ['20', '20 试次'], ['100', '100 试次']].forEach(function (p) {
      nSeg.appendChild(UI.el('button', {
        class: 'seg__btn' + (state.n === p[0] ? ' is-active' : ''),
        type: 'button',
        text: p[1],
        onclick: function () { state.n = p[0]; render(); }
      }));
    });

    var sortSel = UI.el('select', {
      class: 'runs-sort',
      'aria-label': '排序方式',
      onchange: function (e) { state.sort = e.target.value; render(); }
    });
    [['recent', '按时间：最新在前'], ['dDesc', '按实测 d′：高到低'],
      ['cDesc', '按判断标准 C：高到低'], ['gapAsc', '按偏离设定：小到大']]
      .forEach(function (p) {
        var o = UI.el('option', { value: p[0], text: p[1] });
        if (state.sort === p[0]) { o.selected = true; }
        sortSel.appendChild(o);
      });

    bar.appendChild(UI.el('div', { class: 'runs-toolbar__group' }, [
      UI.el('label', { class: 'runs-toolbar__label', text: '场景' }),
      sceneSeg
    ]));
    bar.appendChild(UI.el('div', { class: 'runs-toolbar__group' }, [
      UI.el('label', { class: 'runs-toolbar__label', text: '试次' }),
      nSeg
    ]));
    bar.appendChild(UI.el('div', { class: 'runs-toolbar__group' }, [
      UI.el('label', { class: 'runs-toolbar__label', text: '排序' }),
      sortSel
    ]));

    bar.appendChild(UI.el('div', { class: 'runs-toolbar__actions' }, [
      UI.el('button', {
        class: 'btn btn--tiny btn--ghost',
        text: '导出 CSV',
        onclick: exportCsv
      }),
      UI.el('button', {
        class: 'btn btn--tiny btn--ghost runs-clear',
        text: '清空全部',
        onclick: function () {
          if (!load().length) { return; }
          var ok = global.confirm
            ? global.confirm('确定清空已保存的 ' + load().length + ' 轮记录？此操作不可撤销。')
            : true;
          if (ok) { clear(); render(); }
        }
      })
    ]));

    box.appendChild(bar);

    if (!canUseStorage()) {
      box.appendChild(UI.el('p', {
        class: 'runs-warn',
        text: '注意：当前浏览器不允许本地存储（可能是隐私模式），记录只保存在本次会话，关闭页面后会丢失。'
      }));
    }
  }

  /* ---------- 主表 ---------- */
  function renderTable(box, runs) {
    var card = UI.el('div', { class: 'card' });
    card.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '全部轮次' }),
      UI.el('span', { text: '勾选两轮可在下方并排对比；「偏差」= 实测 d′ − 该轮设定的理论 d′' })
    ]));

    var body = UI.el('div', { class: 'card__body' });
    // --fade：横向滚动时左右边缘渐隐，暗示"还有列在视口外"
    var scroll = UI.el('div', { class: 'table-scroll table-scroll--fade' });
    var table = UI.el('table', { class: 'runs-table' });

    var heads = [
      '', '时间', '场景', '难度设定', '理论 d′', 'P(S)', '试次',
      'P(Hit)', 'P(FA)', '实测 d′', '实测 C', 'β', '正确率', '偏差', ''
    ];
    var thead = UI.el('thead');
    var htr = UI.el('tr');
    heads.forEach(function (h, i) {
      var th = UI.el('th', { html: h || '&nbsp;' });
      if (i === 9 || i === 10) { th.className = 'is-key'; }   // 实测 d′ 与 C 是主角，加底色
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = UI.el('tbody');
    // 顺序完全交给排序器：默认 recent 已是"最新在上"，其余按所选字段排，
    // 这里不能再 reverse —— 否则选了"按 d′ 高到低"却看到低到高，排序形同虚设。
    runs.forEach(function (r) {
      var picked = state.picked.indexOf(r.id) >= 0;
      var gap = r.d - r.dTheory;
      var tr = UI.el('tr', { class: picked ? 'is-picked' : '' });

      var cb = UI.el('input', {
        type: 'checkbox',
        'aria-label': '选中这一轮用于对比',
        onchange: function () { togglePick(r.id); render(); }
      });
      cb.checked = picked;
      tr.appendChild(UI.el('td', { class: 'runs-table__pick' }, [cb]));

      tr.appendChild(UI.el('td', { class: 'runs-table__time', text: fmtTime(r.ts) }));
      tr.appendChild(UI.el('td', { text: SCENE_LABELS[r.scene] || r.sceneName || r.scene }));
      tr.appendChild(UI.el('td', {}, [
        UI.el('span', { class: 'runs-diff', text: r.diffLabel || '—' }),
        r.early ? UI.el('small', { class: 'runs-early', text: '提前结束' }) : null
      ]));
      tr.appendChild(UI.el('td', { text: fmt(r.dTheory) }));
      tr.appendChild(UI.el('td', { text: fmt(r.prior) }));
      tr.appendChild(UI.el('td', { text: String(r.n) }));
      tr.appendChild(UI.el('td', { text: fmt(r.hit, 3) }));
      tr.appendChild(UI.el('td', { text: fmt(r.fa, 3) }));
      tr.appendChild(UI.el('td', { class: 'is-key' }, [
        UI.el('b', { text: fmt(r.d) })
      ]));
      tr.appendChild(UI.el('td', { class: 'is-key' }, [
        UI.el('b', { text: fmtSigned(r.c) })
      ]));
      tr.appendChild(UI.el('td', { text: fmt(r.beta) }));
      tr.appendChild(UI.el('td', { text: fmt(r.acc, 3) }));

      var gapClass = Math.abs(gap) <= 0.3 ? 'is-good' : (Math.abs(gap) >= 0.8 ? 'is-bad' : '');
      tr.appendChild(UI.el('td', { class: 'runs-gap ' + gapClass, text: fmtSigned(gap) }));

      tr.appendChild(UI.el('td', { class: 'runs-table__del' }, [
        UI.el('button', {
          class: 'btn btn--tiny btn--ghost',
          type: 'button',
          text: '删除',
          'aria-label': '删除这一轮',
          onclick: function () { remove(r.id); render(); }
        })
      ]));

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    body.appendChild(scroll);
    // 手机上一张十几列的表必然要横滑，提示只在触屏出现（鼠标环境有滚动条就够了）
    body.appendChild(UI.el('p', {
      class: 'touch-only scroll-hint',
      text: '表格可左右滑动查看'
    }));
    body.appendChild(UI.el('p', {
      class: 'runs-note',
      text: 'd′ 与 C 都由这一轮实测的 P(Hit)、P(FA) 反推；极端比例（全对 / 全错）已按 (k+0.5)/(N+1) 修正，避免 Z 值发散。'
    }));
    card.appendChild(body);
    box.appendChild(card);
  }

  /* ---------- 并排对比 ---------- */
  function renderCompare(box) {
    var all = load();
    var runs = state.picked
      .map(function (id) { return all.filter(function (r) { return r.id === id; })[0]; })
      .filter(Boolean);

    var card = UI.el('div', { class: 'card' });
    card.appendChild(UI.el('div', { class: 'card__head' }, [
      UI.el('h3', { text: '并排对比' }),
      UI.el('span', {
        text: runs.length === MAX_COMPARE
          ? '已选 2 轮（再勾会替换掉较早的那一个）'
          : '在上方勾选 2 轮（当前 ' + runs.length + ' / 2）'
      })
    ]));

    var body = UI.el('div', { class: 'card__body' });

    if (runs.length < 2) {
      body.appendChild(UI.el('p', {
        class: 'empty-note',
        text: runs.length === 0
          ? '还没有勾选轮次。勾选两轮后这里会列出 Δd′ 与 ΔC。'
          : '再勾选一轮就能对比。建议挑一次难度相同的，看标准是否随先验或奖励移动。'
      }));
      card.appendChild(body);
      box.appendChild(card);
      return;
    }

    var a = runs[0], b = runs[1];
    var dd = b.d - a.d;
    var dc = b.c - a.c;
    var dbeta = isFinite(a.beta) && isFinite(b.beta) ? b.beta - a.beta : NaN;
    var dAcc = b.acc - a.acc;

    var rows = [
      { label: '结束时间', f: function (r) { return fmtTime(r.ts); } },
      { label: '场景', f: function (r) { return SCENE_LABELS[r.scene] || r.sceneName || r.scene; } },
      { label: '难度设定', f: function (r) { return (r.diffLabel || '—') + '（理论 d′ = ' + fmt(r.dTheory) + '）'; } },
      { label: '先验 P(S)', f: function (r) { return fmt(r.prior); } },
      { label: '试次数', f: function (r) { return String(r.n) + (r.early ? '（提前结束）' : ''); } },
      { label: '用时', f: function (r) { return fmtDur(r.durMs); } },
      { label: 'P(Hit) / P(FA)', f: function (r) { return fmt(r.hit, 3) + ' / ' + fmt(r.fa, 3); } },
      { label: '实测辨别力 d′', key: true, f: function (r) { return fmt(r.d); } },
      { label: '判断标准 C', key: true, f: function (r) { return fmtSigned(r.c); } },
      { label: '似然比 β', f: function (r) { return fmt(r.beta); } },
      { label: '正确率', f: function (r) { return fmt(r.acc, 3); } },
      { label: 'C 与最优判据之差', f: function (r) { return isFinite(r.cOpt) ? fmtSigned(r.c - r.cOpt) : '—'; } }
    ];

    var wrap = UI.el('div', { class: 'runs-compare' });

    function side(r, tag) {
      var col = UI.el('div', { class: 'runs-compare__col' });
      col.appendChild(UI.el('div', { class: 'runs-compare__tag', text: tag }));
      col.appendChild(UI.el('div', { class: 'runs-compare__meta', text: fmtTime(r.ts) + ' · ' + (SCENE_LABELS[r.scene] || r.scene) }));
      var dl = UI.el('dl', { class: 'runs-compare__list' });
      rows.forEach(function (row) {
        dl.appendChild(UI.el('div', { class: 'runs-compare__row' + (row.key ? ' is-key' : '') }, [
          UI.el('dt', { text: row.label }),
          UI.el('dd', { text: row.f(r) })
        ]));
      });
      col.appendChild(dl);
      return col;
    }

    wrap.appendChild(side(a, 'A 轮'));
    wrap.appendChild(side(b, 'B 轮'));
    body.appendChild(wrap);

    /* 差值与解读 */
    var diffBox = UI.el('div', { class: 'runs-delta' });
    function delta(label, v, digits, unit) {
      var cls = Math.abs(v) < 0.05 ? 'is-flat' : (v > 0 ? 'is-up' : 'is-down');
      return UI.el('div', { class: 'runs-delta__item ' + cls }, [
        UI.el('span', { class: 'runs-delta__label', text: label }),
        UI.el('b', { text: (v > 0 ? '+' : '') + v.toFixed(digits === undefined ? 2 : digits) + (unit || '') })
      ]);
    }
    diffBox.appendChild(UI.el('h4', { text: 'B 轮相对 A 轮' }));
    var items = UI.el('div', { class: 'runs-delta__grid' });
    items.appendChild(delta('Δ 实测 d′', dd));
    items.appendChild(delta('Δ 判断标准 C', dc));
    if (isFinite(dbeta)) { items.appendChild(delta('Δ β', dbeta)); }
    items.appendChild(delta('Δ 正确率', dAcc, 3));
    diffBox.appendChild(items);

    diffBox.appendChild(UI.el('p', { class: 'runs-delta__note', html: interpret(a, b, dd, dc) }));
    body.appendChild(diffBox);

    body.appendChild(UI.el('div', { class: 'runs-compare__actions' }, [
      UI.el('button', {
        class: 'btn btn--tiny btn--ghost',
        text: '取消选择',
        onclick: function () { state.picked = []; render(); }
      })
    ]));

    card.appendChild(body);
    box.appendChild(card);
  }

  /** 把 Δd′ 与 ΔC 翻译成一句人话——两个数分别对应"能力"和"松紧"，别混在一起说 */
  function interpret(a, b, dd, dc) {
    var parts = [];

    if (Math.abs(dd) < 0.15) {
      parts.push('两轮的<b>辨别力几乎没变</b>（Δd′ = ' + fmtSigned(dd) + '），说明你分辨信号的能力基本稳定；');
    } else if (dd > 0) {
      parts.push('B 轮<b>辨别力更高</b>（Δd′ = ' + fmtSigned(dd) + '）：要么这轮难度更低（设定 d′ 由 ' +
        fmt(a.dTheory) + ' 变成 ' + fmt(b.dTheory) + '），要么你确实看得更准；');
    } else {
      parts.push('B 轮<b>辨别力更低</b>（Δd′ = ' + fmtSigned(dd) + '）：先看是不是难度提高了（设定 d′ 由 ' +
        fmt(a.dTheory) + ' 变成 ' + fmt(b.dTheory) + '）；若设定相同，多半只是抽样波动，20 试次尤其明显；');
    }

    if (Math.abs(dc) < 0.1) {
      parts.push('<b>判断标准基本没动</b>（ΔC = ' + fmtSigned(dc) + '），你的松紧程度保持一致。');
    } else if (dc < 0) {
      parts.push('<b>标准变松了</b>（ΔC = ' + fmtSigned(dc) + '，C 越小越倾向报"有"）：先验 P(S) 由 ' +
        fmt(a.prior) + ' 变成 ' + fmt(b.prior) + '，或奖励设置变了，都会让你更愿意说"有"。');
    } else {
      parts.push('<b>标准变紧了</b>（ΔC = ' + fmtSigned(dc) + '，C 越大越倾向报"无"）：先验 P(S) 由 ' +
        fmt(a.prior) + ' 变成 ' + fmt(b.prior) + '，或虚报代价提高了，都会让你更谨慎。');
    }

    if (Math.abs(dd) >= 0.15 && Math.abs(dc) >= 0.1) {
      parts.push('两者同时变化，正是信号检测论要分开看的两件事：<b>d′ 是能力，C 是态度</b>，正确率一个数字说不清。');
    }
    return parts.join(' ');
  }

  /* ======================================================================
   * 导出 CSV
   * ==================================================================== */
  function exportCsv() {
    var runs = load();
    if (!runs.length) { return; }

    var head = ['序号', '结束时间', '场景', '难度设定', '理论d′', 'P(S)', '试次数',
      '击中', '漏报', '虚报', '正确拒斥', 'P(Hit)', 'P(FA)', '实测d′', '判断标准C',
      'β', 'AUC', '正确率', 'C-最优判据', '用时秒', '是否提前结束'];

    var lines = [head.join(',')];
    runs.forEach(function (r, i) {
      lines.push([
        i + 1,
        fmtTime(r.ts),
        SCENE_LABELS[r.scene] || r.scene,
        r.diffLabel || '',
        fmt(r.dTheory),
        fmt(r.prior),
        r.n,
        r.counts.hit, r.counts.miss, r.counts.fa, r.counts.cr,
        fmt(r.hit, 4), fmt(r.fa, 4),
        fmt(r.d, 4), fmt(r.c, 4), fmt(r.beta, 4), fmt(r.auc, 4), fmt(r.acc, 4),
        isFinite(r.cOpt) ? fmt(r.c - r.cOpt, 4) : '',
        Math.round((r.durMs || 0) / 1000),
        r.early ? '是' : '否'
      ].join(','));
    });

    // 前导 BOM：不加的话 Excel 打开中文会乱码
    var blob = new global.Blob(['\ufeff' + lines.join('\r\n')],
      { type: 'text/csv;charset=utf-8;' });

    try {
      var url = global.URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      var p = function (x) { return x < 10 ? '0' + x : String(x); };
      a.href = url;
      a.download = 'sdt-runs-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
        + '-' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      // 个别环境（无头测试、某些内嵌浏览器）没有 createObjectURL：
      // 至少把数据打到控制台，不至于什么都没发生
      try { global.console && console.log(lines.join('\n')); } catch (e2) { /* 无妨 */ }
    }
  }

  /* ======================================================================
   * 对外接口
   * ==================================================================== */
  global.RunHistory = {
    KEY: KEY,
    MAX_RUNS: MAX_RUNS,
    save: save,
    load: load,
    count: count,
    remove: remove,
    clear: clear,
    render: render,
    exportCsv: exportCsv,
    /* 结算页用：最近若干轮（新的在前），供"本场景历史"那一小段复用 */
    recent: function (k) {
      var runs = load().slice().sort(SORTERS.recent);
      return k ? runs.slice(0, k) : runs;
    },
    /* 结算页用：某一场景之前已存了几轮（不含刚存进去的这一轮也无所谓，调用方自己判断） */
    countByScene: function (scene) {
      return load().filter(function (r) { return r.scene === scene; }).length;
    },
    canUseStorage: canUseStorage,
    /* 给结算页复用，避免那边再写一遍时间/正负号格式化 */
    fmtTime: fmtTime,
    fmtSigned: fmtSigned
  };
}(typeof window !== 'undefined' ? window : globalThis));
