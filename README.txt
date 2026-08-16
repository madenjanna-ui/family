FAMILY😍 SERVER v7 — STATUS INDICATORS

FAMILY😍 SERVER v6 — DIALOG LIST

FAMILY😍 SERVER v2

1. Распакуйте архив.
2. Запустите Start Server.bat.
3. Первый запуск выполнит npm install.
4. Family открывается на http://localhost:8000.
5. С телефона/другого ПК в той же Wi-Fi сети:
   http://IP-АДРЕС-КОМПЬЮТЕРА:8000

Начальный вход:
admin
admin

Теперь frontend использует серверную базу, а не localStorage для пользователей и сообщений.
База находится в data/family.json.

Для доступа из другой сети/через интернет позже понадобится внешний сервер/VPS или другой способ публикации. Не открывайте порт 8000 в интернет без дополнительной защиты.


v6: список личных диалогов показывает последнее сообщение, время, непрочитанные и онлайн-статус.


v7: green online indicator and red unread counter made visually explicit.
