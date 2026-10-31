export default {
  testDir: '.',
  timeout: 60000,
  retries: 0,
  use: { headless: true },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'python3 -m http.server 8765 --directory /workspace/ai-browser/web',
    port: 8765,
    reuseExistingServer: true,
    timeout: 120000,
  },
};
