const _auth={currentUser:null};
export function getAuth(){return _auth}
export function onAuthStateChanged(a,cb){const uid=localStorage.getItem('mockUid');const u=uid?{uid,getIdToken:async()=>'mock-token-'+uid}:null;_auth.currentUser=u;setTimeout(()=>cb(u),0);return()=>{}}
export async function signOut(){ localStorage.removeItem('mockUid'); _log('signOut',1); }
export async function createUserWithEmailAndPassword(a,email,pass){ if(email==='taken@x.ua') throw _err('auth/email-already-in-use'); const uid='new'+Date.now()%1000; localStorage.setItem('mockUid',uid); _log('create',[email,globalThis.__persist,uid]); return {user:{uid,email}}; }
export async function deleteUser(u){ _log('delete',u.uid); localStorage.removeItem('mockUid'); }
export async function updateProfile(u,p){ _log('profile',p.displayName); }
export async function sendPasswordResetEmail(a,e,s){ _log("reset",[e,s&&s.url]); if(e==="limit@x.ua") throw Object.assign(new Error("x"),{code:"auth/too-many-requests"}); }
export async function signInWithEmailAndPassword(a,email,pass){ const acc=JSON.parse(localStorage.getItem('mockAccounts')||'null'); if(!acc) return {user:{uid:localStorage.getItem('mockUid')}}; const u=acc[email]; if(email==='rate@x.ua') throw _err('auth/too-many-requests'); if(!u||u.pass!==pass) throw _err('auth/invalid-credential'); localStorage.setItem('mockUid',u.uid); _log('signin',[email,globalThis.__persist]); return {user:{uid:u.uid,email}}; }
export const browserLocalPersistence='local', browserSessionPersistence='session';
export async function setPersistence(a,p){ globalThis.__persist=p; }
const _log=(k,v)=>{const a=JSON.parse(localStorage.getItem('authlog')||'[]');a.push([k,v]);localStorage.setItem('authlog',JSON.stringify(a))};
const _err=c=>Object.assign(new Error(c),{code:c});
export async function verifyPasswordResetCode(a,c){ if(c==='good')return 'teacher@school.ua'; throw _err(c==='old'?'auth/expired-action-code':'auth/invalid-action-code'); }
export async function confirmPasswordReset(a,c,p){ _log('confirm',[c,p]); if(c!=='good')throw _err('auth/invalid-action-code'); }
export async function applyActionCode(a,c){ _log('apply',c); if(c!=='good')throw _err('auth/invalid-action-code'); }
export async function checkActionCode(a,c){ if(c!=='good')throw _err('auth/invalid-action-code'); return {data:{email:'old@school.ua'}}; }
