import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const supabaseSource = await readFile(new URL("../assets/js/supabase.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");

test("startup session restoration has a finite timeout and logs failures", () => {
  assert.match(supabaseSource, /AUTH_STARTUP_TIMEOUT_MS\s*=\s*8000/);
  assert.match(supabaseSource, /withAuthTimeout\(supabase\.auth\.getSession\(\),\s*"supabase\.auth\.getSession\(\)"\)/);
  assert.match(supabaseSource, /console\.error\("supabase\.auth\.getSession\(\) failed", error\)/);
});

test("startup always exits auth checking and renders login after a restore failure", () => {
  assert.match(mainSource, /session=await restoreSession\(\{allowDeveloperSession:true\}\)/);
  assert.match(mainSource, /catch\(err\)\{\s*console\.error\("Auth session check failed",err\);\s*user=null;\s*\}finally\{[\s\S]*?authChecking=false;\s*isAuthStateReady=true;\s*renderAuthState\(\);/s);
});

test("authenticated user lookup cannot hold the startup splash indefinitely", () => {
  assert.match(mainSource, /await getAuthenticatedUser\(\)/);
  const boot = mainSource.slice(mainSource.indexOf("async function bootApplication"), mainSource.indexOf('window.addEventListener("auth:logout"'));
  assert.doesNotMatch(boot, /await supabase\.auth\.getUser\(\)/);
});

test("startup still runs when module evaluation finishes after DOMContentLoaded", () => {
  assert.match(mainSource, /if\(document\.readyState==="loading"\)/);
  assert.match(mainSource, /window\.addEventListener\("DOMContentLoaded",bootApplication,\{once:true\}\)/);
  assert.match(mainSource, /else\{\s*void bootApplication\(\);/s);
});

test("preview bypass is decided before session restoration", () => {
  const boot = mainSource.slice(mainSource.indexOf("async function bootApplication"), mainSource.indexOf('window.addEventListener("auth:logout"'));
  assert.match(boot, /if\(isPreviewBypassLoginEnabled\(\)\)[\s\S]*?else\{[\s\S]*?session=await restoreSession\(\{allowDeveloperSession:true\}\)/);
  assert.doesNotMatch(boot, /user=\{id:["']developer["']\}[\s\S]*?restoreSession/);
});

test("startup never schedules inventory preload before session restoration", () => {
  const boot = mainSource.slice(mainSource.indexOf("async function bootApplication"), mainSource.indexOf('window.addEventListener("auth:logout"'));
  const restoreIndex = boot.indexOf("await restoreSession");
  const initIndex = boot.indexOf("await initAppData()");
  assert.ok(restoreIndex >= 0);
  assert.ok(initIndex > restoreIndex);
  assert.doesNotMatch(boot.slice(0, restoreIndex), /startBackgroundPreload|hydrateAllDataOnInit/);
  assert.match(boot, /if\(!user\)\{bindLoginView\(\);if\(window\.lucide\)lucide\.createIcons\(\);return;\}[\s\S]*?await initAppData\(\)/);
});

test("inventory hydration is gated by ready authenticated state and access token", () => {
  const preload = mainSource.slice(mainSource.indexOf("async function startBackgroundPreload"), mainSource.indexOf("function preloadInventoryData"));
  assert.match(preload, /if\(!isAuthStateReady\|\|!user\)return null;/);
  assert.match(preload, /const authHeaders=await getAuthHeaders\(\)\.catch\(\(\)=>\(\{\}\)\);\s*if\(!authHeaders\.Authorization\)return null;/);
});

test("authenticated inventory requests carry a bearer token and do not reach native fetch without one", () => {
  const fetchWrapper = mainSource.slice(mainSource.indexOf("const nativeFetch="), mainSource.indexOf("function toUserSnapshot"));
  assert.match(fetchWrapper, /AUTHENTICATED_INVENTORY_PATHS=new Set\(\[[^\]]*'\/api\/kartu-stok'[^\]]*'\/api\/barang-masuk'[^\]]*'\/api\/barang-keluar'/);
  assert.match(fetchWrapper, /getAuthHeaders\(\)[\s\S]*?headers\.set\(key,value\)/);
  assert.match(fetchWrapper, /if\(AUTHENTICATED_INVENTORY_PATHS\.has\(apiPath\)&&!headers\.has\('Authorization'\)\)[\s\S]*?throw new Error[\s\S]*?return nativeFetch/);
});

test("preview bypass is fail-safe for production and unknown environments", () => {
  assert.match(mainSource, /trustedPreviewEnvironments=new Set\(\[[^\]]*"preview"[^\]]*"development"[^\]]*\]\)/);
  assert.match(mainSource, /trustedPreviewEnvironments\.has\(environment\)&&isTruthyFlag\(runtimeConfig\.previewBypassLogin\)/);
  assert.match(mainSource, /environment:String\(loaded\.environment\|\|"unknown"\)\.toLowerCase\(\)/);
  assert.doesNotMatch(mainSource, /trustedPreviewEnvironments=new Set\([^\n]*(?:"production"|"unknown")/);
});

test("logout invalidates stale startup work and clears cached identity state", () => {
  assert.match(mainSource, /const requestGeneration=\+\+authRequestGeneration/);
  assert.match(mainSource, /if\(requestGeneration!==authRequestGeneration\)return/);
  assert.match(mainSource, /window\.addEventListener\("auth:logout"[\s\S]*?\+\+authRequestGeneration;[\s\S]*?user=null;[\s\S]*?devProfile=null;[\s\S]*?authChecking=false;[\s\S]*?clearCurrentUser\(\);/);
  assert.match(mainSource, /window\.addEventListener\("auth:logout"[\s\S]*?hasInitializedDataFlow=false;[\s\S]*?preloadPromise=null;[\s\S]*?window\.mainDataPromise=null;/);
  assert.match(supabaseSource, /export async function logout\(\)[\s\S]*?clearAppAuthState\(\);[\s\S]*?supabase\.auth\.signOut\(\)/);
  assert.match(supabaseSource, /window\.dispatchEvent\(new CustomEvent\(['"]auth:logout['"]\)\)/);
});
