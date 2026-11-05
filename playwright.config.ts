import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8787",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "th-TH",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium",
          args: ["--no-sandbox"],
        },
      },
    },
  ],
});
