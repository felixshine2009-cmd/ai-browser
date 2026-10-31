export default {
  testDir: '.', timeout: 60000, use: { headless: true },
  projects: [ { name: 'chromium', use: { browserName: 'chromium' } } ],
  webServer: { command: 'python3 -m http.server 8765 --directory ' + new URL('../web', import.meta.url).pathname, port: 8765, reuseExistingServer: false, timeout: 120000 },
};
