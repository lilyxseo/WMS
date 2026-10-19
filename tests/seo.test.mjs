import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,cp,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {onRequest} from '../functions/_middleware.js';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('only the canonical public login is indexable; private routes, queries and previews are noindex',async()=>{
 for(const [url,indexable] of [['https://gotoliving.id/',true],['https://gotoliving.id/sku/secret',false],['https://gotoliving.id/sheet-input',false],['https://gotoliving.id/?code=oauth',false],['https://preview.wms.pages.dev/',false],['https://wms-duj.pages.dev/',false],['https://gotoliving.id/api/stock-entry',false]]){
  const response=await onRequest({request:new Request(url),next:async()=>new Response('unchanged',{headers:{'Content-Type':'text/html','Cache-Control':'private, no-store','Set-Cookie':'session=retained; HttpOnly'}})});
  assert.equal(response.headers.get('X-Robots-Tag'),indexable?'index, follow':'noindex, nofollow, noarchive');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Set-Cookie'),/session=retained/);assert.equal(await response.text(),'unchanged');
 }
 const failed=await onRequest({request:new Request('https://gotoliving.id/'),next:async()=>new Response('error',{status:503,headers:{'Content-Type':'text/html'}})});assert.equal(failed.status,503);assert.match(failed.headers.get('X-Robots-Tag'),/noindex/);
});
test('sitemap exposes only the login; robots permits reading private-page noindex headers',async()=>{
 const sitemap=await read('sitemap.xml'),robots=await read('robots.txt'),routes=JSON.parse(await read('_routes.json'));
 assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match=>match[1]),['https://gotoliving.id/']);assert.match(robots,/Sitemap: https:\/\/gotoliving.id\/sitemap.xml/);assert.match(robots,/Disallow: \/api\//);assert.doesNotMatch(robots,/Disallow: \/\s*$/m);assert.deepEqual(routes.include,['/*']);assert.ok(!routes.exclude.includes('/api/*'));
});
test('public metadata and schema describe login without inventory content or fabricated ratings',async()=>{
 const html=await read('index.html');assert.match(html,/<html lang="id"[^>]*data-theme="dark"/);assert.match(html,/<title>WMS Goto Living \| Warehouse Management System<\/title>/);assert.match(html,/<meta name="description" content=".{80,180}"/);assert.match(html,/<link rel="canonical" href="https:\/\/gotoliving.id\/"/);assert.match(html,/<meta property="og:image:alt"/);assert.match(html,/<meta name="twitter:card"/);
 const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(schema['@type'],'WebSite');assert.equal(schema.url,'https://gotoliving.id/');assert.equal(schema.aggregateRating,undefined);assert.match(html,/<noscript>/);assert.doesNotMatch(html,/<script[^>]*src="[^"]*html5-qrcode/);assert.match(html,/<script defer src="[^"]*lucide/);
});
test('build flattens CSS imports in original order and retains safe version checks',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'wms-seo-build-'));
 try{
  for(const file of ['index.html','assets','scripts','package.json'])await cp(new URL('../'+file,import.meta.url),join(temp,file),{recursive:true});
  execFileSync(process.execPath,['scripts/inject-version.js'],{cwd:temp,env:{...process.env,CF_PAGES_COMMIT_SHA:'seo-test'},stdio:'pipe'});
  const css=await readFile(join(temp,'assets/css/style.css'),'utf8'),main=await readFile(join(temp,'assets/js/main.js'),'utf8');
  assert.doesNotMatch(css,/@import/);for(const name of ['base','layout','components','pages','responsive'])assert.ok(css.includes((await read('assets/css/'+name+'.css')).trim()));
  assert.match(main,/stock-entry.js\?v=seo-test/);assert.match(main,/warning-view.js\?v=seo-test/);assert.ok(main.includes("includes('__APP_VERSION__')")||main.includes('includes("__APP_VERSION__")'));
 }finally{await rm(temp,{recursive:true,force:true});}
});
