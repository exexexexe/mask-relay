/* macOS platform adapter: everything goes through the native "relay" bridge. */
(function (global) {
  const bridge = msg => global.webkit.messageHandlers.relay.postMessage(msg);
  global.Platform = {
    name: 'mac',
    http: (method, url, headers, body) => bridge({ op: 'http', method, url, headers, body }),
    async load() { try { return JSON.parse(await bridge({ op: 'load' })) || []; } catch { return []; } },
    save: masks => bridge({ op: 'save', data: JSON.stringify(masks, null, 2) }),
    copy: text => bridge({ op: 'copy', text }),
    badge: n => bridge({ op: 'badge', n }),
    setTheme: theme => bridge({ op: 'theme', theme }),
  };
})(window);
