import test from 'node:test';import assert from 'node:assert/strict';import {deflateRawSync} from 'node:zlib';
import {catalogWorkbook,catalogRaster,boundedBytes} from '../functions/api/_catalog-embedded.js';
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
function zip(files){const blocks=[],directory=[];let offset=0;for(const [name,value]of Object.entries(files)){const label=Buffer.from(name),raw=Buffer.from(value),data=deflateRawSync(raw),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(label.length,26);blocks.push(local,label,data);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(label.length,28);central.writeUInt32LE(offset,42);directory.push(central,label);offset+=local.length+label.length+data.length;}const end=Buffer.alloc(22),dir=Buffer.concat(directory);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...blocks,dir,end]);}
const anchor=(row,col=2,kind='oneCellAnchor',id='image')=>`<xdr:${kind}><xdr:from><xdr:col>${col}</xdr:col><xdr:row>${row}</xdr:row></xdr:from><xdr:pic><a:blip r:embed="${id}"/></xdr:pic></xdr:${kind}>`;
const files={
 'xl/workbook.xml':'<workbook><sheets><sheet name="Jika tidak ada di katalog" r:id="second"/><sheet name="1. Product Catalog" r:id="first"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="second" Target="worksheets/sheet7.xml"/><Relationship Id="first" Target="worksheets/sheet2.xml"/></Relationships>',
 'xl/worksheets/sheet7.xml':'<worksheet><drawing r:id="draw"/></worksheet>',
 'xl/worksheets/_rels/sheet7.xml.rels':'<Relationships><Relationship Id="draw" Target="../drawings/drawing3.xml"/></Relationships>',
 'xl/drawings/drawing3.xml':'<xdr:wsDr>'+anchor(1)+anchor(2,2,'twoCellAnchor')+anchor(3,1)+anchor(4,2,'oneCellAnchor','remote')+'</xdr:wsDr>',
 'xl/drawings/_rels/drawing3.xml.rels':'<Relationships><Relationship Id="image" Target="../media/photo.png"/><Relationship Id="remote" Target="https://private.example/photo.png" TargetMode="External"/></Relationships>',
 'xl/media/photo.png':png,
 'xl/worksheets/sheet2.xml':'<worksheet/>'};
test('embedded catalog images follow workbook relationships and exact cell row, not sheet order',async()=>{const book=await catalogWorkbook(zip(files));assert.deepEqual([...book.images.keys()],['supplement:2','supplement:3']);assert.deepEqual([...await book.read(book.images.get('supplement:2'))],[...png]);});
test('embedded parser rejects corrupt archives, XML entities and oversized responses',async()=>{await assert.rejects(()=>catalogWorkbook(new Uint8Array(22)));await assert.rejects(()=>catalogWorkbook(zip({...files,'xl/workbook.xml':'<!DOCTYPE workbook><workbook/>'})));await assert.rejects(()=>boundedBytes(new Response(new Uint8Array(20)),10));});
test('true in-cell images resolve vm metadata through rich-value structures and image relationships',async()=>{
 const book=await catalogWorkbook(zip({...files,
  'xl/worksheets/sheet7.xml':'<worksheet><sheetData><row r="2"><c r="C2" t="e" vm="2"><v>#VALUE!</v></c></row><row r="3"><c r="C3" t="e" vm="1"><v>#VALUE!</v></c></row><row r="4"><c r="D4" t="e" vm="2"><v>#VALUE!</v></c></row></sheetData></worksheet>',
  'xl/metadata.xml':'<metadata><metadataTypes><metadataType name="OTHER"/><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="XLRICHVALUE"><bk><extLst><ext><xlrd:rvb i="1"/></ext></extLst></bk></futureMetadata><valueMetadata><bk><rc t="1" v="0"/></bk><bk><rc t="2" v="0"/></bk></valueMetadata></metadata>',
  'xl/richData/rdrichvaluestructure.xml':'<rvStructures><s t="_localImage"><k n="CalcOrigin"/><k n="_rvRel:LocalImageIdentifier"/></s></rvStructures>',
  'xl/richData/rdrichvalue.xml':'<rvData><rv s="0"><v>5</v><v>99</v></rv><rv s="0"><v>5</v><v>0</v></rv></rvData>',
  'xl/richData/richValueRel.xml':'<richValueRels><rel r:id="photo"/></richValueRels>',
  'xl/richData/_rels/richValueRel.xml.rels':'<Relationships><Relationship Id="photo" Target="../media/photo.png"/></Relationships>'
 }));assert.deepEqual([...book.images], [['supplement:2','xl/media/photo.png']]);assert.deepEqual([...await book.read(book.images.get('supplement:2'))],[...png]);
});
test('DISPIMG in-cell images use exact identifiers and reject external image relationships',async()=>{
 const book=await catalogWorkbook(zip({...files,
  'xl/worksheets/sheet7.xml':'<worksheet><sheetData><c r="C2"><f>_xlfn.DISPIMG(&quot;ID_LOCAL&quot;,1)</f></c><c r="C3"><f>DISPIMG("ID_REMOTE",1)</f></c><c r="C4"><f>DISPIMG("ID_UNKNOWN",1)</f></c></sheetData></worksheet>',
  'xl/cellimages.xml':'<etc:cellImages><etc:cellImage><xdr:pic><xdr:cNvPr name="ID_LOCAL"/><a:blip r:embed="local"/></xdr:pic></etc:cellImage><etc:cellImage><xdr:pic><xdr:cNvPr name="ID_REMOTE"/><a:blip r:embed="remote"/></xdr:pic></etc:cellImage></etc:cellImages>',
  'xl/_rels/cellimages.xml.rels':'<Relationships><Relationship Id="local" Target="media/photo.png"/><Relationship Id="remote" Target="https://example.test/private" TargetMode="External"/></Relationships>'
 }));assert.deepEqual([...book.images],[['supplement:2','xl/media/photo.png']]);
});
