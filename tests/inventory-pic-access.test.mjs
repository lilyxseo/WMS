import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isInventoryPicRole} from '../assets/js/utils/role-access.js';
import {hasInventoryDeveloperAccess} from '../functions/api/_authz.js';
import {onRequestGet} from '../functions/api/activity-log.js';
const env={SUPABASE_URL:'https://project.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test'};
const request=()=>new Request('https://app.test/api/activity-log',{headers:{Authorization:'Bearer valid-supabase-session'}});
test('only inventory PIC aliases receive elevated permission',()=>{for(const role of ['PIC Inventory','Inventory PIC','PIC_INVENTORY','pic-inventory',' PIC   Inventory '])assert.equal(isInventoryPicRole(role),true);for(const role of ['Inventory','Staff Inventory','PIC Warehouse','PIC Inventory Assistant','','Developer'])assert.equal(isInventoryPicRole(role),false);});
function mock(t,{role='PIC Inventory',authenticated=true,metadataRole='Staff'}={}){const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const calls=[];globalThis.fetch=async(input)=>{const url=String(input);calls.push(url);if(url.includes('/auth/v1/user'))return Response.json({id:'inventory-user',email:'inventory@example.com',user_metadata:{role:metadataRole}},{status:authenticated?200:401});if(url.includes('/rest/v1/users'))return Response.json([{id:'inventory-user',role}]);return Response.json([]);};return calls;}
test('verified inventory profile has developer feature access',async t=>{mock(t);assert.equal(await hasInventoryDeveloperAccess(request(),env),true);});
test('metadata cannot elevate a staff profile into inventory PIC',async t=>{mock(t,{role:'Staff',metadataRole:'PIC Inventory'});assert.equal(await hasInventoryDeveloperAccess(request(),env),false);});
test('invalid sessions cannot use a claimed inventory profile',async t=>{const calls=mock(t,{authenticated:false});assert.equal(await hasInventoryDeveloperAccess(request(),env),false);assert.equal(calls.some(url=>url.includes('/rest/v1/users')),false);});
test('inventory PIC can read activity logs through the server',async t=>{mock(t);const response=await onRequestGet({request:request(),env});assert.equal(response.status,200);assert.equal((await response.json()).success,true);});
test('other roles remain denied access to activity logs',async t=>{for(const role of ['Inventory','PIC Warehouse','Staff']){mock(t,{role});assert.equal((await onRequestGet({request:request(),env})).status,403);}});
test('sidebar, direct routes and click guards use the same permission without changing developer identity',async()=>{const source=await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');assert.match(source,/isInventoryPicRole\(getCurrentUserRole\(\)\)/);assert.match(source,/btn.dataset.route==="\/activity-log"&&!isActivityLogAllowed\(\)/);const developer=source.slice(source.indexOf('function isDeveloperUser()'),source.indexOf('function isDeveloperRoleLike()'));assert.doesNotMatch(developer,/isInventoryPicRole/);});
