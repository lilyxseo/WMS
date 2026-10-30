const decoder=new TextDecoder();
export async function boundedBytes(response,limit=8*1024*1024){if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Data katalog terlalu besar.');}const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Ekspor katalog terlalu besar.');parts.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}if(parts.length===1)return parts[0];const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;}
export function catalogRaster(bytes){if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(decoder.decode(bytes.subarray(0,6)).match(/^GIF8[79]a$/))return 'image/gif';if(decoder.decode(bytes.subarray(0,4))==='RIFF'&&decoder.decode(bytes.subarray(8,12))==='WEBP')return 'image/webp';return '';}
// Read only enough bytes to identify a raster, then pass the image through with
// backpressure. Concurrent image requests never retain full images in memory.
export async function catalogRasterStream(response,limit=8*1024*1024){
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Gambar sel terlalu besar.');}
 if(!response.body)throw Error('Gambar sel kosong.');
 const reader=response.body.getReader(),pending=[];let size=0;
 try{while(size<12){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Gambar sel terlalu besar.');pending.push(value);}
  const signature=new Uint8Array(Math.min(size,12));let offset=0;for(const chunk of pending){const length=Math.min(chunk.length,signature.length-offset);signature.set(chunk.subarray(0,length),offset);offset+=length;if(offset===signature.length)break;}
  const type=catalogRaster(signature);if(!type)throw Error('Format gambar sel tidak didukung.');
  const body=new ReadableStream({async pull(controller){if(pending.length){controller.enqueue(pending.shift());return;}try{const {done,value}=await reader.read();if(done){controller.close();reader.releaseLock();return;}size+=value.length;if(size>limit)throw Error('Gambar sel terlalu besar.');controller.enqueue(value);}catch(error){await reader.cancel(error).catch(()=>{});reader.releaseLock();controller.error(error);}},async cancel(reason){await reader.cancel(reason).catch(()=>{});reader.releaseLock();}});
  return {body,type};
 }catch(error){await reader.cancel(error).catch(()=>{});reader.releaseLock();throw error;}
}
