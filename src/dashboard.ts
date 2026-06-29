import type { DashboardReportInput, SerializableAnalysisResult } from "./index.js";

interface DashboardPayloadReport {
  label: string;
  sourceFile?: string;
  result: SerializableAnalysisResult;
  agentsPreview: string;
}

interface DashboardPayload {
  generatedAt: string;
  reports: DashboardPayloadReport[];
}

export function renderDashboardReports(inputs: DashboardReportInput[]): string {
  if (inputs.length === 0) {
    throw new Error("No JSON reports found for dashboard.");
  }
  const reports = inputs.map((input) => ({
    label: input.label ?? reportLabel(input.result, input.sourceFile),
    sourceFile: input.sourceFile,
    result: input.result,
    agentsPreview: input.agentsPreview ?? generateAgentsPreview(input.result)
  }));
  return renderDashboardHtml({ generatedAt: new Date().toISOString(), reports });
}

function reportLabel(result: SerializableAnalysisResult, sourceFile?: string): string {
  if (sourceFile) {
    return sourceFile.replace(/\.json$/i, "");
  }
  return result.repo.name || result.root || "Agent context report";
}

function generateAgentsPreview(result: SerializableAnalysisResult): string {
  const lines: string[] = [];
  const commands = result.repo.commands;
  const alwaysFiles = result.files.filter((file) => file.loadScope === "always");
  const topIssues = result.issues.filter((issue) => issue.severity !== "info").slice(0, 10);

  lines.push("# AGENTS.md");
  lines.push("");
  lines.push("## Project Snapshot");
  lines.push(`- Repository: ${result.repo.name}`);
  lines.push(`- Stack: ${result.repo.languages.length > 0 ? result.repo.languages.join(", ") : "Unknown; inspect touched files first."}`);
  lines.push("");
  lines.push("## Commands");
  lines.push(`- Install: ${commandText(commands.install)}`);
  lines.push(commands.test ? `- Test: ${commandText(commands.test)}` : "- Test: Run the smallest relevant test for the changed area.");
  if (commands.build) {
    lines.push(`- Build: ${commandText(commands.build)}`);
  }
  if (commands.lint) {
    lines.push(`- Lint: ${commandText(commands.lint)}`);
  }
  if (commands.typecheck) {
    lines.push(`- Typecheck: ${commandText(commands.typecheck)}`);
  }
  lines.push("");
  lines.push("## Current Context Inventory");
  lines.push(`- Always-loaded files: ${result.scopes.always.totals.files}`);
  lines.push(`- Deferred SKILL.md files: ${result.scopes.deferred.totals.files}`);
  lines.push(`- Estimated inventory tokens: ${result.totals.tokenEstimate}`);
  if (alwaysFiles.length > 0) {
    for (const file of alwaysFiles.slice(0, 8)) {
      lines.push(`- ${file.path}: ${file.lines} lines, ~${file.tokenEstimate} tokens`);
    }
  }
  lines.push("");
  lines.push("## Priority Fixes");
  if (topIssues.length === 0) {
    lines.push("- No high-risk context issues found.");
  } else {
    for (const issue of topIssues) {
      const location = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : "";
      lines.push(`- ${issue.title}${location}: ${issue.suggestion}`);
    }
  }
  lines.push("");
  lines.push("## Working Rules");
  lines.push("- Keep AGENTS.md short and focused on commands, repo boundaries, and non-obvious workflow rules.");
  lines.push("- Move detailed or tool-specific instructions into SKILL.md files that load only when selected.");
  lines.push("- Avoid duplicate guidance across AGENTS.md, CLAUDE.md, Cursor rules, and Copilot instructions.");
  return lines.join("\n");
}

function commandText(value?: string): string {
  return value ? `\`${value}\`` : "Use the repo's documented package manager; do not install dependencies without a reason.";
}

function renderDashboardHtml(payload: DashboardPayload): string {
  const data = safeJsonForHtml(JSON.stringify(payload));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Context Bench Dashboard</title>
<style>
:root{color-scheme:light;--canvas:#f6f7fb;--surface:#ffffff;--ink:#172033;--muted:#667085;--line:#d8dee9;--accent:#2563eb;--ok:#0f766e;--warn:#b45309;--bad:#b91c1c;--soft-blue:#e8f0ff;--soft-green:#e8f7f2;--soft-warn:#fff4df;--soft-red:#feecec;--shadow:0 16px 50px rgba(23,32,51,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button{cursor:pointer}.shell{max-width:1320px;margin:0 auto;padding:28px}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:22px}.topbar>div{min-width:0;flex:1}.eyebrow{margin:0 0 6px;color:var(--accent);font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:12px}h1{font-size:clamp(30px,4vw,48px);line-height:1.12;margin:0 0 12px;padding-top:2px;letter-spacing:0;overflow-wrap:anywhere}h2{font-size:20px;margin:0 0 14px}h3{font-size:15px;margin:0 0 8px}.subtitle{margin:0;color:var(--muted);max-width:760px;overflow-wrap:anywhere;line-height:1.5}.report-select{min-width:260px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px;box-shadow:var(--shadow)}.report-select span{display:block;color:var(--muted);font-size:12px;margin-bottom:4px}.report-select select{width:100%;border:0;background:transparent;color:var(--ink);font-weight:700;outline:0}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.tab{border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:8px;padding:9px 14px;font-weight:800}.tab.active{background:var(--ink);color:white;border-color:var(--ink)}.view{display:none}.view.active{display:block}.hero-grid{display:grid;grid-template-columns:minmax(280px,420px) 1fr;gap:18px;margin-bottom:18px}.panel,.metric,.score-panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}.panel{padding:18px;margin-bottom:18px}.score-panel{padding:22px;display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:center}.ring{--score:0;width:150px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--ring-color) calc(var(--score)*1%),#edf0f6 0);position:relative}.ring:after{content:"";position:absolute;inset:15px;background:white;border-radius:50%;box-shadow:inset 0 0 0 1px var(--line)}.ring strong{position:relative;z-index:1;font-size:34px}.risk-chip,.status-chip{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-weight:800;font-size:12px}.good{color:var(--ok);background:var(--soft-green)}.warn{color:var(--warn);background:var(--soft-warn)}.bad{color:var(--bad);background:var(--soft-red)}.neutral{color:var(--muted);background:#eef1f6}.metric-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:18px}.metric{padding:14px;min-width:0}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;font-size:24px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metric small{color:var(--muted)}.scope-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.scope-row{border:1px solid var(--line);border-radius:8px;padding:14px;background:#fbfcff}.bar{height:10px;border-radius:999px;background:#edf0f6;overflow:hidden}.bar span{display:block;height:100%;border-radius:999px;background:var(--accent);width:0}.scope-row .bar{margin:12px 0}.scope-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;color:var(--muted);font-size:12px}.issue-bars{display:grid;gap:12px}.issue-bar{display:grid;grid-template-columns:110px 1fr 48px;gap:10px;align-items:center}.tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.tools input,.tools select{border:1px solid var(--line);background:white;border-radius:8px;padding:9px 10px;min-height:40px}.tools input{min-width:260px;flex:1}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;background:white}table{width:100%;border-collapse:collapse;min-width:860px}th,td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);background:#f8fafd;text-transform:uppercase;letter-spacing:.05em}td.num{text-align:right;font-variant-numeric:tabular-nums}.link-button{border:0;background:transparent;color:var(--accent);font-weight:800;padding:0;text-align:left}.path{color:var(--muted);font-size:12px;max-width:420px;overflow-wrap:anywhere}.agents-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:18px}.code-box{margin:0;white-space:pre-wrap;overflow:auto;background:#101827;color:#f8fafc;border-radius:8px;padding:18px;line-height:1.55;max-height:680px}.file-list{display:grid;gap:10px}.file-item{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fbfcff}.file-item strong{display:block;overflow-wrap:anywhere}.empty{color:var(--muted);padding:20px;text-align:center}.footer{color:var(--muted);font-size:12px;margin:20px 0 0}@media (max-width:980px){.shell{padding:18px}.topbar,.hero-grid,.agents-layout{display:block}.report-select{margin-top:16px}.score-panel{grid-template-columns:1fr;text-align:center}.ring{margin:0 auto}.metric-grid,.scope-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:620px){.metric-grid,.scope-grid{grid-template-columns:1fr}.issue-bar{grid-template-columns:82px 1fr 36px}.tools input,.tools select{width:100%;min-width:0}.tab{flex:1 1 auto}.metric strong{font-size:20px}}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">Agent Context Bench</p>
      <h1>Context Dashboard</h1>
      <p class="subtitle" id="subtitle"></p>
    </div>
    <label class="report-select"><span>Report</span><select id="reportPicker"></select></label>
  </header>
  <nav class="tabs" aria-label="Dashboard views">
    <button class="tab active" data-view="overview">Overview</button>
    <button class="tab" data-view="skills">Skills</button>
    <button class="tab" data-view="agents">AGENTS.md</button>
    <button class="tab" data-view="issues">Issues</button>
  </nav>
  <main>
    <section id="overview" class="view active">
      <div class="hero-grid">
        <section class="score-panel"><div class="ring" id="scoreRing"><strong id="scoreValue"></strong></div><div><h2>Operational Score</h2><p id="scoreText" class="subtitle"></p><span id="riskChip" class="risk-chip"></span></div></section>
        <section class="panel"><h2>Issue Mix</h2><div class="issue-bars" id="issueBars"></div></section>
      </div>
      <div class="metric-grid" id="metricGrid"></div>
      <section class="panel"><h2>Scope Breakdown</h2><div class="scope-grid" id="scopeGrid"></div></section>
    </section>
    <section id="skills" class="view">
      <section class="panel"><div class="tools"><input id="skillSearch" type="search" placeholder="Search skills or paths"><select id="riskFilter"><option value="all">All risks</option><option value="bad">High risk</option><option value="warn">Needs attention</option><option value="good">Healthy</option></select><select id="skillSort"><option value="risk">Sort by risk</option><option value="score">Sort by score</option><option value="tokens">Sort by tokens</option><option value="name">Sort by name</option></select></div></section>
      <section class="panel"><h2>Skill Breakdown</h2><div class="table-wrap"><table><thead><tr><th>Skill</th><th>Score</th><th>Tokens</th><th>Task success</th><th>Token cost</th><th>Risk</th><th>Issues</th><th>Path</th></tr></thead><tbody id="skillRows"></tbody></table></div></section>
    </section>
    <section id="agents" class="view"><div class="agents-layout"><section class="panel"><h2>AGENTS.md Preview</h2><pre class="code-box" id="agentsPreview"></pre></section><section class="panel"><h2>Always-loaded Files</h2><div class="file-list" id="agentsFiles"></div></section></div></section>
    <section id="issues" class="view"><section class="panel"><h2>Top Issues</h2><div class="table-wrap"><table><thead><tr><th>Severity</th><th>Problem</th><th>Category</th><th>Location</th><th>Fix</th></tr></thead><tbody id="issueRows"></tbody></table></div></section></section>
  </main>
  <p class="footer" id="footerText"></p>
</div>
<script type="application/json" id="dashboard-data">${data}</script>
<script>
(function(){
var payload=JSON.parse(document.getElementById('dashboard-data').textContent||'{"reports":[]}');
var reports=payload.reports||[];var active=0;var currentView='overview';
var picker=document.getElementById('reportPicker');var tabs=[].slice.call(document.querySelectorAll('.tab'));
function entry(){return reports[active]||reports[0];}function report(){return entry().result;}function fmt(n){return Number(n||0).toLocaleString();}function pct(n){return (n>0?'+':'')+String(n||0)+'%';}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function riskClass(score,risk){if(score<=70||/dangerous|secret|security/i.test(risk||''))return'bad';if(score<90||/bloat|conflict|duplicate/i.test(risk||''))return'warn';return'good';}
function issueClass(sev){return sev==='error'?'bad':(sev==='warn'?'warn':'neutral');}
function setBar(el,value,max,color){var span=document.createElement('span');span.style.width=Math.max(0,Math.min(100,(value/(max||1))*100))+'%';if(color)span.style.background=color;el.appendChild(span);}
function init(){picker.innerHTML=reports.map(function(x,i){return '<option value="'+i+'">'+esc(x.label)+'</option>';}).join('');picker.addEventListener('change',function(){active=Number(picker.value);render();});tabs.forEach(function(tab){tab.addEventListener('click',function(){currentView=tab.getAttribute('data-view');render();});});document.getElementById('skillSearch').addEventListener('input',renderSkills);document.getElementById('riskFilter').addEventListener('change',renderSkills);document.getElementById('skillSort').addEventListener('change',renderSkills);render();}
function render(){if(!entry())return;tabs.forEach(function(t){t.classList.toggle('active',t.getAttribute('data-view')===currentView);});[].slice.call(document.querySelectorAll('.view')).forEach(function(v){v.classList.toggle('active',v.id===currentView);});document.getElementById('subtitle').textContent=report().repo.name+' - '+report().root;document.getElementById('footerText').textContent='Dashboard built '+new Date(payload.generatedAt).toLocaleString()+(entry().sourceFile?' from '+entry().sourceFile:'');renderOverview();renderSkills();renderAgents();renderIssues();}
function renderOverview(){var r=report();var cls=riskClass(r.score,r.effect.risk);var ring=document.getElementById('scoreRing');ring.style.setProperty('--score',r.score);ring.style.setProperty('--ring-color',cls==='bad'?'var(--bad)':cls==='warn'?'var(--warn)':'var(--ok)');document.getElementById('scoreValue').textContent=r.score;document.getElementById('scoreText').textContent='Always-loaded weight '+Math.round(r.operationalWeights.always*100)+'%, deferred skill weight '+Math.round(r.operationalWeights.deferred*100)+'%.';var chip=document.getElementById('riskChip');chip.textContent=r.effect.risk;chip.className='risk-chip '+cls;var metrics=[['Inventory risk',r.inventoryRiskScore+'/100'],['Context files',fmt(r.totals.files)],['Estimated tokens',fmt(r.totals.tokenEstimate)],['Task success',pct(r.effect.taskSuccessDeltaPct)],['Token cost','+'+fmt(r.effect.tokenCostDeltaPct)+'%'],['Files explored','+'+fmt(r.effect.filesExploredDeltaPct)+'%']];document.getElementById('metricGrid').innerHTML=metrics.map(function(m){return '<div class="metric"><span>'+esc(m[0])+'</span><strong>'+esc(m[1])+'</strong></div>';}).join('');renderIssueBars();renderScopes();}
function renderIssueBars(){var counts={error:0,warn:0,info:0};(report().issues||[]).forEach(function(i){counts[i.severity]=(counts[i.severity]||0)+1;});var max=Math.max(1,counts.error,counts.warn,counts.info);var rows=[['Errors',counts.error,'var(--bad)'],['Warnings',counts.warn,'var(--warn)'],['Info',counts.info,'var(--accent)']];var wrap=document.getElementById('issueBars');wrap.innerHTML='';rows.forEach(function(row){var item=document.createElement('div');item.className='issue-bar';item.innerHTML='<strong>'+row[0]+'</strong><div class="bar"></div><span>'+fmt(row[1])+'</span>';setBar(item.querySelector('.bar'),row[1],max,row[2]);wrap.appendChild(item);});}
function scopeCard(label,score,totals,effect){var cls=riskClass(score,effect.risk);return '<div class="scope-row"><h3>'+esc(label)+'</h3><span class="status-chip '+cls+'">'+score+'/100</span><div class="bar"><span style="width:'+Math.max(0,Math.min(100,score))+'%;background:'+(cls==='bad'?'var(--bad)':cls==='warn'?'var(--warn)':'var(--ok)')+'"></span></div><div class="scope-meta"><span>Files '+fmt(totals.files)+'</span><span>Lines '+fmt(totals.lines)+'</span><span>Tokens '+fmt(totals.tokenEstimate)+'</span><span>Cost +'+fmt(effect.tokenCostDeltaPct)+'%</span></div><p class="subtitle">'+esc(effect.risk)+'</p></div>';}
function renderScopes(){var r=report();document.getElementById('scopeGrid').innerHTML=scopeCard('Inventory risk',r.inventoryRiskScore,r.totals,r.inventoryEffect)+scopeCard(r.scopes.always.label,r.scopes.always.score,r.scopes.always.totals,r.scopes.always.effect)+scopeCard(r.scopes.deferred.label,r.scopes.deferred.score,r.scopes.deferred.totals,r.scopes.deferred.effect);}
function renderSkills(){if(!entry())return;var q=document.getElementById('skillSearch').value.toLowerCase();var filter=document.getElementById('riskFilter').value;var sort=document.getElementById('skillSort').value;var rows=(report().skillReports||[]).slice();rows=rows.filter(function(s){var cls=riskClass(s.score,s.effect.risk);var hit=(s.name+' '+s.path+' '+s.effect.risk).toLowerCase().indexOf(q)>=0;return hit&&(filter==='all'||filter===cls);});rows.sort(function(a,b){if(sort==='score')return a.score-b.score;if(sort==='tokens')return b.tokenEstimate-a.tokenEstimate;if(sort==='name')return a.name.localeCompare(b.name);return (b.errorCount-a.errorCount)||(b.issueCount-a.issueCount)||(a.score-b.score)||(b.tokenEstimate-a.tokenEstimate);});var body=document.getElementById('skillRows');if(rows.length===0){body.innerHTML='<tr><td colspan="8" class="empty">No skill rows found.</td></tr>';return;}body.innerHTML=rows.map(function(s){var cls=riskClass(s.score,s.effect.risk);return '<tr><td><strong>'+esc(s.name)+'</strong></td><td class="num"><span class="status-chip '+cls+'">'+s.score+'</span></td><td class="num">'+fmt(s.tokenEstimate)+'</td><td class="num">'+pct(s.effect.taskSuccessDeltaPct)+'</td><td class="num">+'+fmt(s.effect.tokenCostDeltaPct)+'%</td><td>'+esc(s.effect.risk)+'</td><td class="num">'+s.errorCount+'e / '+s.warningCount+'w</td><td><div class="path">'+esc(s.path)+'</div></td></tr>';}).join('');}
function renderAgents(){document.getElementById('agentsPreview').textContent=entry().agentsPreview||'';var files=(report().files||[]).filter(function(f){return f.loadScope==='always';});var wrap=document.getElementById('agentsFiles');if(files.length===0){wrap.innerHTML='<div class="empty">No always-loaded context files found.</div>';return;}wrap.innerHTML=files.map(function(f){return '<div class="file-item"><strong>'+esc(f.path)+'</strong><span class="subtitle">'+esc(f.kind)+' - '+fmt(f.lines)+' lines - ~'+fmt(f.tokenEstimate)+' tokens</span></div>';}).join('');}
function renderIssues(){var issues=(report().issues||[]).filter(function(i){return i.severity!=='info';}).slice(0,80);var body=document.getElementById('issueRows');if(issues.length===0){body.innerHTML='<tr><td colspan="5" class="empty">No high-risk issues found.</td></tr>';return;}body.innerHTML=issues.map(function(i){var loc=i.file?(i.file+(i.line?':'+i.line:'')):'';return '<tr><td><span class="status-chip '+issueClass(i.severity)+'">'+esc(i.severity)+'</span></td><td>'+esc(i.title)+'</td><td>'+esc(i.category)+'</td><td><div class="path">'+esc(loc)+'</div></td><td>'+esc(i.suggestion)+'</td></tr>';}).join('');}
init();
})();
</script>
</body>
</html>`;
}

function safeJsonForHtml(value: string): string {
  return value
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}