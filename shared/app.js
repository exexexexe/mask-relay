const $ = (s, el = document) => el.querySelector(s);
const svg = markup => document.importNode(new DOMParser().parseFromString(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml').documentElement, true);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.append(svg(v)); // static icon markup only
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
};
const ICON = {
  copy: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5L20 7"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  flame: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c4 0 7-2.7 7-7 0-4-3-6-4-10-2 1.5-3 3.5-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4.3 3 7 7 7z"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m15 18-6-6 6-6"/></svg>',
  inbox: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  mask: '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M2 10c0-2.5 2.4-4 5-4h10c2.6 0 5 1.5 5 4 0 5-3.6 9-7.5 9-1.9 0-2.5-2-3.5-2s-1.6 2-3.5 2C3.6 19 2 15 2 10zm5.5 1.5a2 2 0 1 0 4 0 6 6 0 0 0-4 0zm9 0a6 6 0 0 0-4 0 2 2 0 1 0 4 0z"/></svg>',
  mail: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  shield: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/></svg>',
};

const state = { masks: [], unread: {}, active: null, messages: [], openMsg: null, query: '', loadingMsgs: false };
const seenIds = new Set();

const relay = MaskRelay.createRelay(Platform);
document.body.classList.add(Platform.name);

function toast(text, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, text);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, kind === 'err' ? 4200 : 1800);
}

function hue(str) { let x = 0; for (const c of str) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
function avatar(name, cls = 'avatar') {
  const n = (name || '?').trim();
  return h('div', { class: cls, style: `background:hsl(${hue(n)} 62% 56%)` }, (n[0] || '?').toUpperCase());
}
function ago(ts) {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function copy(text, btn) {
  try { await Platform.copy(text); }
  catch { const ta = h('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Address copied');
  if (btn) { const prev = [...btn.childNodes]; btn.replaceChildren(svg(ICON.check), ' Copied'); setTimeout(() => btn.replaceChildren(...prev), 1400); }
}

function setView(v) { $('#app').dataset.view = v; }

/* ---------- sidebar ---------- */
function renderMasks() {
  Platform.badge?.(Object.values(state.unread).reduce((a, b) => a + b, 0));
  const q = state.query.toLowerCase();
  const list = state.masks.filter(m => !q || m.label.toLowerCase().includes(q) || m.address.toLowerCase().includes(q));
  $('#maskCount').textContent = state.masks.length || '';
  const box = $('#masks');
  box.replaceChildren();
  if (!state.masks.length) {
    box.append(h('div', { class: 'empty', style: 'height:auto;padding:28px 12px' },
      h('p', {}, 'No masks yet. Create one and use it anywhere you\'d normally type your real email.')));
    return;
  }
  list.forEach((m, i) => {
    const n = state.unread[m.id] || 0;
    box.append(h('button', {
      class: 'mask' + (state.active?.id === m.id ? ' active' : ''),
      style: `animation-delay:${Math.min(i, 10) * 18}ms`,
      onclick: () => selectMask(m.id),
    }, avatar(m.label), h('div', { class: 'mask-info' },
      h('div', { class: 'mask-label' }, m.label),
      h('div', { class: 'mask-addr' }, m.address)),
      n ? h('span', { class: 'badge' }, String(n)) : null));
  });
}

function openNewForm() {
  $('#newBtn').style.display = 'none';
  $('#newForm').classList.add('open');
  $('#newLabel').value = '';
  $('#newLabel').focus();
}
function closeNewForm() {
  $('#newForm').classList.remove('open');
  $('#newBtn').style.display = '';
}

$('#newBtn').onclick = openNewForm;
$('#newCancel').onclick = closeNewForm;
$('#newForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#newSubmit');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const mask = await relay.createMask($('#newLabel').value);
    state.masks.unshift(mask);
    closeNewForm();
    await selectMask(mask.id);
    copy(mask.address);
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Create & copy'; }
};
$('#search').oninput = e => { state.query = e.target.value; renderMasks(); };

/* ---------- message list ---------- */
function renderList() {
  const el = $('#list');
  const m = state.active;
  if (!m) {
    el.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'art', html: ICON.mask }),
      h('h3', {}, state.masks.length ? 'Pick a mask' : 'Create your first mask'),
      h('p', {}, 'Each mask is a random address that receives mail for you. Sign up to things with it, read what arrives here, and burn it when the spam starts.')));
    return;
  }
  const title = h('h2', { title: 'Click to rename' }, m.label);
  title.onclick = () => startRename(title);
  const copyBtn = h('span', { class: 'copy', html: ICON.copy }, ' Copy');
  const refresh = h('button', { class: 'icon-btn', title: 'Refresh (R)', 'aria-label': 'Refresh', html: ICON.refresh, onclick: () => loadMessages(true) });
  refresh.id = 'refreshBtn';
  const head = h('div', { class: 'list-head' },
    h('div', { class: 'top' },
      h('button', { class: 'icon-btn back', 'aria-label': 'Back', html: ICON.back, onclick: () => setView('side') }),
      title, refresh,
      h('button', { class: 'icon-btn danger', title: 'Burn this mask', 'aria-label': 'Burn mask', html: ICON.flame, onclick: confirmBurn })),
    h('div', { class: 'addr-pill', title: 'Copy address (C)', onclick: () => copy(m.address, copyBtn) }, h('span', {}, m.address), copyBtn),
    h('div', { class: 'live' }, h('i'), 'Listening for new mail'));
  const msgs = h('div', { class: 'msgs', id: 'msgs' });
  el.replaceChildren(head, msgs);
  renderMsgs();
}

function renderMsgs() {
  const box = $('#msgs');
  if (!box) return;
  box.replaceChildren();
  if (state.loadingMsgs && !state.messages.length) {
    for (let i = 0; i < 5; i++) box.append(h('div', { class: 'skel' }, h('div', { style: 'width:40%' }), h('div', { style: 'width:75%' }), h('div', { style: 'width:90%' })));
    return;
  }
  if (!state.messages.length) {
    box.append(h('div', { class: 'empty' },
      h('div', { class: 'art', html: ICON.inbox }),
      h('h3', {}, 'Inbox is empty'),
      h('p', {}, 'Use this address to sign up somewhere. New mail appears here automatically.')));
    return;
  }
  state.messages.forEach((msg, i) => {
    const fresh = !seenIds.has(msg.id) && seenIds.size > 0;
    const name = msg.from.name || msg.from.address || 'Unknown sender';
    box.append(h('button', {
      class: 'msg' + (msg.seen ? '' : ' unread') + (state.openMsg?.id === msg.id ? ' active' : '') + (fresh ? ' fresh' : ''),
      style: `animation-delay:${Math.min(i, 12) * 15}ms`,
      'data-id': msg.id,
      onclick: () => openMessage(msg.id),
    },
      h('div', { class: 'msg-row' }, h('span', { class: 'msg-from' }, name), h('span', { class: 'msg-time' }, ago(msg.createdAt))),
      h('div', { class: 'msg-subj' }, msg.subject || '(no subject)'),
      msg.intro ? h('div', { class: 'msg-intro' }, msg.intro) : null));
  });
  state.messages.forEach(m => seenIds.add(m.id));
}

function startRename(el) {
  el.contentEditable = 'true'; el.focus();
  document.getSelection().selectAllChildren(el);
  const finish = async save => {
    el.contentEditable = 'false';
    el.onblur = el.onkeydown = null;
    const label = el.textContent.trim();
    if (!save || !label || label === state.active.label) { el.textContent = state.active.label; return; }
    try {
      const upd = await relay.renameMask(state.active.id, label);
      Object.assign(state.masks.find(m => m.id === upd.id), upd);
      state.active.label = upd.label;
      renderMasks(); toast('Renamed');
    } catch (err) { el.textContent = state.active.label; toast(err.message, 'err'); }
  };
  el.onblur = () => finish(true);
  el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') finish(false); };
}

function confirmBurn() {
  const m = state.active;
  const close = () => bg.remove();
  const go = h('button', { class: 'btn-danger' }, 'Burn it');
  const bg = h('div', { class: 'modal-bg', onclick: e => e.target === bg && close() },
    h('div', { class: 'modal', role: 'dialog' },
      h('h3', {}, `Burn “${m.label}”?`),
      h('p', {}, `${m.address} will be deleted at the provider along with every message in it. Anything still sending to it will bounce. This can't be undone.`),
      h('div', { class: 'row' }, h('button', { class: 'btn-ghost', onclick: close }, 'Keep it'), go)));
  go.onclick = async () => {
    go.disabled = true; go.textContent = 'Burning…';
    try {
      await relay.burnMask(m.id);
      state.masks = state.masks.filter(x => x.id !== m.id);
      delete state.unread[m.id];
      state.active = null; state.messages = []; state.openMsg = null;
      close(); renderMasks(); renderList(); renderReader(); setView('side');
      toast('Mask burned 🔥');
    } catch (err) { close(); toast(err.message, 'err'); }
  };
  document.body.append(bg);
  go.focus();
}

/* ---------- reader ---------- */
function renderReader(detail) {
  const el = $('#reader');
  if (!detail) {
    el.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'art', html: ICON.mail }),
      h('h3', {}, 'Nothing selected'),
      h('p', {}, 'Messages open here inside a locked-down viewer: no scripts, no tracking pixels, no read receipts.')));
    return;
  }
  const name = detail.from.name || detail.from.address || 'Unknown sender';
  const { doc, remote } = MaskRelay.renderMessage(detail, !!detail.imagesOn);
  detail.remoteContent = remote;
  const shield = detail.remoteContent
    ? h('div', { class: 'shield' + (detail.imagesOn ? ' warn' : ''), html: ICON.shield },
        h('span', {}, detail.imagesOn
          ? 'Remote images loaded — the sender can see you opened this and your IP address.'
          : `Blocked ${detail.remoteContent} remote image${detail.remoteContent > 1 ? 's' : ''} / tracker${detail.remoteContent > 1 ? 's' : ''}.`),
        h('button', { onclick: () => toggleImages(detail) }, detail.imagesOn ? 'Block again' : 'Load anyway'))
    : h('div', { class: 'shield', html: ICON.shield }, h('span', {}, 'No trackers found. Viewer is sandboxed.'));
  const frame = h('iframe', {
    sandbox: 'allow-popups allow-popups-to-escape-sandbox',
    referrerpolicy: 'no-referrer',
    title: 'Message body',
  });
  frame.srcdoc = doc;
  frame.onload = () => frame.classList.add('ready');
  el.replaceChildren(
    h('div', { class: 'reader-head' },
      h('div', { class: 'top' },
        h('button', { class: 'icon-btn back', 'aria-label': 'Back', html: ICON.back, onclick: () => setView('list') }),
        h('h2', {}, detail.subject || '(no subject)'),
        h('button', { class: 'icon-btn danger', title: 'Delete message (Del)', 'aria-label': 'Delete message', html: ICON.trash, onclick: deleteMessage })),
      h('div', { class: 'meta' }, avatar(name),
        h('div', { class: 'meta-text' },
          h('div', { class: 'meta-name' }, name),
          h('div', { class: 'meta-sub' }, `${detail.from.address || ''} → ${state.active.label} · ${new Date(detail.createdAt).toLocaleString()}`))),
      shield,
      detail.attachments.length ? h('div', { class: 'attach' }, detail.attachments.map(a => h('span', {}, `📎 ${a.filename}`))) : null),
    h('div', { class: 'frame-wrap' }, frame));
}

function toggleImages(detail) { detail.imagesOn = !detail.imagesOn; renderReader(detail); }

async function openMessage(id) {
  const maskId = state.active.id;
  const stub = state.messages.find(m => m.id === id);
  state.openMsg = { id };
  if (stub) stub.seen = true;
  renderMsgs(); setView('reader');
  try {
    const detail = await relay.getMessage(maskId, id);
    if (state.active?.id !== maskId || state.openMsg?.id !== id) return;
    state.openMsg = detail;
    state.unread[maskId] = state.messages.filter(m => !m.seen).length;
    renderMasks(); renderReader(detail);
  } catch (err) { toast(err.message, 'err'); }
}

async function deleteMessage() {
  const id = state.openMsg?.id; if (!id) return;
  const idx = state.messages.findIndex(m => m.id === id);
  try {
    await relay.deleteMessage(state.active.id, id);
    state.messages.splice(idx, 1);
    const next = state.messages[Math.min(idx, state.messages.length - 1)];
    state.openMsg = null; renderMsgs(); renderReader();
    toast('Message deleted');
    if (next) openMessage(next.id); else setView('list');
  } catch (err) { toast(err.message, 'err'); }
}

/* ---------- data flow ---------- */
async function selectMask(id) {
  const m = state.masks.find(x => x.id === id);
  if (!m) return;
  if (state.active?.id !== id) { state.messages = []; state.openMsg = null; seenIds.clear(); }
  state.active = m;
  renderMasks(); renderList(); renderReader(state.openMsg?.subject ? state.openMsg : null);
  setView('list');
  await loadMessages();
}

async function loadMessages(manual = false) {
  const m = state.active; if (!m) return;
  const btn = $('#refreshBtn');
  btn?.classList.add('spin');
  state.loadingMsgs = true; if (!state.messages.length) renderMsgs();
  try {
    const msgs = await relay.listMessages(m.id);
    if (state.active?.id !== m.id) return;
    const before = state.messages.length ? new Set(state.messages.map(x => x.id)) : null;
    const arrived = before ? msgs.filter(x => !before.has(x.id)).length : 0;
    state.messages = msgs;
    state.unread[m.id] = msgs.filter(x => !x.seen).length;
    renderMasks(); renderMsgs();
    if (arrived) toast(`${arrived} new message${arrived > 1 ? 's' : ''} for ${m.label}`);
    else if (manual) toast('Up to date');
  } catch (err) {
    if (manual) toast(err.message, 'err');
    if (state.active?.id === m.id && !state.messages.length) {
      $('#msgs')?.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'art', html: ICON.inbox }),
        h('h3', {}, "Couldn't load this inbox"),
        h('p', {}, err.status === 401 ? 'The provider no longer recognises this mask — it may have expired. You can burn it and make a new one.' : err.message),
        h('button', { class: 'btn-ghost', style: 'padding:8px 14px;border-radius:9px;font-weight:600', onclick: () => loadMessages(true) }, 'Try again')));
    }
  }
  finally { state.loadingMsgs = false; setTimeout(() => btn?.classList.remove('spin'), 300); }
}

async function refreshUnreadAll() {
  for (const m of state.masks) {
    if (m.id === state.active?.id) continue;
    try {
      const msgs = await relay.listMessages(m.id);
      state.unread[m.id] = msgs.filter(x => !x.seen).length;
    } catch {}
  }
  renderMasks();
}

async function reloadMasks() {
  state.masks = await relay.listMasks();
  if (state.active && !state.masks.some(m => m.id === state.active.id)) {
    state.active = null; state.messages = []; state.openMsg = null;
    renderList(); renderReader();
  }
  renderMasks();
}

async function checkPermission() {
  const box = $('#banner');
  if (!Platform.needsPermission || !(await Platform.needsPermission())) return box.replaceChildren();
  box.replaceChildren(h('div', { class: 'banner' },
    h('div', {}, 'One more step: allow Mask Relay to talk to the mail provider (mail.tm) so it can create masks and fetch mail.'),
    h('button', { onclick: async () => { if (await Platform.requestPermission()) { box.replaceChildren(); refreshUnreadAll(); } } }, 'Allow access')));
}

async function init() {
  try { state.masks = await relay.listMasks(); }
  catch (err) { toast(err.message, 'err'); }
  renderMasks(); renderList(); renderReader();
  await checkPermission();
  Platform.onMasksChanged?.(() => reloadMasks().then(refreshUnreadAll));
  refreshUnreadAll();
  setInterval(() => { if (!document.hidden) loadMessages(); }, 8000);
  setInterval(() => { if (!document.hidden) refreshUnreadAll(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadMessages(); });
}

/* ---------- theme ---------- */
try { const t = localStorage.getItem('mr-theme'); if (t && !document.documentElement.dataset.theme) document.documentElement.dataset.theme = t; } catch {}
$('#themeBtn').onclick = () => {
  const dark = getComputedStyle(document.body).backgroundColor === 'rgb(14, 13, 19)';
  const t = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mr-theme', t); } catch {}
  Platform.setTheme?.(t);
};

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === 'Escape') {
    if ($('.modal-bg')) return $('.modal-bg').remove();
    if (typing) { e.target.blur(); closeNewForm(); return; }
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $('.modal-bg')) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); openNewForm(); }
  else if (k === '/') { e.preventDefault(); $('#search').focus(); }
  else if (k === 'c' && state.active) copy(state.active.address);
  else if (k === 'r' && state.active) loadMessages(true);
  else if ((k === 'j' || k === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') && state.messages.length) {
    e.preventDefault();
    const i = state.messages.findIndex(m => m.id === state.openMsg?.id);
    const down = k === 'j' || e.key === 'ArrowDown';
    const next = state.messages[Math.max(0, Math.min(state.messages.length - 1, i < 0 ? 0 : i + (down ? 1 : -1)))];
    openMessage(next.id);
    document.querySelector(`.msg[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && state.openMsg) deleteMessage();
});

init();
