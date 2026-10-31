import base64, importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
IMPORTER=module('catalog_importer',Path(__file__).parents[1]/'scripts/import-catalog-xlsx.py')
PUBLISHER=module('catalog_publisher',Path(__file__).parents[1]/'scripts/publish-catalog-r2.py')
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
class ImportTests(unittest.TestCase):
    def fixture(self,path,rich=False,padding=False):
        with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_STORED) as z:
            z.writestr('xl/workbook.xml','<workbook xmlns:r="urn:r"><sheets><sheet name="Jika tidak ada di katalog" r:id="s1"/></sheets></workbook>')
            z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns:r="urn:r"><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>ITEM NAME</t></is></c><c r="C1" t="inlineStr"><is><t>PICTURE</t></is></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>Toy &amp; Box</t></is></c><c r="C2" '+('vm="1"' if rich else '')+'><f>_xlfn.DISPIMG("ID_PIC",1)</f></c></row></sheetData></worksheet>')
            z.writestr('xl/media/image1.png',PNG)
            if rich:
                z.writestr('xl/metadata.xml','<metadata><metadataTypes><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="XLRICHVALUE"><bk><extLst><rvb i="0"/></extLst></bk></futureMetadata><valueMetadata><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>')
                z.writestr('xl/richData/rdrichvaluestructure.xml','<rvStructures><s t="_localImage"><k n="_rvRel:LocalImageIdentifier"/></s></rvStructures>')
                z.writestr('xl/richData/rdrichvalue.xml','<rvData><rv s="0"><v>0</v></rv></rvData>')
                z.writestr('xl/richData/richValueRel.xml','<richValueRels xmlns:r="urn:r"><rel r:id="p1"/></richValueRels>')
                z.writestr('xl/richData/_rels/richValueRel.xml.rels','<Relationships><Relationship Id="p1" Target="../media/image1.png"/></Relationships>')
            else:
                z.writestr('xl/cellimages.xml','<cellImages xmlns:r="urn:r"><cellImage><pic><cNvPr name="ID_PIC"/><blip r:embed="p1"/></pic></cellImage></cellImages>')
                z.writestr('xl/_rels/cellimages.xml.rels','<Relationships><Relationship Id="p1" Target="media/image1.png"/></Relationships>')
            if padding:
                with z.open('unused/large-part','w') as part:
                    for _ in range(128):part.write(b'x'*1024*1024)
    def test_incell_dispimg_and_rich_data(self):
        for rich in [False,True]:
            with tempfile.TemporaryDirectory() as tmp:
                src=Path(tmp)/'source.xlsx';out=Path(tmp)/'out';self.fixture(src,rich)
                data=IMPORTER.extract(src,out);image=data['images'][0]
                self.assertEqual(image['name'],'Toy & Box');self.assertEqual(image['row'],2);self.assertEqual((out/image['path']).read_bytes(),PNG)
    def test_128mb_input_is_not_loaded_as_one_buffer(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'large.xlsx';self.fixture(src,padding=True);self.assertGreater(src.stat().st_size,128*1024*1024)
            self.assertEqual(len(IMPORTER.extract(src,Path(tmp)/'out')['images']),1)
    def test_publish_manifest_last_and_no_source_workbook_uploaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'source.xlsx';out=Path(tmp)/'out';self.fixture(src);IMPORTER.extract(src,out)
            class Client:
                calls=[]
                def put_object(self,**kwargs):self.calls.append(kwargs['Key'])
            client=Client();PUBLISHER.publish(out,'bydrz','https://'+'a'*32+'.r2.cloudflarestorage.com',client)
            self.assertTrue(client.calls[0].startswith('catalog-images/images/'));self.assertEqual(client.calls[-1],'catalog-images/manifest.json');self.assertFalse(any(key.endswith('.xlsx') for key in client.calls))
    def test_unsupported_or_empty_workbook_cannot_publish_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            src=Path(tmp)/'source.xlsx'
            with zipfile.ZipFile(src,'w') as z:z.writestr('xl/workbook.xml','<workbook/>')
            out=Path(tmp)/'out'
            with self.assertRaises(ValueError):IMPORTER.extract(src,out)
            self.assertFalse((out/'manifest.json').exists())
if __name__=='__main__':unittest.main()
