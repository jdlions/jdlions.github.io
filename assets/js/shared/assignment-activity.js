import {api} from '../services/api-client.js';
let lastSent=0;
// No heartbeat or visibility polling. Report only when an assigned list is rendered.
export function reportAssignmentView(hasAssignments){
 if(!hasAssignments||document.visibilityState!=='visible'||Date.now()-lastSent<300000)return;
 lastSent=Date.now();void api('/api/activity/assignment-view',{method:'POST'}).catch(()=>{});
}
