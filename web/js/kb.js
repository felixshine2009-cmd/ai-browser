const DB='aib-kb', STORE='docs';
function open(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id',autoIncrement:true}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
export async function addText(text, title=''){
  const db=await open();
  return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).add({title, text, ts:Date.now()}); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); });
}
export async function list(){
  const db=await open();
  return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const rq=tx.objectStore(STORE).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); });
}
export async function search(q){
  const all=await list(); const qq=(q||'').toLowerCase();
  return all.filter(d => (d.text||'').toLowerCase().includes(qq) || (d.title||'').toLowerCase().includes(qq)).slice(0,20);
}
export async function clear(){ const db=await open(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
