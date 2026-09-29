# Листи з власного домену (Resend) — безкоштовно

Листи для **відновлення пароля** і **підтвердження email** надсилає сам Firebase Auth
(безкоштовно, без Cloud Functions). Нижче — як зробити, щоб вони йшли з вашого домену
через Resend і вели на сторінку QuizFlow, а не на стандартну сторінку Firebase.

Код з боку сайту вже готовий:

- `login` → «Забули пароль?» надсилає лист (`sendPasswordResetEmail`);
- `auth-action` → сторінка, куди веде посилання з листа: новий пароль,
  підтвердження email, відновлення email (працює і на телефоні);
- `admin/teachers` → «Скинути пароль» для викладача надсилає той самий лист.

Потрібно лише налаштувати сервіси (≈15 хвилин).

---

## 1. Домен у Resend

1. Зареєструйтесь на <https://resend.com> (безкоштовний план).
2. **Domains → Add Domain** → введіть домен, наприклад `quizflow.com.ua`.
   Можна піддомен `mail.quizflow.com.ua` — так основний домен не зачіпається.
3. Resend покаже DNS-записи (MX, TXT для SPF, TXT для DKIM). Додайте їх у панелі
   реєстратора домену (де купували домен) → DNS.
4. Натисніть **Verify**. Перевірка займає від кількох хвилин до кількох годин.
5. **API Keys → Create API Key**, права: *Sending access*, домен — ваш.
   Скопіюйте ключ (`re_…`) — він показується лише один раз.

> Ключ нікуди в код не вставляйте: сайт статичний, і будь-хто зможе його побачити.
> Він потрібен лише в налаштуваннях Firebase (крок 2).

## 2. SMTP Resend у Firebase

Firebase Console → **Authentication → Templates** → посилання **SMTP settings**
(вгорі сторінки шаблонів):

| Поле | Значення |
|---|---|
| Enable | увімкнути |
| Sender address | `noreply@ваш-домен` (домен з кроку 1) |
| SMTP server host | `smtp.resend.com` |
| SMTP server port | `465` |
| SMTP account username | `resend` |
| SMTP account password | API-ключ `re_…` з кроку 1 |
| SMTP security mode | `SSL` |

Збережіть. Тепер усі листи Firebase Auth ідуть через Resend з вашої адреси.

## 3. Шаблон листа й посилання на сторінку QuizFlow

Там же, **Authentication → Templates → Password reset** → олівець:

- **Sender name:** `QuizFlow`
- **Reply to:** адреса підтримки (необов'язково)
- **Subject:** `Відновлення пароля QuizFlow`
- **Message:** можна перекласти українською, наприклад:

  ```
  Вітаємо!

  Ми отримали запит на зміну пароля для акаунта %EMAIL% у QuizFlow.
  Щоб встановити новий пароль, перейдіть за посиланням:

  %LINK%

  Посилання діє 1 годину. Якщо ви не надсилали запит — просто проігноруйте цей лист.

  Команда QuizFlow
  ```

- **Customize action URL** (посилання внизу редактора шаблону) →
  `https://<ваш-домен>/auth-action`

  Це одна адреса для всіх шаблонів — тепер посилання з листа відкриває
  сторінку QuizFlow.

Те саме (крім action URL — він спільний) за бажанням для шаблонів
**Email address verification** і **Email address change**.

## 4. Дозволений домен

Firebase Console → **Authentication → Settings → Authorized domains** → додайте
ваш домен (якщо сайт відкривається з нього). Без цього Firebase не дозволить
повернення на сторінку входу після зміни пароля.

## 5. Перевірка

1. Відкрийте `https://<ваш-домен>/login` → «Забули пароль?» → введіть свій email.
2. Лист має прийти від `noreply@ваш-домен`; у Resend → **Emails** видно статус доставки.
3. Посилання відкриває `/auth-action` → новий пароль → «Перейти до входу».

Ліміти безкоштовного плану Resend дивіться на <https://resend.com/pricing>
(на момент написання — порядку 100 листів на день; для відновлення паролів цього
з запасом вистачає).

---

## Воркер пошти: запрошення й розсилки (Cloudflare Worker)

Масові листи й запрошення Firebase Auth не надсилає, а ключ Resend не можна тримати
в коді сайту. Тому їх надсилає невеликий **Cloudflare Worker** з папки `worker/`
(безкоштовний план Cloudflare, без картки):

- ключ Resend зберігається в секретах воркера, а не на сайті;
- кожен запит підписаний Firebase ID-токеном, і воркер перевіряє, що це адміністратор;
- адреси отримувачів воркер бере з бази сам, тож надіслати лист на чужу адресу через нього не вийде;
- у кожній розсилці є посилання «Відписатися» і заголовок `List-Unsubscribe` (кнопка
  «Відписатися» в Gmail); відписки зберігаються в Cloudflare KV.

### 1. Розгортання через сайт Cloudflare (≈10 хвилин, без термінала)

Увійдіть на <https://dash.cloudflare.com> (той самий акаунт, де домен). Назви кнопок
у панелі Cloudflare час від часу змінюються — шукайте найближчі за змістом.

**а) Сховище для відписок (KV)**

**Storage & Databases → KV → Create** (іноді «Create namespace») → назва `quizflow-mail-unsub` → створити.

**б) Сам воркер**

1. **Workers & Pages → Create → Worker** («Start with Hello World») → назва `quizflow-mail` → **Deploy**.
2. **Edit code** → видаліть увесь код у файлі й вставте вміст
   [`worker/dist/worker.js`](../worker/dist/worker.js) з репозиторію (увесь файл цілком) → **Deploy**.

**в) Налаштування воркера** — вкладка **Settings**:

- **Bindings → Add binding → KV namespace**: *Variable name* `MAIL_KV`, простір — `quizflow-mail-unsub`.
- **Variables and Secrets → Add** — такі змінні:

| Назва | Тип | Значення |
|---|---|---|
| `RESEND_API_KEY` | **Secret** | ключ `re_…` з Resend (можна той самий, що для SMTP) |
| `UNSUB_SECRET` | **Secret** | будь-який довгий випадковий рядок (30+ символів) |
| `MAIL_FROM` | Text | `QuizFlow <noreply@quizflow.space>` — домен має бути підтверджений у Resend |
| `SITE_URL` | Text | `https://quizflow.space` |
| `ALLOWED_ORIGINS` | Text | `https://quizflow.space,https://www.quizflow.space` |
| `FIREBASE_PROJECT_ID` | Text | `quizflow-8a978` |
| `FIREBASE_DB_URL` | Text | `https://quizflow-8a978-default-rtdb.europe-west1.firebasedatabase.app` |

Збережіть (**Deploy**). Адреса воркера — угорі сторінки воркера, вигляду
`https://quizflow-mail.<акаунт>.workers.dev`.

> Секрет `UNSUB_SECRET` не змінюйте без потреби: після зміни посилання «Відписатися»
> в уже надісланих листах перестануть працювати.

**Оновлення воркера.** Коли код у `worker/src` зміниться, у PR буде оновлено й
`worker/dist/worker.js` — достатньо знову вставити його в **Edit code → Deploy**.
Змінні й секрети при цьому зберігаються.

<details><summary>Те саме через термінал (wrangler)</summary>

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create MAIL_KV    # id — у wrangler.toml замість REPLACE_WITH_KV_ID
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put UNSUB_SECRET
npx wrangler deploy
```

Змінні тоді беруться з `worker/wrangler.toml`. Оберіть один спосіб: `wrangler deploy`
перезаписує змінні, задані на сайті.
</details>

### 2. Підключення в адмінці

Адмінка → **Розсилки** → вставте адресу воркера → **Перевірити й зберегти**.
Сторінка покаже, чи задано ключ Resend, секрет відписки і сховище KV.

Після цього:

- **Запрошення** → «Нове запрошення»: поле *Email викладача* — лист із посиланням
  на реєстрацію піде одразу. Для вже створених — кнопка «Листом» у рядку;
- **Розсилки**: кому (усі викладачі, активні за 30 днів, за роллю), тема, текст,
  необов'язкова кнопка з посиланням. Спершу «Тест собі», потім «Надіслати».
  Історія розсилок — внизу сторінки.

### 3. Ліміти

Безкоштовний план Resend має денний і місячний ліміт листів (актуальні цифри — на
<https://resend.com/pricing>). Кожен отримувач розсилки — окремий лист. Якщо ліміт
вичерпано, воркер поверне помилку «Перевищено ліміт Resend» і сторінка покаже,
скільки листів пішло.

### 4. Перевірка коду

```bash
cd tests && npm ci && npm run worker    # юніт-тести воркера: підпис токена, права, відписка
```
