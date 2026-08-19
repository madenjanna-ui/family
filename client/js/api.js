const FAMILY_API_BASE = (window.FAMILY_CONFIG?.API_BASE || "").replace(/\/$/, "");

const API = {
    token: localStorage.getItem("FamilyToken") || "",

    async request(path, options = {}) {
        const headers = {"Content-Type":"application/json", ...(options.headers || {})};
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        const res = await fetch(`${FAMILY_API_BASE}${path}`, {...options, headers});
        let data = {};
        try { data = await res.json(); } catch {}
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    },

    async login(login, password) {
        const data = await this.request("/api/login", {method:"POST",body:JSON.stringify({login,password})});
        this.token = data.token;
        localStorage.setItem("FamilyToken", this.token);
        return data.user;
    },
    async logout() {
        try { await this.request("/api/logout",{method:"POST"}); } catch {}
        this.token = "";
        localStorage.removeItem("FamilyToken");
    },
    async me() { return (await this.request("/api/me")).user; },
    async updateMe(data) { return (await this.request("/api/me",{method:"PUT",body:JSON.stringify(data)})).user; },
    async users() { return (await this.request("/api/users")).users; },
    async unread() { return this.request("/api/unread"); },
    async markRead(scope,key) { return this.request(`/api/read/${scope}/${encodeURIComponent(key)}`,{method:"POST"}); },
    async createUser(data) { return (await this.request("/api/users",{method:"POST",body:JSON.stringify(data)})).user; },
    async updateUser(id,data) { return (await this.request(`/api/users/${id}`,{method:"PUT",body:JSON.stringify(data)})).user; },
    async deleteUser(id) { return this.request(`/api/users/${id}`,{method:"DELETE"}); },
    async globalMessages() { return (await this.request("/api/messages/global")).messages; },
    async sendGlobal(text,replyTo=null) { return (await this.request("/api/messages/global",{method:"POST",body:JSON.stringify({text,replyTo})})).message; },
    async sendGlobalAudio(audio,replyTo=null) { return (await this.request("/api/messages/global",{method:"POST",body:JSON.stringify({audio,replyTo})})).message; },
    async privateMessages(id) { return (await this.request(`/api/messages/private/${id}`)).messages; },
    async sendPrivate(id,text,replyTo=null) { return (await this.request(`/api/messages/private/${id}`,{method:"POST",body:JSON.stringify({text,replyTo})})).message; },
    async sendPrivateAudio(id,audio,replyTo=null) { return (await this.request(`/api/messages/private/${id}`,{method:"POST",body:JSON.stringify({audio,replyTo})})).message; },
    async audioAck(scope,key,messageId,audioId) {
        return this.request(`/api/audio/ack`,{method:"POST",body:JSON.stringify({scope,key,messageId,audioId})});
    },
    async react(scope,key,messageId,emoji) {
        return (await this.request(`/api/messages/${scope}/${encodeURIComponent(key)}/${messageId}/reaction`,{method:"POST",body:JSON.stringify({emoji})})).reactions;
    },
    async editMessage(scope,key,messageId,text) { return (await this.request(`/api/messages/${scope}/${encodeURIComponent(key)}/${messageId}`,{method:"PUT",body:JSON.stringify({text})})).message; },
    async deleteMessage(scope,key,messageId) { return this.request(`/api/messages/${scope}/${encodeURIComponent(key)}/${messageId}`,{method:"DELETE"}); },
    async pushPublicKey() { return (await this.request("/api/notifications/public-key")).publicKey; },
    async pushSubscribe(subscription) { return this.request("/api/notifications/subscribe",{method:"POST",body:JSON.stringify({subscription})}); },
    async notificationStatus() { return this.request("/api/notifications/status"); },
    async notificationTest() { return this.request("/api/notifications/test",{method:"POST",body:"{}"}); },
    async testNotification() { return this.notificationTest(); },
    async notificationDiagnostics() {
        const status = await this.notificationStatus();
        return { vapidConfigured: true, enabled: !!status.enabled };
    },
    async pushUnsubscribe(endpoint) { return this.request("/api/push/unsubscribe",{method:"POST",body:JSON.stringify({endpoint})}); },

    connectWS(onMessage) {
        const base = FAMILY_API_BASE || location.origin;
        const wsUrl = base.replace(/^http:/,"ws:").replace(/^https:/,"wss:") + `/ws?token=${encodeURIComponent(this.token)}`;
        const ws = new WebSocket(wsUrl);
        ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch {} };
        ws.onclose = () => { if (this.token) setTimeout(() => this.connectWS(onMessage), 2000); };
        return ws;
    }
};
