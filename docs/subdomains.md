# Розділення сайту на піддомени

Сайт розділено на чотири окремі репозиторії. Цей (`quizflow`) після переходу містить інфраструктуру (правила бази, воркер пошти, `docs/`, генератори іконок і прев'ю) і одну статичну сторінку `index.html` для `quizflow.space`.

| Піддомен | Репозиторій | Що там |
|---|---|---|
| app.quizflow.space | [quizflow-app](https://github.com/vadympavlina/quizflow-app) | панель викладача, вхід і реєстрація, `auth-action`, Live-моніторинг, сторінки ведучого гри (`live/setup`, `lobby`, `play-teacher`, `podium`) |
| admin.quizflow.space | [quizflow-admin](https://github.com/vadympavlina/quizflow-admin) | адмін-панель |
| play.quizflow.space | [quizflow-play](https://github.com/vadympavlina/quizflow-play) | учнівська частина гри наживо: вхід за кодом, гра, результат |
| test.quizflow.space | [quizflow-test](https://github.com/vadympavlina/quizflow-test) | проходження тесту студентом за посиланням (не гра) |

Вхід Firebase браузер зберігає окремо для кожного піддомену, тому **викладач входить лише в app, адмін — лише в admin**, а учням (play, test) вхід не потрібен. Саме тому сторінки ведучого гри лежать в app, а не в play.

## Як нові адреси виглядають

- Тест для студентів: `https://test.quizflow.space/?link=<id>&t=<uid>` (раніше `quizflow.space/test?link=…`). Попередній перегляд: `https://test.quizflow.space/?testId=…&preview=1&t=…`.
- Приєднання до гри: `https://play.quizflow.space/?code=<код>` (раніше `quizflow.space/play?code=…`).
- Усі посилання між частинами — абсолютні (прописані константами: `TEST_ORIGIN` у `shared/features.js`, `PLAY_HOME` у `live/live-core.js` в app, адреси app у адмінці).

## Порядок запуску (усе робить власник домену)

Кожен репозиторій запускати окремо; порядок не важливий, але перевіряти по одному.

1. **DNS.** Для кожного піддомену запис `CNAME`: `app`, `admin`, `play`, `test` → `vadympavlina.github.io`.
2. **GitHub Pages** у кожному з чотирьох репозиторіїв: Settings → Pages → Source: **GitHub Actions**; Custom domain: відповідний піддомен; ввімкнути Enforce HTTPS. Після цього в Actions перезапустити останній запуск «Deploy QuizFlow» (поки Pages вимкнено, цей запуск червоний — це очікувано).
3. **Firebase Console → Authentication → Settings → Authorized domains**: додати `app.quizflow.space`, `admin.quizflow.space`, `play.quizflow.space`, `test.quizflow.space`. Без цього вхід, скидання пароля й листи не працюватимуть на нових адресах.
4. **Cloudflare Worker пошти** (Settings → Variables):
   - `SITE_URL` = `https://app.quizflow.space` (звідси беруться посилання на реєстрацію, `auth-action` і вхід у листах);
   - `ALLOWED_ORIGINS` = `https://app.quizflow.space,https://admin.quizflow.space` (+ старі `https://quizflow.space,https://www.quizflow.space`, доки старий сайт ще працює). Код воркера не змінюється.
5. **Перевірка кожного піддомену** (вручну, швидко):
   - app: вхід викладача, створення посилання на тест (адреса має починатися з `test.quizflow.space`), запуск гри (QR і підказка ведуть на `play.quizflow.space`), кнопка адмін-панелі в меню веде на admin.
   - admin: вхід адміна, огляд, «Запрошення» (посилання на реєстрацію веде на app), скидання пароля викладачу.
   - play: код гри → ім'я → гра.
   - test: відкрити студентське посилання, пройти тест.

## Що зміниться для людей після переходу

- Усі викладачі й адміни **входять заново** (інша адреса — окреме сховище входу).
- Чернетки конструктора й налаштування вигляду (згорнуте меню тощо) в браузері не переносяться.
- Студент, який саме проходив тест, а також учні в грі, що йде, після зміни адреси втрачають локальний прогрес.
- Старі посилання `quizflow.space/test?...` і `quizflow.space/play?...` перестануть працювати. На старому домені нічого не лишали за рішенням власника.

## Що лишилось у цьому репозиторії

`worker/`, `database.rules.json`, `firebase.json`, `.firebaserc`, `docs/`, `assets/` (джерело іконок, прев'ю й логотипа листів), `tests/` (юніт-тести воркера, правила бази, генератори `scripts/`), `index.html` (сторінка quizflow.space) і `deploy.yml`. Старі сторінки сайту видалено: вони живуть у репозиторіях частин.

Значення воркера за замовчуванням тепер ведуть на app (`SITE_URL`) і app + admin (`ALLOWED_ORIGINS`); змінні в Cloudflare мають пріоритет.

## Спільні файли — копії

Сайт без збірки, тому ці файли скопійовані між репозиторіями (змінили в одному — перенесіть в інші):

- `shared/caps.js`, `ai-usage.js`, `ai-call.js`, `news-utils.js`, `notices.js`: головне джерело `quizflow-app`, копії в `quizflow-admin` (і `quizflow-test` для caps, ai-usage, notices, qorder);
- `live/live-core.js`, `live/live-ui.css`, `live/patterns/`: копії в `quizflow-app` (ведучий) і `quizflow-play` (учень); відмінності в `live-core.js` навмисні (`joinUrl`, `HOME_URL`, `requireTeacher`).

## Що не перенесено в тести нових репозиторіїв

Інтеграційна перевірка «адмінка читає ті самі цифри, що пише панель» (`admin-light.spec.mjs`) потребувала обох частин на одному домені й була видалена разом зі старим сайтом. Якщо знадобиться, її можна відновити окремим сценарієм поверх двох піддоменів.
