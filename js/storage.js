/*
==========================================
        Family😍 Messenger
        storage.js
==========================================
*/

const Storage = {

    key: "FamilyMessenger",
    database: null,

    createDatabase(){
        return {
            users: [],
            globalChat: [],
            privateChats: {},
            settings: {},
            version: "0.3.0"
        };
    },

    load(){
        const json = localStorage.getItem(this.key);

        if(!json){
            this.database = this.createDatabase();
            this.save();
            return;
        }

        try{
            this.database = JSON.parse(json);

            if(!this.database || typeof this.database !== "object"){
                throw new Error("Invalid database");
            }

            this.database.users ||= [];
            this.database.globalChat ||= [];
            this.database.privateChats ||= {};
            this.database.settings ||= {};
            this.database.version ||= "0.3.0";
        }
        catch(error){
            console.error("Family storage error:", error);
            this.database = this.createDatabase();
            this.save();
        }
    },

    save(){
        localStorage.setItem(this.key, JSON.stringify(this.database));
    },

    reset(){
        this.database = this.createDatabase();
        this.save();
    },

    getUsers(){
        return this.database.users;
    },

    saveUsers(users){
        this.database.users = users;
        this.save();
    },

    getGlobalMessages(){
        return this.database.globalChat;
    },

    saveGlobalMessages(messages){
        this.database.globalChat = messages;
        this.save();
    },

    getPrivateChat(chatId){
        if(!this.database.privateChats[chatId]){
            this.database.privateChats[chatId] = [];
            this.save();
        }
        return this.database.privateChats[chatId];
    },

    savePrivateChat(chatId, messages){
        this.database.privateChats[chatId] = messages;
        this.save();
    },

    getSettings(){
        return this.database.settings;
    },

    saveSettings(settings){
        this.database.settings = settings;
        this.save();
    },

    getNextId(collection){
        if(!Array.isArray(collection) || collection.length === 0){
            return 1;
        }

        const ids = collection
            .map(item => Number(item.id))
            .filter(Number.isFinite);

        return ids.length ? Math.max(...ids) + 1 : 1;
    }
};

Storage.load();
