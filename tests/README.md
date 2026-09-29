# Автотести QuizFlow

Запускаються в GitHub Actions на кожен PR (`.github/workflows/tests.yml`).

```bash
cd tests
npm ci
npx playwright install chromium   # один раз
npm run e2e     # інтерфейс: Playwright + мок Firebase (e2e/mock), справжня база не потрібна
npm run worker  # воркер пошти (worker/src): токени, права, відписка
npm run rules   # правила database.rules.json на емуляторі Firebase (потрібна Java 21)
```

- `e2e/fixtures.mjs` — мок SDK Firebase, адреси без `.html`, збір помилок сторінки.
- `e2e/seeds/` — тестові дані (кладуться в `localStorage.mockdb`).
- Нова сторінка → додати її в `e2e/smoke.spec.mjs`.
