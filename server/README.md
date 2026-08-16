# Family Server

Node.js backend for Family😍.

## Local

```text
Start Server.bat
```

or:

```bash
npm install
npm start
```

The server listens on port 8000.

## Production

Run this backend on a VPS/cloud service with HTTPS/WSS.
Do not expose the development server directly to the public internet without
a reverse proxy, TLS, authentication hardening, backups and proper secret management.

The database file is:

```text
data/family.json
```

It is ignored by Git.
