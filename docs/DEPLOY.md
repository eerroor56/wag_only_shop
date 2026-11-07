# Деплой на VPS (Aeza) со своим доменом

Пошаговая установка WAG Shop на чистый VPS с Ubuntu: Docker Compose, PostgreSQL, Caddy с автоматическим
HTTPS и Telegram-бот на webhook. Ниже `shop.example.ru` — ваш домен, `203.0.113.10` — IP сервера.

## 0. Что понадобится

| Что | Где взять |
| --- | --- |
| VPS: Ubuntu 24.04, от 2 ГБ RAM, 20 ГБ диска | Aeza → заказ сервера |
| Домен или поддомен | Ваш регистратор |
| Токен бота | [@BotFather](https://t.me/BotFather) → `/newbot` |
| Ваш Telegram ID | [@userinfobot](https://t.me/userinfobot) |

> **Локация сервера.** Боту нужен стабильный доступ к `api.telegram.org`, серверу при сборке — к Docker Hub
> и npm, Caddy — к Let's Encrypt. Надёжнее всего локации за пределами РФ (Нидерланды, Германия,
> Финляндия и т.п.). При российской локации проверьте доступность командами из шага 2.

## 1. DNS

У регистратора домена создайте A-запись:

```
shop.example.ru.   A   203.0.113.10
```

Проверка (с вашего компьютера, после обновления DNS — обычно 5–30 минут):

```bash
nslookup shop.example.ru
```

## 2. Подготовка сервера

Подключитесь (пароль root приходит от Aeza на почту или виден в панели):

```bash
ssh root@203.0.113.10
```

Обновите систему:

```bash
apt update && apt upgrade -y
```

Проверьте доступность нужных сервисов (у каждого должен быть ответ, а не таймаут):

```bash
curl -sS -o /dev/null -w "telegram %{http_code}\n" https://api.telegram.org
```

```bash
curl -sS -o /dev/null -w "dockerhub %{http_code}\n" https://registry-1.docker.io/v2/
```

```bash
curl -sS -o /dev/null -w "npm %{http_code}\n" https://registry.npmjs.org/
```

Если RAM ≤ 2 ГБ, добавьте swap: сборке frontend нужна память.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Файрвол: открыты только SSH, HTTP и HTTPS (PostgreSQL наружу не публикуется).

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

## 3. Docker

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
docker --version && docker compose version
```

## 4. Код проекта

Репозиторий приватный, поэтому серверу нужен ключ только для чтения (deploy key):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/wag_deploy -N "" -C "wag-shop-server"
```

```bash
cat ~/.ssh/wag_deploy.pub
```

Скопируйте вывод в GitHub → репозиторий → **Settings → Deploy keys → Add deploy key** (без галочки
«Allow write access»). Затем:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/wag_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```

```bash
git clone git@github.com:eerroor56/wag_only_shop.git /opt/wag-shop && cd /opt/wag-shop
```

## 5. Настройка `.env`

```bash
cp .env.example .env && chmod 600 .env
```

Сгенерируйте секреты (сохраните вывод, он понадобится ниже):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"; echo "WEBHOOK_SECRET=$(openssl rand -hex 32)"
```

Откройте файл:

```bash
nano .env
```

Заполните (остальное можно оставить по умолчанию):

```ini
DOMAIN=shop.example.ru
POSTGRES_PASSWORD=<сгенерированный выше>
BOT_TOKEN=<токен от @BotFather>
WEBHOOK_SECRET=<сгенерированный выше>
ADMIN_TELEGRAM_IDS=<ваш Telegram ID>
MANAGER_USERNAME=wag_on
SHOP_TIMEZONE=Europe/Moscow
```

`NODE_ENV`, `PUBLIC_URL`, `DATABASE_URL`, `BOT_MODE=webhook` и `TRUST_PROXY` для production выставляет
`docker-compose.yml`, их значения в `.env` игнорируются.

> Пароль PostgreSQL подставляется в URL подключения, поэтому используйте только буквы и цифры
> (как `openssl rand -hex`), без `@ : / #`.

## 6. Запуск

```bash
docker compose up -d --build
```

Первая сборка занимает 3–7 минут. Проверка:

```bash
docker compose ps
```

```bash
docker compose logs -f app
```

В логах должны быть строки `Бот подключён`, `Webhook установлен` и `Mini App: https://shop.example.ru/`.
Выход из логов — `Ctrl+C` (контейнеры продолжают работать).

```bash
curl https://shop.example.ru/api/health
```

Ответ `{"status":"ok"}` означает, что HTTPS, приложение и база работают.

Проверка webhook (подставьте токен):

```bash
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

`url` должен быть `https://shop.example.ru/api/telegram/webhook`, а `last_error_message` — отсутствовать.

## 7. Настройка бота

1. Откройте бота в Telegram и нажмите **Start**. Это обязательно для каждого администратора: иначе
   Telegram не позволит боту присылать уведомления о заказах.
2. Кнопка меню «Магазин» и команды настраиваются сервером автоматически при старте.
3. Команда `/admin` откроет админ-панель (только для ID из `ADMIN_TELEGRAM_IDS`).
4. Оформление в @BotFather (по желанию): `/setdescription` → «Wag shop. Магазин брендовых вещей.»,
   `/setabouttext`, `/setuserpic`.

Демо-товары нужны только для проверки; для настоящего магазина добавляйте товары через админку.

```bash
docker compose exec app node apps/server/dist/seed.js
```

## 8. Обновление

```bash
cd /opt/wag-shop && git pull && docker compose up -d --build
```

Миграции БД применяются автоматически при старте контейнера. Данные (БД, фото, сертификаты) хранятся в
Docker volumes и при обновлении сохраняются.

## 9. Резервные копии

Ежедневный бэкап базы и фото в `/opt/backups` с хранением 14 дней:

```bash
mkdir -p /opt/backups && cat > /etc/cron.daily/wag-backup <<'EOF'
#!/bin/sh
set -e
cd /opt/wag-shop
D=$(date +%F)
docker compose exec -T db pg_dump -U wag wag_shop | gzip > /opt/backups/db-$D.sql.gz
docker run --rm -v wag-shop_uploads:/data -v /opt/backups:/backup alpine tar czf /backup/uploads-$D.tgz -C /data .
find /opt/backups -type f -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/wag-backup
```

> Список volumes: `docker volume ls`.
> Копии лучше периодически выгружать с сервера.

Восстановление базы:

```bash
gunzip -c /opt/backups/db-2026-01-01.sql.gz | docker compose exec -T db psql -U wag wag_shop
```

## 10. Если что-то не работает

| Симптом | Что проверить |
| --- | --- |
| Сайт не открывается по HTTPS | `docker compose logs caddy`: A-запись указывает на сервер, порты 80/443 открыты |
| `Некорректная конфигурация окружения` в логах | Сообщение перечисляет неверные переменные `.env` |
| Бот не отвечает на `/start` | `getWebhookInfo` → `last_error_message`; доступ к `api.telegram.org` с сервера |
| Не приходят уведомления о заказах | Ваш ID в `ADMIN_TELEGRAM_IDS`, вы нажимали Start; после правки `.env` — `docker compose up -d` |
| «Нет доступа» в админке | Telegram ID в `ADMIN_TELEGRAM_IDS` совпадает с вашим |
| Сборка падает с нехваткой памяти | Добавьте swap (шаг 2) |

Перезапуск после изменения `.env`:

```bash
docker compose up -d
```
