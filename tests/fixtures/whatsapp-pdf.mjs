export const textItem = (str,x,y) => ({str,transform:[1,0,0,1,x,y]});
export function transferPages({count = 2, transfer = '#T-007894'} = {}) {
  const items = [textItem(`Transfer ${transfer}`,40,770),textItem('Dari: IWT E-COM',40,750),textItem('Kepada: GOTO',40,730),textItem('Nomor Referensi: REF-01',40,710),
    textItem('Nama Produk',40,680),textItem('SKU',270,680),textItem('Jumlah',400,680),textItem('Diterima',450,680),textItem('Batal',500,680),textItem('Tolak',540,680),textItem('Catatan',580,680)];
  for(let i=0;i<count;i++) items.push(textItem(`MERLYN WHITE ${i}`,40,650-i*20),textItem(`000${i}`,270,650-i*20),textItem(String(i+1),400,650-i*20),textItem('0',450,650-i*20),textItem('0',500,650-i*20),textItem('0',540,650-i*20));
  items.push(textItem('Total',40,650-count*20));
  return [items];
}

export function buildPdf(pages = transferPages()) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const children=[];
  for(const page of pages) {
    const pageId=objects.length+1,contentId=pageId+1;
    children.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    const text=page.map(item=>`BT /F1 9 Tf 1 0 0 1 ${item.transform[4]} ${item.transform[5]} Tm (${item.str.replace(/[\\()]/g,char=>`\\${char}`)}) Tj ET`).join('\n');
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects[1]=`<< /Type /Pages /Kids [${children.join(' ')}] /Count ${pages.length} >>`;
  let text='%PDF-1.4\n',offsets=[0];
  for(let i=0;i<objects.length;i++) {offsets.push(text.length);text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=text.length;
  text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  text+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
