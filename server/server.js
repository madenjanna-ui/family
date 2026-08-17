const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");
const webpush = require("web-push");

const HOST = "0.0.0.0";
const PORT = 8000;
const DATA_FILE = path.join(__dirname, "data", "family.json");

function defaultDatabase() {
    return { version: 5, users: [], globalChat: [], privateChats: {}, sessions: {}, reads: {}, presence: {}, pushSubscriptions: {} };
}

const VAPID_FILE = path.join(__dirname, "data", "vapid.json");
function loadVapid() {
    try {
        if (fs.existsSync(VAPID_FILE)) return JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
    } catch (e) { console.error("VAPID load error:", e.message); }
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(VAPID_FILE), {recursive:true});
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), "utf8");
    return keys;
}
const VAPID = loadVapid();
webpush.setVapidDetails("mailto:family@example.com", VAPID.publicKey, VAPID.privateKey);

function createDefaultAdmin() {
    return {
        id: 1,
        name: "Денис",
        login: "admin",
        passwordHash: hashPassword("admin"),
        gender: "male",
        avatar: "",
        role: "admin"
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
        db.pushSubscriptions ||= {};

        // First-run bootstrap: if the persistent database has no users,
        // create the initial family administrator. Existing data is never replaced.
        if (db.users.length === 0) {
            db.users.push(createDefaultAdmin());
            saveDatabase(db);
            console.log("Created initial admin account: admin / admin");
        }

        return db;
    } catch (e) {
        console.error("Database load error:", e.message);
        const db = defaultDatabase();
        db.users.push(createDefaultAdmin());
        saveDatabase(db);
        return db;
    }
}
function saveDatabase(db) {
    fs.mkdirSync(path.dirname(DATA_FILE), {recursive:true});
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
}
const db = loadDatabase();
function nextId(c) { return c.length ? Math.max(...c.map(x => Number(x.id)||0))+1 : 1; }
function hashPassword(p) { return crypto.createHash("sha256").update(String(p)).digest("hex"); }
function token() { return crypto.randomBytes(32).toString("hex"); }
function publicUser(u) { return {id:u.id,name:u.name,login:u.login,gender:u.gender,role:u.role,avatar:u.avatar||""}; }
function savePushSubscription(userId, subscription) {
    if (!subscription || !subscription.endpoint) return;
    db.pushSubscriptions[String(userId)] ||= [];
    const list = db.pushSubscriptions[String(userId)];
    const idx = list.findIndex(x => x.endpoint === subscription.endpoint);
    if (idx >= 0) list[idx] = subscription; else list.push(subscription);
    saveDatabase(db);
}
function removePushSubscription(userId, endpoint) {
    const list = db.pushSubscriptions[String(userId)] || [];
    db.pushSubscriptions[String(userId)] = list.filter(x => x.endpoint !== endpoint);
    saveDatabase(db);
}
function pushToUsers(userIds, payload) {
    const jobs=[];
    for (const userId of userIds) {
        for (const sub of (db.pushSubscriptions[String(userId)] || [])) {
            jobs.push(webpush.sendNotification(sub, JSON.stringify(payload)).catch(err => {
                if (err.statusCode === 404 || err.statusCode === 410) removePushSubscription(userId, sub.endpoint);
            }));
        }
    }
    Promise.allSettled(jobs).catch(()=>{});
}
function chatId(a,b) { return [Number(a),Number(b)].sort((x,y)=>x-y).join("_"); }
function sendJson(res,status,data) {
    const body=JSON.stringify(data);
    res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS"});
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve,reject)=>{
        let s="";
        req.on("data",c=>{s+=c;if(s.length>10*1024*1024){req.destroy();reject(new Error("Request too large"));}});
        req.on("end",()=>{try{resolve(s?JSON.parse(s):{});}catch{reject(new Error("Invalid JSON"));}});
        req.on("error",reject);
    });
}
function authUser(req) {
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) return null;
    const id=db.sessions[h.slice(7)];
    return db.users.find(u=>u.id===id)||null;
}
function requireAdmin(req,res) {
    const u=authUser(req);
    if(!u){sendJson(res,401,{success:false,error:"Не авторизован"});return null;}
    if(u.role!=="admin"){sendJson(res,403,{success:false,error:"Недостаточно прав"});return null;}
    return u;
}
function setPresence(userId, online) {
    if (!userId) return;
    db.presence[String(userId)] = {
        online: !!online,
        lastSeen: new Date().toISOString()
    };
    saveDatabase(db);
    broadcast({type:"presence", userId:Number(userId), presence:db.presence[String(userId)]});
}
function unreadGlobal(userId) {
    const read = db.reads[String(userId)]?.global || 0;
    return db.globalChat.filter(m => Number(m.id) > Number(read) && Number(m.authorId) !== Number(userId)).length;
}
function unreadPrivate(userId, otherId) {
    const id = chatId(userId, otherId);
    const read = db.reads[String(userId)]?.private?.[id] || 0;
    return (db.privateChats[id] || []).filter(m => Number(m.id) > Number(read) && Number(m.authorId) !== Number(userId)).length;
}
function broadcast(msg) {
    const data=JSON.stringify(msg);
    wss.clients.forEach(c=>{if(c.readyState===WebSocket.OPEN)c.send(data);});
}
function newAudioId(){ return crypto.randomBytes(12).toString("hex"); }
const AUDIO_TTL_MS = 48 * 60 * 60 * 1000;
function prepareAudio(audio,pendingFor){
    const now=Date.now();
    return {
        id:newAudioId(),
        mime:String(audio.mime||"audio/mp4"),
        data:String(audio.data||""),
        duration:Number(audio.duration||0),
        pendingFor:[...new Set((pendingFor||[]).map(Number).filter(Boolean))],
        expiresAt:now+AUDIO_TTL_MS
    };
}
function findMessageByAudio(audioId){
    for(const m of db.globalChat){if(m.type==="audio"&&m.audio?.id===audioId)return {message:m,scope:"global",key:"global"};}
    for(const [key,list] of Object.entries(db.privateChats)) for(const m of list){if(m.type==="audio"&&m.audio?.id===audioId)return {message:m,scope:"private",key};}
    return null;
}
function finalizeAudio(message){
    if(!message?.audio)return;
    delete message.audio.data;
    delete message.audio.pendingFor;
    message.audio.cleanedAt=Date.now();
}
function cleanupTemporaryAudio(){
    const now=Date.now(); let changed=false;
    const clean=m=>{
        if(m.type!=="audio"||!m.audio)return;
        if(m.audio.expiresAt && Number(m.audio.expiresAt)<=now){finalizeAudio(m);changed=true;return;}
        if(Array.isArray(m.audio.pendingFor) && m.audio.pendingFor.length===0 && m.audio.data){finalizeAudio(m);changed=true;}
    };
    db.globalChat.forEach(clean);Object.values(db.privateChats).forEach(list=>list.forEach(clean));
    if(changed)saveDatabase(db);
}
setInterval(cleanupTemporaryAudio,10*60*1000);
cleanupTemporaryAudio();
function findMessage(chat,mId) { return chat.find(m=>Number(m.id)===Number(mId)); }

function serveStatic(req,res) {
    let p;
    try { p=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname); }
    catch { res.writeHead(400);res.end("Bad Request");return; }
    if(p==="/")p="/index.html";
    const root=path.resolve(__dirname,"public");
    const file=path.resolve(root,"."+p);
    if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end("Forbidden");return;}
    if(!fs.existsSync(file)){res.writeHead(404);res.end("Not Found");return;}
    const ext=path.extname(file).toLowerCase();
    const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon",".webp":"image/webp"};
    res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});
    fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{
    if(req.method==="OPTIONS"){sendJson(res,204,{});return;}
    if(!req.url.startsWith("/api/")){serveStatic(req,res);return;}
    try {
        const body=["POST","PUT","PATCH"].includes(req.method)?await readBody(req):{};
        const url=new URL(req.url,`http://${req.headers.host}`);

        if(req.method==="GET"&&url.pathname==="/api/health"){sendJson(res,200,{ok:true,service:"Family Server",users:db.users.length});return;}

        if(req.method==="POST"&&url.pathname==="/api/login"){
            const login=String(body.login||"").trim().toLowerCase(), password=String(body.password||"");
            const u=db.users.find(x=>x.login.toLowerCase()===login);
            if(!u||u.passwordHash!==hashPassword(password)){sendJson(res,401,{success:false,error:"Неверный логин или пароль"});return;}
            const t=token();db.sessions[t]=u.id;setPresence(u.id,true);
            sendJson(res,200,{success:true,token:t,user:publicUser(u)});return;
        }
        if(req.method==="POST"&&url.pathname==="/api/logout"){
            const h=req.headers.authorization||"";if(h.startsWith("Bearer ")){const uid=db.sessions[h.slice(7)]; if(uid) setPresence(uid,false); delete db.sessions[h.slice(7)]; saveDatabase(db);}
            sendJson(res,200,{success:true});return;
        }
        if(req.method==="GET"&&url.pathname==="/api/me"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            sendJson(res,200,{success:true,user:publicUser(u)});return;
        }
        if(req.method==="PUT"&&url.pathname==="/api/me"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
            if(body.name!==undefined){const name=String(body.name).trim();if(!name){sendJson(res,400,{success:false,error:"Имя не может быть пустым"});return;}u.name=name;}
            if(body.gender!==undefined)u.gender=body.gender==="female"?"female":"male";
            if(body.avatar!==undefined){const avatar=String(body.avatar||"");if(avatar.length>900000){sendJson(res,400,{success:false,error:"Аватар слишком большой"});return;}u.avatar=avatar;}
            saveDatabase(db);sendJson(res,200,{success:true,user:publicUser(u)});return;
        }
        if(req.method==="GET"&&url.pathname==="/api/users"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            sendJson(res,200,{success:true,users:db.users.map(u=>({
                ...publicUser(u),
                presence: db.presence[String(u.id)] || {online:false,lastSeen:null},
                unreadGlobal: unreadGlobal(u.id)
            }))});return;
        }
        if(req.method==="POST"&&url.pathname==="/api/users"){
            const admin=requireAdmin(req,res);if(!admin)return;
            if(db.users.length>=4){sendJson(res,400,{success:false,error:"В семье может быть не более 4 человек"});return;}
            const name=String(body.name||"").trim(),login=String(body.login||"").trim().toLowerCase(),password=String(body.password||""),gender=body.gender==="female"?"female":"male";
            if(!name||!login||!password){sendJson(res,400,{success:false,error:"Заполните имя, логин и пароль"});return;}
            if(db.users.some(u=>u.login===login)){sendJson(res,400,{success:false,error:"Такой логин уже существует"});return;}
            const u={id:nextId(db.users),name,login,passwordHash:hashPassword(password),gender,avatar:"",role:"user"};
            db.users.push(u);saveDatabase(db);sendJson(res,201,{success:true,user:publicUser(u)});return;
        }
        const userIdMatch=url.pathname.match(/^\/api\/users\/(\d+)$/);
        if(userIdMatch){
            const admin=requireAdmin(req,res);if(!admin)return;
            const id=Number(userIdMatch[1]),u=db.users.find(x=>x.id===id);
            if(!u){sendJson(res,404,{success:false,error:"Пользователь не найден"});return;}
            if(req.method==="PUT"){
                const name=body.name!==undefined?String(body.name).trim():u.name;
                const login=body.login!==undefined?String(body.login).trim().toLowerCase():u.login;
                if(!name||!login){sendJson(res,400,{success:false,error:"Имя и логин обязательны"});return;}
                if(db.users.some(x=>x.id!==id&&x.login===login)){sendJson(res,400,{success:false,error:"Такой логин уже существует"});return;}
                u.name=name;u.login=login;
                if(body.password)u.passwordHash=hashPassword(body.password);
                if(body.gender)u.gender=body.gender==="female"?"female":"male";
                if(body.avatar!==undefined)u.avatar=String(body.avatar||"");
                saveDatabase(db);sendJson(res,200,{success:true,user:publicUser(u)});return;
            }
            if(req.method==="DELETE"){
                if(id===admin.id){sendJson(res,400,{success:false,error:"Нельзя удалить текущего администратора"});return;}
                db.users=db.users.filter(x=>x.id!==id);
                const scrubPending=m=>{if(m.type==="audio"&&Array.isArray(m.audio?.pendingFor)){m.audio.pendingFor=m.audio.pendingFor.filter(pid=>Number(pid)!==id);if(m.audio.pendingFor.length===0)finalizeAudio(m);}};
                db.globalChat.forEach(scrubPending);Object.values(db.privateChats).forEach(list=>list.forEach(scrubPending));
                saveDatabase(db);sendJson(res,200,{success:true});return;
            }
        }

        if(req.method==="GET"&&url.pathname==="/api/push/public-key"){
            sendJson(res,200,{success:true,publicKey:VAPID.publicKey});return;
        }
        if(req.method==="POST"&&url.pathname==="/api/push/subscribe"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
            if(!body.subscription || !body.subscription.endpoint){sendJson(res,400,{success:false,error:"Некорректная подписка"});return;}
            savePushSubscription(u.id,body.subscription);sendJson(res,200,{success:true});return;
        }
        if(req.method==="POST"&&url.pathname==="/api/push/unsubscribe"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false,error:"Не авторизован"});return;}
            if(body.endpoint)removePushSubscription(u.id,String(body.endpoint));sendJson(res,200,{success:true});return;
        }
        if(req.method==="GET"&&url.pathname==="/api/unread"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            const privateUnread={};
            for(const other of db.users){
                if(other.id!==u.id) privateUnread[String(other.id)] = unreadPrivate(u.id, other.id);
            }
            sendJson(res,200,{success:true,global:unreadGlobal(u.id),private:privateUnread});return;
        }

        const readMatch=url.pathname.match(/^\/api\/read\/(global|private)\/([^/]+)$/);
        if(req.method==="POST"&&readMatch){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            db.reads[String(u.id)] ||= {global:0,private:{}};
            if(readMatch[1]==="global"){
                const last=db.globalChat.length ? db.globalChat[db.globalChat.length-1].id : 0;
                db.reads[String(u.id)].global=Number(last);
            } else {
                db.reads[String(u.id)].private ||= {};
                const id=readMatch[2];
                const chat=db.privateChats[id]||[];
                db.reads[String(u.id)].private[id]=chat.length ? Number(chat[chat.length-1].id) : 0;
            }
            saveDatabase(db);
            sendJson(res,200,{success:true});return;
        }

        if(req.method==="POST"&&url.pathname.startsWith("/api/read/")){
            const u=authUser(req);
            if(!u){sendJson(res,401,{success:false});return;}
            const parts=url.pathname.split("/");
            const scope=parts[3];
            const key=decodeURIComponent(parts[4]||"");
            db.reads ||= {};
            db.reads[String(u.id)] ||= {global:0,private:{}};
            db.reads[String(u.id)].private ||= {};

            if(scope==="global"){
                const last=db.globalChat.length ? Number(db.globalChat[db.globalChat.length-1].id) : 0;
                db.reads[String(u.id)].global=last;
            } else if(scope==="private"){
                const cid=key || chatId(u.id, Number(parts[4]));
                const chat=db.privateChats[cid]||[];
                db.reads[String(u.id)].private[cid]=chat.length ? Number(chat[chat.length-1].id) : 0;
            } else {
                sendJson(res,400,{success:false,error:"Invalid read scope"}); return;
            }
            saveDatabase(db);
            sendJson(res,200,{success:true});
            return;
        }

        if(req.method==="GET"&&url.pathname==="/api/messages/global"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            sendJson(res,200,{success:true,messages:db.globalChat});return;
        }
        if(req.method==="POST"&&url.pathname==="/api/messages/global"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            let m;
            const text=String(body.text||"").trim();
            if(text){
                m={id:nextId(db.globalChat),authorId:u.id,author:u.name,text,time:new Date().toISOString(),reactions:{},type:"text",avatar:u.avatar||"",gender:u.gender};
            } else if(body.audio && body.audio.data){
                const audio=body.audio;
                if(String(audio.data).length>8000000){sendJson(res,400,{success:false,error:"Голосовое сообщение слишком большое"});return;}
                const recipients=db.users.filter(x=>Number(x.id)!==Number(u.id)).map(x=>Number(x.id));
                m={id:nextId(db.globalChat),authorId:u.id,author:u.name,time:new Date().toISOString(),reactions:{},type:"audio",avatar:u.avatar||"",gender:u.gender,audio:prepareAudio(audio,recipients)};
                if(!recipients.length) finalizeAudio(m);
            } else {sendJson(res,400,{success:false,error:"Пустое сообщение"});return;}
            db.globalChat.push(m);saveDatabase(db);broadcast({type:"global_message",message:m});
            pushToUsers(db.users.filter(x=>Number(x.id)!==Number(u.id)).map(x=>x.id),{title:"😍 Семья",body:m.type==="audio"?`${u.name}: 🎙️ Голосовое сообщение`:`${u.name}: ${m.text}`,tag:"family-global",url:"./"});
            sendJson(res,201,{success:true,message:m});return;
        }

        const pm=url.pathname.match(/^\/api\/messages\/private\/(\d+)$/);
        if(pm){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            const otherId=Number(pm[1]),other=db.users.find(x=>x.id===otherId);
            if(!other){sendJson(res,404,{success:false,error:"Пользователь не найден"});return;}
            const id=chatId(u.id,otherId);db.privateChats[id] ||= [];
            if(req.method==="GET"){sendJson(res,200,{success:true,messages:db.privateChats[id]||[]});return;}
            if(req.method==="POST"){
                let m;
                const text=String(body.text||"").trim();
                if(text){
                    m={id:nextId(db.privateChats[id]),authorId:u.id,author:u.name,text,time:new Date().toISOString(),reactions:{},type:"text",avatar:u.avatar||"",gender:u.gender};
                } else if(body.audio && body.audio.data){
                    const audio=body.audio;
                    if(String(audio.data).length>8000000){sendJson(res,400,{success:false,error:"Голосовое сообщение слишком большое"});return;}
                    m={id:nextId(db.privateChats[id]),authorId:u.id,author:u.name,time:new Date().toISOString(),reactions:{},type:"audio",avatar:u.avatar||"",gender:u.gender,audio:prepareAudio(audio,[otherId])};
                } else {sendJson(res,400,{success:false,error:"Пустое сообщение"});return;}
                db.privateChats[id].push(m);saveDatabase(db);broadcast({type:"private_message",chatId:id,message:m});
                pushToUsers([otherId],{title:`😍 ${u.name}`,body:m.type==="audio"?"🎙️ Голосовое сообщение":m.text,tag:`family-private-${id}`,url:"./"});
                sendJson(res,201,{success:true,message:m});return;
            }
        }

        if(req.method==="POST"&&url.pathname==="/api/audio/ack"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            const audioId=String(body.audioId||"");
            const found=findMessageByAudio(audioId);
            if(!found){sendJson(res,404,{success:false,error:"Голосовое уже удалено"});return;}
            const audio=found.message.audio;
            if(Array.isArray(audio.pendingFor)){
                audio.pendingFor=audio.pendingFor.filter(id=>Number(id)!==Number(u.id));
                if(audio.pendingFor.length===0)finalizeAudio(found.message);
                saveDatabase(db);
            }
            sendJson(res,200,{success:true,cleaned:!audio.data});return;
        }

        const react=url.pathname.match(/^\/api\/messages\/(global|private)\/([^/]+)\/(\d+)\/reaction$/);
        if(react&&req.method==="POST"){
            const u=authUser(req);if(!u){sendJson(res,401,{success:false});return;}
            const kind=react[1],key=react[2],mid=Number(react[3]);
            let chat;
            if(kind==="global")chat=db.globalChat;
            else chat=db.privateChats[key]||[];
            const m=findMessage(chat,mid);
            if(!m){sendJson(res,404,{success:false,error:"Сообщение не найдено"});return;}
            const emoji=String(body.emoji||"").trim();
            const allowed=["❤️","👍","😂","😍","😢","😮"];
            if(!allowed.includes(emoji)){sendJson(res,400,{success:false,error:"Недопустимая реакция"});return;}
            m.reactions ||= {};
            m.reactions[emoji] ||= [];
            const list=m.reactions[emoji];
            const idx=list.indexOf(u.id);
            if(idx>=0)list.splice(idx,1);else list.push(u.id);
            if(!list.length)delete m.reactions[emoji];
            saveDatabase(db);
            broadcast({type:"reaction",scope:kind,key,messageId:mid,reactions:m.reactions});
            sendJson(res,200,{success:true,reactions:m.reactions});return;
        }

        sendJson(res,404,{success:false,error:"API endpoint not found"});
    } catch(e) {
        console.error(e);sendJson(res,500,{success:false,error:"Server error"});
    }
});

const wss=new WebSocket.Server({server,path:"/ws"});
wss.on("connection",(socket,req)=>{
    let uid=null;
    try {
        const u=new URL(req.url,"http://localhost");
        const t=u.searchParams.get("token");
        uid=t ? db.sessions[t] : null;
    } catch {}
    if(uid) setPresence(uid,true);
    socket._familyUserId=uid;
    socket.send(JSON.stringify({type:"connected",service:"Family Server"}));
    socket.on("close",()=>{ if(uid) setPresence(uid,false); });
});

server.listen(PORT,HOST,()=>{
    console.log("========================================");
    console.log("          Family Server 😍");
    console.log("========================================");
    console.log(`Local:   http://localhost:${PORT}`);
    console.log("Network: http://<IP-ADDRESS>:8000");
    console.log("Server is running...");
});
