import { getMode, setMode, ensureEmbedder, embed, cosine } from './embed.js';
const DB='aib-kb', STORE='docs';
function open(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,2); r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true}); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

export async function addText(text, title=''){
  const db=await open();
  let vec=null;
  if (getMode()==='vector') { try { vec = await embed(text.slice(0,2000)); } catch {} }
  return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).add({title, text, vec, ts:Date.now()}); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); });
}
export async function list(){
  const db=await open();
  return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readonly'); const rq=tx.objectStore(STORE).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); });
}
export async function search(q){
  const all=await list();
  if (getMode()==='vector') {
    try {
      const qv = await embed(q);
      return all.map(d => ({ d, s: d.vec ? cosine(qv, d.vec) : 0 }))
        .filter(x => x.s > 0.25).sort((a,b)=>b.s-a.s).slice(0,20).map(x=>x.d);
    } catch { /* fall through to text */ }
  }
  const qq=(q||'').toLowerCase();
  return all.filter(d => (d.text||'').toLowerCase().includes(qq) || (d.title||'').toLowerCase().includes(qq)).slice(0,20);
}
export async function clear(){ const db=await open(); return new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
export async function enableVector(onProgress){ setMode('vector'); await ensureEmbedder(onProgress); }
export async function disableVector(){ setMode('text'); }
