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

    async start() {
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
                if (document.getElementById("messages")) this.openGlobalChat();
            }
            if (msg.type === "private_message") {
                if (Number(msg.message?.authorId) !== Number(Auth.currentUser?.id)) this.messageArrived(msg.message, false);
                const otherId = Number(document.body.dataset.privateUser || 0);
                if (otherId && this.getPrivateChatId(Auth.currentUser.id,otherId) === msg.chatId) this.openPrivateChat(otherId);
            }
            if (msg.type === "reaction") {
                if (document.getElementById("messages")) this.openGlobalChat();
                if (document.getElementById("privateMessages")) {
                    const otherId=Number(document.body.dataset.privateUser||0);
                    if(otherId)this.openPrivateChat(otherId);
                }
            }
        });
    },

    messageArrived(message, global) {
        this.cosmicSound("message");
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
        app.innerHTML = `<div class="login"><div class="logo">😍</div><div class="title">Family</div><div class="subtitle">Семья · космический семейный чат</div>
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
        <h1>😍 Family</h1><div class="header-right">${total>0?`<span id="familyUnreadTotal" class="badge">${total}</span>`:""}<button class="icon-btn" onclick="App.openProfile()">${this.avatarHtml(u,34)}</button></div></div>
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
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>🪐 Профиль</h1></div><div class="content">
        <div class="profile-card"><div id="profileAvatar">${this.avatarHtml(u,92)}</div><div><h2>${this.esc(u.name)}</h2><small>@${this.esc(u.login)}</small></div></div>
        <div class="card form"><label class="field-label">Имя</label><input id="profileName" value="${this.attr(u.name)}"><label class="field-label">Аватар</label><input id="avatarFile" type="file" accept="image/*" onchange="App.previewAvatar(event)"><div class="avatar-actions"><button class="secondary" onclick="App.removeAvatar()">Удалить аватар</button><button class="primary" onclick="App.saveProfile()">Сохранить</button></div></div>
        <div class="card settings-card"><div><b>🔔 Уведомления</b><small id="pushStatus">Проверка…</small></div><button class="primary" onclick="App.enableNotifications()">Включить</button></div>
        <div class="card settings-card"><div><b>🌌 Космические звуки</b><small>Звук при новых сообщениях и действиях</small></div><button class="secondary" onclick="App.toggleSound()">${localStorage.getItem("FamilySound")==="off"?"Включить":"Выключить"}</button></div>
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

    async openPrivateChat(otherId){
        const other=await Auth.getUserById(otherId);if(!other)return;document.body.dataset.privateUser=otherId;
        const messages=await API.privateMessages(otherId);try{await API.markRead("private",this.getPrivateChatId(Auth.currentUser.id,otherId));}catch(e){}
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openUsers()">←</button>${this.avatarHtml(other,38)}<h1>${this.esc(other.name)}</h1></div><div class="messages" id="privateMessages">${messages.map(m=>this.messageHtml(m,false,otherId)).join("")}</div>${this.chatFooter("private",otherId,"Напишите сообщение...")}</div>`;
        this.scrollMessages("privateMessages");this.bindChatInput("privateInput",()=>this.sendPrivate(otherId));
    },
    async sendPrivate(id){const input=document.getElementById("privateInput");if(!input)return;const text=input.value.trim();if(!text)return;try{await API.sendPrivate(id,text);input.value="";this.cosmicSound("send");}catch(e){alert(e.message);}},

    async openGlobalChat(){
        const messages=await API.globalMessages();try{await API.markRead("global","global");}catch(e){}document.body.dataset.privateUser="";
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>🌌 Семья</h1></div><div class="messages" id="messages">${messages.map(m=>this.messageHtml(m,true)).join("")}</div>${this.chatFooter("global",null,"Напишите семье...")}</div>`;
        this.scrollMessages("messages");this.bindChatInput("messageInput",()=>this.sendGlobal());
    },
    async sendGlobal(){const input=document.getElementById("messageInput");if(!input)return;const text=input.value.trim();if(!text)return;try{await API.sendGlobal(text);input.value="";this.cosmicSound("send");}catch(e){alert(e.message);}},

    chatFooter(scope,id,placeholder){return `<div class="footer"><button class="tool-btn" id="micBtn" title="Голосовое сообщение" onclick="App.toggleRecording('${scope}',${id===null?"null":id})">🎙️</button><input id="${scope==="global"?"messageInput":"privateInput"}" placeholder="${placeholder}"><button class="primary send-btn" onclick="${scope==="global"?"App.sendGlobal()":"App.sendPrivate("+id+")"}">➤</button></div>`;},
    bindChatInput(id,fn){const input=document.getElementById(id);if(input){input.focus();input.onkeydown=e=>{if(e.key==="Enter")fn();};}},
    scrollMessages(id){const list=document.getElementById(id);if(list)list.scrollTop=list.scrollHeight;},

    messageHtml(m,global,otherId){
        const mine=Number(m.authorId)===Number(Auth.currentUser.id),scope=global?"global":"private",key=global?"global":this.getPrivateChatId(Auth.currentUser.id,otherId),reactions=Object.entries(m.reactions||{}).filter(([,ids])=>ids.length);
        const media=m.type==="audio"&&m.audio?.data?`<div class="voice-message"><div class="voice-title">🎙️ Голосовое</div><audio controls preload="metadata" src="${this.attr(m.audio.data)}"></audio>${m.audio.duration?`<span>${this.formatDuration(m.audio.duration)}</span>`:""}</div>`:`<div>${this.esc(m.text||"")}</div>`;
        return `<div class="message ${mine?"me":"other"}">${!mine?this.avatarHtml({avatar:m.avatar,gender:m.gender},34):""}<div class="bubble">${!mine?`<div class="author">${this.esc(m.author)}</div>`:""}${media}<div class="time">${new Date(m.time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}</div><div class="reaction-line">${reactions.map(([e,ids])=>`<button onclick="App.react('${scope}','${key}',${m.id},'${e}')">${e} ${ids.length}</button>`).join("")}<button class="add-reaction" onclick="App.showReactions(this,'${scope}','${key}',${m.id})">＋</button></div></div></div>`;
    },
    formatDuration(s){s=Math.round(Number(s)||0);return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;},
    showReactions(btn,scope,key,id){document.querySelectorAll(".reaction-picker").forEach(x=>x.remove());const box=document.createElement("div");box.className="reaction-picker";box.innerHTML=REACTIONS.map(e=>`<button onclick="App.react('${scope}','${key}',${id},'${e}');this.parentElement.remove()">${e}</button>`).join("");btn.parentElement.appendChild(box);},
    async react(scope,key,id,emoji){try{await API.react(scope,key,id,emoji);}catch(e){alert(e.message);}},

    async toggleRecording(scope,id){
        if(this.mediaRecorder && this.mediaRecorder.state==="recording"){this.mediaRecorder.stop();return;}
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){alert("Голосовые сообщения не поддерживаются этим браузером");return;}
        try{
            this.mediaStream=await navigator.mediaDevices.getUserMedia({audio:true});
            const mime=["audio/mp4","audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"].find(x=>MediaRecorder.isTypeSupported?.(x));
            this.mediaRecorder=mime?new MediaRecorder(this.mediaStream,{mimeType:mime}):new MediaRecorder(this.mediaStream);
            this.recordingChunks=[];this.recordingStarted=Date.now();
            this.mediaRecorder.ondataavailable=e=>{if(e.data.size)this.recordingChunks.push(e.data);};
            this.mediaRecorder.onstop=async()=>{clearInterval(this.recordingTimer);this.setRecordingUI(false);this.mediaStream?.getTracks().forEach(t=>t.stop());
                const blob=new Blob(this.recordingChunks,{type:this.mediaRecorder.mimeType||mime||"audio/webm"});const duration=(Date.now()-this.recordingStarted)/1000;
                if(duration<0.5)return;const data=await this.blobToDataURL(blob);const audio={mime:blob.type,data,duration};
                try{if(scope==="global")await API.sendGlobalAudio(audio);else await API.sendPrivateAudio(id,audio);this.cosmicSound("send");}catch(e){alert(e.message);}
            };
            this.mediaRecorder.start();this.setRecordingUI(true);this.cosmicSound("record");
        }catch(e){alert("Не удалось получить доступ к микрофону: "+e.message);}
    },
    setRecordingUI(active){const btn=document.getElementById("micBtn");if(!btn)return;if(active){btn.classList.add("recording");btn.textContent="⏹️";this.recordingTimer=setInterval(()=>{const s=(Date.now()-this.recordingStarted)/1000;btn.title=`Запись ${this.formatDuration(s)}`;},250);}else{btn.classList.remove("recording");btn.textContent="🎙️";btn.title="Голосовое сообщение";}},
    blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});},

    getPrivateChatId(a,b){return [Number(a),Number(b)].sort((x,y)=>x-y).join("_");},
    esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");},
    attr(v){return this.esc(v);}
};

setInterval(async()=>{
    if(!Auth.currentUser)return;if(document.getElementById("messages")||document.getElementById("privateMessages"))return;
    try{const unread=await API.unread(),total=Number(unread.global||0)+Object.values(unread.private||{}).reduce((a,b)=>a+Number(b||0),0),current=document.getElementById("familyUnreadTotal");if(current)current.textContent=String(total);else if(total>0&&document.querySelector(".content"))App.showHome();}catch{}
},3000);

App.start();
