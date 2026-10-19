/* Firefox platform adapter for the shared Mask Relay core. */
(function (global) {
  const ORIGIN = 'https://api.mail.tm/*';
  global.Platform = {
    name: 'firefox',
    async http(method, url, headers, body) {
      const r = await fetch(url, { method, headers, body, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      return { status: r.status, text: await r.text() };
    },
    async load() { return (await browser.storage.local.get('masks')).masks || []; },
    save: masks => browser.storage.local.set({ masks }),
    copy: text => navigator.clipboard.writeText(text),
    badge: n => {
      browser.action.setBadgeText({ text: n ? String(n) : '' });
      browser.action.setBadgeBackgroundColor({ color: '#6a5af9' });
    },
    needsPermission: async () => !(await browser.permissions.contains({ origins: [ORIGIN] })),
    requestPermission: () => browser.permissions.request({ origins: [ORIGIN] }),
    onMasksChanged(cb) {
      browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.masks) cb(); });
    },
  };
})(globalThis);
