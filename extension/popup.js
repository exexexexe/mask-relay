const relay = MaskRelay.createRelay(Platform);
const $ = s => document.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
  el.append(...kids.filter(k => k != null));
  return el;
};
const hue = s => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };

function toast(text, err) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, text);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, err ? 3500 : 1500);
}

async function copy(address, btn) {
  await Platform.copy(address);
  if (btn) { btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = 'Copy'), 1200); }
}

async function render() {
  const masks = await relay.listMasks();
  const list = $('#list');
  list.replaceChildren();
  if (!masks.length) return list.append(h('div', { class: 'p-empty' }, 'No masks yet — make one above, or right-click any email field on a website.'));
  masks.forEach((m, i) => {
    const btn = h('button', { class: 'copy' }, 'Copy');
    btn.onclick = () => copy(m.address, btn);
    const n = m.label.trim() || '?';
    list.append(h('div', { class: 'p-row', style: `animation-delay:${Math.min(i, 8) * 20}ms` },
      h('div', { class: 'avatar', style: `background:hsl(${hue(n)} 62% 56%)` }, n[0].toUpperCase()),
      h('div', { class: 'mask-info' }, h('div', { class: 'mask-label' }, m.label), h('div', { class: 'mask-addr' }, m.address)),
      btn));
  });
}

$('#openApp').onclick = () => { browser.runtime.sendMessage({ type: 'open-app' }); window.close(); };

$('#newForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#newSubmit');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const mask = await relay.createMask($('#newLabel').value);
    await copy(mask.address);
    toast('Copied ' + mask.address);
    $('#newLabel').value = '';
    await render();
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = 'New mask'; }
};

(async () => {
  if (await Platform.needsPermission()) {
    $('#banner').append(h('div', { class: 'banner' },
      h('div', {}, 'Allow Mask Relay to reach the mail provider (mail.tm) to get started.'),
      h('button', { onclick: async () => { if (await Platform.requestPermission()) $('#banner').replaceChildren(); } }, 'Allow access')));
  }
  // Suggest the current site as the label — it's only stored locally.
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const host = new URL(tab.url).hostname.replace(/^www\./, '');
    if (host && /^https?:/.test(tab.url)) $('#newLabel').value = host;
  } catch {}
  $('#newLabel').select();
  render();
})();
