'use strict';
/* ============================================================
   AI 选品助手工作台
   复用 selection_center.html 的：PRODUCTS（500 条模拟商品）、state、
   saveSets / openDetail / refreshAll / esc / toast / syncFromMCP、
   buildMcpRules / buildMcpFunnel / buildMcpConflict。
   边界：自然语言解析为本地关键词+正则规则，工具调用为本页本地业务函数；
   没有真实 LLM 调用，没有 MCP Server / Client 传输层。
   工具名与参数按可替换的函数接口组织，便于后续接入真实 MCP 工具。
   ============================================================ */

const AGENT_COUNTRY_LIST = ['美国','英国','德国','法国','日本','加拿大','澳大利亚','意大利','西班牙','墨西哥','巴西','新加坡'];
const AGENT_MARKET_CODE = {美国:'US',英国:'UK',德国:'DE',法国:'FR',日本:'JP',加拿大:'CA',澳大利亚:'AU',意大利:'IT',西班牙:'ES',墨西哥:'MX',巴西:'BR',新加坡:'SG'};
const AGENT_THEME_LABEL = {halloween:'万圣节',christmas:'圣诞节',easter:'复活节'};

const AGENT_CASE_A_TEXT = '帮我筛选美国市场的万圣节装饰商品，要求商品可以配送到美国、库存不少于300件、履约成功率不低于95%，目标12个 SKU。';
const AGENT_CASE_B_TEXT = '帮我筛选英国市场的圣诞节装饰商品，要求可以配送到英国、英国本地仓发货、库存不少于1000件、12天内送达、履约成功率不低于95%，目标8个 SKU。';

const AGENT_CASES = {
  A:{
    key:'A', label:'A / 美国万圣节主题', text:AGENT_CASE_A_TEXT, mode:'snapshot',
    market:'美国', theme:'halloween', target:12, stock:300, deliveryDays:16, fulfillment:0.95,
    localDelivery:false, ctr:true, deliveryText:'可配送至美国；未指定本地仓要求',
    engine:'Python 规则引擎复跑快照回放', poolName:'pool_us_halloween_agent_2026',
    engineNote:'漏斗与命中商品来自本地 Python 圈选函数的复跑结果快照（POOL_20261112135925_001），与选品中心「历史商品池」中的同一份记录一致。'
  },
  B:{
    key:'B', label:'B / 英国圣诞节本地配送', text:AGENT_CASE_B_TEXT, mode:'live',
    market:'英国', theme:'christmas', target:8, stock:1000, deliveryDays:12, fulfillment:0.95,
    localDelivery:true, ctr:false, deliveryText:'可配送至英国；英国本地仓发货或海外仓履约',
    engine:'浏览器本地规则引擎实时执行', poolName:'pool_uk_christmas_local_2026',
    engineNote:'每一步都在同一份 500 条模拟商品库上实时筛选，数量变化为实际计算结果。'
  }
};

const AGENT_STATE = {
  text:AGENT_CASE_A_TEXT, caseKey:'A', run:null, phase:'idle',
  adjustOpen:false, adjustLabel:'', adjustNote:'', pool:null, hasAutoRun:false
};

let AGENT_MEDIAN = null;

/* ---------------- 本地自然语言解析（关键词 + 正则） ---------------- */
function agentNorm(s){ return String(s||'').replace(/\s+/g,''); }

function agentParse(text){
  const t = String(text||'');
  const p = {};
  const fields = [];
  const missing = [];

  let market = null;
  for(const c of AGENT_COUNTRY_LIST){ if(t.indexOf(c)>=0){ market=c; break; } }
  if(market) p.market=market; else missing.push('目标市场');
  fields.push({label:'目标市场', value:market||'待确认｜未指定目标市场，无法确定基础条件', missing:!market});

  let theme=null, themeLabel='待确认｜未指定商品主题，本次不做主题匹配';
  if(/万圣节/.test(t)){ theme='halloween'; themeLabel='万圣节（主题标签 halloween）'; }
  else if(/圣诞/.test(t)){ theme='christmas'; themeLabel='圣诞节（主题标签 christmas）'; }
  else if(/复活节/.test(t)){ theme='easter'; themeLabel='复活节（主题标签 easter）'; }
  if(theme) p.theme=theme; else missing.push('商品主题');
  fields.push({label:'商品主题', value:themeLabel, missing:!theme});

  let target=null;
  const tm = t.match(/目标\s*(\d+)/) || t.match(/(\d+)\s*(?:个)?\s*SKU/i);
  if(tm) target=Number(tm[1]);
  if(target!=null) p.target=target; else missing.push('目标 SKU 数量');
  fields.push({label:'目标 SKU 数量', value:target!=null? target+' 个 SKU' : '待确认｜未指定，本次不做达标判断', missing:target==null});

  const sm = t.match(/库存[^\d]{0,8}(\d+)/);
  const stock = sm? Number(sm[1]) : null;
  if(stock!=null) p.stock=stock;
  fields.push({label:'库存要求', value:stock!=null? '可售库存 ≥ '+stock+' 件' : '未提供｜本次不设置库存条件', missing:stock==null});

  const dm = t.match(/(\d+)\s*天(?:内|以内)?送达/) || t.match(/送达[^\d]{0,6}(\d+)\s*天/);
  const deliveryDays = dm? Number(dm[1]) : null;
  if(deliveryDays!=null) p.deliveryDays=deliveryDays;

  const localDelivery = /本地(?:仓|配送|发货|履约)/.test(t);
  const deliverHit = t.match(/配送到\s*([\u4e00-\u9fa5]{2,4})/);
  p.localDelivery = localDelivery;
  p.deliverable = deliverHit? deliverHit[1] : market;
  let deliveryText = market? ('可配送至'+market) : '待确认｜未指定配送范围';
  if(localDelivery) deliveryText += '；本地仓发货或海外仓履约';
  if(deliveryDays!=null) deliveryText += '；'+deliveryDays+' 天内送达';
  fields.push({label:'配送要求', value:deliveryText, missing:!market});

  const fm = t.match(/履约[^\d]{0,12}(\d+(?:\.\d+)?)\s*%/);
  const fulfillment = fm? Number(fm[1])/100 : null;
  if(fulfillment!=null) p.fulfillment=fulfillment;
  fields.push({label:'履约要求', value:fulfillment!=null? '履约成功率 ≥ '+(fulfillment*100).toFixed(0)+'%' : '未提供｜本次不设置履约条件', missing:fulfillment==null});

  const ctr = /点击率|点击表现|CTR/i.test(t);
  p.ctr = ctr;
  fields.push({label:'其他业务约束', value:'「装饰」等描述仅作主题语义匹配，不转为类目硬条件；未提供的数值条件不自动补全', missing:false});

  // 主题词是业务必要条件，但不等于类目限定（对应 Badcase：节日主题被误转成硬筛选）
  p.themeLabel = theme? AGENT_THEME_LABEL[theme] : null;
  return {params:p, fields:fields, missing:missing};
}

function agentResolveCase(text){
  const n = agentNorm(text);
  if(n===agentNorm(AGENT_CASE_A_TEXT)) return {key:'A', mode:'snapshot', def:AGENT_CASES.A};
  if(n===agentNorm(AGENT_CASE_B_TEXT)) return {key:'B', mode:'live', def:AGENT_CASES.B};
  return {key:'CUSTOM', mode:'live', def:null};
}

function agentMedianMap(){
  if(AGENT_MEDIAN) return AGENT_MEDIAN;
  const byCat={};
  for(const p of PRODUCTS){ (byCat[p.cat_l2]=byCat[p.cat_l2]||[]).push(p.cvr); }
  const med={};
  for(const k in byCat){ const a=byCat[k].slice().sort((x,y)=>x-y); med[k]=a[Math.floor(a.length/2)]; }
  AGENT_MEDIAN=med; return med;
}

/* ---------------- 浏览器本地规则引擎（真实筛选 PRODUCTS） ---------------- */
function agentRunLocal(p){
  const med = agentMedianMap();
  const defs = [];
  const add = d => defs.push(d);
  add({kind:'catalog', name:'商品数据库查询', rowName:'商品库全量', fn:'query_product_catalog', op:'local_rule', value:'500',
    source:'demo_product_catalog', input:{dataset:'500 条模拟商品', scope:'全量商品库'}, test:()=>true});
  if(p.market) add({kind:'market', name:'市场配送条件校验', rowName:'可运达'+p.market, fn:'check_deliverable', op:'deliverable',
    value:p.market, source:'base_constraints', never_relax:true,
    input:{market:p.market, operator:'deliverable', value:[p.market], never_relax:true},
    test:x=>x.ship_country.indexOf(p.market)>=0});
  add({kind:'risk', name:'风险商品过滤', rowName:'排除风险商品', fn:'filter_risk', op:'eq', value:'否', source:'base_constraints', never_relax:true,
    input:{ip_risk:false, prohibited:false, source_id:'base_constraints', never_relax:true},
    test:x=>!x.ip_risk && !x.prohibited});
  if(p.theme) add({kind:'theme', name:'商品主题匹配', rowName:(AGENT_THEME_LABEL[p.theme]||p.theme)+'主题', fn:'match_theme', op:'in', value:p.theme,
    source:'scene_template', input:{theme:[p.theme], match:'主题标签，不限定类目'}, test:x=>x.theme===p.theme});
  if(p.localDelivery) add({kind:'local', name:'本地配送校验', rowName:p.market+'本地仓/海外仓', fn:'check_local_fulfillment', op:'local_wh',
    value:p.market, source:'scene_template',
    input:{market:p.market, rule:'本地仓发货或海外仓履约'},
    test:x=>x.local_wh.indexOf(p.market)>=0 || x.overseas_wh});
  if(p.ctr) add({kind:'ctr', name:'点击率筛选', rowName:'点击率高于类目中位数（转化率代理）', fn:'filter_ctr_proxy', op:'above_category_median', value:'类目中位数',
    source:'scene_template', input:{rule:'以转化率代理点击率，高于同类目中位数（原型无独立点击率字段）'},
    test:x=>x.cvr>med[x.cat_l2]});
  if(p.stock!=null) add({kind:'stock', name:'库存条件筛选', rowName:'库存 ≥ '+p.stock, fn:'filter_stock', op:'gte', value:p.stock,
    source:'scene_template', input:{operator:'gte', field:'stock_available', value:p.stock},
    test:x=>x.stock_available>=p.stock});
  if(p.deliveryDays!=null) add({kind:'delivery', name:'配送时效筛选', rowName:'送达天数 ≤ '+p.deliveryDays, fn:'filter_delivery_days', op:'lte',
    value:p.deliveryDays, source:'scene_template',
    input:{operator:'lte', field:'delivery_days', value:p.deliveryDays},
    test:x=>x.delivery_days<=p.deliveryDays});
  if(p.fulfillment!=null) add({kind:'fulfillment', name:'履约成功率筛选', rowName:'履约成功率 ≥ '+(p.fulfillment*100).toFixed(0)+'%', fn:'filter_fulfillment', op:'gte',
    value:p.fulfillment, source:'base_constraints', never_relax:true,
    input:{operator:'gte', field:'fulfillment_rate', value:p.fulfillment, never_relax:true},
    test:x=>x.fulfillment_rate>=p.fulfillment});

  let cur = PRODUCTS.slice();
  const rows=[], tools=[], rules=[];
  defs.forEach((d,i)=>{
    const before=cur.length;
    cur=cur.filter(d.test);
    const after=cur.length, filtered=before-after;
    const ratio = before? +(filtered/before*100).toFixed(1) : 0;
    rows.push({name:d.rowName||d.name, before:before, after:after, filtered:filtered});
    tools.push({
      kind:d.kind, name:d.name, fn:'local:'+d.fn, input:d.input,
      before:before, after:after, filtered:filtered, ratio:ratio,
      status:'已完成', result: before+' → '+after+'，过滤 '+filtered+' 条（'+ratio+'%）',
      locked:!!d.never_relax
    });
    if(i>0) rules.push({tag_id:'LOCAL_'+d.kind.toUpperCase(), name_cn:d.name, operator:d.op,
      value:d.value, source_id:d.source, never_relax:!!d.never_relax});
  });
  const funnel = rows.map((r,i)=>({step:i, condition:r.name, remaining:r.after, filtered:r.filtered, ratio:rows[i].before? +(rows[i].filtered/rows[i].before*100).toFixed(1):0}));
  tools.push({
    kind:'pool', name:'商品池创建', fn:'local:create_product_pool',
    input:{confirm_required:true, target_sku_count:p.target==null?'待确认':p.target, publish:'not_published'},
    before:cur.length, after:cur.length, filtered:0, status:'需确认',
    result:'等待用户确认；Agent 不自动创建商品池', locked:false
  });
  return {rows:rows, tools:tools, rules:rules, funnel:funnel, ids:cur.map(x=>x.id), count:cur.length};
}

/* ---------------- Python 引擎快照（案例 A） ---------------- */
function agentSnapshotUS(){
  let s = (state.sets||[]).find(x=>x.source==='mcp' && x.mcp && x.mcp.market==='US');
  if(!s && typeof syncFromMCP==='function'){
    syncFromMCP(true);
    s = (state.sets||[]).find(x=>x.source==='mcp' && x.mcp && x.mcp.market==='US');
  }
  return s||null;
}

function agentBuildSnapshotRun(parsed, text){
  const def = AGENT_CASES.A;
  const snap = agentSnapshotUS();
  if(!snap || !snap.mcp || !snap.mcp.funnel) return null;
  const f = snap.mcp.funnel;
  const srcRules = snap.mcp.rules||[];
  const ids = (snap.productIds||[]).slice();
  const names = ['商品数据库查询','市场配送条件校验','风险商品过滤','商品主题匹配','点击率筛选','库存条件筛选','配送时效筛选','履约成功率筛选'];
  const rowNames = ['商品库全量','可运达美国','排除风险商品','万圣节主题','点击率高于类目中位数','库存 ≥ 300','送达天数 ≤ 16','履约成功率 ≥ 95%'];
  const fns = ['query_product_catalog','check_deliverable','filter_risk','match_theme','filter_ctr','filter_stock','filter_delivery_days','filter_fulfillment'];
  const kinds = ['catalog','market','risk','theme','ctr','stock','delivery','fulfillment'];
  const tools=[], rows=[];
  for(let i=0;i<f.length;i++){
    const before = i===0? f[0].remaining : f[i-1].remaining;
    const after = f[i].remaining;
    const filtered = before-after;
    const r = i>0? srcRules[i-1] : null;
    const input = i===0
      ? {dataset:'500 条模拟商品', scope:'全量商品库'}
      : {name_cn:r?r.name_cn:names[i], operator:r?r.operator:'—', value:r?r.value:'—', source_id:r?r.source_id:'—', never_relax:r?!!r.never_relax:false};
    rows.push({name:rowNames[i]||f[i].condition, before:before, after:after, filtered:filtered});
    tools.push({
      kind:kinds[i]||'step', name:names[i]||f[i].condition, fn:'local:'+fns[i], input:input,
      before:before, after:after, filtered:filtered, ratio:f[i].ratio,
      status:'已完成', result:before+' → '+after+'，过滤 '+filtered+' 条（'+f[i].ratio+'%）',
      locked:i===1||i===2||i===7
    });
  }
  tools.push({
    kind:'pool', name:'商品池创建', fn:'local:create_product_pool',
    input:{confirm_required:true, target_sku_count:def.target, publish:'not_published'},
    before:ids.length, after:ids.length, filtered:0, status:'需确认',
    result:'等待用户确认；Agent 不自动创建商品池', locked:false
  });
  const fields = parsed.fields.map(x=>Object.assign({},x));
  fields[fields.length-1] = {label:'其他业务约束', missing:false,
    value:'场景模板补全（非用户原话）：点击率高于类目中位数、送达天数 ≤16；「装饰」仅作主题匹配，不限定装饰类目'};
  return {
    text:text, caseKey:'A', mode:'snapshot', label:def.label,
    market:def.market, marketCode:'US', theme:def.theme, themeLabel:def.themeLabel||'万圣节',
    target:def.target, stock:def.stock, deliveryDays:def.deliveryDays, fulfillment:def.fulfillment,
    params:{market:def.market, theme:def.theme, target:def.target, stock:def.stock, deliveryDays:def.deliveryDays, fulfillment:def.fulfillment, localDelivery:false, ctr:true},
    fields:fields, parsed:parsed, engine:def.engine, engineNote:def.engineNote,
    tools:tools, rows:rows, funnel:f, rules:srcRules, ids:ids, count:ids.length,
    poolName:def.poolName
  };
}

function agentBuildLiveRun(def, parsed, text, params, label, engineNote){
  const res = agentRunLocal(params);
  const fields = parsed.fields.map(x=>Object.assign({},x));
  if(def && def.key==='B'){
    fields[fields.length-1] = {label:'其他业务约束', missing:false,
      value:'本地配送：英国本地仓发货或具备海外仓履约能力；「装饰」仅作主题匹配，不限定装饰类目'};
  }
  const p = Object.assign({}, params);
  return {
    text:text, caseKey:def?def.key:'CUSTOM', mode:'live',
    label:label||(def?def.label:'自定义需求'),
    market:p.market||'—', marketCode:AGENT_MARKET_CODE[p.market]||'—',
    theme:p.theme||null, themeLabel:p.themeLabel||(p.theme?AGENT_THEME_LABEL[p.theme]:'未指定'),
    target:p.target==null?null:p.target, stock:p.stock==null?null:p.stock,
    deliveryDays:p.deliveryDays==null?null:p.deliveryDays,
    fulfillment:p.fulfillment==null?null:p.fulfillment,
    params:p, fields:fields, parsed:parsed,
    engine:label? '浏览器本地规则引擎实时执行（按调整条件复跑）' : '浏览器本地规则引擎实时执行',
    engineNote:engineNote|| (def?def.engineNote:'按输入中识别到的条件动态生成规则，在 500 条模拟商品库上逐步筛选；未提供的条件不生成。'),
    tools:res.tools, rows:res.rows, funnel:res.funnel, rules:res.rules,
    ids:res.ids, count:res.count,
    poolName:def?def.poolName:'pool_agent_custom_2026'
  };
}

/* ---------------- 执行主控 ---------------- */
function agentRun(opts){
  opts = opts||{};
  const el = document.getElementById('awInput');
  if(!opts.auto && el) AGENT_STATE.text = el.value.trim();
  const text = AGENT_STATE.text;
  if(!text){ toast('请先输入选品需求'); return; }
  const parsed = agentParse(text);
  const resolved = agentResolveCase(text);
  AGENT_STATE.caseKey = resolved.key;
  AGENT_STATE.adjustOpen = false;
  AGENT_STATE.adjustLabel = '';
  AGENT_STATE.adjustNote = '';
  AGENT_STATE.pool = null;

  if(!parsed.params.market){
    AGENT_STATE.run = {
      text:text, caseKey:resolved.key, mode:'needConfirm', label:'需求待确认',
      parsed:parsed, fields:parsed.fields, tools:[], rows:[], funnel:[], rules:[], ids:[], count:0,
      target:parsed.params.target==null?null:parsed.params.target,
      engine:'—', engineNote:'缺少目标市场，无法确定基础筛选条件，本次不执行工具调用。',
      market:'—', marketCode:'—', theme:parsed.params.theme, themeLabel:parsed.params.themeLabel||'未指定',
      params:parsed.params, poolName:'—'
    };
    AGENT_STATE.phase = 'needConfirm';
    renderAgentSections();
    return;
  }

  let run = null;
  if(resolved.mode==='snapshot') run = agentBuildSnapshotRun(parsed, text);
  if(!run){
    const def = resolved.def;
    run = agentBuildLiveRun(def, parsed, text, parsed.params, null, null);
  }
  AGENT_STATE.run = run;
  AGENT_STATE.phase = 'running';
  renderAgentSections();
  setTimeout(function(){
    if(AGENT_STATE.run===run && AGENT_STATE.phase==='running'){
      AGENT_STATE.phase='done'; renderAgentSections();
    }
  }, 620);
}

function agentSelectCase(key){
  const def = AGENT_CASES[key]; if(!def) return;
  AGENT_STATE.text = def.text;
  AGENT_STATE.caseKey = key;
  const el = document.getElementById('awInput'); if(el) el.value = def.text;
  agentRun({auto:true});
}

/* ---------------- 渲染 ---------------- */
function renderAgent(){
  const box = document.getElementById('content');
  if(!box) return;
  box.innerHTML = `
    <div class="aw-wrap">
      <section class="aw-card aw-input-card">
        <div class="aw-card-head">
          <div>
            <div class="aw-input-title">AI 选品助手</div>
            <div class="aw-input-sub">输入一句业务需求，看 Agent 如何理解需求、制定策略、调用工具并交付结果</div>
          </div>
          <span class="aw-engine"><i></i>本地规则引擎 · 500 条模拟商品</span>
          <span class="aw-badge soft">非在线大模型 / 非真实 MCP 链路</span>
        </div>
        <div class="aw-card-body">
          <div class="aw-input-row">
            <textarea id="awInput" class="aw-textarea" aria-label="选品需求" placeholder="例如：帮我筛选美国市场的万圣节装饰商品…"></textarea>
            <button class="aw-run" type="button" onclick="agentRun()">开始执行</button>
          </div>
          <div class="aw-cases">
            <button class="aw-case" type="button" data-k="A" onclick="agentSelectCase('A')">A / 美国万圣节主题</button>
            <button class="aw-case" type="button" data-k="B" onclick="agentSelectCase('B')">B / 英国圣诞节本地配送</button>
          </div>
          <p class="aw-hint">自然语言解析由本地关键词与正则规则完成；工具调用由本页业务函数在 500 条模拟商品上执行，没有真实 LLM 调用，也没有 MCP Server / Client 传输层。执行计划中的工具名与参数按可替换的函数接口组织，便于后续接入真实 MCP 工具。</p>
        </div>
      </section>
      <div id="awSections"></div>
      <div class="aw-card"><div class="aw-card-body">
        <button class="aw-btn ghost" type="button" onclick="agentGoCenter()">进入选品中心 · 查看商品库与历史商品池 ↗</button>
        <p class="aw-hint">选品中心是 Agent 调用的业务工具端，保留商品数据库、历史商品池、商品筛选、商品详情、商品池创建与管理。<button class="aw-case" type="button" style="margin-left:8px;padding:4px 9px" onclick="navTo('smart')">旧版对话式智能选品（存档）</button></p>
      </div></div>
    </div>`;
  const input = document.getElementById('awInput');
  if(input) input.value = AGENT_STATE.text;
  renderAgentSections();
  if(!AGENT_STATE.hasAutoRun){
    AGENT_STATE.hasAutoRun = true;
    setTimeout(function(){ agentRun({auto:true}); }, 90);
  }
}

function renderAgentSections(){
  const box = document.getElementById('awSections');
  if(!box) return;
  document.querySelectorAll('.aw-case').forEach(function(b){
    if(b.dataset && b.dataset.k) b.setAttribute('aria-pressed', b.dataset.k===AGENT_STATE.caseKey?'true':'false');
  });
  const run = AGENT_STATE.run;
  if(!run){
    box.innerHTML = '<div class="aw-card"><div class="aw-empty">正在准备演示环境与 500 条模拟商品…</div></div>';
    return;
  }
  const ph = AGENT_STATE.phase;
  box.innerHTML =
    agentPhaseHtml(ph, run) +
    '<div class="aw-grid2">' + agentUnderstandCard(run) + agentPlanCard(run, ph) + '</div>' +
    agentToolsCard(run, ph) +
    (run.mode==='needConfirm'? agentNeedConfirmCard(run) : (agentResultCard(run) + agentConfirmCard(run)));
}

function agentPhaseHtml(ph, run){
  const defs = [
    {t:'需求理解', s:'结构化条件与待确认项'},
    {t:'策略规划', s:'知识检索 → 冲突检查 → 执行计划'},
    {t:'工具执行', s:'本地业务函数逐条筛选'},
    {t:'人机确认', s:'查看 / 调整 / 创建商品池'}
  ];
  let states;
  if(ph==='needConfirm') states=['done','wait','wait','wait'];
  else if(ph==='running') states=['done','done','running','wait'];
  else states=['done','done','done', AGENT_STATE.pool?'done':'wait'];
  return '<div class="aw-phases">' + defs.map(function(d,i){
    return '<div class="aw-phase '+states[i]+'"><span class="aw-pdot"></span><div><b>'+(i+1)+' · '+d.t+'</b><small>'+d.s+'</small></div></div>';
  }).join('') + '</div>';
}

function agentUnderstandCard(run){
  const fields = run.fields||[];
  const miss = run.parsed? run.parsed.missing : [];
  return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">01</span><h3>Agent 需求理解</h3>
        <span class="aw-badge soft">本地规则解析</span></div>
      <div class="aw-card-body">
        <div class="aw-fields">${fields.map(function(f){
          return '<div class="aw-field'+(f.missing?' missing':'')+'"><div class="lab">'+esc(f.label)+'</div><div class="val">'+esc(f.value)+'</div></div>';
        }).join('')}</div>
        ${miss.length? '<p class="aw-confirm-note">待确认（'+miss.length+'）：'+esc(miss.join('、'))+'。未提供的条件不会自动补造，也不会生成对应的筛选步骤。</p>' : ''}
        <p class="aw-hint">识别结果仅来自输入文本中的关键词与数值；主题词只映射主题标签，不转成类目硬条件。</p>
      </div>
    </section>`;
}

function agentPlanCard(run, ph){
  const done = ph==='done'||ph==='needConfirm';
  const waiting = ph==='needConfirm';
  const toolsCount = run.tools? run.tools.filter(function(t){return t.kind!=='pool';}).length : 0;
  const steps = [
    {t:'检索相关选品知识和业务规则', d:'基础约束（可运达、风险排除）已装载；场景模板与历史案例索引为空，本次按内置规则执行，不宣称四层知识库全链路检索。'},
    {t:'将自然语言需求转换成结构化筛选条件', d:'已识别 '+((run.fields||[]).length)+' 类需求字段，生成 '+toolsCount+' 个可执行筛选步骤；未提供的数值条件不生成。'},
    {t:'检查规则之间是否存在冲突', d:'未检测到互斥条件；不可放宽项（可运达目标国、风险排除、履约成功率）已标记锁定。'},
    {t:'生成执行计划', d:'按「基础约束 → 主题 → 业务数值条件」排序，共 '+toolsCount+' 个筛选调用；另有 1 次商品池创建需人工确认，合计 '+(toolsCount+1)+' 条执行记录。'},
    {t:'调用商品筛选工具', d: run.mode==='needConfirm'? '因目标市场待确认，未执行工具调用。' : (run.engine+'；逐步记录输入参数、状态与数量变化。')}
  ];
  return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">02</span><h3>Agent 策略规划</h3>
        <span class="aw-badge soft">${esc(run.engine)}</span></div>
      <div class="aw-card-body">
        <ol class="aw-plan">${steps.map(function(s,i){
          let st, cls;
          if(waiting && i>0){ st='待执行'; cls='s-wait'; }
          else if(ph==='running' && i===4 && run.mode!=='needConfirm'){ st='执行中'; cls='s-run'; }
          else if(waiting && i===0){ st='需确认'; cls='s-confirm'; }
          else { st='已完成'; cls='s-done'; }
          return '<li><span class="aw-num">'+(i+1)+'</span><div class="aw-ptext"><b>'+esc(s.t)+'</b><small>'+esc(s.d)+'</small></div><span class="aw-status '+cls+'">'+st+'</span></li>';
        }).join('')}</ol>
        <p class="aw-hint">${esc(run.engineNote)}</p>
      </div>
    </section>`;
}

function agentToolsCard(run, ph){
  const tools = run.tools||[];
  if(!tools.length) return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">03</span><h3>工具调用记录</h3><span class="aw-status s-confirm">需确认</span></div>
      <div class="aw-card-body"><div class="aw-empty">目标市场未确认，本次不执行任何工具调用。</div></div>
    </section>`;
  const running = ph==='running';
  return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">03</span><h3>工具调用记录 / 执行日志</h3>
        <span class="aw-badge soft">本地业务函数执行 · 非真实 MCP 调用</span>
        <span class="aw-badge">${tools.length} 条记录</span></div>
      <div class="aw-card-body">
        <p>点击任意一条展开输入参数与返回结果；每一步的数量变化来自同一份 500 条模拟商品库。</p>
        <div class="aw-tools">${tools.map(function(t,i){
          const isPool = t.kind==='pool';
          const created = isPool && AGENT_STATE.pool;
          const st = created? '已完成' : (isPool? t.status : (running? '执行中':'已完成'));
          const cls = created? 's-done' : (isPool? 's-confirm' : (running? 's-run':'s-done'));
          const count = isPool
            ? '<span class="aw-tcount">等待人工确认</span>'
            : '<span class="aw-tcount">'+t.before+' → <b>'+t.after+'</b>　过滤 '+t.filtered+'</span>';
          const input = JSON.stringify(t.input, null, 1);
          return `
            <details class="aw-tool" ${i===0?'open':''}>
              <summary>
                <span class="aw-caret">▸</span>
                <span class="aw-tname">${i+1}. ${esc(t.name)}${t.locked?' <span class="aw-badge soft" style="margin-left:4px">不可放宽</span>':''}</span>
                <span class="aw-tfn">${esc(t.fn)}</span>
                ${count}
                <span class="aw-status ${cls}">${st}</span>
              </summary>
              <div class="aw-tool-body">
                <div class="aw-kv"><span>输入参数</span><code>${esc(input)}</code></div>
                <div class="aw-kv"><span>执行状态</span><p>${st}${isPool?'　·　商品池创建必须经过用户确认':''}</p></div>
                <div class="aw-kv"><span>返回结果</span><p>${esc(t.result)}</p></div>
                <div class="aw-kv"><span>筛选前后数量</span><p>${isPool? '—（不产生筛选）' : (t.before+' → '+t.after+'，过滤 '+t.filtered+' 条（'+t.ratio+'%）')}</p></div>
              </div>
            </details>`;
        }).join('')}</div>
        <p class="aw-hint">工具名与参数按可替换的函数接口组织；当前实现为本页本地规则引擎 / 业务函数调用，不是在线大模型推理，未接入真实 MCP Server / Client。</p>
      </div>
    </section>`;
}

function agentNeedConfirmCard(run){
  return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">04</span><h3>需人工确认</h3><span class="aw-status s-confirm">需确认</span></div>
      <div class="aw-card-body">
        <div class="aw-feedback"><span class="aw-avatar">AI</span><p>没有识别到目标市场，无法确定「可运达目标国」这类基础条件。请补充市场信息后重新执行，我不会替你假定国家或补造业务条件。</p></div>
        <div class="aw-actions">
          <button class="aw-btn sec" type="button" onclick="agentSelectCase('A')">载入案例 A</button>
          <button class="aw-btn sec" type="button" onclick="agentSelectCase('B')">载入案例 B</button>
        </div>
      </div>
    </section>`;
}

function agentLossSteps(run){
  const arr = (run.tools||[]).filter(function(t){ return t.before>0 && t.filtered>0 && ['stock','delivery','fulfillment','ctr','local'].indexOf(t.kind)>=0; });
  return arr.slice().sort(function(a,b){ return (b.filtered/b.before)-(a.filtered/a.before); });
}

function agentResultCard(run){
  const c = run.count, t = run.target;
  const rate = t? Math.round(c/t*100) : null;
  const losses = agentLossSteps(run);
  const top = losses[0];
  const max = run.rows && run.rows.length? run.rows[0].before : 500;
  return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">04</span><h3>选品结果与逐条件漏斗</h3>
        <span class="aw-badge soft">${esc(run.label)}</span></div>
      <div class="aw-card-body">
        <div class="aw-result-head">
          <div class="aw-big">${c}<small>个 SKU 命中</small></div>
          <div class="aw-result-meta">目标 <b>${t==null?'待确认':(t+' 个 SKU')}</b>${rate!=null?' · 达成率 <b>'+rate+'%</b>':''}<br>主题 <b>${esc(run.themeLabel||'未指定')}</b> · 市场 <b>${esc(run.market)}</b> · 引擎 <b>${esc(run.engine)}</b></div>
        </div>
        <div class="aw-funnel">${(run.rows||[]).map(function(r,i){
          const w = max? Math.max(2, Math.round(r.after/max*100)) : 2;
          return '<div class="aw-frow"><span class="n">'+i+'. '+esc(r.name)+'</span><span class="aw-track"><i style="width:'+w+'%"></i></span><span class="v">'+r.after+'</span><span class="d">-'+(i===0?0:r.filtered)+'</span></div>';
        }).join('')}</div>
        <div class="aw-loss">
          <b>筛选损耗分析</b>：从 ${esc(String(max))} 条商品逐步收敛到 <b>${c}</b> 条。
          ${top? '可调条件中损耗最大的是「'+esc(top.name)+'」（'+top.before+'→'+top.after+'，过滤 '+(top.filtered/top.before*100).toFixed(1)+'%）。' : ''}
          <ul>
            <li>基础约束（可运达目标国、风险排除）与主题匹配属于必要业务条件，不作为放宽对象。</li>
            <li>结果${t!=null && c<t? '未达到目标数量，Agent 不会自动降低用户设定的筛选标准':'数量按实际筛选结果保留'}；调整需由用户在下方主动选择。</li>
            <li>${esc(run.engineNote)}</li>
            ${AGENT_STATE.adjustNote? '<li>'+esc(AGENT_STATE.adjustNote)+'</li>' : ''}
          </ul>
        </div>
      </div>
    </section>`;
}

function agentFeedbackText(run){
  const c = run.count, t = run.target;
  const top = agentLossSteps(run)[0];
  let head = t==null? ('本次共命中 '+c+' 个商品，目标 SKU 数量待确认。')
    : c<t? ('本次共命中 '+c+' 个商品，未达到预期的 '+t+' 个。')
    : ('本次共命中 '+c+' 个商品，已达到预期的 '+t+' 个。');
  const loss = top? ('当前主要损耗来自「'+top.name+'」筛选（'+top.before+'→'+top.after+'，过滤 '+(top.filtered/top.before*100).toFixed(1)+'%）。') : '';
  return head + loss + '是否查看具体商品，或调整非强制筛选条件？';
}

function agentConfirmCard(run){
  const pool = AGENT_STATE.pool;
  return `
    <section class="aw-card">
      <div class="aw-card-head"><span class="aw-idx">05</span><h3>人机协同与商品池创建</h3>
        <span class="aw-status ${pool?'s-done':'s-confirm'}">${pool?'已完成':'需确认'}</span></div>
      <div class="aw-card-body">
        <div class="aw-feedback"><span class="aw-avatar">AI</span><p>${esc(agentFeedbackText(run))}</p></div>
        <div class="aw-actions">
          <button class="aw-btn" type="button" onclick="agentCreatePool()" ${pool?'disabled':''}>${pool?'已创建商品池':'确认创建商品池'}</button>
          <button class="aw-btn sec" type="button" onclick="agentViewProducts()">查看商品明细 ↗</button>
          <button class="aw-btn ghost" type="button" onclick="agentToggleAdjust()">${AGENT_STATE.adjustOpen?'收起调整面板':'调整筛选条件'}</button>
        </div>
        ${AGENT_STATE.adjustOpen? agentAdjustHtml(run) : ''}
        ${pool? agentPoolHtml(pool) : '<p class="aw-hint">商品池创建必须经过用户确认；Agent 不会自动圈选、保存或发布。查看商品明细只打开预览，不写入商品池。</p>'}
      </div>
    </section>`;
}

function agentAdjustHtml(run){
  const p = run.params||{};
  const make = {
    delivery:{k:'days', b:'放宽配送时效', d:'送达天数 ≤'+(p.deliveryDays!=null?p.deliveryDays:'—')+' → ≤20'},
    stock:{k:'stock', b:'放宽库存门槛', d:'库存 ≥'+(p.stock!=null?p.stock:'—')+' → ≥100'},
    ctr:{k:'noCtr', b:'取消点击率门槛', d:'移除类目点击率中位数条件'},
    local:{k:'noLocal', b:'取消本地配送限制', d:'不限制本地仓 / 海外仓'}
  };
  // 按本次实际损耗排序，最值得调整的条件排前面；不可放宽项不进入建议
  const kinds = agentLossSteps(run).map(function(t){ return t.kind; });
  const seen = {}, opts = [];
  kinds.forEach(function(k){
    if(seen[k] || !make[k] || k==='fulfillment') return;
    seen[k]=1; opts.push(make[k]);
  });
  ['days','stock','noCtr','noLocal'].forEach(function(k){
    if(opts.length>=3) return;
    const item = Object.keys(make).map(function(x){return make[x];}).filter(function(o){return o.k===k;})[0];
    if(item && !opts.some(function(o){return o.k===k;})) opts.push(item);
  });
  if(!opts.length) opts.push({k:'days', b:'放宽配送时效', d:'按 ≤20 天重新筛选'});
  return `
    <div class="aw-adjust">
      <h4>调整非强制筛选条件</h4>
      <p>以下操作由你主动选择，Agent 不会自动放宽。点击后使用浏览器本地规则引擎在 500 条模拟商品上实时复跑，结果可能与 Python 引擎快照口径不同（原型无独立点击率字段）。建议按本次筛选损耗排序。</p>
      <div class="aw-opt-row">${opts.map(function(o){
        return '<button class="aw-opt" type="button" onclick="agentApplyAdjust(\''+o.k+'\')"><b>'+esc(o.b)+'</b><small>'+esc(o.d)+'</small></button>';
      }).join('')}</div>
      ${AGENT_STATE.adjustNote? '<p class="aw-confirm-note">'+esc(AGENT_STATE.adjustNote)+'</p>' : ''}
      <div class="aw-locked"><b>锁定，不可放宽</b>：可运达目标国、风险商品排除、履约成功率 ≥ ${p.fulfillment!=null?(p.fulfillment*100).toFixed(0)+'%':'95%'}。这些属于基础约束与合规参数，不进入放宽列表。</div>
    </div>`;
}

function agentPoolHtml(pool){
  return `
    <div class="aw-pool">
      <h4>商品池已创建（人工确认后写入）</h4>
      <div class="aw-pool-grid">
        <div><span>商品池名称</span><b>${esc(pool.name)}</b></div>
        <div><span>商品数量</span><b>${pool.count} 个 SKU</b></div>
        <div><span>创建状态</span><b>${esc(pool.status)}</b></div>
      </div>
      <button class="aw-btn sec" type="button" onclick="agentOpenPool('${esc(pool.id)}')">在选品中心查看商品池详情 ↗</button>
    </div>`;
}

/* ---------------- 交互动作 ---------------- */
function agentToggleAdjust(){
  AGENT_STATE.adjustOpen = !AGENT_STATE.adjustOpen;
  renderAgentSections();
}

function agentApplyAdjust(kind){
  const run = AGENT_STATE.run; if(!run) return;
  // 同口径基准：用同一套浏览器本地引擎、按调整前的参数先跑一次
  const baseCount = agentRunLocal(Object.assign({}, run.params||{})).count;
  const p = Object.assign({}, run.params||{});
  if(kind==='days') p.deliveryDays = 20;
  if(kind==='stock') p.stock = 100;
  if(kind==='noCtr') p.ctr = false;
  if(kind==='noLocal') p.localDelivery = false;
  const parsed = agentParse(run.text);
  const labels = {days:'已放宽送达天数至 ≤20', stock:'已放宽库存门槛至 ≥100',
    noCtr:'已取消点击率门槛', noLocal:'已取消本地配送限制'};
  const newRun = agentBuildLiveRun(null, parsed, run.text, p,
    '按调整条件实时复跑 · '+(labels[kind]||''),
    '按你选择的调整条件，在浏览器本地规则引擎上重新筛选 500 条模拟商品；原型无独立点击率字段，与 Python 引擎快照口径不同。');
  AGENT_STATE.run = newRun;
  AGENT_STATE.caseKey = 'CUSTOM';
  AGENT_STATE.adjustLabel = labels[kind]||'';
  const diff = newRun.count===baseCount
    ? '数量未变，说明瓶颈不在该条件，可尝试其它建议或查看逐条件漏斗。'
    : (newRun.count>baseCount? '相比同口径基准增加 '+(newRun.count-baseCount)+' 个。' : '相比同口径基准减少 '+(baseCount-newRun.count)+' 个。');
  const crossEngine = run.mode==='snapshot'
    ? ('原始案例的 '+run.count+' 个 SKU 来自 Python 引擎快照，与本地实时引擎口径不同，两者数字不直接比较。') : '';
  AGENT_STATE.adjustNote = '本次调整：'+(labels[kind]||'')+'；本地实时复跑命中 '+newRun.count+' 个（同口径基准 '+baseCount+' 个）。'+diff+crossEngine;
  AGENT_STATE.adjustOpen = true;
  AGENT_STATE.pool = null;
  AGENT_STATE.phase = 'done';
  renderAgentSections();
  toast('实时复跑完成：命中 '+newRun.count+' 个（同口径基准 '+baseCount+' 个）');
}

function agentViewProducts(){
  const run = AGENT_STATE.run; if(!run || !run.ids.length){ toast('本次未命中商品'); return; }
  const id = 'AGENT_PREVIEW';
  const set = {
    id:id, name:'AI 选品助手 · 命中商品明细（预览，未创建商品池）', creator:'AI 选品助手',
    desc:'预览态：仅展示本次工具调用命中的商品，未写入商品池。'+run.engine,
    createTime:new Date().toISOString().slice(0,10), effStart:'', effEnd:'',
    groups:[], productIds:run.ids.slice(), productCount:run.ids.length,
    source:'mcp',
    mcp:{ raw:{}, rules:run.rules||[], funnel:run.funnel||[], conflicts:[],
      activity:'none', market:run.marketCode||'—', poolType:'custom',
      target:run.target==null?'—':run.target, publish:'not_published' }
  };
  state.sets = state.sets.filter(function(s){ return s.id!==id; });
  state.sets.unshift(set);
  state.detailId=id; state.view='detail'; refreshAll(); window.scrollTo(0,0);
}

function agentCreatePool(){
  const run = AGENT_STATE.run; if(!run) return;
  if(AGENT_STATE.pool){ toast('商品池已创建'); return; }
  if(!run.ids.length){ toast('未命中商品，无法创建商品池'); return; }
  const id = 'PS'+Date.now().toString().slice(-6);
  const set = {
    id:id, name:run.poolName, creator:'AI 选品助手（人工确认）',
    desc:'由 AI 选品助手在用户确认后创建。'+run.engine+'；'+run.engineNote,
    createTime:new Date().toISOString().slice(0,10), effStart:'', effEnd:'',
    groups:[], productIds:run.ids.slice(), productCount:run.ids.length,
    source:'agent',
    mcp:{ raw:{}, rules:run.rules||[], funnel:run.funnel||[], conflicts:[],
      activity:'none', market:run.marketCode||'—', poolType:'custom',
      target:run.target==null?'—':run.target, publish:'not_published' }
  };
  state.sets.unshift(set);
  saveSets();
  AGENT_STATE.pool = {id:id, name:run.poolName, count:run.ids.length, status:'已保存 · 未发布'};
  const last = run.tools[run.tools.length-1];
  if(last && last.kind==='pool'){ last.status='已完成'; last.result='用户已确认，商品池 '+id+' 已保存（未发布）'; }
  renderAgentSections();
  toast('商品池已创建：'+run.poolName);
}

function agentOpenPool(id){ openDetail(id); window.scrollTo(0,0); }

function agentGoCenter(){ state.view='center'; refreshAll(); window.scrollTo(0,0); }
