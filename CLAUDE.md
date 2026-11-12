# QuizFlow — правила для роботи з кодом

## Дизайн
- **Жодних емодзі в інтерфейсі.** Іконки — лише inline SVG (stroke, `currentColor`), позначки — текстом або CSS (крапка, смужка). Емодзі в контенті, який пишуть люди (назви тестів, тексти новин з адмінки тощо), не чіпаємо — правило лише про інтерфейс.
- **Жодних стандартних дропдаунів** (`<select>`, `<datalist>`, `<input type="date">`). Для вибору — власний `qfDrop` з `shared/features.js`, для кількох варіантів — кнопки-чипи чи таби.
- Шрифти: Manrope (текст) і Geist Mono (цифри). Мова інтерфейсу — українська.

## Інфраструктура
- **Сайт розділено на чотири репозиторії-піддомени** (app, admin, play, test) — див. `docs/subdomains.md`. У цьому репозиторії лишилась інфраструктура: правила бази, воркер пошти, генератори іконок і прев'ю та одна статична сторінка `index.html` для quizflow.space. Сторінки сайту живуть у `quizflow-app`, `quizflow-admin`, `quizflow-play`, `quizflow-test`.
- Сайт — статичний, хоститься на GitHub Pages (кожна частина на своєму піддомені; тут — quizflow.space з однією сторінкою). Firebase — лише Realtime Database і Auth; платних Cloud Functions не використовуємо.
- Пошта: листи Firebase Auth — через SMTP Resend; запрошення й розсилки — Cloudflare Worker з `worker/` (ключ Resend лише в його секретах; деплой — вставити `worker/dist/worker.js` у редактор Cloudflare, після змін у `worker/src` перезібрати: `cd tests && npm run worker:bundle`; логотип у листах віддає сам воркер — після зміни `assets/email/logo-light.png` виконати `npm run worker:logo` і підняти `LOGO_V`). Див. `docs/email-setup.md`.
- Правила бази — `database.rules.json`; після змін їх треба вручну опублікувати в консолі Firebase.
- Іконки сайту — `assets/icons/<teacher|admin|game|test>/` (свій набір для кожної частини). Іконки лендингу quizflow.space (курча) — `assets/icons/landing/` і кореневі `/favicon.ico`, `/apple-touch-icon.png`; генерує `cd tests && npm run icons:landing` з `assets/icons/landing/chick.webp` (нове зображення: замінити файл, виконати скрипт, підняти `?v=` у `index.html`). Не малювати вручну: змінити `tests/scripts/icons.mjs`, виконати `cd tests && npm run icons`, скопіювати потрібний набір у репозиторії частин і підняти `?v=` у посиланнях на іконки в їхніх HTML.
- Герої головної сторінки (розділ «Команда» і фінал) — `assets/team/<chick|duck|rabbit|sprout|owl>.webp` (420 px, прозорий фон); це ті самі талісмани, що в іконках частин сайту. Спільна картинка всіх п'яти (з лапками) — `assets/team/group.webp` (1600 px, фінал сторінки).
- Прев'ю посилань (Open Graph) — метатеги в `<head>` і картинки `assets/og/<teacher|game|test>.jpg`; в адмінці прев'ю немає. Картинки не малювати вручну: змінити `tests/scripts/og.mjs`, виконати `cd tests && npm run og`, скопіювати картинки в репозиторії частин і підняти `?v=` в `og:image`/`twitter:image` їхніх HTML.

## Процес
- Кожну завершену зміну — одразу комітити, пушити, відкривати PR у `main` і, щойно перевірки на GitHub зелені, зливати його в `main` без окремого підтвердження.
- Текст, який вводять студенти чи інші користувачі, завжди екранувати (`esc`) перед вставкою в HTML.
