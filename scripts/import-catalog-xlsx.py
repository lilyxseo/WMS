#!/usr/bin/env python3
"""Offline, bounded XLSX image extraction. Never run inside a request Worker."""
import argparse, hashlib, json, posixpath, re, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

TABS = {'1. Product Catalog': ('main', 'B'), 'Jika tidak ada di katalog': ('supplement', 'C')}
def local(tag): return tag.rsplit('}', 1)[-1]
def attr(node, key): return next((v for k,v in node.attrib.items() if local(k)==key), '')
def children(node, name): return [] if node is None else [x for x in node if local(x.tag)==name]
def nodes(node, name): return [] if node is None else [x for x in node.iter() if local(x.tag)==name]
def first(node, name): return next(iter(nodes(node, name)), None)
def text(node): return '' if node is None else ''.join(node.itertext())
def integer(value, default=-1):
    try: return int(value)
    except (ValueError, TypeError): return default

def extract(source, output):
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as book:
        parts = {entry.filename: entry for entry in book.infolist()}
        if len(parts)>50000 or sum(x.file_size for x in parts.values())>2*1024**3: raise ValueError('Workbook exceeds offline extraction budget')
        def read(path, limit=64*1024**2):
            entry=parts.get(path)
            if entry is None: return b''
            if entry.file_size>limit or entry.flag_bits&1: raise ValueError('Unsupported or oversized workbook part: '+path)
            return book.read(entry)
        def xml(path):
            data=read(path)
            if not data: return None
            if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError('Unsafe XML')
            return ET.fromstring(data)
        def relations(path):
            rel=posixpath.join(posixpath.dirname(path),'_rels',posixpath.basename(path)+'.rels')
            result={}
            for item in nodes(xml(rel),'Relationship'):
                target=item.get('Target','')
                if item.get('TargetMode')=='External' or '://' in target: continue
                target=posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(path),target))
                if target.startswith('../'): raise ValueError('Relationship outside workbook')
                result[item.get('Id')]=target
            return result
        strings=[text(item) for item in nodes(xml('xl/sharedStrings.xml'),'si')]
        def value(cell):
            if cell is None: return ''
            raw=text(first(cell,'v'))
            return strings[integer(raw)] if cell.get('t')=='s' and 0<=integer(raw)<len(strings) else text(first(cell,'is')) if cell.get('t')=='inlineStr' else raw
        cellmap={}; cellrels=relations('xl/cellimages.xml')
        for item in nodes(xml('xl/cellimages.xml'),'cellImage'):
            nv=first(item,'cNvPr'); blip=first(item,'blip')
            if nv is not None and blip is not None: cellmap[nv.get('name')]=cellrels.get(attr(blip,'embed'))
        metadata=xml('xl/metadata.xml'); types=children(first(metadata,'metadataTypes'),'metadataType'); blocks=children(first(metadata,'valueMetadata'),'bk')
        future={x.get('name'):children(x,'bk') for x in nodes(metadata,'futureMetadata')}
        structures=children(xml('xl/richData/rdrichvaluestructure.xml'),'s'); rich=children(xml('xl/richData/rdrichvalue.xml'),'rv')
        richrel=relations('xl/richData/richValueRel.xml'); richimages=[richrel.get(attr(x,'id')) for x in children(xml('xl/richData/richValueRel.xml'),'rel')]
        def rich_image(cell):
            vm=integer(cell.get('vm'))-1
            if not 0<=vm<len(blocks): return None
            for rc in children(blocks[vm],'rc'):
                typ=integer(rc.get('t'))-1
                if not 0<=typ<len(types) or types[typ].get('name')!='XLRICHVALUE': continue
                fut=future.get('XLRICHVALUE',[]); idx=integer(rc.get('v'))
                if not 0<=idx<len(fut): continue
                rvb=first(fut[idx],'rvb'); index=integer(rvb.get('i') if rvb is not None else None)
                if not 0<=index<len(rich): continue
                rv=rich[index]; struct=integer(rv.get('s'))
                if not 0<=struct<len(structures) or structures[struct].get('t')!='_localImage': continue
                keys=children(structures[struct],'k'); col=next((i for i,k in enumerate(keys) if k.get('n')=='_rvRel:LocalImageIdentifier'),-1); vals=children(rv,'v')
                if not 0<=col<len(vals): continue
                image=integer(text(vals[col]))
                if 0<=image<len(richimages): return richimages[image]
            return None
        workbook=xml('xl/workbook.xml'); links=relations('xl/workbook.xml'); result=[]; warnings=[]; used=set()
        for tab in nodes(workbook,'sheet'):
            title=tab.get('name'); spec=TABS.get(title)
            if not spec: continue
            source_key,picture_col=spec; path=links.get(attr(tab,'id'))
            if not path: raise ValueError('Missing worksheet relationship')
            sheet=xml(path); cells={x.get('r'):x for x in nodes(sheet,'c')}; images={}
            headers={}
            for row in nodes(sheet,'row')[:15]:
                found={re.sub('[^a-z0-9]','',value(c).lower()):re.sub('[0-9]','',c.get('r','')) for c in children(row,'c')}
                if 'itemname' in found or 'namabarang' in found:
                    headers=found; break
            name_col=headers.get('itemname',headers.get('namabarang','B' if source_key=='supplement' else 'J')); sku_col=headers.get('itemid',headers.get('sku','D' if source_key=='main' else ''))
            for address,cell in cells.items():
                match=re.fullmatch(picture_col+r'([1-9][0-9]*)',address or '')
                if not match: continue
                formula=text(first(cell,'f')); disp=re.search(r'(?:^|\.)DISPIMG\(\s*"([^"]+)"',formula,re.I)
                media=rich_image(cell) or (cellmap.get(disp.group(1)) if disp else None)
                if media: images[int(match.group(1))]=media
            drawingrels=relations(path)
            for drawing in nodes(sheet,'drawing'):
                drawingpath=drawingrels.get(attr(drawing,'id'))
                if not drawingpath: continue
                mediarels=relations(drawingpath)
                for anchor in list(xml(drawingpath) or []):
                    origin=first(anchor,'from'); row=integer(text(first(origin,'row')))+1; col=integer(text(first(origin,'col')))
                    if origin is None or col!=(1 if source_key=='main' else 2): continue
                    blip=first(anchor,'blip')
                    if blip is not None and row not in images: images[row]=mediarels.get(attr(blip,'embed'))
            for row,media in sorted(images.items()):
                name=value(cells.get(name_col+str(row))).strip(); sku=value(cells.get(sku_col+str(row))).strip() if sku_col else ''
                if not name or not media or not media.startswith('xl/media/'): continue
                data=read(media,16*1024**2)
                ext='png' if data.startswith(b'\x89PNG\r\n\x1a\n') else 'jpg' if data.startswith(b'\xff\xd8\xff') else 'gif' if data.startswith((b'GIF87a',b'GIF89a')) else 'webp' if data[:4]==b'RIFF' and data[8:12]==b'WEBP' else ''
                if not ext: warnings.append({'source':source_key,'row':row,'reason':'unsupported raster'}); continue
                digest=hashlib.sha256(data).hexdigest(); key='images/'+digest+'.'+ext
                target=output/key;target.parent.mkdir(exist_ok=True)
                if key not in used: target.write_bytes(data); used.add(key)
                result.append({'source':source_key,'row':row,'name':name,'sku':sku,'path':key})
        if not result: raise ValueError('No product images mapped. No manifest published.')
        manifest={'version':1,'images':result}; encoded=json.dumps(manifest,ensure_ascii=False).encode('utf-8')
        if len(result)>20000 or len(encoded)>4*1024**2: raise ValueError('Manifest exceeds runtime reader limits')
        (output/'manifest.json').write_bytes(encoded)
        (output/'report.json').write_text(json.dumps({'mapped':len(result),'uniqueImages':len(used),'warnings':warnings},ensure_ascii=False),encoding='utf-8')
        return manifest
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);args=parser.parse_args();data=extract(args.input,args.output);print('Mapped product images:',len(data['images']))
