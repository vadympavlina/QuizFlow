# Автотести QuizFlow (інфраструктура)

Інтерфейс сайту тепер тестується в репозиторіях частин (`quizflow-app`, `-admin`, `-play`, `-test`). Тут лишились перевірки спільної інфраструктури; запускаються в GitHub Actions на кожен PR (`.github/workflows/tests.yml`).

```bash
cd tests
npm ci
npm run worker  # воркер пошти (worker/src): токени, права, відписка
npm run rules   # правила database.rules.json на емуляторі Firebase (потрібна Java 21)
```

Генератори іконок і прев'ю (`npm run icons`, `npm run og`) використовують Playwright: один раз `npx playwright install chromium`. Результат у `assets/icons` і `assets/og` копіюється в репозиторії частин.
