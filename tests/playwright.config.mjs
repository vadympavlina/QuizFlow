// Автотести інтерфейсу: cd tests && npm ci && npm run e2e
// Сайт віддає простий статичний сервер, а Firebase підміняється моком (e2e/mock):
// дані живуть у localStorage сторінки, тож тести не ходять у справжню базу.
import { defineConfig } from "@playwright/test";

const PORT = 4173;
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.mjs$/,
  timeout: 90_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ..`,
    url: `http://127.0.0.1:${PORT}/404.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "ignore",
  },
});
