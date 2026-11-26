// Старі адреси quizflow.space (до розділення на піддомени) → нові піддомени.
// GitHub Pages не вміє 301, тому на місці старих сторінок лежать маленькі переадресації:
// <meta refresh> + canonical + JS, що зберігає ?query і #hash. Google сприймає їх як переїзд замість 404.
// Запуск: cd tests && npm run legacy
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP = "https://app.quizflow.space", ADMIN = "https://admin.quizflow.space", PLAY = "https://play.quizflow.space", TEST = "https://test.quizflow.space";

const map = {};
for (const p of ["analytics", "attempts", "auth-action", "constructor", "game-history", "gradebook", "links", "live", "login", "news", "notifications",
  "onboarding", "online", "profile", "register", "students", "suspicious", "tests", "live/lobby", "live/play-teacher", "live/podium", "live/setup"]) map[p] = `${APP}/${p}`;
for (const p of ["admin-login", "ai-settings", "announcements", "audit", "cleanup", "features", "invites", "mail", "navigation", "news", "overview", "problems", "roles", "stats", "teachers", "telegram"])
  map[`admin/${p}`] = `${ADMIN}/${p}`;
map.play = `${PLAY}/`; map.test = `${TEST}/`;
map["live/play-student"] = `${PLAY}/live/play-student`; map["live/student-result"] = `${PLAY}/live/student-result`;

const page = to => `<!DOCTYPE html>
<html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QuizFlow переїхав</title>
<link rel="canonical" href="${to}">
<meta http-equiv="refresh" content="0;url=${to}">
<script>location.replace(${JSON.stringify(to)} + location.search + location.hash)</script>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#0B1437;background:#F1F4FF}a{color:#2D5BE3;font-weight:700}</style>
</head><body><p>Сторінка переїхала: <a href="${to}">${to.replace("https://", "")}</a></p></body></html>
`;
for (const [path, to] of Object.entries(map)) {
  const file = join(root, path + ".html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(to));
}
console.log(`Переадресацій: ${Object.keys(map).length}`);
