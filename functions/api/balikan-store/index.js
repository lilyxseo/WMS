import {parseBalikanSheet} from './_parse-sheet.js';
import { json, getAccessToken, escSheet, buildHeaderInfo } from './_utils';
import { fetchLastInboundLocations } from './_last-inbound-location.js';
import { fetchLocationInventory, LOCATION_INVENTORY_QTY_FIELD, LOCATION_INVENTORY_TABLE } from './_location-inventory.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const sheetName = String(url.searchParams.get('sheetName') || '').trim();
    if (!sheetName) return json({ message: 'sheetName wajib diisi' }, 400);
    const accessToken = await getAccessToken(env);
    const range = `${escSheet(sheetName)}!A1:ZZ`;
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID_INVENTORY}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) return json({ message: data.error?.message || 'Gagal membaca data sheet' }, res.status);
    const rows = data.values || [];
    let parsed;try{parsed=parseBalikanSheet(rows);}catch(error){return json({message:error.message},400);}
    const {rows:out,dynamicColumns}=parsed;
    const skus = out.map(row => row.sku);
    const [inventoryResult, inboundResult] = await Promise.allSettled([
      fetchLocationInventory(env, skus), fetchLastInboundLocations(env, skus),
    ]);
    const locationInventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value : {};
    const lastInboundLocations = inboundResult.status === 'fulfilled' ? inboundResult.value : {};
    const locationInventoryError = inventoryResult.status === 'rejected' ? 'Gagal membaca inventory lokasi' : null;
    const lastInboundLocationError = inboundResult.status === 'rejected' ? 'Gagal membaca lokasi terakhir Barang Masuk' : null;
    if (locationInventoryError) console.error('[BalikanStore] Location inventory lookup failed');
    if (lastInboundLocationError) console.error('[BalikanStore] Last inbound location lookup failed');
    out.forEach(row => {
      const sku = String(row.sku || '').trim().toLowerCase();
      row.locations = locationInventory[sku] || [];
      row.lastInboundLocation = lastInboundLocations[sku] || '';
    });
    return json({
      sheetName,
      rows: out,
      dynamicColumns: dynamicColumns.map(({ key, header }) => ({ key, header })),
      locationInventory,
      locationInventorySource: {
        table: `public.${LOCATION_INVENTORY_TABLE}`,
        locationField: 'lokasi_bulky',
        qtyField: LOCATION_INVENTORY_QTY_FIELD,
        aggregatedBy: ['sku', 'lokasi_bulky'],
      },
      locationInventoryError,
      lastInboundLocationError,
    });
  } catch (err) { return json({ message: err?.message || 'Internal server error' }, 500); }
}
