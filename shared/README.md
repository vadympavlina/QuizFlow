# QuizFlow — Повний пакет (v7)

## Що тут

**Кореневий рівень (11 HTML + 404):**
- `index.html` — дашборд
- `tests.html`, `attempts.html`, `links.html`, `students.html`
- `analytics.html`, `gradebook.html`, `notifications.html`
- `suspicious.html`, `online.html`, `news.html`
- `404.html` — сторінка "не знайдено"

**Папка `shared/` (5 файлів):**
- `app.js` — Firebase, auth, sidebar/modals loader, дані
- `features.js` — весь G-namespace, рендерери, AI, realtime
- `layout.html` — sidebar шаблон
- `modals.html` — всі модалки (підвантажуються один раз)
- `styles.css` — всі стилі

## Що нового в v7 (оптимізація)

1. **Розумний `renderAll()`** — викликає тільки ті рендерери, чиї DOM-елементи є на сторінці. Більше немає жовтих warnings у Console.
2. **Паралельне завантаження** — `shared/app.js` і `shared/features.js` качаються одночасно через `<link rel="modulepreload">` + `<link rel="preload" as="fetch">`. Швидший first render.
3. **Модалки через fetch** — всі модалки винесено в `shared/modals.html`. Кожна HTML-сторінка схудла **з 33KB до 6-8KB** (економія ~25KB × 11 сторінок = ~275KB).

## Deploy

1. **Видали** `tests-new.html` з репо (пілот більше не потрібен)
2. **Залий** 11 HTML + `404.html` в корінь
3. **Залий** папку `shared/` з 5 файлами
4. Commit + push → 30-60 сек → відкривай

## Не чіпай у своєму репо

- `login.html`, `test.html`, `admin.html`, `admin-login.html`, `constructor.html`, `live.html`
- `firebase.json`, `functions/`, `js/`

## Cache-busting

У HTML є `?v=7`. Коли я даватиму нові правки — версія зросте (`?v=8`, `?v=9`).
Користувачам нічого чистити не треба — новий URL = новий кеш.
