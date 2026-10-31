// Only use for reads or idempotent audit writes, never warehouse mutations.
export function temporaryAuditFailure(error){return error?.name==='TimeoutError'||error?.name==='AbortError'||error instanceof TypeError||[408,429,502,503,504].includes(error?.status)||error?.status>=500;}
export async function retryAudit(task,{pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=2}={}){for(let attempt=0;;attempt++){try{return await task();}catch(error){if(attempt+1>=attempts||!temporaryAuditFailure(error))throw error;await pause(250*(attempt+1));}}}
