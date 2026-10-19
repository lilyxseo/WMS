# SEO WMS Goto Living

Hanya `https://gotoliving.id/` (halaman login) yang boleh diindeks. Data inventory tetap memerlukan autentikasi; aturan crawler tidak menggantikan otorisasi API.

## Perubahan

- Judul, description, canonical, Open Graph, Twitter summary, dan schema.org WebSite mendeskripsikan portal login.
- Sitemap hanya memuat URL login. Robots memblokir API, tetapi mengizinkan crawler membaca header noindex pada halaman internal.
- Pages middleware memberi `X-Robots-Tag: noindex, nofollow, noarchive` pada rute internal, URL dengan query, preview deploy, dan respons gagal. Hanya HTML 200 di root host utama yang indexable.
- `/login` diarahkan permanen ke `/`. Cloudflare Pages memakai SPA fallback bawaan; aturan rewrite catch-all lama dihapus karena dideteksi sebagai infinite loop oleh Wrangler.
- CSS lokal digabung saat build dengan urutan cascade tetap. Font dimuat dari head, ikon memakai defer, dan scanner dimuat ketika dibuka melalui loader/fallback yang sudah ada.
- Ukuran intrinsik logo mengurangi pergeseran layout. Tema default dan informasi publik tetap tampil jika JavaScript tidak berjalan; konten app tetap tersembunyi sebelum login.

## Hasil validasi

Lighthouse 12.8.2, Chromium, kategori SEO pada build lokal: **82 → 100**. Sebelumnya meta description tidak ada dan robots.txt menerima HTML fallback. Sesudah perubahan semua audit SEO otomatis lulus. Ini hasil pengujian lokal, bukan bukti ranking Google atau skor PageSpeed produksi; koneksi layanan pihak ketiga dan metrik pengguna nyata dapat berbeda.

481 tes Node lulus, termasuk header noindex, sitemap, metadata, dan penggabungan CSS. Uji browser desktop/mobile memakai auth/CDN mock memverifikasi login, validasi form, tampilan tanpa JavaScript, serta tidak adanya prefetch scanner/inventory sebelum login. Emulator Cloudflare memverifikasi root indexable, halaman internal noindex, API tanpa autentikasi tetap 401, robots/sitemap tersedia dan redirect login berjalan.

Sitemap dapat dikirim ke Google Search Console: `https://gotoliving.id/sitemap.xml`. Search Console belum diverifikasi dari sesi ini. Jika domain utama berubah, perbarui host middleware, canonical/schema/social URLs, robots, sitemap, dan pengujiannya bersamaan.
