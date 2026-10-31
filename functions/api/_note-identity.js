import {getPublishableSupabaseConfig, getSecretSupabaseConfig} from './_supabase-config.js';
const encoder = new TextEncoder();
const secret = env => String(env.DEV_SESSION_SECRET || env.DEV_PASSWORD || '');
const base64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/=+$/g, '');
async function devKey(env) {
  if (!secret(env)) throw new Error('Developer session configuration missing');
  return crypto.subtle.importKey('raw', encoder.encode(secret(env)), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
export async function createVerifiedDevToken(env, username) {
  const payload = btoa(JSON.stringify({sub:'developer',username,role:'Mode Development',isDeveloper:true,exp:Math.floor(Date.now()/1000)+43200}));
  const signature = await crypto.subtle.sign('HMAC', await devKey(env), encoder.encode(payload));
  return `${payload}.${base64(new Uint8Array(signature))}`;
}
async function developerIdentity(token, env) {
  if (String(env.DEV_LOGIN_ENABLED).toLowerCase() !== 'true' || !secret(env)) return null;
  try {
    const parts=token.split('.'); if(parts.length!==2)return null;
    const payload=JSON.parse(atob(parts[0]));
    if(payload.sub!=='developer'||payload.isDeveloper!==true||payload.username!==env.DEV_USERNAME||!Number.isFinite(payload.exp)||payload.exp<=Date.now()/1000)return null;
    const signature=Uint8Array.from(atob(parts[1]),char=>char.charCodeAt(0));
    if(!await crypto.subtle.verify('HMAC',await devKey(env),signature,encoder.encode(parts[0])))return null;
    return {id:`developer:${payload.username}`,name:'Developer',role:'Mode Development'};
  } catch {return null;}
}
export async function getNoteIdentity(request, env) {
  const auth=String(request.headers.get('authorization')||'');
  if(!auth.toLowerCase().startsWith('bearer '))return null;
  const token=auth.slice(7).trim();if(!token)return null;
  const developer=await developerIdentity(token,env);if(developer)return developer;
  const config=getPublishableSupabaseConfig(env);
  const response=await fetch(`${config.url}/auth/v1/user`,{headers:{apikey:config.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
  if(response.status===429||response.status>=500){const error=Error('Identity lookup unavailable');error.status=response.status;throw error;}
  if(!response.ok)return null;
  const user=await response.json();if(!user?.id)return null;
  const server=getSecretSupabaseConfig(env);
  const params=new URLSearchParams({select:'full_name,username,role',id:`eq.${user.id}`,limit:'1'});
  const profileResponse=await fetch(`${server.url}/rest/v1/users?${params}`,{headers:{apikey:server.key,Authorization:`Bearer ${server.key}`},signal:AbortSignal.timeout(10000)});
  if(!profileResponse.ok){const error=Error('Profile read failed');error.status=profileResponse.status;throw error;}
  const profiles=await profileResponse.json(),profile=profiles[0]||{};
  return {id:user.id,name:String(profile.full_name||profile.username||user.email||'User'),role:String(profile.role||'User')};
}
