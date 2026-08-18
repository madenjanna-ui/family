const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");
const webpush = require("web-push");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8000);
const DATA_FILE = path.join(__dirname, "data", "family.json");

function defaultDatabase() {
    return {
        version: 5,
        users: [],
        globalChat: [],
        privateChats: {},
        sessions: {},
        reads: {},
        presence: {}
    };
}

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(String(password))
        .digest("hex");
}

function token() {
    return crypto.randomBytes(32).toString("hex");
}

function createDefaultAdmin() {
    return {
        id: 1,
        name: "Денис",
        login: "admin",
        passwordHash: hashPassword("admin"),
        gender: "male",
        avatar: "",
        role: "admin",
        notification: null
    };
}

function loadDatabase() {
    try {
        const db = fs.existsSync(DATA_FILE)
            ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
            : defaultDatabase();

        db.version = Math.max(Number(db.version) || 1, 5);

        db.users ||= [];
        db.globalChat ||= [];
        db.privateChats ||= {};
        db.sessions ||= {};
        db.reads ||= {};
        db.presence ||= {};

        if (db.users.length === 0) {
            db.users.push(createDefaultAdmin());
            saveDatabase(db);

            console.log(
                "Created initial admin account: admin / admin"
            );
        }

        return db;

    } catch (e) {

        console.error(
            "Database load error:",
            e.message
        );

        const db = defaultDatabase();

        db.users.push(
            createDefaultAdmin()
        );

        saveDatabase(db);

        return db;
    }
}

function saveDatabase(db) {

    fs.mkdirSync(
        path.dirname(DATA_FILE),
        { recursive: true }
    );

    const tmp =
        DATA_FILE + ".tmp";

    fs.writeFileSync(
        tmp,
        JSON.stringify(db, null, 2),
        "utf8"
    );

    fs.renameSync(
        tmp,
        DATA_FILE
    );
}

const db = loadDatabase();

function ensurePushConfig() {
    if (db.pushConfig?.publicKey && db.pushConfig?.privateKey) return;
    try {
        const keys = webpush.generateVAPIDKeys();
        db.pushConfig = { publicKey: keys.publicKey, privateKey: keys.privateKey };
        saveDatabase(db);
        console.log("Generated Family Web Push VAPID keys");
    } catch (e) {
        console.error("VAPID setup error:", e.message);
    }
}
ensurePushConfig();
if (db.pushConfig?.publicKey && db.pushConfig?.privateKey) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:family@example.com",
        db.pushConfig.publicKey,
        db.pushConfig.privateKey
    );
}

async function sendPushToUsers(userIds, payload) {
    if (!db.pushConfig?.publicKey || !db.pushConfig?.privateKey) return;
    const unique = [...new Set(userIds.map(Number))];
    await Promise.all(unique.map(async id => {
        const user = db.users.find(u => Number(u.id) === id);
        const sub = user?.notification;
        if (!sub?.endpoint) return;
        try {
            await webpush.sendNotification(sub, JSON.stringify(payload));
        } catch (e) {
            const code = e.statusCode || e.status;
            if (code === 404 || code === 410) {
                user.notification = null;
                saveDatabase(db);
            } else {
                console.warn("Push error:", e.message);
            }
        }
    }));
}

function messageUserFields(user) {
    return { avatar: user?.avatar || "", gender: user?.gender === "female" ? "female" : "male" };
}

function audioId() {
    return crypto.randomBytes(12).toString("hex");
}

function buildMessage(user, text, audio) {
    const message = {
        id: 0, authorId: user.id, author: user.name,
        ...messageUserFields(user),
        time: new Date().toISOString(), reactions: {}
    };
    if (audio) {
        const data = String(audio.data || "");
        const url = String(audio.url || "");
        if (!url && !data.startsWith("data:audio/")) throw new Error("Недопустимый формат голосового сообщения");
        if (data.length > 3 * 1024 * 1024) throw new Error("Голосовое сообщение слишком большое");
        if (url && !/^https?:\/\//i.test(url)) throw new Error("Недопустимый адрес аудио");
        message.type = "audio";
        message.audio = { id: audio.id || audioId(), mime: String(audio.mime || "audio/mp4"), duration: Math.min(600, Math.max(0, Number(audio.duration) || 0)), pending: [] };
        if (url) message.audio.url = url;
        else message.audio.data = data;
    } else {
        message.type = "text";
        message.text = String(text || "").trim();
    }
    return message;
}

function cleanupDeliveredAudio() {
    let changed = false;
    const chats = [db.globalChat, ...Object.values(db.privateChats || {})];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const chat of chats) for (const m of chat || []) {
        if (m.type === "audio" && m.audio?.data && (m.audio.pending?.length === 0 || new Date(m.time).getTime() < cutoff)) {
            delete m.audio.data;
            changed = true;
        }
    }
    if (changed) saveDatabase(db);
}
cleanupDeliveredAudio();

function nextId(collection) {

    return collection.length
        ? Math.max(
            ...collection.map(
                x => Number(x.id) || 0
            )
        ) + 1
        : 1;
}

function publicUser(user) {

    return {
        id: user.id,
        name: user.name,
        login: user.login,
        gender: user.gender,
        role: user.role,
        avatar: user.avatar || ""
    };
}

function chatId(a, b) {

    return [
        Number(a),
        Number(b)
    ]
        .sort((x, y) => x - y)
        .join("_");
}

function sendJson(res, status, data) {

    const body =
        JSON.stringify(data);

    res.writeHead(status, {

        "Content-Type":
            "application/json; charset=utf-8",

        "Access-Control-Allow-Origin":
            "*",

        "Access-Control-Allow-Headers":
            "Content-Type, Authorization",

        "Access-Control-Allow-Methods":
            "GET,POST,PUT,DELETE,PATCH,OPTIONS"
    });

    res.end(body);
}

function readBody(req) {

    return new Promise(
        (resolve, reject) => {

            let data = "";

            req.on(
                "data",
                chunk => {

                    data += chunk;

                    if (
                        data.length >
                        5 * 1024 * 1024
                    ) {

                        req.destroy();

                        reject(
                            new Error(
                                "Request too large"
                            )
                        );
                    }
                }
            );

            req.on(
                "end",
                () => {

                    try {

                        resolve(
                            data
                                ? JSON.parse(data)
                                : {}
                        );

                    } catch {

                        reject(
                            new Error(
                                "Invalid JSON"
                            )
                        );
                    }
                }
            );

            req.on(
                "error",
                reject
            );
        }
    );
}

function authUser(req) {

    const authorization =
        req.headers.authorization || "";

    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {
        return null;
    }

    const sessionToken =
        authorization.slice(7);

    const userId =
        db.sessions[sessionToken];

    if (!userId) {
        return null;
    }

    return (
        db.users.find(
            user =>
                Number(user.id) ===
                Number(userId)
        ) || null
    );
}

function requireAdmin(req, res) {

    const user =
        authUser(req);

    if (!user) {

        sendJson(
            res,
            401,
            {
                success: false,
                error: "Не авторизован"
            }
        );

        return null;
    }

    if (user.role !== "admin") {

        sendJson(
            res,
            403,
            {
                success: false,
                error: "Недостаточно прав"
            }
        );

        return null;
    }

    return user;
}

function broadcast(message) {

    const data =
        JSON.stringify(message);

    wss.clients.forEach(
        client => {

            if (
                client.readyState ===
                WebSocket.OPEN
            ) {

                client.send(data);
            }
        }
    );
}

function setPresence(
    userId,
    online
) {

    if (!userId) return;

    db.presence[
        String(userId)
    ] = {

        online: Boolean(online),

        lastSeen:
            new Date().toISOString()
    };

    saveDatabase(db);

    broadcast({

        type: "presence",

        userId:
            Number(userId),

        presence:
            db.presence[
                String(userId)
            ]
    });
}

function unreadGlobal(userId) {

    const read =
        Number(
            db.reads[
                String(userId)
            ]?.global || 0
        );

    return db.globalChat.filter(
        message =>
            Number(message.id) > read &&
            Number(message.authorId) !==
                Number(userId)
    ).length;
}

function unreadPrivate(
    userId,
    otherId
) {

    const id =
        chatId(
            userId,
            otherId
        );

    const read =
        Number(
            db.reads[
                String(userId)
            ]?.private?.[id] || 0
        );

    return (
        db.privateChats[id] || []
    ).filter(
        message =>
            Number(message.id) > read &&
            Number(message.authorId) !==
                Number(userId)
    ).length;
}

function findMessage(
    chat,
    messageId
) {

    return chat.find(
        message =>
            Number(message.id) ===
            Number(messageId)
    );
}

function serveStatic(
    req,
    res
) {

    let pathname;

    try {

        pathname =
            decodeURIComponent(
                new URL(
                    req.url,
                    `http://${req.headers.host}`
                ).pathname
            );

    } catch {

        res.writeHead(400);
        res.end(
            "Bad Request"
        );

        return;
    }

    if (
        pathname === "/"
    ) {
        pathname =
            "/index.html";
    }

    const root =
        path.resolve(
            __dirname,
            "public"
        );

    const file =
        path.resolve(
            root,
            "." + pathname
        );

    if (
        !file.startsWith(
            root + path.sep
        ) &&
        file !== root
    ) {

        res.writeHead(403);
        res.end(
            "Forbidden"
        );

        return;
    }

    if (
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
    ) {

        res.writeHead(404);
        res.end(
            "Not Found"
        );

        return;
    }

    const ext =
        path.extname(file)
            .toLowerCase();

    const types = {

        ".html":
            "text/html; charset=utf-8",

        ".css":
            "text/css; charset=utf-8",

        ".js":
            "application/javascript; charset=utf-8",

        ".json":
            "application/json; charset=utf-8",

        ".png":
            "image/png",

        ".jpg":
            "image/jpeg",

        ".jpeg":
            "image/jpeg",

        ".svg":
            "image/svg+xml",

        ".ico":
            "image/x-icon",

        ".webp":
            "image/webp",

        ".mp3":
            "audio/mpeg",

        ".wav":
            "audio/wav",

        ".ogg":
            "audio/ogg",

        ".m4a":
            "audio/mp4"
    };

    res.writeHead(
        200,
        {
            "Content-Type":
                types[ext] ||
                "application/octet-stream",

            "Cache-Control":
                ext === ".html"
                    ? "no-cache"
                    : "public, max-age=31536000"
        }
    );

    fs.createReadStream(
        file
    ).pipe(res);
}

const server =
    http.createServer(
        async (req, res) => {

            if (
                req.method ===
                "OPTIONS"
            ) {

                res.writeHead(
                    204,
                    {
                        "Access-Control-Allow-Origin":
                            "*",

                        "Access-Control-Allow-Headers":
                            "Content-Type, Authorization",

                        "Access-Control-Allow-Methods":
                            "GET,POST,PUT,DELETE,PATCH,OPTIONS"
                    }
                );

                res.end();

                return;
            }

            const mediaMatch = req.url.split("?")[0].match(/^\/media\/audio\/([a-f0-9]+\.(?:m4a|webm|ogg|wav|mp3|aac))$/i);
            if (req.method === "GET" && mediaMatch) {
                const file = path.resolve(__dirname,"data","audio",mediaMatch[1]);
                const root = path.resolve(__dirname,"data","audio") + path.sep;
                if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end("Not Found"); return; }
                const ext=path.extname(file).toLowerCase(); const types={".m4a":"audio/mp4",".webm":"audio/webm",".ogg":"audio/ogg",".wav":"audio/wav",".mp3":"audio/mpeg",".aac":"audio/aac"};
                res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"public, max-age=31536000","Accept-Ranges":"bytes"}); fs.createReadStream(file).pipe(res); return;
            }

            if (
                !req.url.startsWith(
                    "/api/"
                )
            ) {

                serveStatic(
                    req,
                    res
                );

                return;
            }

            try {

                const body =
                    [
                        "POST",
                        "PUT",
                        "PATCH"
                    ].includes(
                        req.method
                    )
                        ? await readBody(req)
                        : {};

                const url =
                    new URL(
                        req.url,
                        `http://${req.headers.host}`
                    );

                // ==========================================
                // HEALTH
                // ==========================================

                if (
                    req.method === "GET" &&
                    url.pathname ===
                        "/api/health"
                ) {

                    sendJson(
                        res,
                        200,
                        {
                            ok: true,
                            service:
                                "Family Server",
                            version: 6.2,
                            users:
                                db.users.length
                        }
                    );

                    return;
                }

                // ==========================================
                // LOGIN
                // ==========================================

                if (
                    req.method === "POST" &&
                    url.pathname ===
                        "/api/login"
                ) {

                    const login =
                        String(
                            body.login || ""
                        )
                            .trim()
                            .toLowerCase();

                    const password =
                        String(
                            body.password || ""
                        );

                    const user =
                        db.users.find(
                            item =>
                                String(
                                    item.login || ""
                                )
                                    .toLowerCase() ===
                                login
                        );

                    if (
                        !user ||
                        user.passwordHash !==
                            hashPassword(
                                password
                            )
                    ) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false,
                                error:
                                    "Неверный логин или пароль"
                            }
                        );

                        return;
                    }

                    const sessionToken =
                        token();

                    db.sessions[
                        sessionToken
                    ] = user.id;

                    saveDatabase(db);

                    setPresence(
                        user.id,
                        true
                    );

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            token:
                                sessionToken,
                            user:
                                publicUser(
                                    user
                                )
                        }
                    );

                    return;
                }

                // ==========================================
                // LOGOUT
                // ==========================================

                if (
                    req.method === "POST" &&
                    url.pathname ===
                        "/api/logout"
                ) {

                    const authorization =
                        req.headers.authorization ||
                        "";

                    if (
                        authorization.startsWith(
                            "Bearer "
                        )
                    ) {

                        const sessionToken =
                            authorization.slice(
                                7
                            );

                        const userId =
                            db.sessions[
                                sessionToken
                            ];

                        if (userId) {

                            setPresence(
                                userId,
                                false
                            );
                        }

                        delete db.sessions[
                            sessionToken
                        ];

                        saveDatabase(db);
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true
                        }
                    );

                    return;
                }

                // ==========================================
                // CURRENT USER
                // ==========================================

                if (
                    req.method === "GET" &&
                    url.pathname ===
                        "/api/me"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            user:
                                publicUser(
                                    user
                                )
                        }
                    );

                    return;
                }

                if (req.method === "PUT" && url.pathname === "/api/me") {
                    const user = authUser(req);
                    if (!user) { sendJson(res, 401, {success:false, error:"Не авторизован"}); return; }
                    if (body.name !== undefined) {
                        const name = String(body.name).trim();
                        if (!name) { sendJson(res,400,{success:false,error:"Имя не может быть пустым"}); return; }
                        user.name = name;
                    }
                    if (body.avatar !== undefined) user.avatar = String(body.avatar || "");
                    saveDatabase(db);
                    sendJson(res,200,{success:true,user:publicUser(user)});
                    return;
                }

                // ==========================================
                // USERS
                // ==========================================

                if (
                    req.method === "GET" &&
                    url.pathname ===
                        "/api/users"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true,

                            users:
                                db.users.map(
                                    item => ({

                                        ...publicUser(
                                            item
                                        ),

                                        presence:
                                            db.presence[
                                                String(
                                                    item.id
                                                )
                                            ] ||
                                            {
                                                online:
                                                    false,
                                                lastSeen:
                                                    null
                                            },

                                        unreadGlobal:
                                            unreadGlobal(
                                                item.id
                                            )
                                    })
                                )
                        }
                    );

                    return;
                }

                // ==========================================
                // CREATE USER
                // ==========================================

                if (
                    req.method === "POST" &&
                    url.pathname ===
                        "/api/users"
                ) {

                    const admin =
                        requireAdmin(
                            req,
                            res
                        );

                    if (!admin) return;

                    if (
                        db.users.length >= 4
                    ) {

                        sendJson(
                            res,
                            400,
                            {
                                success: false,
                                error:
                                    "В семье может быть не более 4 человек"
                            }
                        );

                        return;
                    }

                    const name =
                        String(
                            body.name || ""
                        ).trim();

                    const login =
                        String(
                            body.login || ""
                        )
                            .trim()
                            .toLowerCase();

                    const password =
                        String(
                            body.password || ""
                        );

                    const gender =
                        body.gender ===
                        "female"
                            ? "female"
                            : "male";

                    if (
                        !name ||
                        !login ||
                        !password
                    ) {

                        sendJson(
                            res,
                            400,
                            {
                                success: false,
                                error:
                                    "Заполните имя, логин и пароль"
                            }
                        );

                        return;
                    }

                    if (
                        db.users.some(
                            item =>
                                item.login ===
                                login
                        )
                    ) {

                        sendJson(
                            res,
                            400,
                            {
                                success: false,
                                error:
                                    "Такой логин уже существует"
                            }
                        );

                        return;
                    }

                    const user = {

                        id:
                            nextId(
                                db.users
                            ),

                        name,

                        login,

                        passwordHash:
                            hashPassword(
                                password
                            ),

                        gender,

                        avatar:
                            String(
                                body.avatar ||
                                    ""
                            ),

                        role: "user",

                        notification:
                            null
                    };

                    db.users.push(
                        user
                    );

                    saveDatabase(db);

                    sendJson(
                        res,
                        201,
                        {
                            success: true,
                            user:
                                publicUser(
                                    user
                                )
                        }
                    );

                    return;
                }

                // ==========================================
                // UPDATE / DELETE USER
                // ==========================================

                const userIdMatch =
                    url.pathname.match(
                        /^\/api\/users\/(\d+)$/
                    );

                if (userIdMatch) {

                    const admin =
                        requireAdmin(
                            req,
                            res
                        );

                    if (!admin) return;

                    const id =
                        Number(
                            userIdMatch[1]
                        );

                    const user =
                        db.users.find(
                            item =>
                                Number(
                                    item.id
                                ) === id
                        );

                    if (!user) {

                        sendJson(
                            res,
                            404,
                            {
                                success: false,
                                error:
                                    "Пользователь не найден"
                            }
                        );

                        return;
                    }

                    if (
                        req.method ===
                        "PUT"
                    ) {

                        const name =
                            body.name !==
                            undefined
                                ? String(
                                      body.name
                                  ).trim()
                                : user.name;

                        const login =
                            body.login !==
                            undefined
                                ? String(
                                      body.login
                                  )
                                      .trim()
                                      .toLowerCase()
                                : user.login;

                        if (
                            !name ||
                            !login
                        ) {

                            sendJson(
                                res,
                                400,
                                {
                                    success: false,
                                    error:
                                        "Имя и логин обязательны"
                                }
                            );

                            return;
                        }

                        if (
                            db.users.some(
                                item =>
                                    Number(
                                        item.id
                                    ) !== id &&
                                    item.login ===
                                        login
                            )
                        ) {

                            sendJson(
                                res,
                                400,
                                {
                                    success: false,
                                    error:
                                        "Такой логин уже существует"
                                }
                            );

                            return;
                        }

                        user.name =
                            name;

                        user.login =
                            login;

                        if (
                            body.password
                        ) {

                            user.passwordHash =
                                hashPassword(
                                    body.password
                                );
                        }

                        if (
                            body.gender
                        ) {

                            user.gender =
                                body.gender ===
                                "female"
                                    ? "female"
                                    : "male";
                        }

                        if (
                            body.avatar !==
                            undefined
                        ) {

                            user.avatar =
                                String(
                                    body.avatar ||
                                        ""
                                );
                        }

                        saveDatabase(
                            db
                        );

                        sendJson(
                            res,
                            200,
                            {
                                success: true,
                                user:
                                    publicUser(
                                        user
                                    )
                            }
                        );

                        return;
                    }

                    if (
                        req.method ===
                        "DELETE"
                    ) {

                        if (
                            id ===
                            Number(
                                admin.id
                            )
                        ) {

                            sendJson(
                                res,
                                400,
                                {
                                    success: false,
                                    error:
                                        "Нельзя удалить текущего администратора"
                                }
                            );

                            return;
                        }

                        db.users =
                            db.users.filter(
                                item =>
                                    Number(
                                        item.id
                                    ) !== id
                            );

                        saveDatabase(
                            db
                        );

                        sendJson(
                            res,
                            200,
                            {
                                success: true
                            }
                        );

                        return;
                    }
                }

                // ==========================================
                // UNREAD
                // ==========================================

                if (
                    req.method === "GET" &&
                    url.pathname ===
                        "/api/unread"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    const privateCounts =
                        {};

                    for (
                        const other
                        of db.users
                    ) {

                        if (
                            Number(
                                other.id
                            ) !==
                            Number(
                                user.id
                            )
                        ) {

                            privateCounts[
                                String(
                                    other.id
                                )
                            ] =
                                unreadPrivate(
                                    user.id,
                                    other.id
                                );
                        }
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true,

                            global:
                                unreadGlobal(
                                    user.id
                                ),

                            private:
                                privateCounts
                        }
                    );

                    return;
                }

                // ==========================================
                // MARK READ
                // ==========================================

                const readMatch =
                    url.pathname.match(
                        /^\/api\/read\/(global|private)\/([^/]+)$/
                    );

                if (
                    req.method === "POST" &&
                    readMatch
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    db.reads[
                        String(
                            user.id
                        )
                    ] ||= {

                        global: 0,

                        private: {}
                    };

                    if (
                        readMatch[1] ===
                        "global"
                    ) {

                        const last =
                            db.globalChat.length
                                ? Number(
                                      db
                                          .globalChat[
                                          db.globalChat.length -
                                              1
                                      ].id
                                  )
                                : 0;

                        db.reads[
                            String(
                                user.id
                            )
                        ].global =
                            last;

                    } else {

                        db.reads[
                            String(
                                user.id
                            )
                        ].private ||= {};

                        const id =
                            decodeURIComponent(
                                readMatch[2]
                            );

                        const chat =
                            db.privateChats[
                                id
                            ] || [];

                        db.reads[
                            String(
                                user.id
                            )
                        ].private[
                            id
                        ] =
                            chat.length
                                ? Number(
                                      chat[
                                          chat.length -
                                              1
                                      ].id
                                  )
                                : 0;
                    }

                    saveDatabase(
                        db
                    );

                    sendJson(
                        res,
                        200,
                        {
                            success: true
                        }
                    );

                    return;
                }

                // ==========================================
                // GLOBAL CHAT
                // ==========================================

                if (
                    req.method === "GET" &&
                    url.pathname ===
                        "/api/messages/global"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            messages:
                                db.globalChat
                        }
                    );

                    return;
                }

                if (req.method === "POST" && url.pathname === "/api/audio/upload") {
                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false,error:"Не авторизован"}); return; }
                    const mime = String(req.headers["content-type"] || "audio/mp4").split(";")[0].toLowerCase();
                    if (!mime.startsWith("audio/")) { sendJson(res,400,{success:false,error:"Ожидался аудиофайл"}); return; }
                    const extMap = {"audio/mp4":"m4a","audio/webm":"webm","audio/ogg":"ogg","audio/wav":"wav","audio/mpeg":"mp3","audio/aac":"aac"};
                    const ext = extMap[mime] || "bin";
                    const chunks=[]; let total=0; let tooLarge=false;
                    await new Promise((resolve,reject)=>{
                        req.on("data", chunk=>{ total += chunk.length; if(total > 5*1024*1024){tooLarge=true; return;} chunks.push(chunk); });
                        req.on("end",resolve); req.on("error",reject);
                    });
                    if(tooLarge){sendJson(res,413,{success:false,error:"Голосовое сообщение слишком большое"});return;}
                    if(!total){sendJson(res,400,{success:false,error:"Пустой аудиофайл"});return;}
                    const dir=path.join(__dirname,"data","audio"); fs.mkdirSync(dir,{recursive:true});
                    const id=audioId(), fileName=`${id}.${ext}`, filePath=path.join(dir,fileName);
                    fs.writeFileSync(filePath,Buffer.concat(chunks));
                    const proto=req.headers["x-forwarded-proto"] || "http";
                    const host=req.headers["x-forwarded-host"] || req.headers.host;
                    const urlOut=`${proto}://${host}/media/audio/${fileName}`;
                    sendJson(res,201,{success:true,id,url:urlOut,mime,size:total}); return;
                }

                if (
                    req.method === "POST" &&
                    url.pathname ===
                        "/api/messages/global"
                ) {
                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false,error:"Не авторизован"}); return; }
                    const hasAudio = !!body.audio;
                    const text = String(body.text || "").trim();
                    if (!hasAudio && !text) { sendJson(res,400,{success:false,error:"Пустое сообщение"}); return; }
                    let message;
                    try { message = buildMessage(user, text, hasAudio ? body.audio : null); }
                    catch (e) { sendJson(res,400,{success:false,error:e.message}); return; }
                    message.id = nextId(db.globalChat);
                    if (body.replyTo?.id) message.replyTo = {id:Number(body.replyTo.id),author:String(body.replyTo.author||""),text:String(body.replyTo.text||"")};
                    if (message.type === "audio") message.audio.pending = db.users.filter(u => Number(u.id)!==Number(user.id)).map(u=>Number(u.id));
                    db.globalChat.push(message); saveDatabase(db);
                    broadcast({type:"global_message",message});
                    void sendPushToUsers(db.users.filter(u=>Number(u.id)!==Number(user.id)).map(u=>u.id), {title:`🌌 ${user.name}`, body:message.type==="audio"?"🎙️ Голосовое сообщение":message.text, url:"./", tag:"family-global"});
                    sendJson(res,201,{success:true,message});
                    return;
                }

                // ==========================================
                // PRIVATE CHAT
                // ==========================================

                const privateMatch =
                    url.pathname.match(
                        /^\/api\/messages\/private\/(\d+)$/
                    );

                if (
                    privateMatch
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    const otherId =
                        Number(
                            privateMatch[1]
                        );

                    const other =
                        db.users.find(
                            item =>
                                Number(
                                    item.id
                                ) ===
                                otherId
                        );

                    if (!other) {

                        sendJson(
                            res,
                            404,
                            {
                                success: false,
                                error:
                                    "Пользователь не найден"
                            }
                        );

                        return;
                    }

                    const id =
                        chatId(
                            user.id,
                            otherId
                        );

                    db.privateChats[
                        id
                    ] ||= [];

                    if (
                        req.method ===
                        "GET"
                    ) {

                        sendJson(
                            res,
                            200,
                            {
                                success: true,
                                messages:
                                    db.privateChats[
                                        id
                                    ]
                            }
                        );

                        return;
                    }

                    if (req.method === "POST") {
                        const hasAudio = !!body.audio;
                        const text = String(body.text || "").trim();
                        if (!hasAudio && !text) { sendJson(res,400,{success:false,error:"Пустое сообщение"}); return; }
                        let message;
                        try { message = buildMessage(user,text,hasAudio ? body.audio : null); }
                        catch (e) { sendJson(res,400,{success:false,error:e.message}); return; }
                        message.id = nextId(db.privateChats[id]);
                        if (body.replyTo?.id) message.replyTo = {id:Number(body.replyTo.id),author:String(body.replyTo.author||""),text:String(body.replyTo.text||"")};
                        if (message.type === "audio") message.audio.pending = [other.id];
                        db.privateChats[id].push(message); saveDatabase(db);
                        broadcast({type:"private_message",chatId:id,message});
                        void sendPushToUsers([other.id], {title:`💌 ${user.name}`,body:message.type==="audio"?"🎙️ Голосовое сообщение":message.text,url:"./",tag:`family-private-${id}`});
                        sendJson(res,201,{success:true,message}); return;
                    }
                }

                // ==========================================
                // MESSAGE EDIT / DELETE / AUDIO DELIVERY
                // ==========================================

                const messageActionMatch = url.pathname.match(/^\/api\/messages\/(global|private)\/([^/]+)\/(\d+)$/);
                if (messageActionMatch && (req.method === "PUT" || req.method === "DELETE")) {
                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false,error:"Не авторизован"}); return; }
                    const kind=messageActionMatch[1], key=decodeURIComponent(messageActionMatch[2]), messageId=Number(messageActionMatch[3]);
                    const chat=kind === "global" ? db.globalChat : db.privateChats[key] || [];
                    const message=findMessage(chat,messageId);
                    if (!message) { sendJson(res,404,{success:false,error:"Сообщение не найдено"}); return; }
                    if (req.method === "PUT") {
                        if (Number(message.authorId)!==Number(user.id)) { sendJson(res,403,{success:false,error:"Редактировать можно только свои сообщения"}); return; }
                        if (message.type === "audio") { sendJson(res,400,{success:false,error:"Голосовое сообщение нельзя редактировать"}); return; }
                        const text=String(body.text||"").trim();
                        if(!text){sendJson(res,400,{success:false,error:"Текст не может быть пустым"});return;}
                        message.text=text; message.edited=true; message.editedAt=new Date().toISOString(); saveDatabase(db);
                        broadcast({type:"message_updated",scope:kind,key,message}); sendJson(res,200,{success:true,message}); return;
                    }
                    if (Number(message.authorId)!==Number(user.id) && user.role!=="admin") { sendJson(res,403,{success:false,error:"Удалить можно только своё сообщение"}); return; }
                    const index=chat.indexOf(message); if(index>=0) chat.splice(index,1); saveDatabase(db);
                    broadcast({type:"message_deleted",scope:kind,key,messageId}); sendJson(res,200,{success:true}); return;
                }

                if (req.method === "POST" && url.pathname === "/api/audio/ack") {
                    const user=authUser(req); if(!user){sendJson(res,401,{success:false});return;}
                    const scope=String(body.scope||""), key=String(body.key||""), messageId=Number(body.messageId);
                    const chat=scope==="global"?db.globalChat:db.privateChats[key]||[]; const message=findMessage(chat,messageId);
                    if(message?.type==="audio"&&message.audio){
                        message.audio.pending=(message.audio.pending||[]).filter(id=>Number(id)!==Number(user.id));
                        if(message.audio.pending.length===0) delete message.audio.data;
                        saveDatabase(db);
                    }
                    sendJson(res,200,{success:true}); return;
                }

                // ==========================================
                // REACTIONS
                // ==========================================

                const reactionMatch =
                    url.pathname.match(
                        /^\/api\/messages\/(global|private)\/([^/]+)\/(\d+)\/reaction$/
                    );

                if (
                    reactionMatch &&
                    req.method ===
                        "POST"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    const kind =
                        reactionMatch[1];

                    const key =
                        reactionMatch[2];

                    const messageId =
                        Number(
                            reactionMatch[3]
                        );

                    const chat =
                        kind === "global"
                            ? db.globalChat
                            : db.privateChats[
                                  key
                              ] || [];

                    const message =
                        findMessage(
                            chat,
                            messageId
                        );

                    if (!message) {

                        sendJson(
                            res,
                            404,
                            {
                                success: false,
                                error:
                                    "Сообщение не найдено"
                            }
                        );

                        return;
                    }

                    const emoji =
                        String(
                            body.emoji || ""
                        ).trim();

                    const allowed = [
                        "❤️",
                        "👍",
                        "😂",
                        "😍",
                        "😢",
                        "😮"
                    ];

                    if (
                        !allowed.includes(
                            emoji
                        )
                    ) {

                        sendJson(
                            res,
                            400,
                            {
                                success: false,
                                error:
                                    "Недопустимая реакция"
                            }
                        );

                        return;
                    }

                    message.reactions ||= {};

                    message.reactions[
                        emoji
                    ] ||= [];

                    const list =
                        message.reactions[
                            emoji
                        ];

                    const index =
                        list.indexOf(
                            user.id
                        );

                    if (
                        index >= 0
                    ) {

                        list.splice(
                            index,
                            1
                        );

                    } else {

                        list.push(
                            user.id
                        );
                    }

                    if (
                        !list.length
                    ) {

                        delete message
                            .reactions[
                                emoji
                            ];
                    }

                    saveDatabase(
                        db
                    );

                    broadcast({

                        type:
                            "reaction",

                        scope:
                            kind,

                        key,

                        messageId,

                        reactions:
                            message.reactions
                    });

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            reactions:
                                message.reactions
                        }
                    );

                    return;
                }

                // ==========================================
                if (req.method === "GET" && url.pathname === "/api/push/public-key") {
                    if (!db.pushConfig?.publicKey) { sendJson(res,503,{success:false,error:"Push ещё не настроен"}); return; }
                    sendJson(res,200,{success:true,publicKey:db.pushConfig.publicKey}); return;
                }

                // NOTIFICATIONS / PUSH SUBSCRIPTION
                // ==========================================

                if (
                    req.method === "POST" &&
                    (
                        url.pathname ===
                            "/api/notifications/subscribe" ||

                        url.pathname ===
                            "/api/push/subscribe"
                    )
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false,
                                error:
                                    "Не авторизован"
                            }
                        );

                        return;
                    }

                    if (
                        !body.subscription
                    ) {

                        sendJson(
                            res,
                            400,
                            {
                                success: false,
                                error:
                                    "Подписка уведомлений не передана"
                            }
                        );

                        return;
                    }

                    user.notification =
                        body.subscription;

                    saveDatabase(
                        db
                    );

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            message:
                                "Уведомления включены"
                        }
                    );

                    return;
                }

                // ==========================================
                // NOTIFICATION STATUS
                // ==========================================

                if (
                    req.method === "GET" &&
                    url.pathname ===
                        "/api/notifications/status"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            enabled:
                                Boolean(
                                    user.notification
                                )
                        }
                    );

                    return;
                }

                // ==========================================
                // NOTIFICATION UNSUBSCRIBE
                // ==========================================

                if (
                    req.method === "POST" &&
                    url.pathname ===
                        "/api/notifications/unsubscribe"
                ) {

                    const user =
                        authUser(req);

                    if (!user) {

                        sendJson(
                            res,
                            401,
                            {
                                success: false
                            }
                        );

                        return;
                    }

                    user.notification =
                        null;

                    saveDatabase(
                        db
                    );

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            message:
                                "Уведомления отключены"
                        }
                    );

                    return;
                }

                // ==========================================
                // UNKNOWN API
                // ==========================================

                sendJson(
                    res,
                    404,
                    {
                        success: false,
                        error:
                            "API endpoint not found"
                    }
                );

            } catch (error) {

                console.error(
                    "API error:",
                    error
                );

                sendJson(
                    res,
                    500,
                    {
                        success: false,
                        error:
                            "Server error"
                    }
                );
            }
        }
    );

// ==========================================
// WEBSOCKET
// ==========================================

const wss =
    new WebSocket.Server({
        server,
        path: "/ws"
    });

wss.on(
    "connection",
    (socket, req) => {

        let userId = null;

        try {

            const url =
                new URL(
                    req.url,
                    "http://localhost"
                );

            const sessionToken =
                url.searchParams.get(
                    "token"
                );

            userId =
                sessionToken
                    ? db.sessions[
                          sessionToken
                      ]
                    : null;

        } catch {

            userId = null;
        }

        if (userId) {

            setPresence(
                userId,
                true
            );
        }

        socket._familyUserId =
            userId;

        socket.send(
            JSON.stringify({
                type:
                    "connected",

                service:
                    "Family Server",

                version: 5
            })
        );

        socket.on(
            "close",
            () => {

                if (userId) {

                    setPresence(
                        userId,
                        false
                    );
                }
            }
        );
    }
);

// ==========================================
// START
// ==========================================

server.listen(
    PORT,
    HOST,
    () => {

        console.log(
            "========================================"
        );

        console.log(
            "          Family Server 😍 v5"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Local:   http://localhost:${PORT}`
        );

        console.log(
            "Server is running..."
        );
    }
);
