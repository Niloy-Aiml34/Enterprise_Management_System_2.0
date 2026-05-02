/* ── State ─────────────────────────────────────────────────── */
const chatHistory = [];
let allCharts    = [];
let apiBlocked   = false;   // set true on fatal API error; stops all further requests

/* ── Theme Switching (synced across SarvaDaksh pages) ─────── */
const THEME_KEY = 'sarvadaksh-theme';
const THEME_ALIAS = { dark: 'night', light: 'day', midnight: 'midnight' };

function applyTheme(theme) {
  const t = THEME_ALIAS[theme] || theme || 'night';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === t);
  });
  if (typeof recolorPlotlyCharts === 'function') recolorPlotlyCharts();
}

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

const saved = localStorage.getItem(THEME_KEY) || localStorage.getItem('da-theme');
applyTheme(saved || 'night');

// Sync if another page changes the theme in the same browser session
window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY && e.newValue) applyTheme(e.newValue);
});

// Re-render plotly charts whenever the theme attribute changes
new MutationObserver(() => {
  if (typeof recolorPlotlyCharts === 'function') recolorPlotlyCharts();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ── Plotly theme helper ──────────────────────────────────── */
function getPlotlyLayout() {
  const style     = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--text-secondary').trim();
  const gridColor = style.getPropertyValue('--border').trim();
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor:  'rgba(0,0,0,0)',
    font:   { family: 'Inter, sans-serif', color: textColor, size: 12 },
    xaxis:  { gridcolor: gridColor, zerolinecolor: gridColor },
    yaxis:  { gridcolor: gridColor, zerolinecolor: gridColor },
    margin: { t: 40, r: 20, b: 40, l: 50 },
    // SarvaDaksh palette: gold + navy + warm + cool
    colorway: ['#e5b340','#4f6bd1','#ffd97a','#3a52b5','#f1cc66','#6582e6','#b3811a','#16225a'],
  };
}

function renderPlotlyChart(containerId, figureJson) {
  const layout = { ...figureJson.layout, ...getPlotlyLayout() };
  if (figureJson.layout && figureJson.layout.title) layout.title = figureJson.layout.title;
  Plotly.newPlot(containerId, figureJson.data, layout, { responsive: true, displayModeBar: false });
}

function recolorPlotlyCharts() {
  document.querySelectorAll('.plotly-chart-div').forEach(el => {
    renderPlotlyChart(el.id, JSON.parse(el.dataset.figure));
  });
}

/* ── API block gate ───────────────────────────────────────── */
function blockApi(w) {
  apiBlocked = true;

  // Prominent banner at the top of main content
  const errSec = document.getElementById('errorsSection');
  errSec.classList.remove('hidden');
  errSec.innerHTML = renderWarning(w, true);   // true = fatal style

  // Disable chat input + send button
  const chatInput = document.getElementById('chatInput');
  const sendBtn   = document.getElementById('sendBtn');
  if (chatInput) { chatInput.disabled = true; chatInput.placeholder = 'API limit reached — reload to retry'; }
  if (sendBtn)   { sendBtn.disabled = true; }

  // Disable deep summary button
  const summaryBtn = document.getElementById('summaryBtn');
  if (summaryBtn) summaryBtn.disabled = true;
}

/* ── Drag & Drop ──────────────────────────────────────────── */
const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; handleUpload(e.dataTransfer.files[0]); }
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) handleUpload(fileInput.files[0]); });

/* ── Tables list ──────────────────────────────────────────── */
async function loadTablesList() {
  try {
    const res  = await fetch('/analyst/api/tables');
    const data = await res.json();
    renderTablesList(data.tables || [], data.active);
  } catch (err) {
    console.error('Failed to load tables:', err);
  }
}

function renderTablesList(tables, activeTable) {
  const sec  = document.getElementById('tablesSection');
  const list = document.getElementById('tablesList');
  if (!tables.length) { sec.classList.add('hidden'); list.innerHTML = ''; return; }
  sec.classList.remove('hidden');
  list.innerHTML = '';
  tables.forEach(t => {
    const item = document.createElement('div');
    item.className = `tbl-item${t.name === activeTable ? ' active' : ''}`;
    item.id = `tbl-${t.name}`;
    item.innerHTML = `
      <div class="tbl-item-info">
        <span class="tbl-name">${esc(t.name)}</span>
        <span class="tbl-meta">${t.row_count.toLocaleString()} rows × ${t.column_count} cols</span>
      </div>
      <button class="tbl-del-btn" title="Delete table">✕</button>`;
    item.addEventListener('click', () => activateTable(t.name));
    item.querySelector('.tbl-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteTable(t.name);
    });
    list.appendChild(item);
  });
}

async function activateTable(name) {
  if (apiBlocked) return;
  showLoading(true);
  try {
    const res  = await fetch(`/analyst/api/tables/${encodeURIComponent(name)}/activate`, { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      showLoading(false);
      appendChatWarning({ icon: '⚠️', title: 'Could not activate table', message: data.error });
      return;
    }

    // Update active highlight
    document.querySelectorAll('.tbl-item').forEach(el => el.classList.remove('active'));
    const item = document.getElementById(`tbl-${name}`);
    if (item) item.classList.add('active');

    // Update sidebar info
    document.getElementById('fileInfo').classList.remove('hidden');
    document.getElementById('fileStats').innerHTML =
      `<strong>${esc(name)}</strong><br>${data.shape.rows.toLocaleString()} rows × ${data.shape.columns} columns`;

    buildPreviewTable(data.columns, data.sample);
    renderAutoCharts(data.auto_charts || []);

    const errSec = document.getElementById('errorsSection');
    if (!data.from_cache) {
      errSec.classList.remove('hidden');
      errSec.innerHTML = renderWarning({
        icon: '💡', title: 'Charts not available',
        message: 'Auto-generated charts are only created on first upload. Re-upload this file to regenerate them.',
      });
    } else {
      errSec.classList.add('hidden');
      errSec.innerHTML = '';
    }

    chatHistory.length = 0;
    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('welcomeState').classList.add('hidden');
    document.getElementById('chatSection').classList.remove('hidden');
    refreshSummarySelector();

  } catch (err) {
    appendChatWarning({
      icon: '🔌', title: 'No response from server',
      message: 'Could not reach the backend. Please check that the server is running and try again.',
    });
  } finally {
    showLoading(false);
  }
}

async function deleteTable(name) {
  if (!confirm(`Delete table "${name}"?\n\nThis will permanently remove all data. This cannot be undone.`)) return;
  try {
    const res  = await fetch(`/analyst/api/tables/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) {
      alert(`Failed to delete: ${data.error}`);
      return;
    }
    // Remove item from list
    const item = document.getElementById(`tbl-${name}`);
    if (item) item.remove();

    // Hide the tables section if empty
    if (!document.querySelector('.tbl-item')) {
      document.getElementById('tablesSection').classList.add('hidden');
    }

    // If the deleted table was active, reset main content
    if (data.deleted === name) {
      document.getElementById('fileInfo').classList.add('hidden');
      document.getElementById('previewSection').classList.add('hidden');
      document.getElementById('chartsSection').classList.add('hidden');
      document.getElementById('chatSection').classList.add('hidden');
      document.getElementById('deepSummarySection').classList.add('hidden');
      document.getElementById('errorsSection').classList.add('hidden');
      document.getElementById('welcomeState').classList.remove('hidden');
      chatHistory.length = 0;
      document.getElementById('chatMessages').innerHTML = '';
    }
  } catch (err) {
    alert('Failed to delete table. Please try again.');
  }
}

/* ── Upload CSV ───────────────────────────────────────────── */
async function handleUpload(file) {
  showLoading(true);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res  = await fetch('/analyst/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    // Hard upload error (bad file, server error)
    if (data.error) {
      const w = typeof data.error === 'object' ? data.error : {
        icon: '📄', title: 'Upload failed',
        message: typeof data.error === 'string' ? data.error : 'Could not read the CSV file.',
      };
      if (w.fatal) { blockApi(w); return; }
      const errSec = document.getElementById('errorsSection');
      errSec.classList.remove('hidden');
      errSec.innerHTML = renderWarning(w);
      return;
    }

    // Refresh tables list and mark new table as active
    await loadTablesList();
    document.querySelectorAll('.tbl-item').forEach(el => el.classList.remove('active'));
    const newItem = document.getElementById(`tbl-${data.table_name}`);
    if (newItem) newItem.classList.add('active');

    // File info
    document.getElementById('fileInfo').classList.remove('hidden');
    document.getElementById('fileStats').innerHTML =
      `<strong>${esc(data.table_name || file.name)}</strong><br>${data.shape.rows.toLocaleString()} rows × ${data.shape.columns} columns`;

    buildPreviewTable(data.columns, data.sample);
    renderAutoCharts(data.auto_charts);

    // Errors / partial failures
    const errSec = document.getElementById('errorsSection');
    let errHtml = '';

    if (data.fatal_error) {
      blockApi(data.fatal_error);
      return;
    }
    if (data.rename_warning) {
      errHtml += renderWarning(data.rename_warning);
    }
    if (data.errors && data.errors.length > 0) {
      errHtml += data.errors.map(e => renderWarning({
        icon: e.icon || '⚠️',
        title: e.title ? `Couldn't generate "${e.title}"` : 'Chart generation issue',
        message: e.message || String(e),
      })).join('');
    }
    if (errHtml) { errSec.classList.remove('hidden'); errSec.innerHTML = errHtml; }
    else         { errSec.classList.add('hidden');    errSec.innerHTML = ''; }

    chatHistory.length = 0;
    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('welcomeState').classList.add('hidden');
    document.getElementById('chatSection').classList.remove('hidden');
    refreshSummarySelector();

  } catch (err) {
    const errSec = document.getElementById('errorsSection');
    errSec.classList.remove('hidden');
    errSec.innerHTML = renderWarning({
      icon: '🔌', title: 'No response from server',
      message: 'Could not reach the backend. Please check that the server is running and try again.',
    });
  } finally {
    showLoading(false);
  }
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

/* ── Data Preview Table ───────────────────────────────────── */
function buildPreviewTable(columns, sample) {
  document.getElementById('previewSection').classList.remove('hidden');
  let html = '<table><thead><tr>';
  columns.forEach(c => html += `<th>${esc(c)}</th>`);
  html += '</tr></thead><tbody>';
  sample.forEach(row => {
    html += '<tr>';
    columns.forEach(c => html += `<td>${esc(String(row[c] ?? ''))}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('dataPreview').innerHTML = html;
}

/* ── Render Auto Charts ───────────────────────────────────── */
let chartIdCounter = 0;

function renderAutoCharts(charts) {
  const grid = document.getElementById('chartsGrid');
  const sec  = document.getElementById('chartsSection');
  grid.innerHTML = '';
  if (!charts.length) { sec.classList.add('hidden'); return; }

  sec.classList.remove('hidden');
  document.getElementById('chartCount').textContent = `${charts.length} charts`;

  charts.forEach((chart, i) => {
    const chartId = `auto-chart-${chartIdCounter++}`;
    const codeId  = `code-${chartId}`;
    const card    = document.createElement('div');
    card.className = 'card chart-card';
    card.innerHTML = `
      <div class="card-header"><h3>📊 Chart ${i + 1}: ${esc(chart.title)}</h3></div>
      <div class="chart-container">
        <div id="${chartId}" class="plotly-chart-div" data-figure='${JSON.stringify(chart.figure_json)}'></div>
      </div>
      ${chart.explanation ? `<div class="chart-explanation">${esc(chart.explanation)}</div>` : ''}
      <button class="view-code-btn" onclick="toggleCode('${codeId}')">▸ View code</button>
      <div id="${codeId}" class="code-block"><pre>${esc(chart.code)}</pre></div>`;
    grid.appendChild(card);
    setTimeout(() => renderPlotlyChart(chartId, chart.figure_json), 50);
  });
}

function toggleCode(id) { document.getElementById(id).classList.toggle('visible'); }

/* ── Chat ─────────────────────────────────────────────────── */
document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

async function sendChat() {
  if (apiBlocked) {
    appendChatWarning({
      icon: '🚫', title: 'API limit reached',
      message: 'All AI requests have been stopped. Please reload the page and try again later.',
    });
    return;
  }

  const input    = document.getElementById('chatInput');
  const question = input.value.trim();
  if (!question) return;

  const explainWithChart = document.getElementById('chartToggle').checked;
  appendChatMsg('user', question);
  chatHistory.push({ role: 'user', text: question });
  input.value = '';

  const typingId = showTyping();

  try {
    const res  = await fetch('/analyst/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, explain_with_chart: explainWithChart, chat_history: chatHistory.slice(-10) }),
    });
    const data = await res.json();
    removeTyping(typingId);

    // HTTP-level plain-string error (e.g. "No CSV uploaded yet")
    if (!res.ok && typeof data.error === 'string') {
      appendChatWarning({ icon: 'ℹ️', title: 'Cannot answer yet', message: data.error });
      return;
    }

    if (data.type === 'chart') {
      appendChatMsg('assistant', data.explanation || '', data.figure_json, data.code);
      chatHistory.push({ role: 'assistant', text: data.explanation || '' });
      if (data.chart_render_error) appendChatWarning(data.chart_render_error);

    } else if (data.type === 'text') {
      appendChatMsg('assistant', data.content || '', data.chart_figure_json, data.chart_code, false, data.chart_explanation);
      chatHistory.push({ role: 'assistant', text: data.content || '' });
      if (data.chart_render_error) appendChatWarning(data.chart_render_error);

    } else if (data.type === 'sql') {
      appendSqlMsg(data.sql, data.columns || [], data.rows || [], data.sql_error, data.row_count, data.truncated);
      const summary = data.sql_error ? `SQL error: ${data.sql_error}` : `Query returned ${data.row_count} row(s).`;
      chatHistory.push({ role: 'assistant', text: summary });

    } else if (data.error && typeof data.error === 'object') {
      if (data.error.fatal) { blockApi(data.error); return; }
      appendChatWarning(data.error);

    } else {
      appendChatWarning({
        icon: '⚠️', title: 'Unexpected response',
        message: data.content || 'The server returned an unexpected response.',
      });
    }

    refreshSummarySelector();

  } catch (err) {
    removeTyping(typingId);
    appendChatWarning({
      icon: '🔌', title: 'No response from server',
      message: 'Could not reach the backend. Please check that the server is running and try again.',
    });
  }
}

/* ── Warning card helpers ─────────────────────────────────── */
function renderWarning(w, fatal = false) {
  const isFatal = fatal || w.fatal;
  const icon    = esc(w.icon    || '⚠️');
  const title   = esc(w.title   || 'Notice');
  const message = esc(w.message || '');
  const retry   = w.retry_after
    ? `<div class="warning-card-meta">Suggested retry: ${Math.ceil(w.retry_after)}s</div>` : '';
  return `
    <div class="warning-card${isFatal ? ' fatal' : ''}">
      <div class="warning-card-icon">${icon}</div>
      <div class="warning-card-body">
        <div class="warning-card-title">${title}</div>
        <div class="warning-card-text">${message}</div>
        ${retry}
      </div>
    </div>`;
}

function appendChatWarning(w) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.innerHTML = `<div class="avatar">🤖</div><div class="bubble">${renderWarning(w)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendChatMsg(role, text, figureJson, code, isError, chartExplanation) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;

  const avatar = role === 'user' ? '👤' : '🤖';
  let bubbleContent = isError
    ? `<div class="error-banner">${esc(text)}</div>`
    : `<div>${formatText(text)}</div>`;

  if (figureJson) {
    const chartId = `chat-chart-${chartIdCounter++}`;
    bubbleContent += `
      <div class="chat-chart">
        <div id="${chartId}" class="plotly-chart-div" data-figure='${JSON.stringify(figureJson)}' style="min-height:280px"></div>
        ${chartExplanation ? `<div class="chat-chart-explanation">💡 ${esc(chartExplanation)}</div>` : ''}
      </div>`;
    if (code) {
      const codeId = `code-${chartId}`;
      bubbleContent += `
        <button class="view-code-btn" onclick="toggleCode('${codeId}')"
          style="border:none;background:none;padding:6px 0;color:var(--text-muted);cursor:pointer;font-size:0.78rem">▸ View code</button>
        <div id="${codeId}" class="code-block" style="display:none">
          <pre style="font-size:0.72rem;color:var(--text-secondary)">${esc(code)}</pre>
        </div>`;
    }
    setTimeout(() => renderPlotlyChart(chartId, figureJson), 50);
  }

  div.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble">${bubbleContent}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendSqlMsg(sql, columns, rows, sqlError, rowCount, truncated) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';

  let html = '';

  if (sqlError) {
    html += renderWarning({
      icon: '⚠️',
      title: "Sorry, I couldn't answer that",
      message: 'Try rephrasing your question.',
    });
  } else if (!rows.length) {
    html += `<div class="sql-answer-empty">No matching results were found.</div>`;
  } else if (rows.length === 1 && columns.length === 1) {
    // Single-cell answer → render as a clean sentence
    const value = rows[0][columns[0]];
    html += `<div class="sql-answer-single"><strong>${esc(String(value ?? '—'))}</strong></div>`;
  } else if (rows.length === 1) {
    // Single-row answer → render as a tidy key/value list
    html += '<div class="sql-answer-card">';
    columns.forEach(c => {
      html += `<div class="sql-answer-row"><span class="sql-answer-key">${esc(String(c))}</span><span class="sql-answer-val">${esc(String(rows[0][c] ?? '—'))}</span></div>`;
    });
    html += '</div>';
  } else {
    // Multi-row answer → keep the table view (no SQL shown)
    html += '<div class="fmt-table-wrap"><table class="fmt-table"><thead><tr>';
    columns.forEach(c => { html += `<th>${esc(String(c))}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>';
      columns.forEach(c => { html += `<td>${esc(String(row[c] ?? ''))}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    const total = rowCount != null ? rowCount : rows.length;
    if (truncated) {
      html += `<div class="fmt-row-count"><span class="fmt-row-total">Showing first 500 of ${total}</span></div>`;
    }
  }

  div.innerHTML = `<div class="avatar">🤖</div><div class="bubble">${html}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

let typingCounter = 0;
function showTyping() {
  const id  = `typing-${typingCounter++}`;
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = id;
  div.innerHTML = `<div class="avatar">🤖</div><div class="bubble"><span class="spinner">Thinking</span></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}
function removeTyping(id) { const el = document.getElementById(id); if (el) el.remove(); }

/* ── Deep Summary ─────────────────────────────────────────── */
async function refreshSummarySelector() {
  try {
    const res  = await fetch('/analyst/api/all-charts');
    const data = await res.json();
    allCharts  = data.charts || [];
    const sec  = document.getElementById('deepSummarySection');
    if (!allCharts.length) { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');
    document.getElementById('summarySelect').innerHTML =
      allCharts.map((c, i) => `<option value="${i}">${esc(c.label)}</option>`).join('');
  } catch (err) {
    console.error('Failed to fetch charts:', err);
  }
}

async function getDeepSummary() {
  if (apiBlocked) {
    document.getElementById('summaryResult').innerHTML = renderWarning({
      icon: '🚫', title: 'API limit reached',
      message: 'All AI requests have been stopped. Please reload the page and try again later.',
    }, true);
    return;
  }

  const select    = document.getElementById('summarySelect');
  const chart     = allCharts[parseInt(select.value)];
  if (!chart) return;

  const btn       = document.getElementById('summaryBtn');
  const resultDiv = document.getElementById('summaryResult');
  btn.disabled    = true;
  btn.textContent = '⏳ Generating…';
  resultDiv.innerHTML = '';

  try {
    const res  = await fetch('/analyst/api/deep-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: chart.source, index: chart.index }),
    });
    const data = await res.json();

    if (data.error) {
      const w = typeof data.error === 'object' ? data.error
        : { icon: 'ℹ️', title: 'Cannot generate summary', message: data.error };
      if (w.fatal) { blockApi(w); resultDiv.innerHTML = renderWarning(w, true); return; }
      resultDiv.innerHTML = renderWarning(w);
    } else {
      resultDiv.innerHTML = `<div class="deep-summary-result">${formatText(data.summary)}</div>`;
    }
  } catch (err) {
    resultDiv.innerHTML = renderWarning({
      icon: '🔌', title: 'No response from server',
      message: 'Could not reach the backend. Please try again.',
    });
  } finally {
    btn.disabled    = false;
    btn.textContent = '📝 Get Deeper Summary';
  }
}

/* ── Helpers ──────────────────────────────────────────────── */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatText(text) {
  if (!text) return '';

  // 1. Fenced code blocks
  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang ? lang.toUpperCase() : 'CODE';
    const langClass = lang === 'sql' ? 'sql' : lang === 'python' ? 'python' : 'plain';
    const codeId    = 'cb-' + Math.random().toString(36).slice(2, 8);
    return `
      <div class="fmt-code-block">
        <div class="fmt-code-header">
          <span class="fmt-code-lang ${langClass}">${langLabel}</span>
          <button class="fmt-copy-btn" onclick="copyCode('${codeId}')">Copy</button>
        </div>
        <pre id="${codeId}" class="fmt-code-pre">${esc(code.trim())}</pre>
      </div>`;
  });

  // 2. Markdown tables
  text = text.replace(/((?:\|[^\n]+\|\n?)+)/g, tableBlock => {
    const rows   = tableBlock.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return tableBlock;
    const sepIdx = rows.findIndex(r => /^\|[\s\-|:]+\|/.test(r));
    if (sepIdx < 0) return tableBlock;
    const headerRow  = rows[sepIdx - 1] || rows[0];
    const dataRows   = rows.slice(sepIdx + 1);
    const parseCells = row => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseCells(headerRow);
    let html = '<div class="fmt-table-wrap"><table class="fmt-table"><thead><tr>';
    headers.forEach(h => { html += `<th>${esc(h)}</th>`; });
    html += '</tr></thead><tbody>';
    dataRows.forEach(row => {
      const cells = parseCells(row);
      html += '<tr>';
      cells.forEach(c => { html += `<td>${esc(c)}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  });

  // 3. Rows returned callout
  text = text.replace(/\*\*Rows returned: (\d+)\*\*\s*\*\(out of (\d+) total\)\*/g,
    '<div class="fmt-row-count">✓ <strong>$1 row(s)</strong> returned <span class="fmt-row-total">out of $2 total</span></div>');

  // 4. Filter note
  text = text.replace(/\*🔍 SQL filter applied: ?`([^`]*)`\s*→\s*\*\*(\d+ rows?)\*\* selected\*/g,
    '<div class="fmt-filter-note">🔍 SQL filter: <code>$1</code> → <strong>$2</strong> selected</div>');

  // 5. Inline markdown
  text = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,     '<em>$1</em>')
    .replace(/`(.*?)`/g,       '<code class="fmt-inline-code">$1</code>')
    .replace(/\n/g,            '<br>');

  return text;
}

function copyCode(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    const btn = el.previousElementSibling?.querySelector('.fmt-copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
  });
}

/* ── Init: load persisted tables on page load ─────────────── */
loadTablesList();
