const Auth = {
    currentUser: null,

    async autoLogin() {
        if (!API.token) return false;
        try {
            this.currentUser = await API.me();
            return true;
        } catch {
            this.currentUser = null;
            await API.logout();
            return false;
        }
    },

    async login(login,password) {
        try {
            this.currentUser = await API.login(login,password);
            return true;
        } catch {
            this.currentUser = null;
            return false;
        }
    },

    async logout() {
        await API.logout();
        this.currentUser = null;
    },

    isAdmin() {
        return !!this.currentUser && this.currentUser.role === "admin";
    },

    async getUsers() { return API.users(); },
    async getUserById(id) {
        const users = await API.users();
        return users.find(u => Number(u.id) === Number(id)) || null;
    },
    async createUser(name,login,password,gender) {
        try {
            const user = await API.createUser({name,login,password,gender});
            return {success:true,user};
        } catch(e) { return {success:false,error:e.message}; }
    },
    async updateUser(id,data) {
        try {
            const user = await API.updateUser(id,data);
            if (this.currentUser && Number(this.currentUser.id) === Number(id)) this.currentUser = user;
            return {success:true,user};
        } catch(e) { return {success:false,error:e.message}; }
    },
    async deleteUser(id) {
        try { await API.deleteUser(id); return {success:true}; }
        catch(e) { return {success:false,error:e.message}; }
    }
};