# 😍 Family

Family is split into two parts:

- `client/` — web application. This can be published with **GitHub Pages**.
- `server/` — Node.js + WebSocket backend. This must run on a server/VPS/cloud host.

## Local test

From `server/`:

```text
Start Server.bat
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

Publish the `client/` folder with GitHub Pages.

Before publishing, edit:

```text
client/js/config.js
```

and set:

```js
window.FAMILY_CONFIG = {
    API_BASE: "https://YOUR-FAMILY-SERVER"
};
```

The backend must support HTTPS and WebSocket (`wss://`) for production.

## Security

Do **not** commit:

```text
server/data/family.json
server/.env
server/node_modules/
```

The live family database is intentionally not included in this GitHub-ready package.

## Current functionality

- server-side authentication
- up to 4 family users
- male/female avatars
- global family chat
- private chats
- reactions
- unread counters
- read state
- online/last-seen status
- WebSocket realtime updates
- last message/time in private dialog list

## Production architecture

```text
GitHub Pages
      |
      v
Family😍 client
      |
      | HTTPS / WSS
      v
Family Server
      |
      v
Database
```

GitHub Pages alone cannot run `server.js`; the backend needs separate hosting.
