/* ===========================================================
   青绿思享 · 检索引擎与回答合成（无依赖）
   - 中文 bigram 倒排 + BM25 打分
   - 意图识别（规则）+ 结构化回答合成
   - 课堂分享提纲生成
   =========================================================== */
(function (global) {
  'use strict';

  var KB = global.KB || [];
  var QUIZ = global.QUIZ || [];
  var TIMELINE = global.TIMELINE || [];
  var QUOTES = global.QUOTES || [];

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
    { id: 'method', label: '方法指导', re: /(怎么做|怎么准备|怎么写|怎么评|怎么读|如何分析|方法|提纲|批注|PPT|作业|环节)/ },
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
  var DOMAIN_RE = /(生态|两山|绿水青山|金山银山|环境|环保|污染|减排|低碳|节能|碳|气候|绿色|可持续|美丽中国|自然|山水|林|草|沙|河|湖|海洋|湿地|耕地|土壤|大气|水质|固废|垃圾|物种|生物多样|能源|资源|循环|法典|督察|红线|补偿|GEP|国家公园|保护区|排污|环评|余村|塞罕坝|八步沙|库布其|三北|秦岭|祁连|腾格里|广阳岛|茅洲河|新安江|右玉|湖州|三明|千万工程|河长|林长|习近平|新时代|中国特色|社会主义|中国式|民生|现代化|制度|治理|发展|保护|修复|理念|文明|新闻|环节|分享|提纲|批注|汇报|课堂|作业|评分|漂绿|PPT|COP15|ESG)/i;

  function outOfScope(query, intent) {
    return {
      intent: intent, hits: [], primary: null, confidence: { t: '无', s: 'low' }, outOfScope: true,
      html: '<div class="lead"><b>这个问题不在我的范围里。</b>我只学这门课的第七章：新时代中国特色社会主义生态文明建设。</div>' +
        '<p>能帮上忙的方向有：</p>' +
        '<ul><li>概念：两山理念、人与自然和谐共生、五个重大关系、生态产品价值实现；</li>' +
        '<li>制度：生态保护红线、中央环保督察、碳市场、生态环境法典；</li>' +
        '<li>案例：余村、塞罕坝、八步沙、库布其、长江十年禁渔；</li>' +
        '<li>作业：典、章、时、评四个环节怎么准备。</li></ul>' +
        '<div class="chips">' +
        ['lt-two-mountains', 'zd-code', 'mb-dual-carbon', 'ff-shi'].map(function (id) {
          var e = byId(id);
          return '<span class="chip" data-entry="' + id + '">' + esc(e ? e.title : id) + '</span>';
        }).join('') + '</div>',
      steps: [
        { k: '理解', v: '范围检查：问题“' + query.slice(0, 20) + '”没有命中课程领域词' },
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
        html: '<div class="lead">我在课程知识库里没有找到直接对应的条目。</div>' +
          '<p>这可能是一个超出本课程范围的问题，也可能是关键词没有对上。建议：</p>' +
          '<ul><li>换成课程里的说法再问一次，例如“两山理念”“生态保护红线”“双碳目标”“生态环境法典”；</li>' +
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
    html += '<h4>依据</h4><p class="muted">' + esc(primary.source || '课程知识库') + '</p>';
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

  /* ---------------- 提纲生成 ---------------- */
  var STAGE = {
    '典': {
      name: '典（经典文本）',
      logic: '理念 → 任务 → 意志 → 理论',
      sections: [
        { t: '开场：一句话立论', w: 0.07, hints: ['不念标题页，直接说这份文本要解决什么问题', '给出一句判断，让听众知道你的立场'] },
        { t: '文本清单：四类文本各是什么', w: 0.18, hints: ['讲话：为什么、往哪走', '文件：谁来干、干到什么程度、什么时候完成', '决议：全党全国的共同意志', '著作：体系化的理论表达'] },
        { t: '逐块解读：讲话—文件—决议—著作', w: 0.4, hints: ['每块一页总述 + 一页分述', '引用原文，不转述二手解读', '注意年份、会议名称、条文序号'] },
        { t: '联系现实：这条理念今天落在哪', w: 0.25, hints: ['接一个具体案例（余村、塞罕坝、法典）', '说清“理念—制度—案例”的链条'] },
        { t: '收尾：金句 + 一个问题', w: 0.1, hints: ['用一句原文收束', '留一个可以讨论的问题给同学'] }
      ]
    },
    '章': {
      name: '章（学术文章）',
      logic: '选文理由 → 复述 → 优点 → 可提升 → 疑问',
      sections: [
        { t: '选文信息与选择理由', w: 0.12, hints: ['作者、期刊、年卷期页、DOI 一次说清', '三条选择标准：真相关、有实证、能对上经验'] },
        { t: '文章结构复述：作者说了什么', w: 0.18, hints: ['问题—方法—证据—结论', '不要评价，先准确复述'] },
        { t: '优点：三条，带页码', w: 0.25, hints: ['每条都要指到具体页码或段落', '说清“好在哪”，而不只是“写得好”'] },
        { t: '可提升：三条，带页码', w: 0.25, hints: ['从样本、口径、因果推断、政策建议四个角度找', '对事不对人，给出替代方案'] },
        { t: '与“两山”理念的联系', w: 0.12, hints: ['文章属于“转化机制”还是“价值核算”', '和课程哪一章哪一节对应'] },
        { t: '我的疑问与结语', w: 0.08, hints: ['提一个作者没有回答的问题', '把问题留给大家'] }
      ]
    },
    '时': {
      name: '时（时事新闻）',
      logic: '新闻 → 背景 → 利 → 弊 → 判断',
      sections: [
        { t: '新闻：一句话 + 四要素', w: 0.15, hints: ['时间、主体、内容、影响', '配一张现场照片，标注来源与日期'] },
        { t: '背景：这件事为什么现在发生', w: 0.18, hints: ['政策铺垫、法律进程、社会关切', '用时间线把“为什么是现在”讲清楚'] },
        { t: '利：对国家与公众 / 对企业与市场', w: 0.24, hints: ['分两块，各举一例', '尽量用可核的数据或条文'] },
        { t: '弊：执行能力 / 成本与差异', w: 0.24, hints: ['说清难点在哪、谁承担代价', '不要只讲一边，讲成表态就废了'] },
        { t: '辨析：两个绕不开的争议', w: 0.12, hints: ['挑最容易被追问的两个问题', '给条件，不给绝对结论'] },
        { t: '判断与资料来源', w: 0.07, hints: ['一句话结论 + 三个成立条件', '资料来源页列全，方便同学回查'] }
      ]
    },
    '评': {
      name: '评（课堂评价）',
      logic: '标准 → 逐场 → 共性 → 建议',
      sections: [
        { t: '评分标准说明（六维度）', w: 0.12, hints: ['内容40 / 形式20 / 评论15 / 辨析15 / 反思5 / 延伸5', '先说标准，后面打分才有依据'] },
        { t: '逐场点评：题目—优点—可提升—分数', w: 0.55, hints: ['每人两条优点、两条可提升', '分数与理由一一对应', '避免只夸不评，也避免只批不建'] },
        { t: '整体观察：共性优点与共性问题', w: 0.2, hints: ['把 8 场放在一起看，找出共同模式', '共性问题要给出改进办法'] },
        { t: '建议与结语', w: 0.13, hints: ['给下一次分享的三条建议', '回到课程主题，收束'] }
      ]
    }
  };

  function fmtClock(min) {
    var m = Math.floor(min), s = Math.round((min - m) * 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function outline(opt) {
    var stage = STAGE[opt.stage] || STAGE['时'];
    var minutes = Math.max(3, Math.min(60, Number(opt.minutes) || 8));
    var topic = String(opt.topic || '').trim() || '（未填写主题）';
    var focus = opt.focus || '讲清楚';

    var html = '<h3>' + esc(topic) + '</h3>';
    html += '<p class="muted small">环节：' + esc(stage.name) + '　·　总时长：' + minutes + ' 分钟　·　侧重：' + esc(focus) + '　·　主线：' + esc(stage.logic) + '</p>';

    var cursor = 0;
    html += '<h4>时间分配</h4><ul>';
    stage.sections.forEach(function (s) {
      var dur = s.w * minutes;
      var start = cursor;
      cursor += dur;
      html += '<li><span class="time">' + fmtClock(start) + '–' + fmtClock(cursor) + '</span><b>' + esc(s.t) + '</b>（约 ' + (Math.round(dur * 10) / 10) + ' 分钟）</li>';
    });
    html += '</ul>';

    html += '<h4>逐段要点</h4>';
    stage.sections.forEach(function (s, i) {
      html += '<p><b>' + (i + 1) + '. ' + esc(s.t) + '</b></p><ul>';
      s.hints.forEach(function (h) { html += '<li>' + esc(h) + '</li>'; });
      if (focus === '讲出层次' && /(利|弊|辨析|判断)/.test(s.t)) {
        html += '<li>（按“讲出层次”的要求：这一段要有正反两面，并给出条件）</li>';
      }
      if (focus === '讲出联系' && /(现实|联系|案例|背景)/.test(s.t)) {
        html += '<li>（按“讲出联系”的要求：至少接一个具体案例，点名时间、地点、做法）</li>';
      }
      html += '</ul>';
    });

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

    html += '<p class="muted small">提示：提纲只是骨架，讲稿要自己写。把每一段的第一句话写出来，整场就稳了。</p>';
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
    KB: KB, QUIZ: QUIZ, TIMELINE: TIMELINE, QUOTES: QUOTES,
    search: search, answer: answer, outline: outline, stats: stats,
    pickQuiz: pickQuiz, byId: byId, tokenize: tokenize, stripPunct: stripPunct,
    renderEntryBody: renderEntryBody, esc: esc
  };
})(typeof window !== 'undefined' ? window : globalThis);
