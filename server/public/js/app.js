const app = document.getElementById("app");
const REACTIONS = ["❤️","👍","😂","😍","😢","😮"];

const App = {
    ws:null,
    mediaRecorder:null,
    mediaStream:null,
    recordingChunks:[],
    recordingStarted:0,
    recordingTimer:null,
    notificationRegistration:null,
    appearanceTheme: localStorage.getItem("FamilyTheme") || "cosmic",
    appearanceMode: localStorage.getItem("FamilyMode") || "light",
    chatNavSeq: 0,
    fontFamily: localStorage.getItem("FamilyFont") || "system",
    fontSize: Number(localStorage.getItem("FamilyFontSize") || 17),
    usersCache: [],
    replyTarget: null,
    favorites: JSON.parse(localStorage.getItem("FamilyFavorites") || "[]"),
    pendingQuickAction: null,
    callPeer: null,
    callPc: null,
    callStream: null,
    callTargetId: null,
    callTargetName: "",
    callVideo: false,
    pendingIncomingCall: null,
    activeChatScope: null,
    activeChatKey: null,
    callIceQueue: [],
    incomingIceQueue: [],
    callConnected: false,


    async start() {
        this.applyAppearance();

        // Do not block the application UI on Service Worker startup.
        // iOS standalone/PWA can keep navigator.serviceWorker.ready pending.
        this.initPWA().catch(() => {});

        if (await Auth.autoLogin()) {
            this.connectRealtime();
            await this.showHome();
            this.ensurePushSubscription(false);
        } else this.showLogin();
    },

    async initPWA() {
        if (!("serviceWorker" in navigator)) return null;
        try {
            const swUrl = new URL("sw.js", document.baseURI);
            const scope = new URL("./", document.baseURI).pathname;
            await navigator.serviceWorker.register(swUrl.href, {scope});
            this.notificationRegistration = await navigator.serviceWorker.ready;
            console.log("🔔 Family Service Worker READY:", this.notificationRegistration.scope);
            return this.notificationRegistration;
        } catch(e) {
            this.notificationRegistration = null;
            console.warn("Service worker:", e);
            return null;
        }
    },

    connectRealtime() {
        if (this.ws) try { this.ws.close(); } catch {}
        this.ws = API.connectWS(msg => {
            if (msg.type === "global_message") {
                if (Number(msg.message?.authorId) !== Number(Auth.currentUser?.id)) {
                    const active = this.isCurrentChat("global", "global");
                    this.messageArrived(msg.message, true, active, "global", "global");
                }
                if (document.getElementById("messages")) this.updateOpenChatMessages(true, null, msg.message);
            }
            if (msg.type === "private_message") {
                const otherId = Number(document.body.dataset.privateUser || 0);
                const active = otherId && this.getPrivateChatId(Auth.currentUser.id, otherId) === msg.chatId;
                if (Number(msg.message?.authorId) !== Number(Auth.currentUser?.id)) this.messageArrived(msg.message, false, active, "private", msg.chatId);
                if (active) this.updateOpenChatMessages(false, otherId, msg.message);
            }
            if (msg.type === "group_message") {
                const gid=String(msg.groupId);
                const active=this.isCurrentChat("group",gid);
                if(Number(msg.message?.authorId)!==Number(Auth.currentUser?.id)) this.messageArrived(msg.message,false,active,"group",gid);
                if(active) this.updateOpenGroupMessages(gid,msg.message);
            }
            if (msg.type === "call_offer") this.receiveCallOffer(msg);
            if (msg.type === "call_answer") this.receiveCallAnswer(msg);
            if (msg.type === "call_ice") this.receiveCallIce(msg);
            if (msg.type === "call_end") this.endCall(false);

            if (msg.type === "reaction" || msg.type === "message_updated" || msg.type === "message_deleted") {
                const otherId = Number(document.body.dataset.privateUser || 0);
                if (msg.scope === "private" || msg.chatId) {
                    if (otherId && this.getPrivateChatId(Auth.currentUser.id, otherId) === (msg.key || msg.chatId)) this.refreshOpenChat(false, otherId);
                } else if (document.getElementById("messages")) this.refreshOpenChat(true);
            }
        });
    },

    async messageArrived(message, global, activeChat=false, scope="", chatKey="") {
        if (activeChat) return;
        this.cosmicSound("message");
        if(message?.type==="audio"&&message.audio?.data&&message.audio?.id){
            try{
                const blob=await (await fetch(message.audio.data)).blob();
                await MediaVault.put(message.audio.id,blob,message.audio.mime,message.audio.duration);
                const key=chatKey || (global?"global":this.getPrivateChatId(Auth.currentUser.id,message.authorId));
                await API.audioAck(scope || (global?"global":"private"),key,message.id,message.audio.id);
            }catch(e){console.warn("Audio delivery:",e);}
        }
        try { if ("vibrate" in navigator) navigator.vibrate([40,30,40]); } catch {}
        if (document.visibilityState !== "visible") return;
        const text = message?.type === "audio" ? "🎙️ Голосовое сообщение" : message?.type === "photo" ? "📷 Фото" : message?.type === "video" ? "🎥 Видео" : (message?.text || "Новое сообщение");
        this.toast(`🌌 ${this.esc(message?.author || "Семья")}`, text);
    },

    cosmicSound(kind="message") {
        if (localStorage.getItem("FamilySound") === "off") return;
        try {
            const Ctx=window.AudioContext||window.webkitAudioContext;
            if(!Ctx)return;
            const ctx=new Ctx();
            const now=ctx.currentTime;
            const notes=kind==="send"?[520,780]:kind==="record"?[330,495,660]:kind==="call"?[880,660,880]:[660,990,1320];
            notes.forEach((freq,i)=>{
                const osc=ctx.createOscillator(), gain=ctx.createGain();
                osc.type=i===1?"sine":"triangle"; osc.frequency.setValueAtTime(freq,now+i*.08);
                gain.gain.setValueAtTime(.0001,now+i*.08);gain.gain.exponentialRampToValueAtTime(.055,now+i*.08+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.08+.23);
                osc.connect(gain);gain.connect(ctx.destination);osc.start(now+i*.08);osc.stop(now+i*.08+.25);
            });
            setTimeout(()=>ctx.close().catch(()=>{}),800);
        } catch {}
    },

    toast(title,text) {
        document.querySelectorAll(".toast").forEach(x=>x.remove());
        const el=document.createElement("div");el.className="toast";el.innerHTML=`<b>${title}</b><div>${text}</div>`;
        document.body.appendChild(el);setTimeout(()=>el.remove(),3200);
    },

    showLogin() {
        app.innerHTML = `<div class="login cosmic-login"><img class="login-icon" src="assets/icon-512.png" alt="Family"><div class="logo">😍</div><div class="title">Family</div><div class="subtitle">Семья · космический семейный чат</div>
        <input id="login" placeholder="Логин" autocomplete="username">
        <input id="password" type="password" placeholder="Пароль" autocomplete="current-password">
        <button class="primary" onclick="App.login()">Войти</button></div>`;
        document.getElementById("password").addEventListener("keydown",e=>{if(e.key==="Enter")this.login();});
    },

    async login() {
        const login=document.getElementById("login").value.trim(), password=document.getElementById("password").value.trim();
        if(!login||!password){alert("Введите логин и пароль");return;}
        if(await Auth.login(login,password)){this.cosmicSound("send");this.connectRealtime();await this.showHome();this.ensurePushSubscription(false);}
        else alert("Неверный логин или пароль");
    },

    async showHome() {
        this.leaveActiveChat();
        ++this.chatNavSeq;
        const u = Auth.currentUser;
        if (!u) { this.showLogin(); return; }

        let data = {chats:[], unread:{global:0,private:{},groups:{}}};
        try { data = await API.chats(); } catch(e) { console.warn("Home chats:", e); }
        const chats = Array.isArray(data.chats) ? data.chats : [];
        const totalUnread = Number(data.unread?.total || 0);

        const cards = chats.map(chat => {
            const count = Number(chat.unread || 0);
            const m = chat.lastMessage || {};
            const preview = m.type === "audio" ? "🎙️ Голосовое сообщение"
                : m.type === "photo" ? "📷 Фото"
                : m.type === "video" ? "🎥 Видео"
                : (m.text || "Сообщение");
            const time = m.time ? new Date(m.time).toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"}) : "";
            if (chat.scope === "private") {
                const user = chat.user || {};
                return `<div class="home-dialog" onclick="App.openPrivateChat(${Number(user.id)})">${this.avatarHtml(user,54)}<div class="home-dialog-main"><div class="home-dialog-top"><b>${this.esc(user.name || "Пользователь")}</b><span class="home-time">${time}</span></div><div class="home-dialog-preview">${this.esc(preview)}</div></div>${count ? `<span class="home-unread">${count}</span>` : ""}</div>`;
            }
            if (chat.scope === "group") {
                return `<div class="home-dialog group-dialog" onclick="App.openGroupChat(${Number(chat.id)})"><div class="group-orbit">👥</div><div class="home-dialog-main"><div class="home-dialog-top"><b>${this.esc(chat.name)}</b><span class="home-time">${time}</span></div><div class="home-dialog-preview">${this.esc(preview)}</div></div>${count ? `<span class="home-unread">${count}</span>` : ""}</div>`;
            }
            return `<div class="home-dialog family-dialog" onclick="App.openGlobalChat()"><div class="family-orbit">🌌</div><div class="home-dialog-main"><div class="home-dialog-top"><b>Семья</b><span class="home-time">${time}</span></div><div class="home-dialog-preview">${this.esc(preview)}</div></div>${count ? `<span class="home-unread">${count}</span>` : ""}</div>`;
        }).join("");

        app.innerHTML = `<div class="page home-page">
            <div class="home-head"><div class="home-brand-mark"><img src="assets/icon-180.png" alt="Family"></div><div class="home-brand-spacer"></div><button class="home-search-btn" aria-label="Поиск" onclick="App.toast('🔎 Family','Поиск по чатам добавим следующим этапом')">⌕</button></div>
            <div class="home-section-head"><div><b>Чаты</b><small>${totalUnread ? `${totalUnread} новых` : "Ваши начатые разговоры"}</small></div></div>
            <div class="home-chat-list">${cards || `<div class="empty-family"><b>Пока нет начатых чатов</b><small>Нажмите ✦, чтобы написать, создать группу или позвонить.</small></div>`}</div>
            ${this.bottomNav("chats")}
        </div>`;
    },

    async canUseFamilyChat(){ return !!Auth.currentUser?.familyChatMember; },

    isCurrentChat(scope,key){ return this.activeChatScope===scope && String(this.activeChatKey)===String(key); },
    setActiveChat(scope,key){
        this.activeChatScope=scope; this.activeChatKey=String(key);
        try{ this.ws?.send(JSON.stringify({type:"chat_open",scope,key:String(key)})); }catch{}
    },
    leaveActiveChat(){
        if(this.activeChatScope){ try{this.ws?.send(JSON.stringify({type:"chat_close",scope:this.activeChatScope,key:String(this.activeChatKey)}));}catch{} }
        this.activeChatScope=null; this.activeChatKey=null;
        document.body.dataset.privateUser="";
    },

    bottomNav(active="home", mode="page") {
        const chatMode = mode === "chat" ? " chat-nav" : "";
        return `<nav class="family-nav${chatMode}" aria-label="Навигация Family">
            <button class="nav-item ${active === "settings" ? "active" : ""}" onclick="App.openSettings()"><span>⚙︎</span><small>Настройки</small></button>
            <button class="nav-action" onclick="App.openQuickActions()" aria-label="Быстрое действие"><span>✦</span></button>
            <button class="nav-item ${active === "profile" ? "active" : ""}" onclick="App.openProfile()"><span>♙</span><small>Профиль</small></button>
        </nav>`;
    },

    openQuickActions() {
        document.querySelectorAll(".quick-sheet-backdrop").forEach(x => x.remove());
        const el=document.createElement("div");
        el.className="quick-sheet-backdrop";
        el.innerHTML=`<div class="quick-sheet quick-sheet-center" onclick="event.stopPropagation()">
            <div class="quick-sheet-handle"></div>
            <div class="quick-sheet-title"><span>✦</span> Быстрые действия</div>
            <button onclick="App.quickChoose('message')"><span>💬</span><div><b>Новое сообщение</b><small>Начать личный разговор</small></div><i>›</i></button>
            <button onclick="App.quickChoose('group')"><span>👥</span><div><b>Создать группу</b><small>Выбрать участников семьи</small></div><i>›</i></button>
            <button onclick="App.quickChoose('audioCall')"><span>📞</span><div><b>Голосовой звонок</b><small>Позвонить члену семьи</small></div><i>›</i></button>
            <button onclick="App.quickChoose('videoCall')"><span>🎥</span><div><b>Видеозвонок</b><small>Позвонить с камерой</small></div><i>›</i></button>
            <button onclick="App.quickChoose('photo')"><span>📷</span><div><b>Фото</b><small>Отправить фотографию</small></div><i>›</i></button>
            <button onclick="App.quickChoose('video')"><span>🎬</span><div><b>Видео</b><small>Отправить видеозапись</small></div><i>›</i></button>
            <button onclick="App.quickChoose('voice')"><span>🎙️</span><div><b>Голосовое</b><small>Записать голосовое сообщение</small></div><i>›</i></button>
            <button onclick="this.closest('.quick-sheet-backdrop').remove()"><span>×</span><div><b>Закрыть</b><small>Вернуться назад</small></div></button>
        </div>`;
        el.addEventListener("click",()=>el.remove());
        document.body.appendChild(el);
    },

    async quickChoose(action) {
        document.querySelectorAll(".quick-sheet-backdrop").forEach(x=>x.remove());
        this.pendingQuickAction=action;
        if(action==="group") return this.createGroup();
        if(action==="message"||action==="photo"||action==="video"||action==="voice"||action==="audioCall"||action==="videoCall") return this.openUsers(action);
    },

    async quickRecipient(target, action=this.pendingQuickAction) {
        this.pendingQuickAction=null;
        if(target==="global") {
            if(action==="message") return this.openGlobalChat();
            if(action==="audioCall") return this.startCall(null,false,true);
            if(action==="videoCall") return this.startCall(null,true,true);
            if(action==="voice") { await this.openGlobalChat(); return this.toggleRecording("global",null); }
            if(action==="photo"||action==="video") return this.pickAndSendMedia("global",null,action);
        }
        const id=Number(target);
        if(!id)return;
        if(action==="message") return this.openPrivateChat(id);
        if(action==="audioCall") return this.startCall(id,false,false);
        if(action==="videoCall") return this.startCall(id,true,false);
        if(action==="voice") { await this.openPrivateChat(id); return this.toggleRecording("private",id); }
        if(action==="photo"||action==="video") { await this.openPrivateChat(id); return this.pickAndSendMedia("private",id,action); }
    },

    async openSettings() {
        this.leaveActiveChat();
        const privateId=Number(document.body.dataset.privateUser||0);
        this.settingsReturnTarget=document.getElementById("messages")?"global":(privateId?`private:${privateId}`:"home");
        ++this.chatNavSeq;
        const u = Auth.currentUser;
        if (!u) return this.showLogin();
        app.innerHTML = `<div class="page settings-page">
            <div class="header"><button onclick="App.settingsBack()">←</button><h1>⚙️ Настройки</h1></div>
            <div class="settings-hero">${this.avatarHtml(u,72)}<div><b>${this.esc(u.name)}</b><small>@${this.esc(u.login)}</small></div></div>
            <div class="settings-menu">
                <button onclick="App.openProfile()"><span>🪐</span><div><b>Мой профиль</b><small>Имя, аватар, уведомления и оформление</small></div><i>›</i></button>
                ${Auth.isAdmin() ? `<button onclick="App.openAdmin()"><span>👑</span><div><b>Управление семьёй</b><small>Добавлять, изменять и удалять пользователей</small></div><i>›</i></button>` : ""}
                <button class="settings-logout" onclick="App.logout()"><span>🚪</span><div><b>Выйти</b><small>Завершить текущий сеанс</small></div></button>
            </div>
            ${this.bottomNav("settings", "page")}
        </div>`;
    },

    settingsBack(){
        const target=this.settingsReturnTarget||"home";
        this.settingsReturnTarget=null;
        if(target==="global") return this.openGlobalChat();
        if(target.startsWith("private:")) return this.openPrivateChat(Number(target.split(":")[1]));
        return this.showHome();
    },

    async logout(){await Auth.logout();if(this.ws)try{this.ws.close()}catch{}this.showLogin();},

    avatarHtml(u,size=48){
        const cls=size<=36?"avatar avatar-sm":"avatar";
        return u?.avatar ? `<span class="${cls}" style="width:${size}px;height:${size}px"><img src="${this.attr(u.avatar)}" alt=""></span>` : `<span class="${cls}" style="width:${size}px;height:${size}px">${u?.gender==="female"?"👩":"👨"}</span>`;
    },

    async openProfile() {
        this.leaveActiveChat();
        const privateId=Number(document.body.dataset.privateUser||0);
        this.profileReturnTarget=document.getElementById("messages")?"global":(privateId?`private:${privateId}`:"home");
        ++this.chatNavSeq;
        const u=Auth.currentUser;
        const themeNames={cosmic:"🌌 Космос",warm:"🌅 Тёплая",fresh:"🌿 Свежая"};
        app.innerHTML=`<div class="page profile-page"><div class="header"><button onclick="App.profileBack()">←</button><h1>🪐 Профиль</h1></div><div class="content">
        <div class="profile-card"><div id="profileAvatar">${this.avatarHtml(u,92)}</div><div><h2>${this.esc(u.name)}</h2><small>@${this.esc(u.login)}</small></div></div>
        <div class="card form"><label class="field-label">Имя</label><input id="profileName" value="${this.attr(u.name)}"><label class="field-label">Аватар</label><input id="avatarFile" type="file" accept="image/*" onchange="App.previewAvatar(event)"><div class="avatar-actions"><button class="secondary" onclick="App.removeAvatar()">Удалить аватар</button><button class="primary" onclick="App.saveProfile()">Сохранить</button></div></div>
        <div class="card settings-card"><div><b>🔔 Уведомления</b><small id="pushStatus">Проверка…</small></div><div style="display:flex;gap:8px"><button class="secondary" onclick="App.testNotification()">Проверить</button><button class="primary" onclick="App.enableNotifications()">Включить</button></div></div>
        <div class="card settings-card"><div><b>🌌 Космические звуки</b><small>Звук при новых сообщениях и действиях</small></div><button class="secondary" onclick="App.toggleSound()">${localStorage.getItem("FamilySound")==="off"?"Включить":"Выключить"}</button></div>
        <div class="card appearance-card"><div class="appearance-head"><div><b>🎨 Оформление</b><small>Выбери атмосферу Family</small></div><span class="appearance-current">${themeNames[this.appearanceTheme]}</span></div>
          <div class="theme-grid">
            <button class="theme-choice cosmic ${this.appearanceTheme==="cosmic"?"active":""}" onclick="App.setTheme('cosmic')"><span>🌌</span><b>Космос</b><small>Звёзды</small></button>
            <button class="theme-choice warm ${this.appearanceTheme==="warm"?"active":""}" onclick="App.setTheme('warm')"><span>🌅</span><b>Тёплая</b><small>Уют</small></button>
            <button class="theme-choice fresh ${this.appearanceTheme==="fresh"?"active":""}" onclick="App.setTheme('fresh')"><span>🌿</span><b>Свежая</b><small>Лёгкость</small></button>
          </div>
          <div class="mode-row"><button class="mode-choice ${this.appearanceMode==="light"?"active":""}" onclick="App.setMode('light')">☀️ Светлая</button><button class="mode-choice ${this.appearanceMode==="dark"?"active":""}" onclick="App.setMode('dark')">🌙 Тёмная</button><button class="mode-choice ${this.appearanceMode==="system"?"active":""}" onclick="App.setMode('system')">⚙️ Системная</button></div>
        </div>
        <div class="card typography-card"><div class="appearance-head"><div><b>🔤 Текст</b><small>Настрой шрифт и размер сообщений</small></div></div>
          <label class="field-label">Шрифт</label>
          <div class="font-grid">
            <button class="font-choice ${this.fontFamily==="system"?"active":""}" onclick="App.setFont('system')">System</button>
            <button class="font-choice ${this.fontFamily==="nunito"?"active":""}" onclick="App.setFont('nunito')">Nunito</button>
            <button class="font-choice ${this.fontFamily==="inter"?"active":""}" onclick="App.setFont('inter')">Inter</button>
            <button class="font-choice ${this.fontFamily==="rounded"?"active":""}" onclick="App.setFont('rounded')">Rounded</button>
          </div>
          <label class="field-label">Размер <b id="fontSizeValue">${this.fontSize}px</b></label>
          <input class="font-range" type="range" min="14" max="23" step="1" value="${this.fontSize}" oninput="App.setFontSize(this.value)">
        </div>
        </div>${this.bottomNav("profile", "page")}</div>`;
        this.updatePushStatus();
    },

    profileBack(){
        const target=this.profileReturnTarget||"home";
        this.profileReturnTarget=null;
        if(target==="global") return this.openGlobalChat();
        if(target.startsWith("private:")) return this.openPrivateChat(Number(target.split(":")[1]));
        return this.showHome();
    },

    previewAvatar(e){
        const file=e.target.files?.[0];if(!file)return;
        this.compressImage(file).then(data=>{document.getElementById("profileAvatar").innerHTML=this.avatarHtml({avatar:data},92);document.getElementById("profileAvatar").dataset.avatar=data;}).catch(err=>alert(err.message));
    },
    removeAvatar(){document.getElementById("profileAvatar").dataset.avatar="";document.getElementById("profileAvatar").innerHTML=this.avatarHtml({gender:Auth.currentUser.gender},92);},
    async saveProfile(){
        const name=document.getElementById("profileName").value.trim();if(!name){alert("Имя не может быть пустым");return;}
        const box=document.getElementById("profileAvatar"), avatar=box.dataset.avatar!==undefined?box.dataset.avatar:(Auth.currentUser.avatar||"");
        try{Auth.currentUser=await API.updateMe({name,avatar});this.toast("Профиль","Сохранено");await this.showHome();}catch(e){alert(e.message);}
    },
    async compressImage(file){
        if(file.size>8*1024*1024)throw new Error("Изображение слишком большое");
        const url=URL.createObjectURL(file);
        try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("Не удалось прочитать изображение"));i.src=url;});
            const max=256, scale=Math.min(1,max/Math.max(img.width,img.height)), c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));
            c.getContext("2d").drawImage(img,0,0,c.width,c.height);return c.toDataURL("image/jpeg",.78);
        }finally{URL.revokeObjectURL(url);}
    },

    async updatePushStatus(){
        const el=document.getElementById("pushStatus");if(!el)return;
        if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)){el.textContent="Этот браузер не поддерживает push";return;}
        const standalone=window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone===true;
        if(/iPhone|iPad|iPod/i.test(navigator.userAgent) && !standalone){el.textContent="Добавьте Family на экран «Домой»";return;}
        if(Notification.permission!=="granted"){el.textContent="Нажмите «Включить» и разрешите уведомления";return;}
        try{
            const reg = this.notificationRegistration || await navigator.serviceWorker.ready;
            this.notificationRegistration = reg;
            const sub = await reg.pushManager.getSubscription();
            if(sub){el.textContent="Разрешены и подключены";return;}
            const status=await API.notificationStatus();
            const diag=await API.notificationDiagnostics();
            if (!diag.vapidConfigured) { el.textContent="Сервер: VAPID не настроен"; return; }
            el.textContent=status.enabled?"Разрешены и подключены":"Разрешены, но подписка не создана";
        }catch(e){el.textContent=`Ошибка API: ${e.message}`;}
    },
    async enableNotifications(){
        try{
            if(!window.isSecureContext) throw new Error("Для уведомлений нужен HTTPS.");
            if(!window.Notification || !navigator.serviceWorker || !window.PushManager) throw new Error("Этот браузер не поддерживает push-уведомления.");
            // iPhone/iPad: Web Push requires the site to be installed as a Home Screen web app.
            const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
            if(/iPhone|iPad|iPod/i.test(navigator.userAgent) && !standalone){
                throw new Error("На iPhone сначала добавьте Family на экран «Домой», затем откройте приложение с иконки и снова включите уведомления.");
            }
            const permission=await Notification.requestPermission();
            if(permission!=="granted"){this.updatePushStatus();throw new Error("Разрешение на уведомления не предоставлено.");}
            if(!this.notificationRegistration) await this.initPWA();
            const reg = this.notificationRegistration || await navigator.serviceWorker.ready;
            this.notificationRegistration = reg;
            if(!reg) throw new Error("Service Worker не запустился.");
            const key=await API.pushPublicKey();
            if(!key) throw new Error("Сервер не вернул ключ push. Обновите server.js на Family v6.2.");
          let subscription =
    await reg.pushManager.getSubscription();

if (subscription) {
    await subscription.unsubscribe();
}

subscription =
    await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(key)
    });

await API.pushSubscribe(subscription.toJSON());
            await this.updatePushStatus();
            this.toast("🔔 Уведомления","Family теперь сможет сообщать о новых сообщениях");
        }catch(e){
            console.error("Push:",e);
            await this.updatePushStatus();
            alert(e?.message || "Не удалось включить уведомления");
        }
    },
    async testNotification(){
        try{
            if(Notification.permission!=="granted") throw new Error("Сначала нажмите «Включить» и разрешите уведомления.");
            if(!this.notificationRegistration) await this.initPWA();
            const reg = this.notificationRegistration || await navigator.serviceWorker.ready;
            this.notificationRegistration = reg;
            const existing = await reg?.pushManager.getSubscription();
            if(!existing) throw new Error("Подписка push не создана. Сначала включите уведомления.");
            await API.pushSubscribe(existing.toJSON());
            const result=await API.testNotification();
            this.toast("🔔 Family", result.message || "Тест отправлен");
        }catch(e){
            console.error("Push test:",e);
            alert(e?.message || "Тест push не выполнен");
        }
    },

    async ensurePushSubscription(ask){
        if(!("Notification" in window)||Notification.permission!=="granted")return;
        try{
            if(!this.notificationRegistration)await this.initPWA();
            const existing=await this.notificationRegistration.pushManager.getSubscription();
            if(existing)await API.pushSubscribe(existing.toJSON());
        }catch(e){console.warn("Push subscription:",e);}
    },
    urlBase64ToUint8Array(base64){const pad="=".repeat((4-base64.length%4)%4),b64=(base64+pad).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(b64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));},
    toggleSound(){const off=localStorage.getItem("FamilySound")==="off";localStorage.setItem("FamilySound",off?"on":"off");this.openProfile();},

    applyAppearance(){
        document.documentElement.dataset.theme=this.appearanceTheme;
        document.documentElement.dataset.mode=this.appearanceMode;
        const fonts={system:"system-ui,-apple-system,Segoe UI,sans-serif",nunito:"Nunito,system-ui,sans-serif",inter:"Inter,system-ui,sans-serif",rounded:"Arial Rounded MT Bold,ui-rounded,system-ui,sans-serif"};
        document.documentElement.style.setProperty("--family-font",fonts[this.fontFamily]||fonts.system);
        document.documentElement.style.setProperty("--family-font-size",`${this.fontSize}px`);
    },
    setFont(font){this.fontFamily=font;localStorage.setItem("FamilyFont",font);this.applyAppearance();this.openProfile();},
    setFontSize(size){this.fontSize=Math.max(14,Math.min(23,Number(size)||17));localStorage.setItem("FamilyFontSize",String(this.fontSize));this.applyAppearance();const v=document.getElementById("fontSizeValue");if(v)v.textContent=`${this.fontSize}px`;},
    setTheme(theme){
        this.appearanceTheme=theme;localStorage.setItem("FamilyTheme",theme);this.applyAppearance();this.openProfile();
    },
    setMode(mode){
        this.appearanceMode=mode;localStorage.setItem("FamilyMode",mode);this.applyAppearance();this.openProfile();
    },
    async openAdmin() {
        this.leaveActiveChat();
        ++this.chatNavSeq;
        if(!Auth.isAdmin())return;
        const users=await Auth.getUsers();
        let settings={maxUsers:10};
        try{settings=await API.settings();}catch{}
        const count=users.length, max=Math.max(count,Number(settings.maxUsers||10));
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>👑 Пользователи</h1></div><div class="content">
        <div class="card settings-card"><div><b>👨‍👩‍👧‍👦 Лимит пользователей</b><small>Сейчас ${count} из ${max}</small></div><div class="admin-limit-row"><input id="maxUsers" type="number" min="${count}" max="100" value="${max}"><button class="secondary" onclick="App.saveMaxUsers()">Сохранить</button></div></div>
        ${users.map(u=>`<div class="card user-row"><div class="user-person">${this.avatarHtml(u,48)}<div><div class="user-name">${this.esc(u.name)}</div><small>@${this.esc(u.login)} · ${u.role==="admin"?"Администратор":"Пользователь"}</small></div></div><div class="actions"><button onclick="App.editUser(${u.id})">✏️</button>${u.id!==Auth.currentUser.id?`<button onclick="App.removeUser(${u.id})">🗑️</button>`:""}</div></div>`).join("")}
        ${users.length<max?`<div class="card" onclick="App.showCreateUser()">➕ Добавить пользователя</div>`:"<div class='hint'>Достигнут лимит ${max} пользователей. Уже созданные аккаунты не удаляются при уменьшении лимита.</div>"}</div></div>`;
    },

    async saveMaxUsers(){
        const el=document.getElementById("maxUsers");
        if(!el)return;
        const maxUsers=Math.max(Auth.currentUser?1:1,Math.min(100,Math.floor(Number(el.value)||10)));
        try{await API.updateSettings({maxUsers});this.toast("👨‍👩‍👧‍👦 Лимит",`Теперь максимум ${maxUsers} пользователей`);await this.openAdmin();}
        catch(e){alert(e.message);}
    },

    showCreateUser(){app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openAdmin()">←</button><h1>➕ Пользователь</h1></div><div class="content"><div class="card form"><input id="newName" placeholder="Имя"><input id="newLogin" placeholder="Логин"><input id="newPassword" type="password" placeholder="Пароль"><div class="gender"><label><input type="radio" name="gender" value="male" checked> 👨 Мужчина</label><label><input type="radio" name="gender" value="female"> 👩 Женщина</label></div><button class="primary" onclick="App.createUser()">Создать</button></div></div></div>`;},
    async createUser(){const name=document.getElementById("newName").value.trim(),login=document.getElementById("newLogin").value.trim(),password=document.getElementById("newPassword").value.trim(),gender=document.querySelector('input[name="gender"]:checked').value;const r=await Auth.createUser(name,login,password,gender);if(!r.success){alert(r.error);return;}await this.openAdmin();},
    async editUser(id){const u=await Auth.getUserById(id);if(!u)return;app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openAdmin()">←</button><h1>✏️ Пользователь</h1></div><div class="content"><div class="card form"><div class="edit-avatar">${this.avatarHtml(u,78)}</div><input id="editName" value="${this.attr(u.name)}" placeholder="Имя"><input id="editLogin" value="${this.attr(u.login)}" placeholder="Логин"><input id="editPassword" type="password" placeholder="Новый пароль"><div class="gender"><label><input type="radio" name="eg" value="male" ${u.gender!=="female"?"checked":""}> 👨 Мужчина</label><label><input type="radio" name="eg" value="female" ${u.gender==="female"?"checked":""}> 👩 Женщина</label></div><button class="primary" onclick="App.saveUser(${id})">Сохранить</button></div></div></div>`;},
    async saveUser(id){const data={name:document.getElementById("editName").value.trim(),login:document.getElementById("editLogin").value.trim(),gender:document.querySelector('input[name="eg"]:checked').value};const p=document.getElementById("editPassword").value.trim();if(p)data.password=p;const r=await Auth.updateUser(id,data);if(!r.success){alert(r.error);return;}await this.openAdmin();},
    async removeUser(id){const u=await Auth.getUserById(id);if(!u)return;if(!confirm(`Удалить "${u.name}"?`))return;const r=await Auth.deleteUser(id);if(!r.success)alert(r.error);else await this.openAdmin();},

    async openUsers(targetAction=null){
        this.leaveActiveChat();
        ++this.chatNavSeq;
        const users=await Auth.getUsers(),me=Auth.currentUser;
        const actionLabel={message:"Отправить сообщение",photo:"Выбрать фото",video:"Выбрать видео",voice:"Записать голос",audioCall:"Голосовой звонок",videoCall:"Видеозвонок"}[targetAction]||"Открыть диалог";
        const familyRow=(Auth.currentUser?.familyChatMember && targetAction && ["message","photo","video","voice"].includes(targetAction))?`<div class="dialog-card quick-recipient" onclick="App.quickRecipient('global','${targetAction}')"><div class="family-orbit">🌌</div><div class="dialog-main"><div class="dialog-name">Семья</div><div class="dialog-preview">${actionLabel} · общий чат</div></div></div>`:"";
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>${targetAction?"Кому?":"👤 Личные"}</h1></div><div class="content dialog-list">${familyRow}${users.filter(u=>u.id!==me.id).map(u=>`<div class="dialog-card quick-recipient" onclick="${targetAction?`App.quickRecipient(${u.id},'${targetAction}')`:`App.openPrivateChat(${u.id})`}">${this.avatarHtml(u,48)}<div class="dialog-main"><div class="dialog-name">${this.esc(u.name)}</div><div class="dialog-preview">${targetAction?actionLabel:`@${this.esc(u.login)} ${u.presence?.online?"· 🟢 онлайн":""}`}</div></div></div>`).join("")}</div>${this.bottomNav("chats")}</div>`;
    },

    async refreshOpenChat(global,otherId,scopeOverride=null){
        const scope=scopeOverride || (global?"global":this.activeChatScope||"private");
        if(scope==="global" && !document.getElementById("messages"))return;
        if(scope==="private" && !document.getElementById("privateMessages"))return;
        if(scope==="group" && !document.getElementById("groupMessages"))return;
        try {
            if(scope==="global") await this.openGlobalChat(true);
            else if(scope==="group") await this.openGroupChat(Number(otherId),true);
            else await this.openPrivateChat(otherId,true);
        } catch(e){console.warn("Chat refresh:",e);}
    },

    async openPrivateChat(otherId,silent=false){
        const navSeq=++this.chatNavSeq;
        const me=Auth.currentUser;
        if(!me)return;
        // The home screen already hydrates usersCache from API.chats().
        // Never block opening a chat on a second /api/users request.
        const userMap=this._usersById ||= new Map();
        if (Array.isArray(this.usersCache)) {
            for (const u of this.usersCache) userMap.set(Number(u.id),u);
        }
        const target=userMap.get(Number(otherId));
        if(!target || navSeq!==this.chatNavSeq){
            // Only fetch users as a background fallback; do not block the UI.
            API.users().then(users=>{
                if(!Array.isArray(users)) return;
                this.usersCache=users;
                this._usersById ||= new Map();
                for(const u of users) this._usersById.set(Number(u.id),u);
            }).catch(e=>console.warn("Private user:",e));
            return;
        }

        this.leaveActiveChat();
        document.body.dataset.privateUser=otherId;
        const chatKey=this.getPrivateChatId(me.id,otherId);
        this.setActiveChat("private",chatKey);

        // Render the chat shell immediately. Never wait for the message request.
        const cache=this._chatMessageCache ||= new Map();
        const cachedMessages=cache.get(chatKey);
        this._lastMessages=cachedMessages || [];
        app.innerHTML=`<div class="page chat-page"><div class="header chat-header"><button onclick="App.showHome()">←</button>${this.avatarHtml(target,38)}<h1>${this.esc(target.name)}</h1><div class="chat-header-actions"><button onclick="App.startCall(${otherId},false,false)">📞</button><button onclick="App.startCall(${otherId},true,false)">🎥</button></div></div><div class="messages" id="privateMessages">${cachedMessages ? cachedMessages.map(m=>this.messageHtml(m,false,otherId)).join("") : `<div class="chat-loading">Загрузка сообщений…</div>`}</div>${this.chatFooter("private",otherId,"Напишите сообщение...")}${this.bottomNav("chat","chat")}</div>`;
        this.scrollMessages("privateMessages",true);
        this.bindChatInput("privateInput",()=>this.sendPrivate(otherId));
        this.hydrateLocalAudio("privateMessages");
        requestAnimationFrame(()=>API.markRead("private",chatKey).catch(()=>{}));

        // Load history in the background and update only the message area.
        try{
            const messages=await API.privateMessages(otherId);
            cache.set(chatKey,messages||[]);
            if(navSeq!==this.chatNavSeq || Number(document.body.dataset.privateUser)!==Number(otherId))return;
            const box=document.getElementById("privateMessages");
            if(!box)return;
            const html=(messages||[]).map(m=>this.messageHtml(m,false,otherId)).join("");
            box.innerHTML=html || `<div class="chat-empty">Нет сообщений</div>`;
            this._lastMessages=messages||[];
            this.scrollMessages("privateMessages",true);
            this.hydrateLocalAudio("privateMessages");
        }catch(e){
            console.warn("Private chat:",e);
            const box=document.getElementById("privateMessages");
            if(box && navSeq===this.chatNavSeq) box.innerHTML=`<div class="chat-empty">Не удалось загрузить сообщения</div>`;
        }
    },

    async sendPrivate(id){const input=document.getElementById("privateInput");if(!input)return;const text=input.value.trim();if(!text)return;const reply=this.replyTarget;try{const message=await API.sendPrivate(id,text,reply);input.value="";this.replyTarget=null;this.hideKeyboard();this.cosmicSound("send");this.appendSentMessage(message,false,id);}catch(e){alert(e.message);}},

    async openGlobalChat(silent=false){
        const navSeq=++this.chatNavSeq; this.leaveActiveChat();
        let messages=[]; try{ [this.usersCache,messages]=await Promise.all([API.users(),API.globalMessages()]); }catch(e){console.warn("Global chat:",e);}
        this._lastMessages=messages||[]; if(navSeq!==this.chatNavSeq)return;
        this.setActiveChat("global","global");
        app.innerHTML=`<div class="page chat-page"><div class="header chat-header"><button onclick="App.showHome()">←</button><h1>🌌 Семья</h1><div class="chat-header-actions"><button onclick="App.startCall(null,false,true)">📞</button></div></div><div class="messages" id="messages">${messages.map(m=>this.messageHtml(m,true)).join("")}</div>${this.chatFooter("global",null,"Напишите семье...")}${this.bottomNav("chat","chat")}</div>`;
        this.scrollMessages("messages",true);this.bindChatInput("messageInput",()=>this.sendGlobal());this.hydrateLocalAudio("messages");
        requestAnimationFrame(()=>API.markRead("global","global").catch(()=>{}));
    },

    async sendGlobal(){const input=document.getElementById("messageInput");if(!input)return;const text=input.value.trim();if(!text)return;const reply=this.replyTarget;try{const message=await API.sendGlobal(text,reply);input.value="";this.replyTarget=null;this.hideKeyboard();this.cosmicSound("send");this.appendSentMessage(message,true,null);}catch(e){alert(e.message);}},

    async createGroup(){
        let users=[]; try{users=await Auth.getUsers();}catch{}
        const others=users.filter(u=>Number(u.id)!==Number(Auth.currentUser.id));
        if(!others.length){this.toast("👥 Группа","Добавьте ещё хотя бы одного пользователя");return;}
        const el=document.createElement("div");el.className="quick-sheet-backdrop";el.innerHTML=`<div class="quick-sheet quick-sheet-center" onclick="event.stopPropagation()"><div class="quick-sheet-handle"></div><div class="quick-sheet-title">👥 Новый общий чат</div><input id="groupName" class="group-name-input" placeholder="Название группы"><div class="group-member-list">${others.map(u=>`<label><input type="checkbox" value="${u.id}"> ${this.esc(u.name)}</label>`).join("")}</div><button class="primary" onclick="App.saveGroupFromSheet()">Создать группу</button><button onclick="this.closest('.quick-sheet-backdrop').remove()">Отмена</button></div>`;
        document.body.appendChild(el);
    },
    async saveGroupFromSheet(){
        const name=document.getElementById("groupName")?.value.trim(); const ids=[...document.querySelectorAll(".group-member-list input:checked")].map(x=>Number(x.value));
        if(!name||!ids.length){alert("Введите название и выберите участников");return;}
        try{const g=await API.createGroup({name,memberIds:ids});document.querySelectorAll(".quick-sheet-backdrop").forEach(x=>x.remove());this.toast("👥 Группа создана",g.name);await this.openGroupChat(g.id);}catch(e){alert(e.message);}
    },
    async openGroupChat(groupId,silent=false){
        const navSeq=++this.chatNavSeq; this.leaveActiveChat(); let groups=[];let messages=[];try{[groups,messages]=await Promise.all([API.groups(),API.groupMessages(groupId)]);}catch(e){alert(e.message);return;}
        const group=groups.find(g=>Number(g.id)===Number(groupId));if(!group)return;this.usersCache=group.members||[];messages=await this.cacheFetchedAudio(messages,false,groupId,"group");this._lastMessages=messages||[];if(navSeq!==this.chatNavSeq)return;this.setActiveChat("group",String(groupId));
        app.innerHTML=`<div class="page chat-page"><div class="header chat-header"><button onclick="App.showHome()">←</button><div class="group-orbit small">👥</div><h1>${this.esc(group.name)}</h1></div><div class="messages" id="groupMessages">${messages.map(m=>this.messageHtml(m,false,groupId)).join("")}</div>${this.chatFooter("group",groupId,"Напишите в группу...")}${this.bottomNav("chat","chat")}</div>`;
        this.scrollMessages("groupMessages",true);this.bindChatInput("groupInput",()=>this.sendGroup(groupId));requestAnimationFrame(()=>API.markRead("group",String(groupId)).catch(()=>{}));
    },
    async sendGroup(id){const input=document.getElementById("groupInput");if(!input)return;const text=input.value.trim();if(!text)return;const reply=this.replyTarget;try{const message=await API.sendGroup(id,text,reply);input.value="";this.replyTarget=null;this.hideKeyboard();this.cosmicSound("send");this.appendSentMessage(message,false,id,"group");}catch(e){alert(e.message);}},
    updateOpenGroupMessages(groupId,message){const box=document.getElementById("groupMessages");if(!box||!message||!this.isCurrentChat("group",groupId))return;this.updateOpenChatMessages(false,groupId,message,"group");},

    chatFooter(scope,id,placeholder){const inputId=scope==="global"?"messageInput":scope==="group"?"groupInput":"privateInput";const send=scope==="global"?"App.sendGlobal()":scope==="group"?`App.sendGroup(${id})`:`App.sendPrivate(${id})`;return `${this.replyTarget?`<div class="reply-bar"><b>↩️ Ответ</b><span>${this.esc(this.replyTarget.text||"Голосовое сообщение")}</span><button onclick="App.clearReply()">×</button></div>`:""}<div class="footer"><button class="tool-btn" title="Медиа" onclick="App.openChatMediaMenu('${scope}',${id===null?"null":id})">＋</button><button class="tool-btn" title="Эмодзи" onclick="App.showEmojiPicker(this,'${inputId}')">😊</button><button class="tool-btn" id="micBtn" title="Голосовое сообщение" onclick="App.toggleRecording('${scope}',${id===null?"null":id})">🎙️</button><input id="${inputId}" placeholder="${placeholder}" autocomplete="off"><button class="primary send-btn" onclick="${send}">➤</button></div>`;},

    openChatMediaMenu(scope,id){
        document.querySelectorAll(".chat-media-menu").forEach(x=>x.remove());
        const el=document.createElement("div");el.className="chat-media-menu";
        el.innerHTML=`<button onclick="App.pickAndSendMedia('${scope}',${id===null?"null":id},'photo');this.parentElement.remove()">📷 Фото</button><button onclick="App.pickAndSendMedia('${scope}',${id===null?"null":id},'video');this.parentElement.remove()">🎥 Видео</button><button onclick="this.parentElement.remove()">× Закрыть</button>`;
        document.body.appendChild(el);
    },
    async pickAndSendMedia(scope,id,kind){
        const input=document.createElement("input");input.type="file";input.accept=kind==="photo"?"image/*":"video/*";input.style.display="none";document.body.appendChild(input);
        input.onchange=async()=>{const file=input.files?.[0];input.remove();if(!file)return;try{
            const max=kind==="photo"?3*1024*1024:6*1024*1024;
            if(file.size>max)throw new Error(kind==="photo"?"Фото больше 3 МБ":"Видео больше 6 МБ");
            let blob=file;
            if(kind==="photo") blob=await this.compressPhoto(file);
            const data=await this.blobToDataURL(blob);
            const media={id:crypto.randomUUID?.()||String(Date.now())+Math.random(),mime:blob.type||file.type,data,name:file.name,size:blob.size};
            const sent=scope==="global"?await API.sendGlobalMedia(media,this.replyTarget):scope==="group"?await API.sendGroupMedia(id,media,this.replyTarget):await API.sendPrivateMedia(id,media,this.replyTarget);
            this.replyTarget=null;this.cosmicSound("send");
            this.appendSentMessage(sent,scope==="global",id);
        }catch(e){alert("Не удалось отправить медиа: "+(e?.message||"ошибка"));}};input.click();
    },
    compressPhoto(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{try{const max=1600,scale=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));c.getContext("2d").drawImage(img,0,0,c.width,c.height);c.toBlob(b=>b?resolve(b):reject(new Error("Не удалось обработать фото")),"image/jpeg",.82);}finally{URL.revokeObjectURL(url);}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Не удалось прочитать фото"));};img.src=url;});},
    bindChatInput(id,fn){const input=document.getElementById(id);if(input){input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();fn();}};}},
    scrollMessages(id, force=false){
        const list=document.getElementById(id);
        if(!list)return;
        const move=()=>{ list.scrollTop=list.scrollHeight; };
        if(force) requestAnimationFrame(move);
    },

    appendSentMessage(message,global,otherId,forcedScope=null){
        const scope = forcedScope || this.activeChatScope || (global ? "global" : "private");
        const box=document.getElementById(scope==="global"?"messages":scope==="group"?"groupMessages":"privateMessages");
        if(!box||!message)return;
        if(box.querySelector(`[data-message-id="${Number(message.id)}"]`))return;
        this._lastMessages=[...(this._lastMessages||[]),message];
        const wasBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<140;
        box.insertAdjacentHTML("beforeend",this.messageHtml(message,scope==="global",otherId));
        if(wasBottom)requestAnimationFrame(()=>box.scrollTop=box.scrollHeight);
        this.hydrateLocalAudio(scope==="global"?"messages":scope==="group"?"groupMessages":"privateMessages");
    },

    updateOpenChatMessages(global, otherId, message, forcedScope=null){
        const scope=forcedScope|| (global?"global":"private");
        const box=document.getElementById(scope==="global"?"messages":scope==="group"?"groupMessages":"privateMessages");
        if(!box || !message)return;
        const input=scope==="global" ? document.getElementById("messageInput") : scope==="group" ? document.getElementById("groupInput") : document.getElementById("privateInput");
        const typing=Boolean(input && document.activeElement===input && input.value.length>0);
        const nearBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<120;
        const exists=box.querySelector(`[data-message-id="${Number(message.id)}"]`);
        if(exists)return;
        this._lastMessages=[...(this._lastMessages||[]),message];
        box.insertAdjacentHTML("beforeend",this.messageHtml(message,scope==="global",otherId));
        if(nearBottom && !typing) requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight;});
        this.hydrateLocalAudio(scope==="global" ? "messages" : scope==="group" ? "groupMessages" : "privateMessages");
    },

    linkify(text){
        return this.esc(text).replace(/(https?:\/\/[^\s<]+)/g,(m)=>{const clean=m.replace(/[.,!?;:]+$/g,"");const tail=m.slice(clean.length);return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${tail}`;});
    },

    hideKeyboard(){
        const el=document.activeElement;
        if(el && typeof el.blur==="function") el.blur();
    },

    messageHtml(m,global,otherId){
        const mine=Number(m.authorId)===Number(Auth.currentUser.id),scope=global?"global":(this.activeChatScope==="group"?"group":"private"),key=global?"global":scope==="group"?String(otherId):this.getPrivateChatId(Auth.currentUser.id,otherId),reactions=Object.entries(m.reactions||{}).filter(([,ids])=>ids.length);
        this._usersById ||= new Map((this.usersCache||[]).map(u=>[Number(u.id),u]));
        const authorUser=this._usersById.get(Number(m.authorId))||m;
        const avatar=!mine?this.avatarHtml(authorUser,34):"";
        const hasAudio=m.type==="audio"&&m.audio;
        const audioSrc=hasAudio&&m.audio.data?this.attr(m.audio.data):"";
        const mediaData=m.media?.data?this.attr(m.media.data):"";
        const media=m.type==="audio"&&m.audio?`<div class="voice-message"><button class="voice-circle" data-audio-id="${this.attr(m.audio.id||"")}" onclick="App.playVoice(this)">▶</button><div><div class="voice-title">🎙️ Голосовое <span class="voice-local">${m.audio.data?"":"на устройстве"}</span></div><span class="voice-duration">${m.audio.duration?this.formatDuration(m.audio.duration):""}</span></div><audio class="family-audio" preload="metadata" ${audioSrc?`src="${audioSrc}"`:""} data-audio-id="${this.attr(m.audio.id||"")}"></audio></div>`:m.type==="photo"&&m.media?`<div class="media-message"><img src="${mediaData}" alt="Фото" loading="lazy"></div>`:m.type==="video"&&m.media?`<div class="media-message"><video src="${mediaData}" controls playsinline preload="metadata"></video></div>`:`<div class="message-text">${this.linkify(m.text||"")}</div>`;
        const reply=m.replyTo?`<div class="reply-quote">↩️ ${this.esc(m.replyTo.author||"")}<br><span>${this.esc(m.replyTo.text||"Голосовое сообщение")}</span></div>`:"";
        const favorite=this.isFavorite(scope,key,m.id);
        const menu=`<button class="message-menu-btn" onclick="event.stopPropagation();App.messageMenu(event,'${scope}','${key}',${m.id},${mine})">⋯</button>`;
        return `<div class="message ${mine?"me":"other"}" data-message-id="${m.id}" oncontextmenu="App.messageMenu(event,'${scope}','${key}',${m.id},${mine});return false">${avatar}<div class="bubble">${!mine?`<div class="author">${this.esc(m.author)}</div>`:""}${reply}${media}<div class="message-meta"><div class="time">${new Date(m.time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}${m.edited?" · изменено":""}${favorite?" · ⭐":""}</div>${menu}</div><div class="reaction-line">${reactions.map(([e,ids])=>`<button onclick="App.react('${scope}','${key}',${m.id},'${e}')">${e} ${ids.length}</button>`).join("")}<button class="add-reaction" onclick="App.showReactions(this,'${scope}','${key}',${m.id})">＋</button></div></div></div>`;
    },
    isFavorite(scope,key,id){return this.favorites.includes(`${scope}:${key}:${id}`);},
    toggleFavorite(scope,key,id){const k=`${scope}:${key}:${id}`,i=this.favorites.indexOf(k);if(i>=0)this.favorites.splice(i,1);else this.favorites.push(k);localStorage.setItem("FamilyFavorites",JSON.stringify(this.favorites));this.refreshOpenChat(scope==="global",scope==="global"?null:Number(document.body.dataset.privateUser||0));},
    messageMenu(event,scope,key,id,mine){event.preventDefault();document.querySelectorAll(".message-action-sheet").forEach(x=>x.remove());const m=this.findCurrentMessage(scope,key,id);if(!m)return;const sheet=document.createElement("div");sheet.className="message-action-sheet";sheet.innerHTML=`<button onclick="App.replyToMessage('${scope}','${key}',${id});this.closest('.message-action-sheet').remove()">↩️ Ответить</button>${mine&&m.type!=="audio"?`<button onclick="App.editMessage('${scope}','${key}',${id});this.closest('.message-action-sheet').remove()">✏️ Изменить</button>`:""}<button onclick="App.toggleFavorite('${scope}','${key}',${id});this.closest('.message-action-sheet').remove()">${this.isFavorite(scope,key,id)?"☆ Убрать из избранного":"⭐ В избранное"}</button>${mine||Auth.isAdmin()?`<button class="danger" onclick="App.deleteMessage('${scope}','${key}',${id});this.closest('.message-action-sheet').remove()">🗑️ Удалить</button>`:""}`;document.body.appendChild(sheet);sheet.style.left=Math.min(event.clientX||20,window.innerWidth-250)+"px";sheet.style.top=Math.min(event.clientY||100,window.innerHeight-240)+"px";setTimeout(()=>document.addEventListener("click",()=>sheet.remove(),{once:true}),0);return false;},
    findCurrentMessage(scope,key,id){const root=scope==="global"?document.getElementById("messages"):document.getElementById("privateMessages");if(!root)return null;const el=root.querySelector(`[data-message-id="${id}"]`);if(!el)return null;return this._lastMessages?.find(m=>Number(m.id)===Number(id))||null;},
    replyToMessage(scope,key,id){const m=this.findCurrentMessage(scope,key,id);if(!m)return;this.replyTarget={id:m.id,author:m.author,text:m.text,type:m.type};this.refreshOpenChat(scope==="global",Number(document.body.dataset.privateUser||0));},
    clearReply(){this.replyTarget=null;this.refreshOpenChat(this.getCurrentScope()==="global",Number(document.body.dataset.privateUser||0));},
    async editMessage(scope,key,id){const m=this.findCurrentMessage(scope,key,id);if(!m||m.type==="audio")return;const text=prompt("Изменить сообщение:",m.text||"");if(text===null)return;try{await API.editMessage(scope,key,id,text.trim());}catch(e){alert(e.message);}},
    async deleteMessage(scope,key,id){if(!confirm("Удалить это сообщение?"))return;try{await API.deleteMessage(scope,key,id);}catch(e){alert(e.message);}},
    showEmojiPicker(btn,inputId){document.querySelectorAll(".emoji-picker").forEach(x=>x.remove());const box=document.createElement("div");box.className="emoji-picker";box.innerHTML=["😀","😂","😍","🥰","😘","😢","😮","😡","👍","👎","❤️","💕","🔥","🎉","🙏","😊","😉","🤗","🤣","🥹","😎","💋","🌹","☀️","🌌"].map(e=>`<button onclick="App.insertEmoji('${inputId}','${e}')">${e}</button>`).join("");btn.parentElement.parentElement.appendChild(box);},
    insertEmoji(inputId,emoji){const input=document.getElementById(inputId);if(!input)return;const start=input.selectionStart||input.value.length,end=input.selectionEnd||input.value.length;input.value=input.value.slice(0,start)+emoji+input.value.slice(end);input.focus();input.selectionStart=input.selectionEnd=start+emoji.length;document.querySelectorAll(".emoji-picker").forEach(x=>x.remove());},
    getCurrentScope(){return document.getElementById("messages")?"global":document.getElementById("groupMessages")?"group":"private"},
    formatDuration(s){s=Math.round(Number(s)||0);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;},
    showReactions(btn,scope,key,id){document.querySelectorAll(".reaction-picker").forEach(x=>x.remove());const box=document.createElement("div");box.className="reaction-picker";box.innerHTML=REACTIONS.map(e=>`<button onclick="App.react('${scope}','${key}',${id},'${e}');this.parentElement.remove()">${e}</button>`).join("");btn.parentElement.appendChild(box);},
    async react(scope,key,id,emoji){try{await API.react(scope,key,id,emoji);}catch(e){alert(e.message);}},

  sendCallSignal(payload){
    console.log("📞 CALL SIGNAL:", payload);

    if(!this.ws){
        console.error("📞 WebSocket отсутствует");
        return false;
    }

    if(this.ws.readyState !== WebSocket.OPEN){
        console.error(
            "📞 WebSocket не открыт. Состояние:",
            this.ws.readyState
        );
        return false;
    }

    this.ws.send(JSON.stringify(payload));
    console.log("📞 CALL SIGNAL SENT");
    return true;
},
    async startCall(targetId,video=false,global=false){
        if(global){alert("Для звонков выберите конкретного человека.");return;}
        if(!targetId)return;
        const other=await Auth.getUserById(targetId);if(!other)return;
        if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){alert("Звонки не поддерживаются этим браузером.");return;}
        await this.closeCallResources();
        try{
            this.callTargetId=Number(targetId);this.callTargetName=other.name;this.callVideo=!!video;
            this.callStream=await navigator.mediaDevices.getUserMedia({audio:true,video:!!video});
            this.showCallOverlay("calling",other.name,video);
            const pc=this.createPeerConnection();this.callPc=pc;this.callStream.getTracks().forEach(t=>pc.addTrack(t,this.callStream));
            const offer=await pc.createOffer();await pc.setLocalDescription(offer);
            if(!this.sendCallSignal({type:"call_offer",to:Number(targetId),video:!!video,offer})) throw new Error("Не удалось передать сигнал звонка");
        }catch(e){await this.closeCallResources();alert("Не удалось начать звонок: "+(e?.message||e));}
    },
    createPeerConnection(){
        const pc=new RTCPeerConnection({iceServers:[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]});
        pc.onicecandidate=e=>{if(e.candidate){const payload={type:"call_ice",to:this.callTargetId,candidate:e.candidate};if(!this.sendCallSignal(payload))this.callIceQueue.push(payload);}};
        pc.ontrack=e=>{const v=document.getElementById("callRemote");if(v){v.srcObject=e.streams[0];v.play?.().catch(()=>{});}};
        pc.onconnectionstatechange=()=>{
            if(pc.connectionState==="connected"){
                this.callConnected=true;
                const el=document.querySelector(".call-top span"); if(el) el.textContent="На связи";
            }
            if(["failed","closed"].includes(pc.connectionState))this.endCall(false);
        };
        return pc;
    },
    showCallOverlay(state,name,video){
        document.querySelectorAll(".call-overlay").forEach(x=>x.remove());
        const el=document.createElement("div");el.className="call-overlay";
        el.innerHTML=`<div class="call-window ${video?"video-call":"audio-call"}"><video id="callRemote" class="call-remote" autoplay playsinline></video><div class="call-shade"></div><div class="call-top"><b>${this.esc(name||"Семья")}</b><span>${state==="incoming"?"Входящий звонок":state==="calling"?"Вызов…":"Подключение…"}</span></div><video id="callLocal" class="call-local" autoplay muted playsinline></video><div class="call-controls">${state==="incoming"?`<button class="call-accept" onclick="App.acceptIncomingCall()">📞 Принять</button><button class="call-decline" onclick="App.declineIncomingCall()">✕ Отклонить</button>`:`<button class="call-end" onclick="App.endCall(true)">✕ Завершить</button>`}</div></div>`;
        document.body.appendChild(el);const local=document.getElementById("callLocal");if(local&&this.callStream)local.srcObject=this.callStream;
    },
    async receiveCallOffer(msg){
        if(Number(msg.from)===Number(Auth.currentUser?.id))return;
        if(this.callPc||this.pendingIncomingCall){this.sendCallSignal({type:"call_end",to:Number(msg.from)});return;}
        this.callTargetId=Number(msg.from);this.callTargetName=String(msg.fromName||"Семья");this.callVideo=!!msg.video;this.pendingIncomingCall=msg;this.incomingIceQueue=[];
        this.cosmicSound("call");
        this.showCallOverlay("incoming",this.callTargetName,this.callVideo);
    },
    async acceptIncomingCall(){
        const msg=this.pendingIncomingCall;if(!msg)return;
        try{
            this.pendingIncomingCall=null;this.callStream=await navigator.mediaDevices.getUserMedia({audio:true,video:this.callVideo});
            const pc=this.createPeerConnection();this.callPc=pc;this.callStream.getTracks().forEach(t=>pc.addTrack(t,this.callStream));
            await pc.setRemoteDescription(msg.offer);
            for(const candidate of this.incomingIceQueue.splice(0)){try{await pc.addIceCandidate(candidate);}catch(e){console.warn("Queued ICE:",e);}}
            const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
            this.showCallOverlay("connected",this.callTargetName,this.callVideo);
            if(!this.sendCallSignal({type:"call_answer",to:this.callTargetId,answer})) throw new Error("Не удалось передать ответ на звонок");
            this.flushCallIce();
        }catch(e){this.pendingIncomingCall=null;await this.closeCallResources();alert("Не удалось принять звонок: "+(e?.message||e));}
    },
    declineIncomingCall(){const id=this.callTargetId;if(id)this.sendCallSignal({type:"call_end",to:id});this.pendingIncomingCall=null;this.endCall(false);},
    flushCallIce(){const queue=this.callIceQueue.splice(0);for(const payload of queue)this.sendCallSignal(payload);},
    async receiveCallAnswer(msg){
        if(!this.callPc)return;
        try{
            await this.callPc.setRemoteDescription(msg.answer);
            for(const candidate of this.incomingIceQueue.splice(0)){try{await this.callPc.addIceCandidate(candidate);}catch(e){console.warn("Queued ICE:",e);}}
            const el=document.querySelector(".call-top span");if(el)el.textContent="На связи";
        }catch(e){console.warn("Call answer:",e);}
    },
    async receiveCallIce(msg){
        if(!msg.candidate)return;
        if(!this.callPc || !this.callPc.remoteDescription){
            if(Number(msg.from)===Number(this.callTargetId)) this.incomingIceQueue.push(msg.candidate);
            return;
        }
        try{await this.callPc.addIceCandidate(msg.candidate);}catch(e){console.warn("Call ICE:",e);}
    },
    async endCall(notify=true){if(notify&&this.callTargetId)this.sendCallSignal({type:"call_end",to:this.callTargetId});this.pendingIncomingCall=null;await this.closeCallResources();document.querySelectorAll(".call-overlay").forEach(x=>x.remove());},
    async closeCallResources(){try{this.callPc?.close();}catch{}this.callPc=null;this.callStream?.getTracks().forEach(t=>t.stop());this.callStream=null;this.callTargetId=null;this.callTargetName="";this.callVideo=false;this.callIceQueue=[];this.incomingIceQueue=[];this.callConnected=false;},

    async toggleRecording(scope,id){
        if(this.audioSending){return;}
        if(this.mediaRecorder && this.mediaRecorder.state==="recording"){
            try{if(typeof this.mediaRecorder.requestData==="function")this.mediaRecorder.requestData();}catch{}
            this.mediaRecorder.stop();
            return;
        }
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert("Голосовые сообщения не поддерживаются этим браузером");return;}
        try{
            this.mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
            const candidates=["audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/webm;codecs=opus","audio/webm"];
            const mime=candidates.find(x=>typeof MediaRecorder.isTypeSupported!=="function"||MediaRecorder.isTypeSupported(x));
            this.mediaRecorder=mime?new MediaRecorder(this.mediaStream,{mimeType:mime,audioBitsPerSecond:64000}):new MediaRecorder(this.mediaStream);
            this.recordingChunks=[];this.recordingStarted=Date.now();this.audioSending=false;
            const recorder=this.mediaRecorder;
            recorder.onerror=()=>{this.stopRecordingResources();alert("Во время записи произошла ошибка. Попробуйте ещё раз.");};
            recorder.ondataavailable=e=>{if(e.data&&e.data.size)this.recordingChunks.push(e.data);};
            recorder.onstop=async()=>{
                clearInterval(this.recordingTimer);this.setRecordingUI(false);
                const stream=this.mediaStream;this.mediaRecorder=null;this.mediaStream=null;
                stream?.getTracks().forEach(t=>t.stop());
                const chunks=this.recordingChunks.slice();this.recordingChunks=[];
                const duration=(Date.now()-this.recordingStarted)/1000;
                if(duration<0.7||!chunks.length)return;
                const type=recorder.mimeType||mime||"audio/mp4";
                const blob=new Blob(chunks,{type});
                if(!blob.size){alert("Запись получилась пустой. Попробуйте ещё раз.");return;}
                this.audioSending=true;this.setRecordingUI("sending");
                try{
                    const data=await this.blobToDataURL(blob);
                    const audio={mime:blob.type||type,data,duration:Math.round(duration*10)/10};
                    const sent=scope==="global"?await API.sendGlobalAudio(audio,this.replyTarget):scope==="group"?await API.sendGroupAudio(id,audio,this.replyTarget):await API.sendPrivateAudio(id,audio,this.replyTarget);
                    if(sent?.audio?.id) await MediaVault.put(sent.audio.id,blob,blob.type||type,duration);
                    this.replyTarget=null;this.audioSending=false;this.hideKeyboard();this.cosmicSound("send");
                    this.appendSentMessage(sent,scope==="global",id);
                }catch(e){
                    this.audioSending=false;this.setRecordingUI(false);
                    alert("Не удалось отправить голосовое: "+(e?.message||"ошибка сервера"));
                }
            };
            recorder.start(250);this.setRecordingUI(true);this.cosmicSound("record");
        }catch(e){this.stopRecordingResources();alert("Не удалось получить доступ к микрофону: "+(e?.message||"проверьте разрешение микрофона"));}
    },
    stopRecordingResources(){clearInterval(this.recordingTimer);this.recordingTimer=null;this.mediaStream?.getTracks().forEach(t=>t.stop());this.mediaStream=null;this.mediaRecorder=null;this.setRecordingUI(false);},
    async playVoice(btn){
        const id=btn?.dataset.audioId;if(!id)return;
        const root=btn.closest(".voice-message");const audio=root?.querySelector("audio");if(!audio)return;
        if(!audio.src){try{const item=await MediaVault.get(id);if(item?.blob)audio.src=URL.createObjectURL(item.blob);}catch(e){console.warn("Voice:",e);}}
        try{if(audio.paused){await audio.play();btn.textContent="❚❚";audio.onended=()=>btn.textContent="▶";}else{audio.pause();btn.textContent="▶";}}catch(e){console.warn("Voice playback:",e);}
    },
    async hydrateLocalAudio(containerId){
        const root=document.getElementById(containerId);if(!root)return;
        const audios=[...root.querySelectorAll("audio.family-audio[data-audio-id]")];
        for(const el of audios){
            if(el.src)continue;
            try{const item=await MediaVault.get(el.dataset.audioId);if(item?.blob)el.src=URL.createObjectURL(item.blob);}catch(e){console.warn("Local audio:",e);}
        }
    },
    setRecordingUI(active){const btn=document.getElementById("micBtn");if(!btn)return;if(active==="sending"){btn.classList.add("recording");btn.innerHTML="⏳";btn.title="Отправка голосового…";return;}if(active){btn.classList.add("recording");btn.innerHTML='<span class="record-dot">●</span><span class="record-time">0:00</span>';this.recordingTimer=setInterval(()=>{const s=(Date.now()-this.recordingStarted)/1000;const t=btn.querySelector(".record-time");if(t)t.textContent=this.formatDuration(s);btn.title=`Запись ${this.formatDuration(s)}`;},250);}else{clearInterval(this.recordingTimer);this.recordingTimer=null;btn.classList.remove("recording");btn.textContent="🎙️";btn.title="Голосовое сообщение";}},
    blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});},

    async cacheFetchedAudio(messages,global,otherId,forcedScope=null){
        for(const m of messages||[]){
            if(m.type!=="audio"||!m.audio?.data||!m.audio?.id)continue;
            try{
                const blob=await (await fetch(m.audio.data)).blob();
                await MediaVault.put(m.audio.id,blob,m.audio.mime,m.audio.duration);
                const key=forcedScope==="group"?String(otherId):global?"global":this.getPrivateChatId(Auth.currentUser.id,otherId);
                if(Number(m.authorId)!==Number(Auth.currentUser.id)) await API.audioAck(forcedScope || (global?"global":"private"),key,m.id,m.audio.id);
            }catch(e){console.warn("Audio cache:",e);}
        }
        return messages;
    },
    getPrivateChatId(a,b){return [Number(a),Number(b)].sort((x,y)=>x-y).join("_");},
 
    esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");},
    attr(v){return this.esc(v);}
};

setInterval(async()=>{
    if(!Auth.currentUser)return;
    // Never navigate the user automatically. The old polling code could call showHome()
    // while a chat was still opening, which caused an intermittent jump back to the main menu.
    if(document.getElementById("messages")||document.getElementById("privateMessages"))return;
    if(!document.querySelector(".page .content"))return;
    try{
        const unread=await API.unread();
        const total=Number(unread.global||0)+Object.values(unread.private||{}).reduce((a,b)=>a+Number(b||0),0);
        const current=document.getElementById("familyUnreadTotal");
        if(current) current.textContent=String(total);
    }catch{}
},3000);

App.start();
