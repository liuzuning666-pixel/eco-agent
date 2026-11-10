/* ===========================================================
   青绿思享 · 界面逻辑
   =========================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var E = window.Engine;

  var LS = {
    history: 'qlsx.history.v1',
    settings: 'qlsx.settings.v1',
    quiz: 'qlsx.quizlog.v1',
    report: 'qlsx.report.v1'
  };

  var state = {
    view: 'home',
    history: load(LS.history, []),
    settings: load(LS.settings, { useLLM: false, base: '', model: '', key: '' }),
    quizLog: load(LS.quiz, []),
    quiz: null,
    lastAnswer: null,
    asked: 0,
    hitSet: {}
  };

  function load(k, d) {
    try {
      var v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) { return d; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ---------------- 路由 ---------------- */
  function go(view) {
    state.view = view;
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'quiz' && !state.quiz) renderQuizIntro();
    if (view === 'settings') renderSettings();
    if (view === 'kb') renderKB();
    if (view === 'topics') renderTopics();
    if (view === 'cases') renderCases();
    if (view === 'timeline') renderTimeline();
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var q = E.QUOTES[Math.floor(Math.random() * E.QUOTES.length)];
    $('#heroQuote').innerHTML = '“' + E.esc(q.t) + '”<span>—— ' + E.esc(q.f) + '</span>';

    var s = E.stats();
    $('#stats').innerHTML = [
      { n: s.kb, l: '知识条目' },
      { n: s.topics, l: '学习专题' },
      { n: s.cases, l: '实践案例' },
      { n: s.quiz, l: '测验题' }
    ].map(function (x) {
      return '<div class="stat"><div class="n">' + x.n + '</div><div class="l">' + x.l + '</div></div>';
    }).join('');

    var modes = [
      { ico: '📖', t: '概念问答', d: '两山理念、生态产品、双碳、法典，一句话说清，再给要点和出处。', go: 'chat', q: '两山理念的三层意思是什么？' },
      { ico: '🧭', t: '学习专题', d: '八个专题，按“核心问题—关键概念—案例—常见误解”组织。', go: 'topics' },
      { ico: '🏞️', t: '案例拆解', d: '余村、塞罕坝、八步沙、库布其，按“做法—机制—成效—局限”拆开讲。', go: 'cases' },
      { ico: '✅', t: '随堂测验', d: '随机 5 题，答完给解析，错题进学习报告。', go: 'quiz' },
      { ico: '🗂️', t: '讲解提纲', d: '输入主题和时长，生成带时间分配、能直接照着讲的提纲。', go: 'outline' },
      { ico: '🕒', t: '政策时间线', d: '从 2005 年余村到 2026 年法典，一条线串起二十年。', go: 'timeline' }
    ];
    $('#modeGrid').innerHTML = modes.map(function (m, i) {
      return '<button class="mode" data-mode="' + i + '"><div class="ico">' + m.ico + '</div><h4>' + m.t + '</h4><p>' + m.d + '</p></button>';
    }).join('');
    $$('#modeGrid .mode').forEach(function (el) {
      var m = modes[Number(el.dataset.mode)];
      el.addEventListener('click', function () {
        go(m.go);
        if (m.q) setTimeout(function () { ask(m.q); }, 260);
      });
    });

    var asks = [
      '两山理念的三层意思是什么？',
      '什么是生态产品价值实现？',
      '碳达峰和碳中和是什么关系？',
      '生态环境法典为什么被称为“法典化”？',
      '荒漠化治理有哪些中国经验？',
      '为什么说良好生态环境是最普惠的民生福祉？',
      '个人低碳生活有意义吗？',
      '中国在全球生态治理中扮演什么角色？'
    ];
    $('#homeAsks').innerHTML = asks.map(function (a) {
      return '<button class="ask" data-ask="' + E.esc(a) + '">' + E.esc(a) + '</button>';
    }).join('');
    $$('#homeAsks .ask').forEach(function (el) {
      el.addEventListener('click', function () {
        go('chat');
        setTimeout(function () { ask(el.dataset.ask); }, 200);
      });
    });
  }

  /* ---------------- 对话 ---------------- */
  function initChat() {
    $('#chatChips').innerHTML = [
      '两山理念是什么',
      '生态环境法典的核心内容',
      '塞罕坝的启示',
      '双碳目标的时间表',
      '什么是生态保护红线'
    ].map(function (q) {
      return '<button class="chip" data-ask="' + E.esc(q) + '">' + E.esc(q) + '</button>';
    }).join('');
    $$('#chatChips .chip').forEach(function (c) {
      c.addEventListener('click', function () { ask(c.dataset.ask); });
    });

    var input = $('#chatInput');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(140, input.scrollHeight) + 'px';
    });
    $('#sendBtn').addEventListener('click', sendFromInput);
    $('#exportChat').addEventListener('click', exportChat);

    // 恢复上一次对话
    if (state.history.length) {
      state.history.forEach(function (m) {
        if (m.role === 'user') appendUser(m.text, false);
        else appendBot(m.answer, false);
      });
      scrollChat();
    } else {
      appendBot({
        html: '<div class="lead"><b>你好，我是青绿思享。</b>一个关于生态文明的学习智能体。</div>' +
          '<p>可以问我概念（“两山理念是什么”）、让我拆案例（“余村怎么转型的”）、帮你出测验、列讲解提纲，或者查政策时间线。</p>' +
          '<p>也可以像聊天一样：先说“你好”，再问“举个例子”“展开说说”，我会接着上文讲。</p>' +
          '<p class="muted small">回答全部来自内置的 ' + E.KB.length + ' 条知识，每一条都标了出处。超出范围时，我会直接说“不在我的范围里”。</p>',
        steps: null
      }, false);
    }
  }

  function sendFromInput() {
    var input = $('#chatInput');
    var v = input.value.trim();
    if (!v) return;
    input.value = '';
    input.style.height = 'auto';
    ask(v);
  }

  function ask(q) {
    q = String(q || '').trim();
    if (!q) return;
    go('chat');
    appendUser(q, true);
    state.history.push({ role: 'user', text: q, t: Date.now() });
    trimHistory();
    save(LS.history, state.history);

    var typing = appendTyping();
    scrollChat();

    var started = Date.now();
    var useLLM = state.settings.useLLM && state.settings.key && state.settings.base && state.settings.model;
    if (!useLLM) {
      window.setTimeout(function () {
        typing.remove();
        var a = E.answer(q);
        finishAnswer(q, a, started, 'local');
      }, 220);
      return;
    }

    var local = E.answer(q);
    var ctx = (local.hits || []).slice(0, 3).map(function (h) { return h.e; });
    callLLM(q, ctx).then(function (text) {
      typing.remove();
      finishLLM(q, local, text, started);
    }).catch(function (err) {
      typing.remove();
      var a = E.answer(q);
      a.steps = (a.steps || []).concat([{ k: '降级', v: '大模型接口调用失败（' + (err && err.message ? err.message : '网络错误') + '），已切回本地知识库回答' }]);
      finishAnswer(q, a, started, 'local');
    });
  }

  function finishAnswer(q, a, started, mode) {
    if (!a) return;
    state.asked++;
    (a.hits || []).forEach(function (h) { state.hitSet[h.e.id] = true; });
    state.lastAnswer = a;
    var payload = {
      html: a.html,
      steps: a.steps,
      ms: Date.now() - started,
      mode: mode,
      intent: a.intent && a.intent.label,
      primaryId: a.primary && a.primary.id
    };
    appendBot(payload, true);
    state.history.push({ role: 'bot', answer: payload, t: Date.now() });
    trimHistory();
    save(LS.history, state.history);
    updateSessionStats();
    updateFollowUps(a);
    updateCtxBar();
    scrollChat();
  }

  function finishLLM(q, local, text, started) {
    var html = '<div class="lead"><b>大模型增强回答</b>（依据仍来自知识库）</div>' +
      '<p class="llm-text">' + E.esc(text).replace(/\n{2,}/g, '</p><p class="llm-text">').replace(/\n/g, '<br>') + '</p>' +
      '<h4>依据</h4><ul>' + (local.hits || []).slice(0, 3).map(function (h) {
        return '<li><b>' + E.esc(h.e.title) + '</b>：' + E.esc(h.e.source || '') + '</li>';
      }).join('') + '</ul>' +
      '<div class="chips">' + (local.hits || []).slice(0, 3).map(function (h) {
        return '<span class="chip" data-entry="' + E.esc(h.e.id) + '">' + E.esc(h.e.title) + '</span>';
      }).join('') + '</div>' +
      '<div class="meta"><span>模式：本地检索 + 大模型润色</span><span>条目：' + E.esc((local.primary && local.primary.title) || '') + '</span></div>';
    var payload = { html: html, steps: local.steps, ms: Date.now() - started, mode: 'llm', primaryId: local.primary && local.primary.id };
    appendBot(payload, true);
    state.history.push({ role: 'bot', answer: payload, t: Date.now() });
    trimHistory();
    save(LS.history, state.history);
    updateSessionStats();
    updateFollowUps(local);
    updateCtxBar();
    scrollChat();
  }

  function trimHistory() {
    if (state.history.length > 60) state.history = state.history.slice(-60);
  }

  function appendUser(text, animate) {
    var log = $('#chatLog');
    var el = document.createElement('div');
    el.className = 'msg user';
    if (animate) el.style.animation = 'fade .2s ease';
    el.innerHTML = '<div class="avatar">我</div><div class="bubble">' + E.esc(text).replace(/\n/g, '<br>') + '</div>';
    log.appendChild(el);
    return el;
  }

  function appendBot(payload, animate) {
    var log = $('#chatLog');
    var el = document.createElement('div');
    el.className = 'msg bot';
    if (animate) el.style.animation = 'fade .25s ease';
    var trace = '';
    if (payload.steps && payload.steps.length) {
      trace = '<details class="trace"><summary>推理过程 · ' + payload.steps.length + ' 步' +
        (payload.ms != null ? ' · ' + payload.ms + ' ms' : '') + '</summary><ol>' +
        payload.steps.map(function (s) {
          return '<li><span class="k">' + E.esc(s.k) + '</span>　' + E.esc(s.v) + '</li>';
        }).join('') + '</ol></details>';
    }
    el.innerHTML = '<div class="avatar">青</div><div class="bubble">' + payload.html + trace + '</div>';
    log.appendChild(el);
    bindEntryChips(el);
    return el;
  }

  function appendTyping() {
    var log = $('#chatLog');
    var el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = '<div class="avatar">青</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span> <span class="muted small">正在检索知识库…</span></div>';
    log.appendChild(el);
    return el;
  }

  function bindEntryChips(root) {
    $$('.chip[data-entry]', root || document).forEach(function (c) {
      if (c.dataset.bound) return;
      c.dataset.bound = '1';
      c.addEventListener('click', function () { openEntry(c.dataset.entry); });
    });
  }

  function scrollChat() {
    var log = $('#chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function updateCtxBar() {
    var bar = $('#ctxBar');
    if (!bar) return;
    var c = E.getContext ? E.getContext() : null;
    if (!c) {
      bar.className = 'ctx';
      bar.innerHTML = '';
      return;
    }
    bar.className = 'ctx on';
    bar.innerHTML = '<span>正在聊：' + E.esc(c.title) + '</span><button id="ctxClear" title="清空上下文" aria-label="清空上下文">×</button>';
    var btn = $('#ctxClear');
    if (btn) btn.addEventListener('click', function () {
      E.clearContext();
      updateCtxBar();
    });
  }

  function updateSessionStats() {
    var s = E.stats();
    var correct = state.quizLog.filter(function (x) { return x.ok; }).length;
    var total = state.quizLog.length;
    var rate = total ? Math.round(correct / total * 100) + '%' : '—';
    $('#sessionStats').innerHTML =
      '<div><b>' + state.asked + '</b>提问</div>' +
      '<div><b>' + Object.keys(state.hitSet).length + '</b>覆盖条目</div>' +
      '<div><b>' + total + '</b>答题</div>' +
      '<div><b>' + rate + '</b>正确率</div>';
  }

  function updateFollowUps(a) {
    var list = [];
    if (a && a.primary) {
      (a.primary.related || []).forEach(function (id) {
        var e = E.byId(id);
        if (e && list.length < 3) list.push(e.title + '是什么？');
      });
    }
    ['生态环境法典的核心内容', '“双碳”目标的时间表', '塞罕坝的启示'].forEach(function (q) {
      if (list.length < 4) list.push(q);
    });
    $('#followUps').innerHTML = list.map(function (q) {
      return '<button data-ask="' + E.esc(q) + '">' + E.esc(q) + '</button>';
    }).join('');
    $$('#followUps button').forEach(function (b) {
      b.addEventListener('click', function () { ask(b.dataset.ask); });
    });
  }

  function exportChat() {
    if (!state.history.length) return alert('还没有对话内容。');
    var lines = ['青绿思享 · 学习对话记录', '导出时间：' + new Date().toLocaleString('zh-CN'), ''];
    state.history.forEach(function (m) {
      if (m.role === 'user') lines.push('【我】' + m.text);
      else lines.push('【青绿思享】' + htmlToText(m.answer.html));
      lines.push('');
    });
    download('青绿思享-对话记录.txt', lines.join('\n'));
  }

  function htmlToText(h) {
    var d = document.createElement('div');
    d.innerHTML = h || '';
    $$('li', d).forEach(function (li) { li.insertAdjacentHTML('afterbegin', '· '); });
    $$('h4', d).forEach(function (h4) { h4.insertAdjacentHTML('beforebegin', '\n'); });
    return d.innerText.replace(/\n{3,}/g, '\n\n').trim();
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* ---------------- 大模型 ---------------- */
  function callLLM(q, ctxEntries) {
    var s = state.settings;
    var sys = '你是生态文明主题的学习助手，只回答生态文明相关内容。' +
      '必须严格依据用户提供的资料作答，不得编造条文、数字和事件；资料不足时明确说“知识库没有覆盖”。' +
      '回答用中文，分点，简洁，最后用一行注明依据来自哪份材料。';
    var ctx = (ctxEntries || []).map(function (e) {
      return '【' + e.title + '】' + e.summary + '\n' + (e.points || []).join('\n') + '\n出处：' + (e.source || '');
    }).join('\n\n');
    var body = {
      model: s.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '资料：\n' + ctx + '\n\n问题：' + q }
      ]
    };
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
    return fetch(s.base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!t) throw new Error('返回格式异常');
      return t.trim();
    });
  }

  /* ---------------- 知识库 ---------------- */
  var kbCat = '全部';
  function renderKB() {
    var cats = ['全部'].concat(E.stats().cats ? Object.keys(E.stats().cats) : []);
    $('#kbCats').innerHTML = cats.map(function (c) {
      return '<button data-cat="' + E.esc(c) + '" class="' + (c === kbCat ? 'on' : '') + '">' + E.esc(c) + '</button>';
    }).join('');
    $$('#kbCats button').forEach(function (b) {
      b.addEventListener('click', function () { kbCat = b.dataset.cat; renderKB(); });
    });
    var kw = ($('#kbSearch').value || '').trim();
    var list = E.KB.filter(function (e) {
      if (kbCat !== '全部' && e.cat !== kbCat) return false;
      if (!kw) return true;
      var hay = E.stripPunct(e.title + e.summary + (e.tags || []).join('') + (e.points || []).join('')).toLowerCase();
      return E.stripPunct(kw).toLowerCase().split('').every(function (ch) { return hay.indexOf(ch) >= 0; }) || E.search(kw, 50).some(function (h) { return h.e.id === e.id; });
    });
    $('#kbCount').textContent = '共 ' + list.length + ' 条' + (kw ? '（关键词：' + kw + '）' : '');
    $('#kbList').innerHTML = list.map(function (e) {
      return '<article class="kb-item" data-entry="' + E.esc(e.id) + '">' +
        '<span class="tag">' + E.esc(e.cat) + '</span>' +
        '<h4>' + E.esc(e.title) + '</h4>' +
        '<p>' + E.esc(e.summary) + '</p></article>';
    }).join('');
    bindEntryChips($('#kbList'));
    $$('#kbList .kb-item').forEach(function (el) {
      el.addEventListener('click', function () { openEntry(el.dataset.entry); });
    });
  }

  /* ---------------- 专题 ---------------- */
  function renderTopics() {
    var list = E.TOPICS || [];
    $('#topicGrid').innerHTML = list.map(function (t) {
      return '<article class="topic" data-topic="' + E.esc(t.id) + '">' +
        '<span class="k">' + E.esc(t.kicker) + '</span>' +
        '<h4>' + E.esc(t.title) + '</h4>' +
        '<p>' + E.esc(t.question) + '</p>' +
        '<div class="topic-meta"><span>' + E.esc(t.level) + '</span><span>建议 ' + t.minutes + ' 分钟</span></div>' +
        '</article>';
    }).join('');
    $$('#topicGrid .topic').forEach(function (el) {
      el.addEventListener('click', function () { openTopic(el.dataset.topic); });
    });
  }

  function openTopic(id) {
    var t = (E.TOPICS || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var chips = (t.ids || []).map(function (kid) {
      var e = E.byId(kid);
      return e ? '<span class="chip" data-entry="' + E.esc(kid) + '">' + E.esc(e.title) + '</span>' : '';
    }).join('');
    var cases = (t.ids || []).map(function (kid) { return E.byId(kid); }).filter(function (e) { return e && e.cat === '案例'; });
    var html = '<h3>' + E.esc(t.title) + '</h3><span class="tag">' + E.esc(t.kicker) + '</span>' +
      '<div class="lead">' + E.esc(t.summary) + '</div>' +
      '<h4>核心问题</h4><p>' + E.esc(t.question) + '</p>' +
      '<h4>关键概念</h4><div class="chips">' + chips + '</div>' +
      (cases.length ? '<h4>相关案例</h4><div class="chips">' + cases.map(function (e) {
        return '<span class="chip" data-entry="' + E.esc(e.id) + '">' + E.esc(e.title) + '</span>';
      }).join('') + '</div>' : '') +
      '<h4>常见误解</h4><ul>' + (t.misconceptions || []).map(function (m) { return '<li>' + E.esc(m) + '</li>'; }).join('') + '</ul>' +
      '<div class="row"><button class="btn btn-primary" id="topicOutline">生成这个专题的讲解提纲</button></div>';
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    bindEntryChips($('#modalBody'));
    var btn = $('#topicOutline');
    if (btn) btn.addEventListener('click', function () {
      closeModal();
      go('outline');
      $('#olTopic').value = t.title;
      $('#olMinutes').value = t.minutes || 10;
      $('#outlineOut').innerHTML = E.outline({
        topic: t.title,
        minutes: t.minutes || 10,
        audience: $('#olAudience').value,
        depth: $('#olDepth').value
      });
    });
  }

  /* ---------------- 案例 ---------------- */
  function renderCases() {
    var cases = E.KB.filter(function (e) { return e.cat === '案例'; });
    $('#caseGrid').innerHTML = cases.map(function (e) {
      return '<article class="case ' + (e.neg ? 'neg' : '') + '" data-entry="' + E.esc(e.id) + '">' +
        '<span class="badge">' + (e.neg ? '反面镜鉴' : '正面样板') + '</span>' +
        '<h4>' + E.esc(e.title) + '</h4>' +
        '<div class="place">' + E.esc(e.place || '') + '</div>' +
        '<p>' + E.esc(e.summary) + '</p></article>';
    }).join('');
    $$('#caseGrid .case').forEach(function (el) {
      el.addEventListener('click', function () { openEntry(el.dataset.entry); });
    });
  }

  /* ---------------- 详情弹窗 ---------------- */
  function openEntry(id) {
    var e = E.byId(id);
    if (!e) return;
    var rel = (e.related || []).filter(function (x) { return !!E.byId(x); });
    var html = '<h3>' + E.esc(e.title) + '</h3>' +
      '<span class="tag">' + E.esc(e.cat) + '</span>' +
      '<div class="lead">' + E.esc(e.summary) + '</div>' +
      E.renderEntryBody(e) +
      '<div class="src">出处：' + E.esc(e.source || '知识库') + '</div>' +
      (rel.length ? '<div class="chips">' + rel.map(function (rid) {
        var r = E.byId(rid);
        return '<span class="chip" data-entry="' + E.esc(rid) + '">' + E.esc(r.title) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="row"><button class="btn btn-primary" id="askThis">就这条提问</button></div>';
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    bindEntryChips($('#modalBody'));
    var btn = $('#askThis');
    if (btn) btn.addEventListener('click', function () {
      closeModal();
      ask(e.title + '是什么？');
    });
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
    document.body.style.overflow = '';
  }

  /* ---------------- 测验 ---------------- */
  function renderQuizIntro() {
    $('#quizShell').innerHTML =
      '<div class="quiz-card">' +
      '<h3>准备开始</h3>' +
      '<p class="muted">随机抽取 5 题，覆盖理论、制度、案例与辨析。每题答完立即显示解析。</p>' +
      '<ul class="plain"><li>题库总量<b>' + E.QUIZ.length + ' 题</b></li><li>本次抽取<b>5 题</b></li><li>历史答题<b>' + state.quizLog.length + ' 题</b></li></ul>' +
      '<div class="row"><button class="btn btn-primary" id="quizStart">开始测验</button>' +
      '<button class="btn btn-ghost" id="quizAll">全部题目都来一遍</button></div></div>';
    $('#quizStart').addEventListener('click', function () { startQuiz(5); });
    $('#quizAll').addEventListener('click', function () { startQuiz(E.QUIZ.length); });
  }

  function startQuiz(n) {
    state.quiz = { list: E.pickQuiz(n), idx: 0, right: 0, chosen: null };
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    var q = state.quiz;
    if (q.idx >= q.list.length) return renderQuizResult();
    var item = q.list[q.idx];
    var pct = Math.round(q.idx / q.list.length * 100);
    $('#quizShell').innerHTML =
      '<div class="quiz-card">' +
      '<div class="quiz-top"><span>第 ' + (q.idx + 1) + ' / ' + q.list.length + ' 题</span><span>已答对 ' + q.right + ' 题</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="q-title">' + E.esc(item.q) + '</div>' +
      '<div class="opts">' + item.options.map(function (o, i) {
        return '<button class="opt" data-i="' + i + '"><span class="idx">' + 'ABCD'.charAt(i) + '</span><span>' + E.esc(o) + '</span></button>';
      }).join('') + '</div>' +
      '<div id="quizFeed"></div></div>';
    $$('#quizShell .opt').forEach(function (b) {
      b.addEventListener('click', function () { chooseOption(Number(b.dataset.i)); });
    });
  }

  function chooseOption(i) {
    var q = state.quiz;
    if (q.chosen !== null) return;
    q.chosen = i;
    var item = q.list[q.idx];
    var ok = i === item.answer;
    if (ok) q.right++;
    state.quizLog.push({ q: item.q, ok: ok, tag: item.tag, t: Date.now() });
    save(LS.quiz, state.quizLog.slice(-200));

    $$('#quizShell .opt').forEach(function (b) {
      var bi = Number(b.dataset.i);
      b.disabled = true;
      if (bi === item.answer) b.classList.add('right');
      if (bi === i && !ok) b.classList.add('wrong');
    });

    var feed = $('#quizFeed');
    feed.innerHTML = '<div class="explain"><b>' + (ok ? '答对了。' : '这题选 ' + 'ABCD'.charAt(item.answer) + '。') + '</b>' + E.esc(item.explain) +
      '<div class="row"><button class="btn btn-primary" id="quizNext">' + (q.idx + 1 >= q.list.length ? '看结果' : '下一题') + '</button></div></div>';
    $('#quizNext').addEventListener('click', function () {
      q.idx++;
      q.chosen = null;
      renderQuizQuestion();
    });
    updateSessionStats();
  }

  function renderQuizResult() {
    var q = state.quiz;
    var total = q.list.length;
    var pct = Math.round(q.right / total * 100);
    var comment = pct >= 90 ? '很稳，可以去给同学讲这一章了。' : pct >= 70 ? '基础扎实，个别条文再对一遍原文。' : pct >= 50 ? '概念记住了，制度和案例还差一点。' : '建议先看“知识库”里的理论篇，再回来做一遍。';
    $('#quizShell').innerHTML =
      '<div class="quiz-card">' +
      '<h3>测验结果</h3>' +
      '<div class="stats" style="grid-template-columns:repeat(3,1fr);margin:14px 0">' +
      '<div class="stat"><div class="n">' + q.right + '/' + total + '</div><div class="l">答对</div></div>' +
      '<div class="stat"><div class="n">' + pct + '%</div><div class="l">正确率</div></div>' +
      '<div class="stat"><div class="n">' + (total - q.right) + '</div><div class="l">错题</div></div>' +
      '</div>' +
      '<p>' + comment + '</p>' +
      '<p class="muted small">错题已记入学习报告，可在“关于”页查看。</p>' +
      '<div class="row"><button class="btn btn-primary" id="quizAgain">再来一组</button><button class="btn btn-ghost" id="quizToKb">去知识库补一补</button></div></div>';
    $('#quizAgain').addEventListener('click', function () { startQuiz(Math.min(5, E.QUIZ.length)); });
    $('#quizToKb').addEventListener('click', function () { go('kb'); });
  }

  /* ---------------- 提纲 ---------------- */
  function initOutline() {
    $('#outlineForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var opt = {
        topic: $('#olTopic').value,
        minutes: Number($('#olMinutes').value),
        audience: $('#olAudience').value,
        depth: $('#olDepth').value
      };
      $('#outlineOut').innerHTML = E.outline(opt);
    });
    $('#outlineOut').innerHTML = E.outline({ topic: '碳达峰碳中和与能源转型', minutes: 10, audience: '大学生', depth: '系统讲解' });
  }

  /* ---------------- 时间线 ---------------- */
  function renderTimeline() {
    $('#timeline').innerHTML = E.TIMELINE.map(function (it) {
      return '<div class="tl-item ' + (it.key ? 'key' : '') + '"><div class="y">' + E.esc(it.y) + '</div>' +
        '<h4>' + E.esc(it.t) + '</h4><p>' + E.esc(it.d) + '</p></div>';
    }).join('');
  }

  /* ---------------- 关于 / 设置 ---------------- */
  function renderSettings() {
    var s = E.stats();
    $('#aboutKb').textContent = s.kb;
    $('#aboutTopics').textContent = s.topics;
    $('#aboutCases').textContent = s.cases;
    $('#aboutQuiz').textContent = s.quiz;
    $('#aboutTimeline').textContent = s.timeline;
    $('#useLLM').checked = !!state.settings.useLLM;
    $('#llmBase').value = state.settings.base || '';
    $('#llmModel').value = state.settings.model || '';
    $('#llmKey').value = state.settings.key || '';
    $('#llmState').textContent = state.settings.useLLM && state.settings.key ? '已启用：回答会调用你填写的接口，Key 仅保存在本机。' : '未启用：当前使用本地知识库推理。';
    $('#engineHint').textContent = state.settings.useLLM && state.settings.key ? '当前：本地检索 + 大模型增强' : '当前：本地知识库推理';
    $('#verLine').textContent = '版本 v2.0 · 构建于 2026-11-10 · 纯静态页面，无后端';
    if (!$('#reportBox').dataset.filled) $('#reportBox').textContent = '点“生成报告”试试。';
  }

  function buildReport() {
    var asked = state.history.filter(function (m) { return m.role === 'user'; }).map(function (m) { return m.text; });
    var ids = {};
    state.history.forEach(function (m) {
      if (m.role === 'bot' && m.answer && m.answer.primaryId) ids[m.answer.primaryId] = true;
    });
    var cats = {};
    Object.keys(ids).forEach(function (id) {
      var e = E.byId(id);
      if (e) cats[e.cat] = (cats[e.cat] || 0) + 1;
    });
    var right = state.quizLog.filter(function (x) { return x.ok; }).length;
    var total = state.quizLog.length;

    var lines = [];
    lines.push('学习记录（自动生成，可复制保存）');
    lines.push('一、提问记录：共 ' + asked.length + ' 次。');
    if (asked.length) {
      asked.slice(-8).forEach(function (q, i) { lines.push('  ' + (i + 1) + '. ' + q); });
    } else {
      lines.push('  （暂无记录）');
    }
    lines.push('二、覆盖知识点：' + Object.keys(ids).length + ' 条。');
    if (Object.keys(cats).length) {
      lines.push('  ' + Object.keys(cats).map(function (c) { return c + ' ' + cats[c] + ' 条'; }).join('；'));
    }
    lines.push('三、随堂测验：作答 ' + total + ' 题，答对 ' + right + ' 题，正确率 ' + (total ? Math.round(right / total * 100) : 0) + '%。');
    var wrong = state.quizLog.filter(function (x) { return !x.ok; }).slice(-5);
    if (wrong.length) {
      lines.push('  错题涉及：' + wrong.map(function (x) { return x.tag; }).join('、') + '。');
    }
    lines.push('四、小结：它把零散看过的材料，串成了一条能讲出来的线。');
    $('#reportBox').textContent = lines.join('\n');
    $('#reportBox').dataset.filled = '1';
    return lines.join('\n');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { go(t.dataset.view); });
    });
    $$('[data-jump]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.jump); });
    });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', function (e) { if (e.target === $('#modal')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    $('#kbSearch').addEventListener('input', renderKB);

    $('#saveLLM').addEventListener('click', function () {
      state.settings = {
        useLLM: $('#useLLM').checked,
        base: $('#llmBase').value.trim(),
        model: $('#llmModel').value.trim(),
        key: $('#llmKey').value.trim()
      };
      save(LS.settings, state.settings);
      renderSettings();
      $('#llmState').textContent = state.settings.useLLM ? (state.settings.key ? '已保存，已启用。' : '已保存，但还没填 Key。') : '已保存，未启用。';
    });

    $('#makeReport').addEventListener('click', buildReport);
    $('#copyReport').addEventListener('click', function () {
      var t = $('#reportBox').textContent;
      if (!t) t = buildReport();
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { alert('已复制。'); });
      else alert('请手动选中复制。');
    });

    $('#clearData').addEventListener('click', function () {
      if (!confirm('确定清除本机的对话记录、测验成绩和设置吗？')) return;
      Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
      state.history = []; state.quizLog = []; state.asked = 0; state.hitSet = {};
      if (E.clearContext) E.clearContext();
      state.settings = { useLLM: false, base: '', model: '', key: '' };
      $('#chatLog').innerHTML = '';
      $('#reportBox').textContent = '已清除。';
      $('#reportBox').dataset.filled = '';
      renderSettings();
      updateSessionStats();
      alert('已清除。');
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    bind();
    renderHome();
    initChat();
    initOutline();
    renderTimeline();
    renderTopics();
    renderCases();
    renderKB();
    updateSessionStats();
    updateFollowUps(null);
    updateCtxBar();
    renderSettings();
    go('home');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
