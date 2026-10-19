import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest,normalizeProfilePhone} from '../functions/api/profile.js';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
async function run(method,body,options={}){
 const old=globalThis.fetch,writes=[];let profile={id:'owner',full_name:'User',username:'user',email:'user@example.com',role:'Staff',phone_number:null,password:'never-return'};
 globalThis.fetch=async(url,init={})=>{
  if(url.includes('/auth/v1/user'))return Response.json({id:'owner',email:'user@example.com'});
  const params=new URL(url).searchParams;
  if(params.get('id')==='neq.owner')return Response.json(options.duplicate?[{id:'other'}]:[]);
  assert.equal(params.get('id'),'eq.owner');
  if(init.method==='PATCH'){const patch=JSON.parse(init.body);writes.push(patch);profile={...profile,...patch};}
  return Response.json([profile]);
 };
 try{return {response:await onRequest({env,request:new Request('https://test/api/profile',{method,headers:{Authorization:'Bearer test-user','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}),writes};}finally{globalThis.fetch=old;}
}
test('profile returns only safe personal fields from the authenticated account',async()=>{
 const {response}=await run('GET');assert.equal(response.status,200);const data=await response.json();assert.equal(data.profile.id,'owner');assert.equal(data.profile.phoneAvailable,true);assert.equal(data.profile.password,undefined);assert.equal(data.profile.phone_number,undefined);assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('staff can update own name and WhatsApp, normalized for bot matching',async()=>{
 const {response,writes}=await run('PATCH',{full_name:'New Name',username:'new-user',phone:'0812-3456-7890'});assert.equal(response.status,200);assert.deepEqual(writes,[{full_name:'New Name',username:'new-user',phone_number:'6281234567890'}]);
});
test('profile rejects role elevation, another account ID and email updates',async()=>{
 for(const field of ['role','id','email','isDeveloper']){const {response,writes}=await run('PATCH',{[field]:'changed'});assert.equal(response.status,400);assert.equal(writes.length,0);}
});
test('duplicate WhatsApp and invalid phones are rejected without writes',async()=>{
 const duplicate=await run('PATCH',{phone:'6281234567890'},{duplicate:true});assert.equal(duplicate.response.status,409);assert.equal(duplicate.writes.length,0);
 for(const phone of ['abc','123','6281234567890 ext 1']){const result=await run('PATCH',{phone});assert.equal(result.response.status,400);assert.equal(result.writes.length,0);}
});
test('clearing WhatsApp removes the personal number',async()=>{
 const {response,writes}=await run('PATCH',{phone:''});assert.equal(response.status,200);assert.deepEqual(writes,[{phone_number:null}]);
 assert.equal(normalizeProfilePhone('+62 812 3456 7890'),'6281234567890');
});
test('anonymous profile request is refused',async()=>{
 const response=await onRequest({env,request:new Request('https://test/api/profile')});assert.equal(response.status,401);
});
