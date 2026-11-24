import {getRequestRole} from './_authz.js';
import {getGoogleAccessToken} from './_google-auth.js';

const SHEET_TITLE = 'LIST GT ORDER';
const SHEET_ID = 784945780;
const required = {sku:'sku', product:'namaproduk', requested:'qtyrequest', picked:'qtypicking', status:'status', customer:'customer'};
const optional = {payment:'payment', bulky:'bulky', retail:'retail', note:'ket', pickingStatus:'statuspicking', remark:'remark'};
const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const finished = new Set(['selesai','done','terkirim','sudahkirim','sudahdikirim','shipped','delivered','complete','completed','batal','cancel','cancelled','canceled']);
const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'private, no-store'}});
const quantity = cell => {
  if (!cell?.formattedValue?.trim()) return null;
  const value = cell.effectiveValue?.numberValue ?? Number(cell.formattedValue);
  return Number.isFinite(value) ? value : null;
};

export function readGtOrders(sheet) {
  const grid = sheet.data?.[0];
  const rows = grid?.rowData ?? [];
  const offset = grid?.startRow ?? 0;
  const headers = rows.slice(0, 10).map(row => (row.values || []).map(cell => normalize(cell.formattedValue)));
  const headerIndex = headers.findIndex(row => Object.values(required).every(label => row.includes(label)));
  if (headerIndex < 0) throw Error('Header LIST GT ORDER tidak sesuai.');
  const columns = Object.fromEntries(Object.entries({...required,...optional}).map(([key,label]) => [key,headers[headerIndex].indexOf(label)]));
  const customers = new Map();
  for (const merge of sheet.merges ?? []) {
    if (merge.startColumnIndex !== columns.customer || merge.endColumnIndex !== columns.customer + 1) continue;
    const customer = rows[merge.startRowIndex-offset]?.values?.[columns.customer]?.formattedValue?.trim();
    if (!customer) continue;
    for (let row = merge.startRowIndex; row < Math.min(merge.endRowIndex, rows.length+offset); row++) {
      customers.set(row, {key:merge.startRowIndex, customer});
    }
  }
  const orders = new Map();
  for (let index = headerIndex+1; index < rows.length; index++) {
    const cells = rows[index].values ?? [];
    const cell = field => cells[columns[field]];
    const text = field => cell(field)?.formattedValue?.trim() ?? '';
    const item = {row:index+offset+1, sku:text('sku'), product:text('product'), requested:quantity(cell('requested')), picked:quantity(cell('picked')), status:text('status'), payment:text('payment'), bulky:quantity(cell('bulky')), retail:quantity(cell('retail')), note:text('note'), pickingStatus:text('pickingStatus'), remark:text('remark')};
    if (!item.sku && !item.product && item.requested === null && item.picked === null) continue;
    const block = customers.get(index+offset) ?? {key:index+offset, customer:text('customer')};
    if (!orders.has(block.key)) orders.set(block.key,{row:block.key+1, customer:block.customer, items:[]});
    orders.get(block.key).items.push(item);
  }
  return [...orders.values()].reverse().map(order => ({
    ...order,
    active: order.items.some(item => !finished.has(normalize(item.status))),
    missingSku: order.items.filter(item => !item.sku).length
  }));
}

export async function handleGtOrders({request,env},{authorize=getRequestRole,getToken=getGoogleAccessToken,fetchFn=fetch}={}) {
  if (!await authorize(request,env)) return json({success:false,message:'Silakan login kembali.'},401);
  try {
    const spreadsheet = String(env.GT_ORDER_SPREADSHEET_ID || env.SHEET_ID_2026 || env.GOOGLE_SHEET_ID || '').trim();
    if (!/^[\w-]{20,}$/.test(spreadsheet)) return json({success:false,message:'Spreadsheet Orderan GT belum dikonfigurasi.'},503);
    const token = await getToken(env);
    const params = new URLSearchParams({ranges:`'${SHEET_TITLE}'!A:L`,fields:'sheets(properties(sheetId,title),merges,data(startRow,rowData(values(formattedValue,effectiveValue(numberValue)))))'});
    const response = await fetchFn(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet}?${params}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Spreadsheet tidak dapat dibaca.');
    const data = await response.json();
    const sheet = data.sheets?.find(sheet => sheet.properties?.sheetId === SHEET_ID && sheet.properties.title === SHEET_TITLE);
    if (!sheet) return json({success:false,message:'Tab LIST GT ORDER tidak ditemukan di spreadsheet yang dikonfigurasi.'},503);
    return json({success:true,orders:readGtOrders(sheet),lastReadAt:new Date().toISOString()});
  } catch {
    return json({success:false,message:'Gagal membaca LIST GT ORDER. Coba lagi atau periksa akses Google Sheets.'},503);
  }
}
export const onRequestGet = context => handleGtOrders(context);
