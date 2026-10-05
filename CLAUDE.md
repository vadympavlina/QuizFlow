# QuizFlow — правила для роботи з кодом

## Дизайн
- **Жодних емодзі в інтерфейсі.** Іконки — лише inline SVG (stroke, `currentColor`), позначки — текстом або CSS (крапка, смужка). Емодзі в контенті, який пишуть люди (назви тестів, тексти новин з адмінки тощо), не чіпаємо — правило лише про інтерфейс.
- **Жодних стандартних дропдаунів** (`<select>`, `<datalist>`, `<input type="date">`). Для вибору — власний `qfDrop` з `shared/features.js`, для кількох варіантів — кнопки-чипи чи таби.
- Шрифти: Manrope (текст) і Geist Mono (цифри). Мова інтерфейсу — українська.

## Інфраструктура
- Сайт — статичний, хоститься на GitHub Pages (quizflow.space). Firebase — лише Realtime Database і Auth; платних Cloud Functions не використовуємо.
- Пошта: листи Firebase Auth — через SMTP Resend; запрошення й розсилки — Cloudflare Worker з `worker/` (ключ Resend лише в його секретах; деплой — вставити `worker/dist/worker.js` у редактор Cloudflare, після змін у `worker/src` перезібрати: `cd tests && npm run worker:bundle`; логотип у листах віддає сам воркер — після зміни `assets/email/logo-light.png` виконати `npm run worker:logo` і підняти `LOGO_V`). Див. `docs/email-setup.md`.
- Правила бази — `database.rules.json`; після змін їх треба вручну опублікувати в консолі Firebase.
- Після змін у `shared/*.js|css` піднімати `?v=` у всіх HTML, де файл підключено.
- Іконки сайту — `assets/icons/<teacher|admin|game|test>/` (свій набір для кожної частини) і `/favicon.ico`. Не малювати вручну: змінити `tests/scripts/icons.mjs`, виконати `cd tests && npm run icons` і підняти `?v=` у посиланнях на іконки в усіх HTML.

## Процес
- Кожну завершену зміну — одразу комітити, пушити, відкривати PR у `main` і, щойно перевірки на GitHub зелені, зливати його в `main` без окремого підтвердження.
- Текст, який вводять студенти чи інші користувачі, завжди екранувати (`esc`) перед вставкою в HTML.
