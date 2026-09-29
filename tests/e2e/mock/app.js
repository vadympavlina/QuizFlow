const apps=[];export function initializeApp(c){const a={c};apps.push(a);return a}export function getApps(){return apps}
export function getApp(n){const a=apps.find(x=>x.n===n);if(!a)throw new Error("no app");return a}
