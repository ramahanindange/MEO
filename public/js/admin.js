/* MEO admin: reads submissions from the C++ API with a bearer token. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  let token = sessionStorage.getItem('meoToken') || '';
  let kind = 'messages', rows = [];

  const cols = {
    messages: ['created_at', 'name', 'email', 'phone', 'subject', 'message'],
    pledges: ['created_at', 'id', 'name', 'phone', 'email', 'amount', 'programme'],
    subscribers: ['created_at', 'email', 'name']
  };
  const labels = { created_at: 'Date', id: 'Reference' };

  async function api(path) {
    const r = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) throw new Error('Wrong token.');
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || 'Request failed.'); }
    return r.json();
  }

  function cell(k, v) {
    const td = document.createElement('td');
    if (k === 'created_at') v = new Date(v).toLocaleString('en-GB');
    if (k === 'amount') v = 'TSh ' + Number(v).toLocaleString('en-US');
    if (k === 'id') v = 'MEO-' + v;
    if (k === 'message') td.className = 'long';
    td.textContent = v == null ? '' : String(v);
    return td;
  }

  function draw() {
    const q = $('#filter').value.toLowerCase();
    const list = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
    const head = $('#tbl thead'), body = $('#tbl tbody');
    head.innerHTML = ''; body.innerHTML = '';
    const tr = document.createElement('tr');
    cols[kind].forEach((c) => { const th = document.createElement('th'); th.textContent = labels[c] || c; tr.append(th); });
    head.append(tr);
    list.forEach((r) => { const row = document.createElement('tr'); cols[kind].forEach((c) => row.append(cell(c, r[c]))); body.append(row); });
    $('#empty').hidden = list.length > 0;
  }

  async function load() {
    const s = await api('/api/admin/summary');
    const stats = [['Messages', s.messages], ['Pledges', s.pledges], ['Subscribers', s.subscribers], ['Pledged (TSh)', Number(s.pledged_total_tzs).toLocaleString('en-US')]];
    $('#stats').innerHTML = '';
    stats.forEach(([l, v]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = v; const sp = document.createElement('span'); sp.textContent = l; d.append(b, sp); $('#stats').append(d); });
    rows = (await api('/api/admin/' + kind)).rows;
    draw();
  }

  async function start() {
    try { await load(); $('#login').hidden = true; $('#dash').hidden = false; $('#logout').hidden = false; }
    catch (e) { $('#loginErr').textContent = e.message; sessionStorage.removeItem('meoToken'); }
  }

  $('#login').addEventListener('submit', (e) => { e.preventDefault(); token = $('#token').value.trim(); sessionStorage.setItem('meoToken', token); start(); });
  $('#logout').addEventListener('click', () => { sessionStorage.removeItem('meoToken'); location.reload(); });
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    kind = b.dataset.kind; $('#filter').value = ''; load().catch((e) => alert(e.message));
  }));
  $('#filter').addEventListener('input', draw);
  $('#refresh').addEventListener('click', () => load().catch((e) => alert(e.message)));
  $('#csv').addEventListener('click', async () => {
    const r = await fetch('/api/admin/' + kind + '.csv', { headers: { Authorization: 'Bearer ' + token } });
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = 'meo-' + kind + '.csv'; a.click(); URL.revokeObjectURL(url);
  });
  if (token) start();
})();
