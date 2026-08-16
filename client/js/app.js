const app = document.getElementById("app");
const REACTIONS = ["❤️","👍","😂","😍","😢","😮"];

const App = {
    ws:null,

    async start() {
        if (await Auth.autoLogin()) {
            this.connectRealtime();
            await this.showHome();
        } else {
            this.showLogin();
        }
    },

    connectRealtime() {
        if (this.ws) try { this.ws.close(); } catch {}
        this.ws = API.connectWS(msg => {
            if (msg.type === "global_message" && document.getElementById("messages")) this.openGlobalChat();
            if (msg.type === "private_message" && document.getElementById("privateMessages")) {
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

    showLogin() {
        app.innerHTML = `<div class="login"><div class="logo">😍</div><div class="title">Family</div><div class="subtitle">Семья</div>
        <input id="login" placeholder="Логин" autocomplete="username">
        <input id="password" type="password" placeholder="Пароль" autocomplete="current-password">
        <button class="primary" onclick="App.login()">Войти</button></div>`;
        document.getElementById("password").addEventListener("keydown",e=>{if(e.key==="Enter")this.login();});
    },

    async login() {
        const login=document.getElementById("login").value.trim(), password=document.getElementById("password").value.trim();
        if(!login||!password){alert("Введите логин и пароль");return;}
        if(await Auth.login(login,password)){this.connectRealtime();await this.showHome();}
        else alert("Неверный логин или пароль");
    },

    async showHome() {
        const u=Auth.currentUser;
        if(!u){this.showLogin();return;}

        let unread={global:0,private:{}};
        try { unread=await API.unread(); } catch(e) { console.warn("Unread error:",e); }

        const globalCount=Number(unread.global||0);
        const privateCounts=unread.private||{};
        const totalPrivate=Object.values(privateCounts).reduce((a,b)=>a+Number(b||0),0);

        app.innerHTML=`<div class="page"><div class="header">
        <h1>😍 Family</h1><div class="header-right">${(globalCount+totalPrivate)>0?`<span id="familyUnreadTotal" class="badge">${globalCount+totalPrivate}</span>`:""}<span>${this.esc(u.name)}</span></div></div>
        <div class="content">
        <div class="card" onclick="App.openGlobalChat()">
            <div class="home-card-title">💬 <b>Семья</b>
            ${globalCount>0?`<span class="badge badge-pulse">${globalCount}</span>`:""}
            </div>
            <small>Общий семейный чат${globalCount>0?` · ${globalCount} новых`:""}</small>
        </div>
        <div class="card" onclick="App.openUsers()">
            <div class="home-card-title">👤 <b>Личные сообщения</b>
            ${totalPrivate>0?`<span class="badge badge-pulse">${totalPrivate}</span>`:""}
            </div>
            <small>Диалоги с семьёй${totalPrivate>0?` · ${totalPrivate} новых`:""}</small>
        </div>
        ${Auth.isAdmin()?`<div class="card" onclick="App.openAdmin()">👑 <b>Пользователи</b><small>Управление семьёй</small></div>`:""}
        <div class="card" onclick="App.logout()">🚪 <b>Выйти</b></div>
        </div></div>`;
    },

    async logout(){await Auth.logout();if(this.ws)try{this.ws.close()}catch{}this.showLogin();},

    async openAdmin() {
        if(!Auth.isAdmin())return;
        const users=await Auth.getUsers();
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>👑 Пользователи</h1></div><div class="content">
        ${users.map(u=>`<div class="card user-row"><div><div class="user-name">${u.gender==="female"?"👩":"👨"} ${this.esc(u.name)}</div><small>@${this.esc(u.login)} · ${u.role==="admin"?"Администратор":"Пользователь"}</small></div>
        <div class="actions"><button onclick="App.editUser(${u.id})">✏️</button>${u.id!==Auth.currentUser.id?`<button onclick="App.removeUser(${u.id})">🗑️</button>`:""}</div></div>`).join("")}
        ${users.length<4?`<div class="card" onclick="App.showCreateUser()">➕ Добавить пользователя</div>`:"<div class='hint'>В Family максимум 4 человека.</div>"}
        </div></div>`;
    },

    showCreateUser() {
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openAdmin()">←</button><h1>➕ Пользователь</h1></div><div class="content"><div class="card form">
        <input id="newName" placeholder="Имя"><input id="newLogin" placeholder="Логин"><input id="newPassword" type="password" placeholder="Пароль">
        <div class="gender"><label><input type="radio" name="gender" value="male" checked> 👨 Мужчина</label><label><input type="radio" name="gender" value="female"> 👩 Женщина</label></div>
        <button class="primary" onclick="App.createUser()">Создать</button></div></div></div>`;
    },

    async createUser() {
        const name=document.getElementById("newName").value.trim(),login=document.getElementById("newLogin").value.trim(),password=document.getElementById("newPassword").value.trim();
        const gender=document.querySelector('input[name="gender"]:checked').value;
        const r=await Auth.createUser(name,login,password,gender);if(!r.success){alert(r.error);return;}await this.openAdmin();
    },

    async editUser(id) {
        const u=await Auth.getUserById(id);if(!u)return;
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openAdmin()">←</button><h1>✏️ Пользователь</h1></div><div class="content"><div class="card form">
        <input id="editName" value="${this.attr(u.name)}" placeholder="Имя"><input id="editLogin" value="${this.attr(u.login)}" placeholder="Логин"><input id="editPassword" type="password" placeholder="Новый пароль">
        <div class="gender"><label><input type="radio" name="eg" value="male" ${u.gender!=="female"?"checked":""}> 👨 Мужчина</label><label><input type="radio" name="eg" value="female" ${u.gender==="female"?"checked":""}> 👩 Женщина</label></div>
        <button class="primary" onclick="App.saveUser(${id})">Сохранить</button></div></div></div>`;
    },

    async saveUser(id) {
        const data={name:document.getElementById("editName").value.trim(),login:document.getElementById("editLogin").value.trim(),gender:document.querySelector('input[name="eg"]:checked').value};
        const p=document.getElementById("editPassword").value.trim();if(p)data.password=p;
        const r=await Auth.updateUser(id,data);if(!r.success){alert(r.error);return;}await this.openAdmin();
    },

    async removeUser(id) {
        const u=await Auth.getUserById(id);if(!u)return;
        if(!confirm(`Удалить "${u.name}"?`))return;
        const r=await Auth.deleteUser(id);if(!r.success)alert(r.error);else await this.openAdmin();
    },

    async openUsers() {
        const users=await Auth.getUsers(), me=Auth.currentUser;
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>👤 Личные</h1></div><div class="content">
        ${users.filter(u=>u.id!==me.id).map(u=>`<div class="card" onclick="App.openPrivateChat(${u.id})"><div class="user-name">${u.gender==="female"?"👩":"👨"} ${this.esc(u.name)}</div><small>@${this.esc(u.login)}</small></div>`).join("")}
        </div></div>`;
    },

    async openPrivateChat(otherId) {
        const other=await Auth.getUserById(otherId);if(!other)return;
        document.body.dataset.privateUser=otherId;
        const messages=await API.privateMessages(otherId);
        try { await API.markRead("private",this.getPrivateChatId(Auth.currentUser.id,otherId)); } catch(e) { console.warn("mark private read:",e); }
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.openUsers()">←</button><h1>${other.gender==="female"?"👩":"👨"} ${this.esc(other.name)}</h1></div>
        <div class="messages" id="privateMessages">${messages.map(m=>this.messageHtml(m,false,otherId)).join("")}</div>
        <div class="footer"><input id="privateInput" placeholder="Введите сообщение..."><button class="primary" onclick="App.sendPrivate(${otherId})">➤</button></div></div>`;
        const list=document.getElementById("privateMessages");list.scrollTop=list.scrollHeight;
        const input=document.getElementById("privateInput");input.focus();input.onkeydown=e=>{if(e.key==="Enter")this.sendPrivate(otherId);};
    },

    async sendPrivate(id) {
        const input=document.getElementById("privateInput");if(!input)return;const text=input.value.trim();if(!text)return;
        try{await API.sendPrivate(id,text);input.value="";}catch(e){alert(e.message);}
    },

    async openGlobalChat() {
        const messages=await API.globalMessages();
        try { await API.markRead("global","global"); } catch(e) { console.warn("mark global read:",e); }
        document.body.dataset.privateUser="";
        app.innerHTML=`<div class="page"><div class="header"><button onclick="App.showHome()">←</button><h1>💬 Семья</h1></div>
        <div class="messages" id="messages">${messages.map(m=>this.messageHtml(m,true)).join("")}</div>
        <div class="footer"><input id="messageInput" placeholder="Напишите семье..."><button class="primary" onclick="App.sendGlobal()">➤</button></div></div>`;
        const list=document.getElementById("messages");list.scrollTop=list.scrollHeight;
        const input=document.getElementById("messageInput");input.focus();input.onkeydown=e=>{if(e.key==="Enter")this.sendGlobal();};
    },

    async sendGlobal() {
        const input=document.getElementById("messageInput");if(!input)return;const text=input.value.trim();if(!text)return;
        try{await API.sendGlobal(text);input.value="";}catch(e){alert(e.message);}
    },

    messageHtml(m,global,otherId) {
        const mine=Number(m.authorId)===Number(Auth.currentUser.id);
        const scope=global?"global":"private", key=global?"global":this.getPrivateChatId(Auth.currentUser.id,otherId);
        const reactions=Object.entries(m.reactions||{}).filter(([,ids])=>ids.length);
        return `<div class="message ${mine?"me":"other"}"><div class="bubble">${!mine?`<div class="author">${this.esc(m.author)}</div>`:""}<div>${this.esc(m.text)}</div>
        <div class="time">${new Date(m.time).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}</div>
        <div class="reaction-line">${reactions.map(([e,ids])=>`<button onclick="App.react('${scope}','${key}',${m.id},'${e}')">${e} ${ids.length}</button>`).join("")}
        <button class="add-reaction" onclick="App.showReactions(this,'${scope}','${key}',${m.id})">＋</button></div></div></div>`;
    },

    showReactions(btn,scope,key,id) {
        document.querySelectorAll(".reaction-picker").forEach(x=>x.remove());
        const box=document.createElement("div");box.className="reaction-picker";
        box.innerHTML=REACTIONS.map(e=>`<button onclick="App.react('${scope}','${key}',${id},'${e}');this.parentElement.remove()">${e}</button>`).join("");
        btn.parentElement.appendChild(box);
    },

    async react(scope,key,id,emoji) {
        try{await API.react(scope,key,id,emoji);}catch(e){alert(e.message);}
    },

    getPrivateChatId(a,b){return [Number(a),Number(b)].sort((x,y)=>x-y).join("_");},
    esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");},
    attr(v){return this.esc(v);}
};

setInterval(async()=>{
    if(!Auth.currentUser) return;
    if(document.getElementById("messages") || document.getElementById("privateMessages")) return;
    try {
        const unread=await API.unread();
        const total=Number(unread.global||0)+Object.values(unread.private||{}).reduce((a,b)=>a+Number(b||0),0);
        const current=document.getElementById("familyUnreadTotal");
        if(current) current.textContent=String(total);
        else if(total>0 && document.querySelector(".content")) App.showHome();
    } catch {}
},3000);

App.start();