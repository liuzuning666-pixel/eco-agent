/* ===========================================================
   青绿思享 · 检索引擎与回答合成（无依赖）
   - 中文 bigram 倒排 + BM25 打分
   - 意图识别（规则）+ 结构化回答合成
   - 学习专题 + 讲解提纲生成
   =========================================================== */
(function (global) {
  'use strict';

  var KB = global.KB || [];
  var QUIZ = global.QUIZ || [];
  var TIMELINE = global.TIMELINE || [];
  var QUOTES = global.QUOTES || [];
  var TOPICS = global.TOPICS || [];

  var PUNCT = /[\s，。、；：？！“”‘’（）《》〈〉【】—…·,.;:?!"'()\[\]{}<>\/\\|@#$%^&*+=~`\-_]/g;

  function stripPunct(s) {
    return String(s || '').replace(PUNCT, '');
  }

  function tokenize(s) {
    var t = stripPunct(s).toLowerCase();
    var out = [];
    // 中文二元组
    for (var i = 0; i < t.length - 1; i++) {
      var g = t.slice(i, i + 2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(g)) out.push(g);
    }
    // 英文/数字词
    var ascii = t.match(/[a-z0-9]{2,}/g);
    if (ascii) out = out.concat(ascii);
    // 单字兜底（仅当查询很短）
    if (out.length === 0) {
      for (var j = 0; j < t.length; j++) out.push(t.charAt(j));
    }
    return out;
  }

  function entryText(e) {
    var parts = [e.title, e.title];
    if (e.tags) parts.push(e.tags.join(' '));
    if (e.summary) parts.push(e.summary);
    if (e.points) parts.push(e.points.join(' '));
    if (e.practice) parts.push(e.practice.join(' '));
    if (e.effect) parts.push(e.effect);
    if (e.lesson) parts.push(e.lesson);
    if (e.place) parts.push(e.place);
    if (e.source) parts.push(e.source);
    if (e.struct) {
      for (var i = 0; i < e.struct.length; i++) parts.push(e.struct[i].k + ' ' + e.struct[i].v);
    }
    return parts.join(' ');
  }

  var index = null;

  function buildIndex() {
    var docs = KB.map(function (e) {
      var tf = {};
      var toks = tokenize(entryText(e));
      for (var i = 0; i < toks.length; i++) tf[toks[i]] = (tf[toks[i]] || 0) + 1;
      var len = toks.length;
      var titleToks = {};
      tokenize(e.title + ' ' + (e.tags || []).join(' ')).forEach(function (t) { titleToks[t] = 1; });
      return { e: e, tf: tf, len: len, titleToks: titleToks };
    });
    var df = {};
    var total = 0;
    docs.forEach(function (d) {
      total += d.len;
      Object.keys(d.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });
    index = { docs: docs, df: df, N: docs.length || 1, avg: (total / (docs.length || 1)) || 1 };
    return index;
  }

  function idf(term) {
    var df = index.df[term] || 0;
    return Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
  }

  var K1 = 1.35, B = 0.72;

  function search(query, limit) {
    if (!index) buildIndex();
    var qToks = tokenize(query);
    if (!qToks.length) return [];
    var qSet = {};
    qToks.forEach(function (t) { qSet[t] = (qSet[t] || 0) + 1; });
    var qStrip = stripPunct(query).toLowerCase();

    var qIdfTotal = 0;
    Object.keys(qSet).forEach(function (t) { qIdfTotal += idf(t); });

    var hits = index.docs.map(function (d) {
      var score = 0;
      var matchedIdf = 0;
      Object.keys(qSet).forEach(function (term) {
        var f = d.tf[term];
        if (!f) return;
        var denom = f + K1 * (1 - B + B * (d.len / index.avg));
        score += idf(term) * (f * (K1 + 1)) / denom;
        matchedIdf += idf(term);
        if (d.titleToks[term]) score += 1.4;
      });
      // 标题/标签整串命中加成
      var titleStrip = stripPunct(d.e.title).toLowerCase();
      if (qStrip.length >= 2 && titleStrip && (titleStrip.indexOf(qStrip) >= 0 || qStrip.indexOf(titleStrip) >= 0)) score += 3.2;
      if (qStrip.length >= 2 && titleStrip === qStrip) score += 6;
      (d.e.tags || []).forEach(function (tag) {
        var ts = stripPunct(tag).toLowerCase();
        if (ts.length >= 2 && qStrip.indexOf(ts) >= 0) score += 1.1;
      });
      return { e: d.e, score: score, coverage: qIdfTotal ? matchedIdf / qIdfTotal : 0 };
    }).filter(function (h) { return h.score > 0.35; });

    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, limit || 8);
  }

  /* ---------------- 意图 ---------------- */
  var INTENTS = [
    { id: 'debate', label: '观点辨析', re: /(辨析|是不是|是否|对不对|对立|争议|会不会|能不能|该不该|有用吗|值得吗|反驳|批判|怎么看|如何评价)/ },
    { id: 'method', label: '方法指导', re: /(怎么做|怎么准备|怎么写|怎么讲|如何分析|方法|提纲|讲解|科普|听众|专题|讲座|PPT)/ },
    { id: 'case', label: '案例拆解', re: /(案例|例子|举例|实践|哪个地方|样板|经验|故事)/ },
    { id: 'timeline', label: '时间线索', re: /(时间|哪年|哪一年|什么时候|历程|脉络|历史|发展过程|由来|背景)/ },
    { id: 'path', label: '路径对策', re: /(怎么办|如何|路径|举措|对策|下一步|怎么干|怎么实现|途径)/ },
    { id: 'reason', label: '原因依据', re: /(为什么|原因|依据|道理|逻辑|凭什么|意义)/ },
    { id: 'concept', label: '概念解释', re: /(是什么|含义|定义|什么意思|解释|概念|指的是|内涵)/ }
  ];

  function detectIntent(q) {
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(q)) return INTENTS[i];
    }
    return { id: 'open', label: '综合问答' };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function byId(id) {
    for (var i = 0; i < KB.length; i++) if (KB[i].id === id) return KB[i];
    return null;
  }

  function chips(ids) {
    var out = [];
    (ids || []).forEach(function (id) {
      var e = byId(id);
      if (!e) return;
      out.push('<span class="chip" data-entry="' + esc(e.id) + '">' + esc(e.title) + '</span>');
    });
    return out.length ? '<div class="chips">' + out.join('') + '</div>' : '';
  }

  function confidence(score) {
    if (score >= 8) return { t: '高', s: 'high' };
    if (score >= 4) return { t: '中', s: 'mid' };
    return { t: '低', s: 'low' };
  }

  /* ---------------- 回答合成 ---------------- */
  function renderEntryBody(e) {
    var h = '';
    if (e.cat === '案例') {
      if (e.place) h += '<h4>地点</h4><p>' + esc(e.place) + '</p>';
      if (e.period) h += '<h4>时间</h4><p>' + esc(e.period) + '</p>';
      if (e.practice && e.practice.length) {
        h += '<h4>做法</h4><ol>' + e.practice.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol>';
      }
      if (e.effect) h += '<h4>成效</h4><p>' + esc(e.effect) + '</p>';
      if (e.lesson) h += '<h4>启示</h4><p>' + esc(e.lesson) + '</p>';
      return h;
    }
    if (e.cat === '辨析' && e.struct) {
      h += '<h4>拆开看</h4><ol>';
      e.struct.forEach(function (s) {
        h += '<li><b>' + esc(s.k) + '：</b>' + esc(s.v) + '</li>';
      });
      h += '</ol>';
      return h;
    }
    if (e.points && e.points.length) {
      var ordered = e.cat === '方法';
      h += '<h4>' + (ordered ? '步骤' : '要点') + '</h4>';
      h += '<' + (ordered ? 'ol' : 'ul') + '>';
      e.points.forEach(function (p) { h += '<li>' + esc(p) + '</li>'; });
      h += '</' + (ordered ? 'ol' : 'ul') + '>';
      return h;
    }
    return '';
  }

  function timelineSlice(q) {
    var toks = tokenize(q);
    var best = [];
    TIMELINE.forEach(function (it) {
      var txt = stripPunct(it.t + it.d + it.y);
      var hit = 0;
      toks.forEach(function (t) { if (txt.indexOf(t) >= 0) hit++; });
      if (hit) best.push({ it: it, hit: hit });
    });
    best.sort(function (a, b) { return b.hit - a.hit; });
    if (!best.length) return '';
    var pick = best.slice(0, 4).map(function (x) { return x.it; }).sort(function (a, b) { return TIMELINE.indexOf(a) - TIMELINE.indexOf(b); });
    var h = '<h4>时间线索</h4><ul class="tl-mini">';
    pick.forEach(function (it) {
      h += '<li><b>' + esc(it.y) + '</b>　' + esc(it.t) + '　<span class="muted">' + esc(it.d) + '</span></li>';
    });
    h += '</ul>';
    return h;
  }

  /* ---------------- 课程范围闸门 ---------------- */
  var DOMAIN_RE = /(生态|两山|绿水青山|金山银山|环境|环保|污染|减排|低碳|节能|碳|气候|绿色|可持续|美丽中国|自然|山水|林|草|沙|河|湖|海洋|湿地|耕地|土壤|大气|水质|固废|垃圾|物种|生物多样|能源|资源|循环|法典|督察|红线|补偿|GEP|国家公园|保护区|排污|环评|余村|塞罕坝|八步沙|库布其|三北|秦岭|祁连|腾格里|广阳岛|茅洲河|新安江|右玉|湖州|三明|千万工程|河长|林长|习近平|新时代|中国式|民生|现代化|制度|治理|发展|保护|修复|理念|文明|专题|讲解|科普|听众|讲座|答辩|PPT|COP15|ESG)/i;

  function outOfScope(query, intent) {
    return {
      intent: intent, hits: [], primary: null, confidence: { t: '无', s: 'low' }, outOfScope: true,
      html: '<div class="lead"><b>这个问题不在我的范围里。</b>我只覆盖生态文明这个主题：理念、制度、案例、数据。</div>' +
        '<p>能帮上忙的方向有：</p>' +
        '<ul><li>概念：两山理念、人与自然和谐共生、五个重大关系、生态产品价值实现；</li>' +
        '<li>制度：生态保护红线、中央环保督察、碳市场、生态环境法典；</li>' +
        '<li>案例：余村、塞罕坝、八步沙、库布其、长江十年禁渔；</li>' +
        '<li>学习方法：怎么读政策文本、怎么拆案例、怎么辨析争议。</li></ul>' +
        '<div class="chips">' +
        ['lt-two-mountains', 'zd-code', 'mb-dual-carbon', 'ff-shi'].map(function (id) {
          var e = byId(id);
          return '<span class="chip" data-entry="' + id + '">' + esc(e ? e.title : id) + '</span>';
        }).join('') + '</div>',
      steps: [
        { k: '理解', v: '范围检查：问题“' + query.slice(0, 20) + '”没有命中生态文明领域词' },
        { k: '检索', v: '为避免胡编，跳过检索，直接说明边界' },
        { k: '组织', v: '给范围说明 + 四个可用入口' },
        { k: '自检', v: '宁可少答，也不编造知识库之外的结论' }
      ],
      ms: 0
    };
  }

  function answer(query) {
    var t0 = now();
    var q = String(query || '').trim();
    if (!q) return null;

    var intent = detectIntent(q);
    var hits = search(q, 6);
    var hasDomain = DOMAIN_RE.test(q);
    if (!hasDomain && (!hits.length || hits[0].score < 8)) {
      var o = outOfScope(q, intent);
      o.ms = Math.round(now() - t0);
      return o;
    }
    var t1 = now();

    if (!hits.length) {
      return {
        intent: intent, hits: [], confidence: { t: '无', s: 'low' },
        html: '<div class="lead">我在知识库里没有找到直接对应的条目。</div>' +
          '<p>这可能是一个超出本智能体范围的问题，也可能是关键词没有对上。建议：</p>' +
          '<ul><li>换成更具体的说法再问一次，例如“两山理念”“生态保护红线”“双碳目标”“生态环境法典”；</li>' +
          '<li>或者直接点开“知识库”，按分类浏览；</li>' +
          '<li>如果确实需要拓展，可以点下面的相关条目跳转。</li></ul>' +
          '<div class="chips">' +
          ['lt-two-mountains', 'zd-code', 'mb-dual-carbon', 'bx-tradeoff'].map(function (id) {
            var e = byId(id);
            return '<span class="chip" data-entry="' + id + '">' + esc(e ? e.title : id) + '</span>';
          }).join('') + '</div>',
        steps: [
          { k: '理解', v: '识别意图：' + intent.label + '；关键词：' + tokenize(q).slice(0, 6).join('、') },
          { k: '检索', v: '在 ' + KB.length + ' 条知识中没有达到阈值的命中' },
          { k: '组织', v: '转为引导式回答：给方向、给入口，不硬编内容' },
          { k: '自检', v: '未命中即如实说明，避免编造依据' }
        ],
        ms: Math.round(t1 - t0)
      };
    }

    var primary = hits[0].e;
    var second = hits[1] ? hits[1].e : null;
    var weak = hits[0].score < 3.2 || hits[0].coverage < 0.2;
    var conf = weak ? { t: '低', s: 'low' } : confidence(hits[0].score);
    var body = renderEntryBody(primary);
    var extraTimeline = (intent.id === 'timeline') ? timelineSlice(q) : '';
    var relIds = (primary.related || []).filter(function (id) { return !!byId(id); }).slice(0, 4);

    var html = '<div class="lead"><b>一句话：</b>' + esc(primary.summary) + '</div>' + body;
    if (weak) html = '<p class="muted small">匹配度不高：下面这条可能不是你要的。换一个更具体的词（比如“两山理念”“生态保护红线”“生态环境法典”）会准一些。</p>' + html;
    if (extraTimeline) html += extraTimeline;
    if (second && hits[1].score > hits[0].score * 0.55) {
      html += '<h4>还有一条相关</h4><p><b>' + esc(second.title) + '</b>：' + esc(second.summary) + '</p>';
    }
    html += '<h4>依据</h4><p class="muted">' + esc(primary.source || '知识库') + '</p>';
    if (relIds.length) html += '<h4>顺着看下去</h4>' + chips(relIds);
    html += '<div class="meta"><span>类型：' + esc(primary.cat) + '</span><span>匹配度：' + conf.t + '</span><span>条目：' + esc(primary.title) + '</span></div>';

    var steps = [
      { k: '理解', v: '识别意图：' + intent.label + '；关键词：' + tokenize(q).slice(0, 6).join('、') },
      { k: '检索', v: '在 ' + KB.length + ' 条知识中命中 ' + hits.length + ' 条，最高分 ' + hits[0].score.toFixed(1) + '：' + hits.slice(0, 3).map(function (h) { return h.e.title; }).join('、') },
      { k: '组织', v: '按「' + (primary.cat === '案例' ? '地点—时间—做法—成效—启示' : primary.cat === '辨析' ? '正面—反面—辨析' : primary.cat === '方法' ? '步骤清单' : '一句话—要点—依据') + '」组织回答' },
      { k: '自检', v: '核对出处：' + (primary.source || '知识库') + '；未覆盖的部分不作推断' }
    ];

    return {
      intent: intent, hits: hits, primary: primary, confidence: conf,
      html: html, steps: steps, ms: Math.round(t1 - t0)
    };
  }

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /* ---------------- 讲解提纲 ---------------- */
  var AUDIENCE_TIPS = {
    '中学生': [
      '多用比喻和身边的例子：把“碳达峰”讲成“水位到顶后不再涨”，把“生态补偿”讲成“上游护水、下游付费”。',
      '一页只讲一个点，全程控制在 3 个概念以内，术语第一次出现就解释。',
      '结尾留一个可以举手回答的问题，比总结更有用。'
    ],
    '大学生': [
      '可以引入理论框架（发展与保护、外部性、公共物品）与可核数据。',
      '辨析部分讲两个反方观点，展示“知道争议在哪”。',
      '留 1 分钟互动，准备一个最可能被问到的问题。'
    ],
    '社区居民': [
      '从“和我有什么关系”切入：空气、水、垃圾、电费、健康。',
      '少讲宏观数字，多讲身边变化和可操作的三件事。',
      '把政策翻译成生活语言：垃圾分类怎么分、旧家电往哪送、屋顶光伏划不划算。'
    ],
    '企业员工': [
      '讲清合规成本与转型机会：标准怎么变、什么时候生效、改造要花多少。',
      '用同行业案例，不用宏观口号。',
      '给出行动清单：先做能耗诊断，再排改造顺序。'
    ],
    '单位同事': [
      '强调政策依据与执行要求：文件全称、时间节点、责任分工。',
      '把“要求”翻译成“我们下一步做什么”。',
      '留出问答时间，先准备好被追问的三个点。'
    ]
  };

  var DEPTH = {
    '科普入门': {
      name: '科普入门',
      logic: '现象 → 概念 → 关系 → 行动',
      sections: [
        { t: '开场：一个现象或数字', w: 0.12, hints: ['用一个具体场景把人拉进来：一场沙尘、一条河的变化、一张电费单', '不要念定义，先让人“看见”问题'] },
        { t: '是什么：三个关键概念', w: 0.28, hints: ['只讲三个概念，每个一句话 + 一个例子', '术语第一次出现就解释，别堆缩写', '给一张对比图：以前 / 现在'] },
        { t: '为什么重要：和你有什么关系', w: 0.24, hints: ['落到健康、收入、生活成本三件事上', '用一个本地案例，越近越好'] },
        { t: '怎么做：三条可操作的建议', w: 0.24, hints: ['每条都要具体到“今天就能做”', '说清代价：花多少钱、麻烦在哪', '不要喊口号'] },
        { t: '收尾：一句话 + 一个问题', w: 0.12, hints: ['用一句能带走的话收束', '留一个问题给听众'] }
      ]
    },
    '系统讲解': {
      name: '系统讲解',
      logic: '导入 → 概念 → 制度 → 案例 → 辨析 → 小结',
      sections: [
        { t: '导入：现象、数据或争议', w: 0.1, hints: ['用一个反差开场：成绩与问题并存', '给出今天的核心问题，一句话'] },
        { t: '概念：它到底是什么（界定边界）', w: 0.18, hints: ['先说清不是什么，再说是什么', '给出判断标准，而不是罗列定义', '点出容易混淆的近邻概念'] },
        { t: '制度：国家怎么管', w: 0.2, hints: ['法规、标准、考核三条线各举一例', '注意时间节点与条文出处', '说清“谁来执行、执行到什么程度”'] },
        { t: '案例：一个正面 + 一个反面', w: 0.22, hints: ['正面案例讲“做法—机制—成效”', '反面案例讲“问题—代价—教训”', '每个案例都要回到机制，而不是讲故事'] },
        { t: '辨析：两个绕不开的争议', w: 0.18, hints: ['先复述反方最强理由', '给出条件句：在什么前提下成立', '不要为了平衡而各打五十大板'] },
        { t: '小结：判断与行动建议', w: 0.12, hints: ['一句话判断 + 三个成立条件', '给听众一个可以继续查的入口'] }
      ]
    }
  };

  function fmtClock(min) {
    var m = Math.floor(min), s = Math.round((min - m) * 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function outline(opt) {
    var depth = DEPTH[opt.depth] || DEPTH['系统讲解'];
    var minutes = Math.max(3, Math.min(60, Number(opt.minutes) || 10));
    var topic = String(opt.topic || '').trim() || '（未填写主题）';
    var audience = opt.audience || '大学生';
    var tips = AUDIENCE_TIPS[audience] || AUDIENCE_TIPS['大学生'];

    var html = '<h3>' + esc(topic) + '</h3>';
    html += '<p class="muted small">听众：' + esc(audience) + '　·　深度：' + esc(depth.name) + '　·　时长：' + minutes + ' 分钟　·　主线：' + esc(depth.logic) + '</p>';

    var cursor = 0;
    html += '<h4>时间分配</h4><ul>';
    depth.sections.forEach(function (s) {
      var dur = s.w * minutes;
      var start = cursor;
      cursor += dur;
      html += '<li><span class="time">' + fmtClock(start) + '–' + fmtClock(cursor) + '</span><b>' + esc(s.t) + '</b>（约 ' + (Math.round(dur * 10) / 10) + ' 分钟）</li>';
    });
    html += '</ul>';

    html += '<h4>逐段要点</h4>';
    depth.sections.forEach(function (s, i) {
      html += '<p><b>' + (i + 1) + '. ' + esc(s.t) + '</b></p><ul>';
      s.hints.forEach(function (h) { html += '<li>' + esc(h) + '</li>'; });
      html += '</ul>';
    });

    html += '<h4>讲给' + esc(audience) + '听的注意点</h4><ul>';
    tips.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
    html += '</ul>';

    var hits = search(topic, 3);
    html += '<div class="refs"><h4>可引用的知识条目</h4>';
    if (hits.length) {
      html += '<ul>';
      hits.forEach(function (h) {
        html += '<li><b>' + esc(h.e.title) + '</b>：' + esc(h.e.summary) + '<br><span class="muted small">出处：' + esc(h.e.source || '') + '</span></li>';
      });
      html += '</ul>';
    } else {
      html += '<p class="muted small">没有直接命中的条目，建议先用“知识库”页按关键词找一找。</p>';
    }
    html += '</div>';

    html += '<p class="muted small">提示：提纲只是骨架。把每一段的第一句话写出来，整场就稳了。</p>';
    return html;
  }

  /* ---------------- 统计 ---------------- */
  function stats() {
    var cat = {};
    KB.forEach(function (e) { cat[e.cat] = (cat[e.cat] || 0) + 1; });
    return {
      kb: KB.length,
      cases: KB.filter(function (e) { return e.cat === '案例'; }).length,
      quiz: QUIZ.length,
      timeline: TIMELINE.length,
      quotes: QUOTES.length,
      topics: TOPICS.length,
      cats: cat
    };
  }

  function pickQuiz(n) {
    var pool = QUIZ.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, n || 5);
  }

  global.Engine = {
    KB: KB, QUIZ: QUIZ, TIMELINE: TIMELINE, QUOTES: QUOTES, TOPICS: TOPICS,
    search: search, answer: answer, outline: outline, stats: stats,
    pickQuiz: pickQuiz, byId: byId, tokenize: tokenize, stripPunct: stripPunct,
    renderEntryBody: renderEntryBody, esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
