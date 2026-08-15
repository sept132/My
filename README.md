<div align="center">

# My — Personal Assistant & Productivity Suite

**Satu aplikasi untuk semua kebutuhanmu.** Asisten pribadi berbasis AI + 8 fitur produktivitas dalam satu aplikasi — berjalan sebagai **web app** dan **aplikasi Android** (Capacitor).

![Platform](https://img.shields.io/badge/Platform-Web%20%26%20Android-7857FB)
![Stack](https://img.shields.io/badge/Stack-Vanilla%20JS%20%2B%20Capacitor%208-EB5FAF)
![AI](https://img.shields.io/badge/AI-Gemini-22C98B)
![Storage](https://img.shields.io/badge/Storage-Local%20%2B%20Offline-60A5FA)

</div>

---

## Fitur & Cara Kerjanya

| Fitur | Fungsi |
|---|---|
| **My Ask** | Personal Assistant berbasis AI (chat, kamera, file) |
| **My Keuangan** | Catat transaksi, target tabungan & grafik |
| **My Catatan** | Catatan pribadi dengan pencarian instan |
| **My Buku Kuliah** | Arsip buku, catatan kuliah & dokumen per mata kuliah |
| **My Kalender** | Agenda harian & event dengan penanda warna |
| **My Pengingat** | Pengingat berulang (Senin–Minggu) + notifikasi |
| **My Maps** | Peta GPS, penanda, navigasi + ETA, Route Memory |
| **My PDF Tool** | Konversi PDF → Gambar & PDF → DOCX |
| **My Academic Studio** | Workspace skripsi/TA: 9 langkah hingga export |

### My Ask — Personal Assistant
Asisten AI yang bisa kamu ajak bicara apa saja.
- **Cara kerja:** dikelola per *project obrolan* — buat project baru, pilih mode, kirim pesan, dan riwayat tersimpan otomatis di perangkat.
- **Mode:** Chat · Explain This (arahkan kamera ke objek/teks/diagram untuk dijelaskan) · Ask My Life (pertanyaan personal) · What If? (simulasi skenario).
- **Lampiran:** kirim gambar/PDF/TXT/CSV/JSON ke dalam obrolan.
- **Saran pertanyaan:** satu ketukan untuk memulai, tombol *Acak Suggestion* untuk ide baru.

### My Keuangan
Kelola uang harianmu dengan ringkas.
- **Cara kerja:** tambah transaksi (pemasukan/pengeluaran) → saldo aktif, grafik distribusi, dan riwayat diperbarui otomatis.
- **Scan Struk:** potret struk dengan kamera untuk mencatat pengeluaran lebih cepat.
- **Target Tabungan (Savings):** tentukan target dan pantau progres persentasenya.

### My Catatan
Tempat menyimpan ide & catatan penting.
- **Cara kerja:** ketuk **Catatan Baru**, tulis judul + isi, lalu simpan — setiap catatan tampil sebagai kartu yang bisa dibuka, diedit, atau dihapus.
- **Cari instan:** ketik di kolom pencarian, daftar langsung tersaring.

### My Buku Kuliah
Arsip kuliah terorganisir per buku.
- **Cara kerja:** buat buku (judul + dosen) → buka detailnya → tulis **Catatan & Dokumen**: rangkuman, foto kamera, atau unggah PDF/DOCX/PPT yang menempel ke buku tersebut.
- **Editor khusus:** halaman editor dengan galeri foto & daftar lampiran sebelum disimpan.

### My Kalender
Tandai tanggal penting & kegiatan.
- **Cara kerja:** navigasi bulan → pilih tanggal → tambah event dengan warna → event tampil di daftar hari tersebut.
- **Integrasi:** event yang jatuh hari ini muncul di **Agenda Hari Ini** di Beranda.

### My Pengingat
Tidak ada lagi yang terlewat.
- **Cara kerja:** tambah pengingat dengan jam + hari berulang (Senin–Minggu) → **centang saat selesai** dan item menghilang otomatis dari Agenda & daftar (data tetap tersimpan).
- **Notifikasi:** saat diaktifkan (tombol lonceng), pengingat & event kalender dikirim sebagai notifikasi sistem.

### My Maps
Peta GPS lengkap untuk navigasi harian.
- **Cara kerja:** **Lokasi Saya** memusatkan peta ke posisi GPS-mu. Ketuk titik mana pun untuk: **Navigasi** (rute + jarak + estimasi waktu + ETA real-time), **Simpan**, **Tandai**, **Bagikan**, atau **Salin Koordinat**.
- **Route Memory:** simpan rute favorit dan buka lagi kapan saja.
- **Map + Kamera:** foto lokasi dengan overlay peta, tersimpan beserta info lokasi & waktu.
- **Mode Penanda:** aktifkan mode bebas, ketuk peta untuk menambah titik.

### My PDF Tool
Utilitas dokumen tanpa aplikasi lain.
- **PDF to Image:** unggah PDF → render setiap halaman menjadi gambar.
- **PDF to DOCX:** pipeline rekonstruksi layout PDF menjadi dokumen Word yang bisa diedit.

### My Academic Studio
Workshop dokumen akademik (Skripsi, Makalah, Proposal, Review Jurnal).
- **Cara kerja 9 langkah:** 1) Profile & Rules → 2) Instruksi → 3) Sumber Data → 4) Outlines → 5) Penulisan Bab → 6) Sitasi & Referensi → 7) Cek Kepatuhan → 8) Preview → 9) **Export DOCX/PDF**.
- **Academic Profiles:** hierarki aturan Institusi → Fakultas → Prodi → Dosen → Custom (Level 1–6).
- **Ingest Pedoman:** unggah PDF/DOCX pedoman kampus untuk mengekstrak aturan penulisan resmi.

---

## Cara Penggunaan

### 1. Mulai dari Beranda
- **Sapaan & lonceng:** ketuk nama/avatar untuk menu profil; ketuk tombol lonceng untuk mengaktifkan/menonaktifkan notifikasi.
- **Cari cepat:** ketik di *"Cari apa saja di My..."* untuk menemukan konten di seluruh fitur.
- **Layanan Utama:** ketuk kartu fitur untuk langsung membuka halamannya.

### 2. Navigasi
- **Bottom navigation:** Beranda · Chat · tombol + (buat cepat) · Keuangan · Kalender.
- **Tombol +:** membuat Catatan, Transaksi, Pengingat, Buku, Dokumen Akademik, atau PDF langsung dari satu tempat.
- Di dalam fitur, gunakan **tombol kembali bulat** untuk kembali.

### 3. Data kamu
- Semua data tersimpan **lokal di perangkat** (localStorage / penyimpanan internal Android) — tidak ada akun wajib.
- Di **Settings** kamu bisa mem-backup/restore data, mengatur izin (notifikasi, kamera, lokasi), dan mengelola pengaturan aplikasi.

---

## Fitur Native di Dalam APK

- **`window.AndroidBridge`** — file foto/dokumen disimpan di penyimpanan internal HP (bukan IndexedDB) lewat `saveFile` / `readFile` / `deleteFile`.
- **Backup ke Downloads** — `saveBackupZipToDownloads` menyimpan file `.zip` ke folder Downloads lewat MediaStore (API 29+ tanpa izin tambahan).
- **Izin runtime** — kamera, lokasi, dan notifikasi diminta otomatis saat pertama kali digunakan.
- **Notifikasi lokal** — pengingat & event kalender dijadwalkan lewat `@capacitor/local-notifications`.
- **Offline** — semua library & font di-`vendor` lokal, jadi UI tetap berfungsi tanpa internet. (Fitur AI, tile peta, dan geocoding tetap butuh koneksi.)

---

## Catatan Rilis

- `appId`: `com.sept132.myapk` — ubah di `capacitor.config.json` jika ingin mengganti identitas aplikasi.
- Ikon & splash masih default Capacitor; ganti `android/app/src/main/res/mipmap-*` dan `drawable*/splash.png` untuk branding sendiri.
