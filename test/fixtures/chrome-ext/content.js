document.documentElement.setAttribute('data-aib-test-ext', 'content-ran');
try {
  chrome.runtime.sendMessage({ ping: 1 }, function (r) { document.documentElement.setAttribute('data-aib-test-bg', r && r.pong ? r.pong : 'no-reply'); });
} catch (e) { document.documentElement.setAttribute('data-aib-test-bg', 'err:' + e.message); }
try { chrome.storage.local.set({ fromContent: Date.now() }, function () { document.documentElement.setAttribute('data-aib-test-storage', 'ok'); }); } catch (e) { document.documentElement.setAttribute('data-aib-test-storage', 'err'); }
