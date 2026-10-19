/* Background: unread badge, new-mail notifications, and the
 * "Fill with a new mask" context menu on email fields. */
const relay = MaskRelay.createRelay(Platform);
const APP_URL = browser.runtime.getURL('app.html');

async function openApp() {
  const [tab] = await browser.tabs.query({ url: APP_URL });
  if (tab) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url: APP_URL });
  }
}

async function poll() {
  if (await Platform.needsPermission()) return;
  const masks = await relay.listMasks();
  const { notified = [] } = await browser.storage.local.get('notified');
  const known = new Set(notified);
  const firstRun = !notified.length;
  let unread = 0;
  const fresh = [];
  for (const mask of masks) {
    try {
      for (const msg of await relay.listMessages(mask.id)) {
        if (!msg.seen) unread++;
        if (!known.has(msg.id)) { known.add(msg.id); if (!msg.seen) fresh.push({ mask, msg }); }
      }
    } catch { /* provider hiccup — try again next tick */ }
  }
  Platform.badge(unread);
  await browser.storage.local.set({ notified: [...known].slice(-2000) });
  if (firstRun || !fresh.length) return;
  const { mask, msg } = fresh[0];
  browser.notifications.create('mail', {
    type: 'basic',
    iconUrl: 'icons/icon-96.png',
    title: fresh.length > 1 ? `${fresh.length} new emails` : `New email for ${mask.label}`,
    message: fresh.length > 1 ? fresh.map(f => f.mask.label).filter((v, i, a) => a.indexOf(v) === i).join(', ') : `${msg.from.name || msg.from.address}: ${msg.subject || '(no subject)'}`,
  });
}

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({ id: 'fill-mask', title: 'Fill with a new Mask Relay address', contexts: ['editable'] });
  browser.menus.create({ id: 'open-app', title: 'Open Mask Relay inbox', contexts: ['action'] });
});

browser.alarms.create('poll', { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener(a => { if (a.name === 'poll') poll(); });
browser.notifications.onClicked.addListener(openApp);
browser.runtime.onMessage.addListener(m => { if (m?.type === 'open-app') return openApp(); });

browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-app') return openApp();
  if (info.menuItemId !== 'fill-mask') return;
  let site = 'Website';
  try { site = new URL(tab.url).hostname.replace(/^www\./, '') || site; } catch {}
  try {
    // The site name is only used as the local label; it never leaves the browser.
    const mask = await relay.createMask(site);
    await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId || 0] },
      args: [mask.address],
      func: address => {
        const el = document.activeElement;
        if (!el) return;
        if (el.isContentEditable) { el.textContent = address; }
        else {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
          setter ? setter.call(el, address) : (el.value = address);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
    });
    browser.notifications.create({ type: 'basic', iconUrl: 'icons/icon-96.png', title: `New mask for ${site}`, message: mask.address });
  } catch (e) {
    browser.notifications.create({ type: 'basic', iconUrl: 'icons/icon-96.png', title: "Couldn't create a mask", message: e.message });
  }
});

poll();
