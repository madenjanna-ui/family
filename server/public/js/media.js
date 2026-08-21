/* Family v5 — local media vault. Voice messages live on the device after delivery. */
const FAMILY_MEDIA_DB = "FamilyMediaV5";
const FAMILY_MEDIA_STORE = "audio";

const MediaVault = {
  db: null,
  async open(){
    if(this.db) return this.db;
    this.db = await new Promise((resolve,reject)=>{
      const req=indexedDB.open(FAMILY_MEDIA_DB,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(FAMILY_MEDIA_STORE,{keyPath:"id"});
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error("IndexedDB недоступна"));
    });
    return this.db;
  },
  async put(id, blob, mime, duration){
    if(!id || !blob) return;
    const db=await this.open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(FAMILY_MEDIA_STORE,"readwrite");
      tx.objectStore(FAMILY_MEDIA_STORE).put({id,blob,mime,duration,created:Date.now()});
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  },
  async get(id){
    if(!id) return null;
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const req=db.transaction(FAMILY_MEDIA_STORE,"readonly").objectStore(FAMILY_MEDIA_STORE).get(id);
      req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
    });
  },
  async remove(id){
    if(!id) return;
    const db=await this.open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(FAMILY_MEDIA_STORE,"readwrite");
      tx.objectStore(FAMILY_MEDIA_STORE).delete(id);
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
  }
};
