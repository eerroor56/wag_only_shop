# WAG Shop — Telegram Mini App

**Wag shop. Магазин брендовых вещей.**

Каталог брендовой одежды внутри Telegram: покупатель выбирает вещи, оформляет заказ с именем и телефоном,
магазин получает уведомление в Telegram, а менеджер **@wag_on** связывается с клиентом вручную.
Онлайн-оплаты, доставки и оферты нет — покупка согласуется с менеджером.

| Часть | Что внутри |
| --- | --- |
| **Mini App** (`/`) | Главная, каталог с поиском по названию, сортировкой (цена, А–Я, новинки), категориями и панелью фильтров (цена ползунком, пол, бренд, размер, цвет, материал, сезон, наличие), карточка с галереей и выбором размера, корзина, оформление заказа, экран «Заказ оформлен» |
| **Админ-панель** (`/admin/`) | Dashboard, товары (CRUD, несколько фото, категории, размеры, остатки по размерам, бренд, пол, цвет и материал с палитрой для фильтров, сезон, порядок, скрытие), заказы (статусы, фильтр, поиск), пользователи, рассылка. Вход — карточка «Админ-панель» на главной Mini App (видна только администраторам) |
| **Backend** | REST API, проверка Telegram initData, PostgreSQL, корзина и заказы на сервере, хранилище изображений (диск / S3) |
| **Telegram-бот** | `/start` с кнопкой «Открыть магазин», уведомления о заказах, массовая рассылка. Сообщения пользователей бот удаляет, чат остаётся чистым |

---

## Содержание

1. [Стек и архитектура](#стек-и-архитектура)
2. [Локальная разработка](#локальная-разработка)
3. [Создание Telegram-бота](#создание-telegram-бота)
4. [Production](#production)
5. [Webhook](#webhook)
6. [Переменные окружения](#переменные-окружения)
7. [API](#api)
8. [Безопасность](#безопасность)
9. [Тесты](#тесты)
10. [Расширение (бренд, размер, категории…)](#расширение)
11. [FAQ](#faq)

---

## Стек и архитектура

| Слой | Технологии | Почему |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query | Быстрая сборка, кеш и оптимистичные обновления корзины из коробки |
| Telegram SDK | Официальный `telegram-web-app.js` + типизированная обёртка | Без сторонних прослоек, работает на всех клиентах |
| Backend | Node.js, TypeScript, Fastify 5, Zod | Fastify — быстрый и строгий, Zod-схемы общие для фронта и бэка |
| БД | PostgreSQL + Drizzle ORM | Типобезопасные запросы, SQL-миграции в репозитории, нет бинарного движка |
| Бот | grammY + auto-retry | Webhook и long polling, автоматическая обработка `429 retry_after` |
| Изображения | sharp + абстрактный storage (диск / S3) | Перекодирование в WebP, превью, защита от вредоносных файлов |
| Очередь рассылки | Таблица в PostgreSQL | Не нужен Redis; рассылка продолжается после перезапуска |

```
wag_shop/
├── apps/
│   ├── server/              backend: API, бот, рассылка, БД
│   │   ├── src/
│   │   │   ├── bot/         Telegram-бот: /start, /admin, тексты сообщений
│   │   │   ├── db/          схема Drizzle, клиент, миграции, seed
│   │   │   ├── lib/         ошибки, проверка initData, форматирование
│   │   │   ├── modules/     бизнес-логика: products, cart, orders, users, broadcast, admin
│   │   │   ├── plugins/     авторизация (initData, whitelist администраторов)
│   │   │   ├── routes/      HTTP-маршруты: public, shop, admin
│   │   │   ├── storage/     драйверы хранилища (local, s3) и обработка изображений
│   │   │   ├── app.ts       сборка Fastify: безопасность, rate limit, статика
│   │   │   └── index.ts     точка входа, фоновые задачи, graceful shutdown
│   │   ├── drizzle/         SQL-миграции
│   │   └── test/            интеграционные тесты сценариев
│   ├── miniapp/             Mini App покупателя (pages, components, api, hooks)
│   └── admin/               админ-панель (pages, components, api)
├── packages/
│   ├── shared/              общие типы, Zod-схемы, цены, телефоны, статусы
│   └── web/                 общий UI-kit: Telegram SDK, API-клиент, toast, стили
├── deploy/Caddyfile         reverse proxy с автоматическим HTTPS
├── Dockerfile
└── docker-compose.yml
```

Подробнее о решениях — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Локальная разработка

### 1. Установите зависимости

Нужен **Node.js 22.12+** (рекомендуется 24 LTS).

```bash
npm install
```

### 2. Создайте PostgreSQL

Вариант А — Docker:

```bash
docker compose -f docker-compose.dev.yml up -d
```

База будет доступна по адресу `postgres://wag:wag_password@localhost:5432/wag_shop`.

Вариант Б — установленный PostgreSQL 14+:

```sql
CREATE USER wag WITH PASSWORD 'wag_password';
CREATE DATABASE wag_shop OWNER wag;
```

### 3. Настройте `.env`

```bash
cp .env.example .env
```

Минимум для локального запуска:

```ini
DATABASE_URL=postgres://wag:wag_password@localhost:5432/wag_shop
PUBLIC_URL=http://localhost:5173
BOT_TOKEN=<токен от @BotFather>
BOT_MODE=polling
ADMIN_TELEGRAM_IDS=<ваш Telegram ID>
```

### 4. Выполните миграции и заполните демо-данные

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Seed добавит 6 товаров (Nike Tech Fleece, Adidas Originals, Stone Island, The North Face…) с галереями.
Изображения-заглушки генерируются локально — интернет не нужен.

### 5. Запустите backend

```bash
npm run dev
```

API: `http://localhost:3000`. Бот в режиме `polling` сразу отвечает на `/start`.

### 6. Запустите frontend

В двух отдельных терминалах:

```bash
npm run dev:miniapp
```

```bash
npm run dev:admin
```

Mini App — `http://localhost:5173`, админка — `http://localhost:5173/admin/` (Vite Mini App проксирует `/admin` на dev-сервер админки, `/api` и `/uploads` — на backend; так кнопка «Админ-панель» работает как в production).

### Открыть приложение в браузере без Telegram

Backend принимает только подписанную Telegram initData. Для разработки её можно сгенерировать тем же
алгоритмом (нужен `BOT_TOKEN` в `.env`):

```bash
npm run dev:init-data
```

Команда запишет `.env.development.local` в `apps/miniapp` (тестовый покупатель) и `apps/admin`
(первый ID из `ADMIN_TELEGRAM_IDS`). Перезапустите Vite. В production-сборку эта initData не попадает.

### Открыть в настоящем Telegram при локальной разработке

Telegram открывает Mini App только по HTTPS. Поднимите туннель на порт Vite:

```bash
cloudflared tunnel --url http://localhost:5173
```

Укажите полученный `https://…trycloudflare.com` в `PUBLIC_URL`, перезапустите backend и отправьте боту `/start`.
Админка откроется по команде `/admin` (туннель до порта 5174 или production-сборка, см. ниже).

---

## Создание Telegram-бота

### 1. Создайте бота и получите `BOT_TOKEN`

1. Откройте [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Задайте имя (`WAG Shop`) и username (например, `wag_shop_bot`).
3. Скопируйте токен вида `1234567890:AA…` в `.env`:

   ```ini
   BOT_TOKEN=1234567890:AAH...
   ```

4. Рекомендуется: `/setdescription` → «Wag shop. Магазин брендовых вещей.», `/setuserpic` → логотип,
   `/setjoingroups` → **Disable** (бот работает только в личных сообщениях).

> Telegram не позволяет ботам отключать поле ввода. Поэтому бот не отвечает на сообщения и сразу
> удаляет всё, что пишет пользователь (текст, стикеры, контакт, `/start`); повторный `/start` заменяет
> прежнее приветствие. В чате остаются только приветствие, кнопка «Магазин», рассылки и (у админов)
> уведомления о заказах.

### 2. Укажите `ADMIN_TELEGRAM_IDS`

Узнайте свой числовой Telegram ID, например у [@userinfobot](https://t.me/userinfobot). Укажите ID владельца
(и других администраторов через запятую):

```ini
ADMIN_TELEGRAM_IDS=123456789,987654321
```

Только эти пользователи:

- получают доступ к админ-панели (проверка на сервере при каждом запросе);
- получают сообщения о новых заказах;
- видят карточку «Админ-панель» на главной Mini App (и команду `/admin` в меню бота как запасной вход).

> ⚠️ Каждый администратор должен хотя бы один раз нажать **Start** в боте: Telegram не разрешает ботам
> писать первыми.

### 3. Укажите Mini App URL

URL задаётся одной переменной:

```ini
PUBLIC_URL=https://shop.example.com
```

- Mini App: `https://shop.example.com/`
- Админка: `https://shop.example.com/admin/`

При старте сервер **сам** настраивает кнопку меню бота («Магазин») и команды. Кнопка «Открыть магазин»
в `/start` тоже ведёт на `PUBLIC_URL`.

Дополнительно (необязательно) можно зарегистрировать Mini App в BotFather (`/newapp`), чтобы получить
прямую ссылку `t.me/<bot>/<app>`, — укажите тот же `PUBLIC_URL`.

---

## Production

### Вариант 1 — Docker Compose (рекомендуется)

> Подробная пошаговая инструкция для чистого VPS (Aeza и аналоги): [docs/DEPLOY.md](docs/DEPLOY.md).

Нужен сервер с Docker и доменом, A-запись которого указывает на сервер.

```bash
cp .env.example .env
```

Заполните в `.env`:

```ini
DOMAIN=shop.example.com
POSTGRES_PASSWORD=<надёжный пароль>
BOT_TOKEN=<токен>
WEBHOOK_SECRET=<openssl rand -hex 32>
ADMIN_TELEGRAM_IDS=<ID владельца>
```

Запуск:

```bash
docker compose up -d --build
```

Что произойдёт:

- поднимется PostgreSQL (данные в volume `pgdata`);
- приложение применит миграции и запустится (фото — в volume `uploads`);
- Caddy получит HTTPS-сертификат Let's Encrypt для `DOMAIN`;
- сервер зарегистрирует webhook `https://DOMAIN/api/telegram/webhook`.

Демо-товары (по желанию):

```bash
docker compose exec app node apps/server/dist/seed.js
```

Логи:

```bash
docker compose logs -f app
```

Обновление после изменений кода:

```bash
git pull && docker compose up -d --build
```

### Вариант 2 — без Docker (VPS + nginx / Caddy + systemd/pm2)

```bash
npm ci
```

```bash
npm run build
```

```bash
NODE_ENV=production node apps/server/dist/migrate.js
```

```bash
NODE_ENV=production node apps/server/dist/index.js
```

Переменные окружения передайте через systemd `EnvironmentFile=` или `pm2 ecosystem`.
Перед приложением нужен reverse proxy с HTTPS (порт `3000`), например nginx:

```nginx
server {
    server_name shop.example.com;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # listen 443 ssl; ssl_certificate ... (certbot)
}
```

и `TRUST_PROXY=true` в `.env`.

### Хранение фото в S3

```ini
STORAGE_DRIVER=s3
S3_BUCKET=wag-shop
S3_REGION=ru-central1
S3_ENDPOINT=https://storage.yandexcloud.net
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://storage.yandexcloud.net/wag-shop
```

Подходит любое S3-совместимое хранилище: AWS, Yandex Object Storage, Selectel, MinIO, Cloudflare R2.
Бакет должен разрешать публичное чтение объектов. В БД хранятся только ключи файлов, поэтому смена
хранилища не требует миграции данных (достаточно перенести файлы).

### Резервные копии

```bash
docker compose exec db pg_dump -U wag wag_shop > backup.sql
```

Volume `uploads` (или бакет S3) тоже нужно резервировать.

---

## Webhook

В production (`NODE_ENV=production`) бот работает через webhook — это надёжнее и не требует постоянного
соединения с Telegram.

1. Задайте секрет (16–256 символов `A-Z a-z 0-9 _ -`):

   ```ini
   WEBHOOK_SECRET=<openssl rand -hex 32>
   BOT_MODE=webhook
   ```

2. Запустите сервер — он сам вызовет `setWebhook` на `PUBLIC_URL/api/telegram/webhook`.
   Telegram передаёт секрет в заголовке `X-Telegram-Bot-Api-Secret-Token`; запросы без него отклоняются.

3. Проверка:

   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
   ```

Локально используйте `BOT_MODE=polling` (вебхук при этом автоматически снимается).
`BOT_MODE=disabled` — бот не принимает обновления, но уведомления и рассылки отправляются.

---

## Переменные окружения

Полный список с комментариями — в [`.env.example`](.env.example). Основные:

| Переменная | Обязательна | Описание |
| --- | --- | --- |
| `DATABASE_URL` | да | Строка подключения PostgreSQL |
| `PUBLIC_URL` | да | HTTPS-адрес приложения (Mini App = `PUBLIC_URL/`) |
| `BOT_TOKEN` | да | Токен от @BotFather |
| `ADMIN_TELEGRAM_IDS` | да | Telegram ID администраторов через запятую |
| `WEBHOOK_SECRET` | в webhook-режиме | Секрет webhook |
| `BOT_MODE` | нет | `webhook` / `polling` / `disabled` |
| `MANAGER_USERNAME` | нет | Менеджер для клиентов (по умолчанию `wag_on`) |
| `SHOP_TIMEZONE` | нет | Часовой пояс для статистики «за сегодня» (`Europe/Moscow`) |
| `STORAGE_DRIVER` | нет | `local` или `s3` |
| `TRUST_PROXY` | нет | `true` за reverse proxy |

Конфигурация проверяется при старте: при ошибке сервер выведет понятный список проблем и не запустится.

---

## API

Все маршруты покупателя и администратора требуют заголовок `Authorization: tma <initData>`.
Ошибки возвращаются в едином формате: `{ "error": { "code", "message", "details?" } }`.
Деньги передаются **целыми копейками**.

**Публичные**

| Метод | Путь | Описание |
| --- | --- | --- |
| GET | `/api/health` | Проверка сервера и БД |
| GET | `/api/config` | Название магазина, менеджер, username бота |
| GET | `/api/me` | Текущий пользователь и флаг администратора |

**Покупатель**

| Метод | Путь | Описание |
| --- | --- | --- |
| GET | `/api/products?limit&offset&categoryId&sort&q&inStock&priceMin&priceMax&brands&sizes&colors&materials&seasons&gender` | Каталог (только активные товары). `sort`: `default`, `price_asc`, `price_desc`, `title_asc`, `title_desc`, `new`; `q` — поиск по названию; `inStock=1` — только в наличии; `priceMin` / `priceMax` — копейки; списки через запятую: `brands` (без учёта регистра), `sizes` (только размеры в наличии), `colors`, `materials`, `seasons` (всесезонные подходят под любой сезон); `gender`: `men` / `women` (включают унисекс), `unisex`. Закончившиеся товары всегда в конце |
| GET | `/api/products/facets?categoryId` | Значения для панели фильтров по товарам в продаже: максимальная цена, бренды, размеры в наличии, цвета, материалы, сезоны, пол — с количеством товаров |
| GET | `/api/categories` | Категории, в которых есть товары в продаже, со счётчиками |
| GET | `/api/products/:id` | Карточка товара с галереей |
| GET | `/api/cart` | Корзина с актуальными ценами из БД |
| POST | `/api/cart/items` | `{ productId, quantity?, size? }` — `size` обязателен, если у товара есть размеры |
| PATCH | `/api/cart/items/:id` | `{ quantity }` |
| DELETE | `/api/cart/items/:id` | Удалить позицию |
| POST | `/api/orders` | `{ customerName, phone, idempotencyKey, expectedTotal? }` — заказ из корзины |
| GET | `/api/orders`, `/api/orders/:id` | Заказы текущего пользователя |

**Администратор** (`/api/admin/*`, только `ADMIN_TELEGRAM_IDS`)

| Метод | Путь | Описание |
| --- | --- | --- |
| GET | `/dashboard` | Статистика |
| GET / POST | `/products` | Список (`?status=all\|active\|hidden`) / создание |
| GET / PATCH / DELETE | `/products/:id` | Товар; PATCH принимает любые поля, в т.ч. `isActive`, `sizes`, `stock`, `imageIds`, `mainImageId` |
| PUT | `/products/order` | `{ ids }` — порядок в каталоге |
| GET / POST | `/categories` | Категории со счётчиками / создание `{ name }` (название уникально без учёта регистра) |
| PATCH / DELETE | `/categories/:id` | Переименование / удаление (товары остаются без категории) |
| PUT | `/categories/order` | `{ ids }` — порядок категорий (= порядок фильтров в каталоге) |
| POST | `/images` | Загрузка фото (multipart, поле `file`) |
| GET | `/orders?status&q&limit&offset` | Заказы с фильтром и поиском |
| GET / PATCH | `/orders/:id` | Заказ / смена статуса `{ status }` |
| GET | `/users?q&limit&offset` | Пользователи |
| GET / POST | `/broadcasts` | Число получателей и история / новая рассылка `{ text, withShopButton }` |
| GET | `/broadcasts/:id` | Прогресс |
| POST | `/broadcasts/test` | Тестовое сообщение себе |
| POST | `/broadcasts/:id/cancel` | Остановить |

---

## Безопасность

- **Telegram initData** проверяется на сервере по [алгоритму Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) (HMAC-SHA256, сравнение за постоянное время, срок действия `INIT_DATA_MAX_AGE_SECONDS`). Telegram ID берётся только из подписанных данных; ID в теле запроса игнорируется.
- **Админ-доступ** — whitelist `ADMIN_TELEGRAM_IDS`, проверка в `preHandler` каждого `/api/admin/*`.
- **Цены и суммы** считаются только сервером по данным БД. Заказ формируется из серверной корзины; `expectedTotal` с клиента используется лишь для сравнения (при расхождении — `409 PRICE_CHANGED`).
- **Двойное оформление** исключено: ключ идемпотентности + блокировка корзины `SELECT … FOR UPDATE` в транзакции.
- **Snapshot заказа**: название и цена каждой позиции сохраняются в `order_items`; изменение или удаление товара не меняет старые заказы.
- **Валидация** всех входных данных общими Zod-схемами; **SQL injection** исключён параметризованными запросами Drizzle (поиск экранирует `%` и `_`).
- **XSS**: React экранирует вывод, описание выводится как текст; в Telegram-сообщениях пользовательские данные экранируются для `parse_mode=HTML`, рассылка отправляется без разметки. CSP, `nosniff`, HSTS через Helmet.
- **Загрузка изображений**: лимит 10 МБ и 1 файл на запрос, проверка формата по содержимому (sharp), перекодирование в WebP (удаляет EXIF/GPS и встроенные данные), лимит пикселей, случайные имена, раздача с `Content-Security-Policy: sandbox` и `nosniff` — загруженные файлы не исполняются.
- **Rate limiting**: общий лимит API и отдельные лимиты на оформление заказа, загрузку фото и рассылку.
- Webhook защищён секретным токеном.

---

## Тесты

Интеграционные тесты проходят 12 сценариев из ТЗ на реальной PostgreSQL с фейковым Telegram Bot API
(блокировки бота, уведомления, рассылка):

```bash
TEST_DATABASE_URL=postgres://wag:wag_password@localhost:5432/wag_shop_test npm test
```

> Тестовая база **полностью очищается** перед запуском — используйте отдельную БД.

Проверка типов во всех пакетах:

```bash
npm run typecheck
```

---

## Расширение

Дополнительные характеристики уже доступны: в товаре есть список «Характеристики» (`attributes`, JSONB),
который выводится в карточке, и размеры (`sizes`): буквенные (M, XL), российские (48) и диапазоны
(48-52, 52/54). Размер выбирается в карточке, хранится в позиции корзины и фиксируется в заказе.
Категории (`categories` + `products.category_id`) создаются прямо из карточки товара в админке;
покупатель фильтрует по ним каталог.

Остатки (`products.stock`, JSONB `{ "M": 3, "L": 0 }`, у товара без размеров — `{ "": 5 }`; `null` — не
учитываются) списываются при оформлении заказа под блокировкой строки товара и возвращаются при отмене
заказа. Закончившийся размер нельзя выбрать, закончившийся товар показывается в каталоге неактивным.

Характеристики для фильтров — отдельные колонки товара: `brand` (+ `brand_key` для сравнения без учёта
регистра), `gender`, `seasons`, цвет и материал. Цвет и материал хранятся парами: текст для покупателя
(`color_name` — «Графитовый меланж», `material_name` — «80% хлопок, 20% полиэстер») и значения палитры
(`colors`, `materials` — `packages/shared/src/filters.ts`), по которым работает фильтр. Админка подбирает
палитру по введённому тексту, её можно поправить вручную. Миграция `0004` переносит в эти поля старые
характеристики «Бренд», «Цвет», «Материал» / «Состав».

Чтобы добавить другие структурированные поля (например, артикул):

1. Добавьте nullable-колонку (или отдельную таблицу) в `apps/server/src/db/schema.ts`.
2. Сгенерируйте миграцию:

   ```bash
   npm run db:generate
   ```

3. Добавьте поле в `productFieldsSchema` (`packages/shared/src/schemas.ts`), DTO и форму админки.

Существующие данные и API при этом не меняются.

---

## FAQ

**Владелец не получает уведомления о заказах.**
Проверьте, что его ID указан в `ADMIN_TELEGRAM_IDS` и что он нажимал Start в боте. Неотправленные
уведомления сервер повторяет автоматически каждую минуту (до 5 раз в течение суток).

**Как сделать товар временно недоступным?**
В админке нажмите на иконку глаза в списке товаров. Товар исчезнет из каталога; заказы с ним сохранятся,
а в корзинах он будет помечен недоступным.

**Пользователь заблокировал бота — что с рассылкой?**
Ошибка `403` фиксируется, пользователь помечается заблокированным и исключается из следующих рассылок.
Остальные сообщения продолжают отправляться. Если пользователь снова нажмёт Start, он вернётся в рассылку.

**Можно ли запустить несколько экземпляров сервера?**
Да, но rate limit хранится в памяти процесса. Рассылку при этом обрабатывает только один экземпляр
(PostgreSQL advisory lock).
