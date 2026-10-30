import fs from "fs";

const version =
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  Date.now().toString();

const filePath = "./index.html";

let html = fs.readFileSync(filePath, "utf8");

html = html.replaceAll("__APP_VERSION__", version);

if (html.includes("__APP_VERSION__")) {
  throw new Error("APP_VERSION injection failed");
}

fs.writeFileSync(filePath, html);

const stylePath="./assets/css/style.css";
// Flatten local stylesheet imports so the browser fetches the page CSS in one
// request rather than discovering five blocking stylesheets after style.css.
const style=fs.readFileSync(stylePath,"utf8").replace(/@import url\("\.\/([a-z-]+\.css)\?v=__APP_VERSION__"\);/g,(_match,name)=>fs.readFileSync('./assets/css/'+name,'utf8')).replaceAll("__APP_VERSION__",version);
fs.writeFileSync(stylePath,style);
const contentImportPath="./assets/js/entry-import-content.js?v=__APP_VERSION__";
const mainPath="./assets/js/main.js";
fs.writeFileSync(mainPath,fs.readFileSync(mainPath,"utf8").replaceAll("./notification-settings.js?v=__APP_VERSION__","./notification-settings.js?v="+version).replaceAll(contentImportPath,"./assets/js/entry-import-content.js?v="+version).replaceAll("./all-sku-notes.js?v=__APP_VERSION__","./all-sku-notes.js?v="+version).replaceAll("./sku-notes.js?v=__APP_VERSION__","./sku-notes.js?v="+version).replaceAll("./catalog.js?v=__APP_VERSION__","./catalog.js?v="+version).replaceAll("./file-manager.js?v=__APP_VERSION__","./file-manager.js?v="+version).replaceAll("./utils/scan-value.js?v=__APP_VERSION__","./utils/scan-value.js?v="+version).replaceAll("./draft-storage.js?v=__APP_VERSION__","./draft-storage.js?v="+version).replaceAll("./account-drafts.js?v=__APP_VERSION__","./account-drafts.js?v="+version).replaceAll("./archive-grid.js?v=__APP_VERSION__","./archive-grid.js?v="+version).replaceAll("./stock-entry.js?v=__APP_VERSION__","./stock-entry.js?v="+version).replaceAll("./warning-view.js?v=__APP_VERSION__","./warning-view.js?v="+version).replaceAll("./accent-colors.js?v=__APP_VERSION__","./accent-colors.js?v="+version).replaceAll("./editable-table-grid.js?v=__APP_VERSION__","./editable-table-grid.js?v="+version).replaceAll("./table-filters.js?v=__APP_VERSION__","./table-filters.js?v="+version).replaceAll("./balikan-entry.js?v=__APP_VERSION__","./balikan-entry.js?v="+version));
console.log("Version injected:", version);

const stockEntryPath="./assets/js/stock-entry.js";
fs.writeFileSync(stockEntryPath,fs.readFileSync(stockEntryPath,"utf8").replaceAll("./draft-storage.js?v=__APP_VERSION__","./draft-storage.js?v="+version).replaceAll("./account-drafts.js?v=__APP_VERSION__","./account-drafts.js?v="+version));

const accountDraftPath="./assets/js/account-drafts.js";
fs.writeFileSync(accountDraftPath,fs.readFileSync(accountDraftPath,"utf8").replaceAll("./draft-storage.js?v=__APP_VERSION__","./draft-storage.js?v="+version));

const allNotesPath="./assets/js/all-sku-notes.js";
fs.writeFileSync(allNotesPath,fs.readFileSync(allNotesPath,"utf8").replaceAll("./sku-notes.js?v=__APP_VERSION__","./sku-notes.js?v="+version));
