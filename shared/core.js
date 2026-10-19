/* Mask Relay core — mail.tm client, mask storage and the tracker-stripping
 * message renderer. Platform-agnostic: each build supplies a `Platform`
 * object with http(), load(), save() (see extension/ and macos/). */
(function (global) {
  'use strict';

  const API = 'https://api.mail.tm';
  const ADJ = 'amber brisk calm dusky eager fern gentle hollow ivory jolly keen lunar misty noble olive pale quiet rapid silver tidy umber vivid windy young zesty'.split(' ');
  const NOUN = 'otter heron maple comet cedar falcon harbor lark meadow nimbus orchid pebble quartz raven sparrow thistle willow badger canyon delta ember fjord glacier'.split(' ');
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  const rand = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const pick = a => a[rand(a.length)];
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
  const randomPassword = () => Array.from({ length: 28 }, () => ALNUM[rand(ALNUM.length)]).join('');
  const randomLocalPart = () => `${pick(ADJ)}${pick(NOUN)}${1000 + rand(9000)}`;

  class RelayError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const members = p => (Array.isArray(p) ? p : (p && p['hydra:member']) || []);
  const publicMask = m => ({ id: m.id, label: m.label, address: m.address, createdAt: m.createdAt });

  function createRelay(platform) {
    const tokens = new Map();
    let queue = Promise.resolve();

    async function request(method, path, { body, token, type = 'application/json' } = {}) {
      const headers = { Accept: 'application/ld+json' };
      if (body !== undefined) headers['Content-Type'] = type;
      if (token) headers.Authorization = 'Bearer ' + token;
      let res;
      try {
        res = await platform.http(method, API + path, headers, body === undefined ? undefined : JSON.stringify(body));
      } catch {
        throw new RelayError(0, "Can't reach the mail provider — check your connection.");
      }
      let data = null;
      try { data = res.text ? JSON.parse(res.text) : null; } catch { /* non-JSON body */ }
      if (res.status === 429) throw new RelayError(429, 'Provider is rate-limiting — slow down a moment.');
      if (res.status >= 400) {
        const detail = data && (data['hydra:description'] || data.detail || data.message);
        throw new RelayError(res.status, detail || `Mail provider returned ${res.status}`);
      }
      return data;
    }

    async function token(mask, refresh = false) {
      if (!refresh && tokens.has(mask.id)) return tokens.get(mask.id);
      const res = await request('POST', '/token', { body: { address: mask.address, password: mask.password } });
      tokens.set(mask.id, res.token);
      return res.token;
    }

    async function authed(mask, method, path, opts = {}) {
      try {
        return await request(method, path, { ...opts, token: await token(mask) });
      } catch (e) {
        if (e.status !== 401) throw e;
        return request(method, path, { ...opts, token: await token(mask, true) });
      }
    }

    // Serialise read-modify-write cycles so concurrent edits never clobber each other.
    function mutate(fn) {
      const run = queue.then(async () => {
        const masks = await platform.load();
        const result = fn(masks);
        await platform.save(masks);
        return result;
      });
      queue = run.catch(() => {});
      return run;
    }

    async function find(id) {
      const mask = (await platform.load()).find(m => m.id === id);
      if (!mask) throw new RelayError(404, 'That mask no longer exists.');
      return mask;
    }

    return {
      async listMasks() {
        return (await platform.load()).map(publicMask);
      },

      async createMask(label) {
        const domains = members(await request('GET', '/domains')).filter(d => d.isActive !== false).map(d => d.domain);
        if (!domains.length) throw new RelayError(503, 'Provider has no active domains right now.');
        const password = randomPassword();
        let address, account;
        for (let i = 0; i < 5 && !account; i++) {
          address = `${randomLocalPart()}@${pick(domains)}`;
          try {
            account = await request('POST', '/accounts', { body: { address, password } });
          } catch (e) {
            if (e.status !== 422) throw e; // 422 = address taken, roll again
          }
        }
        if (!account) throw new RelayError(409, "Couldn't find a free address — try again.");
        const mask = {
          id: randomId(),
          label: String(label || '').trim().slice(0, 60) || 'Untitled',
          address, password,
          accountId: account.id,
          createdAt: Math.floor(Date.now() / 1000),
        };
        await mutate(masks => masks.unshift(mask));
        return publicMask(mask);
      },

      async renameMask(id, label) {
        label = String(label || '').trim().slice(0, 60);
        return mutate(masks => {
          const m = masks.find(x => x.id === id);
          if (!m) throw new RelayError(404, 'That mask no longer exists.');
          if (label) m.label = label;
          return publicMask(m);
        });
      },

      async burnMask(id) {
        const mask = await find(id);
        try {
          await authed(mask, 'DELETE', `/accounts/${mask.accountId}`);
        } catch (e) {
          if (e.status !== 401 && e.status !== 404) throw e; // already gone upstream is fine
        }
        tokens.delete(id);
        await mutate(masks => { const i = masks.findIndex(m => m.id === id); if (i >= 0) masks.splice(i, 1); });
      },

      async listMessages(id) {
        const mask = await find(id);
        return members(await authed(mask, 'GET', '/messages?page=1')).map(m => ({
          id: m.id,
          from: m.from || {},
          subject: m.subject || '',
          intro: m.intro || '',
          seen: !!m.seen,
          hasAttachments: !!m.hasAttachments,
          createdAt: m.createdAt,
        }));
      },

      async getMessage(id, messageId) {
        const mask = await find(id);
        const m = await authed(mask, 'GET', `/messages/${messageId}`);
        if (!m.seen) {
          authed(mask, 'PATCH', `/messages/${messageId}`, { body: { seen: true }, type: 'application/merge-patch+json' }).catch(() => {});
        }
        return {
          id: m.id,
          from: m.from || {},
          to: m.to || [],
          subject: m.subject || '',
          createdAt: m.createdAt,
          html: (m.html || []).join(''),
          text: m.text || '',
          attachments: (m.attachments || []).map(a => ({ filename: a.filename, size: a.size })),
        };
      },

      async deleteMessage(id, messageId) {
        await authed(await find(id), 'DELETE', `/messages/${messageId}`);
      },
    };
  }

  /* ---------- message rendering ---------- */

  const REMOTE = /^\s*(?:https?:)?\/\//i;
  const CSS_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;
  const DANGEROUS_URL = /^\s*(?:javascript|vbscript|data:text\/html)/i;
  const STRIP = 'script,iframe,frame,frameset,object,embed,applet,link,meta,base,audio,video,source,track,portal';

  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function stripCss(css, allow, counter) {
    return css.replace(CSS_URL, m => { counter.n++; return allow ? m : 'none'; });
  }

  function sanitize(html, allow) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const counter = { n: 0 };
    doc.querySelectorAll(STRIP).forEach(e => e.remove());
    for (const el of doc.querySelectorAll('*')) {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (n.startsWith('on')) { el.removeAttribute(a.name); continue; }
        if (/^(href|src|action|formaction|xlink:href)$/.test(n) && DANGEROUS_URL.test(a.value)) { el.removeAttribute(a.name); continue; }
        const remote = /^(src|background|poster|xlink:href)$/.test(n) ? REMOTE.test(a.value)
          : n === 'srcset' && /(?:https?:)?\/\//i.test(a.value);
        if (remote) {
          counter.n++;
          if (!allow) el.removeAttribute(a.name);
        } else if (n === 'style' && /url\(/i.test(a.value)) {
          el.setAttribute('style', stripCss(a.value, allow, counter));
        }
      }
      if (el.tagName === 'STYLE') el.textContent = stripCss(el.textContent, allow, counter);
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    }
    const styles = [...doc.querySelectorAll('style')].map(s => { s.remove(); return s.outerHTML; }).join('');
    const bodyAttrs = [...doc.body.attributes].map(a => ` ${a.name}="${escapeHtml(a.value)}"`).join('');
    return { styles, bodyAttrs, body: doc.body.innerHTML, remote: counter.n };
  }

  const BASE_CSS =
    'html{background:#fff;color:#1a1a1a}' +
    "body{margin:0;padding:24px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-wrap:break-word}" +
    'img{max-width:100%;height:auto}a{color:#4b3fd6}' +
    '.mr-text{white-space:pre-wrap;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}';

  /** Build the document for the sandboxed reader frame. Remote content is
   *  stripped AND blocked by an embedded CSP unless allowImages is true. */
  function renderMessage(msg, allowImages) {
    let styles = '', bodyAttrs = '', body, remote = 0;
    if (msg.html) {
      ({ styles, bodyAttrs, body, remote } = sanitize(msg.html, allowImages));
    } else {
      const text = escapeHtml(msg.text || '(empty message)')
        .replace(/https?:\/\/[^\s<>"')\]]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
      body = `<pre class="mr-text">${text}</pre>`;
    }
    const csp = `default-src 'none'; img-src data:${allowImages ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:; form-action 'none'`;
    const doc = '<!doctype html><html><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      '<meta name="referrer" content="no-referrer">' +
      `<style>${BASE_CSS}</style>${styles}</head><body${bodyAttrs}>${body}</body></html>`;
    return { doc, remote };
  }

  global.MaskRelay = { createRelay, renderMessage, RelayError };
})(typeof window !== 'undefined' ? window : globalThis);
