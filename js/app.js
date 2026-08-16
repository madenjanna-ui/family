/*
==========================================
        Family😍 Messenger
        app.js
        Functional build 1.0
==========================================
*/

const app = document.getElementById("app");

const App = {

    reactions: ["❤️", "👍", "😂", "😍", "😢", "😮"],

    start(){
        if(Auth.autoLogin()){
            this.showHome();
        }else{
            this.showLogin();
        }
    },

    /*=========================
            LOGIN
    =========================*/

    showLogin(){
        app.innerHTML = `
        <div class="login">
            <div class="logo">😍</div>
            <div class="title">Family</div>
            <div class="subtitle">Семейный мессенджер</div>

            <input id="login" placeholder="Логин" autocomplete="username">
            <input id="password" type="password" placeholder="Пароль" autocomplete="current-password">

            <button class="primary" onclick="App.login()">Войти</button>
        </div>`;

        const input = document.getElementById("password");
        input?.addEventListener("keydown", event => {
            if(event.key === "Enter"){
                event.preventDefault();
                this.login();
            }
        });
    },

    login(){
        const login = document.getElementById("login")?.value.trim();
        const password = document.getElementById("password")?.value.trim();

        if(!login || !password){
            alert("Введите логин и пароль");
            return;
        }

        if(Auth.login(login, password)){
            this.showHome();
        }else{
            alert("Неверный логин или пароль");
        }
    },

    logout(){
        Auth.logout();
        this.showLogin();
    },

    /*=========================
            HOME
    =========================*/

    showHome(){
        const user = Auth.currentUser;

        if(!user){
            this.showLogin();
            return;
        }

        const privateCount = Storage.getUsers()
            .filter(item => item.id !== user.id).length;

        app.innerHTML = `
        <div class="page">
            <div class="header">
                <h1>😍 Family</h1>
                <div>${this.escapeHtml(user.name)}</div>
            </div>

            <div class="content">
                <div class="card" onclick="App.openGlobalChat()">
                    <strong>💬 Семья</strong>
                    <br><br>
                    <small>Общение всей семьи ❤️</small>
                </div>

                <div class="card" onclick="App.openUsers()">
                    <strong>👤 Личные сообщения</strong>
                    <br><br>
                    <small>${privateCount} членов семьи</small>
                </div>

                ${Auth.isAdmin() ? `
                <div class="card" onclick="App.openAdmin()">
                    <strong>👑 Пользователи</strong>
                    <br><br>
                    <small>${Storage.getUsers().length} пользователей</small>
                </div>` : ""}

                <div class="card" onclick="App.showSettings()">
                    <strong>⚙️ Настройки</strong>
                </div>

                <div class="card" onclick="App.logout()">
                    🚪 Выйти
                </div>
            </div>
        </div>`;
    },

    /*=========================
            ADMIN / USERS
    =========================*/

    openAdmin(){
        if(!Auth.isAdmin()){
            alert("Недостаточно прав");
            return;
        }

        const users = Storage.getUsers();

        let html = `
        <div class="page">
            <div class="header">
                <button onclick="App.showHome()">←</button>
                <h1>👑 Пользователи</h1>
            </div>
            <div class="content">`;

        users.forEach(user => {
            const avatar = user.gender === "female" ? "👩" : "👨";
            const role = user.role === "admin" ? "Администратор" : "Пользователь";
            const current = Auth.currentUser?.id === user.id;

            html += `
            <div class="card">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <div>
                        <div style="font-size:20px;font-weight:700;">
                            ${avatar} ${this.escapeHtml(user.name)}
                        </div>
                        <small>@${this.escapeHtml(user.login)} · ${role}</small>
                    </div>
                    <div style="display:flex;gap:6px;">
                        <button onclick="App.editUser(${user.id})">✏️</button>
                        ${current ? "" : `<button onclick="App.removeUser(${user.id})">🗑️</button>`}
                    </div>
                </div>
            </div>`;
        });

        html += `
                <div class="card" onclick="App.showCreateUser()">
                    ➕ Добавить пользователя
                </div>
            </div>
        </div>`;

        app.innerHTML = html;
    },

    showCreateUser(){
        if(!Auth.isAdmin()) return;

        app.innerHTML = `
        <div class="page">
            <div class="header">
                <button onclick="App.openAdmin()">←</button>
                <h1>➕ Пользователь</h1>
            </div>
            <div class="content">
                <div class="card">
                    <input id="newUserName" placeholder="Имя">
                    <input id="newUserLogin" placeholder="Логин" autocomplete="off">
                    <input id="newUserPassword" type="password" placeholder="Пароль" autocomplete="new-password">

                    <p><strong>Пол</strong></p>
                    <label><input type="radio" name="gender" value="male" checked> 👨 Мужчина</label><br>
                    <label><input type="radio" name="gender" value="female"> 👩 Женщина</label>
                    <br><br>
                    <button class="primary" onclick="App.createUser()">Создать</button>
                </div>
            </div>
        </div>`;
    },

    createUser(){
        const name = document.getElementById("newUserName")?.value.trim();
        const login = document.getElementById("newUserLogin")?.value.trim();
        const password = document.getElementById("newUserPassword")?.value.trim();
        const gender = document.querySelector('input[name="gender"]:checked')?.value || "male";

        const result = Auth.createUser(name, login, password, gender);

        if(!result.success){
            alert(result.error);
            return;
        }

        this.openAdmin();
    },

    editUser(id){
        if(!Auth.isAdmin()) return;

        const user = Auth.getUserById(id);
        if(!user){
            alert("Пользователь не найден");
            return;
        }

        const male = user.gender !== "female";

        app.innerHTML = `
        <div class="page">
            <div class="header">
                <button onclick="App.openAdmin()">←</button>
                <h1>✏️ Пользователь</h1>
            </div>
            <div class="content">
                <div class="card">
                    <input id="editUserName" value="${this.escapeAttribute(user.name)}" placeholder="Имя">
                    <input id="editUserLogin" value="${this.escapeAttribute(user.login)}" placeholder="Логин">
                    <input id="editUserPassword" type="password" placeholder="Новый пароль">

                    <p><strong>Пол</strong></p>
                    <label><input type="radio" name="editGender" value="male" ${male ? "checked" : ""}> 👨 Мужчина</label><br>
                    <label><input type="radio" name="editGender" value="female" ${male ? "" : "checked"}> 👩 Женщина</label>
                    <br><br>
                    <button class="primary" onclick="App.saveUserChanges(${id})">Сохранить</button>
                </div>
            </div>
        </div>`;
    },

    saveUserChanges(id){
        const data = {
            name: document.getElementById("editUserName")?.value.trim(),
            login: document.getElementById("editUserLogin")?.value.trim(),
            gender: document.querySelector('input[name="editGender"]:checked')?.value || "male"
        };

        const password = document.getElementById("editUserPassword")?.value.trim();
        if(password) data.password = password;

        const result = Auth.updateUser(id, data);

        if(!result.success){
            alert(result.error);
            return;
        }

        this.openAdmin();
    },

    removeUser(id){
        if(!Auth.isAdmin()) return;

        const user = Auth.getUserById(id);
        if(!user) return;

        if(!confirm(`Удалить пользователя «${user.name}»?`)) return;

        const result = Auth.deleteUser(id);
        if(!result.success){
            alert(result.error);
            return;
        }

        this.openAdmin();
    },

    /*=========================
            PRIVATE CHATS
    =========================*/

    openUsers(){
        const current = Auth.currentUser;
        if(!current){
            this.showLogin();
            return;
        }

        const users = Storage.getUsers().filter(user => user.id !== current.id);

        let html = `
        <div class="page">
            <div class="header">
                <button onclick="App.showHome()">←</button>
                <h1>👤 Личные</h1>
            </div>
            <div class="content">`;

        if(users.length === 0){
            html += `<div class="card">Пока нет других пользователей.</div>`;
        }

        users.forEach(user => {
            const avatar = user.gender === "female" ? "👩" : "👨";
            const chatId = this.getPrivateChatId(current.id, user.id);
            const messages = Storage.getPrivateChat(chatId);
            const last = messages[messages.length - 1];
            const preview = last ? this.truncate(last.text, 45) : "Начать общение";

            html += `
            <div class="card" onclick="App.openPrivateChat(${user.id})">
                <strong>${avatar} ${this.escapeHtml(user.name)}</strong>
                <br>
                <small>${this.escapeHtml(preview)}</small>
            </div>`;
        });

        html += `</div></div>`;
        app.innerHTML = html;
    },

    openPrivateChat(userId){
        const current = Auth.currentUser;
        const other = Auth.getUserById(userId);

        if(!current || !other || current.id === other.id) return;

        const chatId = this.getPrivateChatId(current.id, other.id);
        const messages = Storage.getPrivateChat(chatId);
        this.currentPrivateChatId = chatId;
        const avatar = other.gender === "female" ? "👩" : "👨";

        let html = `
        <div class="page">
            <div class="header">
                <button onclick="App.openUsers()">←</button>
                <h1>${avatar} ${this.escapeHtml(other.name)}</h1>
            </div>
            <div class="messages" id="privateMessages">`;

        messages.forEach(message => {
            html += this.renderMessage(message, current.id, "private");
        });

        html += `
            </div>
            <div class="footer">
                <input id="privateMessageInput" placeholder="Введите сообщение...">
                <button class="primary" onclick="App.sendPrivateMessage(${other.id})">➤</button>
            </div>
        </div>`;

        app.innerHTML = html;
        this.finishChatInput("privateMessageInput", () => this.sendPrivateMessage(other.id), "privateMessages");
    },

    sendPrivateMessage(otherId){
        const current = Auth.currentUser;
        const other = Auth.getUserById(otherId);
        const input = document.getElementById("privateMessageInput");

        if(!current || !other || !input) return;

        const text = input.value.trim();
        if(!text) return;

        const chatId = this.getPrivateChatId(current.id, other.id);
        const messages = Storage.getPrivateChat(chatId);
        const now = new Date();

        messages.push({
            id: Storage.getNextId(messages),
            authorId: current.id,
            author: current.name,
            text,
            time: this.time(now),
            timestamp: now.getTime(),
            reactions: {}
        });

        Storage.savePrivateChat(chatId, messages);
        this.openPrivateChat(other.id);
    },

    getPrivateChatId(id1, id2){
        return [Number(id1), Number(id2)].sort((a,b) => a-b).join("_");
    },

    /*=========================
            GLOBAL CHAT
    =========================*/

    openGlobalChat(){
        this.currentPrivateChatId = null;
        const messages = Storage.getGlobalMessages();

        let html = `
        <div class="page">
            <div class="header">
                <button onclick="App.showHome()">←</button>
                <h1>💬 Семья ❤️</h1>
            </div>
            <div class="messages" id="messages">`;

        messages.forEach(message => {
            html += this.renderMessage(message, Auth.currentUser.id, "global");
        });

        html += `
            </div>
            <div class="footer">
                <input id="messageInput" placeholder="Введите сообщение...">
                <button class="primary" onclick="App.sendGlobalMessage()">➤</button>
            </div>
        </div>`;

        app.innerHTML = html;
        this.finishChatInput("messageInput", () => this.sendGlobalMessage(), "messages");
    },

    sendGlobalMessage(){
        const input = document.getElementById("messageInput");
        if(!input || !Auth.currentUser) return;

        const text = input.value.trim();
        if(!text) return;

        const messages = Storage.getGlobalMessages();
        const now = new Date();

        messages.push({
            id: Storage.getNextId(messages),
            authorId: Auth.currentUser.id,
            author: Auth.currentUser.name,
            text,
            time: this.time(now),
            timestamp: now.getTime(),
            reactions: {}
        });

        Storage.saveGlobalMessages(messages);
        this.openGlobalChat();
    },

    /*=========================
            REACTIONS
    =========================*/

    toggleGlobalReaction(messageId, emoji){
        const messages = Storage.getGlobalMessages();
        const message = messages.find(item => item.id === messageId);
        if(!message) return;

        this.toggleReaction(message, emoji);
        Storage.saveGlobalMessages(messages);
        this.openGlobalChat();
    },

    togglePrivateReaction(chatId, messageId, emoji){
        const messages = Storage.getPrivateChat(chatId);
        const message = messages.find(item => item.id === messageId);
        if(!message) return;

        this.toggleReaction(message, emoji);
        Storage.savePrivateChat(chatId, messages);

        const parts = chatId.split("_").map(Number);
        const otherId = parts.find(id => id !== Auth.currentUser.id);
        this.openPrivateChat(otherId);
    },

    toggleReaction(message, emoji){
        if(!message.reactions || typeof message.reactions !== "object"){
            message.reactions = {};
        }

        if(!Array.isArray(message.reactions[emoji])){
            message.reactions[emoji] = [];
        }

        const users = message.reactions[emoji];
        const index = users.indexOf(Auth.currentUser.id);

        if(index === -1){
            users.push(Auth.currentUser.id);
        }else{
            users.splice(index, 1);
        }

        if(users.length === 0){
            delete message.reactions[emoji];
        }
    },

    /*=========================
            MESSAGE RENDER
    =========================*/

    renderMessage(message, currentUserId, type){
        const mine =
            message.authorId !== undefined
                ? message.authorId === currentUserId
                : message.author === Auth.currentUser?.name;

        const chatId = type === "private"
            ? this.getPrivateChatIdFromCurrentMessage(message)
            : "";

        const reactions = message.reactions || {};
        let reactionHtml = "";

        this.reactions.forEach(emoji => {
            const users = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
            if(users.length){
                reactionHtml += `
                <button class="reaction" onclick="${
                    type === "global"
                    ? `App.toggleGlobalReaction(${message.id}, '${emoji}')`
                    : `App.togglePrivateReaction('${chatId}', ${message.id}, '${emoji}')`
                }">${emoji} ${users.length}</button>`;
            }
        });

        const reactionButtons = this.reactions.map(emoji => `
            <button class="reaction-add" onclick="${
                type === "global"
                ? `App.toggleGlobalReaction(${message.id}, '${emoji}')`
                : `App.togglePrivateReaction('${chatId}', ${message.id}, '${emoji}')`
            }">${emoji}</button>
        `).join("");

        return `
        <div class="message ${mine ? "me" : "other"}">
            ${mine ? "" : `<div class="author">${this.escapeHtml(message.author || "")}</div>`}
            <div>${this.escapeHtml(message.text)}</div>
            <div class="time">${this.escapeHtml(message.time || "")}</div>
            <div class="reactions">
                ${reactionHtml}
                <span class="reaction-menu">${reactionButtons}</span>
            </div>
        </div>`;
    },

    /*
        The current private chat is known while rendering the page,
        so we store it temporarily for reaction handlers.
    */
    currentPrivateChatId: null,

    getPrivateChatIdFromCurrentMessage(){
        return this.currentPrivateChatId || "";
    },

    finishChatInput(inputId, sendFunction, listId){
        const list = document.getElementById(listId);
        if(list) list.scrollTop = list.scrollHeight;

        const input = document.getElementById(inputId);
        if(!input) return;

        input.focus();
        input.addEventListener("keydown", event => {
            if(event.key === "Enter"){
                event.preventDefault();
                sendFunction();
            }
        });
    },

    /*=========================
            SETTINGS
    =========================*/

    showSettings(){
        const user = Auth.currentUser;
        if(!user) return;

        app.innerHTML = `
        <div class="page">
            <div class="header">
                <button onclick="App.showHome()">←</button>
                <h1>⚙️ Настройки</h1>
            </div>
            <div class="content">
                <div class="card">
                    <strong>${user.gender === "female" ? "👩" : "👨"} ${this.escapeHtml(user.name)}</strong>
                    <br><br>
                    <small>@${this.escapeHtml(user.login)}</small>
                </div>

                <div class="card" onclick="App.showChangePassword()">
                    🔑 Сменить пароль
                </div>
            </div>
        </div>`;
    },

    showChangePassword(){
        app.innerHTML = `
        <div class="page">
            <div class="header">
                <button onclick="App.showSettings()">←</button>
                <h1>🔑 Пароль</h1>
            </div>
            <div class="content">
                <div class="card">
                    <input id="oldPassword" type="password" placeholder="Старый пароль">
                    <input id="newPassword" type="password" placeholder="Новый пароль">
                    <button class="primary" onclick="App.changePassword()">Сохранить</button>
                </div>
            </div>
        </div>`;
    },

    changePassword(){
        const oldPassword = document.getElementById("oldPassword")?.value;
        const newPassword = document.getElementById("newPassword")?.value;

        const result = Auth.changePassword(oldPassword, newPassword);
        if(!result.success){
            alert(result.error);
            return;
        }

        alert("Пароль изменён");
        this.showSettings();
    },

    /*=========================
            HELPERS
    =========================*/

    time(date){
        return date.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit"
        });
    },

    truncate(value, length){
        const text = String(value || "");
        return text.length > length
            ? text.slice(0, length) + "…"
            : text;
    },

    escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    escapeAttribute(value){
        return this.escapeHtml(value);
    }
};

App.start();
