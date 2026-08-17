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
    fontFamily: localStorage.getItem("FamilyFont") || "system",
    fontSize: Number(localStorage.getItem("FamilyFontSize") || 17),
    usersCache: [],
    replyTarget: null,
    favorites: JSON.parse(localStorage.getItem("FamilyFavorites") || "[]"),

    async start() {
        this.applyAppearance();
        this.initPWA();
        if (await Auth.autoLogin()) {
            this.connectRealtime();
            await this.showHome();
            this.ensurePushSubscription(false);
        } else this.showLogin();
    },

    async initPWA() {
        if (!("serviceWorker" in navigator)) return;
        try { this.notificationRegistration = await navigator.serviceWorker.register("sw.js", {scope:"./"}); }
        catch(e) { console.warn("Service worker:", e); }
    },

    connectRealtime() {
        if (this.ws) try { this.ws.close(); } catch {}
        this.ws = API.connectWS(msg => {
            if (msg.type === "global_message") {
                if (Number(msg.message?.authorId) !== Number(Auth.currentUser?.id)) this.messageArrived(msg.message, true);
                if (document.getElementById("messages")) this.refreshOpenChat(true);
            }
            if (msg.type === "private_message") {
                if (Number(msg.message?.authorId) !== Number(Auth.currentUser?.id)) this.messageArrived(msg.message, false);
                const otherId = Number(document.body.dataset.privateUser || 0);
                if (otherId && this.getPrivateChatId(Auth.currentUser.id,otherId) === msg.chatId) this.refreshOpenChat(false, otherId);
            }
            if (msg.type === "reaction" || msg.type === "message_updated" || msg.type === "message_deleted") {
                const otherId=Number(document.body.dataset.privateUser||0);
                if (msg.scope === "private" || msg.chatId) {
                    if (otherId && this.getPrivateChatId(Auth.currentUser.id,otherId) === (msg.key || msg.chatId)) this.refreshOpenChat(false,otherId);
                } else if (document.getElementById("messages")) this.refreshOpenChat(true);
            }
        });
    },

    async messageArrived(message, global) {
        this.cosmicSound("message");
        if(message?.type==="audio"&&message.audio?.data&&message.audio?.id){
            try{
                const blob=await (await fetch(message.audio.data)).blob();
                await MediaVault.put(message.audio.id,blob,message.audio.mime,message.audio.duration);
                const key=global?"global":this.getPrivateChatId(Auth.currentUser.id,message.authorId);
                await API.audioAck(global?"global":"private",key,message.id,message.audio.id);
            }catch(e){console.warn("Audio delivery:",e);}
        }
        try { if ("vibrate" in navigator) navigator.vibrate([40,30,40]); } catch {}
        if (document.visibilityState !== "visible") return;
        const text = message?.type === "audio" ? "🎙️ Голосовое сообщение" : (message?.text || "Новое сообщение");
        this.toast(`🌌 ${this.esc(message?.author || "Семья")}`, text);
    },

    cosmicSound(kind="message") {
        if (localStorage.getItem("FamilySound") === "off") return;
        try {
            const Ctx=window.AudioContext||window.webkitAudioContext;
            if(!Ctx)return;
            const ctx=new Ctx();
            const now=ctx.currentTime;
            const notes=kind==="send"?[520,780]:kind==="record"?[330,495,660]:[660,990,1320];
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
        const u=Auth.currentUser;if(!u){this.showLogin();return;}
        let unread={global:0,private:{}};try{unread=await API.unread();}catch(e){console.warn("Unread:",e);}
        const globalCount=Number(unread.global||0), privateCounts=unread.private||{};
        const totalPrivate=Object.values(privateCounts).reduce((a,b)=>a+Number(b||0),0), total=globalCount+totalPrivate;
        app.innerHTML=`<div class="page"><div class="header">
        <h1 class="brand-title"><img class="brand-icon" src="assets/icon-180.png" alt=""> Family</h1><div class="header-right">${total>0?`<span id="familyUnreadTotal" class="badge">${total}</span>`:""}<button class="icon-btn" onclick="App.openProfile()">${this.avatarHtml(u,34)}</button></div></div>
        <div class="content">
        <div class="card cosmic-card" onclick="App.openGlobalChat()"><div class="home-card-title">🌌 <b>Семья</b>${globalCount>0?`<span class="badge badge-pulse">${globalCount}</span>`:""}</div><small>Общий семейный чат${globalCount>0?` · ${globalCount} новых`:""}</small></div>
        <div class="card" onclick="App.openUsers()"><div class="home-card-title">👤 <b>Личные сообщения</b>${totalPrivate>0?`<span class="badge badge-pulse">${totalPrivate}</span>`:""}</div><small>Диалоги с семьёй${totalPrivate>0?` · ${totalPrivate} новых`:""}</small></div>
        <div class="card" onclick="App.openProfile()">🪐 <b>Мой профиль</b><small>Аватар, уведомления и звуки</small></div>
        ${Auth.isAdmin()?`<div class="card" onclick="App.openAdmin()">👑 <b>Пользователи</b><small>Управление семьёй</small></div>`:""}
        <div class="card" onclick="App.logout()">🚪 <b>Выйти</b></div>
        </div></div>`;
    },

    async logout(){await Auth.logout();if(this.ws)try{this.ws.close()}catch{}this.showLogin();},

    avatarHtml(u,size=48){
        const cls=size<=36?"avatar avatar-sm":"avatar";
        return u?.avatar ? `<span class="${cls}" style="width:${size}px;height:${size}px"><img src="${this.attr(u.avatar)}" alt=""></span>` : `<span class="${cls}" style="width:${size}px;height:${size}px">${u?.gender==="female"?"👩":"👨"}</span>`;
    },

    async openProfile() {
        const u=Auth.currentUser;
        const themeNames={cosmic:"🌌 Космос",warm:"🌅 Тёплая",fresh:"🌿 Свежая"};
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>🪐 Профиль</h1></div><div class="content">
        <div class="profile-card"><div id="profileAvatar">${this.avatarHtml(u,92)}</div><div><h2>${this.esc(u.name)}</h2><small>@${this.esc(u.login)}</small></div></div>
        <div class="card form"><label class="field-label">Имя</label><input id="profileName" value="${this.attr(u.name)}"><label class="field-label">Аватар</label><input id="avatarFile" type="file" accept="image/*" onchange="App.previewAvatar(event)"><div class="avatar-actions"><button class="secondary" onclick="App.removeAvatar()">Удалить аватар</button><button class="primary" onclick="App.saveProfile()">Сохранить</button></div></div>
        <div class="card settings-card"><div><b>🔔 Уведомления</b><small id="pushStatus">Проверка…</small></div><button class="primary" onclick="App.enableNotifications()">Включить</button></div>
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
        </div></div>`;
        this.updatePushStatus();
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
        if(!("Notification" in window)||!("serviceWorker" in navigator)){el.textContent="Этот браузер не поддерживает web-уведомления";return;}
        el.textContent=Notification.permission==="granted"?"Разрешены":"Нажмите «Включить» и разрешите уведомления";
    },
    async enableNotifications(){
        if(!window.isSecureContext){alert("Для уведомлений нужен HTTPS. GitHub Pages подходит.");return;}
        if(!window.Notification || !navigator.serviceWorker || !window.PushManager){alert("Этот браузер не поддерживает web push");return;}
        // Permission is requested directly from the user's tap, as required by iOS Safari.
        const permission=await Notification.requestPermission();
        if(permission!=="granted"){this.updatePushStatus();return;}
        try{
            if(!this.notificationRegistration) await this.initPWA();
            if(!this.notificationRegistration)throw new Error("Не удалось запустить Service Worker");
            const key=await API.pushPublicKey();
            const subscription=await this.notificationRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:this.urlBase64ToUint8Array(key)});
            await API.pushSubscribe(subscription.toJSON());
            this.updatePushStatus();this.toast("🔔 Уведомления","Family теперь сможет сообщать о новых сообщениях");
        }catch(e){console.error(e);alert("Не удалось включить уведомления: "+e.message);}
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
        if(!Auth.isAdmin())return;const users=await Auth.getUsers();
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>👑 Пользователи</h1></div><div class="content">
        ${users.map(u=>`<div class="card user-row"><div class="user-person">${this.avatarHtml(u,48)}<div><div class="user-name">${this.esc(u.name)}</div><small>@${this.esc(u.login)} · ${u.role==="admin"?"Администратор":"Пользователь"}</small></div></div><div class="actions"><button onclick="App.editUser(${u.id})">✏️</button>${u.id!==Auth.currentUser.id?`<button onclick="App.removeUser(${u.id})">🗑️</button>`:""}</div></div>`).join("")}
        ${users.length<4?`<div class="card" onclick="App.showCreateUser()">➕ Добавить пользователя</div>`:"<div class='hint'>В Family максимум 4 человека.</div>"}</div></div>`;
    },
    showCreateUser(){app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openAdmin()">←</button><h1>➕ Пользователь</h1></div><div class="content"><div class="card form"><input id="newName" placeholder="Имя"><input id="newLogin" placeholder="Логин"><input id="newPassword" type="password" placeholder="Пароль"><div class="gender"><label><input type="radio" name="gender" value="male" checked> 👨 Мужчина</label><label><input type="radio" name="gender" value="female"> 👩 Женщина</label></div><button class="primary" onclick="App.createUser()">Создать</button></div></div></div>`;},
    async createUser(){const name=document.getElementById("newName").value.trim(),login=document.getElementById("newLogin").value.trim(),password=document.getElementById("newPassword").value.trim(),gender=document.querySelector('input[name="gender"]:checked').value;const r=await Auth.createUser(name,login,password,gender);if(!r.success){alert(r.error);return;}await this.openAdmin();},
    async editUser(id){const u=await Auth.getUserById(id);if(!u)return;app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openAdmin()">←</button><h1>✏️ Пользователь</h1></div><div class="content"><div class="card form"><div class="edit-avatar">${this.avatarHtml(u,78)}</div><input id="editName" value="${this.attr(u.name)}" placeholder="Имя"><input id="editLogin" value="${this.attr(u.login)}" placeholder="Логин"><input id="editPassword" type="password" placeholder="Новый пароль"><div class="gender"><label><input type="radio" name="eg" value="male" ${u.gender!=="female"?"checked":""}> 👨 Мужчина</label><label><input type="radio" name="eg" value="female" ${u.gender==="female"?"checked":""}> 👩 Женщина</label></div><button class="primary" onclick="App.saveUser(${id})">Сохранить</button></div></div></div>`;},
    async saveUser(id){const data={name:document.getElementById("editName").value.trim(),login:document.getElementById("editLogin").value.trim(),gender:document.querySelector('input[name="eg"]:checked').value};const p=document.getElementById("editPassword").value.trim();if(p)data.password=p;const r=await Auth.updateUser(id,data);if(!r.success){alert(r.error);return;}await this.openAdmin();},
    async removeUser(id){const u=await Auth.getUserById(id);if(!u)return;if(!confirm(`Удалить "${u.name}"?`))return;const r=await Auth.deleteUser(id);if(!r.success)alert(r.error);else await this.openAdmin();},

    async openUsers(){const users=await Auth.getUsers(),me=Auth.currentUser;app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>👤 Личные</h1></div><div class="content dialog-list">${users.filter(u=>u.id!==me.id).map(u=>`<div class="dialog-card" onclick="App.openPrivateChat(${u.id})">${this.avatarHtml(u,48)}<div class="dialog-main"><div class="dialog-name">${this.esc(u.name)}</div><div class="dialog-preview">@${this.esc(u.login)} ${u.presence?.online?"· 🟢 онлайн":""}</div></div></div>`).join("")}</div></div>`;},

    async refreshOpenChat(global,otherId){
        if(global && !document.getElementById("messages"))return;
        if(!global && !document.getElementById("privateMessages"))return;
        try { if(global) await this.openGlobalChat(true); else await this.openPrivateChat(otherId,true); } catch(e){console.warn("Chat refresh:",e);}
    },
    async openPrivateChat(otherId,silent=false){
        const other=await Auth.getUserById(otherId);if(!other)return;document.body.dataset.privateUser=otherId;
        try{this.usersCache=await API.users();}catch{}
        let messages=await API.privateMessages(otherId);messages=await this.cacheFetchedAudio(messages,false,otherId);this._lastMessages=messages;try{await API.markRead("private",this.getPrivateChatId(Auth.currentUser.id,otherId));}catch(e){}
        app.innerHTML=`<div class="page chat-page"><div class="header"><button onclick="App.openUsers()">←</button>${this.avatarHtml(other,38)}<h1>${this.esc(other.name)}</h1></div><div class="messages" id="privateMessages">${messages.map(m=>this.messageHtml(m,false,otherId)).join("")}</div>${this.chatFooter("private",otherId,"Напишите сообщение...")}</div>`;
        this.scrollMessages("privateMessages");this.bindChatInput("privateInput",()=>this.sendPrivate(otherId));this.hydrateLocalAudio("privateMessages");
    },
    async sendPrivate(id){const input=document.getElementById("privateInput");if(!input)return;const text=input.value.trim();if(!text)return;try{await API.sendPrivate(id,text,this.replyTarget);input.value="";this.clearReply();this.hideKeyboard();this.cosmicSound("send");}catch(e){alert(e.message);}},

    async openGlobalChat(silent=false){
        try{this.usersCache=await API.users();}catch{}
        let messages=await API.globalMessages();messages=await this.cacheFetchedAudio(messages,true,null);this._lastMessages=messages;try{await API.markRead("global","global");}catch(e){}document.body.dataset.privateUser="";
        app.innerHTML=`<div class="page chat-page"><div class="header"><button onclick="App.showHome()">←</button><h1>🌌 Семья</h1></div><div class="messages" id="messages">${messages.map(m=>this.messageHtml(m,true)).join("")}</div>${this.chatFooter("global",null,"Напишите семье...")}</div>`;
        this.scrollMessages("messages");this.bindChatInput("messageInput",()=>this.sendGlobal());this.hydrateLocalAudio("messages");
    },
    async sendGlobal(){const input=document.getElementById("messageInput");if(!input)return;const text=input.value.trim();if(!text)return;try{await API.sendGlobal(text,this.replyTarget);input.value="";this.clearReply();this.hideKeyboard();this.cosmicSound("send");}catch(e){alert(e.message);}},

    chatFooter(scope,id,placeholder){const inputId=scope==="global"?"messageInput":"privateInput";return `${this.replyTarget?`<div class="reply-bar"><b>↩️ Ответ</b><span>${this.esc(this.replyTarget.text||"Голосовое сообщение")}</span><button onclick="App.clearReply()">×</button></div>`:""}<div class="footer"><button class="tool-btn" title="Эмодзи" onclick="App.showEmojiPicker(this,'${inputId}')">😊</button><button class="tool-btn" id="micBtn" title="Голосовое сообщение" onclick="App.toggleRecording('${scope}',${id===null?"null":id})">🎙️</button><input id="${inputId}" placeholder="${placeholder}" autocomplete="off"><button class="primary send-btn" onclick="${scope==="global"?"App.sendGlobal()":"App.sendPrivate("+id+")"}">➤</button></div>`;},
    bindChatInput(id,fn){const input=document.getElementById(id);if(input){input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();fn();}};}},
    scrollMessages(id){const list=document.getElementById(id);if(list)requestAnimationFrame(()=>{list.scrollTop=list.scrollHeight;setTimeout(()=>{list.scrollTop=list.scrollHeight;},80);});},

    linkify(text){
        return this.esc(text).replace(/(https?:\/\/[^\s<]+)/g,(m)=>{const clean=m.replace(/[.,!?;:]+$/g,"");const tail=m.slice(clean.length);return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${tail}`;});
    },

    hideKeyboard(){
        const el=document.activeElement;
        if(el && typeof el.blur==="function") el.blur();
    },

    messageHtml(m,global,otherId){
        const mine=Number(m.authorId)===Number(Auth.currentUser.id),scope=global?"global":"private",key=global?"global":this.getPrivateChatId(Auth.currentUser.id,otherId),reactions=Object.entries(m.reactions||{}).filter(([,ids])=>ids.length);
        const authorUser=this.usersCache.find(u=>Number(u.id)===Number(m.authorId))||m;
        const avatar=!mine?this.avatarHtml(authorUser,34):"";
        const hasAudio=m.type==="audio"&&m.audio;
        const audioSrc=hasAudio&&m.audio.data?this.attr(m.audio.data):"";
        const media=hasAudio?`<div class="voice-message"><div class="voice-title">🎙️ Голосовое <span class="voice-local">${m.audio.data?"":"на устройстве"}</span></div><audio class="family-audio" controls preload="metadata" ${audioSrc?`src="${audioSrc}"`:""} data-audio-id="${this.attr(m.audio.id||"")}"></audio>${m.audio.duration?`<span>${this.formatDuration(m.audio.duration)}</span>`:""}</div>`:`<div class="message-text">${this.linkify(m.text||"")}</div>`;
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
    getCurrentScope(){return document.getElementById("messages")?"global":"private"},
    formatDuration(s){s=Math.round(Number(s)||0);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;},
    showReactions(btn,scope,key,id){document.querySelectorAll(".reaction-picker").forEach(x=>x.remove());const box=document.createElement("div");box.className="reaction-picker";box.innerHTML=REACTIONS.map(e=>`<button onclick="App.react('${scope}','${key}',${id},'${e}');this.parentElement.remove()">${e}</button>`).join("");btn.parentElement.appendChild(box);},
    async react(scope,key,id,emoji){try{await API.react(scope,key,id,emoji);}catch(e){alert(e.message);}},

    async toggleRecording(scope,id){
        if(this.mediaRecorder && this.mediaRecorder.state==="recording"){this.mediaRecorder.stop();return;}
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert("Голосовые сообщения не поддерживаются этим браузером");return;}
        try{
            this.mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
            const candidates=["audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/webm;codecs=opus","audio/webm"];
            const mime=candidates.find(x=>MediaRecorder.isTypeSupported?.(x));
            this.mediaRecorder=mime?new MediaRecorder(this.mediaStream,{mimeType:mime,audioBitsPerSecond:64000}):new MediaRecorder(this.mediaStream);
            this.recordingChunks=[];this.recordingStarted=Date.now();
            let failed=false;
            this.mediaRecorder.onerror=()=>{failed=true;this.stopRecordingResources();alert("Во время записи произошла ошибка. Попробуйте ещё раз.");};
            this.mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)this.recordingChunks.push(e.data);};
            this.mediaRecorder.onstop=async()=>{
                clearInterval(this.recordingTimer);this.setRecordingUI(false);
                const recorder=this.mediaRecorder;const stream=this.mediaStream;this.mediaRecorder=null;this.mediaStream=null;
                stream?.getTracks().forEach(t=>t.stop());
                if(failed)return;
                const duration=(Date.now()-this.recordingStarted)/1000;if(duration<0.5)return;
                const type=recorder?.mimeType||mime||"audio/mp4";
                const blob=new Blob(this.recordingChunks,{type});
                if(!blob.size){alert("Запись получилась пустой. Попробуйте ещё раз.");return;}
                const data=await this.blobToDataURL(blob);
                const audio={mime:blob.type,data,duration};
                try{
                    const sent=scope==="global"?await API.sendGlobalAudio(audio,this.replyTarget):await API.sendPrivateAudio(id,audio,this.replyTarget);
                    if(sent?.audio?.id) await MediaVault.put(sent.audio.id,blob,blob.type,duration);
                    this.replyTarget=null;
                    this.cosmicSound("send");
                    if(scope==="global")this.openGlobalChat();else this.openPrivateChat(id);
                }catch(e){alert(e.message);}
            };
            // A short timeslice makes Safari/iPhone deliver chunks reliably instead of waiting for stop().
            this.mediaRecorder.start(250);this.setRecordingUI(true);this.cosmicSound("record");
        }catch(e){this.stopRecordingResources();alert("Не удалось получить доступ к микрофону: "+(e?.message||"проверьте разрешение микрофона"));}
    },
    stopRecordingResources(){clearInterval(this.recordingTimer);this.recordingTimer=null;this.mediaStream?.getTracks().forEach(t=>t.stop());this.mediaStream=null;this.mediaRecorder=null;this.setRecordingUI(false);},
    async hydrateLocalAudio(containerId){
        const root=document.getElementById(containerId);if(!root)return;
        const audios=[...root.querySelectorAll("audio.family-audio[data-audio-id]")];
        for(const el of audios){
            if(el.src)continue;
            try{const item=await MediaVault.get(el.dataset.audioId);if(item?.blob)el.src=URL.createObjectURL(item.blob);}catch(e){console.warn("Local audio:",e);}
        }
    },
    setRecordingUI(active){const btn=document.getElementById("micBtn");if(!btn)return;if(active){btn.classList.add("recording");btn.innerHTML='<span class="record-dot">●</span><span class="record-time">0:00</span>';this.recordingTimer=setInterval(()=>{const s=(Date.now()-this.recordingStarted)/1000;const t=btn.querySelector(".record-time");if(t)t.textContent=this.formatDuration(s);btn.title=`Запись ${this.formatDuration(s)}`;},250);}else{btn.classList.remove("recording");btn.textContent="🎙️";btn.title="Голосовое сообщение";}},
    blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});},

    async cacheFetchedAudio(messages,global,otherId){
        for(const m of messages||[]){
            if(m.type!=="audio"||!m.audio?.data||!m.audio?.id)continue;
            try{
                const blob=await (await fetch(m.audio.data)).blob();
                await MediaVault.put(m.audio.id,blob,m.audio.mime,m.audio.duration);
                const key=global?"global":this.getPrivateChatId(Auth.currentUser.id,otherId);
                if(Number(m.authorId)!==Number(Auth.currentUser.id)) await API.audioAck(global?"global":"private",key,m.id,m.audio.id);
            }catch(e){console.warn("Audio cache:",e);}
        }
        return messages;
    },
    getPrivateChatId(a,b){return [Number(a),Number(b)].sort((x,y)=>x-y).join("_");},
    esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");},
    attr(v){return this.esc(v);}
};

setInterval(async()=>{
    if(!Auth.currentUser)return;if(document.getElementById("messages")||document.getElementById("privateMessages"))return;
    try{const unread=await API.unread(),total=Number(unread.global||0)+Object.values(unread.private||{}).reduce((a,b)=>a+Number(b||0),0),current=document.getElementById("familyUnreadTotal");if(current)current.textContent=String(total);else if(total>0&&document.querySelector(".content"))App.showHome();}catch{}
},3000);

App.start();
