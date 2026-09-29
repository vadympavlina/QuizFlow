const KEY='mockdb';
const load=()=>JSON.parse(localStorage.getItem(KEY)||'{}');
let tree=load();
const listeners=new Set();
const parts=p=>String(p||'').split('/').filter(Boolean);
function getAt(t,path){let n=t;for(const k of parts(path)){if(n==null||typeof n!=='object')return null;n=n[k];}return n===undefined?null:n}
function prune(n){if(n&&typeof n==='object'){for(const k of Object.keys(n)){n[k]=prune(n[k]);if(n[k]===null||n[k]===undefined)delete n[k];}if(Object.keys(n).length===0)return null}return n}
function resolveSv(v){if(v&&typeof v==='object'){if(v['.sv']==='timestamp')return Date.now();const o=Array.isArray(v)?[]:{};for(const k in v)o[k]=resolveSv(v[k]);return o}return v}
function setAt(path,val){const ps=parts(path);if(val&&typeof val==='object'&&'.inc' in val)val=(Number(getAt(tree,path))||0)+val['.inc'];val=resolveSv(val===undefined?null:JSON.parse(JSON.stringify(val??null)));if(!ps.length){tree=val||{};return}
 let n=tree;for(let i=0;i<ps.length-1;i++){if(n[ps[i]]==null||typeof n[ps[i]]!=='object')n[ps[i]]={};n=n[ps[i]]}n[ps.at(-1)]=val;}
function commit(){tree=prune(tree)||{};localStorage.setItem(KEY,JSON.stringify(tree));fire()}
function readQ(r){let v=getAt(tree,r.path);if(r.ltl&&v&&typeof v==='object'){const ks=Object.keys(v).sort().slice(-r.ltl);const o={};ks.forEach(k=>o[k]=v[k]);v=o}return v}
function fire(){for(const l of listeners){const v=l.path.startsWith('.info')?(l.path.endsWith('connected')?true:0):readQ(l);const j=JSON.stringify(v);if(j!==l.last){l.last=j;l.cb(snap(v))}}}
window.addEventListener('storage',e=>{if(e.key===KEY){tree=load();fire()}});
function snap(v){v=v==null?null:JSON.parse(JSON.stringify(v));return{val:()=>v,exists:()=>v!==null}}
export function getDatabase(){return{}}
export function ref(db,path=''){const p=String(path);return{path:p,key:p.split('/').filter(Boolean).pop()||null}}
const _log=(k,p)=>{(globalThis.__dblog=globalThis.__dblog||[]).push(k+':'+p)};
export async function get(r){_log('get',r.path);await 0;tree=load();return snap(readQ(r))}
export async function set(r,v){ if(localStorage.getItem('mockFailSet')===r.path.split('/')[0]) throw Object.assign(new Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'}); tree=load();setAt(r.path,v);commit()}
export async function update(r,obj){if(localStorage.getItem('mockFailUpdate'))throw Object.assign(new Error('network'),{code:'NETWORK'});tree=load();for(const[k,v]of Object.entries(obj)){setAt((r.path?r.path+'/':'')+k,v)}commit()}
export async function remove(r){tree=load();setAt(r.path,null);commit()}
export function onValue(r,cb){_log('on',r.path);const l={path:r.path,ltl:r.ltl,cb,last:undefined};listeners.add(l);setTimeout(()=>{if(!listeners.has(l))return;const v=l.path.startsWith('.info')?(l.path.endsWith('connected')?true:0):readQ(l);l.last=JSON.stringify(v);cb(snap(v))},5);return()=>listeners.delete(l)}
export function serverTimestamp(){return{'.sv':'timestamp'}}
export function off(){}
export function push(r,v){const key='k'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);const nr={path:r.path+'/'+key,key};if(v!==undefined){tree=load();setAt(nr.path,v);commit()}return nr}
export function onDisconnect(r){return{set:async()=>{},remove:async()=>{}}}

export async function runTransaction(r,fn){tree=load();const nv=fn(getAt(tree,r.path));setAt(r.path,nv);commit();_log('tx',r.path);return{committed:true,snapshot:snap(nv)}}

export function limitToLast(n){return{ltl:n}}
export function query(r,...c){const o={...r};c.forEach(x=>Object.assign(o,x));return o}

export function increment(n){return{'.inc':n}}
