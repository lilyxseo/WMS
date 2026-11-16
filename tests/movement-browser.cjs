// Optional Chromium integration check. All auth and API responses are mocked.
const {chromium}=require('playwright-core');
const fs=require('fs'),nodePath=require('path');
const buildDir=process.env.WMS_BROWSER_BUILD_DIR||nodePath.resolve(__dirname,'..');
const baseURL=process.env.WMS_BROWSER_BASE_URL||'http://127.0.0.1:8790';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();let revision=0,payload=null,release,posts=0;const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(path==='/assets/js/supabase.js')return route.fulfill({contentType:'application/javascript',body:`const q=new Proxy({}, {get:(t,k)=>k==='then'?((resolve)=>resolve({data:[],error:null})):()=>q});export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},from:()=>q};export const restoreSession=async()=>({isDeveloper:true,user:{role:'Developer',username:'test',email:'test@local',full_name:'Test'}});export const getAuthenticatedUser=async()=>({data:{user:null}});export const bindLogoutButtons=()=>{};export const loginWithEmailPassword=async()=>({});export const getAuthHeaders=async()=>({Authorization:'Bearer test'});`});
  if(path==='/assets/js/main.js'){let body=fs.readFileSync(nodePath.join(buildDir,'assets/js/main.js'),'utf8');body+='\nwindow.__wmsTest={movement:()=>MOVEMENT_STATE,cycle:()=>CYCLE_STATE,batches:()=>movementDelivery().batches};';return route.fulfill({contentType:'application/javascript',body});}
  if(path.startsWith('/api/')){
   requests.push(path+url.search);
   let data={success:true,rows:[],data:[],values:[],total:0};
   if(path==='/api/runtime-config')data={previewBypassLogin:false,environment:'development'};
   else if(path==='/api/work-drafts'){
    if(route.request().method()==='PUT'){const input=route.request().postDataJSON();payload=input.payload;revision++;}data={success:true,draft:{revision,payload}};
   }else if(path.endsWith('/search')){const query=url.searchParams.get('q');if(query==='error')return route.fulfill({status:502,json:{success:false}});if(query==='slow'){await new Promise(r=>setTimeout(r,400));data={success:true,rows:[{sku:'OLD',nama:'Old',lokasi:'Z',stok_akhir:1}]};}else data={success:true,rows:[{sku:query,nama:'Product '+query,lokasi:'A01',stok_akhir:7}]};}
   else if(path==='/api/movement/in'&&route.request().method()==='POST'){posts++;await new Promise(resolve=>release=resolve);data={success:true,destinations:{inventory:'saved',barangMasuk:'saved'}};}
   else if(path==='/api/movement/summary')data={success:true,totalMovement:10};
   return route.fulfill({json:data});
  }
  return route.continue();
 });
 await page.goto(baseURL+'/movement');await page.waitForFunction(()=>!!window.__wmsTest);await page.getByRole('button',{name:'Mulai Movement',exact:true}).click();await page.waitForTimeout(100);
 await page.locator('#movementSearchInput').fill('00123456');await page.locator('[data-mvm-action="add"]').click();
 async function edit(cell,value){await page.locator('#mvSessionBody tr').first().locator('td').nth(cell).dblclick();const input=page.locator('[data-grid-editor]');await input.fill(value);await input.press('Enter');}
 await edit(1,'B01');await edit(5,'2');await page.locator('#mvSubmitBtn').click();await page.locator('[data-confirm-ok]').click();await page.waitForFunction(()=>window.__wmsTest.batches()[0]?.status==='sending');
 await page.locator('#movementSearchInput').fill('00999999');await page.locator('[data-mvm-action="add"]').click();await edit(1,'C01');await edit(5,'3');
 if(posts!==1)throw Error('Expected one POST: '+posts);
 await page.waitForTimeout(1000);const before=await page.evaluate(()=>({sku:__wmsTest.movement().sessionItems[0].sku,qty:__wmsTest.movement().sessionItems[0].stokAktual}));
 release();await page.waitForFunction(()=>window.__wmsTest.batches()[0]?.status==='saved');const after=await page.evaluate(()=>({sku:__wmsTest.movement().sessionItems[0].sku,qty:__wmsTest.movement().sessionItems[0].stokAktual}));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('New draft changed');
 // Count animation frames/long tasks and mutations while idle after completion.
 const idle=await page.evaluate(async()=>{let mutations=0,frames=0;const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(document.getElementById('movementApp'),{subtree:true,childList:true});const end=performance.now()+500;await new Promise(resolve=>{function frame(){frames++;if(performance.now()<end)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});observer.disconnect();return {mutations,frames};});if(idle.frames<5||idle.mutations>100)throw Error('UI not settled: '+JSON.stringify(idle));
 await page.reload();await page.waitForFunction(()=>window.__wmsTest?.movement().sessionItems[0]?.sku==='00999999');
 console.log('Movement browser PASS',JSON.stringify({posts,newDraft:after,idle}));
 // Separate account draft state per kind for this isolated browser flow.
 revision=0;payload=null;
 await page.goto(baseURL+'/cycle-count');await page.waitForFunction(()=>!!window.__wmsTest);await page.getByRole('button',{name:'Mulai Cycle Count',exact:true}).click();
 await page.locator('#ccSearch').fill('slow');await page.waitForTimeout(100);await page.locator('#ccSearch').fill('00001234');await page.locator('[data-cc-action="add"]').waitFor();await page.waitForTimeout(500);if(!await page.locator('#ccSearchResultsBody').textContent().then(t=>t.includes('00001234')&&!t.includes('OLD')))throw Error('Stale query won');await page.locator('[data-cc-action="add"]').click();
 const selected=await page.evaluate(()=>window.__wmsTest.cycle().sessionItems[0]);if(selected.sku!=='00001234'||selected.lokasi!=='A01'||selected.stok!==7)throw Error('Wrong selected row '+JSON.stringify(selected));
 await page.locator('#ccSearch').fill('error');await page.locator('[data-cycle-search-retry]').waitFor();await page.locator('[data-cycle-search-retry]').click();await page.locator('[data-cycle-search-retry]').waitFor();
 if(requests.some(path=>/mode=full/.test(path)))throw Error('Unexpected full preload');
 if(errors.length)throw Error('Page errors: '+errors.join('; '));
 console.log('Cycle Count browser PASS',JSON.stringify({selected,errorRetry:true,fullPreloadRequests:0}));await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
