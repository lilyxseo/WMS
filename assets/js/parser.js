import { clean, normalizeHeader } from './utils.js';

export function detectHeaderIndex(values){
  if(!Array.isArray(values)) return -1;
  const req = ["sku","nama","nama barang","item","description","qty","tanggal","from","to","lokasi"];
  let bi = -1, bs = 0;

  for(let i=0;i<Math.min(values.length,25);i++){
    if(!Array.isArray(values[i])) continue;
    const t = values[i].map(clean).join("|");
    let s = 0;
    req.forEach(k => t.includes(clean(k)) && s++);
    if(s > bs){
      bs = s;
      bi = i;
    }
  }

  return bs >= 1 ? bi : -1;
}

export function parseSheet(values, sheetName = "unknown"){
  if(!Array.isArray(values) || !values.length){
    console.warn(`[parseSheet] ${sheetName}: empty values`, values);
    return [];
  }

  let h = detectHeaderIndex(values);
  if(h < 0){
    // fallback: first non-empty row as header
    h = values.findIndex(row => Array.isArray(row) && row.some(c => String(c || "").trim()));
  }

  if(h < 0){
    console.error(`[parseSheet] ${sheetName}: header tidak ketemu`, values);
    return [];
  }

  const headers = (values[h] || []).map((v,i)=>normalizeHeader(v)||`col_${i+1}`);
  const rows = [];
  for(let r=h+1;r<values.length;r++){
    const row = values[r] || [];
    if(!row.length || row.every(c=>!String(c||"").trim())) continue;
    const obj = {};
    headers.forEach((k,i)=>obj[k]=row[i]||"");
    rows.push(obj);
  }

  if(rows.length === 0){
    console.warn(`[parseSheet] ${sheetName}: parsed 0 rows`, { headerIndex: h, headers, values });
  }
  return rows;
}

export function parseISellerTransferPdf(pages = []){
  const pageTexts = Array.isArray(pages)
    ? pages.map(p => String(p?.text ?? p ?? '')).filter(Boolean)
    : [];
  const rawText = pageTexts.join('\n');
  const normalized = normalizePdfText(rawText);
  const headerIndex = findProductHeaderIndex(normalized);
  const parseText = headerIndex >= 0 ? normalized.slice(headerIndex) : normalized;
  const lines = parseText.split('\n').map(x => x.trim()).filter(Boolean);

  const items = [];
  let current = null;
  for(const line of lines){
    const skuFound = findSkuInLine(line);
    if(skuFound){
      if(current && isValidParsedItem(current)) items.push(finalizeParsedItem(current));
      current = buildItemFromLine(line, skuFound);
      continue;
    }
    if(!current) continue;
    mergeLineToItem(current, line);
  }
  if(current && isValidParsedItem(current)) items.push(finalizeParsedItem(current));

  const transferNumber = pickField(normalized, [/nomor\s*transfer\s*[:\-]?\s*([A-Z0-9\-\/]+)/i]);
  const from = pickField(normalized, [/dari\s*[:\-]\s*(.+)/i]);
  const to = pickField(normalized, [/(kepada|tujuan|to)\s*[:\-]\s*(.+)/i], 2);
  const tanggal = pickField(normalized, [/tanggal\s*[:\-]\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i]);

  const totalQty = items.reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
  const debug = {
    totalPages: pageTexts.length,
    totalCharacters: rawText.length,
    totalDetectedSku: items.length,
    totalRows: items.length,
    firstFiveRows: items.slice(0, 5),
    rawTextPreview: items.length ? '' : rawText.slice(0, 5000)
  };

  console.log('[iSeller PDF Parser] Debug', debug);

  return {
    success: items.length > 0,
    warning: items.length ? '' : 'Gagal parsing item. Menampilkan raw text untuk debug.',
    transferNumber,
    from,
    to,
    tanggal,
    totalSku: items.length,
    totalQty,
    items,
    debug
  };
}

function normalizePdfText(text = ''){
  return String(text)
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function findProductHeaderIndex(text){
  const lower = String(text || '').toLowerCase();
  const keys = ['sku', 'nama produk', 'jumlah', 'qty', 'diterima', 'batal', 'tolak'];
  for(let i = 0; i < lower.length; i++){
    const tail = lower.slice(i, i + 350);
    if(keys.every(k => tail.includes(k))) return i;
  }
  return -1;
}

function findSkuInLine(line = ''){
  const m = String(line).match(/\b([A-Z]{1,}[A-Z0-9\-]*\d[A-Z0-9\-]*|\d{6,})\b/i);
  return m ? m[1].trim() : '';
}

function buildItemFromLine(line, sku){
  const skuIdx = line.toLowerCase().indexOf(String(sku).toLowerCase());
  const rest = skuIdx >= 0 ? line.slice(skuIdx + sku.length).trim() : line.trim();
  const numbers = [...rest.matchAll(/\b\d+\b/g)].map(x => Number(x[0]));
  return {
    sku,
    namaBarang: rest.replace(/\b\d+\b/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    qty: numbers[0] ?? null,
    diterima: numbers[1] ?? null,
    batal: numbers[2] ?? null,
    tolak: numbers[3] ?? null,
    _nameParts: []
  };
}

function mergeLineToItem(item, line){
  const numbers = [...String(line).matchAll(/\b\d+\b/g)].map(x => Number(x[0]));
  const textOnly = String(line).replace(/\b\d+\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if(textOnly) item._nameParts.push(textOnly);
  if(item.qty == null && numbers.length) item.qty = numbers.shift();
  if(item.diterima == null && numbers.length) item.diterima = numbers.shift();
  if(item.batal == null && numbers.length) item.batal = numbers.shift();
  if(item.tolak == null && numbers.length) item.tolak = numbers.shift();
}

function finalizeParsedItem(item){
  const fullName = [item.namaBarang, ...(item._nameParts || [])].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
  return {
    sku: String(item.sku || '').trim(),
    namaBarang: fullName,
    qty: item.qty,
    diterima: item.diterima,
    batal: item.batal,
    tolak: item.tolak
  };
}

function isValidParsedItem(item){
  if(!String(item?.sku || '').trim()) return false;
  return [item?.qty, item?.diterima, item?.batal, item?.tolak].some(v => Number.isFinite(v));
}

function pickField(text, patterns = [], groupIndex = 1){
  for(const regex of patterns){
    const m = String(text || '').match(regex);
    if(m && m[groupIndex]) return String(m[groupIndex]).trim();
  }
  return '';
}
