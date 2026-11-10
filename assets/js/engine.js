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
    var baseToks = tokenize(query);
    if (!baseToks.length) return [];
    var baseSet = {};
    baseToks.forEach(function (t) { baseSet[t] = 1; });

    var allToks = baseToks.slice();
    var extra = aliasText(query);
    if (extra) {
      var seen = {};
      allToks.forEach(function (t) { seen[t] = 1; });
      tokenize(extra).forEach(function (t) { if (!seen[t]) { seen[t] = 1; allToks.push(t); } });
    }
    var qSet = {};
    allToks.forEach(function (t) { qSet[t] = (qSet[t] || 0) + 1; });
    var qStrip = stripPunct(query).toLowerCase();

    var baseIdfTotal = 0;
    baseToks.forEach(function (t) { baseIdfTotal += idf(t); });

    var hits = index.docs.map(function (d) {
      var score = 0;
      var matchedIdf = 0;
      Object.keys(qSet).forEach(function (term) {
        var f = d.tf[term];
        if (!f) return;
        var denom = f + K1 * (1 - B + B * (d.len / index.avg));
        score += idf(term) * (f * (K1 + 1)) / denom;
        if (baseSet[term]) matchedIdf += idf(term);
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
      return { e: d.e, score: score, coverage: baseIdfTotal ? matchedIdf / baseIdfTotal : 0 };
    }).filter(function (h) { return h.score > 0.35; });

    // 字符级兜底：极短查询（如“碳”）在二元组索引里可能没有命中
    if (!hits.length && qStrip.length >= 1 && qStrip.length <= 4) {
      index.docs.forEach(function (d) {
        var t = stripPunct(entryText(d.e)).toLowerCase();
        if (t.indexOf(qStrip) < 0) return;
        var cnt = t.split(qStrip).length - 1;
        hits.push({ e: d.e, score: 2.4 + Math.min(5, cnt * 0.25), coverage: 1 });
      });
    }

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

  /* ---------------- 别名与口语扩展 ---------------- */
  var ALIASES = {
    '两山': '绿水青山 金山银山 两山理念 余村',
    '绿水青山': '两山 生态产品 金山银山',
    '金山银山': '两山 生态产品价值实现',
    '双碳': '碳达峰 碳中和 低碳',
    '碳达峰': '双碳 碳中和',
    '碳中和': '双碳 碳达峰 碳汇',
    '碳交易': '碳市场 碳排放权 配额',
    '碳汇': '森林碳汇 碳汇能力',
    '碳市场': '碳排放权交易 配额',
    '环保': '环境保护 生态环境',
    '环保法': '环境保护法 生态环境法典',
    '法典': '生态环境法典',
    '红线': '生态保护红线',
    '国家公园': '自然保护地 国家公园体制',
    '治沙': '荒漠化 防沙治沙 三北 沙尘',
    '沙尘': '荒漠化 防沙治沙 三北',
    '禁渔': '长江十年禁渔 退捕 渔民',
    '补偿': '生态补偿 生态保护补偿',
    '赔偿': '生态环境损害赔偿',
    'GEP': '生态系统生产总值 生态产品',
    '碳足迹': '碳排放 绿色生活 低碳',
    '雾霾': 'PM2.5 大气污染 蓝天',
    '垃圾分类': '无废城市 固废 循环经济',
    '光伏': '新能源 能源转型 风电',
    '新能源': '能源转型 风电 光伏 储能',
    '气候': '气候变化 巴黎协定 双碳',
    '生物多样性': 'COP15 物种 国家公园',
    '湿地': '湿地保护 生态修复',
    '长江': '长江大保护 十年禁渔',
    '黄河': '黄河流域 三北 几字弯',
    '秦岭': '秦岭北麓 违建别墅 红线',
    '余村': '安吉 两山 2005',
    '塞罕坝': '造林 地球卫士奖 三北',
    '八步沙': '六老汉 治沙 时代楷模',
    '库布其': '治沙 沙漠 生态经济',
    '新安江': '生态补偿 跨省 流域',
    '河长': '河长制 湖长制',
    '林长': '林长制',
    'EOD': '生态环境导向的开发',
    'ESG': '漂绿 绿色金融',
    '三重': '三线一单 红线'
  };

  function aliasText(q) {
    var s = stripPunct(q).toUpperCase();
    var extra = [];
    Object.keys(ALIASES).forEach(function (k) {
      if (s.indexOf(k.toUpperCase()) >= 0) extra.push(ALIASES[k]);
    });
    return extra.join(' ');
  }

  /* ---------------- 领域词（范围闸门） ---------------- */
  var DOMAIN_RE = /(生态|两山|绿水青山|金山银山|环境|环保|污染|减排|低碳|节能|碳|气候|绿色|可持续|美丽中国|自然|山水|林|草|沙|河|湖|海洋|湿地|耕地|土壤|大气|水质|固废|垃圾|物种|生物多样|能源|资源|循环|法典|督察|红线|补偿|GEP|国家公园|保护区|排污|环评|余村|塞罕坝|八步沙|库布其|三北|秦岭|祁连|腾格里|广阳岛|茅洲河|新安江|右玉|湖州|三明|千万工程|河长|林长|习近平|新时代|中国式|民生|现代化|制度|治理|发展|保护|修复|理念|文明|专题|讲解|科普|听众|讲座|答辩|PPT|COP15|ESG)/i;

  /* ---------------- 对话上下文 ---------------- */
  var ctx = { lastId: null, lastTitle: '', lastQuery: '' };

  function lastEntry() { return ctx.lastId ? byId(ctx.lastId) : null; }

  function setContext(e, q) {
    if (!e) return;
    ctx.lastId = e.id;
    ctx.lastTitle = e.title;
    ctx.lastQuery = q || '';
  }

  function getContext() {
    return ctx.lastId ? { id: ctx.lastId, title: ctx.lastTitle } : null;
  }

  function clearContext() {
    ctx.lastId = null;
    ctx.lastTitle = '';
    ctx.lastQuery = '';
  }

  function stripLeadPoliteness(s) {
    return s.replace(/^(你好|您好|hi|hello|hey|哈喽|嗨|请问一下|请问|麻烦问一下|麻烦问|我想问一下|我想问|问一下)[\s,，。!！~～]*/i, '').trim();
  }

  /* ---------------- 闲聊 / 元问题 ---------------- */
  var SOCIAL = [
    { id: 'greet', label: '打招呼', re: /^(你好|您好|hi|hello|hey|哈喽|嗨|在吗|在不在|早上好|上午好|中午好|下午好|晚上好|早安|晚安)[了呀啊哦!！。~～\s]*$/i },
    { id: 'thanks', label: '致谢', re: /(谢谢|多谢|感谢|辛苦了|thx|thanks|thank you)/i },
    { id: 'bye', label: '告别', re: /^(再见|拜拜|bye|下次聊|回头聊|走了)[了呀啊!！。~～\s]*$/i },
    { id: 'complain', label: '表达不满', re: /(听不懂|没听懂|我不懂|没讲清|太笨|答非所问|胡说|瞎编|不准确|不好用)/ },
    { id: 'praise', label: '肯定', re: /^(厉害|不错|很好|真好|真棒|牛|棒|聪明|好用|有意思|可以啊)[了呀啊哦!！。~～\s]*$/ },
    { id: 'identity', label: '询问身份', re: /(你是谁|你叫什么|你是什么|你叫啥|介绍一下你自己|你是干什么的)/ },
    { id: 'capability', label: '询问能力', re: /(你能做什么|你会什么|能帮我什么|能为我做什么|有什么功能|怎么用|怎么使用|使用说明|帮助|help|能干嘛|能干什么)/i },
    { id: 'meta', label: '询问机制', re: /(联网|数据.{0,4}(哪|来源)|可靠|会不会编|会不会错|准确吗|收费|要钱|免费吗|怎么更新|谁做的|谁开发|大模型|是AI|人工智能)/i },
    { id: 'smalltalk', label: '日常闲聊', re: /(吃了吗|吃了没|今天.{0,3}(好|累|忙|开心)|心情|天气|几点了|你多大|你几岁|你是男|你是女|女朋友)/ }
  ];

  function matchSocial(q) {
    for (var i = 0; i < SOCIAL.length; i++) {
      var rule = SOCIAL[i];
      if (!rule.re.test(q)) continue;
      // 能力类问题只在短句或“你……”开头时生效，避免把“垃圾分类怎么用”当成闲聊
      if (rule.id === 'capability' && q.length > 16 && !/^你/.test(q)) continue;
      // 句子里带领域词的，优先当知识问题处理（打招呼、致谢除外）
      if (DOMAIN_RE.test(q) && !/^(你好|您好|谢谢|再见|拜拜)/.test(q)) continue;
      return rule;
    }
    return null;
  }

  function socialAnswer(rule, q) {
    var t0 = now();
    var last = lastEntry();
    var html = '';
    var steps = [{ k: '理解', v: '识别为「' + rule.label + '」，不是知识问题' }];
    var intent = { id: 'social', label: rule.label };

    if (rule.id === 'greet') {
      var openers = ['你好！', '你好呀！', '嗨，你好！'];
      var opener = openers[Math.floor(Math.random() * openers.length)];
      html = '<div class="lead"><b>' + opener + '</b>我是青绿思享，一个关于生态文明的学习智能体。很高兴见到你。</div>' +
        '<p>可以直接问我问题，也可以这样跟我聊：</p>' +
        '<ul><li>“两山理念是什么”——给你一句话、要点和出处；</li>' +
        '<li>“举个例子”——接着你刚才问的那条讲；</li>' +
        '<li>“展开说说”——把要点、案例和延伸一起给你。</li></ul>' +
        '<p class="muted small">我不知道的会直说，不编。</p>' +
        chips(['lt-two-mountains', 'mb-dual-carbon', 'zd-code', 'al-yucun']);
      steps.push({ k: '检索', v: '不需要检索，先回应再引导' });
      steps.push({ k: '组织', v: '自我介绍 + 三种可用说法' });
      steps.push({ k: '自检', v: '不假设你在问什么，把选择权交给你' });
    } else if (rule.id === 'thanks') {
      var thanksText = ['不客气～', '不用谢，能帮上就好。', '没事，随时问。'];
      html = '<div class="lead">' + thanksText[Math.floor(Math.random() * thanksText.length)] + '</div>' +
        (last ? '<p>刚才聊到 <b>' + esc(last.title) + '</b>。要不要顺着往下看：</p>' +
          chips((last.related || []).slice(0, 3)) : '<p>还想了解点什么？</p>' + chips(['lt-two-mountains', 'mb-dual-carbon', 'zd-code']));
      steps.push({ k: '上下文', v: last ? '上一话题：' + last.title : '暂无上文' });
      steps.push({ k: '自检', v: '只做回应，不硬塞内容' });
    } else if (rule.id === 'bye') {
      html = '<div class="lead">好，随时回来。</div><p>链接收藏一下，下次点开就能接着用；对话记录会留在这台设备的浏览器里。</p>';
      steps.push({ k: '收尾', v: '告别 + 使用提示' });
    } else if (rule.id === 'complain') {
      html = '<div class="lead">抱歉，刚才没答到点上。</div>' +
        '<p>可能是知识库没覆盖，也可能是我没听懂你的说法。你可以试试：</p>' +
        '<ul><li>把问题说得更具体一点，比如把“那个环保政策”换成“生态环境法典”；</li>' +
        '<li>直接点下面的条目看；</li>' +
        '<li>或者说“举个例子”“展开说说”，我按上一个话题继续。</li></ul>' +
        chips(['lt-two-mountains', 'zd-code', 'mb-dual-carbon', 'bx-tradeoff']);
      steps.push({ k: '处理', v: '不辩解，给三条可操作的改法' });
    } else if (rule.id === 'praise') {
      html = '<div class="lead">谢谢！</div><p>其实我就是一个“有出处的检索器”，能帮上忙就好。</p>' +
        (last ? '<p>接着刚才的 <b>' + esc(last.title) + '</b>：</p>' + chips((last.related || []).slice(0, 3)) : '');
      steps.push({ k: '回应', v: '致谢 + 给出下一步' });
    } else if (rule.id === 'identity') {
      html = '<div class="lead"><b>我是青绿思享</b>，一个关于生态文明的学习智能体。</div>' +
        '<p>由刘祖宁开发，2026 年 11 月上线。知识库里有 ' + KB.length + ' 条，覆盖理论、制度、目标、案例、方法、辨析六类；另外还有 ' + TOPICS.length + ' 个学习专题、' + QUIZ.length + ' 道题和一条 ' + TIMELINE.length + ' 个节点的时间线。</p>' +
        '<p>我不会联网、不训练、不生成新知识——我做的是“检索 + 组织 + 标注出处”。</p>' +
        chips(['lt-two-mountains', 'zd-code', 'ff-concept']);
      steps.push({ k: '回答', v: '身份 + 规模 + 能力边界' });
    } else if (rule.id === 'capability') {
      html = '<div class="lead">我能做六件事：</div>' +
        '<ul><li><b>问答</b>：问概念、问原因、问路径，回答带出处；</li>' +
        '<li><b>专题</b>：八个主题，从核心问题到常见误解；</li>' +
        '<li><b>案例</b>：' + KB.filter(function (e) { return e.cat === '案例'; }).length + ' 个正反案例，讲清“做法—机制—成效—局限”；</li>' +
        '<li><b>测验</b>：随机 5 题，答完给解析；</li>' +
        '<li><b>提纲</b>：给主题、时长、听众，生成讲解提纲；</li>' +
        '<li><b>时间线</b>：2005 年余村到 2026 年法典。</li></ul>' +
        '<p class="muted small">你可以直接说“帮我列个提纲”“考考我”，或者问一个具体问题。</p>' +
        chips(['lt-two-mountains', 'mb-dual-carbon', 'zd-code']);
      steps.push({ k: '回答', v: '能力清单 + 两种直接用法' });
    } else if (rule.id === 'meta') {
      var specific;
      if (/联网/.test(q)) specific = '我不依赖联网：知识库和检索都在你的浏览器里，断网后已经打开的页面照样能用。';
      else if (/(可靠|编|准确)/.test(q)) specific = '每条回答下面都有“依据”，写清来自哪份文件、哪次会议或哪一条；拿不准的我不猜。';
      else if (/(收费|要钱|免费)/.test(q)) specific = '免费。它是一个静态网页，没有账号、没有付费墙，也没有后端在收集数据。';
      else if (/(更新)/.test(q)) specific = '内容都放在 assets/js/data/ 里，改完重新上传，等一两分钟就生效。';
      else if (/(谁做|谁开发)/.test(q)) specific = '刘祖宁开发，2026 年 11 月上线。';
      else specific = '底层是“中文二元组检索 + BM25 + 规则合成”，不是大模型；所以它说的每句话都能追到具体条目。';
      html = '<div class="lead">' + esc(specific) + '</div>' +
        '<p class="muted small">顺便说一句：如果你自己有大模型接口的 Key，可以在“关于”页填上，让表达更自然；不填也完全能用。</p>';
      steps.push({ k: '回答', v: '解释机制与边界，不做承诺' });
    } else {
      html = '<div class="lead">这类日常问题我答不了，我只会聊生态文明。</div>' +
        '<p>不过这个我熟：</p>' + chips(['lt-two-mountains', 'mb-dual-carbon', 'al-yucun']);
      steps.push({ k: '处理', v: '礼貌说明范围，给三个入口' });
    }

    return {
      intent: intent, hits: [], primary: null,
      confidence: { t: '—', s: 'info' },
      html: html, steps: steps, ms: Math.round(now() - t0),
      social: rule.id
    };
  }

  /* ---------------- 追问 ---------------- */
  var FOLLOW_RE = /^(还有呢|还有吗|还有没有|继续说|接着说|展开|展开说说|详细|详细点|具体|具体点|举个例子|有例子吗|举例|为什么|怎么理解|再说说|然后呢|继续|接着讲|再讲讲|深入)/;

  function followupAnswer(q) {
    var t0 = now();
    var last = lastEntry();
    if (!last) {
      return {
        intent: { id: 'followup', label: '追问' }, hits: [], primary: null,
        confidence: { t: '—', s: 'info' },
        html: '<div class="lead">可以，不过我还不知道你想接着聊哪一条。</div>' +
          '<p>你可以先说一个概念（比如“两山理念”），再说“举个例子”。</p>' +
          chips(['lt-two-mountains', 'mb-dual-carbon', 'zd-code']),
        steps: [
          { k: '理解', v: '识别为追问，但没有上文' },
          { k: '检索', v: '跳过' },
          { k: '组织', v: '先请你给个话题' },
          { k: '自检', v: '不假装记得' }
        ],
        ms: 0
      };
    }

    var intent = { id: 'followup', label: '追问' };
    var html = '';
    var steps = [{ k: '理解', v: '追问类型：' + (/(例子|举例|案例)/.test(q) ? '要例子' : /为什么/.test(q) ? '问原因' : /(展开|详细|具体|深入)/.test(q) ? '要展开' : '继续/补充') + '；上文：' + last.title }];

    if (/(例子|举例|案例)/.test(q)) {
      var cases = (last.related || []).map(byId).filter(function (e) { return e && e.cat === '案例'; });
      if (!cases.length) {
        cases = search(last.title + ' 案例', 3).map(function (h) { return h.e; }).filter(function (e) { return e.cat === '案例'; });
      }
      var c = cases[0];
      if (c) {
        html = '<div class="lead">接着 <b>' + esc(last.title) + '</b> 说，一个能对上的例子是 <b>' + esc(c.title) + '</b>。</div>' +
          renderEntryBody(c) +
          '<h4>依据</h4><p class="muted">' + esc(c.source || '知识库') + '</p>' +
          '<h4>和上文的关系</h4><p>它把“' + esc(last.title) + '”从概念落到了具体做法上——看案例时重点看“机制”那一层，别只看结果。</p>';
        steps.push({ k: '检索', v: '在相关条目里找到案例：' + c.title });
        steps.push({ k: '组织', v: '按“地点—时间—做法—成效—启示”讲' });
      } else {
        html = '<div class="lead">' + esc(last.title) + ' 这个条目下暂时没有配好的案例。</div><p>可以直接看“案例”页，或者问我“塞罕坝”“余村”这样的名字。</p>';
        steps.push({ k: '检索', v: '相关条目里没有案例' });
      }
    } else if (/(启示|意义|教训|说明什么|怎么评价)/.test(q)) {
      if (last.cat === '案例') {
        html = '<div class="lead">从 <b>' + esc(last.title) + '</b> 能读出三层：</div><ul>' +
          (last.effect ? '<li><b>成效</b>：' + esc(last.effect) + '</li>' : '') +
          (last.lesson ? '<li><b>启示</b>：' + esc(last.lesson) + '</li>' : '') +
          '<li><b>迁移</b>：换到别的地方，先看它的机制能不能复制（产权、补偿、产业、考核），再看条件够不够。</li>' +
          '</ul><h4>依据</h4><p class="muted">' + esc(last.source || '知识库') + '</p>';
      } else {
        html = '<div class="lead">把 <b>' + esc(last.title) + '</b> 的意义说得实在一点：</div>' +
          '<p>' + esc(last.summary) + '</p>' +
          (last.lesson ? '<p><b>一句话记住：</b>' + esc(last.lesson) + '</p>' : '') +
          '<h4>依据</h4><p class="muted">' + esc(last.source || '知识库') + '</p>';
      }
      steps.push({ k: '组织', v: '按“成效—启示—能否迁移”讲' });
    } else if (/为什么/.test(q)) {
      var reasons = (last.related || []).map(byId).filter(function (e) { return e && (e.cat === '理论' || e.cat === '辨析'); }).slice(0, 2);
      html = '<div class="lead">为什么 <b>' + esc(last.title) + '</b> 重要，可以从两层看：</div><ul>';
      if (reasons.length) {
        reasons.forEach(function (e) {
          html += '<li><b>' + esc(e.title) + '</b>：' + esc(e.summary) + '</li>';
        });
      } else {
        html += '<li>' + esc(last.summary) + '</li>';
        html += '<li>它对应的制度安排是：' + esc((last.source || '').slice(0, 60)) + '</li>';
      }
      html += '</ul>' + (reasons.length ? chips(reasons.map(function (e) { return e.id; })) : '');
      steps.push({ k: '检索', v: '取相关理论/辨析条目 ' + reasons.length + ' 条' });
      steps.push({ k: '组织', v: '两层解释：价值层面 + 制度层面' });
    } else if (/(展开|详细|具体|深入)/.test(q)) {
      html = '<div class="lead">展开说 <b>' + esc(last.title) + '</b>：</div>' + renderEntryBody(last) +
        '<h4>依据</h4><p class="muted">' + esc(last.source || '知识库') + '</p>';
      var rel = (last.related || []).filter(function (id) { return !!byId(id); }).slice(0, 3);
      if (rel.length) html += '<h4>顺着看</h4>' + chips(rel);
      steps.push({ k: '组织', v: '复用条目详情，补上出处与延伸' });
    } else {
      var more = (last.related || []).map(byId).filter(Boolean).slice(0, 3);
      html = '<div class="lead">和 <b>' + esc(last.title) + '</b> 挨着的还有这几条：</div><ul>';
      more.forEach(function (e) { html += '<li><b>' + esc(e.title) + '</b>：' + esc(e.summary) + '</li>'; });
      html += '</ul>' + chips(more.map(function (e) { return e.id; }));
      steps.push({ k: '检索', v: '取相邻条目 ' + more.length + ' 条' });
    }

    steps.push({ k: '自检', v: '只围绕上文展开，不换话题' });
    return {
      intent: intent, hits: [], primary: last, confidence: { t: '—', s: 'info' },
      html: html, steps: steps, ms: Math.round(now() - t0), followup: true
    };
  }

  /* ---------------- 范围外 / 澄清 / 无命中 ---------------- */
  function outOfScope(query, intent) {
    return {
      intent: intent, hits: [], primary: null, confidence: { t: '无', s: 'low' }, outOfScope: true,
      html: '<div class="lead"><b>这个我不太会。</b>我主要聊生态文明：理念、制度、案例、数据。</div>' +
        '<p>不过这几个方向我很熟：</p>' +
        '<ul><li>概念：两山理念、人与自然和谐共生、生态产品价值实现；</li>' +
        '<li>制度：生态保护红线、中央环保督察、碳市场、生态环境法典；</li>' +
        '<li>案例：余村、塞罕坝、八步沙、库布其、长江十年禁渔。</li></ul>' +
        chips(['lt-two-mountains', 'zd-code', 'mb-dual-carbon', 'al-yucun']) +
        '<p class="muted small">你也可以只说“举个例子”“展开说说”，我接着上一个话题讲。</p>',
      steps: [
        { k: '理解', v: '问题“' + query.slice(0, 20) + '”没有命中生态文明领域词' },
        { k: '检索', v: '为避免胡编，不硬凑答案' },
        { k: '组织', v: '说明边界 + 给三个入口' },
        { k: '自检', v: '宁可少答，也不编造知识库之外的结论' }
      ],
      ms: 0
    };
  }

  function clarify(q, hits) {
    var opts = hits.slice(0, 3).map(function (h) { return h.e; });
    var html = '<div class="lead">我不太确定你问的是哪一个。是不是想说：</div><ul>';
    opts.forEach(function (e) {
      html += '<li><b>' + esc(e.title) + '</b>：' + esc(e.summary) + '</li>';
    });
    html += '</ul>' + chips(opts.map(function (e) { return e.id; })) +
      '<p class="muted small">点条目直接看；或者把问题说得再具体一点，比如“生态补偿和生态赔偿有什么区别”。</p>';
    return {
      intent: { id: 'clarify', label: '澄清' }, hits: hits, primary: null,
      confidence: { t: '低', s: 'low' }, html: html,
      steps: [
        { k: '理解', v: '问题“' + q.slice(0, 20) + '”指向不止一个条目' },
        { k: '检索', v: '前三名分数接近：' + opts.map(function (e) { return e.title; }).join('、') },
        { k: '组织', v: '不猜，列候选让你选' },
        { k: '自检', v: '宁可多问一句，也不答错' }
      ],
      ms: 0
    };
  }

  function shortAck(q) {
    return {
      intent: { id: 'ack', label: '回应' }, hits: [], primary: null,
      confidence: { t: '—', s: 'info' },
      html: '<div class="lead">嗯，我在。</div><p>想继续聊点什么？可以直接问一个概念，或者让我“举个例子”“展开说说”。</p>' + chips(['lt-two-mountains', 'mb-dual-carbon', 'zd-code']),
      steps: [{ k: '理解', v: '识别为简短回应' }, { k: '组织', v: '轻轻接住，不硬答' }],
      ms: 0
    };
  }

  /* ---------------- 主回答 ---------------- */
  function answer(query) {
    var t0 = now();
    var raw = String(query || '').trim();
    if (!raw) return null;

    // 先看整句是不是纯社交（“你好呀”“谢谢”这类不能被礼貌词剥离弄丢）
    var rule0 = matchSocial(raw);
    if (rule0) return socialAnswer(rule0, raw);

    var cleaned = stripLeadPoliteness(raw);
    var greeted = cleaned !== raw && cleaned.length > 0;
    var q = cleaned || raw;

    // 1) 剥掉“请问/你好”之后仍是社交句（如“请问你能做什么”）
    var rule = matchSocial(q);
    if (rule) {
      var sa = socialAnswer(rule, q);
      if (greeted) sa.html = '<p class="muted small">你好呀，</p>' + sa.html;
      return sa;
    }

    // 1.5) 明确请求：要提纲、要测验
    if (/(列个提纲|列提纲|做个提纲|生成提纲|帮我做提纲|给个提纲)/.test(q) && q.length <= 24) {
      return {
        intent: { id: 'request', label: '请求提纲' }, hits: [], primary: null,
        confidence: { t: '—', s: 'info' },
        html: '<div class="lead">可以。去顶部「提纲」页，填三样东西：主题、时长、听众。</div>' +
          '<p>比如：主题“碳达峰碳中和与能源转型”、10 分钟、听众“大学生”、深度“系统讲解”——出来就是一份带时间分配的骨架，还自动配好可引用的条目。</p>' +
          '<p class="muted small">想先看材料，点下面这几条。</p>' +
          chips(['mb-dual-carbon', 'lt-two-mountains', 'zd-code']),
        steps: [{ k: '理解', v: '识别为“要提纲”的请求' }, { k: '组织', v: '指向提纲页 + 给一组示例参数' }],
        ms: Math.round(now() - t0)
      };
    }
    if (/(考考我|测测我|出几道题|做几道题|来几道题|测试一下我)/.test(q)) {
      return {
        intent: { id: 'request', label: '请求测验' }, hits: [], primary: null,
        confidence: { t: '—', s: 'info' },
        html: '<div class="lead">好，去顶部「测验」页，点“开始测验”。</div>' +
          '<p>随机 5 题，答完立刻给解析；错题会记进“关于”页的学习报告。想多做几道，点“全部题目都来一遍”。</p>' +
          chips(['mb-dual-carbon', 'zd-code', 'lt-two-mountains']),
        steps: [{ k: '理解', v: '识别为“要测验”的请求' }, { k: '组织', v: '指向测验页 + 说明判分方式' }],
        ms: Math.round(now() - t0)
      };
    }

    // 2) 追问（含指代）
    if (FOLLOW_RE.test(q) || (ctx.lastId && /(它|这个|那个|这条|这条)/.test(q) && q.length <= 16)) {
      return followupAnswer(q);
    }

    // 3) 领域问答
    var intent = detectIntent(q);
    var hits = search(q, 6);
    var hasDomain = DOMAIN_RE.test(q);
    var top = hits[0];

    if (!hasDomain && (!top || top.score < 8)) {
      if (/^(嗯|哦|好|好的|可以|行|ok|OK|懂了|明白了|原来如此|收到)[!！。~～\s]*$/.test(q)) return shortAck(q);
      var o = outOfScope(q, intent);
      o.ms = Math.round(now() - t0);
      return o;
    }

    if (!top) {
      return {
        intent: intent, hits: [], confidence: { t: '无', s: 'low' },
        html: '<div class="lead">知识库里没有直接对应的条目。</div>' +
          '<p>可能是关键词没对上。你可以换个说法，或者从这几个常用条目进：</p>' +
          chips(['lt-two-mountains', 'zd-code', 'mb-dual-carbon', 'bx-tradeoff']),
        steps: [
          { k: '理解', v: '识别意图：' + intent.label },
          { k: '检索', v: '在 ' + KB.length + ' 条知识中没有达到阈值的命中' },
          { k: '组织', v: '给方向、给入口，不硬编内容' },
          { k: '自检', v: '未命中即如实说明' }
        ],
        ms: Math.round(now() - t0)
      };
    }

    var GENERIC = /^(治理|发展|保护|制度|文明|理念|生态|环境|自然|绿色|资源|政策|问题|措施|意义|影响)$/;
    if (GENERIC.test(q) && hits.length >= 2) {
      var g = clarify(q, hits);
      g.ms = Math.round(now() - t0);
      return g;
    }

    var strong = top.score >= 5.5 && top.coverage >= 0.24;
    if (!strong && hits.length >= 2 && hits[1].score > top.score * 0.65) {
      var c = clarify(q, hits);
      c.ms = Math.round(now() - t0);
      return c;
    }

    var primary = top.e;
    var second = hits[1] ? hits[1].e : null;
    var weak = top.score < 3.2 || top.coverage < 0.2;
    var conf = weak ? { t: '低', s: 'low' } : confidence(top.score);
    var body = renderEntryBody(primary);
    var extraTimeline = (intent.id === 'timeline') ? timelineSlice(q) : '';
    var relIds = (primary.related || []).filter(function (id) { return !!byId(id); }).slice(0, 4);

    var html = '<div class="lead"><b>一句话：</b>' + esc(primary.summary) + '</div>' + body;
    if (weak) html = '<p class="muted small">匹配度不高：下面这条可能不是你要的，可以换个更具体的词再问。</p>' + html;
    if (extraTimeline) html += extraTimeline;
    if (second && hits[1].score > top.score * 0.55) {
      html += '<h4>还有一条相关</h4><p><b>' + esc(second.title) + '</b>：' + esc(second.summary) + '</p>';
    }
    html += '<h4>依据</h4><p class="muted">' + esc(primary.source || '知识库') + '</p>';
    if (relIds.length) html += '<h4>顺着看下去</h4>' + chips(relIds);
    html += '<div class="meta"><span>类型：' + esc(primary.cat) + '</span><span>匹配度：' + conf.t + '</span><span>条目：' + esc(primary.title) + '</span></div>';
    html += '<p class="muted small">想更具体：说“举个例子”或“展开说说”；想换个方向：直接问下一个问题。</p>';

    var steps = [
      { k: '理解', v: '识别意图：' + intent.label + '；关键词：' + tokenize(q).slice(0, 6).join('、') },
      { k: '检索', v: '在 ' + KB.length + ' 条中命中 ' + hits.length + ' 条，最高分 ' + top.score.toFixed(1) + '：' + hits.slice(0, 3).map(function (h) { return h.e.title; }).join('、') },
      { k: '组织', v: '按「' + (primary.cat === '案例' ? '地点—时间—做法—成效—启示' : primary.cat === '辨析' ? '正面—反面—辨析' : primary.cat === '方法' ? '步骤清单' : '一句话—要点—依据') + '」组织回答' },
      { k: '自检', v: '核对出处：' + (primary.source || '知识库') + '；未覆盖的部分不作推断' }
    ];

    setContext(primary, q);
    return {
      intent: intent, hits: hits, primary: primary, confidence: conf,
      html: (greeted ? '<p class="muted small">你好呀，</p>' : '') + html,
      steps: steps, ms: Math.round(now() - t0)
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
    renderEntryBody: renderEntryBody, esc: esc,
    getContext: getContext, clearContext: clearContext
  };
})(typeof window !== 'undefined' ? window : globalThis);
