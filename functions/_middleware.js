const PUBLIC_HOST='gotoliving.id';

// Login is the only indexable page. This is a crawler directive; API/session
// authorization continues to protect inventory data independently.
export async function onRequest(context){
 const response=await context.next();
 const url=new URL(context.request.url);
 const publicLogin=url.hostname===PUBLIC_HOST&&url.pathname==='/'&&!url.search&&response.status===200&&response.headers.get('Content-Type')?.includes('text/html');
 const headers=new Headers(response.headers);
 headers.set('X-Robots-Tag',publicLogin?'index, follow':'noindex, nofollow, noarchive');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
