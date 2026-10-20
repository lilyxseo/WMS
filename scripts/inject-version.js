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
const mainPath="./assets/js/main.js";
fs.writeFileSync(mainPath,fs.readFileSync(mainPath,"utf8").replaceAll("./stock-entry.js?v=__APP_VERSION__","./stock-entry.js?v="+version).replaceAll("./warning-view.js?v=__APP_VERSION__","./warning-view.js?v="+version).replaceAll("./accent-colors.js?v=__APP_VERSION__","./accent-colors.js?v="+version).replaceAll("./editable-table-grid.js?v=__APP_VERSION__","./editable-table-grid.js?v="+version).replaceAll("./table-filters.js?v=__APP_VERSION__","./table-filters.js?v="+version));
console.log("Version injected:", version);
