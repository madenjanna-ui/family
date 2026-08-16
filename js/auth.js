/*
==========================================
        Family😍 Messenger
        auth.js
==========================================
*/

const Auth = {

    currentUser: null,

    init(){
        const users = Storage.getUsers();

        if(users.length === 0){
            users.push({
                id: 1,
                name: "Денис",
                login: "admin",
                password: "admin",
                gender: "male",
                avatar: "",
                role: "admin"
            });

            Storage.saveUsers(users);
        }
    },

    login(login, password){
        login = String(login || "").trim().toLowerCase();
        password = String(password || "").trim();

        const user = Storage.getUsers().find(user =>
            user.login === login && user.password === password
        );

        if(!user) return false;

        this.currentUser = user;
        this.saveSession();
        return true;
    },

    autoLogin(){
        const session = localStorage.getItem("FamilySession");
        if(!session) return false;

        try{
            const savedUser = JSON.parse(session);
            const user = Storage.getUsers().find(item => item.id === savedUser.id);

            if(!user){
                localStorage.removeItem("FamilySession");
                return false;
            }

            this.currentUser = user;
            return true;
        }
        catch(error){
            localStorage.removeItem("FamilySession");
            this.currentUser = null;
            return false;
        }
    },

    saveSession(){
        if(!this.currentUser){
            localStorage.removeItem("FamilySession");
            return;
        }

        localStorage.setItem("FamilySession", JSON.stringify(this.currentUser));
    },

    logout(){
        this.currentUser = null;
        localStorage.removeItem("FamilySession");
    },

    isAdmin(){
        return !!this.currentUser && this.currentUser.role === "admin";
    },

    getUserById(id){
        return Storage.getUsers().find(user => user.id === id) || null;
    },

    getUserByLogin(login){
        login = String(login || "").trim().toLowerCase();
        return Storage.getUsers().find(user => user.login === login) || null;
    },

    loginExists(login){
        return !!this.getUserByLogin(login);
    },

    createUser(name, login, password, gender){
        if(!this.isAdmin()) return {success:false, error:"Недостаточно прав"};

        const users = Storage.getUsers();

        if(users.length >= 4){
            return {success:false, error:"В Family пока можно добавить максимум 4 пользователей"};
        }

        name = String(name || "").trim();
        login = String(login || "").trim().toLowerCase();
        password = String(password || "").trim();
        gender = gender === "female" ? "female" : "male";

        if(!name) return {success:false, error:"Введите имя"};
        if(!login) return {success:false, error:"Введите логин"};
        if(!password) return {success:false, error:"Введите пароль"};
        if(this.loginExists(login)) return {success:false, error:"Такой логин уже существует"};

        const newUser = {
            id: Storage.getNextId(Storage.getUsers()),
            name,
            login,
            password,
            gender,
            avatar: "",
            role: "user"
        };

        users.push(newUser);
        Storage.saveUsers(users);

        return {success:true, user:newUser};
    },

    updateUser(id, data){
        if(!this.isAdmin()) return {success:false, error:"Недостаточно прав"};

        const users = Storage.getUsers();
        const user = users.find(item => item.id === id);
        if(!user) return {success:false, error:"Пользователь не найден"};

        if(data.name !== undefined){
            const name = String(data.name).trim();
            if(!name) return {success:false, error:"Имя не может быть пустым"};
            user.name = name;
        }

        if(data.login !== undefined){
            const login = String(data.login).trim().toLowerCase();
            if(!login) return {success:false, error:"Логин не может быть пустым"};

            if(users.some(item => item.login === login && item.id !== id)){
                return {success:false, error:"Такой логин уже существует"};
            }

            user.login = login;
        }

        if(data.password !== undefined && String(data.password).trim() !== ""){
            user.password = String(data.password).trim();
        }

        if(data.gender !== undefined){
            user.gender = data.gender === "female" ? "female" : "male";
        }

        if(data.avatar !== undefined){
            user.avatar = String(data.avatar || "");
        }

        Storage.saveUsers(users);

        if(this.currentUser && this.currentUser.id === id){
            this.currentUser = user;
            this.saveSession();
        }

        return {success:true, user};
    },

    deleteUser(id){
        if(!this.isAdmin()) return {success:false, error:"Недостаточно прав"};

        if(this.currentUser && this.currentUser.id === id){
            return {success:false, error:"Нельзя удалить текущего администратора"};
        }

        const users = Storage.getUsers();
        const index = users.findIndex(user => user.id === id);
        if(index === -1) return {success:false, error:"Пользователь не найден"};

        users.splice(index, 1);
        Storage.saveUsers(users);
        return {success:true};
    },

    changePassword(oldPassword, newPassword){
        if(!this.currentUser){
            return {success:false, error:"Пользователь не авторизован"};
        }

        if(this.currentUser.password !== oldPassword){
            return {success:false, error:"Старый пароль указан неверно"};
        }

        newPassword = String(newPassword || "").trim();
        if(!newPassword){
            return {success:false, error:"Новый пароль не может быть пустым"};
        }

        return this.updateUser(this.currentUser.id, {password:newPassword});
    }
};

Auth.init();
