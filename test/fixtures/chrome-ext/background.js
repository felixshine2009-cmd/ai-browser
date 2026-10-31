chrome.runtime.onMessage.addListener(function (m, s, send) { send({ pong: 'bg-ok' }); return true; });
