import {validBatchId,deliveryIdentity,claimDelivery,checkpointDelivery,readDelivery,deliveryResult,writeDeliverySheet,readDeliveryReceipt} from './_delivery.js';
import { getGoogleAccessToken } from '../_google-auth.js';
import { requirePicRole } from '../_authz.js';
import { businessDateKey } from '../_inventory-analytics.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function sanitize(value) {
  return String(value ?? "").trim();
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function movementBusinessDates(now = new Date(), timeZone = 'Asia/Jakarta') {
  const date = businessDateKey(now, timeZone);
  const [year, month, day] = date.split('-');
  return { date, sheetDate: `${Number(month)}/${Number(day)}/${year}` };
}

function isPermissionError(data) {
  const text = String(data?.error?.message || data?.message || "").toLowerCase();
  return text.includes("permission") || text.includes("forbidden") || text.includes("insufficient") || text.includes("caller does not have permission");
}

async function createAccessToken(env) { return getGoogleAccessToken(env); }

async function updateSheetRow({ accessToken, sheetId, range, values }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function readSpreadsheetMetadata({ accessToken, sheetId }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=spreadsheetId,properties.title,sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function readSheetBarangMasuk({ accessToken, sheetId }) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("Barang Masuk!A1:I5")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function onRequestPost({ request, env }) {
  let writeAttempted = false, job=null;
  const destinations={inventory:'not_started',barangMasuk:'not_started'};
  const reply = (body, status = 200) => json({ ...body, ...(!body.success ? { writeState: writeAttempted ? 'uncertain' : 'not_started', destinations } : {}) }, status);
  const authz = await requirePicRole({ request, env });
  if (!authz.ok) { const body = await authz.response.json(); return reply(body, authz.response.status); }
  try {
    const inventorySpreadsheetId = sanitize(env.SHEET_ID_INVENTORY);
    const spreadsheetId = sanitize(env.SHEET_ID_2026);
    if (!inventorySpreadsheetId) return reply({ success: false, message: "SHEET_ID_INVENTORY belum diset" }, 500);
    if (!spreadsheetId) return reply({ success: false, message: "SHEET_ID_2026 belum diset" }, 500);

    const body = await request.json();
    if(!validBatchId(body?.id))return reply({success:false,message:'ID batch Movement wajib diisi.'},400);
    const who=await deliveryIdentity(request,env);
    if(!who)return reply({success:false,message:'Sesi tidak valid.'},401);
    if(!/pic/i.test(who.role)&&! /^(developer|mode development)$/i.test(who.role)&&!who.id.startsWith('developer:'))return reply({success:false,message:'Hanya PIC atau Developer yang dapat mengirim Movement.'},403);
    const requestItems = Array.isArray(body?.items) ? body.items : [body];
    if(requestItems.length>1000)return reply({success:false,message:'Maksimal 1000 item per batch.'},400);
    if (!requestItems.length) return reply({ success: false, message: "items wajib diisi" }, 400);

    // The server owns the transaction date. Client-provided dates are deliberately
    // ignored so every item in this request uses one consistent business day.
    const { date: tanggal, sheetDate: tanggalBarangMasuk } = movementBusinessDates(
      new Date(),
      sanitize(env.BUSINESS_TIME_ZONE) || 'Asia/Jakarta'
    );
    const movementItems = requestItems.map((item) => {
      const sku = sanitize(item?.sku);
      const namaBarang = sanitize(item?.namaBarang);
      const qty = toPositiveNumber(item?.qty);
      const stokDiLokasiAwal = toNonNegativeNumber(item?.stokDiLokasiAwal);
      const stokAktual = toNonNegativeNumber(item?.stokAktual);
      const from = sanitize(item?.from);
      const to = sanitize(item?.to);
      const pic = sanitize(item?.pic) || "ABI";
      return { sku, namaBarang, qty, stokDiLokasiAwal, stokAktual, tanggal, tanggalBarangMasuk, from, to, pic };
    });

    for (const item of movementItems) {
      if (!item.from) return reply({ success: false, message: "from wajib diisi" }, 400);
      if (!item.to) return reply({ success: false, message: "to wajib diisi" }, 400);
      if (!item.sku) return reply({ success: false, message: "sku wajib diisi" }, 400);
      if (!item.namaBarang) return reply({ success: false, message: "namaBarang wajib diisi" }, 400);
      if (item.qty === null) return reply({ success: false, message: "qty harus angka > 0" }, 400);
      if (item.stokDiLokasiAwal === null) return reply({ success: false, message: "stokDiLokasiAwal harus angka >= 0" }, 400);
      if (item.stokAktual === null) return reply({ success: false, message: "stokAktual harus angka >= 0" }, 400);
    }

    // Canonical validated fields keep the receipt stable after JSONB key reordering.
    const canonicalItems=movementItems.map(({tanggal,tanggalBarangMasuk,...item})=>item);
    job=await claimDelivery(env,body.id,who,canonicalItems);
    if(job.response)return json(job.response,job.response.success?200:409);
    const accessToken = await createAccessToken(env);
    const inventoryRows = movementItems.map((item) => [item.tanggal, item.from, item.to, item.sku, item.namaBarang, item.stokDiLokasiAwal, item.stokAktual]);
    const barangMasukRows = movementItems.map((item) => [item.tanggalBarangMasuk, item.from, item.to, item.sku, item.namaBarang, item.qty, "Movement", item.pic, "INTERNAL STOCK TRANSFER"]);

    await checkpointDelivery(env,job,'writing',{destinations});
    writeAttempted = true;
    destinations.inventory='uncertain';
    let inventoryWrite = await writeDeliverySheet({accessToken,sheetId:inventorySpreadsheetId,title:'Movement',values:inventoryRows,job,destination:'inventory',businessDate:tanggal});
    if (!inventoryWrite.res.ok && isPermissionError(inventoryWrite.data)) {
      writeAttempted = false;
      destinations.inventory='not_started';
      await checkpointDelivery(env,job,'failed',{destinations});
      return reply({ success: false, message: "Akun Gmail OAuth belum punya akses Editor ke Spreadsheet Inventory" }, 403);
    }
    if (!inventoryWrite.res.ok) return reply({ success: false, message: inventoryWrite.data?.error?.message || "Gagal menulis history Movement", detail: inventoryWrite.data }, inventoryWrite.res.status);

    destinations.inventory='saved';
    await checkpointDelivery(env,job,'writing',{destinations});
    destinations.barangMasuk='uncertain';
    const ledgerWrite=await writeDeliverySheet({accessToken,sheetId:spreadsheetId,title:'Barang Masuk',values:barangMasukRows,job,destination:'barangMasuk',businessDate:tanggal});
    if(!ledgerWrite.res.ok){
      await checkpointDelivery(env,job,'uncertain',{destinations});
      return reply({success:false,message:ledgerWrite.data?.error?.message||'Barang Masuk belum terkonfirmasi; History Movement sudah ditulis.'},ledgerWrite.res.status);
    }
    destinations.barangMasuk='saved';
    await checkpointDelivery(env,job,'saved',{processed:movementItems.length,businessDate:tanggal,destinations});
    return reply({ success: true, processed: movementItems.length, businessDate: tanggal, destinations, id:body.id });
  } catch (err) {
    if(job&&!job.response)await checkpointDelivery(env,job,writeAttempted?'uncertain':'failed',{destinations}).catch(()=>{});
    return reply({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const id=url.searchParams.get('id');
    if(id){
      if(!validBatchId(id))return json({success:false,message:'ID batch tidak valid.'},400);
      const who=await deliveryIdentity(request,env);if(!who)return json({success:false,message:'Sesi tidak valid.'},401);
      const job=await readDelivery(env,id,who.id);
      if(!job||job.result?.kind!=='movement')return json({success:false,status:'not_found',writeState:'uncertain',message:'Batch belum ditemukan. Jangan kirim ulang sebelum pemeriksaan selesai.'},404);
      if(['writing','uncertain'].includes(job.status)){
        const accessToken=await createAccessToken(env);
        const inventory=await readDeliveryReceipt(accessToken,env.SHEET_ID_INVENTORY,job,'inventory'),ledger=await readDeliveryReceipt(accessToken,env.SHEET_ID_2026,job,'barangMasuk');
        if(inventory&&ledger){job.status='saved';job.result={kind:'movement',processed:inventory.processed,businessDate:inventory.businessDate,destinations:{inventory:'saved',barangMasuk:'saved'}};await checkpointDelivery(env,job,'saved',job.result);}
        else job.result={...job.result,destinations:{inventory:inventory?'saved':'uncertain',barangMasuk:ledger?'saved':'uncertain'}};
      }
      const result=deliveryResult(job);return json(result,result.success?200:409);
    }
    const mode = sanitize(url.searchParams.get("mode")).toLowerCase();
    if (mode !== "test") return new Response("API OK", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });

    if (sanitize(env.MOVEMENT_TEST_MODE) !== "1") return json({ success: false, message: "Mode test tidak aktif" }, 403);

    const inventorySpreadsheetId = sanitize(env.SHEET_ID_INVENTORY);
    const spreadsheetId = sanitize(env.SHEET_ID_2026);
    if (!inventorySpreadsheetId) return json({ success: false, message: "SHEET_ID_INVENTORY belum diset" }, 500);
    if (!spreadsheetId) return json({ success: false, message: "SHEET_ID_2026 belum diset" }, 500);

    const accessToken = await createAccessToken(env);
    const metadata = await readSpreadsheetMetadata({ accessToken, sheetId: spreadsheetId });
    if (!metadata.res.ok && isPermissionError(metadata.data)) {
      return json({ success: false, message: "Akun Gmail OAuth belum punya akses Editor ke Spreadsheet 2026" }, 403);
    }
    if (!metadata.res.ok) return json({ success: false, message: metadata.data?.error?.message || "Gagal baca metadata spreadsheet", detail: metadata.data }, metadata.res.status);

    const sheetRead = await readSheetBarangMasuk({ accessToken, sheetId: spreadsheetId });
    if (!sheetRead.res.ok && isPermissionError(sheetRead.data)) {
      return json({ success: false, message: "Akun Gmail OAuth belum punya akses Editor ke Spreadsheet 2026" }, 403);
    }
    if (!sheetRead.res.ok) return json({ success: false, message: sheetRead.data?.error?.message || "Gagal baca sheet Barang Masuk", detail: sheetRead.data }, sheetRead.res.status);

    const appendDummy = sanitize(url.searchParams.get("appendDummy")).toLowerCase() === "1";
    let appendResult = { skipped: true };
    if (appendDummy) {
      const dummyRow = [[new Date().toISOString(), "TEST_FROM", "TEST_TO", "TEST_SKU", "TEST_BARANG", 1, "Movement", "ABI", "INTERNAL STOCK TRANSFER"]];
      const appended = await updateSheetRow({ accessToken, sheetId: spreadsheetId, range: "Barang Masuk!A2:I2", values: dummyRow });
      if (!appended.res.ok && isPermissionError(appended.data)) {
        return json({ success: false, message: "Akun Gmail OAuth belum punya akses Editor ke Spreadsheet 2026" }, 403);
      }
      if (!appended.res.ok) return json({ success: false, message: appended.data?.error?.message || "Gagal append dummy row", detail: appended.data }, appended.res.status);
      appendResult = { skipped: false, success: true };
    }

    return json({
      success: true,
      spreadsheetId,
      metadataTitle: metadata.data?.properties?.title || "",
      hasBarangMasukSheet: Array.isArray(metadata.data?.sheets) && metadata.data.sheets.some((s) => sanitize(s?.properties?.title).toLowerCase() === "barang masuk"),
      readRows: Array.isArray(sheetRead.data?.values) ? sheetRead.data.values.length : 0,
      appendDummy: appendResult,
    });
  } catch (err) {
    return json({ success: false, message: err?.message || "Internal server error" }, 500);
  }
}
