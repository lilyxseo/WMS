# Katalog XLSX besar → R2

Sumber yang diberikan: `https://pub-d550f2ac7586491f92f3facc9ed64b1a.r2.dev/KATALOG%20UPDATE.xlsx`, bucket `bydrz`. File asli tidak dimodifikasi. Worker tidak mengunduh/membongkar workbook.

## Proses otomatis

Workflow **Import catalog XLSX images to R2** berjalan ketika importer di-push ke main, atau manual melalui Actions. Runner mengunduh maksimal 256 MiB ke disk, mengekstrak media satu per satu, memetakan gambar DISPIMG/cellimages, rich-data incell, dan drawing anchor ke sheet/baris/nama/SKU. XML dan ukuran uncompressed dibatasi; gambar raster diidentifikasi dari signature. Sel yang tidak dapat dipetakan tidak diterka. Jika tidak ada pemetaan yang valid, manifest tidak diterbitkan.

Hasil ekstraksi (`images/`, `manifest.json`, `report.json`) menjadi artifact Actions selama 3 hari. Bagian upload menggunakan GitHub secrets berikut (jangan ditempel di chat/repository):

- `R2_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
- `R2_ACCESS_KEY_ID` dan `R2_SECRET_ACCESS_KEY`: kredensial S3 R2 dengan izin tulis terbatas pada bucket `bydrz`.

Gambar di-upload ke `catalog-images/images/<sha256>.<ext>`, manifest ke `catalog-images/manifest.json` **setelah** seluruh upload gambar berhasil. Tidak ada penghapusan object lama. Jika secrets belum tersedia, tahap publikasi gagal secara eksplisit; artifact hasil ekstraksi tetap dapat diunduh. Tautan publik R2 tidak memberikan izin upload dengan sendirinya.

## Aktifkan pembacaan di website

Tambahkan variabel server Cloudflare Pages:

```
CATALOG_R2_BASE_URL=https://pub-d550f2ac7586491f92f3facc9ed64b1a.r2.dev/catalog-images
```

Redeploy setelah manifest berhasil diterbitkan. Katalog menggunakan manifest R2 lebih dahulu; nama produk dan baris harus cocok dengan sheet saat ini. Browser tetap memakai endpoint gambar WMS yang memerlukan login. Link Img pada katalog utama tetap diprioritaskan. Manifest hasil impor adalah snapshot: perubahan/moves gambar pada sheet memerlukan impor ulang. Jika manifest R2 gagal dan Apps Script masih dikonfigurasi, server dapat memakai fallback lama. Untuk menggunakan R2 saja, hapus konfigurasi Apps Script setelah verifikasi.

## Jalankan lokal

```
python scripts/fetch-catalog-workbook.py --url '<public R2 URL>' --output /tmp/catalog.xlsx
python scripts/import-catalog-xlsx.py --input /tmp/catalog.xlsx --output /tmp/catalog-extracted
python scripts/publish-catalog-r2.py --directory /tmp/catalog-extracted --bucket bydrz
```

Importer memakai stdlib Python; publisher memerlukan boto3. `python -m unittest discover -s tests -p 'test_catalog_xlsx_import.py'` mencakup fixture XLSX lebih dari 128 MiB, DISPIMG, rich-data, dan publikasi manifest terakhir. Pengujian fixture tidak membuktikan semua gambar pada file produksi terpetakan. Periksa `report.json` dan sampel nama/baris/gambar dari artifact sebelum menyatakan impor produksi berhasil.
