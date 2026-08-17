# Family Server😍

Node.js сервер для Family.

## Запуск
```bash
npm install
npm start
```

Порт: `8000`.

## Persistent data
`data/family.json` — пользователи, чаты, аватары, голосовые сообщения и подписки push.
`data/vapid.json` — автоматически созданные VAPID-ключи Web Push. На Railway нужен persistent volume, чтобы ключ не менялся после redeploy.

## Push
Сервер использует стандартный Web Push через пакет `web-push`. Для iPhone приложение должно быть добавлено на Home Screen и разрешение на уведомления выдано через кнопку в Family.

## Первый запуск
Если база пустая, создаётся:
- login: `admin`
- password: `admin`
