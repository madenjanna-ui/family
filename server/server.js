const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

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
                            version: 5,
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

                if (
                    req.method === "POST" &&
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

                    const text =
                        String(
                            body.text || ""
                        ).trim();

                    if (!text) {

                        sendJson(
                            res,
                            400,
                            {
                                success: false,
                                error:
                                    "Пустое сообщение"
                            }
                        );

                        return;
                    }

                    const message = {

                        id:
                            nextId(
                                db.globalChat
                            ),

                        authorId:
                            user.id,

                        author:
                            user.name,

                        text,

                        time:
                            new Date()
                                .toISOString(),

                        reactions: {}
                    };

                    db.globalChat.push(
                        message
                    );

                    saveDatabase(
                        db
                    );

                    broadcast({

                        type:
                            "global_message",

                        message
                    });

                    sendJson(
                        res,
                        201,
                        {
                            success: true,
                            message
                        }
                    );

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

                    if (
                        req.method ===
                        "POST"
                    ) {

                        const text =
                            String(
                                body.text ||
                                    ""
                            ).trim();

                        if (!text) {

                            sendJson(
                                res,
                                400,
                                {
                                    success: false,
                                    error:
                                        "Пустое сообщение"
                                }
                            );

                            return;
                        }

                        const message = {

                            id:
                                nextId(
                                    db.privateChats[
                                        id
                                    ]
                                ),

                            authorId:
                                user.id,

                            author:
                                user.name,

                            text,

                            time:
                                new Date()
                                    .toISOString(),

                            reactions: {}
                        };

                        db.privateChats[
                            id
                        ].push(
                            message
                        );

                        saveDatabase(
                            db
                        );

                        broadcast({

                            type:
                                "private_message",

                            chatId:
                                id,

                            message
                        });

                        sendJson(
                            res,
                            201,
                            {
                                success: true,
                                message
                            }
                        );

                        return;
                    }
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
