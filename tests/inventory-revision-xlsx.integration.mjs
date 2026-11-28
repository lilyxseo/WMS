import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readInventoryRevision} from '../functions/api/_inventory-revision-xlsx.js';

function workbook(entries){
 const local=[],directory=[];
 let offset=0;
 for(const [name,xml] of Object.entries(entries)){
  const filename=Buffer.from(name),plain=Buffer.from(xml),packed=deflateRawSync(plain);
  const header=Buffer.alloc(30),record=Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(8,8);
  header.writeUInt16LE(filename.length,26);
  record.writeUInt32LE(0x02014b50);
  record.writeUInt16LE(8,10);
  record.writeUInt32LE(packed.length,20);
  record.writeUInt32LE(plain.length,24);
  record.writeUInt16LE(filename.length,28);
  record.writeUInt32LE(offset,42);
  local.push(header,filename,packed);
  directory.push(record,filename);
  offset+=header.length+filename.length+packed.length;
 }
 const end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50);
 end.writeUInt16LE(Object.keys(entries).length,10);
 end.writeUInt32LE(offset,16);
 return Uint8Array.from(Buffer.concat([...local,...directory,end])).buffer;
}
const inline=(ref,text)=>`<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const numeric=(ref,value,style=0)=>`<c r="${ref}" s="${style}"><v>${value}</v></c>`;
const heading=labels=>`<row r="1">${labels.map((label,i)=>inline(String.fromCharCode(65+i)+'1',label)).join('')}</row>`;
const sheet=rows=>`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
const stock=(location,qty)=>sheet(heading(['SKU','Nama Barang','Lokasi Bulky','Stok Akhir'])+`<row r="2">${numeric('A2',12,1)}${inline('B2','Barang Lama')}${inline('C2',location)}${numeric('D2',qty)}</row>`);
const transactions=sheet(heading(['Tanggal','SKU','NamaBarang','From','To','Qty','Status'])+`<row r="2">${numeric('A2',46351)}<c r="B2" t="s"><v>0</v></c>${inline('C2','Barang Lama')}${inline('D2','Dock')}${inline('E2','A01')}${numeric('F2',7)}${inline('G2','Movement')}</row>`);
const tabs=['Kartu Stock','Stok Retail','Stok Bulky','Barang Masuk','Barang Keluar','Private'];
const files={
 'xl/workbook.xml':`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs.map((name,i)=>`<sheet name="${name}" r:id="r${i}"/>`).join('')}</sheets></workbook>`,
 'xl/_rels/workbook.xml.rels':`<Relationships>${tabs.map((_,i)=>`<Relationship Id="r${i}" Target="worksheets/s${i}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>`).join('')}</Relationships>`,
 'xl/styles.xml':'<styleSheet><numFmts><numFmt numFmtId="164" formatCode="0000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
 'xl/sharedStrings.xml':'<sst><si><t>0012</t></si></sst>',
 'xl/worksheets/s0.xml':stock('A01',0),
 'xl/worksheets/s1.xml':stock('B01',6),
 'xl/worksheets/s2.xml':stock('C01',9),
 'xl/worksheets/s3.xml':transactions,
 'xl/worksheets/s4.xml':transactions,
 'xl/worksheets/s5.xml':'<deliberately-invalid'
};
test('revision XLSX reads only selected stock and ledger tabs, preserving archived values',async()=>{
 const buffer=workbook(files);
 for(const [kind,location,qty] of [['stock','A01',0],['rpl','B01',6],['bulky','C01',9]]){
  const result=await readInventoryRevision(buffer,{kind,query:'0012'});
  assert.equal(result.total,1);
  assert.equal(result.rows[0].sku,'0012');
  assert.equal(result.rows[0].qty,qty);
  assert.equal(result.rows[0].location,location);
 }
 for(const kind of ['inbound','outbound']){
  const result=await readInventoryRevision(buffer,{kind});
  assert.equal(result.rows[0].date,'2026-11-25');
  assert.equal(result.rows[0].sku,'0012');
  assert.equal(result.rows[0].qty,7);
 }
 assert.equal((await readInventoryRevision(buffer,{kind:'stock',query:'new value'})).total,0);
});

test('a missing tab returns unavailable instead of reading another sheet',async()=>{
 const entries={...files};
 delete entries['xl/worksheets/s4.xml'];
 const buffer=workbook(entries);
 await assert.rejects(()=>readInventoryRevision(buffer,{kind:'outbound'}),/tidak dapat dibaca/);
});
