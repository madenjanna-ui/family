const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");
const webpush = require("web-push");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8000);
const DATA_FILE = path.join(__dirname, "data", "family.json");
const VAPID_FILE = path.join(__dirname, "data", "vapid.json");

function defaultDatabase() {
    return {
        version: 5,
        users: [],
        globalChat: [],
        privateChats: {},
        groups: [],
        groupChats: {},
        familyChatMembers: [],
        sessions: {},
        reads: {},
        presence: {},
        settings: {maxUsers: 10}
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
        db.groups ||= [];
        db.groupChats ||= {};
        const hadFamilyChatMembers = Array.isArray(db.familyChatMembers);
        if (!hadFamilyChatMembers) db.familyChatMembers = db.users.map(u => Number(u.id));
        db.sessions ||= {};
        db.reads ||= {};
        db.presence ||= {};
        db.settings ||= {maxUsers: 10};
        db.settings.maxUsers = Math.max(1, Number(db.settings.maxUsers) || 10);

        if (!hadFamilyChatMembers) {
            saveDatabase(db);
        }

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

    if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(
            DATA_FILE,
            DATA_FILE + ".backup"
        );
    }

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
    try {
        fs.mkdirSync(path.dirname(VAPID_FILE), {recursive:true});
        let cfg = null;
        if (fs.existsSync(VAPID_FILE)) {
            try { cfg = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8")); } catch {}
        }
        if (!cfg?.publicKey || !cfg?.privateKey) {
            const keys = webpush.generateVAPIDKeys();
            cfg = { publicKey: keys.publicKey, privateKey: keys.privateKey };
            const tmp = VAPID_FILE + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
            fs.renameSync(tmp, VAPID_FILE);
            console.log("Generated Family Web Push VAPID keys");
        }
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || "mailto:family@example.com",
            cfg.publicKey,
            cfg.privateKey
        );
        return cfg;
    } catch (e) {
        console.error("VAPID setup error:", e.message);
        return null;
    }
}
const pushConfig = ensurePushConfig();

async function sendPushToUsers(userIds, payload) {
    const unique = [...new Set(userIds.map(Number))];
    if (!pushConfig?.publicKey || !pushConfig?.privateKey) {
        console.warn("Push disabled: VAPID configuration is unavailable");
        return {sent: 0, failed: 0, skipped: unique.length};
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    await Promise.all(unique.map(async id => {
        const user = db.users.find(u => Number(u.id) === id);
        const sub = user?.notification;
        if (!sub?.endpoint) {
            skipped++;
            return;
        }
        try {
            await webpush.sendNotification(
                sub,
                JSON.stringify(payload),
                {TTL: 60, urgency: "high"}
            );
            sent++;
            console.log(`Push sent: user=${id}`);
        } catch (e) {
            failed++;
            const code = e.statusCode || e.status;
          console.warn("PUSH ERROR", {
    user: id,
    status: code,
    message: e.message,
    body: e.body || null,
    headers: e.headers || null
});
            if (code === 404 || code === 410) {
                user.notification = null;
                saveDatabase(db);
            }
        }
    }));

    return {sent, failed, skipped};
}

function messageUserFields(user) {
    return { avatar: user?.avatar || "", gender: user?.gender === "female" ? "female" : "male" };
}

function audioId() {
    return crypto.randomBytes(12).toString("hex");
}

function buildMessage(user, text, audio, media) {
    const message = {
        id: 0, authorId: user.id, author: user.name,
        ...messageUserFields(user),
        time: new Date().toISOString(), reactions: {}
    };
    if (audio) {
        const data = String(audio.data || "");
        if (!data.startsWith("data:audio/")) throw new Error("Недопустимый формат голосового сообщения");
        if (data.length > 3 * 1024 * 1024) throw new Error("Голосовое сообщение слишком большое");
        message.type = "audio";
        message.audio = { id: audio.id || audioId(), mime: String(audio.mime || "audio/mp4"), duration: Math.min(600, Math.max(0, Number(audio.duration) || 0)), data, pending: [] };
    } else if (media) {
        const data=String(media.data||"");
        const mime=String(media.mime||"");
        if(!/^data:(image|video)\//.test(data)) throw new Error("Недопустимый формат медиа");
        const type=mime.startsWith("video/")?"video":"image";
        const limit=type==="video"?8*1024*1024:4*1024*1024;
        if(data.length>limit) throw new Error(type==="video"?"Видео слишком большое (максимум 6 МБ)":"Фото слишком большое (максимум 3 МБ)");
        message.type=type==="video"?"video":"photo";
        message.media={id:String(media.id||audioId()),mime,data,name:String(media.name||""),size:Number(media.size)||0,pending:[]};
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
        avatar: user.avatar || "",
        familyChatMember: (db.familyChatMembers || []).map(Number).includes(Number(user.id))
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
                        12 * 1024 * 1024
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
                // FAMILY SETTINGS
                // ==========================================
                if (req.method === "GET" && url.pathname === "/api/settings/family") {
                    const user=authUser(req); if(!user){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
                    sendJson(res,200,{success:true,maxUsers:Math.max(1,Number(db.settings?.maxUsers)||10),usersCount:db.users.length}); return;
                }
                if (req.method === "PUT" && url.pathname === "/api/settings/family") {
                    const admin=requireAdmin(req,res); if(!admin)return;
                    const maxUsers=Math.max(1,Math.min(100,Number(body.maxUsers)||10));
                    db.settings.maxUsers=maxUsers; saveDatabase(db);
                    sendJson(res,200,{success:true,maxUsers,usersCount:db.users.length}); return;
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

                    const maxUsers = Math.max(1, Number(db.settings?.maxUsers) || 10);
                    if (db.users.length >= maxUsers) {
                        sendJson(res,400,{success:false,error:`В семье может быть не более ${maxUsers} человек`});

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
                // CHAT LIST FOR HOME
                // ==========================================
                if (req.method === "GET" && url.pathname === "/api/chats") {
                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false,error:"Не авторизован"}); return; }
                    const chats = [];
                    const unread = {total:0, global:0, private:{}, groups:{}};

                    const globalLast = db.globalChat?.[db.globalChat.length-1];
                    if (globalLast && (db.familyChatMembers||[]).map(Number).includes(Number(user.id))) {
                        const count = unreadGlobal(user.id);
                        chats.push({scope:"global", id:"global", name:"Семья", unread:count, lastMessage:globalLast});
                        unread.global=count; unread.total += count;
                    }

                    for (const other of db.users) {
                        if (Number(other.id) === Number(user.id)) continue;
                        const key = chatId(user.id, other.id);
                        const messages = db.privateChats?.[key] || [];
                        if (!messages.length) continue;
                        const count = unreadPrivate(user.id, other.id);
                        unread.private[String(other.id)] = count;
                        unread.total += count;
                        chats.push({scope:"private", id:key, user:publicUser(other), unread:count, lastMessage:messages[messages.length-1]});
                    }

                    for (const group of db.groups || []) {
                        const members = (group.memberIds || []).map(Number);
                        if (!members.includes(Number(user.id))) continue;
                        const messages = db.groupChats?.[String(group.id)] || [];
                        if (!messages.length) continue;
                        const read = Number(db.reads?.[String(user.id)]?.groups?.[String(group.id)] || 0);
                        const count = messages.filter(m => Number(m.id)>read && Number(m.authorId)!==Number(user.id)).length;
                        unread.groups[String(group.id)] = count;
                        unread.total += count;
                        chats.push({scope:"group", id:group.id, name:group.name, unread:count, lastMessage:messages[messages.length-1]});
                    }

                    chats.sort((a,b)=>new Date(b.lastMessage?.time||0)-new Date(a.lastMessage?.time||0));
                    sendJson(res,200,{success:true,chats,unread});
                    return;
                }

                // ==========================================
                // GROUPS
                // ==========================================
                if (req.method === "GET" && url.pathname === "/api/groups") {
                    const user=authUser(req); if(!user){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
                    const groups=(db.groups||[]).filter(g=>(g.memberIds||[]).map(Number).includes(Number(user.id))).map(g=>({...g,members:(g.memberIds||[]).map(id=>publicUser(db.users.find(u=>Number(u.id)===Number(id))||{}))}));
                    sendJson(res,200,{success:true,groups}); return;
                }

                if (req.method === "POST" && url.pathname === "/api/groups") {
                    const user=authUser(req); if(!user){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
                    const name=String(body.name||"").trim();
                    const memberIds=[...new Set([Number(user.id),...(Array.isArray(body.memberIds)?body.memberIds.map(Number):[])].filter(Boolean))];
                    if(!name){sendJson(res,400,{success:false,error:"Введите название группы"});return;}
                    const known=memberIds.every(id=>db.users.some(u=>Number(u.id)===id));
                    if(!known){sendJson(res,400,{success:false,error:"Некорректный участник группы"});return;}
                    const id=nextId(db.groups||[]); const group={id,name,ownerId:Number(user.id),memberIds,createdAt:new Date().toISOString()};
                    db.groups.push(group); db.groupChats[String(id)]=[]; saveDatabase(db);
                    sendJson(res,201,{success:true,group:{...group,members:memberIds.map(mid=>publicUser(db.users.find(u=>Number(u.id)===mid)||{}))}}); return;
                }

                const groupMatch=url.pathname.match(/^\/api\/groups\/(\d+)$/);
                if(groupMatch){
                    const user=authUser(req); if(!user){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
                    const id=Number(groupMatch[1]); const group=(db.groups||[]).find(g=>Number(g.id)===id);
                    if(!group){sendJson(res,404,{success:false,error:"Группа не найдена"});return;}
                    if(!(group.memberIds||[]).map(Number).includes(Number(user.id))){sendJson(res,403,{success:false,error:"Нет доступа к группе"});return;}

                    if(req.method==="GET"){
                        const messages=db.groupChats?.[String(id)]||[];
                        sendJson(res,200,{success:true,messages});
                        return;
                    }

                    if(req.method==="POST"){
                        const hasAudio=!!body.audio;
                        const hasMedia=!!body.media;
                        const text=String(body.text||"").trim();
                        if(!hasAudio && !hasMedia && !text){sendJson(res,400,{success:false,error:"Пустое сообщение"});return;}
                        let message;
                        try{ message=buildMessage(user,text,hasAudio?body.audio:null,hasMedia?body.media:null); }
                        catch(e){sendJson(res,400,{success:false,error:e.message});return;}
                        db.groupChats[String(id)] ||= [];
                        const chat=db.groupChats[String(id)];
                        message.id=nextId(chat);
                        if(body.replyTo?.id) message.replyTo={id:Number(body.replyTo.id),author:String(body.replyTo.author||""),text:String(body.replyTo.text||"")};
                        if(message.type==="audio"||message.type==="photo"||message.type==="video"){
                            message[message.type==="audio"?"audio":"media"].pending=(group.memberIds||[]).filter(mid=>Number(mid)!==Number(user.id)).map(Number);
                        }
                        chat.push(message);
                        saveDatabase(db);
                        broadcast({type:"group_message",groupId:id,message});

                        const recipients=(group.memberIds||[]).filter(mid=>Number(mid)!==Number(user.id));
                        const pushRecipients=recipients.filter(mid=>!isChatActive(Number(mid),"group",String(id)));
                        if(pushRecipients.length){
                            void sendPushToUsers(pushRecipients,{
                                title:`👥 ${group.name}`,
                                body:message.type==="audio"?"🎙️ Голосовое сообщение":message.type==="photo"?"📷 Фото":message.type==="video"?"🎥 Видео":message.text,
                                url:"./",tag:`family-group-${id}`,scope:"group",chatId:String(id)
                            });
                        }
                        sendJson(res,201,{success:true,message});
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

                    const groupCounts = {};
                    let totalUnread = unreadGlobal(user.id) + Object.values(privateCounts).reduce((a,b)=>a+Number(b||0),0);
                    for (const group of db.groups || []) {
                        if (!(group.memberIds || []).map(Number).includes(Number(user.id))) continue;
                        const gid = String(group.id);
                        const read = Number(db.reads?.[String(user.id)]?.groups?.[gid] || 0);
                        const chat = db.groupChats?.[gid] || [];
                        const count = chat.filter(m => Number(m.id) > read && Number(m.authorId) !== Number(user.id)).length;
                        groupCounts[gid] = count;
                        totalUnread += count;
                    }

                    sendJson(
                        res,
                        200,
                        {
                            success: true,
                            global: unreadGlobal(user.id),
                            private: privateCounts,
                            groups: groupCounts,
                            total: totalUnread
                        }
                    );

                    return;
                }

                // ==========================================
                // MARK READ
                // ==========================================

                const readMatch =
                    url.pathname.match(
                        /^\/api\/read\/(global|private|group)\/([^/]+)$/
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

                        private: {},
                        groups: {}
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

                    } else if (readMatch[1] === "group") {
                        db.reads[String(user.id)].groups ||= {};
                        const gid=decodeURIComponent(readMatch[2]);
                        const chat=db.groupChats?.[gid] || [];
                        db.reads[String(user.id)].groups[gid]=chat.length ? Number(chat[chat.length-1].id) : 0;
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

                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false}); return; }
                    if (!(db.familyChatMembers||[]).map(Number).includes(Number(user.id))) { sendJson(res,403,{success:false,error:"Вы не участник общего чата"}); return; }
                    sendJson(res,200,{success:true,messages:db.globalChat});

                    return;
                }

                if (
                    req.method === "POST" &&
                    url.pathname ===
                        "/api/messages/global"
                ) {
                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false,error:"Не авторизован"}); return; }
                    if (!(db.familyChatMembers||[]).map(Number).includes(Number(user.id))) { sendJson(res,403,{success:false,error:"Вы не участник общего чата"}); return; }
                    const hasAudio = !!body.audio;
                    const hasMedia = !!body.media;
                    const text = String(body.text || "").trim();
                    if (!hasAudio && !hasMedia && !text) { sendJson(res,400,{success:false,error:"Пустое сообщение"}); return; }
                    let message;
                    try { message = buildMessage(user, text, hasAudio ? body.audio : null, hasMedia ? body.media : null); }
                    catch (e) { sendJson(res,400,{success:false,error:e.message}); return; }
                    message.id = nextId(db.globalChat);
                    if (body.replyTo?.id) message.replyTo = {id:Number(body.replyTo.id),author:String(body.replyTo.author||""),text:String(body.replyTo.text||"")};
                    if (message.type === "audio" || message.type === "photo" || message.type === "video") message[message.type === "audio" ? "audio" : "media"].pending = (db.familyChatMembers||[]).filter(id => Number(id)!==Number(user.id)).map(Number);
                    db.globalChat.push(message); saveDatabase(db);
                    broadcast({type:"global_message",message});
                    const recipients = db.users.filter(u=>Number(u.id)!==Number(user.id) && (db.familyChatMembers||[]).map(Number).includes(Number(u.id))).map(u=>Number(u.id));
                    const pushRecipients = recipients.filter(id=>!isChatActive(id,"global","global"));
                    if (pushRecipients.length) {
                        void sendPushToUsers(pushRecipients, {title:`🌌 ${user.name}`, body:message.type==="audio"?"🎙️ Голосовое сообщение":message.type==="photo"?"📷 Фото":message.type==="video"?"🎥 Видео":message.text, url:"./", tag:"family-global",scope:"global",chatId:"global"});
                    }
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
                        const hasMedia = !!body.media;
                        const text = String(body.text || "").trim();
                        if (!hasAudio && !hasMedia && !text) { sendJson(res,400,{success:false,error:"Пустое сообщение"}); return; }
                        let message;
                        try { message = buildMessage(user,text,hasAudio ? body.audio : null, hasMedia ? body.media : null); }
                        catch (e) { sendJson(res,400,{success:false,error:e.message}); return; }
                        message.id = nextId(db.privateChats[id]);
                        if (body.replyTo?.id) message.replyTo = {id:Number(body.replyTo.id),author:String(body.replyTo.author||""),text:String(body.replyTo.text||"")};
                        if (message.type === "audio" || message.type === "photo" || message.type === "video") message[message.type === "audio" ? "audio" : "media"].pending = [other.id];
                        db.privateChats[id].push(message); saveDatabase(db);
                        // Private message: deliver only to the two participants, never to every connected user.
                        sendToUserSockets(user.id, {type:"private_message",chatId:id,message});
                        sendToUserSockets(other.id, {type:"private_message",chatId:id,message});
                        if (!isChatActive(Number(other.id),"private",id)) {
                        void sendPushToUsers([other.id], {title:`💌 ${user.name}`,body:message.type==="audio"?"🎙️ Голосовое сообщение":message.type==="photo"?"📷 Фото":message.type==="video"?"🎥 Видео":message.text,url:"./",tag:`family-private-${id}`,scope:"private",chatId:id});
                    }
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
                    const chat = scope==="global"
                        ? db.globalChat
                        : scope==="group"
                            ? (db.groupChats?.[key] || [])
                            : (db.privateChats[key] || []);
                    const message=findMessage(chat,messageId);
                    if(message && ["audio","photo","video"].includes(message.type)){
                        const store=message.type==="audio"?message.audio:message.media;
                        if(store){store.pending=(store.pending||[]).filter(id=>Number(id)!==Number(user.id));if(store.pending.length===0)delete store.data;saveDatabase(db);}
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
                if (req.method === "GET" && (url.pathname === "/api/push/public-key" || url.pathname === "/api/notifications/public-key")) {
                    if (!pushConfig?.publicKey) { sendJson(res,503,{success:false,error:"Push ещё не настроен"}); return; }
                    sendJson(res,200,{success:true,publicKey:pushConfig.publicKey}); return;
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
                // PUSH TEST
                // ==========================================
                if (req.method === "POST" && url.pathname === "/api/notifications/test") {
                    const user = authUser(req);
                    if (!user) { sendJson(res,401,{success:false,error:"Не авторизован"}); return; }
                    if (!user.notification?.endpoint) { sendJson(res,400,{success:false,error:"На этом аккаунте нет push-подписки"}); return; }
                    try {
                        const result = await sendPushToUsers([user.id], {title:"🔔 Family", body:"Тестовое уведомление работает", url:"./", tag:"family-test"});
                        if (!result.sent) { sendJson(res,502,{success:false,error:"Push не доставлен",result}); return; }
                        sendJson(res,200,{success:true,message:"Push отправлен",result});
                    } catch (e) {
                        sendJson(res,500,{success:false,error:e.message || "Не удалось отправить push"});
                    }
                    return;
                }

                // ==========================================
                // FAMILY SETTINGS
                // ==========================================
                if (url.pathname === "/api/settings" && req.method === "GET") {
                    const user=authUser(req); if(!user){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
                    sendJson(res,200,{success:true,settings:{maxUsers:Number(db.settings?.maxUsers||10)}});
                    return;
                }
                if (url.pathname === "/api/settings" && req.method === "PUT") {
                    const admin=requireAdmin(req,res); if(!admin)return;
                    const maxUsers=Math.max(db.users.length,Math.min(100,Math.floor(Number(body.maxUsers)||10)));
                    db.settings.maxUsers=maxUsers; saveDatabase(db);
                    sendJson(res,200,{success:true,settings:{maxUsers}});
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

const liveSockets = new Map();
const activeChats = new Map(); // userId -> {scope,key}
const pendingCalls = new Map(); // targetUserId -> latest call signal

function isChatActive(userId, scope, key){
    const active=activeChats.get(Number(userId));
    return !!active && active.scope===scope && String(active.key)===String(key);
}
function sendToUserSockets(userId, payload) {
    const id = Number(userId);
    const set = liveSockets.get(id);

    console.log(
        "📞 CALL DELIVERY:",
        "to =", id,
        "type =", payload?.type,
        "sockets =", set ? set.size : 0,
        "onlineUsers =", [...liveSockets.keys()]
    );

    if (!set || !set.size) {
        console.warn("📞 NO SOCKETS FOR USER:", id);
        return false;
    }

    const data = JSON.stringify(payload);
    let sent = 0;

    for (const socket of set) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
            sent++;
        }
    }

    console.log("📞 CALL DELIVERED TO SOCKETS:", sent);
    return sent > 0;
}

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
        if(userId){
            const set=liveSockets.get(Number(userId))||new Set();set.add(socket);liveSockets.set(Number(userId),set);
        }
        socket.on("message",raw=>{
            try{
                const msg=JSON.parse(String(raw||""));
                if(!userId)return;

                if(msg.type==="chat_open"){
                    activeChats.set(Number(userId),{scope:String(msg.scope||""),key:String(msg.key||"")});
                    return;
                }
                if(msg.type==="chat_close"){
                    const current=activeChats.get(Number(userId));
                    if(!current || (current.scope===String(msg.scope||"") && String(current.key)===String(msg.key||""))){
                        activeChats.delete(Number(userId));
                    }
                    return;
                }

                if(!["call_offer","call_answer","call_ice","call_end"].includes(msg.type))return;
                const to=Number(msg.to);if(!to)return;
                const payload={...msg,from:Number(userId),fromName:db.users.find(u=>Number(u.id)===Number(userId))?.name||"Семья"};

                if(msg.type==="call_offer"){
                    pendingCalls.set(to,{payload,expires:Date.now()+60000});
                    const delivered=sendToUserSockets(to,payload);
                    if(!delivered){
                        void sendPushToUsers([to],{title:`📞 ${payload.fromName}`,body:payload.video?"Входящий видеозвонок":"Входящий звонок",url:"./",tag:`family-call-${userId}`,scope:"call",call:true});
                    }
                    return;
                }

                if(msg.type==="call_answer"){
                    pendingCalls.delete(to);
                    sendToUserSockets(to,payload);
                    return;
                }

                if(msg.type==="call_end"){
                    pendingCalls.delete(to);
                    sendToUserSockets(to,payload);
                    return;
                }

                sendToUserSockets(to,payload);
            }catch{}
        });

        socket.send(
            JSON.stringify({
                type:
                    "connected",

                service:
                    "Family Server",

                version: 5
            })
        );

        const pending=pendingCalls.get(Number(userId));
        if(pending){
            if(pending.expires>Date.now()){
                setTimeout(()=>sendToUserSockets(Number(userId),pending.payload),50);
            }else{
                pendingCalls.delete(Number(userId));
            }
        }

        socket.on(
            "close",
            () => {

                if (userId) {
                    const set=liveSockets.get(Number(userId));if(set){set.delete(socket);if(!set.size)liveSockets.delete(Number(userId));}
                    activeChats.delete(Number(userId));
                    setPresence(userId,false);
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