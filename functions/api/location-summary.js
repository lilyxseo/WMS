import { callLocationRpc, locationErrorResponse, locationJson } from './_locations.js';
export async function onRequestGet(context) { try { const out=await callLocationRpc(context,'location_summary'); return out.response||locationJson({ success:true,...out.payload,timings:out.timings },200,out.headers); } catch(error) { return locationErrorResponse(error,'location_summary'); } }
