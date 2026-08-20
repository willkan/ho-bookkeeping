export function adminPage(
  nonce: string,
  defaults: { entitlementDays: number; totalLimit: number; dailyLimit: number },
): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>清简账本 · 内测运营</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; --bg:#f6faf8; --surface:#fff; --ink:#173b36; --muted:#71827e; --mint:#239d87; --pale:#ddf3ee; --line:#dce7e3; --danger:#d9685f; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }
    main { width:min(1440px,100%); margin:auto; padding:40px 28px 64px; }
    header { display:flex; justify-content:space-between; gap:24px; align-items:flex-end; border-bottom:1px solid var(--line); padding-bottom:22px; }
    h1 { margin:0; font-size:30px; letter-spacing:.04em; }
    h2 { margin:34px 0 14px; font-size:18px; }
    p { margin:6px 0; color:var(--muted); }
    button,input { font:inherit; }
    form { display:grid; grid-template-columns:minmax(220px,2fr) repeat(3,minmax(100px,1fr)) auto; gap:10px; margin-top:18px; max-width:980px; align-items:end; }
    label { display:grid; gap:5px; color:var(--muted); font-size:12px; }
    input { flex:1; min-width:0; padding:12px 14px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); }
    button { border:0; border-radius:8px; padding:11px 16px; background:var(--mint); color:white; cursor:pointer; }
    button.secondary { color:var(--mint); background:var(--pale); }
    button.danger { padding:7px 10px; color:var(--danger); background:#fff1ef; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-top:26px; }
    .metric { padding:16px 18px; background:var(--surface); border-top:2px solid var(--mint); }
    .metric b { display:block; font-size:24px; font-variant-numeric:tabular-nums; }
    .metric span { color:var(--muted); }
    .one-time { display:none; margin-top:16px; padding:16px; background:#fff8e8; border-left:3px solid #c2933c; }
    .one-time.visible { display:block; }
    code { display:block; margin:10px 0; overflow-wrap:anywhere; font:600 16px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink); }
    .table-wrap { overflow:auto; background:var(--surface); border:1px solid var(--line); }
    table { width:100%; border-collapse:collapse; white-space:nowrap; }
    th,td { padding:11px 12px; border-bottom:1px solid var(--line); text-align:left; font-variant-numeric:tabular-nums; }
    th { position:sticky; top:0; background:#edf7f3; color:var(--muted); font-size:12px; }
    tr:last-child td { border-bottom:0; }
    .status { min-height:22px; color:var(--danger); }
    .muted { color:var(--muted); }
    @media (max-width:760px) { main{padding:24px 14px 48px} header{align-items:stretch;flex-direction:column} form{grid-template-columns:1fr 1fr}.recipient{grid-column:1/-1}.summary{grid-template-columns:1fr 1fr} }
  </style>
</head>
<body>
<main>
  <header><div><h1>清简账本 · 内测运营</h1><p>邀请码颁发与托管 AI 用量对账。此处不保存或展示任何账本内容。</p></div><button id="refresh" class="secondary" type="button">刷新</button></header>
  <form id="issue-form">
    <label class="recipient">颁发给<input id="recipient" name="recipient_label" maxlength="80" autocomplete="off" placeholder="测试者称呼或渠道备注" required></label>
    <label>有效天数<input id="entitlement-days" type="number" min="1" max="365" value="${defaults.entitlementDays}" required></label>
    <label>总解析次数<input id="total-limit" type="number" min="1" max="100000" value="${defaults.totalLimit}" required></label>
    <label>每日上限<input id="daily-limit" type="number" min="1" max="10000" value="${defaults.dailyLimit}" required></label>
    <button type="submit">生成邀请码</button>
  </form>
  <div id="issue-status" class="status" role="status"></div>
  <section id="one-time" class="one-time" aria-live="polite"><b>邀请码仅显示这一次</b><code id="invite-code"></code><button id="copy" class="secondary" type="button">复制邀请码</button><p>请通过私密渠道发给对应测试者。刷新后无法找回明文。</p></section>
  <section class="summary">
    <div class="metric"><b id="metric-invites">—</b><span>已颁发邀请码</span></div>
    <div class="metric"><b id="metric-success">—</b><span>成功调用</span></div>
    <div class="metric"><b id="metric-total">—</b><span>总 tokens</span></div>
    <div class="metric"><b id="metric-cache">—</b><span>缓存命中 tokens</span></div>
    <div class="metric"><b id="metric-willing">—</b><span>愿意付费</span></div>
    <div class="metric"><b id="metric-unsure">—</b><span>还不确定</span></div>
    <div class="metric"><b id="metric-not-willing">—</b><span>暂不愿意</span></div>
  </section>
  <h2>邀请码汇总</h2>
  <div class="table-wrap"><table><thead><tr><th>颁发给</th><th>状态</th><th>付费意愿</th><th>反馈时间</th><th>邀请码 ID</th><th>匿名主体</th><th>成功次数</th><th>Prompt</th><th>Cache hit</th><th>Cache miss</th><th>Completion</th><th>Total</th><th>额度</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="invite-rows"></tbody></table></div>
  <h2>最近请求</h2>
  <div class="table-wrap"><table><thead><tr><th>时间</th><th>邀请码 ID</th><th>Request ID</th><th>状态</th><th>Prompt</th><th>Cache hit</th><th>Cache miss</th><th>Completion</th><th>Total</th><th>耗时</th><th>模型 / Host</th><th>错误</th></tr></thead><tbody id="request-rows"></tbody></table></div>
</main>
<script nonce="${nonce}">
const $ = (id) => document.getElementById(id);
const number = (value) => value === null || value === undefined ? '—' : new Intl.NumberFormat('zh-CN').format(value);
const date = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12:false }) : '—';
const cell = (value, className) => { const td=document.createElement('td'); td.textContent=String(value); if(className)td.className=className; return td; };
const knownAggregate = (invites, field) => {
  const used = invites.filter((item) => item.successfulRequests > 0);
  return used.some((item) => item[field] === null) ? null : used.reduce((sum, item) => sum + item[field], 0);
};
async function api(path, options) {
  const response = await fetch(path, { cache:'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || '请求失败');
  return body;
}
function inviteState(invite) {
  if (invite.revokedAt) return '已撤销';
  if (invite.activatedAt) return '已激活';
  return '待激活';
}
function willingness(value) {
  return ({ willing:'愿意付费', unsure:'还不确定', not_willing:'暂不愿意' })[value] || '—';
}
function renderInvite(invite) {
  const tr=document.createElement('tr');
  [invite.recipientLabel || '历史未标记', inviteState(invite), willingness(invite.willingness), date(invite.feedbackUpdatedAt), invite.inviteId, invite.subjectId || '—', number(invite.successfulRequests), number(invite.promptTokens), number(invite.promptCacheHitTokens), number(invite.promptCacheMissTokens), number(invite.completionTokens), number(invite.totalTokens), invite.consumedTotal + ' / ' + invite.totalLimit + ' 总 · ' + invite.dailyLimit + ' 日 · ' + invite.entitlementDays + ' 天', date(invite.createdAt)].forEach((value) => tr.append(cell(value, value === '—' ? 'muted' : '')));
  const action=cell('');
  if (!invite.revokedAt) { const button=document.createElement('button'); button.type='button'; button.className='danger'; button.textContent='撤销'; button.addEventListener('click', () => revoke(invite.inviteId)); action.append(button); }
  tr.append(action); return tr;
}
function renderRequest(request) {
  const tr=document.createElement('tr');
  [date(request.createdAt), request.inviteId, request.requestId, request.status, number(request.promptTokens), number(request.promptCacheHitTokens), number(request.promptCacheMissTokens), number(request.completionTokens), number(request.totalTokens), request.latencyMs === null ? '—' : number(request.latencyMs) + ' ms', request.model + ' / ' + request.providerHost, request.errorCategory || '—'].forEach((value) => tr.append(cell(value, value === '—' ? 'muted' : '')));
  return tr;
}
async function load() {
  $('issue-status').textContent='';
  try {
    const data=await api('/admin/api/overview');
    $('invite-rows').replaceChildren(...data.invites.map(renderInvite));
    $('request-rows').replaceChildren(...data.requests.map(renderRequest));
    $('metric-invites').textContent=number(data.invites.length);
    $('metric-success').textContent=number(data.invites.reduce((sum,item)=>sum+item.successfulRequests,0));
    $('metric-total').textContent=number(knownAggregate(data.invites, 'totalTokens'));
    $('metric-cache').textContent=number(knownAggregate(data.invites, 'promptCacheHitTokens'));
    $('metric-willing').textContent=number(data.invites.filter((item)=>item.willingness==='willing').length);
    $('metric-unsure').textContent=number(data.invites.filter((item)=>item.willingness==='unsure').length);
    $('metric-not-willing').textContent=number(data.invites.filter((item)=>item.willingness==='not_willing').length);
  } catch (error) { $('issue-status').textContent=error.message; }
}
async function revoke(inviteId) {
  if (!confirm('撤销后该邀请码及已签发凭证将立即失效，历史用量仍保留。确认撤销？')) return;
  try { await api('/admin/api/invites/' + encodeURIComponent(inviteId) + '/revoke', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' }); await load(); }
  catch (error) { $('issue-status').textContent=error.message; }
}
$('issue-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('issue-status').textContent='';
  const recipientLabel=$('recipient').value.trim();
  const entitlementDays=Number($('entitlement-days').value);
  const totalLimit=Number($('total-limit').value);
  const dailyLimit=Number($('daily-limit').value);
  try {
    const issued=await api('/admin/api/invites', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({recipient_label:recipientLabel,entitlement_days:entitlementDays,total_limit:totalLimit,daily_limit:dailyLimit}) });
    $('invite-code').textContent=issued.inviteCode; $('one-time').classList.add('visible'); $('recipient').value=''; await load();
  } catch (error) { $('issue-status').textContent=error.message; }
});
$('copy').addEventListener('click', async () => { await navigator.clipboard.writeText($('invite-code').textContent); $('copy').textContent='已复制'; });
$('refresh').addEventListener('click', load);
load();
</script>
</body></html>`;
}
