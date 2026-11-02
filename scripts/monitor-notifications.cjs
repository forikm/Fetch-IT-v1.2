// Run from an external scheduler every minute, or --watch from a supervised
// worker. No provider keys are logged and there is no unauthenticated sweep.
const base=process.env.CUSTOMER_URL,secret=process.env.CRON_SECRET;
if(!base||!secret)throw Error('Configure CUSTOMER_URL and CRON_SECRET.');
const origin=new URL(base);if(origin.origin!==base||origin.protocol!=='https:'&&origin.hostname!=='localhost')throw Error('Use an exact HTTPS origin, or localhost for testing.');
let running=false;
async function check(){
 if(running)return;running=true;
 try{const response=await fetch(base+'/api/maintenance/notifications',{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Monitoring endpoint returned '+response.status);console.log(JSON.stringify({operation:'staff-notification-monitor',status:'ok',at:new Date().toISOString()}));}
 catch(error){console.error(JSON.stringify({operation:'staff-notification-monitor',status:'unavailable',at:new Date().toISOString(),message:error.message}));process.exitCode=1;}
 finally{running=false;}
}
void check();if(process.argv.includes('--watch'))setInterval(()=>void check(),60000);
