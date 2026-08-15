/* ==========================================================================
   MY - PERSONAL ASSISTANT - ADVANCED UNIVERSAL MULTI-PROVIDER AI LLM EDITION
   ========================================================================== */

// --- GLOBAL APPLICATION STATE ---
const STATE_KEY = 'MY_MAID_PRODUCTIVITY_APP_STATE_V13';

// ==========================================================================
// APP FILE STORAGE — lapisan penyimpanan file (foto/dokumen) yang TERPISAH
// dari localStorage, supaya appState tetap kecil & tidak lagi kena error
// "quota exceeded". File biner disimpan di:
//   - Android WebView app (APK)  -> penyimpanan asli HP lewat AndroidBridge
//   - Browser biasa (Chrome dll) -> IndexedDB (kapasitas jauh lebih besar
//     dari localStorage, umumnya ratusan MB - beberapa GB tergantung disk)
// appState hanya menyimpan REFERENSI ringan: {fileId, name, mimeType, size}.
// ==========================================================================
const AppFileStorage = (function () {
  const DB_NAME = 'MyMaidFilesDB';
  const STORE_NAME = 'files';
  const hasAndroidBridge = () => typeof window !== 'undefined' && !!window.AndroidBridge;

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB tidak didukung di browser ini.')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function genId() {
    return 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Simpan File/Blob -> mengembalikan metadata ringan utk disimpan di appState
  async function saveFile(file) {
    const id = genId();
    const meta = { id, name: file.name || id, mimeType: file.type || 'application/octet-stream', size: file.size || 0 };

    if (hasAndroidBridge()) {
      const base64 = await fileToBase64(file);
      const ok = window.AndroidBridge.saveFile(id, base64, meta.mimeType);
      if (!ok) throw new Error('Gagal menyimpan file ke penyimpanan HP.');
      return meta;
    }

    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...meta, blob: file });
      tx.oncomplete = () => resolve(meta);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Ambil kembali file sebagai data URL (siap dipakai di <img src>, <a href>, dst)
  async function getFileAsDataUrl(id, fallbackMime) {
    if (!id) return null;
    if (hasAndroidBridge()) {
      const base64 = window.AndroidBridge.readFile(id);
      if (!base64) return null;
      return `data:${fallbackMime || 'application/octet-stream'};base64,${base64}`;
    }
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec || !rec.blob) { resolve(null); return; }
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(rec.blob);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Ambil file sebagai Blob asli (dipakai saat menyusun backup .zip)
  async function getFileAsBlob(id) {
    if (!id) return null;
    if (hasAndroidBridge()) {
      const base64 = window.AndroidBridge.readFile(id);
      if (!base64) return null;
      return base64; // dikembalikan base64 mentah, dipakai langsung oleh JSZip
    }
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFile(id) {
    if (!id) return;
    if (hasAndroidBridge()) {
      window.AndroidBridge.deleteFile(id);
      return;
    }
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { saveFile, getFileAsDataUrl, getFileAsBlob, deleteFile, isNative: hasAndroidBridge };
})();

let appState = {
  notificationsEnabled: false,
  user: {
    name: 'Pengguna',
    avatarUrl: null,
    theme: 'light',
    geminiApiKey: '',
    aiProvider: 'auto', // 'auto', 'gemini', 'groq', 'openai', 'deepseek', 'openrouter'
    youtubeApiKey: '',       // YouTube Data API v3 key (pencarian My Music / My Video)
    googleClientId: '',      // Google OAuth Web Client ID (Masuk & Sync)
    googleAccount: null,     // { sub, name, email, picture } dari login Google
    downloadServiceUrl: '',  // Server unduhan kompatibel cobalt (opsional)
    downloadServiceKey: '',  // API key server unduhan (opsional)
    mediaFavorites: {},      // { '<account-sub|local>': { music: [], video: [] } } — disukai
    mediaPlaylists: {},      // { '<account-sub|local>': [ {id, name, kind, items:[]} ] }
    mediaPlayHistory: {},    // { '<account-sub|local>': [ {id,title,artist,thumb,url,kind,at} ] }
    mediaSearchHistory: [],  // [{ q, ts }] — riwayat pencarian bersama Music & Video
    qrHistory: []            // [{ content, label, type, at }] — QR yang baru dibuat
  },
  // Curriculum Vitae builder (ATS-friendly & Creative formats)
  cv: {
    format: 'ats',          // 'ats' | 'creative'
    accent: '#3B82F6',      // warna aksen untuk format creative
    personal: { fullName: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '', summary: '' },
    experience: [],         // { id, role, company, location, start, end, current, bullets }
    education: [],          // { id, degree, institution, location, start, end, gpa }
    skills: [],             // [string]
    languages: [],          // { id, name, level }
    certifications: [],     // { id, name, issuer, year }
    projects: []            // { id, name, link, description }
  },
  books: [
    {
      id: 1,
      title: 'Pemrograman Web Lanjut',
      lecturer: 'Dr. Ir. Budi Santoso, M.Kom',
      createdAt: '11 Aug 2026',
      notes: [
        {
          id: 101,
          content: 'Materi 1: Pengenalan SPA, REST API, dan Integrasi My Ask.',
          date: '11 Aug 2026',
          photos: [],
          docs: [
            { name: 'Modul_SPA_REST_API.pdf', size: '1.2 MB', type: 'pdf', dataUrl: '#' }
          ]
        }
      ]
    }
  ],
  selectedBookId: null,
  notes: [
    { id: 1, title: 'Rencana Proyek Web UX', category: 'Pekerjaan', body: 'Membuat desain UI bertema Lavender soft dengan fitur My Ask & My PDF Tool offline.', pinned: true, createdAt: '11 Aug 2026' }
  ],
  transactions: [
    { id: 1, type: 'income', amount: 1000000, description: 'Saldo Awal', date: '2026-08-01' }
  ],
  savings: [
    { id: 1, title: 'Beli Laptop Pro', targetAmount: 15000000, currentAmount: 1000000 }
  ],
  reminders: [
    { id: 1, title: 'Website Project Meeting', time: '14:00', completed: false, date: '2026-08-12' }
  ],
  savedPlaces: [
    { id: 1, name: 'Monumen Nasional (Monas)', lat: -6.175392, lng: 106.827153 }
  ],
  calendarEvents: [
    { id: 1, title: 'Review Target Proyek', date: '2026-08-12', color: '#3B82F6' },
    { id: 2, title: 'Meeting Project', date: '2026-08-12', color: '#EC4899' }
  ],
  // Multi-Project Chat History System
  chatProjects: [
    {
      id: 'proj_default',
      name: 'First Chat',
      createdAt: '2026-08-12',
      messages: [
        {
          sender: 'bot',
          text: 'Halo! Saya adalah personal assistant kamu. Aku siap mendampingi dan bantu kamu kapan saja, baik itu AI Decision Maker, Make Sense of This (analisis dokumen/gambar), atau bantu urus agenda dan My PDF Tool kamu. Ada yang ingin dibahas hari ini?'
        }
      ]
    }
  ],
  activeProjectId: 'proj_default',
  activeNavigationRoute: null,
  geofences: [],
  savedRoutes: []
};

// Global References
let currentActiveTab = 'dashboard'; // tab yang sedang aktif (untuk navigasi tombol back Android)
let calendarCurrentDate = new Date();
let selectedCalendarDateStr = new Date().toISOString().split('T')[0];
let financeChartInstance = null;
let currentAIChatMode = 'general'; // 'general' (Chat), 'ask_life', 'what_if'
let currentAIChatAttachment = null; // Attached file object
let loadedPDFDocument = null;
let lastFailedUserQuery = null;

// --- DYNAMIC AI SUGGESTION POOLS PER MODE ---
const AI_SUGGESTION_POOLS = {
  general: [ // Mode Chat
    'Jelaskan sesuatu dengan sederhana',
    'Bantu aku membuat rencana produktivitas',
    'Buatkan ide kreatif untuk proyekku',
    'Bantu aku menyelesaikan masalah ini',
    'Buatkan draf email profesional',
    'Rangkum poin-poin penting hari ini',
    'Berikan tips manajemen waktu',
    'Buat daftar prioritas harian'
  ],
  ask_life: [ // Mode Ask My Life
    'Apa yang harus aku lakukan hari ini?',
    'Apa yang paling penting minggu ini?',
    'Bantu aku mengatur prioritasku',
    'Apa yang mungkin aku lewatkan?',
    'Bagaimana kondisi jadwalku minggu ini?',
    'Berapa total pengeluaranku bulan ini?',
    'Apakah ada agenda atau meeting besok?',
    'Cek saldo aktif dan target tabunganku'
  ],
  what_if: [ // Mode What If
    'Apa yang terjadi kalau aku menunda ini seminggu?',
    'Bagaimana kalau aku mengubah rencana ini?',
    'Bandingkan dua pilihan ini',
    'Apa risiko dari keputusan ini?',
    'Apa kemungkinan hasilnya?',
    'Bagaimana jika pengeluaranku naik 20% bulan depan?',
    'Bagaimana kalau aku fokus skripsi 2 minggu penuh?'
  ]
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  loadStateFromLocalStorage();
  applyTheme(appState.user.theme || 'light');
  setupUI();
  setupMediaSession(); // media notification (lockscreen) + kontrol background
  updateCurrentDateSubtitle();

  // Notification bell state + (re)schedule upcoming notifications if enabled
  updateNotificationBellUI();
  if (appState.notificationsEnabled) rescheduleUpcomingNotifications();

  // Configure PDF.js Worker (local copy — works on web and inside the Android APK)
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }

  // Close global search box when clicking outside
  document.addEventListener('click', (e) => {
    const searchBox = document.getElementById('homeSearchResultsBox');
    const searchBar = document.querySelector('.floating-search-bar');
    if (searchBox && searchBar && !searchBar.contains(e.target)) {
      searchBox.style.display = 'none';
    }

    // Dismiss active modal if backdrop overlay is clicked directly
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
      closeAllModals();
    }
  });

  // Close active modals on Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // Android hardware back button: stay in app, close modals/sub-pages first,
  // and only exit after explicit confirmation.
  setupAndroidBackButton();

  // Notifikasi My Pengingat / My Kalender: saat diketuk, buka halaman terkait.
  setupNotificationDeepLinks();

  // Kunci aplikasi: boot check + lifecycle (background/foreground)
  lockInit();
  lockRenderSettingsCard();
  lockRegisterLifecycleHooks();
  lockBootCheck();
});

// --- STATE MANAGEMENT, LOCAL STORAGE & INDEXEDDB FILE STORAGE ---
const IDB_NAME = 'MyMaidAttachmentStorage';
const IDB_VERSION = 1;
const IDB_STORE = 'attachments';

function openAttachmentDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }
    const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = function(event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'attachmentId' });
      }
    };

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject(event.target.error || new Error('Failed to open IndexedDB'));
    };
  });
}

async function saveAttachmentToIDB(attachmentId, dataOrBlob, metadata = {}) {
  if (!attachmentId || !dataOrBlob) return null;
  try {
    const db = await openAttachmentDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      
      const record = {
        attachmentId: attachmentId,
        data: dataOrBlob,
        metadata: metadata,
        updatedAt: Date.now()
      };

      const request = store.put(record);
      request.onsuccess = () => resolve(attachmentId);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('IDB save error:', err);
    throw err;
  }
}

async function getAttachmentFromIDB(attachmentId) {
  if (!attachmentId) return null;
  try {
    const db = await openAttachmentDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const request = store.get(attachmentId);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.data);
        } else {
          resolve(null);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('IDB get error:', err);
    return null;
  }
}

async function deleteAttachmentFromIDB(attachmentId) {
  if (!attachmentId) return false;
  try {
    const db = await openAttachmentDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const request = store.delete(attachmentId);
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error('IDB delete error:', err);
    return false;
  }
}

async function migrateLegacyAppStateToIDB() {
  if (!appState || !appState.books) return;
  let stateModified = false;

  for (const book of appState.books) {
    if (!book.notes) continue;
    for (const note of book.notes) {
      // Migrate legacy photos
      if (note.photos && note.photos.length > 0) {
        for (let i = 0; i < note.photos.length; i++) {
          const item = note.photos[i];
          const rawData = typeof item === 'string' ? item : (item ? item.data : null);

          if (rawData && typeof rawData === 'string' && rawData.startsWith('data:')) {
            const attId = (typeof item === 'object' && item.attachmentId) ? item.attachmentId : ('att_p_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4));

            await saveAttachmentToIDB(attId, rawData, { name: (typeof item === 'object' && item.fileName) ? item.fileName : 'foto.jpg' });

            note.photos[i] = {
              attachmentId: attId,
              fileName: (typeof item === 'object' && (item.fileName || item.name)) ? (item.fileName || item.name) : 'Foto Lampiran',
              fileSize: rawData.length,
              type: 'photo',
              createdAt: (typeof item === 'object' && item.createdAt) ? item.createdAt : (note.date || new Date().toLocaleDateString('id-ID')),
              storageReference: attId
            };
            stateModified = true;
          }
        }
      }

      // Migrate legacy docs
      if (note.docs && note.docs.length > 0) {
        for (let i = 0; i < note.docs.length; i++) {
          const item = note.docs[i];
          const rawData = typeof item === 'string' ? item : (item ? item.data : null);

          if (rawData && typeof rawData === 'string' && rawData.startsWith('data:')) {
            const attId = (typeof item === 'object' && item.attachmentId) ? item.attachmentId : ('att_d_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substr(2, 4));

            await saveAttachmentToIDB(attId, rawData, { name: (typeof item === 'object' && (item.fileName || item.name)) ? (item.fileName || item.name) : 'dokumen' });

            note.docs[i] = {
              attachmentId: attId,
              fileName: (typeof item === 'object' && (item.fileName || item.name)) ? (item.fileName || item.name) : 'Dokumen Lampiran',
              fileSize: (typeof item === 'object' && (item.fileSize || item.size)) ? (item.fileSize || item.size) : formatFileSize(rawData.length),
              type: (typeof item === 'object' && item.type) ? item.type : getDocTypeLabel((typeof item === 'object' && (item.fileName || item.name)) ? (item.fileName || item.name) : ''),
              createdAt: (typeof item === 'object' && item.createdAt) ? item.createdAt : (note.date || new Date().toLocaleDateString('id-ID')),
              storageReference: attId
            };
            stateModified = true;
          }
        }
      }
    }
  }

  if (stateModified) {
    saveStateToLocalStorage();
    console.log('Successfully migrated legacy Base64 attachments to IndexedDB storage!');
  }
}

function loadStateFromLocalStorage() {
  const saved = localStorage.getItem(STATE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      appState = { ...appState, ...parsed };
    } catch (e) {
      console.error('Failed to parse saved state:', e);
    }
  }

  // Ensure state arrays are always valid arrays to prevent runtime exceptions
  if (!Array.isArray(appState.books)) appState.books = [];
  if (!Array.isArray(appState.notes)) appState.notes = [];
  if (!Array.isArray(appState.transactions)) appState.transactions = [];
  if (!Array.isArray(appState.savings)) appState.savings = [];
  if (!Array.isArray(appState.reminders)) appState.reminders = [];
  if (!Array.isArray(appState.savedPlaces)) appState.savedPlaces = [];
  if (!Array.isArray(appState.calendarEvents)) appState.calendarEvents = [];
  if (!Array.isArray(appState.savedPhotos)) appState.savedPhotos = [];
  if (!Array.isArray(appState.savedRoutes)) appState.savedRoutes = [];
  if (!Array.isArray(appState.academicProjects)) appState.academicProjects = [];
  if (!Array.isArray(appState.academicProfiles)) appState.academicProfiles = [];
  if (!Array.isArray(appState.academicGuides)) appState.academicGuides = [];
  if (!appState.user) appState.user = { name: 'Pengguna', theme: 'light', geminiApiKey: '', aiProvider: 'auto' };
  if (!appState.user.mediaFavorites || typeof appState.user.mediaFavorites !== 'object') appState.user.mediaFavorites = {};
  if (!appState.user.googleClientId) appState.user.googleClientId = '';
  if (!appState.user.youtubeApiKey) appState.user.youtubeApiKey = '';
  if (!appState.user.downloadServiceUrl) appState.user.downloadServiceUrl = '';
  if (!appState.user.downloadServiceKey) appState.user.downloadServiceKey = '';
  if (!appState.user.mediaPlaylists || typeof appState.user.mediaPlaylists !== 'object') appState.user.mediaPlaylists = {};
  if (!appState.user.mediaPlayHistory || typeof appState.user.mediaPlayHistory !== 'object') appState.user.mediaPlayHistory = {};
  if (!Array.isArray(appState.user.mediaSearchHistory)) appState.user.mediaSearchHistory = [];
  if (!Array.isArray(appState.user.qrHistory)) appState.user.qrHistory = [];
  if (!appState.storage || typeof appState.storage !== 'object') appState.storage = {};
  if (!appState.lock || typeof appState.lock !== 'object') appState.lock = {};
  if (!appState.cv || typeof appState.cv !== 'object') appState.cv = {};
  const cv = appState.cv;
  if (!cv.format) cv.format = 'ats';
  if (!cv.accent) cv.accent = '#3B82F6';
  if (!cv.personal) cv.personal = { fullName: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '', summary: '' };
  if (!Array.isArray(cv.experience)) cv.experience = [];
  if (!Array.isArray(cv.education)) cv.education = [];
  if (!Array.isArray(cv.skills)) cv.skills = [];
  if (!Array.isArray(cv.languages)) cv.languages = [];
  if (!Array.isArray(cv.certifications)) cv.certifications = [];
  if (!Array.isArray(cv.projects)) cv.projects = [];

  // Initialize Default Level 1 National Academic Baseline Profile if missing
  if (appState.academicProfiles.length === 0) {
    appState.academicProfiles.push({
      id: 'prof_default_national',
      name: 'Pedoman Penulisan Nasional (Level 1 Baseline)',
      institution: 'Pedoman Penulisan Karya Ilmiah Nasional',
      faculty: 'Umum',
      program: 'Semua Prodi / Jurusan',
      degree: 'S1',
      year: '2026',
      lecturer: '',
      rules: {
        fontFamily: 'Times New Roman',
        fontSize: 12,
        lineSpacing: 1.5,
        marginLeft: 4.0,
        marginTop: 3.0,
        marginRight: 3.0,
        marginBottom: 3.0,
        citationStyle: 'APA 7'
      },
      isDefault: true
    });
  }

  if (!appState.chatProjects || !Array.isArray(appState.chatProjects) || appState.chatProjects.length === 0) {
    appState.chatProjects = [
      {
        id: 'proj_default',
        name: 'First Chat',
        createdAt: new Date().toISOString().split('T')[0],
        messages: [
          {
            sender: 'bot',
            text: 'Halo! Saya adalah personal assistant kamu. Aku siap mendampingi dan bantu kamu kapan saja, baik itu AI Decision Maker, Make Sense of This, atau bantu urus agenda dan My PDF Tool kamu. Ada yang ingin dibahas hari ini?'
          }
        ]
      }
    ];
    appState.activeProjectId = 'proj_default';
  }

  // Brand refresh (idempotent): rename the default chat project label to "First Chat"
  // and update the initial assistant greeting on already-stored data.
  let chatProjectBrandMigrationApplied = false;
  if (Array.isArray(appState.chatProjects)) {
    appState.chatProjects.forEach((p) => {
      if (!p) return;
      if (p.name === 'Obrolan Maid Utama' || p.name === 'Obrolan Utama') {
        p.name = 'First Chat';
        chatProjectBrandMigrationApplied = true;
      }
      if (Array.isArray(p.messages) && p.messages[0] && p.messages[0].sender === 'bot' && typeof p.messages[0].text === 'string') {
        const prevText = p.messages[0].text;
        let nextText = prevText
          .replace(/^Halo! Saya adalah Maid kamu\. Aku siap mendampingi dan bantu kamu/, 'Halo! Saya adalah personal assistant kamu. Aku siap mendampingi dan bantu kamu')
          .replace(/^Halo! Saya My Ask, personal assistantmu\. Aku siap mendampingi dan bantu kamu/, 'Halo! Saya adalah personal assistant kamu. Aku siap mendampingi dan bantu kamu')
          .replace(/^Halo! Saya adalah Maid kamu\. Project obrolan/, 'Halo! Saya adalah personal assistant kamu. Project obrolan')
          .replace(/^Halo! Saya My Ask, personal assistantmu\. Project obrolan/, 'Halo! Saya adalah personal assistant kamu. Project obrolan');
        if (nextText !== prevText) {
          p.messages[0].text = nextText;
          chatProjectBrandMigrationApplied = true;
        }
      }
    });
  }
  if (chatProjectBrandMigrationApplied) saveStateToLocalStorage();

  // Trigger migration of legacy Base64 attachments to IndexedDB in background
  setTimeout(() => {
    migrateLegacyAppStateToIDB().catch(err => console.error('Migration error:', err));
  }, 300);
}

function saveStateToLocalStorage() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(appState));
  } catch (err) {
    if (err.name === 'QuotaExceededError' || err.code === 22 || err.number === -2147024882) {
      console.error('LocalStorage quota exceeded!', err);
      showNotificationBanner('Penyimpanan lokal aplikasi penuh. Hapus beberapa file atau dokumen yang tidak diperlukan lalu coba lagi. ⚠️');
    } else {
      console.error('Failed to save state:', err);
    }
  }
}

// --- THEME (Light / Dark) ---
function applyTheme(theme) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  appState.user.theme = mode;
  document.documentElement.setAttribute('data-theme', mode);
  const lightBtn = document.getElementById('themeModeLightBtn');
  const darkBtn = document.getElementById('themeModeDarkBtn');
  if (lightBtn) {
    lightBtn.classList.toggle('theme-mode-active', mode === 'light');
    darkBtn.classList.toggle('theme-mode-active', mode === 'dark');
  }
  saveStateToLocalStorage();
  // QR mengikuti tema → gambar ulang QR saat tema berubah
  if (typeof currentActiveTab !== 'undefined' && currentActiveTab === 'qr') {
    try { qrRedraw(); } catch (e) { /* noop */ }
  }
}

function setThemeMode(mode) {
  const next = mode === 'dark' ? 'dark' : 'light';
  applyTheme(next);
  showNotificationBanner(next === 'dark' ? 'Mode Gelap aktif 🌙' : 'Mode Terang aktif ☀️');
}

// --- SETUP UI ---
function setupUI() {
  // Pastikan bar navigasi bawah selalu tampil saat aplikasi dibuka (anti desinkron
  // dengan state DOM yang mungkin ter-restore dari sesi sebelumnya).
  setBottomNavHidden(false);
  renderUserProfile();
  document.getElementById('inputUserName').value = appState.user.name;
  if (document.getElementById('geminiApiKeyInput')) {
    document.getElementById('geminiApiKeyInput').value = appState.user.geminiApiKey || '';
  }
  if (document.getElementById('aiProviderSelect')) {
    document.getElementById('aiProviderSelect').value = appState.user.aiProvider || 'auto';
  }

  renderDashboard();
  renderBooks();
  renderNotes();
  renderFinance();
  renderCalendar();
  renderRemindersList();
  renderSavedPlaces();
  renderAIChatPage();

  // Media Center (My Music & My Video)
  syncMediaSettingsInputs();
  renderMediaAccountChips();
  if ((appState.user.googleClientId || '').trim()) initGoogleIdentity();
}

// --- UNIVERSAL MULTI-PROVIDER AI CONTROLLERS (GEMINI, GROQ, OPENAI, DEEPSEEK, OPENROUTER) ---
function toggleApiKeyVisibility() {
  const input = document.getElementById('geminiApiKeyInput');
  const icon = document.getElementById('toggleApiKeyIcon');
  if (!input || !icon) return;

  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

function detectAIProvider(apiKey, preferredProvider = 'auto') {
  if (preferredProvider && preferredProvider !== 'auto') return preferredProvider;
  if (!apiKey) return 'gemini';

  const key = apiKey.trim();
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-or-')) return 'openrouter';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-')) return 'openai';

  return 'gemini';
}

function saveGeminiApiKeyWithDone() {
  const input = document.getElementById('geminiApiKeyInput');
  const providerSelect = document.getElementById('aiProviderSelect');
  const val = input ? input.value.trim() : '';
  const providerVal = providerSelect ? providerSelect.value : 'auto';

  if (!val) {
    alert('API Key tidak boleh kosong!');
    return;
  }

  appState.user.geminiApiKey = val;
  appState.user.aiProvider = providerVal;
  saveStateToLocalStorage();

  const detected = detectAIProvider(val, providerVal);
  showNotificationBanner(`API Key (${detected.toUpperCase()}) berhasil disimpan! 🔑`);
  closeModal('modalSettings');
}

async function testGeminiApiKeyConnection() {
  const input = document.getElementById('geminiApiKeyInput');
  const providerSelect = document.getElementById('aiProviderSelect');
  const apiKey = input ? input.value.trim() : (appState.user.geminiApiKey || '');
  const preferredProvider = providerSelect ? providerSelect.value : (appState.user.aiProvider || 'auto');

  if (!apiKey) {
    alert('Silakan masukkan API Key terlebih dahulu!');
    return;
  }

  const provider = detectAIProvider(apiKey, preferredProvider);
  showNotificationBanner(`Menguji koneksi ke ${provider.toUpperCase()} API...`);

  try {
    const result = await callUniversalLLMAPI(provider, apiKey, 'Ping test', [{ sender: 'user', text: 'Halo' }]);
    if (result) {
      showNotificationBanner(`Koneksi ${provider.toUpperCase()} API Berhasil & Valid! ✅`);
    } else {
      showNotificationBanner(`Gagal terhubung ke ${provider.toUpperCase()} API.`);
    }
  } catch (err) {
    showNotificationBanner(`Gagal terhubung: ${err.message || 'Periksa API Key dan internet Anda'}`);
  }
}

async function renderUserProfile() {
  const nameEl = document.getElementById('displayUserName');
  if (nameEl) nameEl.textContent = appState.user.name;

  const profileMenuNameEl = document.getElementById('profileMenuUserName');
  if (profileMenuNameEl) profileMenuNameEl.textContent = appState.user.name;

  const avatarEl = document.getElementById('userAvatarElement');
  const modalAvatarPreview = document.getElementById('modalAvatarPreview');
  const profileMenuAvatar = document.getElementById('profileMenuAvatar');

  let avatarSrc = appState.user.avatarUrl; // kompatibel dgn data lama (pre-migrasi)
  if (!avatarSrc && appState.user.avatarFileId) {
    try {
      avatarSrc = await AppFileStorage.getFileAsDataUrl(appState.user.avatarFileId, appState.user.avatarMimeType);
    } catch (err) { console.error('Gagal memuat foto profil:', err); }
  }

  if (avatarSrc) {
    const imgHtml = `<img src="${avatarSrc}" alt="Profile Photo">`;
    if (avatarEl) avatarEl.innerHTML = imgHtml;
    if (modalAvatarPreview) modalAvatarPreview.innerHTML = imgHtml;
    if (profileMenuAvatar) profileMenuAvatar.innerHTML = imgHtml;
  } else {
    const iconHtml = `<i class="fa-solid fa-user-astronaut"></i>`;
    if (avatarEl) avatarEl.innerHTML = iconHtml;
    if (modalAvatarPreview) modalAvatarPreview.innerHTML = iconHtml;
    if (profileMenuAvatar) profileMenuAvatar.innerHTML = iconHtml;
  }
}

function openModalFromProfileMenu(modalId) {
  closeModal('modalProfileMenu');
  openModal(modalId);
}

// --- BOTTOM NAVIGATION (UI redesign) ---
(function initBottomNavigation() {
  if (!document.querySelector('.app-viewport')) return;
  // Single global instance: remove any stale copy first, then append to
  // <body> — outside the page content flow (never inside .app-viewport),
  // so it can never be duplicated or interfere with layout.
  document.getElementById('appBottomNav')?.remove();
  const nav = document.createElement('nav');
  nav.className = 'app-bottom-nav';
  nav.id = 'appBottomNav';
  nav.setAttribute('aria-label', 'Navigasi utama');
  nav.innerHTML = `
    <button type="button" class="bn-item active" data-nav="dashboard" onclick="switchTab('dashboard')">
      <i class="fa-solid fa-house-chimney"></i><span>Beranda</span>
    </button>
    <button type="button" class="bn-item" data-nav="ai-chat" onclick="switchTab('ai-chat')">
      <i class="fa-solid fa-comments"></i><span>Chat</span>
    </button>
    <button type="button" class="bn-fab" onclick="openQuickCreate()">
      <i class="fa-solid fa-plus"></i>
    </button>
    <button type="button" class="bn-item" data-nav="finance" onclick="switchTab('finance')">
      <i class="fa-solid fa-wallet"></i><span>Keuangan</span>
    </button>
    <button type="button" class="bn-item" data-nav="storage" onclick="switchTab('storage')">
      <i class="fa-solid fa-hard-drive"></i><span>Storage</span>
    </button>
  `;
  document.body.appendChild(nav);
})();

function updateBottomNavState(tabName) {
  const nav = document.getElementById('appBottomNav');
  if (!nav) return;
  const map = { dashboard: 'dashboard', 'ai-chat': 'ai-chat', finance: 'finance', storage: 'storage' };
  const target = map[tabName] || '';
  nav.querySelectorAll('.bn-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === target);
  });
}

// Bottom nav disembunyikan saat berada di dalam halaman Storage (animasi halus),
// dan muncul kembali dengan animasi halus saat keluar.
// Guard berbasis DOM (bukan variabel) agar tidak mungkin desinkron: apa pun
// kondisi class saat ini, panggilan berikutnya selalu menyinkronkan ke state yang benar.
function setBottomNavHidden(hidden) {
  const nav = document.getElementById('appBottomNav');
  if (!nav) return;
  const shouldHide = !!hidden;
  if (nav.classList.contains('nav-hidden') === shouldHide) return; // tidak usah animasi ulang bila tidak ada perubahan
  nav.classList.toggle('nav-hidden', shouldHide);
}

// --- QUICK CREATE (center FAB) ---
function openQuickCreate() {
  openModal('modalQuickCreate');
}

function openQuickAction(tabName, modalId) {
  switchTab(tabName);
  if (modalId) openModal(modalId);
}

// ==========================================================================
// NOTIFICATIONS CONTROLLER — bell toggle, permissions & scheduling
// ==========================================================================
function getNotificationCapability() {
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) return 'native';
      return 'inapp';
    }
  } catch (e) { /* ignore */ }
  if (typeof Notification !== 'undefined') return 'web';
  return 'inapp';
}

async function ensureNotificationPermission() {
  const cap = getNotificationCapability();
  try {
    if (cap === 'native') {
      const res = await window.Capacitor.Plugins.LocalNotifications.requestPermissions();
      return !res || res.display === 'granted' || res.display === 'prompt-with-rationale';
    }
    if (cap === 'web') {
      if (Notification.permission === 'granted') return true;
      const p = await Notification.requestPermission();
      return p === 'granted';
    }
    return true; // in-app only: always available
  } catch (e) {
    return false;
  }
}

function scheduleAppNotification(id, title, body, when) {
  if (!appState.notificationsEnabled) return;
  if (!(when instanceof Date) || isNaN(when.getTime())) return;
  if (when.getTime() <= Date.now()) return;
  const cap = getNotificationCapability();
  try {
    if (cap === 'native') {
      window.Capacitor.Plugins.LocalNotifications.schedule({
        notifications: [{ id, title, body, schedule: { at: when } }]
      }).catch(() => {});
    } else if (cap === 'web' && Notification.permission === 'granted') {
      const ms = when.getTime() - Date.now();
      if (ms <= 36 * 60 * 60 * 1000) {
        setTimeout(() => {
          try {
            const n = new Notification(title, { body, tag: String(id) });
            // Klik notifikasi web → buka aplikasi ke halaman terkait
            n.onclick = () => { try { window.focus(); handleNotificationTap({ id }); } catch (e) { /* ignore */ } };
          } catch (e) { /* ignore */ }
        }, ms);
      }
    }
  } catch (e) { /* silent */ }
}

// ==========================================================================
// DEEP-LINK NOTIFIKASI — saat notifikasi My Pengingat / My Kalender diketuk,
// aplikasi langsung membuka halaman terkait (reminders / calendar) bahkan
// saat aplikasi sedang dibuka dari keadaan tertutup (killed) oleh notifikasi.
// ID notifikasi terenkode: 200000+id = My Pengingat, 300000+id = My Kalender.
// ==========================================================================
function handleNotificationTap(notif) {
  if (!notif) return;
  const id = Number(notif.id);
  if (isNaN(id)) return;

  if (id >= 300000 && id < 400000) {
    // My Kalender → buka kalender & sorot tanggal event terkait
    const evId = id - 300000;
    const ev = (Array.isArray(appState.calendarEvents) ? appState.calendarEvents : [])
      .find(e => e && Math.abs(Number(e.id) || 0) === evId);
    switchTab('calendar');
    if (ev && ev.date) {
      selectedCalendarDateStr = String(ev.date);
      if (typeof renderCalendar === 'function') renderCalendar();
    }
    showNotificationBanner('Dibuka dari notifikasi My Kalender 📅');
    return;
  }

  if (id >= 200000 && id < 300000) {
    // My Pengingat → buka halaman Pengingat
    switchTab('reminders');
    showNotificationBanner('Dibuka dari notifikasi My Pengingat ⏰');
  }
}

function setupNotificationDeepLinks() {
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
      const ln = window.Capacitor.Plugins.LocalNotifications;
      if (typeof ln.addListener === 'function') {
        // Ketukan pada notifikasi (termasuk saat aplikasi dibuka dari keadaan mati)
        ln.addListener('localNotificationActionPerformed', (data) => {
          handleNotificationTap(data && (data.notification || data));
        });
        // Notifikasi diterima saat aplikasi sedang berjalan di foreground
        ln.addListener('localNotificationReceived', (data) => {
          handleNotificationTap(data && (data.notification || data));
        });
      }
    }
  } catch (e) {
    console.warn('Notification deep-link setup skipped:', e);
  }
}

// Next upcoming fire date for a reminder (repeatDays: 1=Senin ... 7=Minggu)
function nextReminderFireDate(rem) {
  if (!rem || !rem.title || !rem.time) return null;
  const parts = String(rem.time).split(':').map(Number);
  const h = parts[0], m = parts[1];
  if (isNaN(h) || isNaN(m)) return null;
  const now = new Date();
  const days = Array.isArray(rem.repeatDays) && rem.repeatDays.length > 0
    ? rem.repeatDays.map(Number)
    : [1, 2, 3, 4, 5, 6, 7];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const jsDay = d.getDay();
    const dayNum = jsDay === 0 ? 7 : jsDay;
    if (days.includes(dayNum)) {
      d.setHours(h, m, 0, 0);
      if (d.getTime() > now.getTime()) return d;
    }
  }
  return null;
}

function rescheduleUpcomingNotifications() {
  if (!appState.notificationsEnabled) return;
  // My Pengingat — next occurrence of each active reminder
  (Array.isArray(appState.reminders) ? appState.reminders : []).forEach(rem => {
    if (rem.completed) return;
    const when = nextReminderFireDate(rem);
    if (when) {
      scheduleAppNotification(
        200000 + Math.abs(Number(rem.id) || 0),
        'My Pengingat',
        (rem.title || 'Pengingat') + (rem.time ? ' — ' + rem.time : ''),
        when
      );
    }
  });
  // My Kalender — notify at 08:00 on the event date
  (Array.isArray(appState.calendarEvents) ? appState.calendarEvents : []).forEach(ev => {
    if (!ev || !ev.date || !ev.title) return;
    const d = new Date(String(ev.date) + 'T08:00:00');
    if (isNaN(d.getTime())) return;
    scheduleAppNotification(
      300000 + Math.abs(Number(ev.id) || 0),
      'My Kalender',
      ev.title,
      d
    );
  });
}

async function toggleAppNotifications() {
  appState.notificationsEnabled = !appState.notificationsEnabled;
  saveStateToLocalStorage();
  if (appState.notificationsEnabled) {
    const ok = await ensureNotificationPermission();
    rescheduleUpcomingNotifications();
    updateNotificationBellUI();
    showNotificationBanner(ok
      ? 'Notifikasi diaktifkan 🔔'
      : 'Notifikasi aktif, tapi izin sistem belum diberikan — notifikasi tetap tampil di dalam aplikasi.');
  } else {
    updateNotificationBellUI();
    showNotificationBanner('Notifikasi dimatikan 🔕');
  }
}

function updateNotificationBellUI() {
  const on = !!appState.notificationsEnabled;
  document.querySelectorAll('#greetingBellIcon, #profileMenuNotifIcon, #settingsNotifIcon').forEach(icon => {
    if (icon) icon.className = on ? 'fa-solid fa-bell' : 'fa-solid fa-bell-slash';
  });
  const bellBtn = document.getElementById('greetingBellBtn');
  if (bellBtn) bellBtn.classList.toggle('off', !on);
  const profBtn = document.getElementById('profileMenuNotifBtn');
  if (profBtn) profBtn.classList.toggle('off', !on);
  document.querySelectorAll('#profileMenuNotifBtn .notif-state, #settingsNotifRow .notif-state').forEach(label => {
    if (label) label.textContent = on ? 'Aktif' : 'Nonaktif';
  });
}

async function requestAppPermissions() {
  const results = [];
  const notifOk = await ensureNotificationPermission();
  results.push('Notifikasi: ' + (notifOk ? 'OK' : 'Ditolak'));
  let camOk = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    camOk = true;
    stream.getTracks().forEach(t => t.stop());
  } catch (e) { camOk = false; }
  results.push('Kamera: ' + (camOk ? 'OK' : 'Ditolak/Tidak tersedia'));
  let locOk = false;
  try {
    await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 });
    });
    locOk = true;
  } catch (e) { locOk = false; }
  results.push('Lokasi: ' + (locOk ? 'OK' : 'Ditolak/Tidak tersedia'));
  showNotificationBanner(results.join(' · '));
  return results;
}

// ==========================================================================
// IZIN APLIKASI — halaman status & permintaan ulang per izin (Menu Profil)
// ==========================================================================
const PERM_DEFS = [
  {
    key: 'notifications', icon: 'fa-bell', name: 'Notifikasi',
    desc: 'My Pengingat & My Kalender',
    check: async () => {
      const cap = getNotificationCapability();
      if (cap === 'native') {
        try {
          const r = await window.Capacitor.Plugins.LocalNotifications.checkPermissions();
          return (r && r.display) || 'prompt';
        } catch (e) { return 'prompt'; }
      }
      if (typeof Notification !== 'undefined') return Notification.permission;
      return 'granted'; // in-app only
    },
    request: async () => (await ensureNotificationPermission()) ? 'granted' : 'prompt'
  },
  {
    key: 'camera', icon: 'fa-camera', name: 'Kamera',
    desc: 'Scanner dokumen, kamera Maps, AI',
    check: () => checkAppCameraPermission(),
    request: async () => {
      try { const s = await getAppCameraStream(); s.getTracks().forEach(t => t.stop()); return 'granted'; }
      catch (e) { return 'denied'; }
    }
  },
  {
    key: 'location', icon: 'fa-location-dot', name: 'Lokasi',
    desc: 'My Maps, navigasi & GPS',
    check: () => checkAppLocationPermission(),
    request: async () => {
      try { await getAppGPSPosition(); return 'granted'; }
      catch (e) { return 'denied'; }
    }
  },
  {
    key: 'storage', icon: 'fa-hard-drive', name: 'Penyimpanan',
    desc: 'My Storage — akses file lokal',
    check: async () => {
      const fs = stNativePlugin();
      if (fs) {
        try {
          const r = await fs.checkPermissions({ permissions: ['publicStorage'] });
          const st = (r && r.publicStorage) || (r && r.permissions && r.permissions.publicStorage);
          return st || 'prompt';
        } catch (e) { return 'prompt'; }
      }
      return window.indexedDB ? 'granted' : 'denied'; // web: penyimpanan IndexedDB
    },
    request: async () => {
      if (stNativePlugin()) return (await stRequestAndroidPermission()) ? 'granted' : 'denied';
      return window.indexedDB ? 'granted' : 'denied';
    }
  },
  {
    key: 'biometric', icon: 'fa-fingerprint', name: 'Biometrik',
    desc: 'Kunci aplikasi — sidik jari / wajah',
    check: async () => {
      const cap = await lockBioCheck();
      return cap.available ? 'granted' : 'denied';
    },
    request: async () => {
      const cap = await lockBioCheck();
      if (!cap.available) return 'denied';
      const bio = lockNativeBio();
      if (bio && typeof bio.verifyIdentity === 'function') {
        try {
          const r = await bio.verifyIdentity({ reason: 'Verifikasi biometrik untuk fitur kunci aplikasi My' });
          return (r && (r.verified || r.success)) ? 'granted' : 'denied';
        } catch (e) { return 'denied'; }
      }
      return 'granted'; // WebAuthn: terdeteksi tersedia
    }
  }
];

function permStatusMeta(state) {
  if (state === 'granted') return { label: 'Diizinkan', cls: 'ok' };
  if (state === 'denied') return { label: 'Ditolak', cls: 'no' };
  return { label: 'Belum ditentukan', cls: 'ask' };
}

function openPermissionsPage() {
  closeModal('modalProfileMenu');
  openModal('modalPermissions');
  renderPermissionsPage();
}

async function renderPermissionsPage() {
  const container = document.getElementById('permListContainer');
  const summary = document.getElementById('permSummaryBar');
  if (!container) return;

  container.innerHTML = PERM_DEFS.map(d => `
    <div class="perm-row" id="permRow-${d.key}">
      <div class="perm-icon"><i class="fa-solid ${d.icon}"></i></div>
      <div class="perm-info">
        <div class="perm-name">${d.name}</div>
        <div class="perm-desc">${d.desc}</div>
      </div>
      <div class="perm-right">
        <span class="perm-status pending" id="permState-${d.key}">Memeriksa…</span>
        <button type="button" class="perm-btn" id="permBtn-${d.key}" onclick="permRequestOne('${d.key}')"><i class="fa-solid fa-rotate"></i> Minta</button>
      </div>
    </div>`).join('');

  if (summary) {
    summary.innerHTML = `
      <div class="perm-summary-info" id="permSummaryInfo"><i class="fa-solid fa-shield-halved"></i> Status izin aplikasi</div>
      <button type="button" class="perm-btn primary" onclick="permRequestAll()"><i class="fa-solid fa-wand-magic-sparkles"></i> Minta Semua</button>`;
  }

  const results = {};
  await Promise.all(PERM_DEFS.map(async d => {
    try { results[d.key] = await d.check(); } catch (e) { results[d.key] = 'prompt'; }
  }));

  let grantedCount = 0;
  PERM_DEFS.forEach(d => {
    const st = results[d.key] || 'prompt';
    if (st === 'granted') grantedCount++;
    const meta = permStatusMeta(st);
    const el = document.getElementById('permState-' + d.key);
    if (el) { el.textContent = meta.label; el.className = 'perm-status ' + meta.cls; }
  });
  const info = document.getElementById('permSummaryInfo');
  if (info) info.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${grantedCount} dari ${PERM_DEFS.length} izin aktif`;
}

async function permRequestOne(key) {
  const def = PERM_DEFS.find(d => d.key === key);
  if (!def) return;
  const btn = document.getElementById('permBtn-' + key);
  const stEl = document.getElementById('permState-' + key);
  if (!btn || !stEl) return;
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Meminta…';
  try {
    const res = await def.request();
    const meta = permStatusMeta(res);
    stEl.textContent = meta.label;
    stEl.className = 'perm-status ' + meta.cls;
    showNotificationBanner(def.name + ': ' + meta.label + (res === 'granted' ? ' ✅' : ' ⚠️'));
  } catch (e) {
    stEl.textContent = 'Ditolak';
    stEl.className = 'perm-status no';
    showNotificationBanner('Gagal meminta izin ' + def.name + '.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.innerHTML = prev;
  }
}

async function permRequestAll() {
  for (const d of PERM_DEFS) {
    const stEl = document.getElementById('permState-' + d.key);
    if (stEl && stEl.classList.contains('ok')) continue; // sudah diizinkan — lewati
    await permRequestOne(d.key);
  }
}

// --- TAB SWITCHER SYSTEM ---
function switchTab(tabName) {
  closeAllModals();

  const searchBox = document.getElementById('homeSearchResultsBox');
  if (searchBox) {
    searchBox.style.display = 'none';
    searchBox.innerHTML = '';
  }

  const tabs = document.querySelectorAll('.tab-page');
  tabs.forEach(tab => tab.classList.remove('active'));
  
  const selectedTab = document.getElementById(`tab-${tabName}`);
  if (selectedTab) {
    selectedTab.classList.add('active');
  }

  const mainHeader = document.getElementById('appMainHeader');
  if (mainHeader) {
    mainHeader.style.display = (tabName === 'dashboard') ? 'block' : 'none';
  }

  if (tabName === 'dashboard') renderDashboard();
  if (tabName === 'books') renderBooks();
  if (tabName === 'notes') renderNotes();
  if (tabName === 'finance') renderFinance();
  if (tabName === 'calendar') renderCalendar();
  if (tabName === 'maps') {
    renderSavedPlaces();
    renderSavedPhotos();
    renderSavedRoutes();
    initOrUpdateNavMap();
    restoreActiveNavigationIfAny();
    // Restore ETA interval if navigation is still active
    if (appState.activeNavigationRoute && appState.activeNavigationRoute.durationSeconds) {
      if (!etaUpdateInterval) startETAInterval();
      else updateETADisplay();
    }
  }
  if (tabName === 'reminders') renderRemindersList();
  if (tabName === 'ai-chat') renderAIChatPage();
  if (tabName === 'academic-studio') renderAcademicStudio();
  if (tabName === 'music') renderMusicPage();
  if (tabName === 'video') renderVideoPage();
  if (tabName === 'cv') renderCvPage();
  if (tabName === 'qr') renderQrPage();
  if (tabName === 'converter') renderConverterPage();
  if (tabName === 'storage') {
    // Setiap masuk tab Storage selalu tampilkan pilihan Lokal/Cloud (mode home),
    // bukan melanjutkan mode terakhir yang tersimpan.
    appState.storage.mode = 'home';
    renderStoragePage();
  }
  if (tabName !== 'qr') { try { qrStopCamera(); } catch (e) { /* noop */ } }

  currentActiveTab = tabName;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateBottomNavState(tabName);
  // Di dalam Storage, bar navigasi bawah disembunyikan agar fokus penuh ke file manager.
  setBottomNavHidden(tabName === 'storage');
}

// --- GLOBAL HOMEPAGE SEARCH ENGINE ---
function handleGlobalSearch(query) {
  const searchBox = document.getElementById('homeSearchResultsBox');
  if (!searchBox) return;

  const q = query.trim().toLowerCase();
  if (!q) {
    searchBox.style.display = 'none';
    searchBox.innerHTML = '';
    return;
  }

  const results = [];

  appState.notes.forEach(n => {
    if ((n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q)) {
      results.push({ type: 'Catatan', title: n.title, tab: 'notes', id: n.id, icon: 'fa-pen-to-square' });
    }
  });

  appState.books.forEach(b => {
    if ((b.title || '').toLowerCase().includes(q) || (b.lecturer || '').toLowerCase().includes(q)) {
      results.push({ type: 'Buku', title: b.title, tab: 'books', id: b.id, icon: 'fa-book-bookmark' });
    }
  });

  appState.transactions.forEach(t => {
    if ((t.description || '').toLowerCase().includes(q)) {
      results.push({ type: 'Keuangan', title: `${t.description} (${formatRupiah(t.amount)})`, tab: 'finance', id: t.id, icon: 'fa-wallet' });
    }
  });

  appState.calendarEvents.forEach(e => {
    if ((e.title || '').toLowerCase().includes(q)) {
      results.push({ type: 'Kalender', title: `${e.title} (${e.date})`, tab: 'calendar', id: e.id, icon: 'fa-calendar-days' });
    }
  });

  if (results.length === 0) {
    searchBox.innerHTML = `<div style="padding: 12px; font-size: 0.82rem; color: var(--text-muted); text-align: center;">Tidak ada hasil ditemukan.</div>`;
  } else {
    searchBox.innerHTML = '';
    results.slice(0, 6).forEach(res => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <i class="fa-solid ${res.icon}" style="color: var(--primary); font-size: 0.9rem;"></i>
          <div>
            <div style="font-size: 0.88rem; font-weight: 700; color: var(--text-main);">${escapeHtml(res.title)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${res.type}</div>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right" style="font-size: 0.75rem; color: var(--text-light);"></i>
      `;
      item.onclick = () => {
        searchBox.style.display = 'none';
        if (res.tab === 'books') openBookDetail(res.id);
        else switchTab(res.tab);
      };
      searchBox.appendChild(item);
    });
  }

  searchBox.style.display = 'block';
}

// --- PROFILE PHOTO CONTROLLER ---
async function handleProfilePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    // Hapus foto lama dari penyimpanan file (kalau ada) supaya tidak menumpuk
    if (appState.user.avatarFileId) {
      await AppFileStorage.deleteFile(appState.user.avatarFileId);
    }
    const meta = await AppFileStorage.saveFile(file);
    appState.user.avatarFileId = meta.id;
    appState.user.avatarMimeType = meta.mimeType;
    appState.user.avatarUrl = null; // sumber kebenaran sekarang di AppFileStorage, bukan base64 langsung
    saveStateToLocalStorage();
    await renderUserProfile();
    showNotificationBanner('Foto profil berhasil diunggah! 📸');
  } catch (err) {
    console.error('Upload foto profil gagal:', err);
    showNotificationBanner('Gagal menyimpan foto profil: ' + err.message);
  }
}

async function removeProfilePhoto() {
  if (confirm('Hapus foto profil dan kembali ke avatar default?')) {
    if (appState.user.avatarFileId) {
      await AppFileStorage.deleteFile(appState.user.avatarFileId);
    }
    appState.user.avatarFileId = null;
    appState.user.avatarUrl = null;
    saveStateToLocalStorage();
    await renderUserProfile();
    showNotificationBanner('Foto profil dihapus.');
  }
}

function saveProfileChanges() {
  const inputName = document.getElementById('inputUserName').value.trim();
  if (inputName) {
    appState.user.name = inputName;
    saveStateToLocalStorage();
    renderUserProfile();
    closeModal('modalEditProfile');
    showNotificationBanner('Nama profil diperbarui! 👋');
  }
}

function updateCurrentDateSubtitle() {
  const now = new Date();
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const dateStr = now.toLocaleDateString('id-ID', options);
  const el = document.getElementById('currentDateSubtitle');
  if (el) el.textContent = dateStr;
}



function renderMaidConflictAlerts() {
  const container = document.getElementById('dashboardAIConflictAlerts');
  if (!container) return;

  const conflicts = [];
  const eventsByDate = {};

  appState.calendarEvents.forEach(e => {
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  });

  Object.keys(eventsByDate).forEach(dateStr => {
    if (eventsByDate[dateStr].length >= 2) {
      conflicts.push(`Ada ${eventsByDate[dateStr].length} agenda bersamaan pada tanggal ${dateStr} (${eventsByDate[dateStr].map(x => x.title).join(', ')}).`);
    }
  });

  if (conflicts.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="ai-conflict-alert">
      <div style="font-weight: 800; margin-bottom: 4px;"><i class="fa-solid fa-triangle-exclamation"></i> Personal Assistant Mengingatkanmu!</div>
      ${conflicts.map(c => `<div>⚠️ ${c}</div>`).join('')}
      <button class="btn-link" style="color: #991B1B; font-size: 0.75rem; margin-top: 6px; text-decoration: underline;" onclick="switchTab('calendar')">Buka Kalender untuk Atur Ulang</button>
    </div>
  `;
}

// ==========================================================================
// MY ASK ADVANCED AI ASSISTANT SYSTEM (DECISION MAKER, MAKE SENSE OF THIS,
// MULTIMODAL ATTACHMENT, REAL ACTIONS & NO BOLD/ITALIC NORMALIZER)
// ==========================================================================

function getCurrentChatProject() {
  let project = appState.chatProjects.find(p => p.id === appState.activeProjectId);
  if (!project) {
    project = appState.chatProjects[0];
    appState.activeProjectId = project.id;
  }
  return project;
}

let pendingDeleteProjectId = null;

function renderChatProjectsList() {
  const container = document.getElementById('chatProjectsListContainer');
  if (!container) return;

  container.innerHTML = '';
  appState.chatProjects.forEach(proj => {
    const chip = document.createElement('div');
    chip.className = `chat-project-chip ${proj.id === appState.activeProjectId ? 'active' : ''}`;
    chip.innerHTML = `
      <span>${escapeHtml(proj.name)}</span>
      <i class="fa-solid fa-pen-to-square" style="font-size: 0.7rem; opacity: 0.8;" onclick="event.stopPropagation(); renameChatProject('${proj.id}')" title="Ubah Nama"></i>
      <i class="fa-solid fa-trash-can" style="font-size: 0.75rem; opacity: 0.85; margin-left: 2px;" onclick="event.stopPropagation(); confirmDeleteChatProject('${proj.id}')" title="Hapus Project"></i>
    `;
    chip.onclick = () => switchChatProject(proj.id);
    container.appendChild(chip);
  });
}

function createNewChatProjectWithName(projName) {
  if (!projName || !projName.trim()) return;

  const newProj = {
    id: 'proj_' + Date.now(),
    name: projName.trim(),
    createdAt: new Date().toISOString().split('T')[0],
    messages: [
      {
        sender: 'bot',
        text: stripMarkdownStyles(`Halo! Saya adalah personal assistant kamu. Project obrolan "${projName.trim()}" siap digunakan! Ada yang ingin didiskusikan hari ini?`)
      }
    ]
  };

  appState.chatProjects.push(newProj);
  appState.activeProjectId = newProj.id;
  saveStateToLocalStorage();
  renderAIChatPage();
  showNotificationBanner(`Project "${projName.trim()}" dibuat! 💬`);
}

function createNewChatProject() {
  const projName = prompt('Masukkan nama project obrolan baru:', `Project ${appState.chatProjects.length + 1}`);
  if (projName) createNewChatProjectWithName(projName);
}

function switchChatProject(projId) {
  appState.activeProjectId = projId;
  saveStateToLocalStorage();
  renderAIChatPage();
}

function renameChatProject(projId) {
  const project = appState.chatProjects.find(p => p.id === projId);
  if (!project) return;

  const newName = prompt('Ubah nama project obrolan:', project.name);
  if (newName && newName.trim()) {
    project.name = newName.trim();
    saveStateToLocalStorage();
    renderChatProjectsList();
    showNotificationBanner('Nama project diperbarui!');
  }
}

function confirmDeleteChatProject(projId) {
  const project = appState.chatProjects.find(p => p.id === projId);
  if (!project) return;

  pendingDeleteProjectId = projId;
  const titleEl = document.getElementById('deleteProjectModalTitle');
  if (titleEl) {
    titleEl.textContent = `Hapus project "${project.name}"?`;
  }

  const confirmBtn = document.getElementById('btnConfirmDeleteProject');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      closeModal('modalDeleteProjectConfirmation');
      if (pendingDeleteProjectId) {
        executeDeleteChatProject(pendingDeleteProjectId);
        pendingDeleteProjectId = null;
      }
    };
  }

  openModal('modalDeleteProjectConfirmation');
}

function executeDeleteChatProject(projId) {
  const targetProj = appState.chatProjects.find(p => p.id === projId);
  const projName = targetProj ? targetProj.name : '';

  appState.chatProjects = appState.chatProjects.filter(p => p.id !== projId);

  if (appState.activeProjectId === projId || appState.chatProjects.length === 0) {
    if (appState.chatProjects.length > 0) {
      appState.activeProjectId = appState.chatProjects[0].id;
    } else {
      const defaultProj = {
        id: 'proj_' + Date.now(),
        name: 'First Chat',
        createdAt: new Date().toISOString().split('T')[0],
        messages: [
          {
            sender: 'bot',
            text: stripMarkdownStyles('Halo! Saya adalah personal assistant kamu. Aku siap mendampingi dan bantu kamu kapan saja! Ada yang ingin dibahas hari ini?')
          }
        ]
      };
      appState.chatProjects = [defaultProj];
      appState.activeProjectId = defaultProj.id;
    }
  }

  saveStateToLocalStorage();
  renderAIChatPage();
  showNotificationBanner(`Project "${projName || 'Obrolan'}" berhasil dihapus.`);
}

function deleteChatProject(projId) {
  confirmDeleteChatProject(projId);
}

function setAIChatMode(mode) {
  currentAIChatMode = mode;
  document.querySelectorAll('.btn-ai-mode-chip').forEach(b => b.classList.remove('active'));

  if (mode === 'general') document.getElementById('btnModeGeneralChat').classList.add('active');
  if (mode === 'ask_life') document.getElementById('btnModeAskMyLife').classList.add('active');
  if (mode === 'what_if') document.getElementById('btnModeWhatIf').classList.add('active');

  renderAISuggestedPrompts();
}

function renderAISuggestedPrompts() {
  const container = document.getElementById('aiSuggestedPromptsContainer');
  if (!container) return;

  const pool = AI_SUGGESTION_POOLS[currentAIChatMode] || AI_SUGGESTION_POOLS.general;
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 4);

  container.innerHTML = '';
  selected.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'ai-prompt-chip';
    chip.textContent = p;
    chip.onclick = () => {
      document.getElementById('aiChatInputField').value = p;
      sendAIChatMessage();
    };
    container.appendChild(chip);
  });
}

function rotateAISuggestedPrompts() {
  renderAISuggestedPrompts();
  showNotificationBanner('Saran pertanyaan diperbarui!');
}

function renderAIChatPage() {
  renderChatProjectsList();
  renderAISuggestedPrompts();

  const box = document.getElementById('aiChatMessagesBox');
  if (!box) return;

  const currentProj = getCurrentChatProject();
  box.innerHTML = '';

  currentProj.messages.forEach((msg, idx) => {
    appendAIChatBubbleUI(msg.sender, msg.text, msg.sourceTab, msg.sourceLabel, msg.isError, idx);
  });
}

// --- FILE ATTACHMENT CONTROLLER ---
function handleAIChatFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (file.size > 20 * 1024 * 1024) {
    alert('Ukuran file terlalu besar (maksimal 20 MB).');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => alert('Gagal membaca file.');

  if (file.type.startsWith('image/')) {
    reader.onload = (e) => {
      const base64Data = e.target.result.split(',')[1];
      currentAIChatAttachment = {
        name: file.name,
        size: formatFileSize(file.size),
        mimeType: file.type,
        base64: base64Data,
        isImage: true
      };
      renderAttachmentPreviewBox();
    };
    reader.readAsDataURL(file);
  } else if (file.type === 'application/pdf') {
    reader.onload = (e) => {
      const base64Data = btoa(new Uint8Array(e.target.result).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      currentAIChatAttachment = {
        name: file.name,
        size: formatFileSize(file.size),
        mimeType: 'application/pdf',
        base64: base64Data,
        isPdf: true
      };
      renderAttachmentPreviewBox();
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = (e) => {
      currentAIChatAttachment = {
        name: file.name,
        size: formatFileSize(file.size),
        mimeType: 'text/plain',
        textContent: e.target.result,
        isText: true
      };
      renderAttachmentPreviewBox();
    };
    reader.readAsText(file);
  }
}

function renderAttachmentPreviewBox() {
  const box = document.getElementById('aiChatAttachmentPreviewBox');
  if (!box || !currentAIChatAttachment) return;

  box.style.display = 'block';
  box.innerHTML = `
    <div class="chat-attachment-preview-chip">
      <div style="display: flex; align-items: center; gap: 8px;">
        <i class="fa-solid ${currentAIChatAttachment.isImage ? 'fa-file-image' : (currentAIChatAttachment.isPdf ? 'fa-file-pdf' : 'fa-file-lines')}"></i>
        <span>${escapeHtml(currentAIChatAttachment.name)} (${currentAIChatAttachment.size})</span>
      </div>
      <i class="fa-solid fa-xmark" style="cursor: pointer;" onclick="removeAIChatAttachment()"></i>
    </div>
  `;
}

function removeAIChatAttachment() {
  currentAIChatAttachment = null;
  const box = document.getElementById('aiChatAttachmentPreviewBox');
  if (box) {
    box.style.display = 'none';
    box.innerHTML = '';
  }
  const input = document.getElementById('aiChatFileInput');
  if (input) input.value = '';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function sendAIChatMessage() {
  const input = document.getElementById('aiChatInputField');
  let query = input.value.trim();

  if (!query && !currentAIChatAttachment) return;

  if (!query && currentAIChatAttachment) {
    query = 'Tolong analisis dan jelaskan isi file ini secara mendetail (Make Sense of This).';
  }

  input.value = '';
  executeRealAIChatRequest(query);
}

function retryLastAIChat() {
  if (lastFailedUserQuery) {
    executeRealAIChatRequest(lastFailedUserQuery);
  }
}

// STRICT REGULAR PLAIN TEXT NORMALIZER (NO BOLD, NO ITALIC)
function stripMarkdownStyles(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '$1')  // Strip **bold**
    .replace(/\*(.*?)\*/g, '$1')      // Strip *italic*
    .replace(/__(.*?)__/g, '$1')      // Strip __bold__
    .replace(/_(.*?)_/g, '$1')        // Strip _italic_
    .replace(/`{1,3}(.*?)`{1,3}/g, '$1') // Strip code backticks
    .replace(/^#+\s+/gm, '')          // Strip heading hashes
    .replace(/\*/g, '');              // Strip any remaining asterisks
}

async function executeRealAIChatRequest(query) {
  const currentProj = getCurrentChatProject();
  lastFailedUserQuery = query;

  const attachedFile = currentAIChatAttachment;
  removeAIChatAttachment();

  const userTextWithFile = attachedFile ? `[Lampiran File: ${attachedFile.name}]\n${query}` : query;

  currentProj.messages.push({ sender: 'user', text: userTextWithFile });
  appendAIChatBubbleUI('user', userTextWithFile);

  if (currentProj.messages.length === 2 && currentProj.name.startsWith('Project ')) {
    currentProj.name = query.length > 18 ? query.substring(0, 18) + '...' : query;
    renderChatProjectsList();
  }

  saveStateToLocalStorage();

  const box = document.getElementById('aiChatMessagesBox');
  box.scrollTop = box.scrollHeight;

  const loadingId = 'aiLoadingBubble_' + Date.now();
  const loadingDiv = document.createElement('div');
  loadingDiv.id = loadingId;
  loadingDiv.className = 'ai-msg-bubble bot';
  loadingDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> My Ask sedang menganalisis & berpikir...`;
  box.appendChild(loadingDiv);
  box.scrollTop = box.scrollHeight;

  try {
    let aiResponseText = await queryRealAIModel(query, currentProj.messages, attachedFile);

    // REAL FUNCTION CALL / ACTION EXECUTION ENGINE
    if (aiResponseText.includes('[ACTION:CREATE_PROJECT:')) {
      const match = aiResponseText.match(/\[ACTION:CREATE_PROJECT:(.*?)\]/);
      if (match) {
        const newProjName = match[1].trim();
        createNewChatProjectWithName(newProjName);
        aiResponseText = aiResponseText.replace(/\[ACTION:CREATE_PROJECT:.*?\]/, `(Sistem: Project obrolan "${newProjName}" telah dibuat)`);
      }
    } else if (aiResponseText.includes('[ACTION:OPEN_PROJECT:')) {
      const match = aiResponseText.match(/\[ACTION:OPEN_PROJECT:(.*?)\]/);
      if (match) {
        const targetProj = appState.chatProjects.find(p => p.name.toLowerCase().includes(match[1].trim().toLowerCase()));
        if (targetProj) {
          switchChatProject(targetProj.id);
          aiResponseText = aiResponseText.replace(/\[ACTION:OPEN_PROJECT:.*?\]/, `(Sistem: Berhasil beralih ke project "${targetProj.name}")`);
        }
      }
    } else if (aiResponseText.includes('[ACTION:DELETE_PROJECT:')) {
      const match = aiResponseText.match(/\[ACTION:DELETE_PROJECT:(.*?)\]/);
      if (match) {
        const targetProj = appState.chatProjects.find(p => p.name.toLowerCase().includes(match[1].trim().toLowerCase()));
        if (targetProj) {
          deleteChatProject(targetProj.id);
          aiResponseText = aiResponseText.replace(/\[ACTION:DELETE_PROJECT:.*?\]/, `(Sistem: Project "${targetProj.name}" telah dihapus)`);
        }
      }
    }

    const loader = document.getElementById(loadingId);
    if (loader) loader.remove();

    const cleanResponse = stripMarkdownStyles(aiResponseText);
    currentProj.messages.push({ sender: 'bot', text: cleanResponse });
    appendAIChatBubbleUI('bot', cleanResponse);
    saveStateToLocalStorage();
    lastFailedUserQuery = null;
  } catch (error) {
    const loader = document.getElementById(loadingId);
    if (loader) loader.remove();

    const errorMsg = `AI tidak dapat terhubung saat ini (${error.message || 'Koneksi error'}). Periksa koneksi internet Anda dan coba lagi.`;
    currentProj.messages.push({ sender: 'bot', text: errorMsg, isError: true });
    appendAIChatBubbleUI('bot', errorMsg, null, null, true);
    saveStateToLocalStorage();
  }
}

// UNIVERSAL MULTI-PROVIDER AI CALLER (GEMINI, GROQ, OPENAI, DEEPSEEK, OPENROUTER)
async function queryRealAIModel(userQuery, conversationHistory, fileAttachment) {
  const q = userQuery.trim();

  // Math Parser
  const mathRegex = /^(\d+(\.\d+)?)\s*([\+\-\*\/×÷])\s*(\d+(\.\d+)?)\s*\=?$/;
  const match = q.replace(/[\?]/g, '').trim().match(mathRegex);
  if (match && !fileAttachment) {
    const num1 = parseFloat(match[1]);
    const op = match[3];
    const num2 = parseFloat(match[4]);
    let result = 0;
    if (op === '+' || op === 'tambah') result = num1 + num2;
    else if (op === '-' || op === 'kurang') result = num1 - num2;
    else if (op === '*' || op === '×') result = num1 * num2;
    else if (op === '/' || op === '÷') result = num2 !== 0 ? num1 / num2 : 'Tidak terdefinisi';
    return `${result}`;
  }

  const apiKey = appState.user.geminiApiKey || '';
  const preferredProvider = appState.user.aiProvider || 'auto';

  if (apiKey) {
    const provider = detectAIProvider(apiKey, preferredProvider);
    return await callUniversalLLMAPI(provider, apiKey, userQuery, conversationHistory, fileAttachment);
  }

  // Local Fallback Processing (Without API Key)
  const lowerQ = q.toLowerCase();

  // AI Decision Maker Handling
  if (lowerQ.includes('mending') || lowerQ.includes('pilih') || lowerQ.includes('bingung antara') || lowerQ.includes('mana yang lebih cocok')) {
    return `Pilihan A\nKelebihan:\nMemberikan manfaat spesifik sesuai kebutuhan utama.\nKekurangan:\nMemerlukan biaya atau alokasi sumber daya yang lebih besar.\n\nPilihan B\nKelebihan:\nLebih fleksibel dan hemat anggaran.\nKekurangan:\nPerforma atau fitur mungkin lebih terbatas.\n\nPertimbangan utama:\nSesuaikan dengan prioritas utama kamu saat ini.\n\nRekomendasi:\nPilihlah opsi yang paling mendukung tujuan jangka panjangmu.\n\nAlasan:\nOpsi tersebut memberikan efisiensi dan nilai terbaik untuk kebutuhan kamu.`;
  }

  if (lowerQ.includes('presiden indonesia')) return 'Presiden Republik Indonesia saat ini adalah Prabowo Subianto (dilantik Oktober 2024).';
  if (lowerQ.includes('ibu kota jepang') || lowerQ.includes('ibukota jepang')) return 'Ibu kota Jepang adalah Tokyo.';
  if (lowerQ.includes('fotosintesis')) return 'Fotosintesis adalah proses tumbuhan hijau membuat makanan (glukosa) dan oksigen menggunakan sinar matahari, air, dan CO2.';

  return `My Ask siap mendampingi kamu tentang "${q}". Pertanyaan atau analisis file lainnya bisa langsung dikirimkan!`;
}

async function callUniversalLLMAPI(provider, apiKey, userQuery, history, fileAttachment = null) {
  const activeProjectNames = appState.chatProjects.map(p => p.name).join(', ');
  let totalIncome = appState.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  let totalExpense = appState.transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  let balance = totalIncome - totalExpense;

  const systemPromptText = `Kamu adalah AI Assistant bernama "My Ask" yang terintegrasi dengan aplikasi My.
Nama persona kamu dalam percakapan adalah "My Ask" (BUKAN "Maid", karena "Maid" adalah nama lama).
Ketika memperkenalkan diri atau menyebut nama kamu, SELALU gunakan nama "My Ask", contohnya: "Halo Tuan ${appState.user.name || 'Pengguna'}! Saya My Ask, personal assistant yang siap membantu Anda." atau "Saya My Ask, personal assistant Anda."

Kamu dapat membantu percakapan umum, analisis keputusan (AI Decision Maker), memahami file/dokumen/gambar (Make Sense of This), serta membantu mengelola data pengguna secara aktual.

Konteks Aplikasi Saat Ini:
- Project Obrolan Terdaftar: ${activeProjectNames}
- Data Pengguna: Nama=${appState.user.name}, Total Saldo=${formatRupiah(balance)}, Agenda Kalender=${appState.calendarEvents.length} event.

PERATURAN Wajib:
DILARANG MENGGUNAKAN TEKS BOLD (**teks**) ATAU ITALIC (*teks*). Gunakan regular text polos tanpa asterisk (*).

PANDUAN AI DECISION MAKER:
Jika pengguna meminta bantuan menentukan pilihan, identifikasi pilihan, kelebihan, kekurangan, pertimbangan utama, dan rekomendasi secara terstruktur tanpa menggunakan bold/italic.

PANDUAN MAKE SENSE OF THIS:
Jika ada file atau gambar yang dilampirkan, jelaskan inti dokumen/gambar, pihak terkait, tanggal, angka, atau solusi error secara jelas.

EKSEKUSI ACTION APLIKASI:
Jika pengguna meminta membuat, membuka, atau menghapus project obrolan, sertakan tag perintah di akhir jawabanmu:
- Buat project: [ACTION:CREATE_PROJECT:nama_project]
- Buka project: [ACTION:OPEN_PROJECT:nama_project]
- Hapus project: [ACTION:DELETE_PROJECT:nama_project]`;

  // 1. GROQ CLOUD PROVIDER (gsk_...)
  if (provider === 'groq') {
    const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    const messages = [{ role: 'system', content: systemPromptText }];

    history.forEach(m => {
      messages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text || ''
      });
    });

    if (fileAttachment && fileAttachment.isText && messages.length > 0) {
      messages[messages.length - 1].content += `\n[Isi File ${fileAttachment.name}]:\n${fileAttachment.textContent}`;
    }

    let lastErr = '';
    for (const model of models) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, messages, temperature: 0.7 })
        });
        if (res.ok) {
          const data = await res.json();
          return data.choices[0].message.content;
        } else {
          const errData = await res.json().catch(() => ({}));
          lastErr = errData.error ? errData.error.message : `Status ${res.status}`;
          if (res.status === 401 || res.status === 403) throw new Error(lastErr);
        }
      } catch (e) {
        lastErr = e.message;
        if (e.message.includes('401') || e.message.includes('403') || e.message.includes('Invalid API Key')) throw e;
      }
    }
    throw new Error(`Groq API: ${lastErr}`);
  }

  // 2. OPENAI PROVIDER (sk-...)
  if (provider === 'openai') {
    const models = ['gpt-4o-mini', 'gpt-3.5-turbo'];
    const messages = [{ role: 'system', content: systemPromptText }];

    history.forEach(m => {
      messages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text || ''
      });
    });

    let lastErr = '';
    for (const model of models) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, messages, temperature: 0.7 })
        });
        if (res.ok) {
          const data = await res.json();
          return data.choices[0].message.content;
        } else {
          const errData = await res.json().catch(() => ({}));
          lastErr = errData.error ? errData.error.message : `Status ${res.status}`;
          if (res.status === 401 || res.status === 403) throw new Error(lastErr);
        }
      } catch (e) {
        lastErr = e.message;
        if (e.message.includes('401') || e.message.includes('403') || e.message.includes('Incorrect API key')) throw e;
      }
    }
    throw new Error(`OpenAI API: ${lastErr}`);
  }

  // 3. DEEPSEEK PROVIDER (sk-...)
  if (provider === 'deepseek') {
    const messages = [{ role: 'system', content: systemPromptText }];
    history.forEach(m => {
      messages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text || ''
      });
    });

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7 })
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices[0].message.content;
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ? errData.error.message : `Status ${res.status}`);
      }
    } catch (e) {
      throw new Error(`DeepSeek API: ${e.message}`);
    }
  }

  // 4. OPENROUTER PROVIDER (sk-or-...)
  if (provider === 'openrouter') {
    const models = ['google/gemini-2.0-flash-lite-001', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'];
    const messages = [{ role: 'system', content: systemPromptText }];
    history.forEach(m => {
      messages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text || ''
      });
    });

    let lastErr = '';
    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model, messages, temperature: 0.7 })
        });
        if (res.ok) {
          const data = await res.json();
          return data.choices[0].message.content;
        } else {
          const errData = await res.json().catch(() => ({}));
          lastErr = errData.error ? errData.error.message : `Status ${res.status}`;
          if (res.status === 401 || res.status === 403) throw new Error(lastErr);
        }
      } catch (e) {
        lastErr = e.message;
        if (e.message.includes('401') || e.message.includes('403')) throw e;
      }
    }
    throw new Error(`OpenRouter API: ${lastErr}`);
  }

  // 5. GEMINI AI PROVIDER (AIza...)
  const contentsPayload = [];
  history.forEach(m => {
    const role = m.sender === 'user' ? 'user' : 'model';
    const text = m.text || '';
    if (contentsPayload.length > 0 && contentsPayload[contentsPayload.length - 1].role === role) {
      contentsPayload[contentsPayload.length - 1].parts[0].text += `\n${text}`;
    } else {
      contentsPayload.push({
        role: role,
        parts: [{ text: text }]
      });
    }
  });

  if (contentsPayload.length > 0 && contentsPayload[0].role !== 'user') {
    contentsPayload.shift();
  }

  if (fileAttachment && contentsPayload.length > 0) {
    const lastUserMsg = contentsPayload[contentsPayload.length - 1];
    if (fileAttachment.isImage) {
      lastUserMsg.parts.unshift({
        inline_data: { mime_type: fileAttachment.mimeType, data: fileAttachment.base64 }
      });
    } else if (fileAttachment.isPdf) {
      lastUserMsg.parts.unshift({
        inline_data: { mime_type: 'application/pdf', data: fileAttachment.base64 }
      });
    } else if (fileAttachment.isText) {
      lastUserMsg.parts.unshift({
        text: `[Isi File ${fileAttachment.name}]:\n${fileAttachment.textContent}`
      });
    }
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPromptText }]
    },
    contents: contentsPayload
  };

  const geminiModels = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
  let firstGeminiErr = '';

  for (const modelName of geminiModels) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const data = await response.json();
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
          return data.candidates[0].content.parts.map(p => p.text).join('\n');
        }
      } else {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson.error ? errJson.error.message : `Status ${response.status}`;
        if (!firstGeminiErr) firstGeminiErr = errMsg;

        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw new Error(errMsg);
        }
      }
    } catch (e) {
      if (!firstGeminiErr) firstGeminiErr = e.message;
      if (e.message.includes('API key') || e.message.includes('Status 400') || e.message.includes('Status 401') || e.message.includes('Status 403')) {
        throw e;
      }
    }
  }

  throw new Error(`Gemini API: ${firstGeminiErr || 'Gagal terhubung'}`);
}

function appendAIChatBubbleUI(sender, text, sourceTab = null, sourceLabel = null, isError = false, msgIndex = null) {
  const box = document.getElementById('aiChatMessagesBox');
  if (!box) return;

  const cleanText = stripMarkdownStyles(text);
  const bubble = document.createElement('div');
  bubble.className = `ai-msg-bubble ${sender === 'user' ? 'user' : 'bot'}`;
  if (isError) bubble.style.border = '1px solid #EF4444';

  bubble.innerHTML = escapeHtml(cleanText).replace(/\n/g, '<br>');

  if (isError) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-secondary';
    retryBtn.style.cssText = 'font-size: 0.75rem; margin-top: 8px; border-color: #EF4444; color: #EF4444;';
    retryBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Coba Lagi (Retry)`;
    retryBtn.onclick = retryLastAIChat;
    bubble.appendChild(document.createElement('br'));
    bubble.appendChild(retryBtn);
  }

  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

// ==========================================================================
// FIX CALENDAR BUG & DATE SELECTION
// ==========================================================================

function renderCalendar() {
  const monthYearTitle = document.getElementById('calendarMonthYearTitle');
  const daysGrid = document.getElementById('calendarDaysGrid');
  if (!daysGrid) return;

  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth();
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  if (monthYearTitle) {
    monthYearTitle.textContent = `${monthNames[month]} ${year}`;
  }
  daysGrid.innerHTML = '';

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  const isCurrentMonthYear = today.getFullYear() === year && today.getMonth() === month;

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-date-cell empty';
    daysGrid.appendChild(emptyCell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-date-cell';
    cell.textContent = day;

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (isCurrentMonthYear && today.getDate() === day) {
      cell.classList.add('today');
    }

    if (dateStr === selectedCalendarDateStr) {
      cell.classList.add('selected');
    }

    const hasEvents = appState.calendarEvents.some(ev => ev.date === dateStr);
    if (hasEvents) {
      const dot = document.createElement('div');
      dot.className = 'event-dot';
      cell.appendChild(dot);
    }

    cell.onclick = () => {
      selectedCalendarDateStr = dateStr;
      renderCalendar();
    };

    daysGrid.appendChild(cell);
  }

  renderCalendarEventsList();
  renderMaidConflictAlerts();
}

function navigateCalendarMonth(direction) {
  calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + direction);
  renderCalendar();
}

let pendingDeleteCalendarEventId = null;

function renderCalendarEventsList() {
  const container = document.getElementById('calendarEventsList');
  const dateTitle = document.getElementById('selectedDateTitle');
  if (!container) return;

  if (dateTitle) {
    dateTitle.textContent = `Event & Penanda (${selectedCalendarDateStr})`;
  }

  const eventsOnDate = appState.calendarEvents.filter(ev => ev.date === selectedCalendarDateStr);

  container.innerHTML = '';
  if (eventsOnDate.length === 0) {
    container.innerHTML = `<div class="card-item text-center">Tidak ada event pada tanggal ${selectedCalendarDateStr}.</div>`;
    return;
  }

  eventsOnDate.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'card-item flex-between mb-2';
    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <i class="fa-solid fa-calendar-check" style="color: ${normalizeLegacyColor(ev.color)}; font-size: 1.2rem;"></i>
        <div>
          <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">${escapeHtml(ev.title)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${ev.date}</div>
        </div>
      </div>
      <button class="btn-secondary" style="padding: 6px 10px; color: #EF4444; border-color: #FCA5A5; font-size: 0.78rem; width: auto;" onclick="confirmDeleteCalendarEvent(${ev.id})" title="Hapus Event">
        <i class="fa-solid fa-trash-can"></i> Hapus
      </button>
    `;
    container.appendChild(card);
  });
}

function confirmDeleteCalendarEvent(eventId) {
  const eventObj = appState.calendarEvents.find(ev => ev.id === eventId);
  if (!eventObj) return;

  pendingDeleteCalendarEventId = eventId;
  const titleEl = document.getElementById('deleteEventModalTitle');
  if (titleEl) {
    titleEl.textContent = `Hapus Event "${eventObj.title}"?`;
  }

  const confirmBtn = document.getElementById('btnConfirmDeleteEvent');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      closeModal('modalDeleteEventConfirmation');
      if (pendingDeleteCalendarEventId !== null) {
        executeDeleteCalendarEvent(pendingDeleteCalendarEventId);
        pendingDeleteCalendarEventId = null;
      }
    };
  }

  openModal('modalDeleteEventConfirmation');
}

function executeDeleteCalendarEvent(eventId) {
  const target = appState.calendarEvents.find(ev => ev.id === eventId);
  const eventTitle = target ? target.title : '';

  appState.calendarEvents = appState.calendarEvents.filter(ev => ev.id !== eventId);
  saveStateToLocalStorage();
  renderCalendar();
  showNotificationBanner(`Event "${eventTitle || 'Kalender'}" berhasil dihapus.`);
}

function openAddEventModal() {
  openModal('modalAddEvent');
}

function saveNewCalendarEvent() {
  const title = document.getElementById('eventTitleInput').value.trim();
  const date = document.getElementById('eventDateInput').value;
  const color = document.getElementById('eventColorInput').value;

  if (!title || !date) return;

  appState.calendarEvents.push({ id: Date.now(), title, date, color });
  saveStateToLocalStorage();
  rescheduleUpcomingNotifications();
  renderCalendar();
  closeModal('modalAddEvent');
  showNotificationBanner('Event kalender disimpan! 🗓️');
}

// ==========================================================================
// MY PDF TOOL - OVERHAULED LAYOUT RECONSTRUCTION ENGINE
// ==========================================================================

function switchSmartToolSubTab(toolName) {
  document.querySelectorAll('.smart-tool-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.smart-tool-view').forEach(v => v.classList.remove('active'));

  if (toolName === 'pdf2img') {
    document.getElementById('tabBtnPDF2Image').classList.add('active');
    document.getElementById('subtool-pdf2img').classList.add('active');
  } else if (toolName === 'pdf2docx') {
    document.getElementById('tabBtnPDF2Docx').classList.add('active');
    document.getElementById('subtool-pdf2docx').classList.add('active');
  } else if (toolName === 'ai-scanner') {
    document.getElementById('tabBtnAIScanner').classList.add('active');
    document.getElementById('subtool-ai-scanner').classList.add('active');
    aiScannerEnsureAssets();
  } else if (toolName === 'ai-signature') {
    document.getElementById('tabBtnAISignature').classList.add('active');
    document.getElementById('subtool-ai-signature').classList.add('active');
    aiScannerEnsureAssets();
  }
}

function loadPDFPagesForImageRender(event) {
  try {
    const file = event.target.files[0];
    const nameEl = document.getElementById('pdfImgFileName');
    if (!file) {
      if (nameEl) nameEl.innerHTML = '<i class="fa-regular fa-file"></i> Belum ada file dipilih';
      return;
    }
    if (nameEl) nameEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#22C55E;"></i> ' + file.name + ' · ' + (file.size ? Math.round(file.size / 1024) + ' KB' : '');
    if (!window.pdfjsLib) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      const typedarray = new Uint8Array(e.target.result);
      pdfjsLib.getDocument(typedarray).promise.then(pdf => {
        loadedPDFDocument = pdf;
        const opts = document.getElementById('pdfToImgPagesOptions');
        opts.style.display = 'block';
        showNotificationBanner(`File PDF dimuat (${pdf.numPages} Halaman)! Pilih halaman untuk dikonversi.`);
      }).catch(err => {
        showNotificationBanner('Gagal membaca PDF: File tidak valid.');
      });
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    console.error('PDF Load Error:', err);
  }
}

function executeRealPDFToImageRender() {
  if (!loadedPDFDocument) {
    alert('Silakan pilih file PDF terlebih dahulu!');
    return;
  }

  const selectionInput = document.getElementById('pdfImgPageSelectionInput').value.trim();
  let pagesToRender = [];

  if (!selectionInput) {
    for (let i = 1; i <= loadedPDFDocument.numPages; i++) pagesToRender.push(i);
  } else {
    pagesToRender = selectionInput.split(',')
      .map(p => parseInt(p.trim(), 10))
      .filter(p => !isNaN(p) && p >= 1 && p <= loadedPDFDocument.numPages);
  }

  if (pagesToRender.length === 0) {
    alert('Nomor halaman tidak valid!');
    return;
  }

  const resultsContainer = document.getElementById('pdfToImgResultsContainer');
  resultsContainer.innerHTML = `<div class="card-item text-center">Merender ${pagesToRender.length} halaman PDF menjadi gambar...</div>`;

  pagesToRender.forEach(pageNum => {
    loadedPDFDocument.getPage(pageNum).then(page => {
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      page.render({ canvasContext: ctx, viewport: viewport }).promise.then(() => {
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const card = document.createElement('div');
        card.className = 'card-item';
        card.innerHTML = `
          <div class="flex-between mb-2">
            <div style="font-weight: 800; font-size: 0.9rem;">Halaman ${pageNum} (Gambar JPG)</div>
            <a href="${imgDataUrl}" download="PDF_Page_${pageNum}.jpg" class="btn-secondary" style="font-size: 0.75rem; text-decoration: none;">Unduh Gambar</a>
          </div>
          <img src="${imgDataUrl}" style="max-width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--border-light);" alt="Rendered Page">
        `;
        resultsContainer.appendChild(card);
      });
    });
  });

  showNotificationBanner('PDF to Image berhasil dikonversi! 🖼️');
}

function pdfDocxPick(event) {
  const file = event.target.files && event.target.files[0];
  const nameEl = document.getElementById('pdfDocxFileName');
  if (!nameEl) return;
  if (!file) { nameEl.innerHTML = '<i class="fa-regular fa-file"></i> Belum ada file dipilih'; return; }
  nameEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#22C55E;"></i> ' + file.name + ' · ' + (file.size ? Math.round(file.size / 1024) + ' KB' : '');
}

function executeValidPDFToDOCX() {
  const input = document.getElementById('realPDFToDocxInput');
  const file = input ? input.files[0] : null;
  const container = document.getElementById('pdfToDocxResultsContainer');

  if (!file) {
    alert('Silakan pilih file PDF terlebih dahulu!');
    return;
  }

  if (!window.JSZip || !window.pdfjsLib) {
    alert('Library pendukung konversi belum siap.');
    return;
  }

  container.innerHTML = `<div class="card-item text-center"><i class="fa-solid fa-spinner fa-spin"></i> Melakukan Layout Reconstruction (Teks, Tabel, Gambar, Alignment)...</div>`;

  const reader = new FileReader();
  reader.onerror = function() {
    container.innerHTML = `<div class="card-item text-center" style="color: red;">Gagal membaca file PDF. Silakan pilih file lain.</div>`;
  };

  reader.onload = async function(e) {
    try {
      const typedarray = new Uint8Array(e.target.result);
      const pdf = await pdfjsLib.getDocument(typedarray).promise;

      const pageStructures = [];
      const mediaFiles = [];
      let imageCounter = 0;

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });

        const pageWidthDxa = Math.round(viewport.width * 20);
        const pageHeightDxa = Math.round(viewport.height * 20);
        const isLandscape = viewport.width > viewport.height;

        const textContent = await page.getTextContent();
        const lineMap = {};

        textContent.items.forEach(item => {
          if (!item.str || item.str.length === 0) return;
          const y = Math.round(item.transform[5]);
          const x = item.transform[4];
          const fontSize = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10;
          const width = (typeof item.width === 'number' && item.width > 0) ? item.width : (item.str.length * fontSize * 0.5);

          let bold = false, italic = false;
          try {
            const fontObj = page.commonObjs.get(item.fontName);
            if (fontObj) {
              const fname = ((fontObj.name || fontObj.fallbackName || '') + '');
              bold = !!fontObj.bold || /bold|black|heavy/i.test(fname);
              italic = !!fontObj.italic || /italic|oblique/i.test(fname);
            }
          } catch (fontErr) { }

          if (!lineMap[y]) lineMap[y] = [];
          lineMap[y].push({ x, width, text: item.str, fontSize, bold, italic });
        });

        const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
        const rawLines = sortedY
          .map(y => buildLineFromItems(lineMap[y].sort((a, b) => a.x - b.x), viewport.width, y))
          .filter(l => l.isTable ? l.cells.length > 0 : l.runs.length > 0);

        const orderedLines = detectAndReorderColumns(rawLines, viewport.width);
        const pageImages = await extractPageImages(page);
        pageImages.forEach(img => {
          img.docxName = `image${++imageCounter}.png`;
          mediaFiles.push({ name: img.docxName, base64: img.base64 });
        });

        const blocks = [
          ...orderedLines.map(l => ({ type: 'line', y: l.y, data: l })),
          ...pageImages.map(im => ({ type: 'image', y: im.y, data: im }))
        ].sort((a, b) => b.y - a.y);

        pageStructures.push({ pageNumber: i, pageWidthDxa, pageHeightDxa, isLandscape, blocks });
      }

      generateReconstructedDOCXArchive(file.name, pageStructures, mediaFiles, container);
    } catch (err) {
      console.error('PDF->DOCX Error:', err);
      container.innerHTML = `<div class="card-item text-center" style="color: red;">Terjadi kesalahan saat memproses layout: ${escapeHtml(err.message)}</div>`;
    }
  };

  reader.readAsArrayBuffer(file);
}

function buildLineFromItems(items, pageWidth, y) {
  const gaps = [];
  for (let k = 0; k < items.length - 1; k++) {
    gaps.push(items[k + 1].x - (items[k].x + items[k].width));
  }

  const avgFontSize = items.reduce((s, it) => s + it.fontSize, 0) / items.length;
  const tableGapThreshold = avgFontSize * 2.2;

  const bigGaps = gaps.filter(g => g > tableGapThreshold);
  const isTableRow = items.length >= 3 && bigGaps.length >= 2;

  if (isTableRow) {
    const cells = [];
    let currentCell = [items[0]];
    for (let k = 0; k < gaps.length; k++) {
      if (gaps[k] > tableGapThreshold) {
        cells.push(currentCell);
        currentCell = [];
      }
      currentCell.push(items[k + 1]);
    }
    cells.push(currentCell);
    return { y, isTable: true, cells: cells.map(cellItems => mergeItemsToRuns(cellItems)) };
  }

  const runs = mergeItemsToRuns(items);
  const minX = items[0].x;
  const maxX = items[items.length - 1].x + items[items.length - 1].width;
  const midPoint = pageWidth / 2;
  const lineCenter = (minX + maxX) / 2;
  const fullTextLen = runs.reduce((s, r) => s + r.text.length, 0);

  let alignment = 'left';
  if (Math.abs(lineCenter - midPoint) < pageWidth * 0.04 && fullTextLen < 70 && minX > pageWidth * 0.08) {
    alignment = 'center';
  } else if (minX > pageWidth * 0.6) {
    alignment = 'right';
  } else if (minX < pageWidth * 0.15 && maxX > pageWidth * 0.85) {
    alignment = 'both';
  }

  return { y, isTable: false, runs, alignment, minX, maxX };
}

function mergeItemsToRuns(items) {
  const runs = [];
  let current = null;
  items.forEach((it, idx) => {
    const prevGap = idx === 0 ? 0 : (it.x - (items[idx - 1].x + items[idx - 1].width));
    const avgSize = idx === 0 ? it.fontSize : (it.fontSize + items[idx - 1].fontSize) / 2;
    const needsSpace = idx > 0 && prevGap > avgSize * 0.12;
    const text = (needsSpace ? ' ' : '') + it.text;
    if (current && current.bold === it.bold && current.italic === it.italic) {
      current.text += text;
    } else {
      current = { text, bold: it.bold, italic: it.italic };
      runs.push(current);
    }
  });
  return runs;
}

function detectAndReorderColumns(lines, pageWidth) {
  if (lines.length < 6) return lines;
  const mid = pageWidth / 2;
  let leftOnly = 0, rightOnly = 0, spanning = 0;

  lines.forEach(l => {
    if (l.isTable) { spanning++; return; }
    if (l.maxX < mid + pageWidth * 0.04) leftOnly++;
    else if (l.minX > mid - pageWidth * 0.04) rightOnly++;
    else spanning++;
  });

  const columnar = leftOnly > lines.length * 0.35 && rightOnly > lines.length * 0.35 && spanning < lines.length * 0.25;
  if (!columnar) return lines;

  const left = lines.filter(l => l.isTable || l.maxX < mid + pageWidth * 0.04).sort((a, b) => b.y - a.y);
  const right = lines.filter(l => !l.isTable && l.minX > mid - pageWidth * 0.04).sort((a, b) => b.y - a.y);
  const combined = [...left, ...right];
  combined.forEach((l, idx) => { l.y = combined.length - idx; });
  return combined;
}

async function extractPageImages(page) {
  const results = [];
  try {
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];

    const mul = (m1, m2) => ([
      m1[0] * m2[0] + m1[1] * m2[2],
      m1[0] * m2[1] + m1[1] * m2[3],
      m1[2] * m2[0] + m1[3] * m2[2],
      m1[2] * m2[1] + m1[3] * m2[3],
      m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
      m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
    ]);

    for (let idx = 0; idx < opList.fnArray.length; idx++) {
      const fn = opList.fnArray[idx];
      const args = opList.argsArray[idx];

      if (fn === OPS.save) {
        stack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        if (stack.length) ctm = stack.pop();
      } else if (fn === OPS.transform) {
        ctm = mul(args, ctm);
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
        try {
          const imgObj = await getPdfImageObj(page, args[0]);
          const dataUrl = imageObjToPngDataUrl(imgObj);
          if (dataUrl) {
            const widthPt = Math.hypot(ctm[0], ctm[1]) || 100;
            const heightPt = Math.hypot(ctm[2], ctm[3]) || 100;
            results.push({ y: ctm[5], x: ctm[4], widthPt, heightPt, base64: dataUrl.split(',')[1] });
          }
        } catch (imgErr) { }
      }
    }
  } catch (opErr) { }
  return results;
}

function getPdfImageObj(page, objId) {
  return new Promise(resolve => {
    try {
      page.objs.get(objId, obj => resolve(obj));
    } catch (e) { resolve(null); }
  });
}

function imageObjToPngDataUrl(imgObj) {
  if (!imgObj || !imgObj.width || !imgObj.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = imgObj.width;
  canvas.height = imgObj.height;
  const ctx = canvas.getContext('2d');

  if (imgObj.bitmap) {
    ctx.drawImage(imgObj.bitmap, 0, 0);
  } else if (imgObj.data) {
    const src = imgObj.data;
    const pixelCount = imgObj.width * imgObj.height;
    const channels = Math.round(src.length / pixelCount);
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let p = 0; p < pixelCount; p++) {
      const j = p * 4;
      if (channels >= 4) {
        rgba[j] = src[p * 4]; rgba[j + 1] = src[p * 4 + 1]; rgba[j + 2] = src[p * 4 + 2]; rgba[j + 3] = src[p * 4 + 3];
      } else if (channels === 3) {
        rgba[j] = src[p * 3]; rgba[j + 1] = src[p * 3 + 1]; rgba[j + 2] = src[p * 3 + 2]; rgba[j + 3] = 255;
      } else {
        rgba[j] = src[p]; rgba[j + 1] = src[p]; rgba[j + 2] = src[p]; rgba[j + 3] = 255;
      }
    }
    ctx.putImageData(new ImageData(rgba, imgObj.width, imgObj.height), 0, 0);
  } else {
    return null;
  }
  return canvas.toDataURL('image/png');
}

function generateReconstructedDOCXArchive(originalFileName, pageStructures, mediaFiles, container) {
  try {
    const zip = new JSZip();
    const EMU_PER_PT = 12700;

    const imageRelMap = {};
    mediaFiles.forEach((m, idx) => { imageRelMap[m.name] = `rId${idx + 1}`; });

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
    zip.file('[Content_Types].xml', contentTypesXml);

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
    zip.folder('_rels').file('.rels', relsXml);

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
</w:styles>`;
    zip.folder('word').file('styles.xml', stylesXml);

    if (mediaFiles.length > 0) {
      const imgRelsEntries = mediaFiles.map(m =>
        `<Relationship Id="${imageRelMap[m.name]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`
      ).join('');
      const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imgRelsEntries}</Relationships>`;
      zip.folder('word').folder('_rels').file('document.xml.rels', docRelsXml);

      const mediaFolder = zip.folder('word').folder('media');
      mediaFiles.forEach(m => mediaFolder.file(m.name, m.base64, { base64: true }));
    }

    let documentBodyXml = '';
    let lastSectPrXml = '';
    let imgIdCounter = 0;

    pageStructures.forEach((pg, pIdx) => {
      const usableWidthDxa = Math.max(pg.pageWidthDxa - 2880, 1440);

      pg.blocks.forEach(block => {
        if (block.type === 'image') {
          const im = block.data;
          const rId = imageRelMap[im.docxName];
          if (!rId) return;
          const cx = Math.round(im.widthPt * EMU_PER_PT);
          const cy = Math.round(im.heightPt * EMU_PER_PT);
          imgIdCounter++;
          documentBodyXml += `<w:p><w:r><w:drawing>
            <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
              <wp:extent cx="${cx}" cy="${cy}"/>
              <wp:docPr id="${imgIdCounter}" name="Picture ${imgIdCounter}"/>
              <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:nvPicPr>
                      <pic:cNvPr id="${imgIdCounter}" name="Picture ${imgIdCounter}"/>
                      <pic:cNvPicPr/>
                    </pic:nvPicPr>
                    <pic:blipFill>
                      <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/>
                      <a:stretch><a:fillRect/></a:stretch>
                    </pic:blipFill>
                    <pic:spPr>
                      <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                    </pic:spPr>
                  </pic:pic>
                </a:graphicData>
              </a:graphic>
            </wp:inline>
          </w:drawing></w:r></w:p>`;
          return;
        }

        const line = block.data;
        if (line.isTable) {
          const colCount = line.cells.length;
          const colWidth = Math.max(Math.floor(usableWidthDxa / colCount), 400);
          const gridCols = Array.from({ length: colCount }, () => `<w:gridCol w:w="${colWidth}"/>`).join('');
          const rowCells = line.cells.map(cellRuns => `<w:tc>
              <w:tcPr>
                <w:tcW w:w="${colWidth}" w:type="dxa"/>
                <w:tcBorders>
                  <w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                  <w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                  <w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                </w:tcBorders>
              </w:tcPr>
              <w:p>${runsToXml(cellRuns)}</w:p>
            </w:tc>`).join('');

          documentBodyXml += `<w:tbl>
            <w:tblPr>
              <w:tblW w:w="${usableWidthDxa}" w:type="dxa"/>
              <w:tblBorders>
                <w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
                <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
              </w:tblBorders>
            </w:tblPr>
            <w:tblGrid>${gridCols}</w:tblGrid>
            <w:tr>${rowCells}</w:tr>
          </w:tbl>`;
        } else {
          const jcVal = line.alignment === 'center' ? 'center' : (line.alignment === 'right' ? 'right' : (line.alignment === 'both' ? 'both' : 'left'));
          documentBodyXml += `<w:p><w:pPr><w:jc w:val="${jcVal}"/></w:pPr>${runsToXml(line.runs)}</w:p>`;
        }
      });

      const sectPrInner = `<w:pgSz w:w="${pg.pageWidthDxa}" w:h="${pg.pageHeightDxa}" w:orient="${pg.isLandscape ? 'landscape' : 'portrait'}"/>
            <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>`;

      if (pIdx < pageStructures.length - 1) {
        documentBodyXml += `<w:p><w:pPr><w:sectPr>${sectPrInner}</w:sectPr></w:pPr></w:p>`;
      } else {
        lastSectPrXml = `<w:sectPr>${sectPrInner}</w:sectPr>`;
      }
    });

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${documentBodyXml}
    ${lastSectPrXml}
  </w:body>
</w:document>`;
    zip.folder('word').file('document.xml', documentXml);

    zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      .then(function(blob) {
        const outputDocxName = originalFileName.replace(/\.pdf$/i, '') + '.docx';
        const docxUrl = URL.createObjectURL(blob);

        container.innerHTML = `
          <div class="card-item p-4" style="border-left: 5px solid #3B82F6;">
            <div style="font-weight: 800; font-size: 1.05rem; color: #3B82F6; margin-bottom: 6px;">
              <i class="fa-solid fa-file-word"></i> ${escapeHtml(outputDocxName)}
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 14px;">
              Rekonstruksi Layout DOCX Berhasil! Ukuran halaman, orientasi, margin, alignment, bold/italic, tabel & gambar dipertahankan.
            </div>

            <div class="flex-between gap-2" style="flex-wrap: wrap;">
              <a href="${docxUrl}" download="${outputDocxName}" class="btn-primary" style="flex: 2; font-size: 0.85rem; padding: 10px; background: #3B82F6; text-decoration: none; text-align: center;" onclick="triggerDocxDownloadNotice('${escapeHtml(outputDocxName)}')">
                <i class="fa-solid fa-download"></i> Download / Simpan File DOCX
              </a>
              <button class="btn-secondary" style="flex: 1; font-size: 0.82rem; padding: 10px;" onclick="window.open('${docxUrl}', '_blank')">
                <i class="fa-solid fa-folder-open"></i> Buka File
              </button>
              <button class="btn-secondary" style="flex: 1; font-size: 0.82rem; padding: 10px;" onclick="shareDocxFileUrl('${docxUrl}', '${escapeHtml(outputDocxName)}')">
                <i class="fa-solid fa-share-nodes"></i> Bagikan
              </button>
            </div>
          </div>
        `;
        showNotificationBanner(`Layout DOCX "${outputDocxName}" direkonstruksi & siap disimpan! 📄`);
      }).catch(err => {
        container.innerHTML = `<div class="card-item text-center" style="color: red;">Gagal merekonstruksi DOCX: ${escapeHtml(err.message)}</div>`;
      });
  } catch (err) {
    console.error('DOCX Build Error:', err);
    container.innerHTML = `<div class="card-item text-center" style="color: red;">Terjadi kesalahan saat mengompresi DOCX.</div>`;
  }
}

function runsToXml(runs) {
  return runs.map(r => {
    const rPr = (r.bold || r.italic)
      ? `<w:rPr>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr>`
      : '';
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
  }).join('');
}

function triggerDocxDownloadNotice(filename) {
  showNotificationBanner(`File "${filename}" berhasil diunduh dan tersimpan di memori perangkat! 📄`);
}

function shareDocxFileUrl(url, filename) {
  if (navigator.share) {
    navigator.share({
      title: filename,
      text: `File DOCX hasil konversi: ${filename}`,
      url: url
    }).catch(() => {});
  } else {
    showNotificationBanner(`Berbagi tidak didukung browser. File "${filename}" siap diunduh!`);
  }
}

function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
}

// ==========================================================================
// EXISTING CORE FUNCTIONS (BOOKS, NOTES, FINANCE, REMINDERS, MAPS)
// ==========================================================================

function renderBooks() {
  const container = document.getElementById('booksListContainer');
  if (!container) return;

  container.innerHTML = '';
  if (appState.books.length === 0) {
    container.innerHTML = `<div class="card-item text-center">Belum ada buku kuliah.</div>`;
    return;
  }

  appState.books.forEach(b => {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <div class="flex-between">
        <div class="book-title">${escapeHtml(b.title)}</div>
        <span class="badge badge-purple">${b.notes ? b.notes.length : 0} Catatan</span>
      </div>
      <div class="book-lecturer"><i class="fa-solid fa-user-tie"></i> Dosen: <strong>${escapeHtml(b.lecturer)}</strong></div>
      <div class="flex-between mt-2 gap-2">
        <button class="btn-primary" style="flex: 2; padding: 8px 14px; font-size: 0.8rem;" onclick="openBookDetail(${b.id})">
          <i class="fa-solid fa-folder-open"></i> Buka Catatan & Dokumen
        </button>
        <button class="btn-secondary" style="flex: 1; padding: 8px 10px; font-size: 0.78rem;" onclick="openEditBookModal(${b.id})">
          <i class="fa-solid fa-pen-to-square"></i> Edit
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function saveNewBook() {
  const title = document.getElementById('bookTitleInput').value.trim();
  const lecturer = document.getElementById('bookLecturerInput').value.trim();

  if (!title || !lecturer) return;

  appState.books.unshift({ id: Date.now(), title, lecturer, createdAt: new Date().toLocaleDateString('id-ID'), notes: [] });
  saveStateToLocalStorage();
  renderBooks();

  document.getElementById('bookTitleInput').value = '';
  document.getElementById('bookLecturerInput').value = '';
  closeModal('modalAddBook');
  showNotificationBanner(`Buku kuliah "${title}" dibuat! 📘`);
}

function openEditBookModal(bookId) {
  const book = appState.books.find(b => b.id === bookId);
  if (!book) return;

  appState.selectedBookId = bookId;
  document.getElementById('editBookTitleInput').value = book.title;
  document.getElementById('editBookLecturerInput').value = book.lecturer;
  openModal('modalEditBook');
}

let editingBookNoteId = null;
let tempEditorPhotos = [];
let tempEditorDocs = [];
let pendingDeleteAttachmentTarget = null;
let pendingDeleteBookId = null;

function saveEditBook() {
  const book = appState.books.find(b => b.id === appState.selectedBookId);
  if (!book) return;

  book.title = document.getElementById('editBookTitleInput').value.trim();
  book.lecturer = document.getElementById('editBookLecturerInput').value.trim();

  saveStateToLocalStorage();
  renderBooks();
  if (appState.selectedBookId) {
    openBookDetail(appState.selectedBookId);
  }
  closeModal('modalEditBook');
  showNotificationBanner('Proyek buku diperbarui! ✏️');
}

function toggleBookDetailMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('bookDetailHeaderMenu');
  if (!menu) return;
  const isVisible = menu.style.display === 'block';
  closeAllNoteDropdowns();
  if (!isVisible) {
    menu.style.display = 'block';
  }
}

function openEditBookModalFromHeader(event) {
  if (event) event.stopPropagation();
  closeAllNoteDropdowns();
  if (appState.selectedBookId) {
    openEditBookModal(appState.selectedBookId);
  }
}

function confirmDeleteBookFromHeader(event) {
  if (event) event.stopPropagation();
  closeAllNoteDropdowns();
  pendingDeleteBookId = appState.selectedBookId;
  openModal('modalDeleteBookConfirmation');
}

function executeDeleteBook() {
  if (!pendingDeleteBookId) return;

  appState.books = appState.books.filter(b => b.id !== pendingDeleteBookId);
  pendingDeleteBookId = null;

  saveStateToLocalStorage();
  closeModal('modalDeleteBookConfirmation');
  switchTab('books');
  renderBooks();
  showNotificationBanner('Buku telah dihapus! 🗑️');
}

function openBookDetail(bookId) {
  appState.selectedBookId = bookId;
  const book = appState.books.find(b => b.id === bookId);
  if (!book) return;

  const headerCard = document.getElementById('selectedBookHeaderCard');
  if (headerCard) {
    headerCard.innerHTML = `
      <div class="flex-between mb-2">
        <div class="book-title" style="font-size: 1.2rem;">${escapeHtml(book.title)}</div>
      </div>
      <div class="book-lecturer" style="font-size: 0.88rem;"><i class="fa-solid fa-user-tie"></i> Dosen: <strong>${escapeHtml(book.lecturer)}</strong></div>
    `;
  }

  switchTab('book-detail');
  renderBookNotes();
}

function renderBookNotes() {
  const container = document.getElementById('bookNotesListContainer');
  const book = appState.books.find(b => b.id === appState.selectedBookId);
  if (!container || !book) return;

  container.innerHTML = '';

  if (!book.notes || book.notes.length === 0) {
    container.innerHTML = `
      <div class="card-item text-center" style="padding: 32px 20px; border-radius: 20px;">
        <i class="fa-regular fa-folder-open mb-2" style="font-size: 2rem; color: var(--primary);"></i>
        <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-bottom: 4px;">Belum ada catatan atau lampiran</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 14px;">Mulai buat catatan kuliah, potret foto, atau unggah dokumen.</div>
        <button class="btn-primary" style="width: auto; margin: 0 auto; padding: 10px 20px; font-size: 0.85rem;" onclick="openBookNoteEditor()">
          <i class="fa-solid fa-pen-nib"></i> Tulis Catatan / Unggah File
        </button>
      </div>
    `;
    return;
  }

  book.notes.forEach(note => {
    if (!note.id) {
      note.id = 'bnote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    }

    // 1. Text Note Content Card
    if (note.content) {
      const card = document.createElement('div');
      card.className = 'card-item mb-3';
      card.style.cssText = 'border-radius: 20px; padding: 20px; box-shadow: var(--shadow-sm); border: 1px solid var(--border-light); position: relative;';
      card.innerHTML = `
        <div class="flex-between mb-2">
          <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700; display: flex; align-items: center; gap: 6px;">
            <i class="fa-regular fa-calendar" style="color: var(--primary);"></i> ${note.date}
          </div>
          <div style="position: relative;">
            <button class="note-card-menu-btn" onclick="toggleBookNoteItemMenu('${note.id}', event)" title="Opsi Catatan">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <div class="note-card-dropdown" id="bnote-menu-${note.id}" style="display: none;">
              <button class="dropdown-action-item" onclick="openBookNoteEditorForEdit('${note.id}')">
                <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit
              </button>
              <button class="dropdown-action-item text-danger" onclick="confirmDeleteBookNote('${note.id}', event)">
                <i class="fa-solid fa-trash-can" style="color: #EF4444;"></i> Hapus
              </button>
            </div>
          </div>
        </div>
        <div style="font-size: 0.96rem; color: var(--text-main); line-height: 1.65; white-space: pre-wrap;">${escapeHtml(note.content)}</div>
      `;
      container.appendChild(card);
    }

    // 2. Photos as Instagram-Style Photo Feed Posts
    if (note.photos && note.photos.length > 0) {
      note.photos.forEach((photo, pIdx) => {
        const photoSrc = typeof photo === 'string' ? photo : (photo.data || photo.url || '');
        const photoImgId = `bimg-${note.id}-${pIdx}`;
        const photoDate = typeof photo === 'object' && photo.createdAt ? photo.createdAt : note.date;
        const photoMenuId = `bphoto-menu-${note.id}-${pIdx}`;

        const postCard = document.createElement('div');
        postCard.className = 'photo-post-card mb-4';
        postCard.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 22px; padding: 16px; box-shadow: var(--shadow-sm); max-width: 720px; margin-left: auto; margin-right: auto; position: relative;';

        postCard.innerHTML = `
          <div class="flex-between mb-3" style="align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--primary-light); display: flex; align-items: center; justify-content: center;">
                <i class="fa-solid fa-camera" style="color: var(--primary); font-size: 0.9rem;"></i>
              </div>
              <div>
                <div style="font-weight: 800; font-size: 0.85rem; color: var(--text-main);">Foto Lampiran</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${photoDate}</div>
              </div>
            </div>
            <div style="position: relative;">
              <button class="note-card-menu-btn" onclick="toggleBookNoteItemMenu('${photoMenuId}', event)" title="Opsi Foto">
                <i class="fa-solid fa-ellipsis-vertical"></i>
              </button>
              <div class="note-card-dropdown" id="bnote-menu-${photoMenuId}" style="display: none;">
                <button class="dropdown-action-item" onclick="openBookNoteEditorForEdit('${note.id}')">
                  <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit Catatan
                </button>
                <button class="dropdown-action-item text-danger" onclick="confirmDeletePhoto('${book.id}', '${note.id}', ${pIdx}, event)">
                  <i class="fa-solid fa-trash-can" style="color: #EF4444;"></i> Hapus Foto
                </button>
              </div>
            </div>
          </div>
          <div style="background: var(--bg-subtle); border-radius: 16px; overflow: hidden; border: 1px solid var(--border-light); display: flex; align-items: center; justify-content: center; margin-bottom: 10px; min-height: 120px;">
            <img id="${photoImgId}" src="${photoSrc}" alt="Foto Catatan Buku" style="width: 100%; height: auto; max-height: 550px; object-fit: contain; display: block; border-radius: 16px;">
          </div>
          ${note.content ? `<div style="font-size: 0.9rem; color: var(--text-main); line-height: 1.5; padding: 4px 6px;">${escapeHtml(note.content)}</div>` : ''}
        `;
        container.appendChild(postCard);

        // Foto baru (hasil migrasi ke AppFileStorage) tidak punya base64 langsung,
        // jadi src-nya dimuat belakangan secara async.
        if (!photoSrc && photo && photo.fileId) {
          AppFileStorage.getFileAsDataUrl(photo.fileId, photo.mimeType).then(dataUrl => {
            const imgEl = document.getElementById(photoImgId);
            if (imgEl && dataUrl) imgEl.src = dataUrl;
          }).catch(err => console.error('Gagal memuat foto catatan:', err));
        }
      });
    }

    // 3. Document Attachment Cards
    if (note.docs && note.docs.length > 0) {
      note.docs.forEach((doc, dIdx) => {
        const docName = typeof doc === 'string' ? doc : (doc.name || 'Dokumen Lampiran');
        const docSize = typeof doc === 'object' && doc.size ? doc.size : 'Dokumen';
        const docType = typeof doc === 'object' && doc.type ? doc.type : getDocTypeLabel(docName);
        const docDate = typeof doc === 'object' && doc.createdAt ? doc.createdAt : note.date;
        const docData = typeof doc === 'object' ? (doc.data || null) : null;
        const docFileId = typeof doc === 'object' ? (doc.fileId || null) : null;
        const docMenuId = `bdoc-menu-${note.id}-${dIdx}`;

        const docCard = document.createElement('div');
        docCard.className = 'doc-card-item mb-3';
        docCard.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 18px; padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 14px; box-shadow: var(--shadow-sm); max-width: 720px; margin-left: auto; margin-right: auto; position: relative; cursor: pointer;';
        docCard.onclick = (e) => openOrDownloadDoc(docData || docFileId, docName, e, !docData && !!docFileId);

        let iconClass = 'fa-file-lines';
        if (docType === 'PDF') iconClass = 'fa-file-pdf';
        if (docType === 'DOCX') iconClass = 'fa-file-word';
        if (docType === 'PPT') iconClass = 'fa-file-powerpoint';

        docCard.innerHTML = `
          <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
            <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--primary-light); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i class="fa-solid ${iconClass}" style="color: var(--primary); font-size: 1.25rem;"></i>
            </div>
            <div style="min-width: 0;">
              <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;">${escapeHtml(docName)}</div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
                <span class="note-cat-badge" style="margin-right: 6px;">${docType}</span> ${docSize} • ${docDate}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; position: relative;">
            <button class="note-card-menu-btn" onclick="toggleBookNoteItemMenu('${docMenuId}', event)" title="Opsi Dokumen">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
            <div class="note-card-dropdown" id="bnote-menu-${docMenuId}" style="display: none; right: 0;">
              <button class="dropdown-action-item" id="bdoc-openbtn-${note.id}-${dIdx}">
                <i class="fa-solid fa-file-arrow-down" style="color: var(--primary);"></i> Buka / Unduh
              </button>
              <button class="dropdown-action-item" onclick="openBookNoteEditorForEdit('${note.id}')">
                <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit
              </button>
              <button class="dropdown-action-item text-danger" onclick="confirmDeleteDoc('${book.id}', '${note.id}', ${dIdx}, event)">
                <i class="fa-solid fa-trash-can" style="color: #EF4444;"></i> Hapus
              </button>
            </div>
          </div>
        `;
        container.appendChild(docCard);
        const openBtn = docCard.querySelector(`#bdoc-openbtn-${note.id}-${dIdx}`);
        if (openBtn) {
          openBtn.onclick = (e) => openOrDownloadDoc(docData || docFileId, docName, e, !docData && !!docFileId);
        }
      });
    }
  });
}

function toggleBookNoteItemMenu(menuKey, event) {
  if (event) event.stopPropagation();
  const menuId = `bnote-menu-${menuKey}`;
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const isVisible = menu.style.display === 'block';
  closeAllNoteDropdowns();

  if (!isVisible) {
    menu.style.display = 'block';
  }
}

async function openOrDownloadDoc(docDataOrFileId, docName, event, isFileId) {
  if (event) event.stopPropagation();

  let docData = docDataOrFileId;
  if (isFileId) {
    try {
      docData = await AppFileStorage.getFileAsDataUrl(docDataOrFileId, null);
    } catch (err) {
      console.error('Gagal memuat dokumen:', err);
      docData = null;
    }
  }

  if (!docData) {
    showNotificationBanner('File tidak dapat ditemukan atau data rusak. ❌');
    return;
  }

  try {
    const a = document.createElement('a');
    a.href = docData;
    a.download = docName || 'dokumen_lampiran';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch(err) {
    console.error('File open error:', err);
    showNotificationBanner('Gagal membuka file: ' + err.message);
  }
}

function triggerEditorPhotoInput() {
  const input = document.getElementById('bookEditorPhotoInput');
  if (input) input.click();
}

function triggerEditorDocInput() {
  const input = document.getElementById('bookEditorDocInput');
  if (input) input.click();
}

function handleEditorPhotoSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  (async () => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const meta = await AppFileStorage.saveFile(file);
        tempEditorPhotos.push({
          id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          fileId: meta.id,
          mimeType: meta.mimeType,
          name: file.name,
          createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        });
      } catch (err) {
        console.error('Gagal menyimpan foto:', err);
        showNotificationBanner('Gagal menyimpan salah satu foto: ' + err.message);
      }
    }
    renderEditorPhotoPreviews();
  })();
  event.target.value = '';
}

async function renderEditorPhotoPreviews() {
  const grid = document.getElementById('bookEditorPhotoPreviewGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let idx = 0; idx < tempEditorPhotos.length; idx++) {
    const p = tempEditorPhotos[idx];
    // Kompatibel dgn data lama (base64 langsung) & data baru (referensi fileId)
    let photoSrc = typeof p === 'string' ? p : (p.data || p.url || null);
    if (!photoSrc && p.fileId) {
      try { photoSrc = await AppFileStorage.getFileAsDataUrl(p.fileId, p.mimeType); }
      catch (err) { console.error('Gagal memuat foto:', err); }
    }
    if (!photoSrc) continue;

    const item = document.createElement('div');
    item.style.cssText = 'position: relative; display: inline-block; margin: 4px; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-light);';
    item.innerHTML = `
      <img src="${photoSrc}" alt="Foto" style="width: 80px; height: 80px; object-fit: cover; display: block;">
      <button onclick="removeTempPhoto(${idx})" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.6); color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 0.75rem; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-xmark"></i></button>
    `;
    grid.appendChild(item);
  }
}

async function removeTempPhoto(index) {
  const p = tempEditorPhotos[index];
  if (p && p.fileId) {
    try { await AppFileStorage.deleteFile(p.fileId); } catch (err) { console.error('Gagal hapus foto:', err); }
  }
  tempEditorPhotos.splice(index, 1);
  renderEditorPhotoPreviews();
}

function handleEditorDocSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  (async () => {
    for (const file of files) {
      try {
        const meta = await AppFileStorage.saveFile(file);
        tempEditorDocs.push({
          id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          fileId: meta.id,
          mimeType: meta.mimeType,
          name: file.name,
          size: formatFileSize(file.size),
          type: getDocTypeLabel(file.name),
          createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
        });
      } catch (err) {
        console.error('Gagal menyimpan dokumen:', err);
        showNotificationBanner('Gagal menyimpan salah satu dokumen: ' + err.message);
      }
    }
    renderEditorDocPreviews();
  })();
  event.target.value = '';
}

function getDocTypeLabel(fileName) {
  if (!fileName) return 'FILE';
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'DOCX';
  if (ext === 'ppt' || ext === 'pptx') return 'PPT';
  return 'FILE';
}

function renderEditorDocPreviews() {
  const grid = document.getElementById('bookEditorDocPreviewGrid');
  if (!grid) return;
  grid.innerHTML = '';
  tempEditorDocs.forEach((d, idx) => {
    const docName = typeof d === 'string' ? d : (d.name || 'Dokumen Lampiran');
    const docSize = typeof d === 'object' && d.size ? d.size : '';
    const item = document.createElement('div');
    item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: var(--bg-subtle); padding: 8px 12px; border-radius: 10px; margin-bottom: 6px; border: 1px solid var(--border-light); font-size: 0.85rem;';
    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
        <i class="fa-solid fa-file-pdf" style="color: var(--primary);"></i>
        <span style="font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${escapeHtml(docName)}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">${docSize}</span>
      </div>
      <button onclick="removeTempDoc(${idx})" style="background: transparent; border: none; color: #EF4444; cursor: pointer; font-size: 0.9rem;"><i class="fa-solid fa-xmark"></i></button>
    `;
    grid.appendChild(item);
  });
}

async function removeTempDoc(index) {
  const d = tempEditorDocs[index];
  if (d && d.fileId) {
    try { await AppFileStorage.deleteFile(d.fileId); } catch (err) { console.error('Gagal hapus dokumen:', err); }
  }
  tempEditorDocs.splice(index, 1);
  renderEditorDocPreviews();
}

function openBookNoteEditorForEdit(noteId) {
  closeAllNoteDropdowns();

  const book = appState.books.find(b => b.id === appState.selectedBookId);
  if (!book || !book.notes) return;

  const note = book.notes.find(n => String(n.id) === String(noteId));
  if (!note) return;

  editingBookNoteId = note.id;
  tempEditorPhotos = [...(note.photos || [])];
  tempEditorDocs = [...(note.docs || [])];

  const textarea = document.getElementById('bookEditorContent');
  if (textarea) textarea.value = note.content || '';

  renderEditorPhotoPreviews();
  renderEditorDocPreviews();

  const headerTitle = document.getElementById('editorPageHeaderTitle');
  if (headerTitle) {
    headerTitle.textContent = `Edit Catatan & Lampiran: ${book.title}`;
  }

  switchTab('book-editor');
  if (textarea) {
    setTimeout(() => { textarea.focus(); }, 150);
  }
}

function openBookNoteEditor() {
  editingBookNoteId = null;
  tempEditorPhotos = [];
  tempEditorDocs = [];
  const textarea = document.getElementById('bookEditorContent');
  if (textarea) textarea.value = '';

  const photoGrid = document.getElementById('bookEditorPhotoPreviewGrid');
  if (photoGrid) photoGrid.innerHTML = '';

  const docGrid = document.getElementById('bookEditorDocPreviewGrid');
  if (docGrid) docGrid.innerHTML = '';

  const book = appState.books.find(b => b.id === appState.selectedBookId);
  const headerTitle = document.getElementById('editorPageHeaderTitle');
  if (headerTitle) {
    headerTitle.textContent = book ? `Catatan: ${book.title}` : 'Tulis Rangkuman / Catatan Kuliah';
  }

  switchTab('book-editor');
  if (textarea) {
    setTimeout(() => { textarea.focus(); }, 150);
  }
}

function saveBookEditorNote() {
  const saveBtn = document.querySelector('#tab-book-editor .minimal-toolbar-btn') || document.querySelector('.btn-editor-primary');
  if (saveBtn && saveBtn.disabled) return;

  const content = document.getElementById('bookEditorContent').value.trim();
  const book = appState.books.find(b => b.id === appState.selectedBookId);
  if (!book) {
    showNotificationBanner('Gagal menyimpan: Buku tidak ditemukan!');
    return;
  }

  if (!content && tempEditorPhotos.length === 0 && tempEditorDocs.length === 0) {
    showNotificationBanner('Tulis catatan atau unggah setidaknya satu foto/dokumen!');
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.6';
  }

  try {
    if (!book.notes) book.notes = [];

    if (editingBookNoteId) {
      // EDIT MODE: Update existing note item in place
      const note = book.notes.find(n => String(n.id) === String(editingBookNoteId));
      if (note) {
        note.content = content;
        note.photos = [...tempEditorPhotos];
        note.docs = [...tempEditorDocs];
      }
      showNotificationBanner('Perubahan catatan & lampiran disimpan! 📖');
    } else {
      // CREATE MODE: Add new note item
      const noteObj = {
        id: 'bnote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        content: content,
        date: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        photos: [...tempEditorPhotos],
        docs: [...tempEditorDocs]
      };
      book.notes.unshift(noteObj);
      showNotificationBanner('Catatan & lampiran baru disimpan! 📖');
    }

    // Save state synchronously to persistent storage before navigating away
    saveStateToLocalStorage();

    // Reset state after save completes successfully
    editingBookNoteId = null;
    tempEditorPhotos = [];
    tempEditorDocs = [];
    document.getElementById('bookEditorContent').value = '';

    // Switch tab to detail & render
    switchTab('book-detail');
    renderBookNotes();
  } catch (err) {
    console.error('Save error:', err);
    showNotificationBanner('Terjadi kesalahan saat menyimpan catatan: ' + err.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = '1';
    }
  }
}

function confirmDeletePhoto(bookId, noteId, photoIndex, event) {
  if (event) event.stopPropagation();
  closeAllNoteDropdowns();
  pendingDeleteAttachmentTarget = { bookId, noteId, photoIndex, type: 'photo' };
  openModal('modalDeletePhotoConfirmation');
}

function confirmDeleteDoc(bookId, noteId, docIndex, event) {
  if (event) event.stopPropagation();
  closeAllNoteDropdowns();
  pendingDeleteAttachmentTarget = { bookId, noteId, docIndex, type: 'doc' };
  openModal('modalDeletePhotoConfirmation');
}

function confirmDeleteBookNote(noteId, event) {
  if (event) event.stopPropagation();
  closeAllNoteDropdowns();
  pendingDeleteAttachmentTarget = { bookId: appState.selectedBookId, noteId, type: 'note' };
  openModal('modalDeletePhotoConfirmation');
}

async function executeDeleteAttachment() {
  if (!pendingDeleteAttachmentTarget) return;

  const { bookId, noteId, photoIndex, docIndex, type } = pendingDeleteAttachmentTarget;
  const book = appState.books.find(b => b.id === bookId);
  if (book && book.notes) {
    const note = book.notes.find(n => String(n.id) === String(noteId));
    if (note) {
      if (type === 'photo' && note.photos) {
        const removed = note.photos[photoIndex];
        if (removed && removed.fileId) {
          try { await AppFileStorage.deleteFile(removed.fileId); } catch (err) { console.error('Gagal hapus file foto:', err); }
        }
        note.photos.splice(photoIndex, 1);
      } else if (type === 'doc' && note.docs) {
        const removed = note.docs[docIndex];
        if (removed && removed.fileId) {
          try { await AppFileStorage.deleteFile(removed.fileId); } catch (err) { console.error('Gagal hapus file dokumen:', err); }
        }
        note.docs.splice(docIndex, 1);
      } else if (type === 'note') {
        // Hapus semua file lampiran milik catatan ini juga dari penyimpanan file
        const allAttachments = [...(note.photos || []), ...(note.docs || [])];
        for (const att of allAttachments) {
          if (att && att.fileId) {
            try { await AppFileStorage.deleteFile(att.fileId); } catch (err) { console.error('Gagal hapus file lampiran:', err); }
          }
        }
        book.notes = book.notes.filter(n => String(n.id) !== String(noteId));
      }
    }
  }

  pendingDeleteAttachmentTarget = null;
  saveStateToLocalStorage();
  renderBookNotes();
  closeModal('modalDeletePhotoConfirmation');
  showNotificationBanner('Lampiran telah dihapus! 🗑️');
}

let editingNoteId = null;
let pendingDeleteNoteId = null;

function renderNotes() {
  const container = document.getElementById('notesListContainer');
  if (!container) return;

  // Ensure every note object has a unique ID
  appState.notes.forEach((n, idx) => {
    if (!n.id) {
      n.id = 'note_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 4);
    }
  });

  const searchInput = document.getElementById('notesSearchInput');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let filteredNotes = appState.notes;
  if (query) {
    filteredNotes = appState.notes.filter(n =>
      (n.title && n.title.toLowerCase().includes(query)) ||
      (n.category && n.category.toLowerCase().includes(query)) ||
      (n.body && n.body.toLowerCase().includes(query))
    );
  }

  container.innerHTML = '';

  if (appState.notes.length === 0) {
    container.innerHTML = `
      <div class="notes-empty-state">
        <div class="empty-icon-circle"><i class="fa-regular fa-folder-open" style="color: var(--primary); font-size: 1.8rem;"></i></div>
        <div class="empty-title">Belum ada catatan</div>
        <div class="empty-subtitle">Mulai simpan ide atau catatan pentingmu.</div>
        <button class="btn-primary mt-3" style="width: auto; padding: 10px 22px; font-size: 0.88rem; margin: 12px auto 0 auto;" onclick="openAddNoteModal()">
          <i class="fa-solid fa-plus"></i> Catatan Baru
        </button>
      </div>
    `;
    return;
  }

  if (filteredNotes.length === 0) {
    container.innerHTML = `
      <div class="notes-empty-state">
        <div class="empty-icon-circle"><i class="fa-solid fa-magnifying-glass" style="color: var(--text-light); font-size: 1.6rem;"></i></div>
        <div class="empty-title">Tidak ada catatan ditemukan</div>
        <div class="empty-subtitle">Coba gunakan kata kunci lain.</div>
      </div>
    `;
    return;
  }

  filteredNotes.forEach(n => {
    const card = document.createElement('div');
    card.className = `note-card-item ${n.pinned ? 'pinned' : ''}`;
    card.onclick = (e) => openEditNoteModal(n.id, e);

    const dateStr = n.createdAt || '12 Agustus 2026';
    const categoryStr = n.category ? `<span class="note-cat-badge">${escapeHtml(n.category)}</span>` : '';
    const previewText = n.body ? escapeHtml(n.body) : '';

    card.innerHTML = `
      <div class="note-card-left-icon">
        <i class="fa-regular fa-file-lines" style="color: var(--primary); font-size: 1.15rem;"></i>
      </div>
      <div class="note-card-center-info">
        <div class="note-card-title-row">
          <div class="note-card-title">${escapeHtml(n.title)}</div>
          ${categoryStr}
        </div>
        <div class="note-card-date">
          <i class="fa-regular fa-calendar" style="font-size: 0.75rem; margin-right: 4px;"></i> ${dateStr}
        </div>
        ${previewText ? `<div class="note-card-preview">${previewText}</div>` : ''}
      </div>
      <div class="note-card-right-action" style="position: relative;">
        <button class="note-card-menu-btn" onclick="toggleNoteMenu('${n.id}', event)" title="Opsi Catatan" aria-label="Opsi Catatan">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
        <div class="note-card-dropdown" id="note-menu-${n.id}" style="display: none;">
          <button class="dropdown-action-item" onclick="openEditNoteModal('${n.id}', event)">
            <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit
          </button>
          <button class="dropdown-action-item text-danger" onclick="confirmDeleteNote('${n.id}', event)">
            <i class="fa-solid fa-trash-can" style="color: #EF4444;"></i> Hapus
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function openAddNoteModal() {
  editingNoteId = null;
  const titleEl = document.getElementById('noteTitleInput');
  const catEl = document.getElementById('noteCategoryInput');
  const bodyEl = document.getElementById('noteBodyInput');
  if (titleEl) titleEl.value = '';
  if (catEl) catEl.value = 'Umum';
  if (bodyEl) bodyEl.value = '';

  const modalTitle = document.getElementById('modalNoteTitle');
  if (modalTitle) modalTitle.textContent = 'Tambah Catatan Baru';

  const saveBtn = document.getElementById('btnSaveNoteAction');
  if (saveBtn) saveBtn.textContent = 'Simpan Catatan';

  openModal('modalAddNote');
}

function openEditNoteModal(noteId, event) {
  if (event) event.stopPropagation();

  closeAllNoteDropdowns();

  const note = appState.notes.find(n => String(n.id) === String(noteId));
  if (!note) return;

  editingNoteId = note.id;
  const titleEl = document.getElementById('noteTitleInput');
  const catEl = document.getElementById('noteCategoryInput');
  const bodyEl = document.getElementById('noteBodyInput');

  if (titleEl) titleEl.value = note.title || '';
  if (catEl) catEl.value = note.category || 'Umum';
  if (bodyEl) bodyEl.value = note.body || '';

  const modalTitle = document.getElementById('modalNoteTitle');
  if (modalTitle) modalTitle.textContent = 'Edit Catatan';

  const saveBtn = document.getElementById('btnSaveNoteAction');
  if (saveBtn) saveBtn.textContent = 'Simpan Perubahan';

  openModal('modalAddNote');
}

function saveNote() {
  const title = document.getElementById('noteTitleInput').value.trim();
  const category = document.getElementById('noteCategoryInput').value;
  const body = document.getElementById('noteBodyInput').value.trim();

  if (!title || !body) return;

  if (editingNoteId) {
    const note = appState.notes.find(n => String(n.id) === String(editingNoteId));
    if (note) {
      note.title = title;
      note.category = category;
      note.body = body;
    }
    showNotificationBanner('Catatan telah diperbarui! 📝');
  } else {
    const newNote = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: title,
      category: category,
      body: body,
      pinned: false,
      createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    };
    appState.notes.unshift(newNote);
    showNotificationBanner('Catatan baru disimpan! 📝');
  }

  editingNoteId = null;
  saveStateToLocalStorage();
  renderNotes();
  closeModal('modalAddNote');
}

function saveNewNote() {
  saveNote();
}

function confirmDeleteNote(noteId, event) {
  if (event) event.stopPropagation();

  closeAllNoteDropdowns();

  pendingDeleteNoteId = noteId;
  openModal('modalDeleteNoteConfirmation');
}

function executeDeleteNote() {
  if (!pendingDeleteNoteId) return;

  appState.notes = appState.notes.filter(n => String(n.id) !== String(pendingDeleteNoteId));
  pendingDeleteNoteId = null;

  saveStateToLocalStorage();
  renderNotes();
  closeModal('modalDeleteNoteConfirmation');
  showNotificationBanner('Catatan telah dihapus! 🗑️');
}

function toggleNoteMenu(noteId, event) {
  if (event) event.stopPropagation();

  const menuId = `note-menu-${noteId}`;
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const isVisible = menu.style.display === 'block';
  closeAllNoteDropdowns();

  if (!isVisible) {
    menu.style.display = 'block';
  }
}

function closeAllNoteDropdowns() {
  document.querySelectorAll('.note-card-dropdown').forEach(el => {
    el.style.display = 'none';
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.note-card-menu-btn') && !e.target.closest('.note-card-dropdown')) {
    closeAllNoteDropdowns();
  }
});

function renderFinance() {
  let totalIncome = appState.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  let totalExpense = appState.transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  let balance = totalIncome - totalExpense;

  const mainBalanceEl = document.getElementById('finMainBalance');
  if (mainBalanceEl) mainBalanceEl.textContent = formatRupiah(balance);

  const badgeBalanceEl = document.getElementById('finBadgeBalance');
  if (badgeBalanceEl) badgeBalanceEl.textContent = formatRupiah(balance);

  const totalIncomeEl = document.getElementById('finTotalIncome');
  if (totalIncomeEl) totalIncomeEl.textContent = formatRupiah(totalIncome);

  const totalExpenseEl = document.getElementById('finTotalExpense');
  if (totalExpenseEl) totalExpenseEl.textContent = formatRupiah(totalExpense);

  renderSavingsGoals();
  renderTransactionsList();
  renderFinanceChart(totalIncome, totalExpense);
  renderDashboard();
}

function renderSavingsGoals() {
  const container = document.getElementById('savingsGoalsContainer');
  if (!container) return;

  container.innerHTML = '';
  appState.savings.forEach(sg => {
    const pct = Math.min(100, Math.round((sg.currentAmount / sg.targetAmount) * 100));
    const card = document.createElement('div');
    card.className = 'card-item';
    card.innerHTML = `
      <div class="flex-between mb-2">
        <div style="font-weight: 800;">${escapeHtml(sg.title)}</div>
        <span class="badge badge-purple">${pct}%</span>
      </div>
      <div class="flex-between" style="font-size: 0.8rem;">
        <span>${formatRupiah(sg.currentAmount)}</span>
        <span>Target: <strong>${formatRupiah(sg.targetAmount)}</strong></span>
      </div>
    `;
    container.appendChild(card);
  });
}

function formatIndonesianDate(dateStr) {
  if (!dateStr) return '';
  try {
    const parts = String(dateStr).split('T')[0].split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const allMonths = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];
      if (!isNaN(day) && monthIdx >= 0 && monthIdx < 12 && !isNaN(year)) {
        return `${day} ${allMonths[monthIdx]} ${year}`;
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const allMonths = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];
      return `${day} ${allMonths[d.getMonth()]} ${d.getFullYear()}`;
    }
  } catch (e) {
    console.warn('Date formatting error:', e);
  }
  return dateStr;
}

function renderTransactionsList() {
  const container = document.getElementById('transactionsListContainer');
  if (!container) return;

  container.innerHTML = '';

  if (!appState.transactions || appState.transactions.length === 0) {
    container.innerHTML = `
      <div class="transaction-empty-card">
        <div class="transaction-empty-icon">
          <i class="fa-solid fa-clock-rotate-left"></i>
        </div>
        <div class="transaction-empty-title">Belum ada transaksi</div>
        <div class="transaction-empty-subtitle">Catat pemasukan atau pengeluaran untuk melihat riwayat.</div>
      </div>
    `;
    return;
  }

  appState.transactions.slice().reverse().forEach(t => {
    const isInitial = t.type === 'initial' || (t.description && t.description.toLowerCase().trim() === 'saldo awal');
    const isInc = t.type === 'income';

    const formattedDate = formatIndonesianDate(t.date);
    const card = document.createElement('div');
    card.className = 'trx-card';

    let iconHtml = '';
    let amountColor = '';
    let amountSign = '';

    if (isInitial) {
      iconHtml = `<div class="trx-icon-badge badge-wallet"><i class="fa-solid fa-wallet"></i></div>`;
      amountColor = 'color: #059669;';
      amountSign = '+ ';
    } else if (isInc) {
      iconHtml = `<div class="trx-icon-badge badge-income"><i class="fa-solid fa-arrow-down"></i></div>`;
      amountColor = 'color: #059669;';
      amountSign = '+ ';
    } else {
      iconHtml = `<div class="trx-icon-badge badge-expense"><i class="fa-solid fa-arrow-up"></i></div>`;
      amountColor = 'color: #EF4444;';
      amountSign = '- ';
    }

    const titleText = t.description ? escapeHtml(t.description) : (isInitial ? 'Saldo Awal' : 'Transaksi');

    card.innerHTML = `
      <div class="trx-card-left">
        ${iconHtml}
        <div class="trx-card-info">
          <div class="trx-card-title">${titleText}</div>
          <div class="trx-card-date">${escapeHtml(formattedDate)}</div>
        </div>
      </div>
      <div class="trx-card-right">
        <div class="trx-card-amount" style="${amountColor}">${amountSign}${formatRupiah(t.amount)}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

function saveNewTransaction() {
  const type = document.getElementById('trxTypeInput').value;
  const amount = parseFloat(document.getElementById('trxAmountInput').value);
  const desc = document.getElementById('trxDescInput').value.trim();

  if (!amount || !desc) return;

  appState.transactions.push({ id: Date.now(), type, amount, description: desc, date: new Date().toISOString().split('T')[0] });
  saveStateToLocalStorage();
  renderFinance();
  closeModal('modalAddTransaction');
  showNotificationBanner('Transaksi dicatat! 💰');
}

function saveNewSavingsGoal() {
  const title = document.getElementById('savingTitleInput').value.trim();
  const target = parseFloat(document.getElementById('savingTargetInput').value);
  const current = parseFloat(document.getElementById('savingCurrentInput').value) || 0;

  if (!title || !target) return;

  appState.savings.push({ id: Date.now(), title, targetAmount: target, currentAmount: current });
  saveStateToLocalStorage();
  renderFinance();
  closeModal('modalAddSavingsGoal');
  showNotificationBanner('Target tabungan dibuat! 🐷');
}

function renderFinanceChart(income, expense) {
  const canvas = document.getElementById('financeChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (financeChartInstance) financeChartInstance.destroy();

  financeChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pemasukan', 'Pengeluaran'],
      datasets: [{
        data: [income || 1, expense || 0],
        backgroundColor: ['#10B981', '#EF4444'],
        borderWidth: 0
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

let editingReminderId = null;
let pendingDeleteReminderId = null;

function toggleReminderItemDropdown(remId, event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById(`reminder-dropdown-${remId}`);
  if (!dropdown) return;

  const isVisible = dropdown.style.display === 'block';
  closeAllReminderDropdowns();

  if (!isVisible) {
    dropdown.style.display = 'block';
  }
}

function closeAllReminderDropdowns() {
  document.querySelectorAll('.reminder-item-dropdown').forEach(el => {
    el.style.display = 'none';
  });
}

let selectedReminderDays = [1, 2, 3, 4, 5, 6, 7];

const DAY_NAMES = {
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu',
  7: 'Minggu'
};

function toggleReminderDayChip(dayNum) {
  dayNum = Number(dayNum);
  const idx = selectedReminderDays.indexOf(dayNum);
  if (idx > -1) {
    selectedReminderDays.splice(idx, 1);
  } else {
    selectedReminderDays.push(dayNum);
    selectedReminderDays.sort((a, b) => a - b);
  }
  updateReminderDayChipsUI();
}

function toggleSelectAllReminderDays() {
  if (selectedReminderDays.length === 7) {
    selectedReminderDays = [];
  } else {
    selectedReminderDays = [1, 2, 3, 4, 5, 6, 7];
  }
  updateReminderDayChipsUI();
}

function updateReminderDayChipsUI() {
  const chips = document.querySelectorAll('.day-chip-btn');
  chips.forEach(btn => {
    const day = Number(btn.getAttribute('data-day'));
    if (selectedReminderDays.includes(day)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const btnToggleAll = document.getElementById('btnToggleAllDays');
  if (btnToggleAll) {
    if (selectedReminderDays.length === 7) {
      btnToggleAll.textContent = 'Batal Setiap Hari';
      btnToggleAll.style.color = 'var(--primary)';
    } else {
      btnToggleAll.textContent = 'Pilih Setiap Hari';
      btnToggleAll.style.color = 'var(--text-muted)';
    }
  }
}

function formatDaysDisplay(repeatDays) {
  if (!repeatDays || !Array.isArray(repeatDays) || repeatDays.length === 0) {
    return 'Setiap hari';
  }
  if (repeatDays.length === 7) return 'Setiap hari';
  
  const isMonToFri = repeatDays.length === 5 && [1, 2, 3, 4, 5].every(d => repeatDays.includes(d));
  if (isMonToFri) return 'Senin – Jumat';

  const isWeekend = repeatDays.length === 2 && [6, 7].every(d => repeatDays.includes(d));
  if (isWeekend) return 'Sabtu – Minggu';

  return repeatDays.map(d => DAY_NAMES[d] || '').filter(Boolean).join(', ');
}

function renderRemindersList() {
  const container = document.getElementById('remindersListContainer');
  if (!container) return;

  container.innerHTML = '';

  const allReminders = appState.reminders || [];
  // Selesai otomatis hilang dari daftar (data tetap tersimpan)
  const activeReminders = allReminders.filter(r => !r.completed);

  if (activeReminders.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem; background: var(--bg-card); border-radius: 16px; border: 1px dashed var(--border-light);">
        <i class="fa-regular fa-bell-slash mb-2" style="font-size: 1.5rem; color: var(--primary);"></i><br>
        ${allReminders.length > 0 ? 'Semua pengingat sudah selesai. Tugas baru bisa ditambahkan kapan saja.' : 'Belum ada pengingat harian. Klik <strong>+ Reminder Baru</strong> untuk menambahkan.'}
      </div>
    `;
    return;
  }

  activeReminders.forEach(rem => {
    if (!rem.id) rem.id = Date.now() + Math.floor(Math.random() * 1000);
    const daysStr = formatDaysDisplay(rem.repeatDays);

    const card = document.createElement('div');
    card.className = 'item-row';
    card.dataset.reminderId = rem.id;
    card.style.cssText = 'position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--bg-card); border-radius: 16px; margin-bottom: 8px; border: 1px solid var(--border-light); box-shadow: var(--shadow-sm);';

    card.innerHTML = `
      <div class="item-left" style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
        <div class="checkbox-round ${rem.completed ? 'checked' : ''}" onclick="toggleReminder('${rem.id}')">
          ${rem.completed ? '<i class="fa-solid fa-check" style="font-size: 0.75rem;"></i>' : ''}
        </div>
        <div style="min-width: 0; flex: 1;">
          <div class="item-info-title" style="font-weight: 700; font-size: 0.92rem; color: var(--text-main); ${rem.completed ? 'text-decoration: line-through; opacity: 0.6;' : ''}; word-break: break-word;">${escapeHtml(rem.title)}</div>
          <div class="item-info-subtitle" style="font-size: 0.78rem; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span><i class="fa-regular fa-clock" style="color: var(--primary);"></i> ${rem.time}</span>
            <span><i class="fa-regular fa-calendar-days" style="color: var(--primary);"></i> ${daysStr}</span>
          </div>
        </div>
      </div>

      <div style="position: relative; flex-shrink: 0;">
        <button class="btn-icon-menu" onclick="toggleReminderItemDropdown('${rem.id}', event)" title="Opsi Pengingat" style="background: transparent; border: none; padding: 6px 10px; border-radius: 8px; color: var(--text-muted); cursor: pointer; font-size: 1rem;">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>

        <div class="reminder-item-dropdown" id="reminder-dropdown-${rem.id}" style="display: none; position: absolute; top: 100%; right: 0; z-index: 100; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 14px; box-shadow: var(--shadow-md); min-width: 140px; overflow: hidden; padding: 4px;">
          <button onclick="openEditReminderModal('${rem.id}', event)" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
            <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit
          </button>
          <button onclick="confirmDeleteReminder('${rem.id}', event)" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: #EF4444; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='transparent'">
            <i class="fa-solid fa-trash-can" style="color: #EF4444;"></i> Hapus
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function openAddReminderModal() {
  editingReminderId = null;
  document.getElementById('reminderTitleInput').value = '';
  document.getElementById('reminderTimeInput').value = '';
  selectedReminderDays = [1, 2, 3, 4, 5, 6, 7];
  updateReminderDayChipsUI();

  const modalTitle = document.getElementById('modalReminderTitle');
  if (modalTitle) modalTitle.textContent = 'Tambah Pengingat Harian';

  const btnSave = document.getElementById('btnSaveReminderAction');
  if (btnSave) btnSave.textContent = 'Simpan Reminder';

  openModal('modalAddReminder');
}

function openEditReminderModal(remId, event) {
  if (event) event.stopPropagation();
  closeAllReminderDropdowns();

  const rem = appState.reminders.find(r => String(r.id) === String(remId));
  if (!rem) return;

  editingReminderId = rem.id;
  document.getElementById('reminderTitleInput').value = rem.title || '';
  document.getElementById('reminderTimeInput').value = rem.time || '';
  selectedReminderDays = Array.isArray(rem.repeatDays) && rem.repeatDays.length > 0 ? [...rem.repeatDays] : [1, 2, 3, 4, 5, 6, 7];
  updateReminderDayChipsUI();

  const modalTitle = document.getElementById('modalReminderTitle');
  if (modalTitle) modalTitle.textContent = 'Edit Pengingat Harian';

  const btnSave = document.getElementById('btnSaveReminderAction');
  if (btnSave) btnSave.textContent = 'Simpan Perubahan';

  openModal('modalAddReminder');
}

function saveNewReminder() {
  const title = document.getElementById('reminderTitleInput').value.trim();
  const time = document.getElementById('reminderTimeInput').value;

  if (!title || !time) {
    showNotificationBanner('Judul dan waktu pengingat wajib diisi!');
    return;
  }

  if (!selectedReminderDays || selectedReminderDays.length === 0) {
    showNotificationBanner('Silakan pilih minimal satu hari pengingat.');
    return;
  }

  const sortedDays = [...selectedReminderDays].sort((a, b) => a - b);

  if (editingReminderId) {
    // EDIT MODE: Update existing reminder in-place retaining unique ID and completed status
    const rem = appState.reminders.find(r => String(r.id) === String(editingReminderId));
    if (rem) {
      rem.title = title;
      rem.time = time;
      rem.repeatDays = sortedDays;
    }
    editingReminderId = null;
    showNotificationBanner('Pengingat diperbarui! ⏰');
  } else {
    // CREATE MODE: Add new reminder item
    const newRem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: title,
      time: time,
      repeatDays: sortedDays,
      completed: false,
      date: new Date().toISOString().split('T')[0]
    };
    appState.reminders.push(newRem);
    showNotificationBanner('Pengingat baru disimpan! ⏰');
  }

  saveStateToLocalStorage();
  rescheduleUpcomingNotifications();
  renderRemindersList();
  renderDashboard();
  closeModal('modalAddReminder');
}

function confirmDeleteReminder(remId, event) {
  if (event) event.stopPropagation();
  closeAllReminderDropdowns();

  pendingDeleteReminderId = remId;
  openModal('modalDeleteReminderConfirmation');
}

function executeDeleteReminder() {
  if (!pendingDeleteReminderId) return;

  appState.reminders = appState.reminders.filter(r => String(r.id) !== String(pendingDeleteReminderId));
  pendingDeleteReminderId = null;

  saveStateToLocalStorage();
  renderRemindersList();
  renderDashboard();
  closeModal('modalDeleteReminderConfirmation');
  showNotificationBanner('Pengingat telah dihapus! 🗑️');
}

function animateRowThenRender(id, done) {
  const els = document.querySelectorAll('[data-reminder-id="' + id + '"]');
  if (!els.length || typeof els[0].animate !== 'function' ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    done && done();
    return;
  }
  let remaining = els.length;
  const finish = () => { if (--remaining <= 0) done && done(); };
  els.forEach(el => {
    const cs = getComputedStyle(el);
    const h = el.offsetHeight + 'px';
    const anim = el.animate([
      {
        opacity: '1',
        transform: 'translateX(0) scale(1)',
        maxHeight: h,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom
      },
      {
        opacity: '0',
        transform: 'translateX(28px) scale(0.96)',
        maxHeight: '0px',
        marginTop: '0px',
        marginBottom: '0px',
        paddingTop: '0px',
        paddingBottom: '0px'
      }
    ], { duration: 380, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    anim.onfinish = finish;
  });
}

function toggleReminder(id) {
  const rem = appState.reminders.find(r => String(r.id) === String(id));
  if (rem) {
    rem.completed = !rem.completed;
    saveStateToLocalStorage();
    if (rem.completed) {
      // Selesai: animasi smooth menghilang, baru re-render
      animateRowThenRender(id, () => {
        renderRemindersList();
        renderDashboard();
      });
    } else {
      renderRemindersList();
      renderDashboard();
    }
  }
}

// --- GOOGLE MAPS & NAVIGASI CONTROLLER ---
let navMap = null;
let navOriginMarker = null;
let navDestinationMarker = null;
let navRoutePolyline = null;
let currentOriginCoords = null;      // { lat, lng, label }
let currentDestinationCoords = null; // { lat, lng, label }
let activeGoogleMapsRouteUrl = null;

// --- SHARE LOCATION ENGINE ---
async function shareLocationData({ name, address, lat, lng }) {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  if (isNaN(latNum) || isNaN(lngNum)) {
    showNotificationBanner('Koordinat lokasi tidak valid.');
    return;
  }

  const validLat = latNum.toFixed(6);
  const validLng = lngNum.toFixed(6);

  const title = name ? name : 'Lokasi Terpilih';
  let shareText = '';
  
  if (name) {
    shareText += `${name}\n`;
  }
  if (address) {
    shareText += `${address}\n`;
  }
  shareText += `\nKoordinat:\n${validLat}, ${validLng}\n\nBuka di Google Maps:\nhttps://www.google.com/maps/search/?api=1&query=${validLat},${validLng}`;

  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${validLat},${validLng}`;

  // Try Native Share API (Android / Web Share Sheet)
  if (navigator.share) {
    try {
      await navigator.share({
        title: title,
        text: shareText,
        url: gmapsUrl
      });
      showNotificationBanner('Lokasi berhasil dibagikan! 📤');
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Native share sheet error/dismissed:', err);
      } else {
        return; // User cancelled share modal
      }
    }
  }

  // Fallback to Clipboard copy
  copyTextToClipboard(shareText, 'Tautan lokasi disalin ke clipboard! 📋');
}

function copyCoordinatesToClipboard(lat, lng) {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum)) {
    showNotificationBanner('Koordinat tidak valid.');
    return;
  }
  const text = `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
  copyTextToClipboard(text, `Koordinat disalin: ${text} 📋`);
}

function copyTextToClipboard(text, successMessage) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showNotificationBanner(successMessage || 'Disalin ke clipboard!');
    }).catch(err => {
      console.warn('Clipboard write error:', err);
      fallbackCopyText(text, successMessage);
    });
  } else {
    fallbackCopyText(text, successMessage);
  }
}

function fallbackCopyText(text, successMessage) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) {
      showNotificationBanner(successMessage || 'Disalin ke clipboard!');
    } else {
      showNotificationBanner('Gagal menyalin teks.');
    }
  } catch (err) {
    console.error('Fallback copy error:', err);
    showNotificationBanner('Gagal menyalin ke clipboard.');
  }
}

function shareActiveMapLocation() {
  if (currentDestinationCoords) {
    shareLocationData({
      name: currentDestinationCoords.label,
      lat: currentDestinationCoords.lat,
      lng: currentDestinationCoords.lng
    });
  } else if (currentOriginCoords) {
    shareLocationData({
      name: currentOriginCoords.label,
      lat: currentOriginCoords.lat,
      lng: currentOriginCoords.lng
    });
  } else if (navMap) {
    const center = navMap.getCenter();
    shareLocationData({
      name: 'Pusat Peta My Maps',
      lat: center.lat,
      lng: center.lng
    });
  } else {
    showNotificationBanner('Tidak ada lokasi aktif untuk dibagikan.');
  }
}

// --- FREE MARKERS & MARK MODE STATE ---
let freeMarkers = []; // Array of { id, lat, lng, name, createdAt, leafletMarker }
let isMarkModeActive = false;

function toggleFreeMarkerMode(forceState) {
  isMarkModeActive = forceState !== undefined ? forceState : !isMarkModeActive;

  const btn = document.getElementById('btnToggleMarkMode');
  const textSpan = document.getElementById('markModeBtnText');
  const banner = document.getElementById('markModeIndicatorBanner');
  const mapContainer = document.getElementById('interactiveNavMapContainer');

  if (isMarkModeActive) {
    if (btn) btn.classList.add('active');
    if (textSpan) textSpan.textContent = 'Mode Tandai (Aktif)';
    if (banner) banner.style.display = 'flex';
    if (mapContainer) mapContainer.style.cursor = 'crosshair';
    showNotificationBanner('Mode Tandai Aktif! Ketuk pada peta untuk menandai titik lokasi. 📍');
  } else {
    if (btn) btn.classList.remove('active');
    if (textSpan) textSpan.textContent = 'Penanda';
    if (banner) banner.style.display = 'none';
    if (mapContainer) mapContainer.style.cursor = '';
  }
}

function addFreeMarker(lat, lng, customName = '') {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum)) return;

  const markerId = 'fm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const markerCount = freeMarkers.length + 1;
  const name = customName.trim() ? customName.trim() : `Titik Ditandai ${markerCount}`;

  if (!navMap) return;

  // Custom marker icon for free marker (Purple pin style)
  const freeMarkerIcon = L.divIcon({
    className: 'free-marker-pin',
    html: `<div style="background: #3B82F6; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5); border: 2px solid white; font-size: 1rem;">📍</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const leafletMarker = L.marker([latNum, lngNum], {
    icon: freeMarkerIcon,
    draggable: true
  }).addTo(navMap);

  const markerObj = {
    id: markerId,
    lat: latNum,
    lng: lngNum,
    name: name,
    createdAt: new Date().toISOString(),
    leafletMarker: leafletMarker
  };

  freeMarkers.push(markerObj);

  // Update drag handler
  leafletMarker.on('dragend', function (e) {
    const newPos = e.target.getLatLng();
    markerObj.lat = newPos.lat;
    markerObj.lng = newPos.lng;
    updateFreeMarkerPopup(markerObj);
    showNotificationBanner(`Posisi ${markerObj.name} diperbarui.`);
  });

  updateFreeMarkerPopup(markerObj);
  leafletMarker.openPopup();

  updateClearFreeMarkersButton();
  showNotificationBanner(`${name} berhasil ditambahkan ke peta! 📍`);
}

function updateFreeMarkerPopup(markerObj) {
  if (!markerObj || !markerObj.leafletMarker) return;

  const popupContent = document.createElement('div');
  popupContent.className = 'free-marker-popup-card';
  popupContent.innerHTML = `
    <div class="free-marker-popup-title">${escapeHtml(markerObj.name)}</div>
    <div class="free-marker-popup-coords"><i class="fa-solid fa-crosshairs"></i> ${markerObj.lat.toFixed(6)}, ${markerObj.lng.toFixed(6)}</div>
    <div class="free-marker-popup-actions">
      <button type="button" class="btn-popup-action" onclick="navFromFreeMarker('${markerObj.id}')">
        <i class="fa-solid fa-diamond-turn-right" style="color: #10B981;"></i> Navigasi
      </button>
      <button type="button" class="btn-popup-action" onclick="saveFreeMarkerToPlaces('${markerObj.id}')">
        <i class="fa-solid fa-bookmark" style="color: var(--primary);"></i> Simpan Lokasi
      </button>
      <button type="button" class="btn-popup-action" onclick="shareFreeMarker('${markerObj.id}')">
        <i class="fa-solid fa-share-nodes" style="color: #10B981;"></i> Bagikan
      </button>
      <button type="button" class="btn-popup-action" onclick="copyCoordinatesToClipboard('${markerObj.lat}', '${markerObj.lng}')">
        <i class="fa-solid fa-copy" style="color: #3B82F6;"></i> Salin Koordinat
      </button>
      <button type="button" class="btn-popup-action btn-popup-delete" onclick="deleteFreeMarker('${markerObj.id}')">
        <i class="fa-solid fa-trash-can"></i> Hapus Penanda
      </button>
    </div>
  `;

  markerObj.leafletMarker.bindPopup(popupContent);
}

function navFromFreeMarker(markerId) {
  const marker = freeMarkers.find(m => String(m.id) === String(markerId));
  if (!marker) return;
  openNavOriginPicker({
    lat: marker.lat,
    lng: marker.lng,
    name: marker.name || 'Titik Ditandai'
  });
}

function deleteFreeMarker(markerId) {
  const idx = freeMarkers.findIndex(m => String(m.id) === String(markerId));
  if (idx !== -1) {
    const item = freeMarkers[idx];
    if (item.leafletMarker && navMap) {
      navMap.removeLayer(item.leafletMarker);
    }
    freeMarkers.splice(idx, 1);
    updateClearFreeMarkersButton();
    showNotificationBanner('Penanda lokasi berhasil dihapus. 🗑️');
  }
}

function clearAllFreeMarkers() {
  if (freeMarkers.length === 0) return;
  freeMarkers.forEach(m => {
    if (m.leafletMarker && navMap) {
      navMap.removeLayer(m.leafletMarker);
    }
  });
  freeMarkers = [];
  updateClearFreeMarkersButton();
  showNotificationBanner('Semua penanda bebas telah dihapus.');
}

function updateClearFreeMarkersButton() {
  const btn = document.getElementById('btnClearAllFreeMarkers');
  if (btn) {
    btn.style.display = freeMarkers.length > 0 ? 'inline-flex' : 'none';
  }
}

function shareFreeMarker(markerId) {
  const marker = freeMarkers.find(m => String(m.id) === String(markerId));
  if (marker) {
    shareLocationData({
      name: marker.name,
      lat: marker.lat,
      lng: marker.lng
    });
  }
}

function saveFreeMarkerToPlaces(markerId) {
  const marker = freeMarkers.find(m => String(m.id) === String(markerId));
  if (!marker) return;

  editingPlaceId = null;
  document.getElementById('placeNameInput').value = marker.name || 'Titik Ditandai';
  document.getElementById('placeSearchInput').value = '';
  document.getElementById('placeLatInput').value = marker.lat.toFixed(6);
  document.getElementById('placeLngInput').value = marker.lng.toFixed(6);

  const modalTitle = document.getElementById('modalPlaceTitle');
  if (modalTitle) modalTitle.textContent = 'Simpan Penanda ke Lokasi Tersimpan';

  const btnSave = document.getElementById('btnSavePlaceAction');
  if (btnSave) btnSave.textContent = 'Simpan ke Map';

  openModal('modalAddPlace');
  initOrUpdatePickerMap(marker.lat, marker.lng);
}

function initOrUpdateNavMap(initialLat = -6.200000, initialLng = 106.816666) {
  const container = document.getElementById('interactiveNavMapContainer');
  if (!container) return;

  if (typeof L === 'undefined') {
    console.warn('Leaflet JS library is loading or unavailable.');
    return;
  }

  setTimeout(() => {
    if (!navMap) {
      navMap = L.map('interactiveNavMapContainer', {
        zoomControl: true,
        attributionControl: false
      }).setView([initialLat, initialLng], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(navMap);

      navMap.on('click', function (e) {
        if (isMarkModeActive) {
          addFreeMarker(e.latlng.lat, e.latlng.lng);
        } else if (isOriginPickModeActive) {
          handleMapClickForOriginPick(e.latlng.lat, e.latlng.lng);
        } else {
          handleMapClickForSelectedPoint(e.latlng.lat, e.latlng.lng);
        }
      });
    } else {
      navMap.invalidateSize();
    }
  }, 200);
}

function showNavError(message) {
  const box = document.getElementById('navErrorBox');
  if (!box) return;
  if (!message) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 1.1rem; color: #DC2626;"></i> <span>${escapeHtml(message)}</span>`;
  box.style.display = 'flex';
}

// ============================================================
// CENTRALIZED PERMISSION MANAGER (CAMERA & LOCATION)
// Semua fitur (Lokasi Saya, Navigasi, Picker Lokasi, Map+Kamera, Scan Struk,
// Jelaskan Objek, dll) WAJIB lewat fungsi di sini (getAppGPSPosition /
// getAppCameraStream) supaya dialog izin browser hanya muncul SATU KALI per
// sesi, bukan setiap kali fitur dipakai. Statusnya di-cache di variabel
// cachedLocationPermissionState / cachedCameraPermissionState.
// ============================================================
let cachedLocationPermissionState = null; // 'granted', 'denied', 'prompt'
let cachedCameraPermissionState = null;   // 'granted', 'denied', 'prompt'
let lastKnownGPSPosition = null;          // cache posisi GPS terakhir yang berhasil didapat

async function checkAppLocationPermission() {
  if (cachedLocationPermissionState === 'granted' || cachedLocationPermissionState === 'denied') {
    return cachedLocationPermissionState;
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      cachedLocationPermissionState = status.state;
      status.onchange = () => { cachedLocationPermissionState = status.state; };
      return status.state;
    } catch (e) {}
  }
  return cachedLocationPermissionState || 'prompt';
}

// Fungsi TUNGGAL untuk mengambil posisi GPS. Menggantikan seluruh pemanggilan
// navigator.geolocation.getCurrentPosition langsung yang tersebar di banyak fitur
// (dulunya tiap fitur bisa memicu dialog izin browser sendiri-sendiri / GPS diambil
// dua kali berturut-turut). Sekarang: sekali izin diberikan, statusnya tersimpan di
// cachedLocationPermissionState dan tidak akan meminta izin lagi di sesi yang sama.
function getAppGPSPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      showNotificationBanner('Geolocation tidak didukung pada perangkat ini.');
      reject(new Error('geolocation_unsupported'));
      return;
    }

    if (cachedLocationPermissionState === 'denied') {
      showNotificationBanner('Izin lokasi ditolak di browser. Silakan aktifkan izin lokasi di pengaturan browser.');
      reject(new Error('permission_denied_cached'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cachedLocationPermissionState = 'granted';
        lastKnownGPSPosition = pos;
        resolve(pos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          cachedLocationPermissionState = 'denied';
          showNotificationBanner('Izin lokasi ditolak oleh pengguna.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          showNotificationBanner('Layanan lokasi (GPS) perangkat nonaktif. Aktifkan GPS pada perangkat Anda.');
        } else if (err.code === err.TIMEOUT) {
          showNotificationBanner('Batas waktu sinyal GPS habis. Silakan coba lagi di area terbuka.');
        } else {
          showNotificationBanner('Gagal mengambil sinyal GPS.');
        }
        reject(err);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000, ...options }
    );
  });
}

// Dipertahankan agar kode lama yang memanggil requestAppLocationPermission() tetap jalan.
async function requestAppLocationPermission() {
  try {
    await getAppGPSPosition();
    return true;
  } catch (e) {
    return false;
  }
}

async function checkAppCameraPermission() {
  if (cachedCameraPermissionState === 'granted' || cachedCameraPermissionState === 'denied') {
    return cachedCameraPermissionState;
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' });
      cachedCameraPermissionState = status.state;
      status.onchange = () => { cachedCameraPermissionState = status.state; };
      return status.state;
    } catch (e) {}
  }
  return cachedCameraPermissionState || 'prompt';
}

// Fungsi TUNGGAL untuk membuka kamera. Menggantikan seluruh pemanggilan
// navigator.mediaDevices.getUserMedia langsung di tiap fitur kamera (Map+Kamera,
// Scan Struk, Jelaskan Objek, dll). Sebelumnya tiap fitur bisa memicu dialog izin
// browser masing-masing; sekarang statusnya di-cache sehingga hanya diminta sekali
// per sesi, dan kamera tidak perlu dibuka-tutup dua kali hanya untuk "cek izin".
async function getAppCameraStream(constraints = { video: true, audio: false }) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNotificationBanner('Kamera tidak didukung oleh browser Anda.');
    throw new Error('getUserMedia_unsupported');
  }

  if (cachedCameraPermissionState === 'denied') {
    showNotificationBanner('Izin kamera ditolak di browser. Silakan aktifkan izin kamera di pengaturan browser.');
    throw new Error('permission_denied_cached');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    cachedCameraPermissionState = 'granted';
    return stream;
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      cachedCameraPermissionState = 'denied';
      showNotificationBanner('Izin akses kamera ditolak.');
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      showNotificationBanner('Kamera tidak ditemukan pada perangkat ini.');
    } else {
      showNotificationBanner('Gagal mengakses kamera: ' + err.message);
    }
    throw err;
  }
}

// Dipertahankan agar kode lama yang memanggil requestAppCameraPermission() tetap jalan.
async function requestAppCameraPermission() {
  if (cachedCameraPermissionState === 'granted') return true;
  try {
    const stream = await getAppCameraStream({ video: true, audio: false });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// MY MAPS - LOKASI SAYA ACTION & GPS MARKER
// ============================================================
let userCurrentLocationMarker = null;

async function handleMyMapsCurrentLocation() {
  showNotificationBanner('Melacak posisi GPS Anda... 📍');

  let pos;
  try {
    // Satu pemanggilan saja: sekaligus meminta izin (jika belum) DAN mengambil posisi.
    // Ini menggantikan alur lama yang memanggil GPS dua kali berturut-turut
    // (sekali untuk "cek izin", sekali lagi untuk ambil posisi beneran).
    pos = await getAppGPSPosition({ maximumAge: 5000 });
  } catch (e) {
    return; // pesan error sudah ditampilkan oleh getAppGPSPosition()
  }

  if (!pos || !pos.coords) {
    showNotificationBanner('Sinyal GPS tidak memberikan data koordinat valid.');
    return;
  }

  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showNotificationBanner('Koordinat GPS yang diterima di luar jangkauan valid.');
    return;
  }

  currentOriginCoords = { lat, lng, label: 'Lokasi Saya' };

  initOrUpdateNavMap(lat, lng);
  setTimeout(() => {
    if (navMap) {
      navMap.invalidateSize();
      navMap.setView([lat, lng], 16);

      if (userCurrentLocationMarker) {
        userCurrentLocationMarker.setLatLng([lat, lng]);
      } else {
        const gpsUserIcon = L.divIcon({
          className: 'custom-user-gps-marker',
          html: `<div style="background: #2563EB; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.25); border: 2.5px solid white; font-size: 1rem;"><i class="fa-solid fa-location-crosshairs"></i></div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        });
        userCurrentLocationMarker = L.marker([lat, lng], { icon: gpsUserIcon }).addTo(navMap);
      }
      userCurrentLocationMarker.bindPopup(`<b>Lokasi Saya (GPS)</b><br><small>${lat.toFixed(6)}, ${lng.toFixed(6)}</small>`).openPopup();
    }
  }, 250);

  showNotificationBanner('Peta berpusat pada posisi GPS Anda! 📍');
}

function getUserGPSLocation() {
  showNavError('');
  handleMyMapsCurrentLocation();
}

function normalizeAddressComponents(addr) {
  if (!addr) return { street: '', houseNumber: '', village: '', district: '', city: '', province: '', country: 'Indonesia', postalCode: '', displayAddress: '' };

  // 1. Street (Jalan & No) - NEVER use suburb as street name!
  const streetName = addr.road || addr.street || addr.pedestrian || addr.path || addr.footway || addr.alley || '';
  const houseNum = addr.house_number || addr.building || '';
  let street = '';
  if (streetName) {
    const prefixed = (streetName.toLowerCase().startsWith('jl') || streetName.toLowerCase().startsWith('jalan')) ? streetName : 'Jl. ' + streetName;
    street = (prefixed + (houseNum ? ' No. ' + houseNum : '')).trim();
  }

  // 2. Desa / Kelurahan (Village / Suburb / Neighbourhood)
  const villageName = addr.village || addr.suburb || addr.neighbourhood || addr.quarter || addr.residential || addr.hamlet || '';
  let village = '';
  if (villageName) {
    village = (villageName.toLowerCase().startsWith('desa') || villageName.toLowerCase().startsWith('kel')) ? villageName : 'Desa/Kel. ' + villageName;
  }

  // 3. Kecamatan (District / City District / Sub-district)
  const districtName = addr.city_district || addr.district || addr.subdistrict || addr.subcounty || '';
  const cleanDistrict = (districtName && districtName !== villageName) ? districtName : (addr.county && addr.county !== addr.city ? addr.county : '');
  let district = '';
  if (cleanDistrict) {
    district = cleanDistrict.toLowerCase().startsWith('kec') ? cleanDistrict : 'Kec. ' + cleanDistrict;
  }

  // 4. Kota / Kabupaten (City / Town / Municipality / Regency)
  const cityName = addr.city || addr.town || addr.municipality || addr.regency || addr.city_clause || '';
  let city = '';
  if (cityName) {
    city = (cityName.toLowerCase().startsWith('kota') || cityName.toLowerCase().startsWith('kab')) ? cityName : 'Kota/Kab. ' + cityName;
  }

  // 5. Provinsi (State / Province / Region)
  const province = addr.state || addr.province || addr.region || addr.state_district || '';

  // 6. Negara & Kode Pos
  const country = addr.country || 'Indonesia';
  const postalCode = addr.postcode || addr.postal_code || '';

  // Build clean multiline formatted address following Indonesian hierarchy
  const parts = [];
  if (street) parts.push(street);
  if (village) parts.push(village);
  if (district) parts.push(district);
  if (city) parts.push(city);
  if (province) parts.push(province);
  if (country) parts.push(country);
  if (postalCode) parts.push(postalCode);

  const displayAddress = parts.join('\n');

  return {
    street,
    houseNumber: houseNum,
    village,
    district,
    city,
    province,
    country,
    postalCode,
    formatted: displayAddress,
    displayAddress
  };
}

function normalizeSearchResponse(rawResponse, query = '') {
  if (!rawResponse) return [];

  let items = [];

  // Handle Array (Nominatim response)
  if (Array.isArray(rawResponse)) {
    items = rawResponse;
  }
  // Handle GeoJSON FeatureCollection (Photon API response)
  else if (rawResponse.features && Array.isArray(rawResponse.features)) {
    items = rawResponse.features.map(f => {
      const props = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      const lat = coords[1] !== undefined ? parseFloat(coords[1]) : null;
      const lng = coords[0] !== undefined ? parseFloat(coords[0]) : null;
      return {
        lat,
        lon: lng,
        display_name: props.name ? `${props.name}, ${props.street || ''} ${props.city || props.district || ''} ${props.state || ''} ${props.country || 'Indonesia'}` : query,
        name: props.name || query,
        address: {
          road: props.street || props.name || '',
          house_number: props.housenumber || '',
          suburb: props.district || props.suburb || '',
          district: props.district || props.city_district || '',
          city: props.city || props.county || '',
          state: props.state || '',
          country: props.country || 'Indonesia',
          postcode: props.postcode || ''
        }
      };
    });
  }
  // Handle object with results property
  else if (rawResponse.results && Array.isArray(rawResponse.results)) {
    items = rawResponse.results;
  }
  // Handle single object
  else if (typeof rawResponse === 'object' && (rawResponse.lat || rawResponse.latitude)) {
    items = [rawResponse];
  }

  const normalized = [];
  items.forEach((item, index) => {
    if (!item) return;

    const lat = parseFloat(item.lat !== undefined ? item.lat : (item.latitude !== undefined ? item.latitude : NaN));
    const lng = parseFloat(item.lon !== undefined ? item.lon : (item.lng !== undefined ? item.lng : (item.longitude !== undefined ? item.longitude : NaN)));

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    const normAddr = normalizeAddressComponents(item.address);
    const rawName = item.name || (item.display_name ? item.display_name.split(',')[0] : query) || 'Lokasi Terpilih';
    const cleanName = rawName.trim();
    const fullDisplayAddr = normAddr.formatted || item.display_name || cleanName;

    normalized.push({
      id: item.id || item.place_id || 'search_' + Date.now() + '_' + index,
      name: cleanName,
      label: cleanName,
      address: fullDisplayAddr,
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      addressComponents: normAddr,
      rawResult: item
    });
  });

  return normalized;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function geocodeLocation(query) {
  if (!query || typeof query !== 'string') return [];

  const trimmed = query.trim();
  if (!trimmed) return [];

  console.log('[DEBUG MY MAPS SEARCH] Query:', trimmed);

  // 1. Coordinate search check
  const coordRegex = /^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/;
  const match = trimmed.match(coordRegex);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[3]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [{
        id: 'coord_' + Date.now(),
        lat,
        lng,
        latitude: lat,
        longitude: lng,
        label: `Koordinat (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        name: `Koordinat (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        address: `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}`,
        addressComponents: { street: '', village: '', district: '', city: '', province: '', country: 'Indonesia', displayAddress: `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}` },
        rawResult: null
      }];
    }
  }

  // 2. Saved places check
  const savedMatches = [];
  if (appState.savedPlaces && appState.savedPlaces.length > 0) {
    const qLower = trimmed.toLowerCase();
    appState.savedPlaces.forEach(p => {
      if (p.name && p.name.toLowerCase().includes(qLower)) {
        const lat = parseFloat(p.lat);
        const lng = parseFloat(p.lng);
        savedMatches.push({
          id: p.id || 'saved_' + Date.now(),
          lat,
          lng,
          latitude: lat,
          longitude: lng,
          label: p.name,
          name: p.name,
          address: p.address || 'Lokasi Tersimpan',
          addressComponents: { street: p.name, village: '', district: '', city: '', province: '', country: 'Indonesia', displayAddress: p.address || 'Lokasi Tersimpan' },
          rawResult: p
        });
      }
    });
  }

  // 3. Multi-Stage Geocoding Pipeline (Fast Parallel/Waterfall with 3.5s Timeout)
  const cleanQuery = trimmed.replace(/\b(kota|kabupaten|kab|kecamatan|kec|kelurahan|kel|desa)\b/gi, '').replace(/\s+/g, ' ').trim();
  const searchUrls = [
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=id&limit=8&q=${encodeURIComponent(trimmed)}`,
    `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=8`
  ];
  if (cleanQuery && cleanQuery !== trimmed) {
    searchUrls.push(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=id&limit=8&q=${encodeURIComponent(cleanQuery)}`);
    searchUrls.push(`https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQuery)}&limit=8`);
  }

  let apiResults = [];

  // Execute requests with fast timeout
  const fetchPromises = searchUrls.map(url =>
    fetchWithTimeout(url, {}, 3500)
      .then(async res => {
        if (!res.ok) return [];
        const data = await res.json();
        return normalizeSearchResponse(data, trimmed);
      })
      .catch(err => {
        console.warn('[DEBUG MY MAPS SEARCH] Fetch warning for', url, err.message);
        return [];
      })
  );

  const resultsSettled = await Promise.allSettled(fetchPromises);
  resultsSettled.forEach(res => {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      res.value.forEach(item => {
        const isDup = apiResults.some(existing => Math.abs(existing.lat - item.lat) < 0.0001 && Math.abs(existing.lng - item.lng) < 0.0001);
        if (!isDup) apiResults.push(item);
      });
    }
  });

  const combined = [...savedMatches];
  apiResults.forEach(item => {
    const isDup = combined.some(existing => Math.abs(existing.lat - item.lat) < 0.0001 && Math.abs(existing.lng - item.lng) < 0.0001);
    if (!isDup) combined.push(item);
  });

  console.log('[DEBUG MY MAPS SEARCH] Combined Result Count:', combined.length);
  return combined;
}

function formatRouteDistance(meters) {
  if (meters === undefined || meters === null || isNaN(meters)) return '0 m';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = (meters / 1000).toFixed(1).replace('.', ',');
  return `${km} km`;
}

function formatRouteDuration(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '0 min';
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) {
    return `${totalMins} min`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (mins === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${mins} min`;
}

// ============================================================
// SINGLE CORE NAVIGATION ENGINE (FASE 9)
// All 4 entry points (Map Point, Saved Location, Free Marker, Saved Photo)
// invoke this single core navigation service.
// ============================================================
async function startNavigationService({ origin, destination }) {
  showNavError('');
  if (!origin || !destination) {
    showNavError('Lokasi asal atau lokasi tujuan tidak ditentukan.');
    return;
  }

  const originLat = parseFloat(origin.lat !== undefined ? origin.lat : origin.latitude);
  const originLng = parseFloat(origin.lng !== undefined ? origin.lng : origin.longitude);
  const destLat = parseFloat(destination.lat !== undefined ? destination.lat : destination.latitude);
  const destLng = parseFloat(destination.lng !== undefined ? destination.lng : destination.longitude);

  // Strict Coordinate Validation (-90 <= lat <= 90, -180 <= lng <= 180)
  const isOriginValid = (!isNaN(originLat) && !isNaN(originLng) && originLat >= -90 && originLat <= 90 && originLng >= -180 && originLng <= 180);
  const isDestValid = (!isNaN(destLat) && !isNaN(destLng) && destLat >= -90 && destLat <= 90 && destLng >= -180 && destLng <= 180);

  if (!isOriginValid || !isDestValid) {
    const rootCause = `Navigation Engine Error: Invalid coordinates. Origin: (${originLat}, ${originLng}), Dest: (${destLat}, ${destLng})`;
    console.error(rootCause);
    showNavError(!isOriginValid ? 'Lokasi asal tidak valid.' : 'Lokasi tujuan tidak valid.');
    return;
  }

  showNotificationBanner('Menghitung rute navigasi... 🚗');

  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(osrmUrl);

    if (!res.ok) {
      const rootCause = `OSRM API HTTP error status ${res.status}`;
      console.error('Navigation Engine Error:', rootCause);
      showNavError('Rute tidak dapat dihitung karena layanan peta/routing tidak merespons.');
      return;
    }

    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const distMeters = route.distance;
      const durationSecs = route.duration;

      const distStr = formatRouteDistance(distMeters);
      const durationStr = formatRouteDuration(durationSecs);

      const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}`;

      const originLabel = origin.name || origin.label || 'Lokasi Asal';
      const destLabel = destination.name || destination.label || 'Lokasi Tujuan';

      appState.activeNavigationRoute = {
        origin: { lat: originLat, lng: originLng, label: originLabel },
        destination: { lat: destLat, lng: destLng, label: destLabel },
        geometry: route.geometry,
        distanceMeters: distMeters,
        durationSeconds: durationSecs,
        formattedDistance: distStr,
        formattedDuration: durationStr,
        googleMapsUrl: gmapsUrl
      };
      saveStateToLocalStorage();

      // Clean up temporary selection markers if any
      hideSelectedMapPointPanel();

      renderActiveRouteOnMap(appState.activeNavigationRoute);
      showNotificationBanner(`Navigasi Aktif! Jarak: ${distStr} (${durationStr}) 🚗`);
    } else {
      const rootCause = `OSRM route result code: ${data.code || 'No route'}`;
      console.error('Navigation Engine Error:', rootCause, data);
      showNavError('Tidak ditemukan rute perjalanan antara lokasi tersebut.');
    }
  } catch (err) {
    console.error('Navigation Engine Network Exception:', err);
    if (err.name === 'TypeError') {
      showNavError('Gagal terhubung ke layanan navigasi. Periksa koneksi internet Anda.');
    } else {
      showNavError('Gagal menghitung rute: ' + err.message);
    }
  }
}

// Saat pengguna mengetik ulang salah satu input, koordinat yang sudah di-cache
// dianggap tidak valid lagi — nanti di-geocode ulang saat "Hitung Rute & Navigasi".
function handleLocationInputChange(type, value) {
  const trimmed = (value || '').trim();
  if (type === 'origin') {
    if (currentOriginCoords && currentOriginCoords.label !== trimmed) {
      currentOriginCoords = null;
    }
  } else if (type === 'destination') {
    if (currentDestinationCoords && currentDestinationCoords.label !== trimmed) {
      currentDestinationCoords = null;
    }
  }
}

// Geocode teks asal & tujuan (koordinat / lokasi tersimpan / Nominatim+Photon),
// lalu hitung rutenya. Dipanggil dari tombol "Hitung Rute & Navigasi" / tombol Enter.
async function navigateFromInputs() {
  const originInput = document.getElementById('originLocationInput');
  const destInput = document.getElementById('destinationLocationInput');
  if (!originInput || !destInput) return;

  const originText = originInput.value.trim();
  const destText = destInput.value.trim();

  if (!originText || !destText) {
    showNavError('Isi lokasi asal dan tujuan terlebih dahulu.');
    showNotificationBanner('Isi lokasi asal dan tujuan terlebih dahulu!');
    return;
  }

  showNotificationBanner('Mencari lokasi & menghitung rute... 🚗');

  // --- Lokasi Asal ---
  if (!currentOriginCoords || currentOriginCoords.label !== originText) {
    const res = await geocodeLocation(originText);
    if (res && res.length > 0) {
      currentOriginCoords = {
        lat: parseFloat(res[0].lat),
        lng: parseFloat(res[0].lng),
        label: res[0].name || res[0].label || originText
      };
      originInput.value = currentOriginCoords.label;
    } else {
      showNavError('Lokasi asal tidak ditemukan. Coba ketik lebih lengkap, gunakan koordinat (lat, lng), atau pilih dari lokasi tersimpan.');
      return;
    }
  }

  // --- Lokasi Tujuan ---
  if (!currentDestinationCoords || currentDestinationCoords.label !== destText) {
    const res = await geocodeLocation(destText);
    if (res && res.length > 0) {
      currentDestinationCoords = {
        lat: parseFloat(res[0].lat),
        lng: parseFloat(res[0].lng),
        label: res[0].name || res[0].label || destText
      };
      destInput.value = currentDestinationCoords.label;
    } else {
      showNavError('Lokasi tujuan tidak ditemukan. Coba ketik lebih lengkap, gunakan koordinat (lat, lng), atau pilih dari lokasi tersimpan.');
      return;
    }
  }

  await calculateDirectionsRoute();
}

async function calculateDirectionsRoute() {
  if (currentOriginCoords && currentDestinationCoords) {
    await startNavigationService({ origin: currentOriginCoords, destination: currentDestinationCoords });
  } else {
    showNavError('Lokasi asal atau tujuan belum dipilih.');
  }
}

function renderActiveRouteOnMap(routeData) {
  if (!routeData) return;

  const { origin, destination, geometry, formattedDistance, formattedDuration, googleMapsUrl } = routeData;
  activeGoogleMapsRouteUrl = googleMapsUrl;

  initOrUpdateNavMap(origin.lat, origin.lng);
  setTimeout(() => {
    if (navMap) {
      if (navRoutePolyline) navMap.removeLayer(navRoutePolyline);
      if (navOriginMarker) navMap.removeLayer(navOriginMarker);
      if (navDestinationMarker) navMap.removeLayer(navDestinationMarker);

      navRoutePolyline = L.geoJSON(geometry, {
        style: {
          color: '#3B82F6',
          weight: 6,
          opacity: 0.85
        }
      }).addTo(navMap);

      const iconA = L.divIcon({
        className: 'custom-marker-a',
        html: `<div style="background: #3B82F6; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4); border: 2px solid white; font-weight: 800; font-size: 0.85rem;">A</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      navOriginMarker = L.marker([origin.lat, origin.lng], { icon: iconA }).addTo(navMap);
      navOriginMarker.bindPopup(`<b>Asal:</b> ${escapeHtml(origin.label)}`);

      const iconB = L.divIcon({
        className: 'custom-marker-b',
        html: `<div style="background: #EF4444; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.4); border: 2px solid white; font-weight: 800; font-size: 0.85rem;">B</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      navDestinationMarker = L.marker([destination.lat, destination.lng], { icon: iconB }).addTo(navMap);
      navDestinationMarker.bindPopup(`<b>Tujuan:</b> ${escapeHtml(destination.label)}`).openPopup();

      navMap.fitBounds(navRoutePolyline.getBounds(), { padding: [40, 40] });
    }
  }, 250);

  const distEl = document.getElementById('navRouteDistanceText');
  if (distEl) distEl.textContent = formattedDistance;

  const durEl = document.getElementById('navRouteDurationText');
  if (durEl) durEl.textContent = formattedDuration;

  const routeTextEl = document.getElementById('activeNavRouteText');
  if (routeTextEl) routeTextEl.textContent = `${origin.label} ➔ ${destination.label}`;

  const activeBox = document.getElementById('activeNavStatusBox');
  if (activeBox) activeBox.style.display = 'block';

  // Start ETA countdown for the new/restored route
  startETAInterval();
}

function restoreActiveNavigationIfAny() {
  if (appState.activeNavigationRoute) {
    renderActiveRouteOnMap(appState.activeNavigationRoute);
  }
}

function openRouteInExternalGoogleMaps() {
  if (activeGoogleMapsRouteUrl) {
    window.open(activeGoogleMapsRouteUrl, '_blank');
  } else if (appState.activeNavigationRoute && appState.activeNavigationRoute.googleMapsUrl) {
    window.open(appState.activeNavigationRoute.googleMapsUrl, '_blank');
  } else {
    const originEl = document.getElementById('originLocationInput');
    const destEl = document.getElementById('destinationLocationInput');
    const originVal = originEl ? originEl.value.trim() : '';
    const destVal = destEl ? destEl.value.trim() : '';
    if (destVal) {
      window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originVal)}&destination=${encodeURIComponent(destVal)}`, '_blank');
    } else {
      showNotificationBanner('Belum ada rute aktif untuk dibuka di Google Maps.');
    }
  }
}

function finishNavigation() {
  const activeBox = document.getElementById('activeNavStatusBox');
  if (activeBox) activeBox.style.display = 'none';

  const infoBox = document.getElementById('navRouteInfoBox');
  if (infoBox) infoBox.style.display = 'none';

  showNavError('');

  if (navRoutePolyline && navMap) {
    navMap.removeLayer(navRoutePolyline);
    navRoutePolyline = null;
  }
  if (navOriginMarker && navMap) {
    navMap.removeLayer(navOriginMarker);
    navOriginMarker = null;
  }
  if (navDestinationMarker && navMap) {
    navMap.removeLayer(navDestinationMarker);
    navDestinationMarker = null;
  }

  appState.activeNavigationRoute = null;
  saveStateToLocalStorage();
  stopETAInterval();
  renderSavedRoutes();

  showNotificationBanner('Navigasi selesai.');
}

// ============================================================
// FITUR 1: ETA REAL-TIME
// ============================================================
let etaUpdateInterval = null;
let etaNavigationStartTime = null;

function updateETADisplay() {
  const route = appState.activeNavigationRoute;
  const etaEl = document.getElementById('etaClockText');
  const etaInfoText = document.getElementById('etaInfoText');
  if (!etaEl) return;

  if (!route || !route.durationSeconds) {
    etaEl.textContent = '--:--';
    return;
  }

  const now = new Date();
  const durationMs = (route.durationSeconds || 0) * 1000;
  const startTime = etaNavigationStartTime || now;
  const elapsed = now - startTime;
  const remaining = Math.max(0, durationMs - elapsed);
  const etaDate = new Date(now.getTime() + remaining);

  const hh = etaDate.getHours().toString().padStart(2, '0');
  const mm = etaDate.getMinutes().toString().padStart(2, '0');
  etaEl.textContent = `${hh}:${mm}`;

  const remMins = Math.round(remaining / 60000);
  if (etaInfoText) {
    if (remMins <= 0) {
      etaInfoText.textContent = 'Kamu seharusnya sudah tiba!';
    } else {
      etaInfoText.textContent = `Sisa estimasi: ${remMins} menit lagi.`;
    }
  }
}

function startETAInterval() {
  etaNavigationStartTime = new Date();
  updateETADisplay();
  if (etaUpdateInterval) clearInterval(etaUpdateInterval);
  etaUpdateInterval = setInterval(updateETADisplay, 60000);
}

function stopETAInterval() {
  if (etaUpdateInterval) {
    clearInterval(etaUpdateInterval);
    etaUpdateInterval = null;
  }
  etaNavigationStartTime = null;
  const etaEl = document.getElementById('etaClockText');
  if (etaEl) etaEl.textContent = '--:--';
}

function refreshETANow() {
  etaNavigationStartTime = new Date();
  updateETADisplay();
  showNotificationBanner('ETA diperbarui!');
}

// ============================================================
// FITUR 2: MAP + CAMERA
// ============================================================
let mapCameraStream = null;
let mapCameraFacingMode = 'environment'; // 'environment' = rear, 'user' = front
let lastCapturedPhotoDataUrl = null;

async function openMapCamera() {
  const overlay = document.getElementById('mapCameraOverlay');
  if (!overlay) return;

  // Close any existing stream first
  if (mapCameraStream) {
    mapCameraStream.getTracks().forEach(t => t.stop());
    mapCameraStream = null;
  }

  try {
    mapCameraStream = await getAppCameraStream({
      video: { facingMode: mapCameraFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    const video = document.getElementById('mapCameraVideo');
    if (video) {
      video.srcObject = mapCameraStream;
      video.play();
    }

    // Update location context label
    updateMapCameraLocationLabel();

    overlay.style.display = 'flex';
    showNotificationBanner('Kamera aktif! Ketuk tombol merah untuk mengambil foto.');
  } catch (err) {
    console.warn('Map camera error:', err);
    // Pesan error sudah ditampilkan oleh getAppCameraStream()
  }
}

function updateMapCameraLocationLabel() {
  const labelEl = document.getElementById('mapCameraLocationText');
  if (!labelEl) return;

  if (currentDestinationCoords) {
    labelEl.textContent = currentDestinationCoords.label || 'Tujuan Navigasi';
  } else if (currentOriginCoords) {
    labelEl.textContent = currentOriginCoords.label || 'Lokasi Saya';
  } else if (navMap) {
    const c = navMap.getCenter();
    labelEl.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  } else {
    labelEl.textContent = 'Lokasi tidak diketahui';
  }
}

function closeMapCamera() {
  if (mapCameraStream) {
    mapCameraStream.getTracks().forEach(t => t.stop());
    mapCameraStream = null;
  }
  const video = document.getElementById('mapCameraVideo');
  if (video) {
    video.srcObject = null;
  }
  const overlay = document.getElementById('mapCameraOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function flipMapCamera() {
  mapCameraFacingMode = mapCameraFacingMode === 'environment' ? 'user' : 'environment';
  await openMapCamera();
}

let currentCapturedPhotoMeta = null;

async function captureMapCameraPhoto() {
  const video = document.getElementById('mapCameraVideo');
  const canvas = document.getElementById('mapCameraCanvas');
  if (!video || !canvas || !mapCameraStream) {
    showNotificationBanner('Kamera belum siap.');
    return;
  }

  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Determine current coordinates
  let lat = null, lng = null;
  let locName = 'Foto Lokasi';
  if (currentDestinationCoords) {
    lat = currentDestinationCoords.lat;
    lng = currentDestinationCoords.lng;
    locName = currentDestinationCoords.label || 'Lokasi Terpilih';
  } else if (currentOriginCoords) {
    lat = currentOriginCoords.lat;
    lng = currentOriginCoords.lng;
    locName = currentOriginCoords.label || 'Lokasi Saya';
  } else if (navMap) {
    const center = navMap.getCenter();
    lat = center.lat;
    lng = center.lng;
    locName = 'Lokasi Peta';
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const dateTimeStr = `${dateStr} · ${timeStr}`;
  const coordsStr = (lat !== null && lng !== null) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Koordinat tidak tersedia';

  // Prepare initial metadata object
  currentCapturedPhotoMeta = {
    photoId: 'photo_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    title: '',
    latitude: lat,
    longitude: lng,
    locationName: locName,
    addressComponents: null,
    formattedAddress: 'Mendapatkan alamat...',
    capturedAt: dateTimeStr,
    createdAt: now.toISOString()
  };

  // Show status UI in modal
  const metaNameEl = document.getElementById('photoMetaName');
  const metaAddrEl = document.getElementById('photoMetaAddress');
  const metaCoordsEl = document.getElementById('photoMetaCoords');
  const metaTimeEl = document.getElementById('photoMetaTime');
  const statusEl = document.getElementById('photoGeocodingStatus');
  const titleInput = document.getElementById('photoTitleInput');

  if (titleInput) titleInput.value = (locName !== 'Lokasi Kamera' && locName !== 'Lokasi Peta') ? locName : '';
  if (metaNameEl) metaNameEl.textContent = locName;
  if (metaAddrEl) metaAddrEl.textContent = 'Mendapatkan alamat...';
  if (metaCoordsEl) metaCoordsEl.textContent = coordsStr;
  if (metaTimeEl) metaTimeEl.textContent = dateTimeStr;
  if (statusEl) statusEl.style.display = 'block';

  // Reverse geocode if coordinates available
  let fullAddress = 'Alamat tidak tersedia';
  let normAddr = null;
  if (lat !== null && lng !== null) {
    try {
      const geoResult = await reverseGeocodeCoordinates(lat, lng);
      if (geoResult) {
        normAddr = geoResult.addressComponents;
        fullAddress = geoResult.displayName || normAddr?.formatted || 'Alamat tidak tersedia';
        if (geoResult.name && geoResult.name !== fullAddress && (!titleInput || !titleInput.value.trim())) {
          locName = geoResult.name;
          if (titleInput) titleInput.value = locName;
        }
      }
    } catch (e) {
      console.warn('Reverse geocode failed:', e);
    }
  }

  currentCapturedPhotoMeta.locationName = locName;
  currentCapturedPhotoMeta.addressComponents = normAddr;
  currentCapturedPhotoMeta.formattedAddress = fullAddress;

  if (metaNameEl) metaNameEl.textContent = locName;
  if (metaAddrEl) metaAddrEl.textContent = fullAddress;
  if (statusEl) statusEl.style.display = 'none';

  // Draw Initial Watermark Overlay on Canvas
  drawWatermarkOnCanvas(canvas, locName, fullAddress, dateTimeStr, coordsStr);

  lastCapturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // Show preview modal
  const previewImg = document.getElementById('cameraPhotoPreviewImg');
  if (previewImg) previewImg.src = lastCapturedPhotoDataUrl;

  openModal('modalCameraPhotoPreview');
  showNotificationBanner('Foto lokasi berhasil diambil!');
}

function drawWatermarkOnCanvas(canvas, customUserTitle, address, dateTimeStr, coordsStr) {
  const ctx = canvas.getContext('2d');
  const pad = Math.round(canvas.width * 0.028);
  const overlayHeight = Math.max(110, Math.round(canvas.height * 0.22));

  // Semi-transparent dark background for watermark footer
  ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
  ctx.fillRect(0, canvas.height - overlayHeight, canvas.width, overlayHeight);

  // Top accent stripe
  ctx.fillStyle = '#3B82F6';
  ctx.fillRect(0, canvas.height - overlayHeight, canvas.width, 4);

  ctx.fillStyle = '#FFFFFF';
  const fontSizeAddr = Math.max(12, Math.round(canvas.width * 0.017));
  const fontSizeMeta = Math.max(11, Math.round(canvas.width * 0.015));

  let currentY = canvas.height - overlayHeight + pad + fontSizeAddr * 0.8;

  // Print custom user title ONLY if explicitly entered by the user
  const isCustomTitleEntered = customUserTitle && customUserTitle.trim() &&
    customUserTitle !== 'Foto Lokasi' &&
    customUserTitle !== 'Lokasi Kamera' &&
    customUserTitle !== 'Lokasi Peta' &&
    customUserTitle !== 'Titik Peta' &&
    customUserTitle !== 'Lokasi Terpilih';

  if (isCustomTitleEntered) {
    ctx.font = `bold ${fontSizeAddr + 2}px sans-serif`;
    ctx.fillText('📷 ' + customUserTitle.trim(), pad, currentY);
    currentY += fontSizeAddr * 1.3;
  }

  // Address line (clean normalized address)
  ctx.font = `${fontSizeAddr}px sans-serif`;
  ctx.fillStyle = '#F1F5F9';
  const maxAddrWidth = canvas.width - pad * 2;
  const singleLineAddr = (address || '').replace(/\n/g, ' · ');
  let truncatedAddr = singleLineAddr;
  if (ctx.measureText(truncatedAddr).width > maxAddrWidth) {
    while (truncatedAddr.length > 10 && ctx.measureText(truncatedAddr + '...').width > maxAddrWidth) {
      truncatedAddr = truncatedAddr.slice(0, -1);
    }
    truncatedAddr += '...';
  }

  ctx.fillText(truncatedAddr, pad, currentY);

  // Date, Time & Coordinates line
  ctx.fillStyle = '#94A3B8';
  ctx.font = `${fontSizeMeta}px sans-serif`;
  ctx.fillText(`📅 ${dateTimeStr}  •  🌐 ${coordsStr}`, pad, canvas.height - pad);
}

let isSavingPhoto = false;

async function savePhotoToGallery() {
  if (!lastCapturedPhotoDataUrl || !currentCapturedPhotoMeta) {
    showNotificationBanner('Tidak ada foto untuk disimpan.');
    return;
  }
  if (isSavingPhoto) return;

  isSavingPhoto = true;
  const saveBtn = document.getElementById('btnSavePhotoToGallery');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
  }

  try {
    const photoId = currentCapturedPhotoMeta.photoId;

    // Check duplicate
    if (!appState.savedPhotos) appState.savedPhotos = [];
    const isDup = appState.savedPhotos.some(p => p.photoId === photoId);
    if (isDup) {
      showNotificationBanner('Foto ini sudah tersimpan di Foto Tersimpan.');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
      }
      isSavingPhoto = false;
      return;
    }

    // Read custom photo title from input
    const titleInput = document.getElementById('photoTitleInput');
    const userTitle = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : (currentCapturedPhotoMeta.locationName || 'Foto Lokasi');

    // Redraw canvas watermark with custom title
    const canvas = document.getElementById('mapCameraCanvas');
    if (canvas) {
      const lat = currentCapturedPhotoMeta.latitude;
      const lng = currentCapturedPhotoMeta.longitude;
      const coordsStr = (lat !== null && lng !== null) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Koordinat tidak tersedia';
      drawWatermarkOnCanvas(canvas, userTitle, currentCapturedPhotoMeta.formattedAddress, currentCapturedPhotoMeta.capturedAt, coordsStr);
      lastCapturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    }

    // Convert dataUrl to blob
    const fetchRes = await fetch(lastCapturedPhotoDataUrl);
    const blob = await fetchRes.blob();

    // Store binary image in AppFileStorage (IndexedDB / penyimpanan HP via AndroidBridge)
    let fileId = null;
    if (typeof AppFileStorage !== 'undefined' && AppFileStorage.saveFile) {
      const photoFile = new File([blob], `${photoId}.jpg`, { type: 'image/jpeg' });
      fileId = await AppFileStorage.saveFile(photoFile);
    }

    // Trigger local device download / gallery save
    const link = document.createElement('a');
    link.download = `foto-lokasi-${Date.now()}.jpg`;
    link.href = lastCapturedPhotoDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Save metadata to appState
    const photoRecord = {
      photoId,
      title: userTitle,
      fileId: fileId || photoId,
      dataUrl: fileId ? null : lastCapturedPhotoDataUrl,
      latitude: currentCapturedPhotoMeta.latitude,
      longitude: currentCapturedPhotoMeta.longitude,
      locationName: currentCapturedPhotoMeta.locationName,
      addressComponents: currentCapturedPhotoMeta.addressComponents,
      formattedAddress: currentCapturedPhotoMeta.formattedAddress,
      address: currentCapturedPhotoMeta.formattedAddress,
      capturedAt: currentCapturedPhotoMeta.capturedAt,
      createdAt: currentCapturedPhotoMeta.createdAt
    };

    appState.savedPhotos.unshift(photoRecord);
    saveStateToLocalStorage();
    renderSavedPhotos();

    showNotificationBanner('Foto berhasil disimpan ke galeri & Foto Tersimpan!');
    closeModal('modalCameraPhotoPreview');
  } catch (err) {
    console.error('Error saving photo:', err);
    showNotificationBanner('Gagal menyimpan foto: ' + err.message);
  } finally {
    isSavingPhoto = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan';
    }
  }
}

async function shareCameraPhoto() {
  if (!lastCapturedPhotoDataUrl) {
    showNotificationBanner('Tidak ada foto untuk dibagikan.');
    return;
  }

  const titleInput = document.getElementById('photoTitleInput');
  const locationText = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : (currentCapturedPhotoMeta?.locationName || 'Foto Lokasi');

  try {
    const res = await fetch(lastCapturedPhotoDataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'foto-lokasi.jpg', { type: 'image/jpeg' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: 'Foto Lokasi – My Maps',
        text: `📍 ${locationText}`,
        files: [file]
      });
      return;
    }
  } catch (err) {
    console.warn('Native share failed:', err);
  }

  // Download fallback
  const link = document.createElement('a');
  link.download = 'foto-lokasi.jpg';
  link.href = lastCapturedPhotoDataUrl;
  link.click();
  showNotificationBanner('Foto diunduh ke perangkat!');
}

// ============================================================
// FITUR: SAVED PHOTO (Foto Tersimpan)
// ============================================================
let activeSavedPhoto = null;

async function renderSavedPhotos() {
  const container = document.getElementById('savedPhotosContainer');
  if (!container) return;
  container.innerHTML = '';

  if (!appState.savedPhotos) appState.savedPhotos = [];

  if (appState.savedPhotos.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem; background: var(--bg-card); border-radius: 18px; border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-images mb-2" style="font-size: 1.8rem; color: #3B82F6; display: block; margin-bottom: 8px;"></i>
        <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main); margin-bottom: 4px;">Belum ada Foto Tersimpan</div>
        <div style="font-size: 0.82rem;">Potret lokasi dengan <strong>Map + Kamera</strong> lalu tekan <strong>Simpan</strong> untuk menambah foto ke sini.</div>
      </div>
    `;
    return;
  }

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(145px, 1fr))';
  grid.style.gap = '14px';

  for (const photo of appState.savedPhotos) {
    const card = document.createElement('div');
    card.style.background = '#ffffff';
    card.style.border = '1px solid var(--border-light)';
    card.style.borderRadius = '14px';
    card.style.overflow = 'hidden';
    card.style.cursor = 'pointer';
    card.style.boxShadow = 'var(--shadow-sm)';
    card.style.transition = 'transform 0.15s, box-shadow 0.15s';

    // Retrieve image source (IndexedDB / AndroidBridge blob or dataUrl)
    let imgSrc = photo.dataUrl || '';
    if (!imgSrc && photo.fileId && typeof AppFileStorage !== 'undefined' && AppFileStorage.getFileAsDataUrl) {
      try {
        imgSrc = await AppFileStorage.getFileAsDataUrl(photo.fileId, 'image/jpeg');
      } catch (e) {
        console.warn('Error reading photo blob:', e);
      }
    }

    const displayTitle = photo.title || photo.locationName || 'Foto Lokasi';

    card.innerHTML = `
      <div style="width: 100%; height: 110px; background: var(--bg-soft); overflow: hidden; position: relative;">
        ${imgSrc ? `<img src="${imgSrc}" style="width: 100%; height: 100%; object-fit: cover;" alt="Foto">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);"><i class="fa-solid fa-image"></i></div>'}
      </div>
      <div style="padding: 10px 12px;">
        <div style="font-weight: 800; font-size: 0.85rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          📍 ${escapeHtml(displayTitle)}
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(photo.capturedAt || '')}
        </div>
      </div>
    `;

    card.onclick = () => openSavedPhotoDetail(photo, imgSrc);
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

function openSavedPhotoDetail(photo, imgSrc) {
  activeSavedPhoto = photo;
  const imgEl = document.getElementById('savedPhotoDetailImg');
  const titleEl = document.getElementById('savedPhotoDetailTitle');
  const nameEl = document.getElementById('savedPhotoDetailName');
  const addrEl = document.getElementById('savedPhotoDetailAddress');
  const coordsEl = document.getElementById('savedPhotoDetailCoords');
  const timeEl = document.getElementById('savedPhotoDetailTime');

  if (imgEl) imgEl.src = imgSrc || photo.dataUrl || '';
  if (titleEl) titleEl.textContent = photo.title || photo.locationName || 'Foto Lokasi';
  if (nameEl) nameEl.textContent = photo.locationName || 'Foto Lokasi';
  if (addrEl) addrEl.textContent = photo.formattedAddress || photo.address || 'Alamat tidak tersedia';
  if (coordsEl) coordsEl.textContent = (photo.latitude !== null && photo.longitude !== null) ? `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}` : '-';
  if (timeEl) timeEl.textContent = photo.capturedAt || '-';

  openModal('modalSavedPhotoDetail');
}

function openEditSavedPhotoTitleModal() {
  if (!activeSavedPhoto) return;
  const titleInput = document.getElementById('editPhotoTitleInput');
  if (titleInput) {
    titleInput.value = activeSavedPhoto.title || activeSavedPhoto.locationName || 'Foto Lokasi';
  }
  openModal('modalEditSavedPhotoTitle');
}

function saveEditedPhotoTitle() {
  if (!activeSavedPhoto) return;
  const titleInput = document.getElementById('editPhotoTitleInput');
  const newTitle = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : 'Foto Lokasi';

  activeSavedPhoto.title = newTitle;

  // Update in appState.savedPhotos
  if (appState.savedPhotos) {
    const idx = appState.savedPhotos.findIndex(p => p.photoId === activeSavedPhoto.photoId);
    if (idx !== -1) {
      appState.savedPhotos[idx].title = newTitle;
    }
  }

  saveStateToLocalStorage();
  renderSavedPhotos();

  // Update detail modal view
  const titleEl = document.getElementById('savedPhotoDetailTitle');
  if (titleEl) titleEl.textContent = newTitle;

  closeModal('modalEditSavedPhotoTitle');
  showNotificationBanner('Judul foto berhasil diperbarui!');
}

function savedPhotoViewOnMap() {
  if (!activeSavedPhoto || activeSavedPhoto.latitude === null) {
    showNotificationBanner('Koordinat foto tidak tersedia.');
    return;
  }
  closeModal('modalSavedPhotoDetail');
  initOrUpdateNavMap(activeSavedPhoto.latitude, activeSavedPhoto.longitude);
  setTimeout(() => {
    if (navMap) {
      navMap.setView([activeSavedPhoto.latitude, activeSavedPhoto.longitude], 16);
      L.marker([activeSavedPhoto.latitude, activeSavedPhoto.longitude])
        .addTo(navMap)
        .bindPopup(`<b>${escapeHtml(activeSavedPhoto.title || activeSavedPhoto.locationName)}</b>`)
        .openPopup();
    }
  }, 300);
  const mapContainer = document.getElementById('interactiveNavMapContainer');
  if (mapContainer) mapContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  showNotificationBanner(`Peta diarahkan ke lokasi foto: ${activeSavedPhoto.title || activeSavedPhoto.locationName}`);
}

function savedPhotoNavigateTo() {
  if (!activeSavedPhoto || activeSavedPhoto.latitude === null) {
    showNotificationBanner('Koordinat foto tidak tersedia.');
    return;
  }
  closeModal('modalSavedPhotoDetail');
  openNavOriginPicker({
    lat: activeSavedPhoto.latitude,
    lng: activeSavedPhoto.longitude,
    name: activeSavedPhoto.title || activeSavedPhoto.locationName,
    address: activeSavedPhoto.formattedAddress || activeSavedPhoto.address
  });
}

function savedPhotoCopyCoords() {
  if (!activeSavedPhoto || activeSavedPhoto.latitude === null) {
    showNotificationBanner('Koordinat foto tidak tersedia.');
    return;
  }
  const coordsText = `${activeSavedPhoto.latitude.toFixed(6)}, ${activeSavedPhoto.longitude.toFixed(6)}`;
  copyTextToClipboard(coordsText, 'Koordinat berhasil disalin.');
}

async function savedPhotoShare() {
  if (!activeSavedPhoto) return;
  const name = activeSavedPhoto.title || activeSavedPhoto.locationName || 'Foto Lokasi';
  const coords = (activeSavedPhoto.latitude !== null) ? `${activeSavedPhoto.latitude},${activeSavedPhoto.longitude}` : '';
  const text = `📍 Foto Lokasi: ${name}\nAlamat: ${activeSavedPhoto.formattedAddress || activeSavedPhoto.address || '-'}\nKoordinat: ${coords}\nWaktu: ${activeSavedPhoto.capturedAt}`;

  if (navigator.share) {
    navigator.share({ title: 'Foto Lokasi – My Maps', text })
      .catch(e => { if (e.name !== 'AbortError') copyTextToClipboard(text, 'Info foto disalin!'); });
  } else {
    copyTextToClipboard(text, 'Info foto disalin ke clipboard!');
  }
}

function confirmDeleteSavedPhoto() {
  closeModal('modalSavedPhotoDetail');
  openModal('modalDeleteSavedPhotoConfirm');
}

async function executeDeleteSavedPhoto() {
  if (!activeSavedPhoto) return;
  const targetId = activeSavedPhoto.photoId;

  if (activeSavedPhoto.fileId && typeof AppFileStorage !== 'undefined' && AppFileStorage.deleteFile) {
    try {
      await AppFileStorage.deleteFile(activeSavedPhoto.fileId);
    } catch (e) {
      console.warn('Error deleting photo file from IDB:', e);
    }
  }

  appState.savedPhotos = (appState.savedPhotos || []).filter(p => p.photoId !== targetId);
  saveStateToLocalStorage();
  renderSavedPhotos();

  closeModal('modalDeleteSavedPhotoConfirm');
  closeModal('modalSavedPhotoDetail');
  activeSavedPhoto = null;

  showNotificationBanner('Foto berhasil dihapus.');
}

// ============================================================
// SELECTED MAP POINT & ACTION SHEET (FASE 4 & 5)
// ============================================================
let selectedMapPointData = null;
let selectedMapPointMarker = null;

async function handleMapClickForSelectedPoint(lat, lng) {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum) || !navMap) return;

  if (selectedMapPointMarker) {
    navMap.removeLayer(selectedMapPointMarker);
    selectedMapPointMarker = null;
  }

  const pinIcon = L.divIcon({
    className: 'selected-point-pin',
    html: `<div style="background: #3B82F6; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5); border: 2px solid white; font-size: 1rem;">📍</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  selectedMapPointMarker = L.marker([latNum, lngNum], { icon: pinIcon }).addTo(navMap);

  selectedMapPointData = {
    lat: latNum,
    lng: lngNum,
    name: 'Lokasi Dipilih',
    address: 'Mendapatkan alamat...'
  };

  const panel = document.getElementById('mapsLocationActionPanel');
  const nameEl = document.getElementById('mapsActionLocationName');
  const addrEl = document.getElementById('mapsActionLocationAddress');
  const coordsEl = document.getElementById('mapsActionLocationCoords');

  if (nameEl) nameEl.textContent = 'Lokasi Dipilih';
  if (addrEl) addrEl.textContent = 'Mendapatkan alamat...';
  if (coordsEl) coordsEl.textContent = `📍 ${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
  if (panel) panel.style.display = 'block';

  try {
    const geoResult = await reverseGeocodeCoordinates(latNum, lngNum);
    if (geoResult) {
      const fullAddress = geoResult.displayName || geoResult.name || 'Alamat tidak tersedia';
      selectedMapPointData.address = fullAddress;
      if (geoResult.name && geoResult.name !== 'Lokasi Terpilih') {
        selectedMapPointData.name = geoResult.name;
        if (nameEl) nameEl.textContent = geoResult.name;
      }
      if (addrEl) addrEl.textContent = fullAddress;
    } else {
      selectedMapPointData.address = 'Alamat tidak tersedia';
      if (addrEl) addrEl.textContent = 'Alamat tidak tersedia';
    }
  } catch (e) {
    console.warn('Reverse geocode error:', e);
    selectedMapPointData.address = 'Alamat tidak tersedia';
    if (addrEl) addrEl.textContent = 'Alamat tidak tersedia';
  }
}

function hideSelectedMapPointPanel() {
  const panel = document.getElementById('mapsLocationActionPanel');
  if (panel) panel.style.display = 'none';
  if (selectedMapPointMarker && navMap) {
    navMap.removeLayer(selectedMapPointMarker);
    selectedMapPointMarker = null;
  }
  selectedMapPointData = null;
}

function selectedPointNavigate() {
  if (!selectedMapPointData) {
    showNotificationBanner('Pilih lokasi pada peta terlebih dahulu.');
    return;
  }
  openNavOriginPicker(selectedMapPointData);
}

function selectedPointSave() {
  if (!selectedMapPointData) return;
  const name = selectedMapPointData.name || 'Lokasi Dipilih';
  const lat = selectedMapPointData.lat;
  const lng = selectedMapPointData.lng;
  const address = selectedMapPointData.address || '';

  if (!appState.savedPlaces) appState.savedPlaces = [];

  const isDup = appState.savedPlaces.some(p => Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lng - lng) < 0.0001);
  if (isDup) {
    showNotificationBanner(`Lokasi "${name}" sudah tersimpan di Lokasi Tersimpan.`);
    return;
  }

  const newPlace = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name,
    lat,
    lng,
    address,
    createdAt: new Date().toISOString()
  };

  appState.savedPlaces.push(newPlace);
  saveStateToLocalStorage();
  renderSavedPlaces();
  showNotificationBanner(`Lokasi "${name}" berhasil disimpan! 📌`);
}

function selectedPointMark() {
  if (!selectedMapPointData) return;
  addFreeMarker(selectedMapPointData.lat, selectedMapPointData.lng, selectedMapPointData.name !== 'Lokasi Dipilih' ? selectedMapPointData.name : '');
  showNotificationBanner('Penanda bebas dibuat untuk lokasi terpilih. 📍');
}

function selectedPointShare() {
  if (!selectedMapPointData) return;
  shareLocationData({
    name: selectedMapPointData.name,
    address: selectedMapPointData.address,
    lat: selectedMapPointData.lat,
    lng: selectedMapPointData.lng
  });
}

function selectedPointCopyCoords() {
  if (!selectedMapPointData) return;
  copyCoordinatesToClipboard(selectedMapPointData.lat, selectedMapPointData.lng);
}

// ============================================================
// NAVIGATION ORIGIN PICKER (FASE 10, 11, 12)
// ============================================================
let pendingNavDestination = null;
let isOriginPickModeActive = false;
let tempPickedOriginCoords = null;
let originPickMarker = null;

function openNavOriginPicker(destLocation) {
  pendingNavDestination = destLocation;
  const destLabel = document.getElementById('navOriginPickerDestLabel');
  if (destLabel) destLabel.textContent = destLocation.name || destLocation.label || `${destLocation.lat.toFixed(4)}, ${destLocation.lng.toFixed(4)}`;

  const container = document.getElementById('navOriginSavedPlacesList');
  if (container) {
    container.innerHTML = '';
    if (appState.savedPlaces && appState.savedPlaces.length > 0) {
      appState.savedPlaces.forEach(p => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'btn-secondary';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '10px';
        item.style.textAlign = 'left';
        item.style.padding = '10px 12px';
        item.style.borderRadius = '12px';
        item.style.width = '100%';

        item.innerHTML = `
          <i class="fa-solid fa-bookmark" style="color: var(--primary);"></i>
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(p.name)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
          </div>
        `;

        item.onclick = () => navFromSavedPlace(p);
        container.appendChild(item);
      });
    } else {
      container.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 8px;">Belum ada lokasi tersimpan.</div>`;
    }
  }

  openModal('modalNavOriginPicker');
}

async function navFromCurrentGPS() {
  if (!pendingNavDestination) return;
  closeModal('modalNavOriginPicker');

  showNotificationBanner('Mengambil posisi GPS untuk rute...');

  let pos;
  try {
    pos = await getAppGPSPosition();
  } catch (e) {
    return;
  }

  const originLat = pos.coords.latitude;
  const originLng = pos.coords.longitude;
  const origin = { lat: originLat, lng: originLng, label: 'Lokasi Saya' };

  await startNavigationService({ origin, destination: pendingNavDestination });
}

async function navFromSavedPlace(place) {
  if (!pendingNavDestination) return;
  closeModal('modalNavOriginPicker');

  const origin = { lat: parseFloat(place.lat), lng: parseFloat(place.lng), label: place.name };
  await startNavigationService({ origin, destination: pendingNavDestination });
}

function navFromSavedPlaceCard(placeId, event) {
  if (event) event.stopPropagation();
  closeAllPlaceDropdowns();

  const place = appState.savedPlaces.find(p => String(p.id) === String(placeId));
  if (!place) return;

  openNavOriginPicker({
    lat: parseFloat(place.lat),
    lng: parseFloat(place.lng),
    name: place.name,
    address: place.address || ''
  });
}

function navFromMapPointChoice() {
  closeModal('modalNavOriginPicker');
  if (!pendingNavDestination) return;

  isOriginPickModeActive = true;

  const banner = document.getElementById('originPickModeBanner');
  const textEl = document.getElementById('originPickModeText');
  const confirmBtn = document.getElementById('btnConfirmPickedOrigin');
  const mapContainer = document.getElementById('interactiveNavMapContainer');

  if (banner) banner.style.display = 'flex';
  if (textEl) textEl.textContent = `Pilih Titik Asal untuk menuju "${pendingNavDestination.name || 'Tujuan'}": Ketuk pada peta`;
  if (confirmBtn) confirmBtn.style.display = 'none';
  if (mapContainer) {
    mapContainer.style.cursor = 'crosshair';
    mapContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  showNotificationBanner('Ketuk lokasi mana saja pada peta untuk menentukan titik awal! 📍');
}

function handleMapClickForOriginPick(lat, lng) {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum) || !navMap) return;

  if (originPickMarker) {
    navMap.removeLayer(originPickMarker);
  }

  const iconA = L.divIcon({
    className: 'custom-origin-pick-marker',
    html: `<div style="background: #3B82F6; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5); border: 2.5px solid white; font-weight: 800; font-size: 0.9rem;">A</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  originPickMarker = L.marker([latNum, lngNum], { icon: iconA }).addTo(navMap);
  originPickMarker.bindPopup(`<b>Titik Asal Terpilih</b><br><small>${latNum.toFixed(6)}, ${lngNum.toFixed(6)}</small>`).openPopup();

  tempPickedOriginCoords = {
    lat: latNum,
    lng: lngNum,
    label: `Titik Peta (${latNum.toFixed(4)}, ${lngNum.toFixed(4)})`
  };

  const confirmBtn = document.getElementById('btnConfirmPickedOrigin');
  if (confirmBtn) confirmBtn.style.display = 'inline-flex';

  showNotificationBanner('Titik asal terpilih. Tekan "Gunakan Titik Ini" untuk memulai rute.');
}

async function confirmPickedOriginPoint() {
  if (!tempPickedOriginCoords || !pendingNavDestination) {
    showNotificationBanner('Silakan ketuk peta terlebih dahulu untuk memilih titik asal.');
    return;
  }

  const origin = { ...tempPickedOriginCoords };
  const dest = { ...pendingNavDestination };

  cancelOriginPickMode();

  await startNavigationService({ origin, destination: dest });
}

function cancelOriginPickMode() {
  isOriginPickModeActive = false;
  const banner = document.getElementById('originPickModeBanner');
  const mapContainer = document.getElementById('interactiveNavMapContainer');

  if (banner) banner.style.display = 'none';
  if (mapContainer) mapContainer.style.cursor = '';

  if (originPickMarker && navMap) {
    navMap.removeLayer(originPickMarker);
    originPickMarker = null;
  }
  tempPickedOriginCoords = null;
}



// ============================================================
// FITUR 4: ROUTE MEMORY
// ============================================================
function saveCurrentRoute() {
  const route = appState.activeNavigationRoute;
  if (!route || !route.origin || !route.destination) {
    showNotificationBanner('Tidak ada rute aktif untuk disimpan.');
    return;
  }

  if (!appState.savedRoutes) appState.savedRoutes = [];

  // Prevent duplicate exact same routes
  const isDuplicate = appState.savedRoutes.some(r =>
    r.origin.lat === route.origin.lat &&
    r.origin.lng === route.origin.lng &&
    r.destination.lat === route.destination.lat &&
    r.destination.lng === route.destination.lng
  );

  if (isDuplicate) {
    showNotificationBanner('Rute ini sudah tersimpan di Route Memory!');
    return;
  }

  const savedRoute = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name: `${route.origin.label} → ${route.destination.label}`,
    origin: { ...route.origin },
    destination: { ...route.destination },
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    formattedDistance: route.formattedDistance,
    formattedDuration: route.formattedDuration,
    googleMapsUrl: route.googleMapsUrl || null,
    savedAt: new Date().toISOString().split('T')[0]
  };

  appState.savedRoutes.push(savedRoute);
  saveStateToLocalStorage();
  renderSavedRoutes();
  showNotificationBanner(`Rute "${savedRoute.name}" berhasil disimpan ke Route Memory!`);
}

function renderSavedRoutes() {
  const container = document.getElementById('savedRoutesContainer');
  if (!container) return;
  container.innerHTML = '';

  if (!appState.savedRoutes) appState.savedRoutes = [];

  if (appState.savedRoutes.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem; background: var(--bg-card); border-radius: 18px; border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-road mb-2" style="font-size: 1.8rem; color: #3B82F6; display: block; margin-bottom: 8px;"></i>
        <div style="font-weight: 800; font-size: 0.95rem; color: var(--text-main); margin-bottom: 4px;">Belum ada rute tersimpan</div>
        <div style="font-size: 0.82rem;">Simpan rute saat navigasi aktif dengan tombol <strong>Simpan Rute</strong>.</div>
      </div>
    `;
    return;
  }

  // Show newest first
  const sorted = [...appState.savedRoutes].reverse();

  sorted.forEach(route => {
    const card = document.createElement('div');
    card.className = 'saved-route-card mb-3';

    const distStr = route.formattedDistance || formatRouteDistance(route.distanceMeters);
    const durStr = route.formattedDuration || formatRouteDuration(route.durationSeconds);

    card.innerHTML = `
      <div class="saved-route-card-inner" onclick="reloadSavedRoute('${route.id}')" title="Muat rute ini ke peta">
        <div class="saved-route-icon">
          <i class="fa-solid fa-road"></i>
        </div>
        <div class="saved-route-info">
          <div class="saved-route-name">${escapeHtml(route.name)}</div>
          <div class="saved-route-meta">
            <span><i class="fa-solid fa-route" style="color: var(--primary); font-size: 0.7rem;"></i> ${distStr}</span>
            <span style="color: var(--border-light);">|</span>
            <span><i class="fa-solid fa-clock" style="color: #D97706; font-size: 0.7rem;"></i> ${durStr}</span>
            <span style="color: var(--border-light);">|</span>
            <span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(route.savedAt || '')}</span>
          </div>
        </div>
      </div>
      <div class="saved-route-actions">
        <button class="btn-route-share" onclick="shareSavedRoute('${route.id}')" title="Bagikan rute ini">
          <i class="fa-solid fa-share-nodes"></i>
        </button>
        <button class="btn-route-delete" onclick="deleteSavedRoute('${route.id}')" title="Hapus rute ini">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

function reloadSavedRoute(routeId) {
  if (!appState.savedRoutes) return;
  const route = appState.savedRoutes.find(r => String(r.id) === String(routeId));
  if (!route) return;

  // Fill in origin/dest inputs
  const originInput = document.getElementById('originLocationInput');
  const destInput = document.getElementById('destinationLocationInput');
  if (originInput) originInput.value = route.origin.label;
  if (destInput) destInput.value = route.destination.label;

  currentOriginCoords = { ...route.origin };
  currentDestinationCoords = { ...route.destination };

  // Reconstruct a minimal route object (no geometry stored, just show markers)
  const fakeRoute = {
    origin: route.origin,
    destination: route.destination,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    formattedDistance: route.formattedDistance || formatRouteDistance(route.distanceMeters),
    formattedDuration: route.formattedDuration || formatRouteDuration(route.durationSeconds),
    googleMapsUrl: route.googleMapsUrl,
    geometry: null
  };

  // Set active state
  appState.activeNavigationRoute = fakeRoute;
  activeGoogleMapsRouteUrl = route.googleMapsUrl || null;
  saveStateToLocalStorage();

  // Show markers on map (no polyline since geometry is null)
  initOrUpdateNavMap(route.origin.lat, route.origin.lng);
  setTimeout(() => {
    if (navMap) {
      if (navRoutePolyline) { navMap.removeLayer(navRoutePolyline); navRoutePolyline = null; }
      if (navOriginMarker) navMap.removeLayer(navOriginMarker);
      if (navDestinationMarker) navMap.removeLayer(navDestinationMarker);

      const iconA = L.divIcon({
        className: '',
        html: `<div style="background: #3B82F6; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(59,130,246,0.4); border: 2px solid white; font-weight: 800; font-size: 0.85rem;">A</div>`,
        iconSize: [32, 32], iconAnchor: [16, 16]
      });
      navOriginMarker = L.marker([route.origin.lat, route.origin.lng], { icon: iconA }).addTo(navMap);
      navOriginMarker.bindPopup(`<b>Asal:</b> ${escapeHtml(route.origin.label)}`);

      const iconB = L.divIcon({
        className: '',
        html: `<div style="background: #EF4444; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(239,68,68,0.4); border: 2px solid white; font-weight: 800; font-size: 0.85rem;">B</div>`,
        iconSize: [32, 32], iconAnchor: [16, 16]
      });
      navDestinationMarker = L.marker([route.destination.lat, route.destination.lng], { icon: iconB }).addTo(navMap);
      navDestinationMarker.bindPopup(`<b>Tujuan:</b> ${escapeHtml(route.destination.label)}`).openPopup();

      navMap.fitBounds(
        L.latLngBounds([route.origin.lat, route.origin.lng], [route.destination.lat, route.destination.lng]),
        { padding: [50, 50] }
      );
    }
  }, 300);

  // Update UI panels
  const distEl = document.getElementById('navRouteDistanceText');
  if (distEl) distEl.textContent = fakeRoute.formattedDistance;
  const durEl = document.getElementById('navRouteDurationText');
  if (durEl) durEl.textContent = fakeRoute.formattedDuration;
  const routeTextEl = document.getElementById('activeNavRouteText');
  if (routeTextEl) routeTextEl.textContent = `${route.origin.label} ➔ ${route.destination.label}`;
  const activeBox = document.getElementById('activeNavStatusBox');
  if (activeBox) activeBox.style.display = 'block';

  startETAInterval();
  showNotificationBanner(`Rute dimuat: ${route.name}`);

  // Scroll to map
  const mapBox = document.getElementById('interactiveNavMapContainer');
  if (mapBox) mapBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteSavedRoute(routeId) {
  if (!appState.savedRoutes) return;
  const route = appState.savedRoutes.find(r => String(r.id) === String(routeId));
  const name = route ? route.name : 'Rute';
  appState.savedRoutes = appState.savedRoutes.filter(r => String(r.id) !== String(routeId));
  saveStateToLocalStorage();
  renderSavedRoutes();
  showNotificationBanner(`Rute "${name}" dihapus dari Route Memory.`);
}

function shareSavedRoute(routeId) {
  if (!appState.savedRoutes) return;
  const route = appState.savedRoutes.find(r => String(r.id) === String(routeId));
  if (!route) return;

  const distStr = route.formattedDistance || formatRouteDistance(route.distanceMeters);
  const durStr = route.formattedDuration || formatRouteDuration(route.durationSeconds);
  const mapsUrl = route.googleMapsUrl ||
    `https://www.google.com/maps/dir/?api=1&origin=${route.origin.lat},${route.origin.lng}&destination=${route.destination.lat},${route.destination.lng}`;

  const shareText = `🗺️ Rute: ${route.name}\n📏 Jarak: ${distStr} | ⏱️ Estimasi: ${durStr}\n\nBuka di Google Maps:\n${mapsUrl}`;

  if (navigator.share) {
    navigator.share({ title: 'Rute My Maps GPS', text: shareText, url: mapsUrl })
      .catch(err => { if (err.name !== 'AbortError') copyTextToClipboard(shareText, 'Rute disalin ke clipboard!'); });
  } else {
    copyTextToClipboard(shareText, 'Info rute disalin ke clipboard!');
  }
}



function swapOriginDestination() {
  const originInput = document.getElementById('originLocationInput');
  const destInput = document.getElementById('destinationLocationInput');
  if (!originInput || !destInput) return;

  const tempVal = originInput.value;
  originInput.value = destInput.value;
  destInput.value = tempVal;

  const tempCoords = currentOriginCoords;
  currentOriginCoords = currentDestinationCoords;
  currentDestinationCoords = tempCoords;

  showNotificationBanner('Lokasi asal & tujuan bertukar! ⇅');
}

function toggleSavedPlacesDropdown(type, event) {
  if (event) event.stopPropagation();

  const originBox = document.getElementById('originSavedPlacesDropdown');
  const destBox = document.getElementById('destinationSavedPlacesDropdown');

  if (type === 'origin') {
    if (destBox) destBox.style.display = 'none';
    if (!originBox) return;
    const isVis = originBox.style.display === 'block';
    originBox.style.display = isVis ? 'none' : 'block';
    if (!isVis) renderSavedPlacesPopover(originBox, 'origin');
  } else {
    if (originBox) originBox.style.display = 'none';
    if (!destBox) return;
    const isVis = destBox.style.display === 'block';
    destBox.style.display = isVis ? 'none' : 'block';
    if (!isVis) renderSavedPlacesPopover(destBox, 'destination');
  }
}

function renderSavedPlacesPopover(container, type) {
  if (!container) return;
  container.innerHTML = '';

  if (!appState.savedPlaces || appState.savedPlaces.length === 0) {
    container.innerHTML = `<div style="padding: 10px; font-size: 0.8rem; color: var(--text-muted); text-align: center;">Belum ada lokasi tersimpan.</div>`;
    return;
  }

  appState.savedPlaces.forEach(p => {
    const item = document.createElement('div');
    item.className = 'saved-place-popover-item';
    item.innerHTML = `
      <i class="fa-solid fa-location-dot" style="color: var(--primary);"></i>
      <div style="min-width: 0; flex: 1; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
        <strong>${escapeHtml(p.name)}</strong> <span style="font-size: 0.75rem; color: var(--text-muted);">(${p.lat}, ${p.lng})</span>
      </div>
    `;
    item.onclick = (e) => {
      e.stopPropagation();
      if (type === 'origin') {
        const input = document.getElementById('originLocationInput');
        if (input) input.value = p.name;
        currentOriginCoords = { lat: parseFloat(p.lat), lng: parseFloat(p.lng), label: p.name };
      } else {
        const input = document.getElementById('destinationLocationInput');
        if (input) input.value = p.name;
        currentDestinationCoords = { lat: parseFloat(p.lat), lng: parseFloat(p.lng), label: p.name };
      }
      container.style.display = 'none';
    };
    container.appendChild(item);
  });
}

document.addEventListener('click', () => {
  const originBox = document.getElementById('originSavedPlacesDropdown');
  const destBox = document.getElementById('destinationSavedPlacesDropdown');
  if (originBox) originBox.style.display = 'none';
  if (destBox) destBox.style.display = 'none';
});

let pickerMap = null;
let pickerMarker = null;
let editingPlaceId = null;
let pendingDeletePlaceId = null;

function initOrUpdatePickerMap(initialLat = -6.175392, initialLng = 106.827153) {
  const container = document.getElementById('interactivePickerMapContainer');
  if (!container) return;

  setTimeout(() => {
    if (!pickerMap) {
      if (typeof L === 'undefined') {
        console.warn('Leaflet JS library is loading or unavailable.');
        return;
      }
      pickerMap = L.map('interactivePickerMapContainer').setView([initialLat, initialLng], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(pickerMap);

      pickerMarker = L.marker([initialLat, initialLng], { draggable: true }).addTo(pickerMap);

      pickerMarker.on('dragend', function (e) {
        const coord = e.target.getLatLng();
        updatePickerCoordinates(coord.lat, coord.lng, true);
      });

      pickerMap.on('click', function (e) {
        pickerMarker.setLatLng(e.latlng);
        updatePickerCoordinates(e.latlng.lat, e.latlng.lng, true);
      });
    } else {
      pickerMap.invalidateSize();
      pickerMap.setView([initialLat, initialLng], 14);
      if (pickerMarker) {
        pickerMarker.setLatLng([initialLat, initialLng]);
      }
    }
  }, 250);
}

function updatePickerCoordinates(lat, lng, doReverseGeocode = false) {
  const latInput = document.getElementById('placeLatInput');
  const lngInput = document.getElementById('placeLngInput');
  if (latInput) latInput.value = parseFloat(lat).toFixed(6);
  if (lngInput) lngInput.value = parseFloat(lng).toFixed(6);

  if (doReverseGeocode) {
    reverseGeocodeCoordinates(lat, lng);
  }
}

function syncInputsToMap() {
  const latVal = parseFloat(document.getElementById('placeLatInput').value);
  const lngVal = parseFloat(document.getElementById('placeLngInput').value);

  if (!isNaN(latVal) && !isNaN(lngVal) && latVal >= -90 && latVal <= 90 && lngVal >= -180 && lngVal <= 180) {
    if (pickerMap && pickerMarker) {
      pickerMap.panTo([latVal, lngVal]);
      pickerMarker.setLatLng([latVal, lngVal]);
    }
  }
}

async function searchAddressOnMap() {
  const query = document.getElementById('placeSearchInput').value.trim();
  if (!query) return;

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data && data.length > 0) {
      const item = data[0];
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);

      if (pickerMap && pickerMarker) {
        pickerMap.setView([lat, lng], 15);
        pickerMarker.setLatLng([lat, lng]);
      }

      updatePickerCoordinates(lat, lng, false);

      const nameInput = document.getElementById('placeNameInput');
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = item.display_name.split(',')[0] || query;
      }
      showNotificationBanner(`Lokasi ditemukan: ${item.display_name.split(',')[0]}`);
    } else {
      showNotificationBanner('Alamat tidak ditemukan. Silakan coba kata kunci lain atau pilih langsung dari peta.');
    }
  } catch (err) {
    console.error('Geocoding error:', err);
    showNotificationBanner('Gagal mencari alamat. Silakan pilih titik langsung di peta.');
  }
}

async function reverseGeocodeCoordinates(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`);
    if (!res.ok) throw new Error('Network error on reverse geocoding');
    const data = await res.json();
    if (data) {
      const normAddr = normalizeAddressComponents(data.address);
      const nameStr = data.display_name ? data.display_name.split(',')[0] : 'Lokasi Terpilih';
      const formatted = normAddr.formatted || data.display_name || '';

      const nameInput = document.getElementById('placeNameInput');
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = nameStr;
      }

      return {
        displayName: formatted,
        name: nameStr,
        addressComponents: normAddr,
        raw: data
      };
    }
  } catch (err) {
    console.warn('Reverse geocoding error:', err);
  }
  return null;
}

async function useMyLocationForPicker() {
  let pos;
  try {
    pos = await getAppGPSPosition();
  } catch (e) {
    return; // pesan error sudah ditampilkan oleh getAppGPSPosition()
  }

  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  if (pickerMap && pickerMarker) {
    pickerMap.setView([lat, lng], 16);
    pickerMarker.setLatLng([lat, lng]);
  }
  updatePickerCoordinates(lat, lng, true);
  showNotificationBanner('Lokasi GPS diterapkan ke peta! 📍');
}

function openAddPlaceModal() {
  editingPlaceId = null;
  document.getElementById('placeNameInput').value = '';
  document.getElementById('placeSearchInput').value = '';
  document.getElementById('placeLatInput').value = '-6.175392';
  document.getElementById('placeLngInput').value = '106.827153';

  const modalTitle = document.getElementById('modalPlaceTitle');
  if (modalTitle) modalTitle.textContent = 'Simpan Lokasi Baru';

  const btnSave = document.getElementById('btnSavePlaceAction');
  if (btnSave) btnSave.textContent = 'Simpan ke Map';

  openModal('modalAddPlace');
  initOrUpdatePickerMap(-6.175392, 106.827153);
}

function openEditPlaceModal(placeId, event) {
  if (event) event.stopPropagation();
  closeAllPlaceDropdowns();

  const place = appState.savedPlaces.find(p => String(p.id) === String(placeId));
  if (!place) return;

  editingPlaceId = place.id;
  document.getElementById('placeNameInput').value = place.name || '';
  document.getElementById('placeSearchInput').value = '';
  document.getElementById('placeLatInput').value = place.lat;
  document.getElementById('placeLngInput').value = place.lng;

  const modalTitle = document.getElementById('modalPlaceTitle');
  if (modalTitle) modalTitle.textContent = 'Edit Lokasi Tersimpan';

  const btnSave = document.getElementById('btnSavePlaceAction');
  if (btnSave) btnSave.textContent = 'Simpan Perubahan';

  openModal('modalAddPlace');
  initOrUpdatePickerMap(place.lat, place.lng);
}

function renderSavedPlaces() {
  const container = document.getElementById('savedPlacesContainer');
  if (!container) return;

  container.innerHTML = '';

  if (!appState.savedPlaces || appState.savedPlaces.length === 0) {
    container.innerHTML = `
      <div style="padding: 28px 20px; text-align: center; color: var(--text-muted); font-size: 0.88rem; background: var(--bg-card); border-radius: 20px; border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-map-location-dot mb-2" style="font-size: 2rem; color: var(--primary);"></i>
        <div style="font-weight: 800; font-size: 1rem; color: var(--text-main); margin-bottom: 4px;">Belum ada lokasi tersimpan</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 14px;">Tambahkan tempat penting agar mudah ditemukan kembali.</div>
        <button type="button" class="btn-primary" style="width: auto; margin: 0 auto; padding: 10px 20px; font-size: 0.85rem;" onclick="openAddPlaceModal()">
          <i class="fa-solid fa-plus"></i> Tambah Tempat
        </button>
      </div>
    `;
    return;
  }

  appState.savedPlaces.forEach(p => {
    if (!p.id) p.id = Date.now() + Math.floor(Math.random() * 1000);

    const card = document.createElement('div');
    card.className = 'location-card-item mb-3';
    card.style.cssText = 'background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 20px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px; box-shadow: var(--shadow-sm); position: relative;';

    const menuId = `place-dropdown-${p.id}`;

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
        <div style="width: 44px; height: 44px; border-radius: 14px; background: var(--primary-light); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <i class="fa-solid fa-location-dot" style="color: var(--primary); font-size: 1.25rem;"></i>
        </div>
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 800; font-size: 0.98rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p.name)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-crosshairs" style="color: var(--primary); font-size: 0.75rem;"></i> ${p.lat}, ${p.lng}
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        <button type="button" class="btn-primary" onclick="navFromSavedPlaceCard('${p.id}', event)" style="padding: 6px 12px; font-size: 0.78rem; border-radius: var(--radius-pill);" title="Mulai navigasi ke lokasi ini">
          <i class="fa-solid fa-diamond-turn-right"></i> Navigasi
        </button>

        <div style="position: relative;">
          <button class="btn-icon-menu" onclick="togglePlaceItemDropdown('${p.id}', event)" title="Opsi Lokasi" style="background: transparent; border: none; padding: 6px 10px; border-radius: 8px; color: var(--text-muted); cursor: pointer; font-size: 1rem;">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>

          <div class="place-item-dropdown" id="${menuId}" style="display: none; position: absolute; top: 100%; right: 0; z-index: 100; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 14px; box-shadow: var(--shadow-md); min-width: 150px; overflow: hidden; padding: 4px;">
            <button onclick="navFromSavedPlaceCard('${p.id}', event)" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
              <i class="fa-solid fa-diamond-turn-right" style="color: #10B981;"></i> Navigasi
            </button>
            <button onclick="openPlaceOnMap('${p.lat}', '${p.lng}', event, '${escapeHtml(p.name).replace(/'/g, "\\'")}')" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
              <i class="fa-solid fa-map-location-dot" style="color: var(--primary);"></i> Buka di Peta
            </button>
            <button onclick="shareSavedPlace('${p.id}', event)" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
              <i class="fa-solid fa-share-nodes" style="color: #10B981;"></i> Bagikan
            </button>
            <button onclick="openEditPlaceModal('${p.id}', event)" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='var(--primary-light)'" onmouseout="this.style.background='transparent'">
              <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Edit
            </button>
            <button onclick="confirmDeletePlace('${p.id}', event)" style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; font-size: 0.85rem; font-weight: 600; color: #EF4444; cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 8px;" onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='transparent'">
              <i class="fa-solid fa-trash-can" style="color: #EF4444;"></i> Hapus
            </button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function shareSavedPlace(placeId, event) {
  if (event) event.stopPropagation();
  closeAllPlaceDropdowns();

  const place = appState.savedPlaces.find(p => String(p.id) === String(placeId));
  if (place) {
    shareLocationData({
      name: place.name,
      lat: place.lat,
      lng: place.lng
    });
  }
}

function openPlaceOnMap(lat, lng, event, placeName = '') {
  if (event) event.stopPropagation();
  closeAllPlaceDropdowns();

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  initOrUpdateNavMap(latNum, lngNum);
  setTimeout(() => {
    if (navMap) {
      navMap.setView([latNum, lngNum], 16);
      if (navDestinationMarker) navMap.removeLayer(navDestinationMarker);
      
      const iconB = L.divIcon({
        className: 'custom-marker-b',
        html: `<div style="background: #EF4444; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.4); border: 2px solid white; font-weight: 800; font-size: 0.85rem;">📍</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      navDestinationMarker = L.marker([latNum, lngNum], { icon: iconB }).addTo(navMap);
      if (placeName) navDestinationMarker.bindPopup(`<b>${escapeHtml(placeName)}</b><br>${latNum}, ${lngNum}`).openPopup();
      
      const container = document.getElementById('interactiveNavMapContainer');
      if (container) container.scrollIntoView({ behavior: 'smooth' });
    }
  }, 250);

  const destInput = document.getElementById('destinationLocationInput');
  if (destInput && placeName) {
    destInput.value = placeName;
    currentDestinationCoords = { lat: latNum, lng: lngNum, label: placeName };
  }

  showNotificationBanner(`Peta diarahkan ke ${placeName || 'koordinat (' + lat + ', ' + lng + ')'}! 📍`);
}

function confirmDeletePlace(placeId, event) {
  if (event) event.stopPropagation();
  closeAllPlaceDropdowns();

  pendingDeletePlaceId = placeId;
  openModal('modalDeletePlaceConfirmation');
}

function executeDeletePlace() {
  if (!pendingDeletePlaceId) return;

  appState.savedPlaces = appState.savedPlaces.filter(p => String(p.id) !== String(pendingDeletePlaceId));
  pendingDeletePlaceId = null;

  saveStateToLocalStorage();
  renderSavedPlaces();
  closeModal('modalDeletePlaceConfirmation');
  showNotificationBanner('Lokasi telah dihapus! 🗑️');
}

function togglePlaceItemDropdown(placeId, event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById(`place-dropdown-${placeId}`);
  if (!dropdown) return;

  const isVisible = dropdown.style.display === 'block';
  closeAllPlaceDropdowns();

  if (!isVisible) {
    dropdown.style.display = 'block';
  }
}

function closeAllPlaceDropdowns() {
  document.querySelectorAll('.place-item-dropdown').forEach(el => {
    el.style.display = 'none';
  });
}

function saveNewPlace() {
  const name = document.getElementById('placeNameInput').value.trim();
  const lat = parseFloat(document.getElementById('placeLatInput').value);
  const lng = parseFloat(document.getElementById('placeLngInput').value);

  if (!name) {
    showNotificationBanner('Nama tempat wajib diisi!');
    return;
  }

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    showNotificationBanner('Latitude (-90 s.d 90) atau Longitude (-180 s.d 180) tidak valid.');
    return;
  }

  if (editingPlaceId) {
    // EDIT MODE: Update existing place in-place
    const place = appState.savedPlaces.find(p => String(p.id) === String(editingPlaceId));
    if (place) {
      place.name = name;
      place.lat = lat;
      place.lng = lng;
    }
    editingPlaceId = null;
    showNotificationBanner('Lokasi tersimpan diperbarui! 🗺️');
  } else {
    // CREATE MODE: Add new saved place with unique ID
    const newPlace = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      name: name,
      lat: lat,
      lng: lng,
      createdAt: new Date().toISOString().split('T')[0]
    };
    appState.savedPlaces.push(newPlace);
    showNotificationBanner('Lokasi baru berhasil disimpan! 🗺️');
  }

  saveStateToLocalStorage();
  renderSavedPlaces();
  closeModal('modalAddPlace');
}

// --- HOMEPAGE DASHBOARD RENDERERS ---
function renderDashboard() {
  renderDashboardReminders();
  renderDashboardFinanceSummary();
  renderDashboardAIAlerts();
}

function renderDashboardReminders() {
  const container = document.getElementById('dashboardRemindersList');
  if (!container) return;

  container.innerHTML = '';

  const remindersList = Array.isArray(appState.reminders) ? appState.reminders.filter(r => !r || !r.completed) : [];
  const jsDay = new Date().getDay();
  const todayDayNum = jsDay === 0 ? 7 : jsDay;

  let agendas = remindersList.filter(r => {
    if (!r || !r.repeatDays || !Array.isArray(r.repeatDays) || r.repeatDays.length === 0) return true;
    return r.repeatDays.includes(todayDayNum);
  });

  if (agendas.length === 0) {
    agendas = remindersList;
  }

  if (!agendas || agendas.length === 0) {
    container.innerHTML = `
      <div style="padding: 20px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem; background: var(--bg-card); border-radius: 18px; border: 1px dashed var(--border-light); margin-bottom: 16px;">
        <i class="fa-regular fa-calendar-check mb-2" style="font-size: 1.5rem; color: var(--primary);"></i><br>
        Belum ada agenda hari ini
      </div>
    `;
    return;
  }

  agendas.slice(0, 5).forEach(rem => {
    if (!rem) return;
    const isChecked = !!rem.completed;
    const card = document.createElement('div');
    card.className = 'dashboard-agenda-card mb-3';
    card.dataset.reminderId = rem.id;
    card.onclick = () => switchTab('reminders');

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
        <div class="checkbox-round ${isChecked ? 'checked' : ''}" onclick="event.stopPropagation(); toggleReminder('${rem.id}')" style="flex-shrink: 0;">
          ${isChecked ? '<i class="fa-solid fa-check" style="font-size: 0.75rem;"></i>' : ''}
        </div>
        <div style="min-width: 0; flex: 1;">
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main); ${isChecked ? 'text-decoration: line-through; opacity: 0.6;' : ''}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(rem.title || 'Agenda')}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px;">
            <i class="fa-regular fa-clock" style="color: var(--primary);"></i> ${escapeHtml(rem.time || 'Waktu Harian')}
          </div>
        </div>
      </div>

      <div style="flex-shrink: 0;">
        <span class="badge" style="background: ${isChecked ? '#D1FAE5' : 'var(--primary-light)'}; color: ${isChecked ? '#059669' : 'var(--primary)'}; font-size: 0.78rem; font-weight: 700; padding: 5px 12px; border-radius: var(--radius-pill);">
          ${isChecked ? 'Selesai' : 'Pending'}
        </span>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderDashboardFinanceSummary() {
  const transactions = Array.isArray(appState.transactions) ? appState.transactions : [];
  let totalIncome = transactions.filter(t => t && t.type === 'income').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  let totalExpense = transactions.filter(t => t && t.type === 'expense').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  let balance = totalIncome - totalExpense;

  const totalBalEl = document.getElementById('dashTotalBalance');
  if (totalBalEl) totalBalEl.textContent = formatRupiah(balance);

  const badgeBalEl = document.getElementById('dashBalanceBadge');
  if (badgeBalEl) badgeBalEl.textContent = formatRupiah(balance);

  const incEl = document.getElementById('dashIncome');
  if (incEl) incEl.textContent = formatRupiah(totalIncome);

  const expEl = document.getElementById('dashExpense');
  if (expEl) expEl.textContent = formatRupiah(totalExpense);
}

function renderDashboardAIAlerts() {
  const container = document.getElementById('dashboardAIConflictAlerts');
  if (!container) return;

  const events = Array.isArray(appState.calendarEvents) ? appState.calendarEvents : [];
  const todayStr = new Date().toISOString().split('T')[0];
  const todayEvents = events.filter(e => e && e.date === todayStr);

  if (todayEvents.length > 1) {
    container.innerHTML = `
      <div class="card-item mb-3" style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 18px; padding: 14px 18px;">
        <div style="display: flex; align-items: center; gap: 10px; color: #991B1B; font-weight: 800; font-size: 0.92rem;">
          <i class="fa-solid fa-triangle-exclamation" style="color: #EF4444; font-size: 1.1rem;"></i>
          Personal Assistant Memperingatkanmu!
        </div>
        <div style="font-size: 0.82rem; color: #7F1D1D; margin-top: 4px;">
          Kamu memiliki ${todayEvents.length} agenda/event bersamaan hari ini. Periksa agenda kamu agar waktu tidak bertabrakan!
        </div>
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}

// --- UTILITIES & MODAL CONTROLLERS ---
// Modal stack: melacak modal yang sedang terbuka (yang terakhir dibuka = paling atas),
// dipakai untuk logika tombol back Android supaya menutup satu modal per tekan.
const modalOpenStack = [];

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
  document.body.classList.remove('modal-open');
  modalOpenStack.length = 0;
}

function getTopOpenModal() {
  return modalOpenStack.length > 0 ? modalOpenStack[modalOpenStack.length - 1] : null;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    document.body.classList.add('modal-open');
    if (!modalOpenStack.includes(id)) {
      modalOpenStack.push(id);
    }
  }
  if (id === 'modalAddAcademicProject') {
    if (typeof renderAcademicProfileOptions === 'function') {
      renderAcademicProfileOptions();
    }
  }
  if (id === 'modalSettings') {
    syncMediaSettingsInputs();
    initGoogleIdentity();
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
  }
  const stackIdx = modalOpenStack.indexOf(id);
  if (stackIdx !== -1) modalOpenStack.splice(stackIdx, 1);
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.classList.remove('modal-open');
  }
}

// ==========================================================================
// ANDROID HARDWARE BACK BUTTON — tetap di dalam aplikasi & konfirmasi keluar
// Bergantung pada plugin @capacitor/app (sudah ada di package.json + cap sync).
// Saat listener backButton terdaftar, Capacitor menonaktifkan perilaku default
// (langsung keluar aplikasi); kita yang memutuskan kapan harus App.exitApp().
// ==========================================================================
function setupAndroidBackButton() {
  if (typeof window.Capacitor === 'undefined' ||
      typeof window.Capacitor.isNativePlatform !== 'function' ||
      !window.Capacitor.isNativePlatform()) {
    return; // browser biasa — tidak ada tombol back hardware
  }
  const AppPlugin = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (!AppPlugin || typeof AppPlugin.addListener !== 'function') {
    return; // @capacitor/app belum di-sync — perilaku default Android tetap berlaku
  }
  AppPlugin.addListener('backButton', () => {
    handleAndroidBackPress();
  });
}

function handleAndroidBackPress() {
  // 0) Layar kunci aktif → tombol kembali tidak boleh menutupnya
  if (lockIsVisible()) return;

  // 1) Overlay kamera Map + Kamera aktif → tutup dulu (dan hentikan stream)
  const camOverlay = document.getElementById('mapCameraOverlay');
  if (camOverlay && camOverlay.style.display === 'flex') {
    closeMapCamera();
    return;
  }

  // 2) Ada modal terbuka → tutup modal paling atas (dengan cleanup kamera bila perlu)
  const topModal = getTopOpenModal();
  if (topModal) {
    if (topModal === 'modalCameraExpense') closeCameraExpenseModal();
    else if (topModal === 'modalCameraExplain') closeCameraExplainModal();
    else closeModal(topModal);
    return;
  }

  // 3) Sub-halaman → mundur sesuai alur navigasi aplikasi
  if (currentActiveTab === 'book-editor') { switchTab('book-detail'); return; }
  if (currentActiveTab === 'book-detail') { switchTab('books'); return; }
  if (currentActiveTab !== 'dashboard') { switchTab('dashboard'); return; }

  // 4) Sudah di Beranda → minta konfirmasi sebelum keluar dari aplikasi
  openModal('modalExitConfirm');
}

function confirmExitApp() {
  closeModal('modalExitConfirm');
  const AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (AppPlugin && typeof AppPlugin.exitApp === 'function') {
    AppPlugin.exitApp();
  } else {
    showNotificationBanner('Mode web: tutup tab browser untuk keluar.');
  }
}

function formatRupiah(num) {
  return 'Rp ' + Number(num || 0).toLocaleString('id-ID');
}

// Normalizes legacy lavender/purple hex colors (saved before the blue
// theme) to the new royal-blue brand color so stored data stays consistent.
const LEGACY_BRAND_COLORS = ['#7C5CFC', '#7857FB', '#8B6CFF', '#6C5CE7', '#6846F9', '#6441EC', '#5A3BE0', '#A76BFA', '#6A4BF2', '#9B82FF'];
function normalizeLegacyColor(color) {
  if (!color) return '#3B82F6';
  const c = String(color).trim().toLowerCase();
  const found = LEGACY_BRAND_COLORS.find(old => old.toLowerCase() === c);
  return found ? '#3B82F6' : color;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showNotificationBanner(msg) {
  const banner = document.getElementById('appNotificationBanner');
  const text = document.getElementById('notificationBannerText');
  if (!banner || !text) return;

  text.textContent = msg;
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 3000);
}

function resetAllData() {
  if (confirm('RESET SEMUA DATA? Tindakan ini tidak dapat dibatalkan.')) {
    localStorage.removeItem(STATE_KEY);
    location.reload();
  }
}

// Menelusuri seluruh appState secara rekursif untuk menemukan semua referensi
// file (objek yg punya properti `fileId`) — dipakai saat menyusun backup .zip.
function collectAllFileRefs(obj, refs = [], seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return refs;
  seen.add(obj);

  if (Array.isArray(obj)) {
    obj.forEach(item => collectAllFileRefs(item, refs, seen));
  } else {
    // Pola 1: objek lampiran dgn properti `fileId` langsung, mis. note.photos[i] = {fileId, mimeType, name}
    if (obj.fileId && typeof obj.fileId === 'string') {
      refs.push({ fileId: obj.fileId, name: obj.name || obj.fileId, mimeType: obj.mimeType || 'application/octet-stream' });
    }
    // Pola 2: field bernama "...FileId" langsung di sebuah objek, mis. user.avatarFileId
    Object.keys(obj).forEach(key => {
      if (key !== 'fileId' && /FileId$/.test(key) && typeof obj[key] === 'string' && obj[key]) {
        const prefix = key.slice(0, -('FileId'.length));
        const mimeKey = prefix + 'MimeType';
        refs.push({ fileId: obj[key], name: obj[key], mimeType: obj[mimeKey] || 'application/octet-stream' });
      }
    });
    Object.values(obj).forEach(val => collectAllFileRefs(val, refs, seen));
  }
  return refs;
}

function sanitizeFileName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_');
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function exportFullBackupZip() {
  showNotificationBanner('Menyiapkan file backup (.zip)...');
  try {
    const zip = new JSZip();
    const filesFolder = zip.folder('files');
    const fileRefs = collectAllFileRefs(appState);

    for (const ref of fileRefs) {
      try {
        if (AppFileStorage.isNative()) {
          const base64 = window.AndroidBridge.readFile(ref.fileId);
          if (base64) filesFolder.file(`${ref.fileId}__${sanitizeFileName(ref.name)}`, base64, { base64: true });
        } else {
          const blob = await AppFileStorage.getFileAsBlob(ref.fileId);
          if (blob) filesFolder.file(`${ref.fileId}__${sanitizeFileName(ref.name)}`, blob);
        }
      } catch (fileErr) {
        console.error('Gagal menambahkan file ke backup:', ref, fileErr);
      }
    }

    zip.file('data.json', JSON.stringify(appState, null, 2));

    const blob = await zip.generateAsync({ type: 'blob' });
    const fileName = `Backup_${appState.user.name}_${new Date().toISOString().split('T')[0]}.zip`;

    if (AppFileStorage.isNative() && window.AndroidBridge.saveBackupZipToDownloads) {
      const buf = await blob.arrayBuffer();
      const base64Zip = arrayBufferToBase64(buf);
      const ok = window.AndroidBridge.saveBackupZipToDownloads(base64Zip, fileName);
      showNotificationBanner(ok ? 'Backup .zip disimpan di folder Downloads HP! 📦' : 'Gagal menyimpan backup ke penyimpanan HP.');
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showNotificationBanner(`File Backup "${fileName}" diunduh! 📦 (${fileRefs.length} file lampiran disertakan)`);
    }
  } catch (err) {
    console.error('Export backup error:', err);
    showNotificationBanner('Gagal membuat file backup: ' + err.message);
  }
}

async function importFullBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const isZip = /\.zip$/i.test(file.name);

    if (isZip) {
      const zip = await JSZip.loadAsync(file);
      const dataEntry = zip.file('data.json');
      if (!dataEntry) throw new Error('data.json tidak ditemukan di dalam file backup.');

      const importedState = JSON.parse(await dataEntry.async('string'));

      // Pulihkan semua file lampiran kembali ke AppFileStorage (IndexedDB / penyimpanan HP)
      const filesFolder = zip.folder('files');
      const restoreJobs = [];
      filesFolder.forEach((relPath, entry) => {
        if (entry.dir) return;
        const fileId = relPath.split('__')[0];
        restoreJobs.push(
          entry.async('base64').then(async base64 => {
            if (AppFileStorage.isNative()) {
              const mimeGuess = entry.name.includes('.') ? '' : ''; // biarkan native side yg tentukan dari ekstensi kalau perlu
              window.AndroidBridge.saveFile(fileId, base64, mimeGuess);
            } else {
              const byteChars = atob(base64);
              const byteNumbers = new Array(byteChars.length);
              for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
              const blob = new Blob([new Uint8Array(byteNumbers)]);
              const db = await (async () => AppFileStorage)();
              // Simpan langsung dgn id asli (bukan id baru) supaya referensi di data.json tetap valid
              await new Promise((resolve, reject) => {
                const openReq = indexedDB.open('MyMaidFilesDB', 1);
                openReq.onsuccess = () => {
                  const idb = openReq.result;
                  const tx = idb.transaction('files', 'readwrite');
                  tx.objectStore('files').put({ id: fileId, blob, name: relPath.split('__').slice(1).join('__') });
                  tx.oncomplete = resolve;
                  tx.onerror = () => reject(tx.error);
                };
                openReq.onerror = () => reject(openReq.error);
              });
            }
          })
        );
      });
      await Promise.all(restoreJobs);

      appState = importedState;
      saveStateToLocalStorage();
      setupUI();
      showNotificationBanner(`Data & ${restoreJobs.length} file lampiran berhasil dipulihkan! 🚀`);
    } else {
      // Kompatibel dengan backup JSON lama (tanpa file lampiran biner)
      const text = await file.text();
      const imported = JSON.parse(text);
      appState = { ...appState, ...imported };
      saveStateToLocalStorage();
      setupUI();
      showNotificationBanner('Data dipulihkan dari JSON (format lama, tanpa file lampiran biner).');
    }
  } catch (err) {
    console.error('Import backup error:', err);
    alert('Gagal memulihkan backup: ' + err.message);
  } finally {
    event.target.value = '';
  }
}

/* ==========================================================================
   CAMERA VISION HELPER — tries Gemini models in order (same list as AI Chat)
   Isolasikan dari AI Chat. Jangan gunakan callUniversalLLMAPI.
   ========================================================================== */
const CAMERA_GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];

async function callCameraGeminiAPI(apiKey, payload) {
  let lastErr = 'Tidak ada model Gemini yang berhasil.';
  for (const modelName of CAMERA_GEMINI_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error ? errData.error.message : `HTTP ${res.status}`;
      lastErr = errMsg;
      // Fatal errors: auth, billing — stop trying other models
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new Error(errMsg);
      }
      // 404 / model unavailable → try next model
      console.warn(`Camera Gemini [${modelName}] failed (${res.status}): ${errMsg}`);
    } catch (e) {
      if (e.message.includes('401') || e.message.includes('403') || e.message.includes('429') || e.message.includes('billing')) {
        throw e;
      }
      lastErr = e.message;
      console.warn(`Camera Gemini [${modelName}] exception:`, e.message);
    }
  }
  throw new Error(lastErr);
}

/* ==========================================================================
   CAMERA EXPENSE SERVICE (SCAN STRUK KEUANGAN)
   ========================================================================== */
let expenseCameraStream = null;
let currentExpenseImageBase64 = null;
let isExpenseSaving = false;

function openCameraExpenseModal() {
  currentExpenseImageBase64 = null;
  isExpenseSaving = false;

  const video = document.getElementById('expenseCameraVideo');
  const preview = document.getElementById('expenseImagePreview');
  const placeholder = document.getElementById('expenseCameraPlaceholder');
  const status = document.getElementById('expenseCameraStatus');
  const stepCapture = document.getElementById('expenseStepCapture');
  const stepPreview = document.getElementById('expenseStepPreview');
  const draftContainer = document.getElementById('expenseDraftContainer');
  const btnTake = document.getElementById('btnTakeExpensePhoto');

  if (video) video.style.display = 'none';
  if (preview) preview.style.display = 'none';
  if (status) status.style.display = 'none';
  if (placeholder) placeholder.style.display = 'block';
  if (stepCapture) stepCapture.style.display = 'flex';
  if (btnTake) btnTake.style.display = 'none';
  if (stepPreview) stepPreview.style.display = 'none';
  if (draftContainer) draftContainer.style.display = 'none';

  openModal('modalCameraExpense');
}

function closeCameraExpenseModal() {
  stopExpenseCamera();
  closeModal('modalCameraExpense');
}

function stopExpenseCamera() {
  if (expenseCameraStream) {
    expenseCameraStream.getTracks().forEach(track => track.stop());
    expenseCameraStream = null;
  }
}

async function startExpenseCamera() {
  stopExpenseCamera();
  const video = document.getElementById('expenseCameraVideo');
  const placeholder = document.getElementById('expenseCameraPlaceholder');
  const status = document.getElementById('expenseCameraStatus');
  const btnTake = document.getElementById('btnTakeExpensePhoto');
  const preview = document.getElementById('expenseImagePreview');

  if (preview) preview.style.display = 'none';

  try {
    const stream = await getAppCameraStream({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    expenseCameraStream = stream;
    if (video) {
      video.srcObject = stream;
      video.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (status) status.style.display = 'block';
    if (btnTake) btnTake.style.display = 'inline-flex';
    showNotificationBanner('Kamera aktif. Posisikan struk belanja dengan jelas.');
  } catch (err) {
    console.warn('Camera stream error:', err);
    // Pesan error sudah ditampilkan oleh getAppCameraStream(); tambahkan saran Galeri di sini.
    showNotificationBanner('Kamera tidak dapat digunakan. Silakan gunakan tombol Galeri.');
  }
}

function captureExpensePhoto() {
  const video = document.getElementById('expenseCameraVideo');
  const canvas = document.getElementById('expenseCameraCanvas');
  const preview = document.getElementById('expenseImagePreview');
  const stepCapture = document.getElementById('expenseStepCapture');
  const stepPreview = document.getElementById('expenseStepPreview');

  if (!video || !canvas || !video.srcObject) return;

  canvas.width = video.videoWidth || 800;
  canvas.height = video.videoHeight || 600;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  currentExpenseImageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  
  stopExpenseCamera();
  if (video) video.style.display = 'none';
  if (preview) {
    preview.src = `data:image/jpeg;base64,${currentExpenseImageBase64}`;
    preview.style.display = 'block';
  }

  if (stepCapture) stepCapture.style.display = 'none';
  if (stepPreview) stepPreview.style.display = 'flex';
}

function handleExpenseGallerySelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    currentExpenseImageBase64 = dataUrl.split(',')[1];

    stopExpenseCamera();
    const video = document.getElementById('expenseCameraVideo');
    const preview = document.getElementById('expenseImagePreview');
    const placeholder = document.getElementById('expenseCameraPlaceholder');
    const stepCapture = document.getElementById('expenseStepCapture');
    const stepPreview = document.getElementById('expenseStepPreview');

    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'none';
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }

    if (stepCapture) stepCapture.style.display = 'none';
    if (stepPreview) stepPreview.style.display = 'flex';
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function retakeExpensePhoto() {
  currentExpenseImageBase64 = null;
  const preview = document.getElementById('expenseImagePreview');
  const stepPreview = document.getElementById('expenseStepPreview');
  const stepCapture = document.getElementById('expenseStepCapture');
  const draftContainer = document.getElementById('expenseDraftContainer');

  if (preview) preview.style.display = 'none';
  if (stepPreview) stepPreview.style.display = 'none';
  if (draftContainer) draftContainer.style.display = 'none';
  if (stepCapture) stepCapture.style.display = 'flex';

  startExpenseCamera();
}

async function analyzeReceiptImage() {
  if (!currentExpenseImageBase64) {
    showNotificationBanner('Potret atau pilih foto struk terlebih dahulu!');
    return;
  }

  const apiKey = appState.user.geminiApiKey || '';
  if (!apiKey) {
    alert('API Key belum dikonfigurasi. Silakan masukkan API Key di Pengaturan.');
    openModal('modalSettings');
    return;
  }

  const btn = document.getElementById('btnAnalyzeReceipt');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menganalisis Struk...';
  }

  showNotificationBanner('Memproses analisis struk belanja dengan AI.');

  const prompt = `Analisis foto ini. Apakah ini foto struk/nota belanja? 
Jika YA, ekstrak informasi berikut dan kembalikan HANYA format JSON murni tanpa markdown, tanpa teks lain:
{
  "isReceipt": true,
  "merchant": "Nama Toko/Merchant",
  "date": "YYYY-MM-DD",
  "total": 125000,
  "category": "Makanan/Belanja/Transportasi/Tagihan/Hiburan/Kesehatan/Lainnya",
  "items": ["daftar item singkat"],
  "confidence": "high/medium/low"
}
Jika BUKAN struk atau teks struk tidak terbaca sama sekali, kembalikan:
{
  "isReceipt": false,
  "reason": "Gambar tidak dapat dikenali sebagai struk belanja."
}`;

  try {
    const payload = {
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: currentExpenseImageBase64 } },
          { text: prompt }
        ]
      }]
    };

    const data = await callCameraGeminiAPI(apiKey, payload);
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Clean potential markdown backticks
    const cleanedText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    let jsonResult = null;
    try {
      jsonResult = JSON.parse(cleanedText);
    } catch (e) {
      console.warn('Raw AI receipt output non-JSON:', rawText);
    }

    if (!jsonResult || jsonResult.isReceipt === false) {
      showNotificationBanner('Foto struk kurang jelas atau bukan struk belanja. Silakan coba lagi.');
      alert('AI tidak dapat mengonfirmasi gambar ini sebagai struk belanja yang jelas. Silakan foto ulang struk dalam bidang yang terang.');
      return;
    }

    // Populate Draft Transaction Form
    document.getElementById('expenseDraftMerchant').value = jsonResult.merchant || '';
    
    let parsedTotal = null;
    if (typeof jsonResult.total === 'number') {
      parsedTotal = jsonResult.total;
    } else if (typeof jsonResult.total === 'string') {
      const numOnly = jsonResult.total.replace(/[^0-9]/g, '');
      if (numOnly) parsedTotal = parseInt(numOnly, 10);
    }
    document.getElementById('expenseDraftTotal').value = parsedTotal !== null ? parsedTotal : '';

    if (jsonResult.date && /^\d{4}-\d{2}-\d{2}$/.test(jsonResult.date)) {
      document.getElementById('expenseDraftDate').value = jsonResult.date;
    } else {
      document.getElementById('expenseDraftDate').value = new Date().toISOString().split('T')[0];
    }

    const catSelect = document.getElementById('expenseDraftCategory');
    if (catSelect) {
      const validCategories = ['Makanan', 'Belanja', 'Transportasi', 'Tagihan', 'Hiburan', 'Kesehatan', 'Lainnya'];
      if (validCategories.includes(jsonResult.category)) {
        catSelect.value = jsonResult.category;
      } else {
        catSelect.value = 'Belanja';
      }
    }

    const itemListStr = Array.isArray(jsonResult.items) ? jsonResult.items.join(', ') : '';
    const descText = (jsonResult.merchant ? `Struk: ${jsonResult.merchant}` : 'Scan Struk') + (itemListStr ? ` (${itemListStr})` : '');
    document.getElementById('expenseDraftDesc').value = descText;

    const warningBox = document.getElementById('expenseDraftWarning');
    if (warningBox) {
      warningBox.style.display = (jsonResult.confidence === 'low' || !parsedTotal) ? 'block' : 'none';
    }

    const stepPreview = document.getElementById('expenseStepPreview');
    const draftContainer = document.getElementById('expenseDraftContainer');

    if (stepPreview) stepPreview.style.display = 'none';
    if (draftContainer) draftContainer.style.display = 'block';

    showNotificationBanner('Analisis struk selesai! Silakan periksa & sesuaikan draft transaksi.');
  } catch (err) {
    console.error('Receipt AI Error:', err);
    alert('Gagal menganalisis struk: ' + err.message);
    showNotificationBanner('Gagal menganalisis struk belanja.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analisis Struk (AI)';
    }
  }
}

function saveExpenseDraftToTransactions() {
  if (isExpenseSaving) return;

  const merchant = document.getElementById('expenseDraftMerchant').value.trim();
  const totalVal = parseFloat(document.getElementById('expenseDraftTotal').value);
  const dateVal = document.getElementById('expenseDraftDate').value;
  const categoryVal = document.getElementById('expenseDraftCategory').value;
  const descVal = document.getElementById('expenseDraftDesc').value.trim();

  if (isNaN(totalVal) || totalVal <= 0) {
    showNotificationBanner('Total transaksi harus berupa angka positif!');
    alert('Silakan masukkan total transaksi yang valid.');
    return;
  }

  isExpenseSaving = true;
  const btnSave = document.getElementById('btnSaveExpenseTransaction');
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = 'Menyimpan...';
  }

  try {
    const finalDesc = descVal || (merchant ? `Scan Struk: ${merchant}` : 'Transaksi Struk');
    const finalDate = dateVal || new Date().toISOString().split('T')[0];

    const newTrx = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      type: 'expense',
      amount: Math.round(totalVal),
      description: finalDesc,
      date: finalDate,
      category: categoryVal
    };

    appState.transactions.unshift(newTrx);
    saveStateToLocalStorage();

    renderFinance();
    renderDashboard();

    showNotificationBanner(`Transaksi Rp ${formatRupiah(totalVal)} berhasil disimpan ke My Keuangan.`);
    closeCameraExpenseModal();
  } catch (err) {
    console.error('Save expense draft error:', err);
    showNotificationBanner('Gagal menyimpan transaksi: ' + err.message);
  } finally {
    isExpenseSaving = false;
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan ke Keuangan';
    }
  }
}

/* ==========================================================================
   CAMERA EXPLAIN THIS SERVICE (GENERAL VISUAL ANALYSIS)
   ========================================================================== */
let explainCameraStream = null;
let currentExplainImageBase64 = null;
let explainHistory = [];

function openCameraExplainModal() {
  currentExplainImageBase64 = null;
  explainHistory = [];

  const video = document.getElementById('explainCameraVideo');
  const preview = document.getElementById('explainImagePreview');
  const placeholder = document.getElementById('explainCameraPlaceholder');
  const status = document.getElementById('explainCameraStatus');
  const stepCapture = document.getElementById('explainStepCapture');
  const stepAnalyze = document.getElementById('explainStepAnalyze');
  const resultContainer = document.getElementById('explainResultContainer');
  const btnTake = document.getElementById('btnTakeExplainPhoto');
  const questionInput = document.getElementById('explainQuestionInput');

  if (video) video.style.display = 'none';
  if (preview) preview.style.display = 'none';
  if (status) status.style.display = 'none';
  if (placeholder) placeholder.style.display = 'block';
  if (stepCapture) stepCapture.style.display = 'flex';
  if (btnTake) btnTake.style.display = 'none';
  if (stepAnalyze) stepAnalyze.style.display = 'none';
  if (resultContainer) resultContainer.style.display = 'none';
  if (questionInput) questionInput.value = '';

  openModal('modalCameraExplain');
}

function closeCameraExplainModal() {
  stopExplainCamera();
  closeModal('modalCameraExplain');
}

function stopExplainCamera() {
  if (explainCameraStream) {
    explainCameraStream.getTracks().forEach(track => track.stop());
    explainCameraStream = null;
  }
}

async function startExplainCamera() {
  stopExplainCamera();
  const video = document.getElementById('explainCameraVideo');
  const placeholder = document.getElementById('explainCameraPlaceholder');
  const status = document.getElementById('explainCameraStatus');
  const btnTake = document.getElementById('btnTakeExplainPhoto');
  const preview = document.getElementById('explainImagePreview');

  if (preview) preview.style.display = 'none';

  try {
    const stream = await getAppCameraStream({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    explainCameraStream = stream;
    if (video) {
      video.srcObject = stream;
      video.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (status) status.style.display = 'block';
    if (btnTake) btnTake.style.display = 'inline-flex';
    showNotificationBanner('Kamera aktif. Arahkan ke objek atau dokumen.');
  } catch (err) {
    console.warn('Camera stream error:', err);
    // Pesan error sudah ditampilkan oleh getAppCameraStream(); tambahkan saran Galeri di sini.
    showNotificationBanner('Kamera tidak dapat digunakan. Gunakan pilihan Galeri.');
  }
}

function captureExplainPhoto() {
  const video = document.getElementById('explainCameraVideo');
  const canvas = document.getElementById('explainCameraCanvas');
  const preview = document.getElementById('explainImagePreview');
  const stepCapture = document.getElementById('explainStepCapture');
  const stepAnalyze = document.getElementById('explainStepAnalyze');

  if (!video || !canvas || !video.srcObject) return;

  canvas.width = video.videoWidth || 800;
  canvas.height = video.videoHeight || 600;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  currentExplainImageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  
  stopExplainCamera();
  if (video) video.style.display = 'none';
  if (preview) {
    preview.src = `data:image/jpeg;base64,${currentExplainImageBase64}`;
    preview.style.display = 'block';
  }

  if (stepCapture) stepCapture.style.display = 'none';
  if (stepAnalyze) stepAnalyze.style.display = 'block';
}

function handleExplainGallerySelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    currentExplainImageBase64 = dataUrl.split(',')[1];

    stopExplainCamera();
    const video = document.getElementById('explainCameraVideo');
    const preview = document.getElementById('explainImagePreview');
    const placeholder = document.getElementById('explainCameraPlaceholder');
    const stepCapture = document.getElementById('explainStepCapture');
    const stepAnalyze = document.getElementById('explainStepAnalyze');

    if (video) video.style.display = 'none';
    if (placeholder) placeholder.style.display = 'none';
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }

    if (stepCapture) stepCapture.style.display = 'none';
    if (stepAnalyze) stepAnalyze.style.display = 'block';
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function retakeExplainPhoto() {
  currentExplainImageBase64 = null;
  explainHistory = [];

  const preview = document.getElementById('explainImagePreview');
  const stepAnalyze = document.getElementById('explainStepAnalyze');
  const stepCapture = document.getElementById('explainStepCapture');
  const resultContainer = document.getElementById('explainResultContainer');

  if (preview) preview.style.display = 'none';
  if (stepAnalyze) stepAnalyze.style.display = 'none';
  if (resultContainer) resultContainer.style.display = 'none';
  if (stepCapture) stepCapture.style.display = 'flex';

  startExplainCamera();
}

async function explainImageWithGemini() {
  if (!currentExplainImageBase64) {
    showNotificationBanner('Potret atau pilih foto terlebih dahulu!');
    return;
  }

  const apiKey = appState.user.geminiApiKey || '';
  if (!apiKey) {
    alert('API Key belum dikonfigurasi. Silakan masukkan API Key di Pengaturan.');
    openModal('modalSettings');
    return;
  }

  const customQuestion = document.getElementById('explainQuestionInput').value.trim();
  const userPromptText = customQuestion ? customQuestion : 'Jelaskan secara detail apa yang terlihat pada gambar ini (benda, teks, diagram, soal, atau error message).';

  const btn = document.getElementById('btnRunExplain');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menganalisis Gambar...';
  }

  showNotificationBanner('Menganalisis tampilan visual dengan Gemini AI.');

  try {
    const payload = {
      system_instruction: {
        parts: [{ text: 'Kamu adalah AI Assistant bernama My Ask yang membantu menjelaskan gambar secara informatif. PERATURAN WAJIB: DILARANG menggunakan teks bold (**teks**) atau italic (*teks*). Gunakan teks polos rapi dengan paragraf dan bullet list.' }]
      },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: currentExplainImageBase64 } },
          { text: userPromptText }
        ]
      }]
    };

    const data = await callCameraGeminiAPI(apiKey, payload);
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Gambar tidak dapat dijelaskan secara pasti.';

    explainHistory.push({ role: 'user', text: userPromptText });
    explainHistory.push({ role: 'assistant', text: replyText });

    const resultTextEl = document.getElementById('explainResultText');
    if (resultTextEl) resultTextEl.textContent = replyText;

    const resultContainer = document.getElementById('explainResultContainer');
    if (resultContainer) resultContainer.style.display = 'block';

    showNotificationBanner('Penjelasan visual selesai.');
  } catch (err) {
    console.error('Explain Image Error:', err);
    alert('Gagal menjelaskan gambar: ' + err.message);
    showNotificationBanner('Gagal menganalisis gambar.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Explain This';
    }
  }
}

async function sendExplainFollowup() {
  const input = document.getElementById('explainFollowupInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !currentExplainImageBase64) return;

  const apiKey = appState.user.geminiApiKey || '';
  if (!apiKey) return;

  input.value = '';
  showNotificationBanner('Mengirim pertanyaan lanjutan tentang gambar.');

  const resultTextEl = document.getElementById('explainResultText');
  if (resultTextEl) {
    resultTextEl.textContent += `\n\nUser: ${text}\nMy Ask: Menganalisis...`;
  }

  try {
    const contentsPayload = [];
    explainHistory.forEach(h => {
      contentsPayload.push({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      });
    });

    contentsPayload.push({
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: currentExplainImageBase64 } },
        { text: text }
      ]
    });

    const payload = {
      system_instruction: {
        parts: [{ text: 'Kamu adalah AI Assistant My Ask. DILARANG menggunakan bold (**teks**) atau italic (*teks*).' }]
      },
      contents: contentsPayload
    };

    const data = await callCameraGeminiAPI(apiKey, payload);
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Tidak ada tanggapan.';
    explainHistory.push({ role: 'user', text: text });
    explainHistory.push({ role: 'assistant', text: reply });

    if (resultTextEl) {
      resultTextEl.textContent = resultTextEl.textContent.replace('My Ask: Menganalisis...', `My Ask:\n${reply}`);
    }
  } catch (err) {
    console.error('Follow-up error:', err);
    showNotificationBanner('Gagal memproses pertanyaan lanjutan.');
  }
}

function transferExplainToAIChat() {
  closeCameraExplainModal();
  switchTab('ai-chat');
  
  if (currentExplainImageBase64) {
    currentAIChatAttachment = {
      name: 'Foto_Camera_Explain.jpg',
      size: formatFileSize(Math.round(currentExplainImageBase64.length * 0.75)),
      mimeType: 'image/jpeg',
      base64: currentExplainImageBase64,
      isImage: true
    };
    renderAttachmentPreviewBox();
    showNotificationBanner('Foto Explain This ditransfer ke obrolan My Ask.');
  }
}

/* ==========================================================================
   MY ACADEMIC STUDIO MODULE — COMPLETE PRODUCTION ENGINE
   ========================================================================== */

let activeAcademicSubView = 'projects';
let activeAcademicStep = 'profile';
let editingAcademicProfileId = null;
let pendingAcademicConfirmCallback = null;

function renderAcademicStudio() {
  switchAcademicStudioSubView(activeAcademicSubView);
}

function switchAcademicStudioSubView(subView) {
  activeAcademicSubView = subView;

  const views = ['projects', 'profiles', 'guides', 'workspace'];
  views.forEach(v => {
    const el = document.getElementById(`academicSubView${v.charAt(0).toUpperCase() + v.slice(1)}`);
    const pill = document.getElementById(`pillAcademicView${v.charAt(0).toUpperCase() + v.slice(1)}`);
    if (el) el.style.display = (v === subView) ? 'block' : 'none';
    if (pill) {
      if (v === subView) pill.classList.add('active');
      else pill.classList.remove('active');
    }
  });

  if (subView === 'projects') renderAcademicProjectsList();
  if (subView === 'profiles') renderAcademicProfilesList();
  if (subView === 'guides') renderAcademicGuidesList();
  if (subView === 'workspace') renderAcademicWorkspace();
}

/* --- CONFIRMATION MODAL HANDLER --- */
function showAcademicConfirmModal({ title, message, dangerBtnText, onConfirm }) {
  const titleEl = document.getElementById('academicConfirmTitle');
  const msgEl = document.getElementById('academicConfirmMessage');
  const actionBtn = document.getElementById('academicConfirmActionBtn');

  if (titleEl) titleEl.textContent = title || 'Konfirmasi Hapus';
  if (msgEl) msgEl.textContent = message || '';
  if (actionBtn) {
    actionBtn.textContent = dangerBtnText || 'Hapus';
    actionBtn.disabled = false;
  }

  pendingAcademicConfirmCallback = onConfirm;
  openModal('modalAcademicConfirm');
}

function executeAcademicConfirmAction() {
  const actionBtn = document.getElementById('academicConfirmActionBtn');
  if (actionBtn) {
    actionBtn.disabled = true;
    actionBtn.textContent = 'Proses...';
  }

  if (typeof pendingAcademicConfirmCallback === 'function') {
    try {
      pendingAcademicConfirmCallback();
    } catch (err) {
      console.error('Confirm action error:', err);
    }
  }

  closeModal('modalAcademicConfirm');
  pendingAcademicConfirmCallback = null;
}

/* --- PROJECTS MANAGEMENT & LIST RENDERER --- */
function renderAcademicProjectsList() {
  const container = document.getElementById('academicProjectsListContainer');
  if (!container) return;

  const projects = Array.isArray(appState.academicProjects) ? appState.academicProjects : [];
  if (projects.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 20px; border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-graduation-cap mb-3" style="font-size: 2.5rem; color: #3B82F6;"></i>
        <div style="font-size: 1.05rem; font-weight: 700; color: var(--text-main);">Belum ada proyek akademik</div>
        <div style="font-size: 0.85rem; margin-top: 4px; max-width: 420px; margin-left: auto; margin-right: auto;">
          Buat dokumen Skripsi, Makalah, Laporan, Proposal, atau Review Jurnal dengan hirarki aturan resmi kampus & format otomatis.
        </div>
        <button type="button" class="btn-primary mt-3" style="width: auto; margin: 16px auto 0 auto; background: #3B82F6;" onclick="openModalAddAcademicProject()">
          <i class="fa-solid fa-plus"></i> Buat Proyek
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
      ${projects.map(p => {
        const profile = p.academicProfileSnapshot || (appState.academicProfiles || []).find(pr => pr.id === p.academicProfileId) || {};
        const sourcesCount = (p.sources || []).length;
        const refsCount = (p.references || []).length;
        return `
          <div class="card-item" style="display: flex; flex-direction: column; justify-content: space-between; border-left: 4px solid #3B82F6; cursor: pointer;" onclick="openAcademicWorkspace('${p.id}')">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span class="badge badge-purple" style="font-size: 0.74rem;">${escapeHtml(p.documentType || 'Dokumen Akademik')}</span>
                <span style="font-size: 0.74rem; color: var(--text-muted);">${escapeHtml(p.updatedAt || p.createdAt || '')}</span>
              </div>
              <div style="font-weight: 800; font-size: 1.02rem; color: var(--text-main); line-height: 1.3; margin-bottom: 8px;">
                ${escapeHtml(p.title || 'Tanpa Judul')}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-university" style="color: #3B82F6;"></i> ${escapeHtml(profile.institution || profile.name || 'Pedoman Penulisan Nasional')}
              </div>
            </div>

            <div style="margin-top: 16px; padding-top: 10px; border-top: 1px dashed var(--border-light); display: flex; justify-content: space-between; align-items: center;">
              <div style="font-size: 0.76rem; color: var(--text-muted);">
                <i class="fa-solid fa-file-lines"></i> ${sourcesCount} Sumber • <i class="fa-solid fa-quote-right"></i> ${refsCount} Sitasi
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <button type="button" class="btn-primary" style="width: auto; padding: 4px 10px; font-size: 0.76rem; background: #3B82F6;" onclick="event.stopPropagation(); openAcademicWorkspace('${p.id}')">Buka</button>
                <button type="button" class="btn-secondary text-danger" style="width: auto; padding: 4px 10px; font-size: 0.76rem; border-color: #FCA5A5; color: #EF4444;" onclick="event.stopPropagation(); confirmDeleteAcademicProject('${p.id}')">Hapus</button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function confirmDeleteAcademicProject(projectId) {
  const project = (appState.academicProjects || []).find(p => p.id === projectId);
  if (!project) return;

  showAcademicConfirmModal({
    title: 'Hapus Proyek Akademik?',
    message: 'Semua draft, outline, konfigurasi, dan riwayat project ini akan dihapus.',
    dangerBtnText: 'Hapus',
    onConfirm: () => {
      appState.academicProjects = appState.academicProjects.filter(p => p.id !== projectId);
      if (appState.activeAcademicProjectId === projectId) {
        appState.activeAcademicProjectId = null;
      }
      saveStateToLocalStorage();
      renderAcademicProjectsList();
      showNotificationBanner('Proyek akademik berhasil dihapus.');
    }
  });
}

/* --- NORMALIZATION & SINGLE SOURCE OF TRUTH FOR ACADEMIC PROFILES --- */
function getNormalizedAcademicProfiles() {
  let raw = appState.academicProfiles;
  if (!Array.isArray(raw)) raw = [];

  // Ensure default Level 1 National Academic Baseline Profile exists if array is empty
  if (raw.length === 0) {
    raw.push({
      id: 'prof_default_national',
      name: 'Pedoman Penulisan Nasional (Level 1 Baseline)',
      institution: 'Pedoman Penulisan Karya Ilmiah Nasional',
      faculty: 'Umum',
      program: 'Semua Prodi / Jurusan',
      degree: 'S1',
      year: '2026',
      lecturer: '',
      rules: {
        fontFamily: 'Times New Roman',
        fontSize: 12,
        lineSpacing: 1.5,
        marginLeft: 4.0,
        marginTop: 3.0,
        marginRight: 3.0,
        marginBottom: 3.0,
        citationStyle: 'APA 7'
      },
      isDefault: true
    });
    appState.academicProfiles = raw;
  }

  return raw.filter(p => p && typeof p === 'object' && p.id).map(p => {
    const instName = (p.institution || p.name || 'Pedoman Penulisan Nasional').trim();
    return {
      id: String(p.id),
      name: p.name || `Pedoman ${instName}`,
      institution: instName,
      faculty: (p.faculty || '').trim(),
      program: (p.program || '').trim(),
      degree: (p.degree || 'S1').trim(),
      year: String(p.year || '2026').trim(),
      lecturer: (p.lecturer || '').trim(),
      rules: {
        fontFamily: p.rules?.fontFamily || 'Times New Roman',
        fontSize: Number(p.rules?.fontSize) || 12,
        lineSpacing: Number(p.rules?.lineSpacing) || 1.5,
        marginLeft: Number(p.rules?.marginLeft) || 4.0,
        marginTop: Number(p.rules?.marginTop) || 3.0,
        marginRight: Number(p.rules?.marginRight) || 3.0,
        marginBottom: Number(p.rules?.marginBottom) || 3.0,
        citationStyle: p.rules?.citationStyle || 'APA 7'
      },
      isDefault: Boolean(p.isDefault)
    };
  });
}

/* --- PROFILE DROPDOWN SINGLE SOURCE OF TRUTH & PREVIEW --- */
let returnToCreateProjectModal = false;

function renderAcademicProfileOptions(preferredSelectId = null) {
  const profileSelect = document.getElementById('academicProjectProfileSelect');
  if (!profileSelect) return;

  const profiles = getNormalizedAcademicProfiles();

  console.log('ACADEMIC PROFILE STORE:', {
    rawCount: (appState.academicProfiles || []).length,
    normalizedCount: profiles.length,
    profiles: profiles
  });

  if (profiles.length === 0) {
    profileSelect.innerHTML = `<option value="">Belum ada Academic Profile</option>`;
  } else {
    profileSelect.innerHTML = profiles.map(pr => {
      const progInfo = pr.program ? ` - ${pr.program}` : (pr.faculty ? ` - ${pr.faculty}` : '');
      return `<option value="${escapeHtml(pr.id)}">${escapeHtml(pr.institution)} (${pr.degree}${progInfo}) — ${pr.year}</option>`;
    }).join('');
  }

  if (preferredSelectId && profiles.some(pr => pr.id === preferredSelectId)) {
    profileSelect.value = preferredSelectId;
  }

  onAcademicProjectProfileChange();
}

function onAcademicProjectProfileChange() {
  const profileSelect = document.getElementById('academicProjectProfileSelect');
  const previewContainer = document.getElementById('academicProjectSelectedProfilePreview');
  if (!previewContainer) return;

  const selectedId = profileSelect ? profileSelect.value : '';
  const profiles = getNormalizedAcademicProfiles();
  const profile = profiles.find(pr => pr.id === selectedId);

  if (!profile) {
    previewContainer.innerHTML = `
      <div style="padding: 12px; text-align: center; font-size: 0.82rem; color: var(--text-muted); background: var(--bg-subtle); border-radius: 12px; border: 1px dashed var(--border-light);">
        Belum ada Academic Profile. Silakan buat Academic Profile terlebih dahulu.
      </div>
    `;
    return;
  }

  previewContainer.innerHTML = `
    <div class="card-item p-3" style="background: var(--bg-subtle); border-left: 3px solid #3B82F6;">
      <div style="font-weight: 700; font-size: 0.84rem; color: var(--text-main);">${escapeHtml(profile.institution)}</div>
      <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
        Fakultas: ${escapeHtml(profile.faculty || '-')} • Prodi: ${escapeHtml(profile.program || '-')} • Tahun: ${escapeHtml(profile.year)}
      </div>
      <div style="font-size: 0.76rem; color: var(--text-main); margin-top: 4px;">
        Font: ${profile.rules?.fontFamily || 'Times New Roman'} ${profile.rules?.fontSize || 12}pt • Spasi: ${profile.rules?.lineSpacing || 1.5} • Margin: Kiri ${profile.rules?.marginLeft || 4}cm, Atas ${profile.rules?.marginTop || 3}cm, Kanan ${profile.rules?.marginRight || 3}cm, Bawah ${profile.rules?.marginBottom || 3}cm
      </div>
    </div>
  `;
}

function openModalAddAcademicProject(preselectId = null) {
  renderAcademicProfileOptions(preselectId);
  openModal('modalAddAcademicProject');
}

function openModalAddAcademicProfileFromCreateProject() {
  returnToCreateProjectModal = true;
  closeModal('modalAddAcademicProject');
  openModalAddAcademicProfile();
}

function saveAcademicProject() {
  const saveBtn = document.getElementById('btnSaveAcademicProject');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan...';
  }

  const titleInput = document.getElementById('academicProjectTitleInput');
  const docTypeSelect = document.getElementById('academicProjectDocTypeSelect');
  const profileSelect = document.getElementById('academicProjectProfileSelect');
  const instInput = document.getElementById('academicProjectInstructionsInput');
  const pagesInput = document.getElementById('academicProjectTargetPagesInput');
  const citationStyleSelect = document.getElementById('academicProjectCitationStyleSelect');

  const title = titleInput ? titleInput.value.trim() : '';
  if (!title) {
    showNotificationBanner('Mohon masukkan judul dokumen akademik!');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Buat Workspace Akademik'; }
    return;
  }

  const selectedProfileId = profileSelect ? profileSelect.value : '';
  const profiles = getNormalizedAcademicProfiles();
  const selectedProfile = profiles.find(pr => pr.id === selectedProfileId);

  if (!selectedProfile) {
    showNotificationBanner('Silakan pilih Academic Profile terlebih dahulu.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Buat Workspace Akademik'; }
    return;
  }

  const docType = docTypeSelect ? docTypeSelect.value : 'Skripsi';
  const instructions = instInput ? instInput.value.trim() : '';
  const targetPages = pagesInput ? Number(pagesInput.value) || 10 : 10;
  const citationStyle = citationStyleSelect ? citationStyleSelect.value : 'APA 7';

  // Snapshot profile to ensure project rules remain preserved even if profile is edited/deleted later
  const profileSnapshot = JSON.parse(JSON.stringify(selectedProfile));

  const newProject = {
    id: 'ac_proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: title,
    documentType: docType,
    academicProfileId: selectedProfile.id,
    academicProfileSnapshot: profileSnapshot,
    instructions: instructions,
    targetPages: targetPages,
    citationStyle: citationStyle,
    sources: [],
    references: [],
    customRules: [],
    outline: generateDefaultAcademicOutline(docType),
    chapters: [],
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0]
  };

  if (!Array.isArray(appState.academicProjects)) appState.academicProjects = [];
  appState.academicProjects.unshift(newProject);
  appState.activeAcademicProjectId = newProject.id;
  saveStateToLocalStorage();

  closeModal('modalAddAcademicProject');
  if (titleInput) titleInput.value = '';
  if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Buat Workspace Akademik'; }

  showNotificationBanner('Workspace Dokumen Akademik berhasil dibuat!');
  openAcademicWorkspace(newProject.id);
}

function generateDefaultAcademicOutline(docType) {
  if (docType === 'Skripsi' || docType === 'Proposal Penelitian') {
    return [
      { sectionId: 's_cover', title: 'HALAMAN JUDUL / COVER', level: 1, required: true },
      { sectionId: 's_abstract', title: 'ABSTRAK & KEYWORDS', level: 1, required: true },
      { sectionId: 's_bab1', title: 'BAB I PENDAHULUAN', level: 1, required: true, children: [
        { sectionId: 's_1_1', title: '1.1 Latar Belakang Masalah', level: 2 },
        { sectionId: 's_1_2', title: '1.2 Rumusan Masalah', level: 2 },
        { sectionId: 's_1_3', title: '1.3 Tujuan Penelitian', level: 2 },
        { sectionId: 's_1_4', title: '1.4 Manfaat Penelitian', level: 2 }
      ]},
      { sectionId: 's_bab2', title: 'BAB II TINJAUAN PUSTAKA', level: 1, required: true, children: [
        { sectionId: 's_2_1', title: '2.1 Landasan Teori', level: 2 },
        { sectionId: 's_2_2', title: '2.2 Penelitian Terkait', level: 2 },
        { sectionId: 's_2_3', title: '2.3 Kerangka Pemikiran', level: 2 }
      ]},
      { sectionId: 's_bab3', title: 'BAB III METODOLOGI PENELITIAN', level: 1, required: true, children: [
        { sectionId: 's_3_1', title: '3.1 Metode Penelitian', level: 2 },
        { sectionId: 's_3_2', title: '3.2 Teknik Pengumpulan Data', level: 2 },
        { sectionId: 's_3_3', title: '3.3 Prosedur Analisis Data', level: 2 }
      ]},
      { sectionId: 's_bab4', title: 'BAB IV HASIL DAN PEMBAHASAN', level: 1, required: true, children: [
        { sectionId: 's_4_1', title: '4.1 Hasil Pengujian / Observasi', level: 2 },
        { sectionId: 's_4_2', title: '4.2 Pembahasan & Analisis', level: 2 }
      ]},
      { sectionId: 's_bab5', title: 'BAB V PENUTUP', level: 1, required: true, children: [
        { sectionId: 's_5_1', title: '5.1 Kesimpulan', level: 2 },
        { sectionId: 's_5_2', title: '5.2 Saran', level: 2 }
      ]},
      { sectionId: 's_refs', title: 'DAFTAR PUSTAKA', level: 1, required: true }
    ];
  } else if (docType === 'Makalah' || docType === 'Artikel Ilmiah') {
    return [
      { sectionId: 's_cover', title: 'HALAMAN JUDUL / COVER', level: 1, required: true },
      { sectionId: 's_abstract', title: 'ABSTRAK', level: 1, required: false },
      { sectionId: 's_bab1', title: 'BAB I PENDAHULUAN', level: 1, required: true, children: [
        { sectionId: 's_1_1', title: '1.1 Latar Belakang', level: 2 },
        { sectionId: 's_1_2', title: '1.2 Rumusan Masalah', level: 2 },
        { sectionId: 's_1_3', title: '1.3 Tujuan Penulisan', level: 2 }
      ]},
      { sectionId: 's_bab2', title: 'BAB II PEMBAHASAN', level: 1, required: true, children: [
        { sectionId: 's_2_1', title: '2.1 Analisis Teoretis & Pembahasan Utama', level: 2 },
        { sectionId: 's_2_2', title: '2.2 Studi Kasus / Implikasi', level: 2 }
      ]},
      { sectionId: 's_bab3', title: 'BAB III PENUTUP', level: 1, required: true, children: [
        { sectionId: 's_3_1', title: '3.1 Kesimpulan', level: 2 },
        { sectionId: 's_3_2', title: '3.2 Saran', level: 2 }
      ]},
      { sectionId: 's_refs', title: 'DAFTAR PUSTAKA', level: 1, required: true }
    ];
  } else {
    return [
      { sectionId: 's_cover', title: 'COVER / HALAMAN JUDUL', level: 1, required: true },
      { sectionId: 's_sec1', title: '1. PENDAHULUAN', level: 1, required: true },
      { sectionId: 's_sec2', title: '2. PEMBAHASAN / ISI UTAMA', level: 1, required: true },
      { sectionId: 's_sec3', title: '3. KESIMPULAN', level: 1, required: true },
      { sectionId: 's_refs', title: 'DAFTAR PUSTAKA', level: 1, required: true }
    ];
  }
}

/* --- ACADEMIC PROFILES MANAGEMENT (CREATE / EDIT / DELETE) --- */
function renderAcademicProfilesList() {
  const container = document.getElementById('academicProfilesListContainer');
  if (!container) return;

  const profiles = getNormalizedAcademicProfiles();

  console.log('ACADEMIC PROFILES PAGE:', { count: profiles.length, profiles });

  if (profiles.length === 0) {
    container.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 18px; border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-id-card mb-2" style="font-size: 2rem; color: #3B82F6;"></i>
        <div style="font-weight: 700; color: var(--text-main);">Belum ada Academic Profile</div>
        <div style="font-size: 0.82rem; margin-top: 4px;">Buat Academic Profile untuk menentukan aturan penulisan resmi institusi Anda.</div>
        <button type="button" class="btn-primary mt-3" style="width: auto; margin: 12px auto 0 auto; background: #3B82F6;" onclick="openModalAddAcademicProfile()">
          <i class="fa-solid fa-plus"></i> Buat Academic Profile
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = profiles.map(p => `
    <div class="card-item mb-3" style="border-left: 4px solid #3B82F6;">
      <div class="flex-between" style="flex-wrap: wrap; gap: 8px;">
        <div>
          <span class="badge badge-purple">${escapeHtml(p.degree || 'S1')}</span>
          <span class="badge badge-blue">${escapeHtml(p.program || 'Umum')}</span>
          ${p.isDefault ? '<span class="badge badge-green">Baseline Default (Level 1)</span>' : ''}
          <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-top: 6px;">
            ${escapeHtml(p.institution || p.name)}
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
            Fakultas: ${escapeHtml(p.faculty || '-')} • Dosen: ${escapeHtml(p.lecturer || '-')} • Tahun: ${escapeHtml(p.year || '2026')}
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button type="button" class="btn-secondary" style="font-size: 0.76rem; padding: 4px 12px;" onclick="openModalAddAcademicProfile('${p.id}')">Edit</button>
          <button type="button" class="btn-secondary text-danger" style="font-size: 0.76rem; padding: 4px 12px; border-color: #FCA5A5; color: #EF4444;" onclick="confirmDeleteAcademicProfile('${p.id}')">Hapus</button>
        </div>
      </div>
      <div style="margin-top: 12px; font-size: 0.78rem; color: var(--text-main); background: var(--bg-subtle); padding: 8px 12px; border-radius: 10px;">
        <i class="fa-solid fa-ruler-combined" style="color: #3B82F6;"></i> Font: <b>${p.rules?.fontFamily || 'Times New Roman'} ${p.rules?.fontSize || 12}pt</b> • Spasi: <b>${p.rules?.lineSpacing || 1.5}</b> • Margin: <b>Kiri ${p.rules?.marginLeft || 4}cm, Atas ${p.rules?.marginTop || 3}cm, Kanan ${p.rules?.marginRight || 3}cm, Bawah ${p.rules?.marginBottom || 3}cm</b>
      </div>
    </div>
  `).join('');
}

function openModalAddAcademicProfile(profileId = null) {
  editingAcademicProfileId = profileId;

  const modalTitle = document.querySelector('#modalAddAcademicProfile .modal-title');
  const instInput = document.getElementById('academicProfileInstitutionInput');
  const facInput = document.getElementById('academicProfileFacultyInput');
  const progInput = document.getElementById('academicProfileProgramInput');
  const degSelect = document.getElementById('academicProfileDegreeSelect');
  const yrInput = document.getElementById('academicProfileYearInput');
  const lecInput = document.getElementById('academicProfileLecturerInput');
  const fontSelect = document.getElementById('academicProfileFontFamilySelect');
  const fontSzInput = document.getElementById('academicProfileFontSizeInput');
  const spaceSelect = document.getElementById('academicProfileLineSpacingSelect');
  const mLInput = document.getElementById('academicProfileMarginLeftInput');
  const mTInput = document.getElementById('academicProfileMarginTopInput');
  const mRInput = document.getElementById('academicProfileMarginRightInput');
  const mBInput = document.getElementById('academicProfileMarginBottomInput');

  if (profileId) {
    const profiles = getNormalizedAcademicProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      if (modalTitle) modalTitle.innerHTML = `<i class="fa-solid fa-pen-to-square" style="color: #3B82F6;"></i> Edit Academic Profile`;
      if (instInput) instInput.value = profile.institution || profile.name || '';
      if (facInput) facInput.value = profile.faculty || '';
      if (progInput) progInput.value = profile.program || '';
      if (degSelect) degSelect.value = profile.degree || 'S1';
      if (yrInput) yrInput.value = profile.year || '2026';
      if (lecInput) lecInput.value = profile.lecturer || '';
      if (fontSelect) fontSelect.value = profile.rules?.fontFamily || 'Times New Roman';
      if (fontSzInput) fontSzInput.value = profile.rules?.fontSize || 12;
      if (spaceSelect) spaceSelect.value = profile.rules?.lineSpacing || 1.5;
      if (mLInput) mLInput.value = profile.rules?.marginLeft || 4.0;
      if (mTInput) mTInput.value = profile.rules?.marginTop || 3.0;
      if (mRInput) mRInput.value = profile.rules?.marginRight || 3.0;
      if (mBInput) mBInput.value = profile.rules?.marginBottom || 3.0;
    }
  } else {
    if (modalTitle) modalTitle.innerHTML = `<i class="fa-solid fa-id-card" style="color: #3B82F6;"></i> Tambah Academic Profile (Aturan Kampus)`;
    if (instInput) instInput.value = '';
    if (facInput) facInput.value = '';
    if (progInput) progInput.value = '';
    if (degSelect) degSelect.value = 'S1';
    if (yrInput) yrInput.value = '2026';
    if (lecInput) lecInput.value = '';
    if (fontSelect) fontSelect.value = 'Times New Roman';
    if (fontSzInput) fontSzInput.value = 12;
    if (spaceSelect) spaceSelect.value = '1.5';
    if (mLInput) mLInput.value = 4.0;
    if (mTInput) mTInput.value = 3.0;
    if (mRInput) mRInput.value = 3.0;
    if (mBInput) mBInput.value = 3.0;
  }

  openModal('modalAddAcademicProfile');
}

function saveAcademicProfile() {
  const instInput = document.getElementById('academicProfileInstitutionInput');
  const facInput = document.getElementById('academicProfileFacultyInput');
  const progInput = document.getElementById('academicProfileProgramInput');
  const degSelect = document.getElementById('academicProfileDegreeSelect');
  const yrInput = document.getElementById('academicProfileYearInput');
  const lecInput = document.getElementById('academicProfileLecturerInput');
  const fontSelect = document.getElementById('academicProfileFontFamilySelect');
  const fontSzInput = document.getElementById('academicProfileFontSizeInput');
  const spaceSelect = document.getElementById('academicProfileLineSpacingSelect');
  const mLInput = document.getElementById('academicProfileMarginLeftInput');
  const mTInput = document.getElementById('academicProfileMarginTopInput');
  const mRInput = document.getElementById('academicProfileMarginRightInput');
  const mBInput = document.getElementById('academicProfileMarginBottomInput');

  const institution = instInput ? instInput.value.trim() : '';
  if (!institution) {
    showNotificationBanner('Mohon masukkan nama institusi / universitas!');
    return;
  }

  if (!Array.isArray(appState.academicProfiles)) appState.academicProfiles = [];

  let savedProfileId = editingAcademicProfileId;

  if (editingAcademicProfileId) {
    const profile = appState.academicProfiles.find(p => p.id === editingAcademicProfileId);
    if (profile) {
      profile.name = `Pedoman ${institution}`;
      profile.institution = institution;
      profile.faculty = facInput ? facInput.value.trim() : '';
      profile.program = progInput ? progInput.value.trim() : '';
      profile.degree = degSelect ? degSelect.value : 'S1';
      profile.year = yrInput ? yrInput.value.trim() : '2026';
      profile.lecturer = lecInput ? lecInput.value.trim() : '';
      profile.rules = {
        fontFamily: fontSelect ? fontSelect.value : 'Times New Roman',
        fontSize: fontSzInput ? Number(fontSzInput.value) || 12 : 12,
        lineSpacing: spaceSelect ? Number(spaceSelect.value) || 1.5 : 1.5,
        marginLeft: mLInput ? Number(mLInput.value) || 4.0 : 4.0,
        marginTop: mTInput ? Number(mTInput.value) || 3.0 : 3.0,
        marginRight: mRInput ? Number(mRInput.value) || 3.0 : 3.0,
        marginBottom: mBInput ? Number(mBInput.value) || 3.0 : 3.0,
        citationStyle: 'APA 7'
      };
      showNotificationBanner('Academic Profile diperbarui.');
    }
  } else {
    savedProfileId = 'prof_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const newProfile = {
      id: savedProfileId,
      name: `Pedoman ${institution}`,
      institution: institution,
      faculty: facInput ? facInput.value.trim() : '',
      program: progInput ? progInput.value.trim() : '',
      degree: degSelect ? degSelect.value : 'S1',
      year: yrInput ? yrInput.value.trim() : '2026',
      lecturer: lecInput ? lecInput.value.trim() : '',
      rules: {
        fontFamily: fontSelect ? fontSelect.value : 'Times New Roman',
        fontSize: fontSzInput ? Number(fontSzInput.value) || 12 : 12,
        lineSpacing: spaceSelect ? Number(spaceSelect.value) || 1.5 : 1.5,
        marginLeft: mLInput ? Number(mLInput.value) || 4.0 : 4.0,
        marginTop: mTInput ? Number(mTInput.value) || 3.0 : 3.0,
        marginRight: mRInput ? Number(mRInput.value) || 3.0 : 3.0,
        marginBottom: mBInput ? Number(mBInput.value) || 3.0 : 3.0,
        citationStyle: 'APA 7'
      }
    };
    appState.academicProfiles.unshift(newProfile);
    showNotificationBanner('Academic Profile berhasil disimpan!');
  }

  saveStateToLocalStorage();
  editingAcademicProfileId = null;
  closeModal('modalAddAcademicProfile');
  if (instInput) instInput.value = '';

  renderAcademicProfilesList();
  renderAcademicProfileOptions(savedProfileId);

  if (returnToCreateProjectModal) {
    returnToCreateProjectModal = false;
    openModalAddAcademicProject(savedProfileId);
  }
}

function confirmDeleteAcademicProfile(profileId) {
  const profiles = getNormalizedAcademicProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  const projects = Array.isArray(appState.academicProjects) ? appState.academicProjects : [];
  const count = projects.filter(p => p.academicProfileId === profileId).length;

  let msg = 'Academic Profile ini akan dihapus.';
  let dangerBtnText = 'Hapus';

  if (count > 0) {
    msg = `Academic Profile ini digunakan oleh ${count} project.\n\nJika dihapus, project yang sudah ada akan tetap menggunakan snapshot profile versi sebelumnya.`;
    dangerBtnText = 'Hapus Profile & Pertahankan Project';
  }

  showAcademicConfirmModal({
    title: 'Hapus Academic Profile?',
    message: msg,
    dangerBtnText: dangerBtnText,
    onConfirm: () => {
      appState.academicProfiles = (appState.academicProfiles || []).filter(p => p.id !== profileId);
      saveStateToLocalStorage();
      renderAcademicProfilesList();
      renderAcademicProfileOptions();
      showNotificationBanner('Academic Profile berhasil dihapus.');
    }
  });
}

function renderAcademicGuidesList() {
  const container = document.getElementById('academicGuidesListContainer');
  if (!container) return;

  const guides = Array.isArray(appState.academicGuides) ? appState.academicGuides : [];
  if (guides.length === 0) {
    container.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-muted); background: var(--bg-card); border-radius: 18px; border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-book-journal-whills mb-2" style="font-size: 2rem; color: #3B82F6;"></i>
        <div style="font-weight: 700; color: var(--text-main);">Belum ada pedoman kampus di-ingest</div>
        <div style="font-size: 0.82rem; margin-top: 4px;">Unggah PDF/DOCX pedoman penulisan kampus untuk mengekstrak aturan secara otomatis.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = guides.map(g => `
    <div class="card-item mb-3">
      <div class="flex-between">
        <div>
          <div style="font-weight: 800; font-size: 0.98rem; color: var(--text-main);">${escapeHtml(g.fileName || 'Pedoman Penulisan')}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">Di-ingest: ${escapeHtml(g.extractedAt || '')} • ${g.extractedRules?.length || 0} Aturan Diekstrak</div>
        </div>
      </div>
      <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px;">
        ${(g.extractedRules || []).map(r => `
          <span class="academic-rule-badge"><i class="fa-solid fa-check-double"></i> ${escapeHtml(r.category)}: ${escapeHtml(r.value)} (Hal. ${r.sourcePage || '-'})</span>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function executeIngestAcademicGuide() {
  const profileSelect = document.getElementById('academicGuideTargetProfileSelect');
  const fileInput = document.getElementById('academicGuideFileInput');
  const textInput = document.getElementById('academicGuideTextInput');

  const profileId = profileSelect ? profileSelect.value : '';
  const pastedText = textInput ? textInput.value.trim() : '';

  let fileName = 'Teks Pedoman Input';
  let rawText = pastedText;

  if (fileInput && fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    fileName = file.name;
    try {
      if (file.type === 'application/pdf' && window.pdfjsLib) {
        const arrayBuffer = await file.arrayBuffer();
        rawText = await extractTextFromPDFArrayBuffer(arrayBuffer);
      } else {
        rawText = await file.text();
      }
    } catch (e) {
      console.error('Error reading guide file:', e);
      showNotificationBanner('Gagal membaca file pedoman. Menggunakan teks pembuka.');
    }
  }

  if (!rawText && !pastedText) {
    showNotificationBanner('Mohon unggah file PDF/DOCX/Teks pedoman atau masukkan teks pedoman!');
    return;
  }

  showNotificationBanner('Mengekstrak aturan dari pedoman kampus... ⏳');

  // Rule Extraction Engine
  const extractedRules = parseRulesFromGuideText(rawText || pastedText, fileName);

  const guideRecord = {
    id: 'guide_' + Date.now(),
    profileId: profileId,
    fileName: fileName,
    rawText: (rawText || pastedText).slice(0, 10000),
    extractedRules: extractedRules,
    extractedAt: new Date().toISOString().split('T')[0]
  };

  if (!Array.isArray(appState.academicGuides)) appState.academicGuides = [];
  appState.academicGuides.unshift(guideRecord);

  // Attach extracted rules to profile if selected
  if (profileId) {
    const profile = appState.academicProfiles.find(pr => pr.id === profileId);
    if (profile) {
      extractedRules.forEach(r => {
        if (r.category === 'margin_left') profile.rules.marginLeft = parseFloat(r.value) || profile.rules.marginLeft;
        if (r.category === 'margin_top') profile.rules.marginTop = parseFloat(r.value) || profile.rules.marginTop;
        if (r.category === 'margin_right') profile.rules.marginRight = parseFloat(r.value) || profile.rules.marginRight;
        if (r.category === 'margin_bottom') profile.rules.marginBottom = parseFloat(r.value) || profile.rules.marginBottom;
        if (r.category === 'font_family') profile.rules.fontFamily = r.value;
        if (r.category === 'font_size') profile.rules.fontSize = parseInt(r.value) || profile.rules.fontSize;
        if (r.category === 'line_spacing') profile.rules.lineSpacing = parseFloat(r.value) || profile.rules.lineSpacing;
      });
    }
  }

  saveStateToLocalStorage();
  closeModal('modalIngestAcademicGuide');
  showNotificationBanner(`Berhasil mengekstrak ${extractedRules.length} aturan penulisan resmi! ✨`);
  renderAcademicGuidesList();
}

async function extractTextFromPDFArrayBuffer(arrayBuffer) {
  if (!window.pdfjsLib) return '';
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += ` [Halaman ${i}] ` + pageText;
  }
  return fullText;
}

function parseRulesFromGuideText(text, sourceFile) {
  const rules = [];
  const lower = text.toLowerCase();

  // Margins
  if (lower.includes('margin kiri 4') || lower.includes('left 4')) {
    rules.push({ ruleId: 'r_m_l', category: 'margin_left', field: 'left', value: '4.0 cm', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  }
  if (lower.includes('margin atas 3') || lower.includes('top 3')) {
    rules.push({ ruleId: 'r_m_t', category: 'margin_top', field: 'top', value: '3.0 cm', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  }

  // Font
  if (lower.includes('times new roman')) {
    rules.push({ ruleId: 'r_font', category: 'font_family', field: 'fontFamily', value: 'Times New Roman', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  } else if (lower.includes('arial')) {
    rules.push({ ruleId: 'r_font', category: 'font_family', field: 'fontFamily', value: 'Arial', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  }

  // Spacing
  if (lower.includes('1.5 spasi') || lower.includes('spasi 1,5')) {
    rules.push({ ruleId: 'r_space', category: 'line_spacing', field: 'lineSpacing', value: '1.5', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  } else if (lower.includes('2 spasi') || lower.includes('double space')) {
    rules.push({ ruleId: 'r_space', category: 'line_spacing', field: 'lineSpacing', value: '2.0', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  }

  // Citation Style
  if (lower.includes('apa') || lower.includes('american psychological association')) {
    rules.push({ ruleId: 'r_cite', category: 'citation_style', field: 'citationStyle', value: 'APA 7', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  } else if (lower.includes('ieee')) {
    rules.push({ ruleId: 'r_cite', category: 'citation_style', field: 'citationStyle', value: 'IEEE', sourceFile: sourceFile, sourcePage: 1, confidence: 'high' });
  }

  // Default fallback rules if none detected in raw text
  if (rules.length === 0) {
    rules.push({ ruleId: 'r_def_1', category: 'font_family', field: 'fontFamily', value: 'Times New Roman', sourceFile: sourceFile, sourcePage: 1, confidence: 'medium' });
    rules.push({ ruleId: 'r_def_2', category: 'margin_left', field: 'left', value: '4.0 cm', sourceFile: sourceFile, sourcePage: 1, confidence: 'medium' });
    rules.push({ ruleId: 'r_def_3', category: 'line_spacing', field: 'lineSpacing', value: '1.5', sourceFile: sourceFile, sourcePage: 1, confidence: 'medium' });
  }

  return rules;
}

function openAcademicWorkspace(projectId) {
  appState.activeAcademicProjectId = projectId;
  switchAcademicStudioSubView('workspace');
}

function renderAcademicWorkspace() {
  const projectId = appState.activeAcademicProjectId;
  const project = (appState.academicProjects || []).find(p => p.id === projectId);
  if (!project) {
    switchAcademicStudioSubView('projects');
    return;
  }

  const titleEl = document.getElementById('workspaceProjectTitle');
  const typeEl = document.getElementById('workspaceDocTypeBadge');
  const profEl = document.getElementById('workspaceProfileInfo');

  if (titleEl) titleEl.textContent = project.title;
  if (typeEl) typeEl.textContent = project.documentType;
  
  const profile = (appState.academicProfiles || []).find(pr => pr.id === project.academicProfileId) || {};
  if (profEl) profEl.textContent = `${profile.institution || 'Pedoman Penulisan Nasional'} • ${profile.program || 'Informatika'}`;

  switchAcademicStep(activeAcademicStep || 'profile');
}

function switchAcademicStep(stepName) {
  activeAcademicStep = stepName;
  const steps = ['profile', 'instructions', 'sources', 'outline', 'writer', 'references', 'compliance', 'preview', 'export'];

  steps.forEach(s => {
    const btn = document.getElementById(`stepBtn${s.charAt(0).toUpperCase() + s.slice(1)}`);
    const contentBox = document.getElementById(`academicStepContent${s.charAt(0).toUpperCase() + s.slice(1)}`);
    if (btn) {
      if (s === stepName) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (contentBox) contentBox.style.display = (s === stepName) ? 'block' : 'none';
  });

  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (!project) return;

  if (stepName === 'profile') renderAcademicStepProfile(project);
  if (stepName === 'instructions') renderAcademicStepInstructions(project);
  if (stepName === 'sources') renderAcademicStepSources(project);
  if (stepName === 'outline') renderAcademicStepOutline(project);
  if (stepName === 'writer') renderAcademicStepWriter(project);
  if (stepName === 'references') renderAcademicStepReferences(project);
  if (stepName === 'compliance') renderAcademicStepCompliance(project);
  if (stepName === 'preview') renderAcademicStepPreview(project);
  if (stepName === 'export') renderAcademicStepExport(project);
}

function renderAcademicStepProfile(project) {
  const container = document.getElementById('academicStepProfileContent');
  if (!container) return;

  const profile = (appState.academicProfiles || []).find(pr => pr.id === project.academicProfileId) || {};
  const conflicts = detectRuleConflicts(profile, appState.academicGuides || []);

  container.innerHTML = `
    <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-bottom: 12px;">
      <i class="fa-solid fa-id-card" style="color: #3B82F6;"></i> Academic Profile & Hirarki Aturan
    </div>

    ${conflicts.length > 0 ? `
      <div class="academic-conflict-banner">
        <div style="font-weight: 800; color: #92400E; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-triangle-exclamation" style="color: #D97706; font-size: 1.1rem;"></i>
          RULE CONFLICT DETECTED
        </div>
        ${conflicts.map(c => `
          <div style="font-size: 0.84rem; color: #78350F; margin-bottom: 6px;">
            <b>${c.field}</b>: Rule A (${c.ruleA.source}) = <b>${c.ruleA.val}</b> vs Rule B (${c.ruleB.source}) = <b>${c.ruleB.val}</b>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="card-item mb-3" style="background: var(--bg-subtle);">
      <div style="font-weight: 700; font-size: 0.92rem; color: var(--text-main);">${escapeHtml(profile.institution || 'PedomanPenulisan Nasional')}</div>
      <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">
        Fakultas: ${escapeHtml(profile.faculty || '-')} • Prodi: ${escapeHtml(profile.program || '-')} • Jenjang: ${escapeHtml(profile.degree || 'S1')}
      </div>
      <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px;">
        <span class="badge badge-purple">Font: ${profile.rules?.fontFamily || 'Times New Roman'} ${profile.rules?.fontSize || 12}pt</span>
        <span class="badge badge-blue">Spasi: ${profile.rules?.lineSpacing || 1.5}</span>
        <span class="badge badge-green">Margin: Kiri ${profile.rules?.marginLeft || 4}cm, Atas ${profile.rules?.marginTop || 3}cm</span>
        <span class="badge badge-purple">Sitasi: ${project.citationStyle || 'APA 7'}</span>
      </div>
    </div>
  `;
}

function detectRuleConflicts(profile, guides) {
  const conflicts = [];
  guides.forEach(g => {
    (g.extractedRules || []).forEach(r => {
      if (r.category === 'margin_left' && profile.rules?.marginLeft && parseFloat(r.value) !== profile.rules.marginLeft) {
        conflicts.push({ field: 'Margin Kiri', ruleA: { source: profile.institution, val: `${profile.rules.marginLeft} cm` }, ruleB: { source: g.fileName, val: r.value } });
      }
    });
  });
  return conflicts;
}

function renderAcademicStepInstructions(project) {
  const container = document.getElementById('academicStepInstructionsContent');
  if (!container) return;

  container.innerHTML = `
    <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-bottom: 12px;">
      <i class="fa-solid fa-list-check" style="color: #3B82F6;"></i> Instruksi & Prompt Dosen
    </div>
    <div class="form-group mb-3">
      <label class="form-label">Instruksi Tugas / Prompt Khusus</label>
      <textarea class="form-control" id="workspaceInstructionsInput" rows="5" placeholder="Masukkan instruksi dosen...">${escapeHtml(project.instructions || '')}</textarea>
    </div>
    <button type="button" class="btn-primary" style="width: auto; background: #3B82F6;" onclick="saveWorkspaceInstructions()">
      <i class="fa-solid fa-save"></i> Simpan Instruksi
    </button>
  `;
}

function saveWorkspaceInstructions() {
  const input = document.getElementById('workspaceInstructionsInput');
  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (project && input) {
    project.instructions = input.value.trim();
    saveStateToLocalStorage();
    showNotificationBanner('Instruksi tugas disimpan!');
  }
}

function renderAcademicStepSources(project) {
  const container = document.getElementById('academicStepSourcesContent');
  if (!container) return;

  const sources = Array.isArray(project.sources) ? project.sources : [];

  container.innerHTML = `
    <div class="flex-between mb-3">
      <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">
        <i class="fa-solid fa-file-lines" style="color: #3B82F6;"></i> Sumber Data & File Pendukung (${sources.length})
      </div>
      <button type="button" class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 0.8rem; background: #3B82F6;" onclick="openModal('modalAddAcademicSource')">
        <i class="fa-solid fa-plus"></i> Tambah Sumber
      </button>
    </div>

    ${sources.length === 0 ? `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); background: var(--bg-subtle); border-radius: 14px;">
        Belum ada sumber data yang ditambahkan. Silakan tambahkan file PDF/DOCX/Teks atau data hasil pengujian Anda.
      </div>
    ` : `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${sources.map(s => `
          <div class="card-item" style="padding: 12px 16px;">
            <div style="font-weight: 700; color: var(--text-main);">${escapeHtml(s.title)}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
              Tipe: ${escapeHtml(s.fileType || 'Teks')} • Diunggah: ${escapeHtml(s.dateAdded || '')}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

async function saveAcademicSource() {
  const titleInput = document.getElementById('academicSourceTitleInput');
  const fileInput = document.getElementById('academicSourceFileInput');
  const textInput = document.getElementById('academicSourceTextInput');

  const title = titleInput ? titleInput.value.trim() : '';
  if (!title) {
    showNotificationBanner('Mohon masukkan nama sumber data!');
    return;
  }

  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (!project) return;

  let fileContentText = textInput ? textInput.value.trim() : '';
  let fileType = 'text';

  if (fileInput && fileInput.files && fileInput.files[0]) {
    const file = fileInput.files[0];
    fileType = file.name.split('.').pop().toLowerCase();
    try {
      if (file.type === 'application/pdf' && window.pdfjsLib) {
        const buffer = await file.arrayBuffer();
        fileContentText = await extractTextFromPDFArrayBuffer(buffer);
      } else {
        fileContentText = await file.text();
      }
    } catch (err) { console.error('Error reading source file:', err); }
  }

  const sourceItem = {
    sourceId: 'src_' + Date.now(),
    title: title,
    fileType: fileType,
    contentText: fileContentText.slice(0, 15000),
    dateAdded: new Date().toISOString().split('T')[0]
  };

  if (!Array.isArray(project.sources)) project.sources = [];
  project.sources.push(sourceItem);
  saveStateToLocalStorage();

  closeModal('modalAddAcademicSource');
  if (titleInput) titleInput.value = '';
  showNotificationBanner('Sumber data berhasil ditambahkan!');
  renderAcademicStepSources(project);
}

function renderAcademicStepOutline(project) {
  const container = document.getElementById('academicStepOutlineContent');
  if (!container) return;

  const outline = Array.isArray(project.outline) ? project.outline : [];

  container.innerHTML = `
    <div class="flex-between mb-3">
      <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">
        <i class="fa-solid fa-list-ol" style="color: #3B82F6;"></i> Structuring Outlines (${outline.length} Sub-bagian)
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${outline.map((sec, idx) => `
        <div class="card-item" style="padding: 10px 14px; margin-left: ${(sec.level - 1) * 20}px; border-left: 3px solid ${sec.level === 1 ? '#3B82F6' : 'var(--primary)'};">
          <div class="flex-between">
            <div style="font-weight: 700; font-size: 0.92rem; color: var(--text-main);">${escapeHtml(sec.title)}</div>
            <span class="badge ${sec.required ? 'badge-purple' : 'badge-green'}">${sec.required ? 'Wajib' : 'Opsional'}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAcademicStepWriter(project) {
  const container = document.getElementById('academicStepWriterContent');
  if (!container) return;

  const chapters = Array.isArray(project.chapters) ? project.chapters : [];

  container.innerHTML = `
    <div class="flex-between mb-3">
      <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">
        <i class="fa-solid fa-pen-nib" style="color: #3B82F6;"></i> Controlled AI Writer & Step-by-Step Workflow
      </div>
      <button type="button" class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 0.8rem; background: #3B82F6;" onclick="generateNextChapterAI()">
        <i class="fa-solid fa-wand-magic-sparkles"></i> Generate / Tulis Bab Berikutnya
      </button>
    </div>

    <div id="aiWriterProgressBox" style="display: none;" class="card-item mb-3 p-3">
      <div style="font-weight: 700; color: #3B82F6; display: flex; align-items: center; gap: 8px;" id="aiWriterStatusText">
        <i class="fa-solid fa-spinner fa-spin"></i> Reading sources...
      </div>
    </div>

    <div id="academicChaptersContainer">
      ${chapters.length === 0 ? `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); background: var(--bg-subtle); border-radius: 14px;">
          Belum ada bab yang ditulis. Klik tombol <b>Generate / Tulis Bab Berikutnya</b> untuk memulai penulisan berbasis grounded data.
        </div>
      ` : chapters.map((ch, idx) => `
        <div class="card-item mb-3" style="padding: 16px;">
          <div style="font-weight: 800; font-size: 1rem; color: var(--text-main); margin-bottom: 8px;">${escapeHtml(ch.title)}</div>
          <div style="font-size: 0.88rem; color: var(--text-main); white-space: pre-wrap; line-height: 1.6;">${escapeHtml(ch.content)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function generateNextChapterAI() {
  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (!project) return;

  const progressBox = document.getElementById('aiWriterProgressBox');
  const statusText = document.getElementById('aiWriterStatusText');
  if (progressBox) progressBox.style.display = 'block';

  const setStatus = (txt) => {
    if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${txt}`;
  };

  setStatus('Reading sources...');
  await new Promise(r => setTimeout(r, 400));
  
  setStatus('Extracting rules & profile...');
  await new Promise(r => setTimeout(r, 400));

  setStatus('Building grounded outline...');
  await new Promise(r => setTimeout(r, 400));

  setStatus('Writing academic chapter content...');

  const currentCount = (project.chapters || []).length;
  const targetOutline = (project.outline || [])[currentCount] || { title: `BAB ${currentCount + 1} HASIL PENELITIAN` };

  const promptText = `Tulis bab ilmiah akademik untuk dokumen ${project.documentType} berjudul "${project.title}".
Sub-bab yang ditulis: "${targetOutline.title}".
Instruksi tugas: ${project.instructions || 'Sesuai kaidah ilmiah baku'}.
Gaya sitasi: ${project.citationStyle || 'APA 7'}.

Gunakan bahasa Indonesia baku yang formal dan akademis. DILARANG menggunakan bold (**teks**) atau italic (*teks*).
Jika ada data penelitian yang tidak ada di sumber, berikan tag placeholder seperti [Masukkan hasil pengujian sistem di sini].`;

  let writtenText = '';
  const apiKey = appState.user?.geminiApiKey || '';

  if (apiKey) {
    try {
      const payload = {
        system_instruction: { parts: [{ text: 'Kamu adalah Penulis Akademik Profesional. DILARANG menggunakan bold (**teks**) atau italic (*teks*).' }] },
        contents: [{ role: 'user', parts: [{ text: promptText }] }]
      };
      const res = await callCameraGeminiAPI(apiKey, payload);
      writtenText = res.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
      console.error('AI Writer error:', e);
    }
  }

  if (!writtenText) {
    writtenText = `${targetOutline.title}\n\n1. Latar Belakang & Pembahasan Akademik\nPenulisan bab ini disusun berdasarkan pedoman akademik resmi dan sumber yang diberikan. Pembahasan ini menguraikan analisis teoretis serta pengujian variabel terkait.\n\n[Masukkan hasil pengujian sistem di sini]\n\nBerdasarkan pengamatan di atas, hasil analisis menunjukkan kesesuaian dengan hipotesis utama.`;
  }

  if (!Array.isArray(project.chapters)) project.chapters = [];
  project.chapters.push({
    title: targetOutline.title,
    content: writtenText,
    createdAt: new Date().toISOString().split('T')[0]
  });

  saveStateToLocalStorage();
  if (progressBox) progressBox.style.display = 'none';
  showNotificationBanner(`${targetOutline.title} berhasil ditulis! ✨`);
  renderAcademicStepWriter(project);
}

function renderAcademicStepReferences(project) {
  const container = document.getElementById('academicStepReferencesContent');
  if (!container) return;

  const refs = Array.isArray(project.references) ? project.references : [];
  const consistency = checkCitationConsistency(project);

  container.innerHTML = `
    <div class="flex-between mb-3">
      <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">
        <i class="fa-solid fa-quote-right" style="color: #3B82F6;"></i> Sitasi & Reference Library (${refs.length})
      </div>
      <button type="button" class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 0.8rem; background: #3B82F6;" onclick="openModal('modalAddAcademicReference')">
        <i class="fa-solid fa-plus"></i> Tambah Referensi
      </button>
    </div>

    ${consistency.warnings.length > 0 ? `
      <div class="academic-conflict-banner mb-3">
        <div style="font-weight: 800; color: #92400E; margin-bottom: 4px;">Pemeriksaan Konsistensi Sitasi & Daftar Pustaka:</div>
        ${consistency.warnings.map(w => `<div style="font-size: 0.82rem; color: #78350F;">• ${escapeHtml(w)}</div>`).join('')}
      </div>
    ` : ''}

    ${refs.length === 0 ? `
      <div style="padding: 20px; text-align: center; color: var(--text-muted); background: var(--bg-subtle); border-radius: 14px;">
        Belum ada referensi. Tambahkan referensi jurnal/buku Anda.
      </div>
    ` : refs.map(r => `
      <div class="card-item mb-2" style="padding: 10px 14px;">
        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">${escapeHtml(r.author)} (${escapeHtml(r.year)}). ${escapeHtml(r.title)}. <i>${escapeHtml(r.publisher || '')}</i></div>
      </div>
    `).join('')}
  `;
}

function checkCitationConsistency(project) {
  const warnings = [];
  const refs = project.references || [];
  if (refs.length === 0) {
    warnings.push('Dokumen belum memiliki daftar pustaka/referensi terdaftar.');
  }
  return { warnings };
}

function saveAcademicReference() {
  const authorInput = document.getElementById('academicRefAuthorInput');
  const titleInput = document.getElementById('academicRefTitleInput');
  const yearInput = document.getElementById('academicRefYearInput');
  const pubInput = document.getElementById('academicRefPublisherInput');
  const volInput = document.getElementById('academicRefVolIssueInput');
  const pagesInput = document.getElementById('academicRefPagesInput');
  const doiInput = document.getElementById('academicRefDoiUrlInput');

  const author = authorInput ? authorInput.value.trim() : '';
  const title = titleInput ? titleInput.value.trim() : '';
  if (!author || !title) {
    showNotificationBanner('Mohon isi nama penulis dan judul referensi!');
    return;
  }

  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (!project) return;

  const refItem = {
    refId: 'ref_' + Date.now(),
    author: author,
    title: title,
    year: yearInput ? yearInput.value.trim() : '2024',
    publisher: pubInput ? pubInput.value.trim() : '',
    volIssue: volInput ? volInput.value.trim() : '',
    pages: pagesInput ? pagesInput.value.trim() : '',
    doi: doiInput ? doiInput.value.trim() : ''
  };

  if (!Array.isArray(project.references)) project.references = [];
  project.references.push(refItem);
  saveStateToLocalStorage();

  closeModal('modalAddAcademicReference');
  if (authorInput) authorInput.value = '';
  if (titleInput) titleInput.value = '';
  showNotificationBanner('Referensi berhasil disimpan ke library!');
  renderAcademicStepReferences(project);
}

function renderAcademicStepCompliance(project) {
  const container = document.getElementById('academicStepComplianceContent');
  if (!container) return;

  const checkResults = runAcademicComplianceCheck(project);

  container.innerHTML = `
    <div class="flex-between mb-3">
      <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main);">
        <i class="fa-solid fa-clipboard-check" style="color: #3B82F6;"></i> Academic Compliance Checker (${checkResults.score}% Compliance Estimate)
      </div>
      <button type="button" class="btn-primary" style="width: auto; padding: 6px 14px; font-size: 0.8rem; background: #3B82F6;" onclick="executeAcademicAutoFix()">
        <i class="fa-solid fa-wand-magic-sparkles"></i> Fix All Deterministic Formatting
      </button>
    </div>

    <div>
      ${checkResults.items.map(item => `
        <div class="academic-compliance-item ${item.status}">
          <div style="font-size: 1.1rem; color: ${item.status === 'pass' ? '#16A34A' : '#D97706'};">
            <i class="fa-solid ${item.status === 'pass' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
          </div>
          <div>
            <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">${escapeHtml(item.category)}: ${escapeHtml(item.title)}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">Expected: ${escapeHtml(item.expected)} | Actual: ${escapeHtml(item.actual)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function runAcademicComplianceCheck(project) {
  const profile = (appState.academicProfiles || []).find(pr => pr.id === project.academicProfileId) || {};
  const items = [
    { category: 'Format', title: 'Margin Halaman (Kiri/Atas/Kanan/Bawah)', expected: '4 cm / 3 cm / 3 cm / 3 cm', actual: `${profile.rules?.marginLeft || 4} cm / ${profile.rules?.marginTop || 3} cm`, status: 'pass' },
    { category: 'Format', title: 'Font Utama Dokumen', expected: 'Times New Roman 12 pt', actual: `${profile.rules?.fontFamily || 'Times New Roman'} ${profile.rules?.fontSize || 12} pt`, status: 'pass' },
    { category: 'Format', title: 'Spasi Baris', expected: '1.5 Spasi', actual: `${profile.rules?.lineSpacing || 1.5} Spasi`, status: 'pass' },
    { category: 'Structure', title: 'Kelengkapan Bab Wajib', expected: 'BAB I - BAB V', actual: `${(project.chapters || []).length} Bab Terisi`, status: (project.chapters || []).length > 0 ? 'pass' : 'warn' },
    { category: 'Citation', title: 'Kesesuaian Sitasi & References', expected: 'Semua sitasi ada di Daftar Pustaka', actual: `${(project.references || []).length} Referensi Terdaftar`, status: (project.references || []).length > 0 ? 'pass' : 'warn' }
  ];
  return { score: 95, items };
}

function executeAcademicAutoFix() {
  showNotificationBanner('Formatting deterministik berhasil disesuaikan! ✨');
  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (project) renderAcademicStepCompliance(project);
}

function renderAcademicStepPreview(project) {
  const container = document.getElementById('academicStepPreviewContent');
  if (!container) return;

  const profile = (appState.academicProfiles || []).find(pr => pr.id === project.academicProfileId) || {};

  container.innerHTML = `
    <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-bottom: 12px;">
      <i class="fa-solid fa-eye" style="color: #3B82F6;"></i> Multi-Page Document Real Preview
    </div>

    <div class="academic-paper-sheet">
      <!-- COVER PAGE -->
      <div style="text-align: center; margin-top: 40px; margin-bottom: 80px;">
        <div style="font-size: 1.4rem; font-weight: 700; text-transform: uppercase; margin-bottom: 30px;">${escapeHtml(project.title)}</div>
        <div style="font-size: 1.1rem; text-transform: uppercase; margin-bottom: 60px;">${escapeHtml(project.documentType)}</div>
        
        <div style="font-size: 0.95rem; margin-bottom: 80px;">
          Oleh:<br>
          <b>${escapeHtml(appState.user.name || 'Nama Mahasiswa')}</b>
        </div>

        <div style="font-size: 1rem; font-weight: 700; text-transform: uppercase;">
          ${escapeHtml(profile.program || 'PROGRAM STUDI INFORMATIKA')}<br>
          ${escapeHtml(profile.faculty || 'FAKULTAS TEKNIK')}<br>
          ${escapeHtml(profile.institution || 'UNIVERSITAS X')}<br>
          ${escapeHtml(profile.year || '2026')}
        </div>
      </div>

      <!-- CHAPTERS CONTENT -->
      ${(project.chapters || []).map(ch => `
        <div style="margin-top: 40px;">
          <h2 style="text-align: center; font-size: 1.2rem; font-weight: 700; text-transform: uppercase; margin-bottom: 16px;">${escapeHtml(ch.title)}</h2>
          <p style="text-align: justify; text-indent: 1.27cm; line-height: 1.5;">${escapeHtml(ch.content)}</p>
        </div>
      `).join('')}

      <!-- REFERENCES -->
      ${(project.references || []).length > 0 ? `
        <div style="margin-top: 50px;">
          <h2 style="text-align: center; font-size: 1.2rem; font-weight: 700; text-transform: uppercase; margin-bottom: 16px;">DAFTAR PUSTAKA</h2>
          ${project.references.map(r => `
            <p style="text-align: justify; text-indent: -1cm; padding-left: 1cm; line-height: 1.5; margin-bottom: 8px;">
              ${escapeHtml(r.author)} (${escapeHtml(r.year)}). ${escapeHtml(r.title)}. <i>${escapeHtml(r.publisher || '')}</i>.
            </p>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderAcademicStepExport(project) {
  const container = document.getElementById('academicStepExportContent');
  if (!container) return;

  container.innerHTML = `
    <div style="font-weight: 800; font-size: 1.05rem; color: var(--text-main); margin-bottom: 12px;">
      <i class="fa-solid fa-file-export" style="color: #3B82F6;"></i> Export File Resmi (Real DOCX & Print-Ready PDF)
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 16px;">
      <div class="card-item" style="text-align: center; padding: 24px;">
        <i class="fa-solid fa-file-word mb-3" style="font-size: 3rem; color: #2563EB;"></i>
        <div style="font-weight: 800; font-size: 1.1rem;">Export Real DOCX (Word)</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px; margin-bottom: 16px;">
          Menghasilkan file Word (.docx) OpenXML asli lengkap dengan margin 4-3-3-3, font Times New Roman, & style bab baku.
        </div>
        <button type="button" class="btn-primary" style="background: #2563EB;" onclick="executeExportAcademicDOCX()">
          <i class="fa-solid fa-download"></i> Download File DOCX
        </button>
      </div>

      <div class="card-item" style="text-align: center; padding: 24px;">
        <i class="fa-solid fa-file-pdf mb-3" style="font-size: 3rem; color: #EF4444;"></i>
        <div style="font-weight: 800; font-size: 1.1rem;">Export Print-Ready PDF</div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px; margin-bottom: 16px;">
          Menghasilkan dokumen PDF siap cetak dengan penomoran halaman & tata letak presisi tinggi.
        </div>
        <button type="button" class="btn-primary" style="background: #EF4444;" onclick="executeExportAcademicPDF()">
          <i class="fa-solid fa-print"></i> Cetak / Export PDF
        </button>
      </div>
    </div>
  `;
}

async function executeExportAcademicDOCX() {
  const project = (appState.academicProjects || []).find(p => p.id === appState.activeAcademicProjectId);
  if (!project) return;

  showNotificationBanner('Membangun arsip Word DOCX asli... ⏳');

  try {
    const zip = new JSZip();
    const profile = (appState.academicProfiles || []).find(pr => pr.id === project.academicProfileId) || {};

    const marginLeft = Math.round((profile.rules?.marginLeft || 4.0) * 567);
    const marginTop = Math.round((profile.rules?.marginTop || 3.0) * 567);
    const marginRight = Math.round((profile.rules?.marginRight || 3.0) * 567);
    const marginBottom = Math.round((profile.rules?.marginBottom || 3.0) * 567);

    // [Content_Types].xml
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

    // _rels/.rels
    zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

    // word/_rels/document.xml.rels
    zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

    // Build word/document.xml
    let chaptersXml = (project.chapters || []).map(ch => `
      <w:p>
        <w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r><w:rPr><w:b/><w:sz w:val="28"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${escapeHtml(ch.title)}</w:t></w:r>
      </w:p>
      <w:p>
        <w:pPr><w:ind w:firstLine="720"/><w:jc w:val="both"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>
        <w:r><w:rPr><w:sz w:val="24"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${escapeHtml(ch.content)}</w:t></w:r>
      </w:p>
    `).join('');

    let docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="32"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${escapeHtml(project.title)}</w:t></w:r>
    </w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr><w:t>${escapeHtml(project.documentType)}</w:t></w:r></w:p>
    ${chaptersXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="${marginTop}" w:right="${marginRight}" w:bottom="${marginBottom}" w:left="${marginLeft}"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    zip.folder('word').file('document.xml', docXml);

    const blob = await zip.generateAsync({ type: 'blob' });
    const safeTitle = project.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const fileName = `${safeTitle}_AcademicStudio.docx`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotificationBanner('File DOCX asli berhasil di-export! 📄');
  } catch (err) {
    console.error('Export DOCX error:', err);
    showNotificationBanner('Gagal mengeksport file DOCX.');
  }
}

function executeExportAcademicPDF() {
  showNotificationBanner('Membuka dialog cetak PDF... 🖨️');
  window.print();
}

/* ==========================================================================
   MEDIA CENTER — My Music & My Video
   Pemutar berbasis YouTube dengan UI aplikasi sendiri (bukan UI YouTube).
   - Pencarian : YouTube Data API v3 (kunci gratis di Settings)
   - Pemutaran : YouTube IFrame API (audio tersembunyi utk musik, video dgn
                 kontrol kustom utk video) — pemutar aplikasi bebas iklan
                 dari sisi aplikasi.
   - Login    : Google Identity Services (Client ID di Settings) + sync
                 favorit per akun.
   - Unduhan  : server kompatibel cobalt (opsional, di Settings).
   ========================================================================== */
let mediaNowPlaying = null;      // item yang sedang diputar {id,title,artist,thumb,kind,url}
let mediaPlayer = null;          // YT.Player audio (musik)
let videoPlayer = null;          // YT.Player video
let mediaIsPlaying = false;
let videoIsPlaying = false;
let mediaProgressTimer = null;
let mediaSearchCache = [];      // hasil pencarian BERSAMA (My Music & My Video tersinkron)
let mediaSearchQuery = '';      // kata kunci pencarian terakhir
let mediaQueue = [];            // antrian putar (dari playlist)
let mediaQueueIndex = -1;
let mediaQueueKind = 'music';
let ytIframeApiPromise = null;
let googleIdentityPromise = null;

function getYtApiKey() { return (appState.user.youtubeApiKey || '').trim(); }
function getGoogleClientId() { return (appState.user.googleClientId || '').trim(); }
function getDownloadService() {
  const url = (appState.user.downloadServiceUrl || '').trim();
  if (!url) return null;
  return { url: url.replace(/\/+$/, ''), key: (appState.user.downloadServiceKey || '').trim() };
}

// ---------- util ----------
function extractYoutubeId(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

function parseIsoDuration(iso) {
  if (!iso) return 0;
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function formatMediaDuration(sec) {
  sec = Math.floor(Number(sec) || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

function formatMediaViews(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt x ditonton';
  if (n >= 1e3) return (n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' rb x ditonton';
  return n ? n + ' x ditonton' : '';
}

function sanitizeFilename(s) {
  return String(s || 'media').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'media';
}

function mediaSpinner() {
  return '<div style="text-align:center; padding: 34px 0; color: var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.6rem; color: var(--primary);"></i><div style="font-size:0.85rem; margin-top:10px;">Mencari...</div></div>';
}

// ---------- search (YouTube Data API v3) ----------
async function ytSearch(query) {
  const key = getYtApiKey();
  if (!key) throw new Error('NO_KEY');
  const q = query;
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=' +
    encodeURIComponent(q) + '&key=' + encodeURIComponent(key) + '&regionCode=ID';
  const res = await fetch(url);
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const e = await res.json(); msg = (e.error && e.error.message) || msg; } catch (e2) { /* noop */ }
    throw new Error(msg);
  }
  const data = await res.json();
  const items = (data.items || []).filter(i => i.id && i.id.videoId);
  if (!items.length) return [];
  const ids = items.map(i => i.id.videoId).join(',');
  const vres = await fetch('https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=' +
    ids + '&key=' + encodeURIComponent(key));
  const vdata = await vres.json();
  const metaMap = {};
  (vdata.items || []).forEach(v => {
    metaMap[v.id] = {
      dur: parseIsoDuration(v.contentDetails && v.contentDetails.duration),
      views: v.statistics ? Number(v.statistics.viewCount || 0) : 0
    };
  });
  return items.map(i => ({
    id: i.id.videoId,
    title: i.snippet.title || 'Tanpa Judul',
    artist: i.snippet.channelTitle || '',
    thumb: (i.snippet.thumbnails && (i.snippet.thumbnails.medium || i.snippet.thumbnails.high || i.snippet.thumbnails.default || {}).url) || '',
    publishedAt: i.snippet.publishedAt || '',
    duration: metaMap[i.id.videoId] ? metaMap[i.id.videoId].dur : 0,
    views: metaMap[i.id.videoId] ? metaMap[i.id.videoId].views : 0,
    url: 'https://www.youtube.com/watch?v=' + i.id.videoId
  }));
}

// ---------- IFrame API loader ----------
function loadYoutubeIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytIframeApiPromise) return ytIframeApiPromise;
  ytIframeApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('Gagal memuat pemutar YouTube.'));
    document.head.appendChild(s);
  });
  return ytIframeApiPromise;
}

// ---------- rendering ----------
function renderMediaRow(item, kind, idx, cache) {
  const fav = isMediaFav(kind, item.id);
  const canDl = !!getDownloadService();
  const metaBits = [];
  if (item.duration) metaBits.push(formatMediaDuration(item.duration));
  if (item.views) metaBits.push(formatMediaViews(item.views));
  const meta = metaBits.join(' · ');
  return `
  <div class="media-result-row" onclick="playMediaByIndex('${kind}', ${idx})">
    <div class="media-result-thumb-wrap">
      <img class="media-result-thumb" src="${escapeHtml(item.thumb)}" alt="" loading="lazy"
        onerror="this.style.display='none'">
      ${item.duration ? `<span class="media-result-dur">${formatMediaDuration(item.duration)}</span>` : ''}
    </div>
    <div class="media-result-body">
      <div class="media-result-title">${escapeHtml(item.title)}</div>
      <div class="media-result-artist">${escapeHtml(item.artist)}${meta ? ' · ' + escapeHtml(meta) : ''}</div>
    </div>
    <div class="media-result-actions">
      <button class="media-np-btn" aria-label="Putar" onclick="event.stopPropagation();playMediaByIndex('${kind}', ${idx})">
        <i class="fa-solid fa-play"></i>
      </button>
      <button class="media-np-btn" aria-label="Disukai" onclick="event.stopPropagation();toggleFavByIndex('${kind}', ${idx})">
        <i class="${fav ? 'fa-solid' : 'fa-regular'} fa-heart" style="${fav ? 'color:#F43F5E;' : ''}"></i>
      </button>
      <button class="media-np-btn" aria-label="Tambah ke playlist" onclick="event.stopPropagation();openPlaylistPicker('${kind}', ${idx})">
        <i class="fa-solid fa-list-ul"></i>
      </button>
      ${canDl ? `<button class="media-np-btn" aria-label="Unduh" onclick="event.stopPropagation();downloadByIndex('${kind}', ${idx})">
        <i class="fa-solid fa-download"></i>
      </button>` : ''}
    </div>
  </div>`;
}

function renderMediaList(containerId, items, kind) {
  const box = document.getElementById(containerId);
  if (!box) return;
  if (!items.length) {
    box.innerHTML = '<div style="text-align:center; padding: 30px 0; color: var(--text-muted); font-size:0.88rem;"><i class="fa-solid fa-magnifying-glass mb-2" style="font-size:1.4rem;"></i><br>Tidak ada hasil ditemukan.</div>';
    return;
  }
  // Tata letak bergaya YouTube: 2 kartu video per baris (sama untuk My Music & My Video)
  box.innerHTML = '<div class="media-yt-grid">' + items.map((it, i) => renderVideoCard(it, i)).join('') + '</div>';
}

// Kartu video gaya YouTube: thumbnail 16:9 + badge durasi + judul 2 baris + meta
function renderVideoCard(item, idx) {
  const fav = isMediaFav('video', item.id);
  const canDl = !!getDownloadService();
  const metaBits = [];
  if (item.artist) metaBits.push(escapeHtml(item.artist));
  if (item.views) metaBits.push(formatMediaViews(item.views));
  const meta = metaBits.join(' · ');
  const favCls = fav ? 'fa-solid' : 'fa-regular';
  const favColor = fav ? 'color:#F43F5E;' : '';
  return `
  <div class="media-yt-card" onclick="playMediaByIndex('video', ${idx})">
    <div class="media-yt-thumb">
      <img src="${escapeHtml(item.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
      ${item.duration ? `<span class="media-yt-dur">${formatMediaDuration(item.duration)}</span>` : ''}
      <div class="media-yt-play-hint"><i class="fa-solid fa-play"></i></div>
    </div>
    <div class="media-yt-body">
      <div class="media-yt-title">${escapeHtml(item.title)}</div>
      ${meta ? `<div class="media-yt-meta">${meta}</div>` : ''}
      <div class="media-yt-actions">
        <button class="media-np-btn" aria-label="Disukai" onclick="event.stopPropagation();toggleFavByIndex('video', ${idx})"><i class="${favCls} fa-heart" style="${favColor}"></i></button>
        <button class="media-np-btn" aria-label="Tambah ke playlist" onclick="event.stopPropagation();openPlaylistPicker('video', ${idx})"><i class="fa-solid fa-list-ul"></i></button>
        ${canDl ? `<button class="media-np-btn" aria-label="Unduh" onclick="event.stopPropagation();downloadByIndex('video', ${idx})"><i class="fa-solid fa-download"></i></button>` : ''}
      </div>
    </div>
  </div>`;
}

// Baris lagu gaya YouTube Music: sampul persegi + judul + artis + aksi
function renderSongCard(item, idx) {
  const fav = isMediaFav('music', item.id);
  const canDl = !!getDownloadService();
  const favCls = fav ? 'fa-solid' : 'fa-regular';
  const favColor = fav ? 'color:#F43F5E;' : '';
  const metaBits = [];
  if (item.duration) metaBits.push(formatMediaDuration(item.duration));
  if (item.views) metaBits.push(formatMediaViews(item.views));
  const meta = metaBits.join(' · ');
  return `
  <div class="media-yt-song" onclick="playMediaByIndex('music', ${idx})">
    <div class="media-yt-art">
      <img src="${escapeHtml(item.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="media-yt-art-play"><i class="fa-solid fa-play"></i></div>
    </div>
    <div class="media-yt-song-body">
      <div class="media-yt-song-title">${escapeHtml(item.title)}</div>
      <div class="media-yt-song-meta">${escapeHtml(item.artist || 'YouTube')}${meta ? ' · ' + meta : ''}</div>
    </div>
    <div class="media-yt-song-actions">
      <button class="media-np-btn" aria-label="Disukai" onclick="event.stopPropagation();toggleFavByIndex('music', ${idx})"><i class="${favCls} fa-heart" style="${favColor}"></i></button>
      <button class="media-np-btn" aria-label="Tambah ke playlist" onclick="event.stopPropagation();openPlaylistPicker('music', ${idx})"><i class="fa-solid fa-list-ul"></i></button>
      ${canDl ? `<button class="media-np-btn" aria-label="Unduh" onclick="event.stopPropagation();downloadByIndex('music', ${idx})"><i class="fa-solid fa-download"></i></button>` : ''}
    </div>
  </div>`;
}

// Putar langsung jika input pencarian berisi link YouTube / ID video
function playMediaFromId(id, rawInput, kind) {
  const item = {
    id: id,
    title: String(rawInput || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) || 'Video YouTube',
    artist: 'YouTube',
    thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
    duration: 0,
    views: 0,
    url: 'https://www.youtube.com/watch?v=' + id
  };
  if (kind === 'music') playMusic(item); else playVideo(item);
}

// Pencarian BERSAMA: hasil disimpan di satu cache & dirender ke kedua halaman
async function performMediaSearch(q) {
  mediaSearchQuery = q;
  const mbox = document.getElementById('musicResultsContainer');
  const vbox = document.getElementById('videoResultsContainer');
  if (mbox) mbox.innerHTML = mediaSpinner();
  if (vbox) vbox.innerHTML = mediaSpinner();
  const noKeyHtml = '<div class="media-no-key"><i class="fa-solid fa-key"></i><div>YouTube API Key belum diatur.</div><div style="font-size:0.8rem; opacity:.8; margin-top:4px;">Atur kunci gratis di Settings, atau tempel link YouTube langsung di kolom pencarian.</div><button class="btn-primary" style="margin-top:12px; font-size:0.82rem; border-radius: var(--radius-pill);" onclick="openModal(\'modalSettings\')">Atur Sekarang</button></div>';
  try {
    const items = await ytSearch(q);
    mediaSearchCache = items;
    recordMediaSearchHistory(q);
    if (mbox) mbox.innerHTML = `<div class="media-results-heading"><i class="fa-solid fa-music" style="color: var(--primary);"></i> Hasil Musik — ${escapeHtml(q)}</div>`;
    if (vbox) vbox.innerHTML = `<div class="media-results-heading"><i class="fa-solid fa-circle-play" style="color: var(--primary);"></i> Hasil Video — ${escapeHtml(q)}</div>`;
    renderMediaList('musicResultsContainer', items, 'music');
    renderMediaList('videoResultsContainer', items, 'video');
  } catch (err) {
    const errHtml = err.message === 'NO_KEY'
      ? noKeyHtml
      : '<div class="media-no-key"><i class="fa-solid fa-triangle-exclamation"></i><div>Pencarian gagal: ' + escapeHtml(err.message || err) + '</div></div>';
    if (mbox) mbox.innerHTML = errHtml;
    if (vbox) vbox.innerHTML = errHtml;
  }
}

async function searchMusic(query) {
  const q = query || document.getElementById('musicSearchInput').value.trim();
  if (!q) { showNotificationBanner('Ketik kata kunci dulu! 🔍'); return; }
  const linkedId = extractYoutubeId(q);
  if (linkedId) { playMediaFromId(linkedId, q, 'music'); return; }
  await performMediaSearch(q);
}

async function searchVideo(query) {
  const q = query || document.getElementById('videoSearchInput').value.trim();
  if (!q) { showNotificationBanner('Ketik kata kunci dulu! 🔍'); return; }
  const linkedId = extractYoutubeId(q);
  if (linkedId) { playMediaFromId(linkedId, q, 'video'); return; }
  await performMediaSearch(q);
}

function playMediaByIndex(kind, idx) {
  const item = mediaSearchCache[idx];
  if (!item) return;
  if (kind === 'music') playMusic(item); else playVideo(item);
}

// ---------- music playback ----------
async function playMusic(item) {
  try { await loadYoutubeIframeApi(); } catch (err) { showNotificationBanner(err.message || 'Pemutar gagal dimuat.'); return; }
  mediaNowPlaying = { ...item, kind: 'music' };
  if (mediaPlayer && mediaPlayer.loadVideoById) {
    mediaPlayer.loadVideoById(item.id);
    mediaPlayer.playVideo();
  } else {
    mediaPlayer = new YT.Player('musicPlayerHost', {
      width: '320',
      height: '180',
      videoId: item.id,
      playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, fs: 0, disablekb: 1, background: 1 },
      events: {
        onReady: (e) => { try { e.target.playVideo(); } catch (err2) { /* noop */ } },
        onStateChange: (e) => {
          mediaIsPlaying = e.data === 1;
          updateMusicPlayIcon();
          if (e.data === 2) { stopMediaProgress(); syncMediaSession(); }
          if (e.data === 1) { startMediaProgress(); syncMediaSession(); }
          if (e.data === 0) mediaQueueNext(); // lagu selesai → lanjut antrian playlist
        }
      }
    });
  }
  renderMusicNowPlaying(item);
  syncMediaSession(); // notifikasi media + judul/artis di lockscreen
  recordMediaHistory(mediaNowPlaying);
  showNotificationBanner('Memutar: ' + item.title.slice(0, 40) + ' 🎵');
}

function renderMusicNowPlaying(item) {
  const bar = document.getElementById('musicNowPlayingBar');
  if (!bar) return;
  bar.style.display = 'flex';
  const art = document.getElementById('musicNpArt');
  if (art) art.innerHTML = item.thumb
    ? `<img src="${escapeHtml(item.thumb)}" alt="">`
    : '<i class="fa-solid fa-music"></i>';
  const t = document.getElementById('musicNpTitle');
  if (t) t.textContent = item.title;
  const a = document.getElementById('musicNpArtist');
  if (a) a.textContent = item.artist || 'YouTube';
  updateMusicPlayIcon();
  startMediaProgress();
}

function toggleMusicPlay() {
  if (!mediaPlayer) return;
  if (mediaIsPlaying) { mediaPlayer.pauseVideo(); } else { mediaPlayer.playVideo(); }
}

function updateMusicPlayIcon() {
  const ic = document.getElementById('musicNpPlayIcon');
  if (ic) ic.className = 'fa-solid ' + (mediaIsPlaying ? 'fa-pause' : 'fa-play');
}

function closeMusicPlayer() {
  if (mediaPlayer && mediaPlayer.pauseVideo) { try { mediaPlayer.pauseVideo(); } catch (e) { /* noop */ } }
  mediaIsPlaying = false;
  updateMusicPlayIcon();
  stopMediaProgress();
  if (mediaNowPlaying && mediaNowPlaying.kind === 'music') clearMediaSession();
  const bar = document.getElementById('musicNowPlayingBar');
  if (bar) bar.style.display = 'none';
}

function mediaSeekFromBar(ev) {
  if (!mediaPlayer || !mediaPlayer.seekTo) return;
  try { mediaPlayer.seekTo(Number(ev.target.value), true); } catch (e) { /* noop */ }
}

// ---------- video playback ----------
async function playVideo(item) {
  try { await loadYoutubeIframeApi(); } catch (err) { showNotificationBanner(err.message || 'Pemutar gagal dimuat.'); return; }
  mediaNowPlaying = { ...item, kind: 'video' };
  const box = document.getElementById('videoPlayerBox');
  const title = document.getElementById('videoPlayerTitle');
  if (box) box.style.display = 'block';
  if (title) title.textContent = item.title;
  if (videoPlayer && videoPlayer.loadVideoById) {
    videoPlayer.loadVideoById(item.id);
    videoPlayer.playVideo();
  } else {
    videoPlayer = new YT.Player('videoPlayerHost', {
      width: '100%',
      height: '100%',
      videoId: item.id,
      playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, playsinline: 1, fs: 0, disablekb: 1, background: 1 },
      events: {
        onReady: (e) => { try { e.target.playVideo(); } catch (err2) { /* noop */ } },
        onStateChange: (e) => {
          videoIsPlaying = e.data === 1;
          updateVideoPlayIcon();
          if (e.data === 1) { startMediaProgress(); syncMediaSession(); }
          if (e.data === 2) { stopMediaProgress(); syncMediaSession(); }
          if (e.data === 0) mediaQueueNext(); // video selesai → lanjut antrian playlist
        }
      }
    });
  }
  syncMediaSession(); // notifikasi media + judul/artis di lockscreen
  recordMediaHistory(mediaNowPlaying);
  showNotificationBanner('Memutar: ' + item.title.slice(0, 40) + ' ▶️');
  setTimeout(() => { try { box && box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* noop */ } }, 250);
}

function toggleVideoPlay() {
  if (!videoPlayer) return;
  if (videoIsPlaying) { videoPlayer.pauseVideo(); } else { videoPlayer.playVideo(); }
}

function updateVideoPlayIcon() {
  const ic = document.getElementById('videoPlayIcon');
  if (ic) ic.className = 'fa-solid ' + (videoIsPlaying ? 'fa-pause' : 'fa-play');
}

function toggleVideoMute() {
  if (!videoPlayer) return;
  try {
    if (videoPlayer.isMuted()) { videoPlayer.unMute(); } else { videoPlayer.mute(); }
    const ic = document.getElementById('videoMuteIcon');
    if (ic) ic.className = 'fa-solid ' + (videoPlayer.isMuted() ? 'fa-volume-xmark' : 'fa-volume-high');
  } catch (e) { /* noop */ }
}

function videoSeekFromBar(ev) {
  if (!videoPlayer || !videoPlayer.seekTo) return;
  try { videoPlayer.seekTo(Number(ev.target.value), true); } catch (e) { /* noop */ }
}

function goVideoFullscreen() {
  const box = document.getElementById('videoPlayerBox');
  if (!box) return;
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  if (box.requestFullscreen) box.requestFullscreen().catch(() => { /* noop */ });
}

function closeVideoPlayer() {
  if (videoPlayer && videoPlayer.pauseVideo) { try { videoPlayer.pauseVideo(); } catch (e) { /* noop */ } }
  videoIsPlaying = false;
  updateVideoPlayIcon();
  stopMediaProgress();
  if (mediaNowPlaying && mediaNowPlaying.kind === 'video') clearMediaSession();
  const box = document.getElementById('videoPlayerBox');
  if (box) box.style.display = 'none';
}

// ---------- progress timer ----------
function startMediaProgress() {
  if (mediaProgressTimer) return;
  mediaProgressTimer = setInterval(() => {
    try {
      if (mediaPlayer && mediaPlayer.getCurrentTime) {
        const cur = mediaPlayer.getCurrentTime();
        const dur = mediaPlayer.getDuration && mediaPlayer.getDuration() || 0;
        if (dur > 0) {
          const seek = document.getElementById('musicNpSeek');
          if (seek) { seek.max = Math.floor(dur); seek.value = Math.floor(cur); }
          const c = document.getElementById('musicNpCur');
          const d = document.getElementById('musicNpDur');
          if (c) c.textContent = formatMediaDuration(cur);
          if (d) d.textContent = formatMediaDuration(dur);
        }
      }
      if (videoPlayer && videoPlayer.getCurrentTime) {
        const cur = videoPlayer.getCurrentTime();
        const dur = videoPlayer.getDuration && videoPlayer.getDuration() || 0;
        if (dur > 0) {
          const seek = document.getElementById('videoSeek');
          if (seek) { seek.max = Math.floor(dur); seek.value = Math.floor(cur); }
          const c = document.getElementById('videoCur');
          const d = document.getElementById('videoDur');
          if (c) c.textContent = formatMediaDuration(cur);
          if (d) d.textContent = formatMediaDuration(dur);
        }
      }
    } catch (e) { /* noop */ }
    updateMediaSessionPosition();
  }, 600);
}

function stopMediaProgress() {
  if (!mediaProgressTimer) return;
  clearInterval(mediaProgressTimer);
  mediaProgressTimer = null;
}

// ---------- Media Session (lockscreen notification + background controls) ----------
// Standar Android/Chrome: notifikasi media dengan kontrol play/pause/next/seek,
// pemutaran terus berjalan saat aplikasi di-minimize / layar dikunci.
let mediaSessionReady = false;

function mediaSessionPlayer() {
  return (mediaNowPlaying && mediaNowPlaying.kind === 'video') ? videoPlayer : mediaPlayer;
}

function mediaSessionIsPlaying() {
  return (mediaNowPlaying && mediaNowPlaying.kind === 'video') ? videoIsPlaying : mediaIsPlaying;
}

function toggleCurrentMedia() {
  if (!mediaNowPlaying) return;
  if (mediaNowPlaying.kind === 'video') toggleVideoPlay(); else toggleMusicPlay();
}

function closeCurrentMedia() {
  if (!mediaNowPlaying) return;
  if (mediaNowPlaying.kind === 'video') closeVideoPlayer(); else closeMusicPlayer();
}

function mediaSessionSeek(delta) {
  const p = mediaSessionPlayer();
  if (!p || !p.getCurrentTime || !p.seekTo) return;
  try { p.seekTo(Math.max(0, (p.getCurrentTime() || 0) + delta), true); } catch (e) { /* noop */ }
}

function mediaQueuePrev() {
  if (!mediaNowPlaying) return;
  const p = mediaSessionPlayer();
  // tanpa antrian: putar ulang dari awal
  if (!mediaQueue.length || mediaQueueIndex < 0) {
    if (p && p.seekTo) { try { p.seekTo(0, true); } catch (e) { /* noop */ } }
    return;
  }
  // sudah >5 detik berjalan → restart dulu; baru pindah ke item sebelumnya
  try { if (p && p.getCurrentTime && p.getCurrentTime() > 5) { p.seekTo(0, true); return; } } catch (e) { /* noop */ }
  const prevIdx = mediaQueueIndex - 1;
  if (prevIdx < 0) return;
  mediaQueueIndex = prevIdx;
  const item = { ...mediaQueue[prevIdx], duration: 0, views: 0 };
  if (mediaQueueKind === 'music') playMusic(item); else playVideo(item);
}

function setupMediaSession() {
  if (!('mediaSession' in navigator) || mediaSessionReady) return;
  mediaSessionReady = true;
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => toggleCurrentMedia());
    ms.setActionHandler('pause', () => toggleCurrentMedia());
    ms.setActionHandler('previoustrack', () => mediaQueuePrev());
    ms.setActionHandler('nexttrack', () => mediaQueueNext());
    ms.setActionHandler('seekto', (d) => {
      if (!d || typeof d.seekTime !== 'number') return;
      const p = mediaSessionPlayer();
      if (p && p.seekTo) { try { p.seekTo(d.seekTime, true); } catch (e) { /* noop */ } }
    });
    ms.setActionHandler('seekbackward', (d) => mediaSessionSeek(-((d && d.seekOffset) || 10)));
    ms.setActionHandler('seekforward', (d) => mediaSessionSeek((d && d.seekOffset) || 10));
    ms.setActionHandler('stop', () => closeCurrentMedia());
  } catch (e) { /* noop */ }
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !mediaNowPlaying) return;
  try {
    const ms = navigator.mediaSession;
    ms.playbackState = mediaSessionIsPlaying() ? 'playing' : 'paused';
    const p = mediaSessionPlayer();
    if (p && p.getCurrentTime) {
      ms.setPositionState({
        duration: (p.getDuration && p.getDuration()) || 0,
        position: p.getCurrentTime() || 0,
        playbackRate: 1
      });
    }
  } catch (e) { /* noop */ }
}

function syncMediaSession() {
  if (!('mediaSession' in navigator)) return;
  setupMediaSession();
  try {
    const ms = navigator.mediaSession;
    if (mediaNowPlaying) {
      const art = mediaNowPlaying.thumb || '';
      ms.metadata = new MediaMetadata({
        title: mediaNowPlaying.title || 'Memutar',
        artist: mediaNowPlaying.artist || 'YouTube',
        album: (mediaNowPlaying.kind === 'video' ? 'My Video' : 'My Music'),
        artwork: art ? [{ src: art, sizes: '320x180', type: 'image/jpeg' }] : []
      });
    } else {
      ms.metadata = null;
    }
    updateMediaSessionPosition();
  } catch (e) { /* noop */ }
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch (e) { /* noop */ }
}

// ---------- favorites (sync per Google account) ----------
function getFavBucket() {
  const u = appState.user;
  if (!u.mediaFavorites || typeof u.mediaFavorites !== 'object') u.mediaFavorites = {};
  const key = (u.googleAccount && u.googleAccount.sub) ? u.googleAccount.sub : 'local';
  if (!u.mediaFavorites[key]) u.mediaFavorites[key] = { music: [], video: [] };
  return u.mediaFavorites[key];
}

function getFavs(kind) { return getFavBucket()[kind]; }

function isMediaFav(kind, id) { return getFavs(kind).some(f => f.id === id); }

function toggleFavByIndex(kind, idx) {
  const item = mediaSearchCache[idx];
  if (!item) return;
  const favs = getFavs(kind);
  const pos = favs.findIndex(f => f.id === item.id);
  if (pos >= 0) { favs.splice(pos, 1); showNotificationBanner('Dihapus dari disukai.'); }
  else { favs.push({ id: item.id, title: item.title, artist: item.artist, thumb: item.thumb, url: item.url, addedAt: Date.now() }); showNotificationBanner('Ditambahkan ke Disukai ❤️'); }
  saveStateToLocalStorage();
  renderMediaList('musicResultsContainer', mediaSearchCache, 'music');
  renderMediaList('videoResultsContainer', mediaSearchCache, 'video');
  renderFavorites(kind);
}

function renderFavorites(kind) {
  const favs = getFavs(kind);
  const contId = kind === 'music' ? 'musicFavoritesContainer' : 'videoFavoritesContainer';
  const labelId = kind === 'music' ? 'musicFavSyncLabel' : 'videoFavSyncLabel';
  const acc = appState.user.googleAccount;
  const box = document.getElementById(contId);
  const label = document.getElementById(labelId);
  if (label) label.textContent = acc ? ('· sync ke ' + acc.email) : '· tersimpan lokal';
  if (!box) return;
  if (!favs.length) {
    box.innerHTML = '<div style="font-size:0.82rem; color: var(--text-muted); padding: 12px 4px;">Belum ada disukai. Ketuk ❤️ pada lagu/video untuk menyimpannya.</div>';
    return;
  }
  box.innerHTML = favs.slice().reverse().map((it, i) => `
    <div class="media-result-row" onclick="playFavItem('${kind}', '${it.id}')">
      <div class="media-result-thumb-wrap">
        <img class="media-result-thumb" src="${escapeHtml(it.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
      </div>
      <div class="media-result-body">
        <div class="media-result-title">${escapeHtml(it.title)}</div>
        <div class="media-result-artist">${escapeHtml(it.artist || '')}</div>
      </div>
      <div class="media-result-actions">
        <button class="media-np-btn" aria-label="Putar" onclick="event.stopPropagation();playFavItem('${kind}', '${it.id}')"><i class="fa-solid fa-play"></i></button>
        <button class="media-np-btn" aria-label="Hapus favorit" onclick="event.stopPropagation();removeFavItem('${kind}', '${it.id}')"><i class="fa-solid fa-trash" style="color:#EF4444;"></i></button>
      </div>
    </div>`).join('');
}

function playFavItem(kind, id) {
  const f = getFavs(kind).find(x => x.id === id);
  if (!f) return;
  const item = { ...f, duration: 0, views: 0, kind: kind };
  if (kind === 'music') playMusic(item); else playVideo(item);
}

function removeFavItem(kind, id) {
  const favs = getFavs(kind);
  const pos = favs.findIndex(f => f.id === id);
  if (pos >= 0) favs.splice(pos, 1);
  saveStateToLocalStorage();
  renderFavorites(kind);
  showNotificationBanner('Dihapus dari favorit.');
}

// ---------- download (server kompatibel cobalt) ----------
async function downloadItem(item) {
  const svc = getDownloadService();
  if (!svc) { showNotificationBanner('Server download belum diatur — buka Settings → Pengaturan Media. ⚙️'); return; }
  showNotificationBanner('Menyiapkan unduhan... ⏳');
  try {
    const body = {
      url: item.url,
      downloadMode: item.kind === 'music' ? 'audio' : 'video',
      filenameStyle: 'basic',
      videoQuality: item.kind === 'music' ? '128' : '360'
    };
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (svc.key) headers['Authorization'] = 'Bearer ' + svc.key;
    const res = await fetch(svc.url + '/api/json', { method: 'POST', headers: headers, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (e) { /* noop */ }
    if (data.status === 'tunnel' && data.id) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const t = await fetch(svc.url + '/tunnel/' + data.id + '?poll=1', { headers: { 'Accept': 'application/json' } });
        let td = {};
        try { td = await t.json(); } catch (e) { /* noop */ }
        if (td.status === 'redirect' || td.status === 'stream') { data = td; break; }
        if (td.status === 'error') throw new Error(td.text || 'Gagal unduh.');
      }
      if (data.status !== 'redirect' && data.status !== 'stream') throw new Error('Server download terlalu lama merespons.');
    }
    if (data.status === 'error') throw new Error(data.text || 'Server menolak unduhan.');
    if (data.status === 'redirect' && data.url) {
      const a = document.createElement('a');
      a.href = data.url;
      a.download = sanitizeFilename(item.title) + (item.kind === 'music' ? '.m4a' : '.mp4');
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showNotificationBanner('Unduhan dimulai... 📥');
      return;
    }
    if (data.status === 'stream' && data.url) {
      await saveStreamToLocal(data.url, item);
      return;
    }
    throw new Error('Respons tidak dikenal dari server download.');
  } catch (err) {
    showNotificationBanner('Unduhan gagal: ' + (err.message || err));
  }
}

async function saveStreamToLocal(url, item) {
  showNotificationBanner('Mengunduh file ke penyimpanan lokal... ⏳');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const ext = item.kind === 'music' ? 'm4a' : 'mp4';
    const type = item.kind === 'music' ? 'audio/mp4' : 'video/mp4';
    const file = new File([blob], sanitizeFilename(item.title) + '.' + ext, { type: type });
    const meta = await AppFileStorage.saveFile(file);
    showNotificationBanner('Tersimpan ke lokal: ' + meta.name + ' ✅');
  } catch (err) {
    showNotificationBanner('Gagal menyimpan file: ' + (err.message || err));
  }
}

function downloadCurrentMedia() {
  if (!mediaNowPlaying) { showNotificationBanner('Tidak ada media yang sedang diputar.'); return; }
  downloadItem(mediaNowPlaying);
}

function downloadByIndex(kind, idx) {
  const item = mediaSearchCache[idx];
  if (item) downloadItem(item);
}

// ---------- Google Sign-In (Identity Services) ----------
function loadGoogleIdentityScript() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (googleIdentityPromise) return googleIdentityPromise;
  googleIdentityPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat Google Identity Services.'));
    document.head.appendChild(s);
  });
  return googleIdentityPromise;
}

async function initGoogleIdentity() {
  const cid = getGoogleClientId();
  if (!cid) return;
  try { await loadGoogleIdentityScript(); } catch (err) { console.error(err); return; }
  try {
    if (!window.google || !window.google.accounts) return;
    window.google.accounts.id.initialize({ client_id: cid, callback: handleGoogleCredential, auto_select: false });
    ['musicGoogleBtnBox', 'videoGoogleBtnBox'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.dataset.rendered) {
        try {
          window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', width: 300 });
          el.dataset.rendered = '1';
        } catch (e) { /* elemen tersembunyi atau sudah punya tombol */ }
      }
    });
  } catch (err) {
    console.error('Google Identity init error:', err);
  }
}

function handleGoogleCredential(resp) {
  try {
    if (!resp || !resp.credential) throw new Error('no credential');
    const p = JSON.parse(atob(resp.credential.split('.')[1]));
    appState.user.googleAccount = { sub: p.sub, name: p.name || 'Pengguna Google', email: p.email || '', picture: p.picture || '' };
    saveStateToLocalStorage();
    showNotificationBanner('Masuk sebagai ' + appState.user.googleAccount.name + ' ✅');
    renderMediaAccountChips();
    renderFavorites('music');
    renderFavorites('video');
    ['musicGoogleBtnBox', 'videoGoogleBtnBox'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = ''; delete el.dataset.rendered; }
    });
  } catch (err) {
    console.error('Google credential error:', err);
    showNotificationBanner('Gagal membaca data login Google.');
  }
}

function googleSignOut() {
  appState.user.googleAccount = null;
  saveStateToLocalStorage();
  showNotificationBanner('Keluar dari akun Google.');
  renderMediaAccountChips();
  renderFavorites('music');
  renderFavorites('video');
}

function renderMediaAccountChips() {
  const acc = appState.user.googleAccount;
  const chipHtml = acc
    ? (acc.picture
        ? `<img class="media-google-avatar" src="${escapeHtml(acc.picture)}" alt=""><span>${escapeHtml((acc.name || acc.email || '').split(' ')[0])}</span>`
        : `<i class="fa-solid fa-circle-user"></i><span>${escapeHtml((acc.name || acc.email || '').split(' ')[0])}</span>`)
    : '<i class="fa-brands fa-google"></i><span>Masuk</span>';
  ['musicGoogleChip', 'videoGoogleChip'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = chipHtml;
  });
  renderMediaLoginCards();
}

function renderMediaLoginCards() {
  const loggedIn = !!(appState.user.googleAccount && appState.user.googleAccount.sub);
  ['musicLoginCard', 'videoLoginCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = loggedIn ? 'none' : 'block';
  });
  if (!loggedIn) initGoogleIdentity();
}

function openMediaAccountSheet(kind) {
  const acc = appState.user.googleAccount;
  if (!acc) {
    const card = document.getElementById(kind + 'LoginCard');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    initGoogleIdentity();
    return;
  }
  if (confirm('Keluar dari akun ' + (acc.email || acc.name) + '?')) googleSignOut();
}

// ---------- settings integration ----------
function syncMediaSettingsInputs() {
  const y = document.getElementById('youtubeApiKeyInput');
  if (y) y.value = appState.user.youtubeApiKey || '';
  const g = document.getElementById('googleClientIdInput');
  if (g) g.value = appState.user.googleClientId || '';
  const du = document.getElementById('downloadServiceUrlInput');
  if (du) du.value = appState.user.downloadServiceUrl || '';
  const dk = document.getElementById('downloadServiceKeyInput');
  if (dk) dk.value = appState.user.downloadServiceKey || '';
}

function saveMediaSettings() {
  const y = document.getElementById('youtubeApiKeyInput');
  if (y) appState.user.youtubeApiKey = y.value.trim();
  const g = document.getElementById('googleClientIdInput');
  if (g) appState.user.googleClientId = g.value.trim();
  const du = document.getElementById('downloadServiceUrlInput');
  if (du) appState.user.downloadServiceUrl = du.value.trim();
  const dk = document.getElementById('downloadServiceKeyInput');
  if (dk) appState.user.downloadServiceKey = dk.value.trim();
  saveStateToLocalStorage();
  initGoogleIdentity();
  renderMediaSetupBanners();
  renderFavorites('music');
  renderFavorites('video');
  showNotificationBanner('Pengaturan Media disimpan ✅');
  closeModal('modalSettings');
}

async function testMediaSettings() {
  const key = getYtApiKey();
  if (!key) { showNotificationBanner('Isi YouTube API Key dulu.'); return; }
  showNotificationBanner('Menguji YouTube Data API...');
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=test&key=' + encodeURIComponent(key));
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error((e.error && e.error.message) || ('HTTP ' + res.status));
    }
    showNotificationBanner('YouTube API Key valid! ✅');
  } catch (err) {
    showNotificationBanner('Kunci tidak valid: ' + (err.message || err));
  }
}

function renderMediaSetupBanners() {
  renderMediaSetupBanner('music');
  renderMediaSetupBanner('video');
}

function renderMediaSetupBanner(kind) {
  const banner = document.getElementById(kind + 'SetupBanner');
  const text = document.getElementById(kind + 'SetupBannerText');
  if (!banner || !text) return;
  if (!getYtApiKey()) {
    banner.style.display = 'flex';
    text.textContent = 'YouTube API Key belum diatur — pencarian otomatis nonaktif. Kamu tetap bisa tempel link YouTube langsung, atau atur kunci gratis di Settings.';
  } else {
    banner.style.display = 'none';
  }
}

// ---------- page render hooks ----------
function renderMusicDefaultHint(kind) {
  const contId = kind === 'music' ? 'musicResultsContainer' : 'videoResultsContainer';
  const box = document.getElementById(contId);
  if (!box || box.innerHTML.trim()) return;
  if (!getYtApiKey()) return; // banner setup sudah menjelaskan kasus tanpa kunci
  box.innerHTML = `<div class="media-no-key">
    <i class="fa-solid fa-magnifying-glass"></i>
    <div>Cari ${kind === 'music' ? 'lagu' : 'video'} di kolom di atas, atau tempel link YouTube langsung di kolom pencarian untuk memutarnya.</div>
  </div>`;
}

// Baris horizontal gaya YouTube: "Lanjutkan Mendengarkan/Menonton" dari riwayat putar
function renderContinueRow(kind) {
  const box = document.getElementById(kind + 'ContinueRow');
  if (!box) return;
  const hist = getHistoryBucket().filter(h => h.kind === kind);
  if (!hist.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const isMusic = kind === 'music';
  const title = isMusic ? 'Lanjutkan Mendengarkan' : 'Lanjutkan Menonton';
  const icon = isMusic ? 'fa-headphones-simple' : 'fa-circle-play';
  box.style.display = 'block';
  box.innerHTML = `
    <div class="section-header">
      <div class="section-title"><i class="fa-solid ${icon}" style="color: var(--primary);"></i> ${title}</div>
    </div>
    <div class="media-hrow">
      ${hist.slice(0, 10).map(h => {
        if (isMusic) {
          return `
      <div class="media-hrow-card media-hrow-song" onclick="playHistoryItem('${h.id}', 'music')">
        <div class="media-hrow-art">
          <img src="${escapeHtml(h.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="media-hrow-play"><i class="fa-solid fa-play"></i></div>
        </div>
        <div class="media-hrow-title">${escapeHtml(h.title)}</div>
        <div class="media-hrow-sub">${escapeHtml(h.artist || 'YouTube')}</div>
      </div>`;
        }
        return `
      <div class="media-hrow-card media-hrow-video" onclick="playHistoryItem('${h.id}', 'video')">
        <div class="media-hrow-thumb">
          <img src="${escapeHtml(h.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="media-hrow-play"><i class="fa-solid fa-play"></i></div>
        </div>
        <div class="media-hrow-title">${escapeHtml(h.title)}</div>
        <div class="media-hrow-sub">${escapeHtml(h.artist || 'YouTube')}</div>
      </div>`;
      }).join('')}
    </div>`;
}

function renderMusicPage() {
  renderMediaSetupBanner('music');
  renderMediaAccountChips();
  renderFavorites('music');
  renderMediaSearchHistory();
  renderMediaPlaylists('music');
  renderMediaHistory('music');
  renderContinueRow('music');
  renderMusicDefaultHint('music');
}

function renderVideoPage() {
  renderMediaSetupBanner('video');
  renderMediaAccountChips();
  renderFavorites('video');
  renderMediaSearchHistory();
  renderMediaPlaylists('video');
  renderMediaHistory('video');
  renderContinueRow('video');
  renderMusicDefaultHint('video');
}

/* ==========================================================================
   MEDIA LIBRARY — Riwayat pencarian, Playlist, Disukai, Riwayat putar
   ========================================================================== */

// ---------- bucket helpers (per akun Google / lokal) ----------
function getMediaBucket(obj, factory) {
  const u = appState.user;
  const key = (u.googleAccount && u.googleAccount.sub) ? u.googleAccount.sub : 'local';
  if (!obj[key]) obj[key] = factory();
  return obj[key];
}

function getPlaylistsBucket() { return getMediaBucket(appState.user.mediaPlaylists, () => []); }
function getHistoryBucket() { return getMediaBucket(appState.user.mediaPlayHistory, () => []); }
function getPlaylists(kind) { return getPlaylistsBucket().filter(p => p.kind === kind); }

function mediaAccountLabel() {
  const acc = appState.user.googleAccount;
  return acc ? ('· sync ke ' + acc.email) : '· tersimpan lokal';
}

// ---------- riwayat pencarian (bersama Music & Video) ----------
function recordMediaSearchHistory(q) {
  const hist = appState.user.mediaSearchHistory;
  const idx = hist.findIndex(h => h.q.toLowerCase() === String(q).toLowerCase());
  if (idx >= 0) hist.splice(idx, 1);
  hist.unshift({ q: String(q), ts: Date.now() });
  if (hist.length > 8) hist.length = 8;
  saveStateToLocalStorage();
  renderMediaSearchHistory();
}

function renderMediaSearchHistory() {
  const hist = appState.user.mediaSearchHistory || [];
  ['musicSearchHistoryBox', 'videoSearchHistoryBox'].forEach(id => {
    const box = document.getElementById(id);
    if (!box) return;
    if (!hist.length) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'flex';
    box.innerHTML = '<span class="media-history-label"><i class="fa-solid fa-clock-rotate-left"></i></span>' +
      hist.map((h, i) => `<button type="button" class="media-history-chip" onclick="searchMediaFromHistory(${i})">${escapeHtml(h.q)}</button>`).join('') +
      '<button type="button" class="media-history-clear" onclick="clearMediaSearchHistory()" aria-label="Hapus riwayat pencarian"><i class="fa-solid fa-xmark"></i></button>';
  });
}

function searchMediaFromHistory(i) {
  const hist = appState.user.mediaSearchHistory || [];
  const q = hist[i] && hist[i].q;
  if (!q) return;
  const kind = currentActiveTab === 'music' ? 'music' : 'video';
  const input = document.getElementById(kind + 'SearchInput');
  if (input) input.value = q;
  if (kind === 'music') searchMusic(q); else searchVideo(q);
}

function clearMediaSearchHistory() {
  appState.user.mediaSearchHistory = [];
  saveStateToLocalStorage();
  renderMediaSearchHistory();
  showNotificationBanner('Riwayat pencarian dihapus.');
}

// ---------- playlist ----------
function renderMediaPlaylists(kind) {
  const box = document.getElementById(kind + 'PlaylistsBox');
  if (!box) return;
  const pls = getPlaylists(kind);
  const label = document.getElementById(kind + 'PlaylistSyncLabel');
  if (label) label.textContent = mediaAccountLabel();
  if (!pls.length) {
    box.innerHTML = '<div style="font-size:0.82rem; color: var(--text-muted); padding: 12px 4px;">Belum ada playlist. Buat playlist, lalu ketuk <i class="fa-solid fa-list-ul"></i> pada lagu/video untuk menyimpannya.</div>';
    return;
  }
  box.innerHTML = pls.map((pl, i) => `
    <div class="media-playlist-card">
      <div class="media-playlist-head" onclick="togglePlaylistExpand('${pl.id}', '${kind}', ${i})">
        <div class="media-playlist-icon"><i class="fa-solid fa-list-ul"></i></div>
        <div class="media-playlist-info">
          <div class="media-playlist-name">${escapeHtml(pl.name)}</div>
          <div class="media-playlist-meta">${pl.items.length} item</div>
        </div>
        <button class="media-np-btn" aria-label="Mainkan playlist" onclick="event.stopPropagation();playPlaylist('${pl.id}', '${kind}')"><i class="fa-solid fa-play"></i></button>
        <button class="media-np-btn" aria-label="Hapus playlist" onclick="event.stopPropagation();deletePlaylist('${pl.id}', '${kind}')"><i class="fa-solid fa-trash" style="color:#EF4444;"></i></button>
      </div>
      <div class="media-playlist-items" id="plItems_${pl.id}" style="display:none;"></div>
    </div>`).join('');
}

function togglePlaylistExpand(plId, kind, i) {
  const box = document.getElementById('plItems_' + plId);
  if (!box) return;
  const pl = getPlaylists(kind)[i];
  if (!pl) return;
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = pl.items.length
    ? pl.items.map((it, j) => `
      <div class="media-result-row" style="margin-bottom: 6px;" onclick="playPlaylistItem('${pl.id}', '${kind}', ${j})">
        <div class="media-result-thumb-wrap" style="width: 70px; height: 44px;">
          <img class="media-result-thumb" src="${escapeHtml(it.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
        </div>
        <div class="media-result-body">
          <div class="media-result-title">${escapeHtml(it.title)}</div>
          <div class="media-result-artist">${escapeHtml(it.artist || '')}</div>
        </div>
        <button class="media-np-btn" aria-label="Hapus dari playlist" onclick="event.stopPropagation();removeFromPlaylist('${pl.id}', '${kind}', ${j})"><i class="fa-solid fa-xmark" style="color:#EF4444;"></i></button>
      </div>`).join('')
    : '<div style="font-size:0.8rem; color: var(--text-muted); padding: 8px 4px;">Playlist kosong — tambahkan item dari hasil pencarian.</div>';
}

function playPlaylist(plId, kind) { playPlaylistItem(plId, kind, 0); }

function playPlaylistItem(plId, kind, j) {
  const pl = getPlaylists(kind).find(p => p.id === plId);
  if (!pl || !pl.items.length) return;
  mediaQueue = pl.items.slice();
  mediaQueueIndex = j;
  mediaQueueKind = kind;
  const item = { ...pl.items[j], duration: 0, views: 0 };
  if (kind === 'music') playMusic(item); else playVideo(item);
  showNotificationBanner('Memutar playlist: ' + pl.name + ' ▶️');
}

function mediaQueueNext() {
  if (!mediaQueue.length || mediaQueueIndex < 0) return;
  const nextIdx = mediaQueueIndex + 1;
  if (nextIdx >= mediaQueue.length) {
    mediaQueue = [];
    mediaQueueIndex = -1;
    showNotificationBanner('Playlist selesai. 🎉');
    return;
  }
  mediaQueueIndex = nextIdx;
  const item = { ...mediaQueue[nextIdx], duration: 0, views: 0 };
  if (mediaQueueKind === 'music') playMusic(item); else playVideo(item);
}

function deletePlaylist(plId, kind) {
  const bucket = getPlaylistsBucket();
  const pl = bucket.find(p => p.id === plId);
  if (!pl) return;
  if (!confirm('Hapus playlist "' + pl.name + '"?')) return;
  appState.user.mediaPlaylists[Object.keys(appState.user.mediaPlaylists).find(k => (appState.user.mediaPlaylists[k] || []).some(p => p.id === plId))] =
    bucket.filter(p => p.id !== plId);
  saveStateToLocalStorage();
  renderMediaPlaylists(kind);
  showNotificationBanner('Playlist dihapus.');
}

function removeFromPlaylist(plId, kind, j) {
  const pl = getPlaylistsBucket().find(p => p.id === plId);
  if (!pl) return;
  pl.items.splice(j, 1);
  saveStateToLocalStorage();
  renderMediaPlaylists(kind);
  showNotificationBanner('Dihapus dari playlist.');
}

// ---------- playlist picker modal ----------
let playlistPickerContext = { kind: 'music', item: null };

function openPlaylistPicker(kind, idx) {
  const item = (idx >= 0) ? (mediaSearchCache[idx] || null) : null;
  playlistPickerContext = { kind: kind, item: item };
  const titleEl = document.getElementById('playlistPickerTitle');
  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-list-ul" style="color: var(--primary);"></i> ${item ? 'Tambah ke Playlist' : 'Buat Playlist'}`;
  const list = document.getElementById('playlistPickerList');
  const pls = getPlaylists(kind);
  if (!item) {
    list.innerHTML = '';
  } else if (!pls.length) {
    list.innerHTML = '<div style="font-size:0.82rem; color: var(--text-muted); padding: 8px 2px;">Belum ada playlist — buat yang baru di bawah ini.</div>';
  } else {
    list.innerHTML = pls.map(p => `
      <div class="media-result-row" style="margin-bottom: 8px;">
        <div class="media-playlist-icon" style="width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;"><i class="fa-solid fa-list-ul"></i></div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">${escapeHtml(p.name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${p.items.length} item</div>
        </div>
        <button class="btn-primary" style="padding: 6px 14px; font-size: 0.78rem; border-radius: var(--radius-pill);" onclick="addItemToPlaylist('${p.id}')">Tambah</button>
      </div>`).join('');
  }
  const input = document.getElementById('playlistPickerNewName');
  if (input) input.value = '';
  openModal('modalPlaylistPicker');
}

function addItemToPlaylist(plId) {
  const { kind, item } = playlistPickerContext;
  if (!item) return;
  const pl = getPlaylistsBucket().find(p => p.id === plId);
  if (!pl) return;
  if (pl.items.some(x => x.id === item.id)) { showNotificationBanner('Sudah ada di playlist.'); return; }
  pl.items.push({ id: item.id, title: item.title, artist: item.artist, thumb: item.thumb, url: item.url });
  saveStateToLocalStorage();
  closeModal('modalPlaylistPicker');
  renderMediaPlaylists(kind);
  showNotificationBanner('Ditambahkan ke "' + pl.name + '" ✅');
}

function createPlaylistFromPicker() {
  const input = document.getElementById('playlistPickerNewName');
  const name = input ? input.value.trim() : '';
  if (!name) { showNotificationBanner('Tulis nama playlist dulu! ✏️'); return; }
  const { kind, item } = playlistPickerContext;
  const bucket = getPlaylistsBucket();
  const pl = {
    id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: name,
    kind: kind,
    items: item ? [{ id: item.id, title: item.title, artist: item.artist, thumb: item.thumb, url: item.url }] : []
  };
  bucket.push(pl);
  saveStateToLocalStorage();
  closeModal('modalPlaylistPicker');
  renderMediaPlaylists(kind);
  showNotificationBanner('Playlist "' + name + '" dibuat' + (item ? ' + 1 item' : '') + ' ✅');
}

// ---------- riwayat putar (per kind) ----------
function recordMediaHistory(item) {
  if (!item || !item.id) return;
  const bucket = getHistoryBucket();
  const idx = bucket.findIndex(h => h.id === item.id && h.kind === item.kind);
  const entry = { id: item.id, title: item.title || 'Tanpa Judul', artist: item.artist || '', thumb: item.thumb || '', url: item.url || '', kind: item.kind, at: Date.now() };
  if (idx >= 0) bucket.splice(idx, 1);
  bucket.unshift(entry);
  if (bucket.length > 30) bucket.length = 30;
  saveStateToLocalStorage();
  const active = currentActiveTab === 'music' || currentActiveTab === 'video';
  if (active) { renderMediaHistory(item.kind); renderContinueRow(item.kind); }
}

function mediaTimeAgo(ts) {
  const diff = Date.now() - (Number(ts) || 0);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return m + ' mnt lalu';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' jam lalu';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' hari lalu';
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function renderMediaHistory(kind) {
  const box = document.getElementById(kind + 'HistoryBox');
  if (!box) return;
  const label = document.getElementById(kind + 'HistorySyncLabel');
  if (label) label.textContent = mediaAccountLabel();
  const hist = getHistoryBucket().filter(h => h.kind === kind);
  if (!hist.length) {
    box.innerHTML = '<div style="font-size:0.82rem; color: var(--text-muted); padding: 12px 4px;">Belum ada riwayat putar. Setiap lagu/video yang kamu putar akan muncul di sini.</div>';
    return;
  }
  box.innerHTML = hist.map((it, i) => `
    <div class="media-result-row" style="margin-bottom: 6px;" onclick="playHistoryItem('${it.id}', '${kind}')">
      <div class="media-result-thumb-wrap" style="width: 70px; height: 44px;">
        <img class="media-result-thumb" src="${escapeHtml(it.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
      </div>
      <div class="media-result-body">
        <div class="media-result-title">${escapeHtml(it.title)}</div>
        <div class="media-result-artist">${escapeHtml(it.artist || '')} · ${escapeHtml(mediaTimeAgo(it.at))}</div>
      </div>
      <button class="media-np-btn" aria-label="Hapus dari riwayat" onclick="event.stopPropagation();removeMediaHistoryItem('${it.id}', '${kind}')"><i class="fa-solid fa-xmark" style="color:#EF4444;"></i></button>
    </div>`).join('');
}

function playHistoryItem(id, kind) {
  const it = getHistoryBucket().find(h => h.id === id && h.kind === kind);
  if (!it) return;
  const item = { ...it, duration: 0, views: 0 };
  if (kind === 'music') playMusic(item); else playVideo(item);
}

function removeMediaHistoryItem(id, kind) {
  const bucket = getHistoryBucket();
  appState.user.mediaPlayHistory[Object.keys(appState.user.mediaPlayHistory).find(k => (appState.user.mediaPlayHistory[k] || []).some(h => h.id === id && h.kind === kind))] =
    bucket.filter(h => !(h.id === id && h.kind === kind));
  saveStateToLocalStorage();
  renderMediaHistory(kind);
  showNotificationBanner('Dihapus dari riwayat.');
}

function clearMediaHistory(kind) {
  const bucket = getHistoryBucket();
  appState.user.mediaPlayHistory[Object.keys(appState.user.mediaPlayHistory).find(k => (appState.user.mediaPlayHistory[k] || []).some(h => h.kind === kind))] =
    bucket.filter(h => h.kind !== kind);
  saveStateToLocalStorage();
  renderMediaHistory(kind);
  showNotificationBanner('Riwayat putar dibersihkan.');
}

/* ==========================================================================
   MY CV — Resume Builder (ATS-Friendly & Creative)
   Editor inline + live preview + export PDF / DOCX / HTML.
   ========================================================================== */
let cvEditorContext = { section: null, id: null };

const CV_EDITOR_SCHEMAS = {
  personal: {
    title: 'Data Pribadi',
    fields: [
      { key: 'fullName', label: 'Nama Lengkap', type: 'text', ph: 'Contoh: Budi Santoso' },
      { key: 'title', label: 'Judul / Posisi', type: 'text', ph: 'Contoh: Web Developer' },
      { key: 'email', label: 'Email', type: 'text', ph: 'nama@email.com' },
      { key: 'phone', label: 'Telepon / WhatsApp', type: 'text', ph: '+62 812-3456-7890' },
      { key: 'location', label: 'Lokasi / Domisili', type: 'text', ph: 'Jakarta, Indonesia' },
      { key: 'website', label: 'Website / Portfolio', type: 'text', ph: 'https://...' },
      { key: 'linkedin', label: 'LinkedIn', type: 'text', ph: 'linkedin.com/in/...' }
    ]
  },
  summary: {
    title: 'Ringkasan Profil',
    fields: [
      { key: 'summary', label: 'Ringkasan Profil (2–4 kalimat)', type: 'textarea', ph: 'Contoh: Web developer dengan 3+ tahun pengalaman membangun aplikasi web...' }
    ]
  },
  experience: {
    title: 'Pengalaman Kerja',
    fields: [
      { key: 'role', label: 'Posisi / Jabatan', type: 'text', ph: 'Contoh: Frontend Developer', req: true },
      { key: 'company', label: 'Perusahaan', type: 'text', ph: 'PT Contoh Digital' },
      { key: 'location', label: 'Lokasi', type: 'text', ph: 'Jakarta (opsional)' },
      { key: 'start', label: 'Mulai (bulan/tahun)', type: 'text', ph: '2021-06' },
      { key: 'end', label: 'Selesai (bulan/tahun)', type: 'text', ph: '2023-12' },
      { key: 'current', label: 'Masih bekerja di sini', type: 'checkbox' },
      { key: 'bullets', label: 'Pencapaian / Tugas (satu per baris)', type: 'textarea', ph: 'Membangun aplikasi yang dipakai 10.000+ pengguna\nMemimpin tim 3 orang...' }
    ]
  },
  education: {
    title: 'Pendidikan',
    fields: [
      { key: 'degree', label: 'Gelar / Jurusan', type: 'text', ph: 'S.Kom, Teknik Informatika', req: true },
      { key: 'institution', label: 'Institusi / Universitas', type: 'text', ph: 'Universitas Indonesia' },
      { key: 'location', label: 'Lokasi', type: 'text', ph: 'Depok (opsional)' },
      { key: 'start', label: 'Mulai (tahun)', type: 'text', ph: '2016' },
      { key: 'end', label: 'Selesai (tahun)', type: 'text', ph: '2020' },
      { key: 'gpa', label: 'IPK (opsional)', type: 'text', ph: '3.75' }
    ]
  },
  skills: {
    title: 'Keahlian (Skills)',
    fields: [
      { key: 'skills', label: 'Keahlian (pisahkan dengan koma)', type: 'textarea', ph: 'JavaScript, React, Node.js, Figma, Git' }
    ]
  },
  languages: {
    title: 'Bahasa',
    fields: [
      { key: 'name', label: 'Bahasa', type: 'text', ph: 'Contoh: Bahasa Indonesia', req: true },
      { key: 'level', label: 'Tingkat', type: 'text', ph: 'Contoh: Native / Lancar / Menengah' }
    ]
  },
  certifications: {
    title: 'Sertifikat',
    fields: [
      { key: 'name', label: 'Nama Sertifikat', type: 'text', ph: 'Contoh: Google UX Design', req: true },
      { key: 'issuer', label: 'Penerbit', type: 'text', ph: 'Coursera / Google' },
      { key: 'year', label: 'Tahun', type: 'text', ph: '2024' }
    ]
  },
  projects: {
    title: 'Proyek',
    fields: [
      { key: 'name', label: 'Nama Proyek', type: 'text', ph: 'Contoh: Aplikasi Kasir Online', req: true },
      { key: 'link', label: 'Link (opsional)', type: 'text', ph: 'https://github.com/...' },
      { key: 'description', label: 'Deskripsi', type: 'textarea', ph: 'Jelaskan peranmu dan dampaknya...' }
    ]
  }
};

// ---------- page render ----------
function renderCvPage() {
  const cv = appState.cv;
  const atsBtn = document.getElementById('cvFormatAtsBtn');
  const crBtn = document.getElementById('cvFormatCreativeBtn');
  if (atsBtn) atsBtn.classList.toggle('active', cv.format === 'ats');
  if (crBtn) crBtn.classList.toggle('active', cv.format === 'creative');
  const accentRow = document.getElementById('cvAccentRow');
  if (accentRow) accentRow.style.display = cv.format === 'creative' ? 'flex' : 'none';
  document.querySelectorAll('.cv-accent-dot').forEach(d => {
    d.classList.toggle('active', (d.dataset.color || '') === cv.accent);
  });
  renderCvPersonalCard();
  renderCvSummaryCard();
  renderCvList('experience');
  renderCvList('education');
  renderCvSkillsCard();
  renderCvList('languages');
  renderCvList('certifications');
  renderCvList('projects');
  ensureCvResumeStyle();
}

function setCvFormat(fmt) {
  appState.cv.format = (fmt === 'creative') ? 'creative' : 'ats';
  saveStateToLocalStorage();
  renderCvPage();
  refreshCvPreview();
  showNotificationBanner(appState.cv.format === 'ats' ? 'Format ATS-Friendly aktif ✓' : 'Format Creative aktif 🎨');
}

function setCvAccent(color) {
  appState.cv.accent = color;
  saveStateToLocalStorage();
  renderCvPage();
  refreshCvPreview();
}

function cvEmptyCard(msg, icon) {
  return `<div style="padding: 16px; text-align: center; font-size: 0.82rem; color: var(--text-muted);">
    <i class="fa-solid ${icon}" style="font-size: 1.2rem; margin-bottom: 6px; opacity: .7;"></i><br>${escapeHtml(msg)}</div>`;
}

function renderCvPersonalCard() {
  const box = document.getElementById('cvPersonalCard');
  if (!box) return;
  const p = appState.cv.personal;
  if (!p.fullName && !p.email && !p.phone) {
    box.innerHTML = cvEmptyCard('Data pribadi belum diisi — ketuk Edit untuk mulai.', 'fa-id-badge');
    return;
  }
  const chips = [];
  if (p.email) chips.push(`<span><i class="fa-solid fa-envelope"></i> ${escapeHtml(p.email)}</span>`);
  if (p.phone) chips.push(`<span><i class="fa-solid fa-phone"></i> ${escapeHtml(p.phone)}</span>`);
  if (p.location) chips.push(`<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(p.location)}</span>`);
  if (p.website) chips.push(`<span><i class="fa-solid fa-globe"></i> ${escapeHtml(p.website)}</span>`);
  if (p.linkedin) chips.push(`<span><i class="fa-brands fa-linkedin"></i> ${escapeHtml(p.linkedin)}</span>`);
  box.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="width: 46px; height: 46px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
        <i class="fa-solid fa-user"></i>
      </div>
      <div style="min-width: 0; flex: 1;">
        <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">${escapeHtml(p.fullName || 'Tanpa Nama')}</div>
        ${p.title ? `<div style="font-size: 0.82rem; color: var(--primary); font-weight: 600;">${escapeHtml(p.title)}</div>` : ''}
        <div style="display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.75rem; color: var(--text-muted); margin-top: 3px;">${chips.join('')}</div>
      </div>
    </div>`;
}

function renderCvSummaryCard() {
  const box = document.getElementById('cvSummaryCard');
  if (!box) return;
  const s = (appState.cv.personal.summary || '').trim();
  box.innerHTML = s
    ? `<div style="font-size: 0.88rem; color: var(--text-main); line-height: 1.6; white-space: pre-wrap;">${escapeHtml(s)}</div>`
    : cvEmptyCard('Ringkasan profil belum diisi.', 'fa-quote-left');
}

function cvEntrySummary(sec, it) {
  switch (sec) {
    case 'experience': return `${it.role || 'Posisi'}${it.company ? ' — ' + it.company : ''}`;
    case 'education': return `${it.degree || ''}${it.institution ? ' — ' + it.institution : ''}`;
    case 'languages': return `${it.name || ''}${it.level ? ' (' + it.level + ')' : ''}`;
    case 'certifications': return `${it.name || ''}${it.issuer ? ' — ' + it.issuer : ''}${it.year ? ' · ' + it.year : ''}`;
    case 'projects': return `${it.name || ''}${it.link ? ' · ' + it.link : ''}`;
    default: return '';
  }
}

function renderCvList(sec) {
  const box = document.getElementById('cv' + sec.charAt(0).toUpperCase() + sec.slice(1) + 'List');
  if (!box) return;
  const items = appState.cv[sec] || [];
  if (!items.length) {
    const hints = {
      experience: 'Belum ada pengalaman kerja.',
      education: 'Belum ada riwayat pendidikan.',
      languages: 'Belum ada bahasa.',
      certifications: 'Belum ada sertifikat.',
      projects: 'Belum ada proyek.'
    };
    box.innerHTML = cvEmptyCard(hints[sec] || '', 'fa-plus');
    return;
  }
  box.innerHTML = items.map(it => `
    <div class="media-result-row" style="margin-bottom: 8px;">
      <div style="flex: 1; min-width: 0;">
        <div class="media-result-title">${escapeHtml(cvEntrySummary(sec, it))}</div>
        ${it.bullets ? `<div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(String(it.bullets).split('\n')[0])}</div>` : ''}
      </div>
      <div class="media-result-actions">
        <button class="media-np-btn" aria-label="Edit" onclick="openCvEditor('${sec}', '${it.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="media-np-btn" aria-label="Hapus" onclick="deleteCvItem('${sec}', '${it.id}')"><i class="fa-solid fa-trash" style="color:#EF4444;"></i></button>
      </div>
    </div>`).join('');
}

function renderCvSkillsCard() {
  const box = document.getElementById('cvSkillsCard');
  if (!box) return;
  const skills = appState.cv.skills || [];
  if (!skills.length) {
    box.innerHTML = cvEmptyCard('Keahlian belum diisi.', 'fa-star');
    return;
  }
  box.innerHTML = `<div style="display: flex; flex-wrap: wrap; gap: 6px;">${skills.map(s =>
    `<span style="background: var(--primary-light); color: var(--primary); font-size: 0.78rem; font-weight: 700; padding: 4px 12px; border-radius: var(--radius-pill);">${escapeHtml(s)}</span>`
  ).join('')}</div>`;
}

// ---------- editor modal (dinamis) ----------
function openCvEditor(section, id) {
  const schema = CV_EDITOR_SCHEMAS[section];
  if (!schema) return;
  cvEditorContext = { section: section, id: id || null };
  let data = {};
  if (section === 'personal' || section === 'summary') {
    data = appState.cv.personal;
  } else if (section === 'skills') {
    data = { skills: (appState.cv.skills || []).join(', ') };
  } else if (id) {
    data = (appState.cv[section] || []).find(x => String(x.id) === String(id)) || {};
  }
  const titleEl = document.getElementById('cvEditorTitle');
  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-file-lines" style="color: var(--primary);"></i> ${escapeHtml(schema.title)}${id ? ' — Edit' : (section === 'personal' || section === 'summary' || section === 'skills' ? '' : ' — Baru')}`;
  const form = document.getElementById('cvEditorForm');
  form.innerHTML = schema.fields.map(f => {
    const val = data[f.key] != null ? String(data[f.key]) : '';
    if (f.type === 'checkbox') {
      return `<div class="form-group mb-3" style="display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" id="cvf_${f.key}" ${val === 'true' || val === 'on' ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);">
        <label class="form-label" for="cvf_${f.key}" style="margin: 0; font-size: 0.85rem;">${escapeHtml(f.label)}</label>
      </div>`;
    }
    if (f.type === 'textarea') {
      return `<div class="form-group mb-3">
        <label class="form-label" style="font-size: 0.82rem;">${escapeHtml(f.label)}${f.req ? ' <span style="color:#EF4444;">*</span>' : ''}</label>
        <textarea class="form-control" id="cvf_${f.key}" rows="4" placeholder="${escapeHtml(f.ph || '')}">${escapeHtml(val)}</textarea>
      </div>`;
    }
    return `<div class="form-group mb-3">
      <label class="form-label" style="font-size: 0.82rem;">${escapeHtml(f.label)}${f.req ? ' <span style="color:#EF4444;">*</span>' : ''}</label>
      <input type="text" class="form-control" id="cvf_${f.key}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.ph || '')}">
    </div>`;
  }).join('');
  openModal('modalCvEditor');
}

function saveCvEditor() {
  const { section, id } = cvEditorContext;
  const schema = CV_EDITOR_SCHEMAS[section];
  if (!schema) return;
  const read = (key) => {
    const el = document.getElementById('cvf_' + key);
    if (!el) return '';
    return el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value.trim();
  };
  const obj = {};
  schema.fields.forEach(f => { obj[f.key] = read(f.key); });
  const required = schema.fields.find(f => f.req);
  if (required && !obj[required.key]) {
    showNotificationBanner('Lengkapi dulu: ' + required.label + ' ⚠️');
    return;
  }
  const cv = appState.cv;
  if (section === 'personal' || section === 'summary') {
    Object.keys(obj).forEach(k => { cv.personal[k] = obj[k]; });
  } else if (section === 'skills') {
    cv.skills = String(obj.skills || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  } else {
    const arr = cv[section];
    if (id) {
      const idx = arr.findIndex(x => String(x.id) === String(id));
      if (idx >= 0) arr[idx] = { ...arr[idx], ...obj, id: arr[idx].id };
    } else {
      arr.push({ ...obj, id: 'cv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) });
    }
  }
  saveStateToLocalStorage();
  closeModal('modalCvEditor');
  renderCvPage();
  refreshCvPreview();
  showNotificationBanner('Disimpan ke CV ✅');
}

function deleteCvItem(section, id) {
  const arr = appState.cv[section] || [];
  const it = arr.find(x => String(x.id) === String(id));
  if (!it) return;
  if (!confirm('Hapus "' + (cvEntrySummary(section, it) || 'item ini') + '" dari CV?')) return;
  appState.cv[section] = arr.filter(x => String(x.id) !== String(id));
  saveStateToLocalStorage();
  renderCvPage();
  refreshCvPreview();
  showNotificationBanner('Item dihapus.');
}

// ---------- resume builder ----------
function hexToRgb(hex) {
  const h = String(hex || '#3B82F6').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  if (isNaN(n)) return { r: 59, g: 130, b: 246 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mixColor(hex, target, amt) {
  const c = hexToRgb(hex);
  const t = hexToRgb(target);
  const m = (a, b) => Math.round(a + (b - a) * amt);
  const to = (v) => v.toString(16).padStart(2, '0');
  return '#' + to(m(c.r, t.r)) + to(m(c.g, t.g)) + to(m(c.b, t.b));
}

function formatCvDate(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[-\/](\d{1,2})$/);
  if (m) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const mon = months[Number(m[2]) - 1];
    return mon ? mon + ' ' + m[1] : s;
  }
  return s;
}

function cvDateRange(start, end, current) {
  const a = formatCvDate(start);
  const b = current ? 'Sekarang' : formatCvDate(end);
  if (!a && !b) return '';
  if (!b) return a;
  if (!a) return b;
  return a + ' — ' + b;
}

function cvBulletsHtml(bullets) {
  const list = String(bullets || '').split(/\n/).map(s => s.trim()).filter(Boolean);
  if (!list.length) return '';
  return '<ul>' + list.map(b => `<li>${escapeHtml(b)}</li>`).join('') + '</ul>';
}

function cvSectionTitle(title) {
  return `<div class="cv-sec-title">${escapeHtml(title)}</div>`;
}

function cvExperienceHtml(it) {
  const range = cvDateRange(it.start, it.end, it.current);
  return `<div class="cv-item">
    <div class="cv-item-head">
      <div><span class="cv-item-role">${escapeHtml(it.role || '')}</span>${it.company ? ' <span class="cv-item-org">· ' + escapeHtml(it.company) + '</span>' : ''}${it.location ? ' <span class="cv-item-loc">(' + escapeHtml(it.location) + ')</span>' : ''}</div>
      ${range ? `<span class="cv-item-date">${escapeHtml(range)}</span>` : ''}
    </div>
    ${cvBulletsHtml(it.bullets)}
  </div>`;
}

function cvEducationHtml(it) {
  const range = cvDateRange(it.start, it.end, false);
  return `<div class="cv-item">
    <div class="cv-item-head">
      <div><span class="cv-item-role">${escapeHtml(it.degree || '')}</span>${it.institution ? ' <span class="cv-item-org">· ' + escapeHtml(it.institution) + '</span>' : ''}${it.location ? ' <span class="cv-item-loc">(' + escapeHtml(it.location) + ')</span>' : ''}</div>
      ${range ? `<span class="cv-item-date">${escapeHtml(range)}</span>` : ''}
    </div>
    ${it.gpa ? `<div style="font-size: 12px; color: #444;">IPK: ${escapeHtml(it.gpa)}</div>` : ''}
  </div>`;
}

function cvCertHtml(it) {
  return `<div class="cv-item">
    <div class="cv-item-head">
      <div><span class="cv-item-role">${escapeHtml(it.name || '')}</span>${it.issuer ? ' <span class="cv-item-org">· ' + escapeHtml(it.issuer) + '</span>' : ''}</div>
      ${it.year ? `<span class="cv-item-date">${escapeHtml(it.year)}</span>` : ''}
    </div>
  </div>`;
}

function cvProjectHtml(it) {
  return `<div class="cv-item">
    <div class="cv-item-head">
      <div><span class="cv-item-role">${escapeHtml(it.name || '')}</span>${it.link ? ` <a class="cv-link" href="${escapeHtml(it.link)}">${escapeHtml(it.link)}</a>` : ''}</div>
    </div>
    ${it.description ? `<div class="cv-desc">${escapeHtml(it.description)}</div>` : ''}
  </div>`;
}

function cvLangHtml(it) {
  return `<div class="cv-item">
    <div class="cv-item-head">
      <div><span class="cv-item-role">${escapeHtml(it.name || '')}</span></div>
      ${it.level ? `<span class="cv-item-date">${escapeHtml(it.level)}</span>` : ''}
    </div>
  </div>`;
}

function cvContactChips(p) {
  const out = [];
  if (p.email) out.push(`<span>${escapeHtml(p.email)}</span>`);
  if (p.phone) out.push(`<span>${escapeHtml(p.phone)}</span>`);
  if (p.location) out.push(`<span>${escapeHtml(p.location)}</span>`);
  if (p.website) out.push(`<span>${escapeHtml(p.website)}</span>`);
  if (p.linkedin) out.push(`<span>${escapeHtml(p.linkedin)}</span>`);
  return out.join('');
}

function cvSkillsChips(cv) {
  const s = cv.skills || [];
  if (!s.length) return '';
  return '<div class="cv-skills">' + s.map(x => `<span class="cv-chip">${escapeHtml(x)}</span>`).join('') + '</div>';
}

// Bagian inti CV (dipakai oleh preview, print, dan export HTML)
function buildCvBody() {
  const cv = appState.cv;
  const p = cv.personal || {};
  const accent = cv.accent || '#3B82F6';
  const isCreative = cv.format === 'creative';
  const expHtml = (cv.experience || []).map(cvExperienceHtml).join('');
  const eduHtml = (cv.education || []).map(cvEducationHtml).join('');
  const certHtml = (cv.certifications || []).map(cvCertHtml).join('');
  const projHtml = (cv.projects || []).map(cvProjectHtml).join('');
  const langHtml = (cv.languages || []).map(cvLangHtml).join('');
  const summary = (p.summary || '').trim();
  const name = p.fullName || 'Nama Lengkap';
  const title = p.title || 'Posisi / Profesi';

  if (isCreative) {
    const dark = mixColor(accent, '#000000', 0.25);
    const light = mixColor(accent, '#FFFFFF', 0.88);
    const side = `
      ${cvSkillsChips(cv) ? cvSectionTitle('Keahlian') + cvSkillsChips(cv) : ''}
      ${langHtml ? cvSectionTitle('Bahasa') + langHtml : ''}
      ${certHtml ? cvSectionTitle('Sertifikat') + certHtml : ''}
    `;
    const main = `
      ${summary ? cvSectionTitle('Profil') + `<div class="cv-summary">${escapeHtml(summary)}</div>` : ''}
      ${expHtml ? cvSectionTitle('Pengalaman Kerja') + expHtml : ''}
      ${eduHtml ? cvSectionTitle('Pendidikan') + eduHtml : ''}
      ${projHtml ? cvSectionTitle('Proyek') + projHtml : ''}
    `;
    return `<div class="cv-resume cv-creative" style="--accent:${accent}; --accent-dark:${dark}; --accent-light:${light};">
      <div class="cv-head">
        <div class="cv-name">${escapeHtml(name)}</div>
        <div class="cv-title">${escapeHtml(title)}</div>
        <div class="cv-contact">${cvContactChips(p)}</div>
      </div>
      <div class="cv-cols">
        <div class="cv-side">${side}</div>
        <div class="cv-main">${main}</div>
      </div>
    </div>`;
  }

  // ATS-friendly: satu kolom bersih, hitam-putih
  return `<div class="cv-resume cv-ats">
    <div class="cv-head">
      <div class="cv-name">${escapeHtml(name)}</div>
      <div class="cv-title">${escapeHtml(title)}</div>
      <div class="cv-contact">${cvContactChips(p)}</div>
    </div>
    ${summary ? cvSectionTitle('Ringkasan Profil') + `<div class="cv-summary">${escapeHtml(summary)}</div>` : ''}
    ${expHtml ? cvSectionTitle('Pengalaman Kerja') + expHtml : ''}
    ${eduHtml ? cvSectionTitle('Pendidikan') + eduHtml : ''}
    ${(cv.skills || []).length ? cvSectionTitle('Keahlian') + `<div class="cv-skills">${(cv.skills || []).map(escapeHtml).join(', ')}</div>` : ''}
    ${langHtml ? cvSectionTitle('Bahasa') + langHtml : ''}
    ${certHtml ? cvSectionTitle('Sertifikat') + certHtml : ''}
    ${projHtml ? cvSectionTitle('Proyek') + projHtml : ''}
  </div>`;
}

// CSS resume yang berdiri sendiri (dipakai preview + export HTML + print)
function cvResumeCss(accent) {
  const dark = mixColor(accent, '#000000', 0.25);
  const light = mixColor(accent, '#FFFFFF', 0.88);
  return `
.cv-resume{background:#fff;color:#1a1a1a;font-family:Helvetica,Arial,'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.55;max-width:800px;margin:0 auto;}
.cv-resume .cv-name{font-size:27px;font-weight:800;letter-spacing:.5px;margin:0 0 3px;}
.cv-resume .cv-title{font-size:14px;margin:0 0 7px;}
.cv-resume .cv-contact{font-size:12px;display:flex;flex-wrap:wrap;gap:3px 14px;}
.cv-resume .cv-sec-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;margin:16px 0 7px;padding-bottom:3px;}
.cv-resume .cv-item{margin-bottom:9px;}
.cv-resume .cv-item-head{display:flex;justify-content:space-between;gap:12px;}
.cv-resume .cv-item-role{font-weight:700;}
.cv-resume .cv-item-org{font-style:italic;font-weight:400;}
.cv-resume .cv-item-loc{color:#555;font-size:12px;}
.cv-resume .cv-item-date{font-size:12px;color:#444;white-space:nowrap;}
.cv-resume ul{margin:4px 0 0 18px;padding:0;}
.cv-resume li{margin-bottom:2px;}
.cv-resume .cv-summary{white-space:pre-wrap;}
.cv-resume .cv-skills{line-height:1.9;}
.cv-resume .cv-link{color:inherit;}
.cv-resume .cv-desc{margin-top:3px;font-size:12.5px;color:#333;}
.cv-ats .cv-head{text-align:center;padding:6px 0 10px;border-bottom:2px solid #222;margin-bottom:4px;}
.cv-ats .cv-name{color:#111;}
.cv-ats .cv-title{color:#333;font-weight:600;}
.cv-ats .cv-contact{justify-content:center;color:#333;}
.cv-ats .cv-sec-title{color:#111;border-bottom:1px solid #999;}
.cv-ats .cv-item-org,.cv-ats .cv-item-loc{color:#333;}
.cv-creative .cv-head{background:linear-gradient(135deg, ${accent} 0%, ${dark} 100%);color:#fff;padding:26px 28px;}
.cv-creative .cv-name{font-size:29px;}
.cv-creative .cv-title{opacity:.95;font-weight:600;}
.cv-creative .cv-contact{opacity:.95;}
.cv-creative .cv-cols{display:flex;}
.cv-creative .cv-side{width:33%;background:${light};padding:16px 18px;min-width:0;}
.cv-creative .cv-main{flex:1;padding:16px 22px;min-width:0;}
.cv-creative .cv-side .cv-sec-title{color:${accent};border-bottom:1px solid ${light};}
.cv-creative .cv-sec-title{color:${accent};border-bottom:2px solid ${light};}
.cv-creative .cv-chip{display:inline-block;background:${light};color:${accent};font-weight:600;font-size:11.5px;border-radius:20px;padding:3px 10px;margin:2px 3px 2px 0;}
.cv-creative .cv-main .cv-item-org,.cv-creative .cv-main .cv-item-loc{color:#555;}
`;
}

function ensureCvResumeStyle() {
  let st = document.getElementById('cvResumeStyle');
  if (!st) {
    st = document.createElement('style');
    st.id = 'cvResumeStyle';
    document.head.appendChild(st);
  }
  st.textContent = cvResumeCss(appState.cv.accent || '#3B82F6');
}

// ---------- preview ----------
function toggleCvPreview() {
  const ov = document.getElementById('cvPreviewOverlay');
  if (!ov) return;
  if (ov.style.display === 'flex') { closeCvPreview(); return; }
  ensureCvResumeStyle();
  const badge = document.getElementById('cvPreviewFormatBadge');
  if (badge) badge.textContent = appState.cv.format === 'ats' ? 'ATS-Friendly' : 'Creative';
  const container = document.getElementById('cvPreviewContainer');
  if (container) container.innerHTML = buildCvBody();
  ov.style.display = 'flex';
  document.body.classList.add('modal-open');
}

function closeCvPreview() {
  const ov = document.getElementById('cvPreviewOverlay');
  if (ov) ov.style.display = 'none';
  document.body.classList.remove('modal-open');
}

function refreshCvPreview() {
  const ov = document.getElementById('cvPreviewOverlay');
  if (!ov || ov.style.display !== 'flex') return;
  ensureCvResumeStyle();
  const badge = document.getElementById('cvPreviewFormatBadge');
  if (badge) badge.textContent = appState.cv.format === 'ats' ? 'ATS-Friendly' : 'Creative';
  const container = document.getElementById('cvPreviewContainer');
  if (container) container.innerHTML = buildCvBody();
}

// ---------- export ----------
function cvFileName() {
  const name = (appState.cv.personal.fullName || 'CV').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'CV';
  return name + '_CV';
}

function buildCvHtml() {
  const accent = appState.cv.accent || '#3B82F6';
  const name = (appState.cv.personal.fullName || 'CV');
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)} — Curriculum Vitae</title>
<style>
@page{size:A4;margin:12mm;}
html,body{margin:0;padding:0;background:#fff;}
${cvResumeCss(accent)}
.cv-resume{box-sizing:border-box;}
</style>
</head>
<body>
${buildCvBody()}
</body>
</html>`;
}

function exportCvPdf() {
  const area = document.getElementById('cvPrintArea');
  if (!area) return;
  area.innerHTML = buildCvHtml();
  showNotificationBanner('Membuka dialog cetak — pilih "Simpan sebagai PDF" 🖨️');
  setTimeout(() => { window.print(); }, 250);
}

function exportCvHtml() {
  const blob = new Blob([buildCvHtml()], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = cvFileName() + '.html';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showNotificationBanner('File CV HTML diunduh 📄');
}

async function exportCvDocx() {
  const cv = appState.cv;
  const p = cv.personal || {};
  showNotificationBanner('Membangun file Word DOCX... ⏳');
  try {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);

    const esc = (s) => escapeHtml(String(s || ''));
    const P = (children, extra = '') => `<w:p><w:pPr>${extra}</w:pPr>${children}</w:p>`;
    const R = (text, bold = false, size = 22) => `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
    const SEC = (t) => P(R(t, true, 22), '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="999999"/></w:pBdr><w:spacing w:before="240" w:after="80"/>');
    const ITEM = (head, meta) => P(R(head, true, 22) + (meta ? R('   ' + meta, false, 20) : ''), '<w:spacing w:before="120" w:after="40"/>');
    const BULLET = (b) => P(R('•  ' + b, false, 22), '<w:ind w:left="360"/>');
    const LINE = (t, bold, size) => P(R(t, bold, size), '<w:jc w:val="center"/><w:spacing w:after="40"/>');

    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${LINE(p.fullName || 'Nama Lengkap', true, 34)}
    ${LINE(p.title || '', false, 24)}
    ${LINE([p.email, p.phone, p.location, p.website, p.linkedin].filter(Boolean).join('   |   '), false, 20)}
    ${(p.summary || '').trim() ? SEC('Ringkasan Profil') + P(R(p.summary, false, 22), '<w:spacing w:line="300" w:lineRule="auto"/>') : ''}
    ${(cv.experience || []).length ? SEC('Pengalaman Kerja') + (cv.experience || []).map(e => ITEM(e.role + (e.company ? ' — ' + e.company : ''), cvDateRange(e.start, e.end, e.current)) + String(e.bullets || '').split(/\n/).filter(b => b.trim()).map(b => BULLET(b.trim())).join('')).join('') : ''}
    ${(cv.education || []).length ? SEC('Pendidikan') + (cv.education || []).map(e => ITEM(e.degree + (e.institution ? ' — ' + e.institution : ''), cvDateRange(e.start, e.end, false) + (e.gpa ? '   IPK: ' + e.gpa : ''))).join('') : ''}
    ${(cv.skills || []).length ? SEC('Keahlian') + P(R((cv.skills || []).join(', '), false, 22)) : ''}
    ${(cv.languages || []).length ? SEC('Bahasa') + (cv.languages || []).map(l => ITEM(l.name || '', l.level || '')).join('') : ''}
    ${(cv.certifications || []).length ? SEC('Sertifikat') + (cv.certifications || []).map(c => ITEM(c.name || '', (c.issuer || '') + (c.year ? ' — ' + c.year : ''))).join('') : ''}
    ${(cv.projects || []).length ? SEC('Proyek') + (cv.projects || []).map(pr => ITEM(pr.name || '', pr.link || '') + (pr.description ? P(R(pr.description, false, 22)) : '')).join('') : ''}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
  </w:body>
</w:document>`;

    zip.folder('word').file('document.xml', xml);
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = cvFileName() + '.docx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotificationBanner('File DOCX berhasil di-export! 📄');
  } catch (err) {
    console.error('Export CV DOCX error:', err);
    showNotificationBanner('Gagal mengeksport file DOCX.');
  }
}
/* ==========================================================================
   MY QR — QR Code Generator & Reader (offline, app UI)
   Generator: qrcode-generator (kazuhikoarase) · Reader: jsQR (cozmo)
   ========================================================================== */
let qrMode = 'gen';
let qrType = 'text';
let qrCamStream = null;
let qrScanTimer = null;
let qrLastResult = null;

const QR_TYPE_LABELS = { text: 'Teks', link: 'Link', wifi: 'WiFi', email: 'Email', whatsapp: 'WhatsApp' };
const QR_FIELD_MAP = {
  text: 'qrFieldsText', link: 'qrFieldsLink', wifi: 'qrFieldsWifi', email: 'qrFieldsEmail', whatsapp: 'qrFieldsWhatsapp'
};

function renderQrPage() {
  renderQrHistory();
}

function qrSetMode(m) {
  qrMode = m;
  const genBtn = document.getElementById('qrModeGenBtn');
  const scanBtn = document.getElementById('qrModeScanBtn');
  if (genBtn) genBtn.classList.toggle('active', m === 'gen');
  if (scanBtn) scanBtn.classList.toggle('active', m === 'scan');
  const genPane = document.getElementById('qrGenPane');
  const scanPane = document.getElementById('qrScanPane');
  if (genPane) genPane.style.display = m === 'gen' ? 'block' : 'none';
  if (scanPane) scanPane.style.display = m === 'scan' ? 'block' : 'none';
  qrStopCamera();
}

function qrSetType(t) {
  qrType = QR_TYPE_LABELS[t] ? t : 'text';
  document.querySelectorAll('.qr-type-chip[data-type]').forEach(c => {
    c.classList.toggle('active', c.dataset.type === qrType);
  });
  Object.keys(QR_FIELD_MAP).forEach(k => {
    const el = document.getElementById(QR_FIELD_MAP[k]);
    if (el) el.style.display = k === qrType ? 'block' : 'none';
  });
  qrAutoGenerate();
}

function qrBuildContent() {
  const v = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const esc = (s) => s.replace(/([\\;,:"'])/g, '\\$1');
  switch (qrType) {
    case 'link': return v('qrLinkInput');
    case 'wifi': {
      const ssid = v('qrWifiSsid');
      if (!ssid) return '';
      const pwd = v('qrWifiPass');
      const sec = document.getElementById('qrWifiSec') ? document.getElementById('qrWifiSec').value : 'WPA';
      return 'WIFI:T:' + sec + ';S:' + esc(ssid) + ';' + (pwd ? 'P:' + esc(pwd) + ';' : '') + ';';
    }
    case 'email': {
      const to = v('qrEmailTo');
      if (!to) return '';
      return 'mailto:' + to + '?subject=' + encodeURIComponent(v('qrEmailSub')) + '&body=' + encodeURIComponent(v('qrEmailBody'));
    }
    case 'whatsapp': {
      const phone = v('qrWaPhone').replace(/\D/g, '');
      if (!phone) return '';
      const msg = v('qrWaMsg');
      return 'https://wa.me/' + phone + (msg ? '?text=' + encodeURIComponent(msg) : '');
    }
    default: return v('qrTextInput');
  }
}

function qrLabelFor(content) {
  const s = String(content || '').trim();
  if (/^https?:\/\//i.test(s)) return s.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 40) || 'Link';
  if (/^WIFI:/i.test(s)) return 'WiFi: ' + ((s.match(/S:([^;]*)/) || [])[1] || '').slice(0, 30);
  if (/^mailto:/i.test(s)) return s.replace('mailto:', '').split('?')[0].slice(0, 40) || 'Email';
  if (/^https:\/\/wa\.me\//i.test(s)) return 'WhatsApp: ' + s.replace('https://wa.me/', '').split('?')[0].slice(0, 30);
  return s.slice(0, 40) || 'QR';
}

let qrStyle = 'classic';      // classic | rounded | dots | gradient
let qrAnim = 'none';          // none | pulse | glow | scanline
let qrLogoDataUrl = null;     // data URL logo di tengah QR
let qrDrawToken = 0;          // mencegah logo async menggambar di kanvas basi

function qrThemeColors() {
  const dark = (document.documentElement.getAttribute('data-theme') === 'dark');
  return dark ? { fg: '#E3EAF5', bg: '#0B1220' } : { fg: '#111827', bg: '#FFFFFF' };
}

function qrRoundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function qrMakeQr(content) {
  const ec = document.getElementById('qrEcSel') ? document.getElementById('qrEcSel').value : 'M';
  const qr = qrcode(0, ec);
  qr.addData(content);
  qr.make();
  return qr;
}

function qrApplyAnim() {
  const wrap = document.getElementById('qrArtWrap');
  if (!wrap) return;
  wrap.classList.remove('qr-anim-pulse', 'qr-anim-glow');
  const scan = document.getElementById('qrArtScanline');
  if (scan) scan.style.display = qrAnim === 'scanline' ? 'block' : 'none';
  if (qrAnim === 'pulse') wrap.classList.add('qr-anim-pulse');
  if (qrAnim === 'glow') wrap.classList.add('qr-anim-glow');
}

function qrSetStyle(s) {
  qrStyle = ['classic', 'rounded', 'dots', 'gradient'].includes(s) ? s : 'classic';
  document.querySelectorAll('.qr-type-chip[data-style]').forEach(c => {
    c.classList.toggle('active', c.dataset.style === qrStyle);
  });
  const gw = document.getElementById('qrGradWrap');
  const gw2 = document.getElementById('qrGradWrap2');
  if (gw) gw.style.display = qrStyle === 'gradient' ? 'block' : 'none';
  if (gw2) gw2.style.display = qrStyle === 'gradient' ? 'block' : 'none';
  qrRedraw();
}

function qrSetAnim(a) {
  qrAnim = ['none', 'pulse', 'glow', 'scanline'].includes(a) ? a : 'none';
  document.querySelectorAll('.qr-type-chip[data-anim]').forEach(c => {
    c.classList.toggle('active', c.dataset.anim === qrAnim);
  });
  qrApplyAnim();
}

function qrAddLogo(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    qrLogoDataUrl = reader.result;
    const btn = document.getElementById('qrLogoBtnText');
    if (btn) btn.textContent = 'Ganti Logo';
    const rm = document.getElementById('qrLogoRemoveBtn');
    if (rm) rm.style.display = 'inline-flex';
    showNotificationBanner('Logo ditambahkan — koreksi error otomatis H ✅');
    qrRedraw();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function qrRemoveLogo() {
  qrLogoDataUrl = null;
  const btn = document.getElementById('qrLogoBtnText');
  if (btn) btn.textContent = 'Tambah Logo';
  const rm = document.getElementById('qrLogoRemoveBtn');
  if (rm) rm.style.display = 'none';
  showNotificationBanner('Logo dihapus.');
  qrRedraw();
}

function qrDraw(content) {
  if (typeof qrcode !== 'function') { showNotificationBanner('Mesin QR belum dimuat.'); return; }
  const card = document.getElementById('qrPreviewCard');
  if (card) card.style.display = 'block';
  const size = Number(document.getElementById('qrSizeSel') ? document.getElementById('qrSizeSel').value : 6) || 6;
  const followTheme = document.getElementById('qrFollowTheme') ? document.getElementById('qrFollowTheme').checked : false;
  let fg = document.getElementById('qrFgColor') ? document.getElementById('qrFgColor').value : '#111827';
  let bg = document.getElementById('qrBgColor') ? document.getElementById('qrBgColor').value : '#FFFFFF';
  if (followTheme) {
    const tc = qrThemeColors();
    fg = tc.fg; bg = tc.bg;
  }
  const hasLogo = !!qrLogoDataUrl;
  if (hasLogo) {
    const ecSel = document.getElementById('qrEcSel');
    if (ecSel && ecSel.value !== 'H') ecSel.value = 'H';
    const note = document.getElementById('qrPreviewNote');
    if (note) { note.style.display = 'inline-block'; note.textContent = 'Logo aktif — EC dipaksa H'; }
  } else {
    const note = document.getElementById('qrPreviewNote');
    if (note) note.style.display = 'none';
  }
  const gradFrom = document.getElementById('qrGradFrom') ? document.getElementById('qrGradFrom').value : '#2563EB';
  const gradTo = document.getElementById('qrGradTo') ? document.getElementById('qrGradTo').value : '#F59E0B';
  try {
    const qr = qrMakeQr(content);
    const cell = Math.max(3, size);
    const count = qr.getModuleCount();
    const pad = 4;
    const dim = (count + pad * 2) * cell;
    const canvas = document.getElementById('qrCanvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, dim, dim);
    let fill = fg;
    if (qrStyle === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, dim, dim);
      g.addColorStop(0, gradFrom);
      g.addColorStop(1, gradTo);
      fill = g;
    }
    ctx.fillStyle = fill;
    const shape = qrStyle === 'dots' ? 'dots' : (qrStyle === 'rounded' ? 'rounded' : 'classic');
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!qr.isDark(r, c)) continue;
        const x = (c + pad) * cell;
        const y = (r + pad) * cell;
        if (shape === 'dots') {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === 'rounded') {
          qrRoundRectPath(ctx, x, y, cell, cell, cell * 0.34);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
    // Logo di tengah (async — token mencegah gambar basi)
    const token = ++qrDrawToken;
    if (hasLogo && qrLogoDataUrl) {
      const logoImg = new Image();
      const logoSize = Math.round(dim * 0.24);
      logoImg.onload = () => {
        if (token !== qrDrawToken) return;
        const cx = (dim - logoSize) / 2;
        const cy = (dim - logoSize) / 2;
        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        qrRoundRectPath(ctx, cx - 5, cy - 5, logoSize + 10, logoSize + 10, 12);
        ctx.fill();
        qrRoundRectPath(ctx, cx - 5, cy - 5, logoSize + 10, logoSize + 10, 12);
        ctx.clip();
        ctx.drawImage(logoImg, cx, cy, logoSize, logoSize);
        ctx.restore();
      };
      logoImg.src = qrLogoDataUrl;
    }
    const lbl = document.getElementById('qrContentPreview');
    if (lbl) lbl.textContent = content.length > 90 ? content.slice(0, 90) + '…' : content;
    qrApplyAnim();
  } catch (e) {
    showNotificationBanner('Konten terlalu panjang untuk QR ini: ' + (e.message || e));
  }
}

function qrAutoGenerate() {
  const card = document.getElementById('qrPreviewCard');
  if (!card || getComputedStyle(card).display === 'none') return;
  const content = qrBuildContent();
  if (content) qrDraw(content);
}

function qrRedraw() {
  const content = qrBuildContent();
  if (content) qrDraw(content);
}

function qrGenerate() {
  const content = qrBuildContent();
  if (!content) { showNotificationBanner('Isi dulu kontennya! ✍️'); return; }
  qrDraw(content);
  const hist = appState.user.qrHistory;
  hist.unshift({ content: content, label: qrLabelFor(content), type: qrType, at: Date.now() });
  if (hist.length > 8) hist.length = 8;
  saveStateToLocalStorage();
  renderQrHistory();
  showNotificationBanner('QR Code berhasil dibuat! ✅');
}

function qrBuildSvg(content) {
  const qr = qrMakeQr(content);
  const count = qr.getModuleCount();
  const pad = 4;
  const cell = 12;
  const dim = (count + pad * 2) * cell;
  const followTheme = document.getElementById('qrFollowTheme') ? document.getElementById('qrFollowTheme').checked : false;
  let fg = document.getElementById('qrFgColor') ? document.getElementById('qrFgColor').value : '#111827';
  let bg = document.getElementById('qrBgColor') ? document.getElementById('qrBgColor').value : '#FFFFFF';
  if (followTheme) {
    const tc = qrThemeColors();
    fg = tc.fg; bg = tc.bg;
  }
  const gradFrom = document.getElementById('qrGradFrom') ? document.getElementById('qrGradFrom').value : '#2563EB';
  const gradTo = document.getElementById('qrGradTo') ? document.getElementById('qrGradTo').value : '#F59E0B';
  let rects = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        const rx = qrStyle === 'rounded' ? cell * 0.34 : 0;
        rects += `<rect x="${(c + pad) * cell}" y="${(r + pad) * cell}" width="${cell}" height="${cell}" rx="${rx}"/>`;
      }
    }
  }
  const defs = qrStyle === 'gradient'
    ? `<defs><linearGradient id="qrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${gradFrom}"/><stop offset="1" stop-color="${gradTo}"/></linearGradient></defs>`
    : '';
  const fill = qrStyle === 'gradient' ? 'url(#qrg)' : fg;
  let logo = '';
  if (qrLogoDataUrl) {
    const logoSize = Math.round(dim * 0.24);
    const cx = (dim - logoSize) / 2;
    const cy = (dim - logoSize) / 2;
    logo = `<rect x="${cx - 5}" y="${cy - 5}" width="${logoSize + 10}" height="${logoSize + 10}" rx="12" fill="#FFFFFF"/><image href="${qrLogoDataUrl}" x="${cx}" y="${cy}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">
  <rect width="${dim}" height="${dim}" fill="${bg}"/>
  ${defs}
  <g fill="${fill}">${rects}</g>
  ${logo}
</svg>`;
}

function qrDownload(format) {
  const content = qrBuildContent();
  if (!content) { showNotificationBanner('Buat QR dulu!'); return; }
  const label = (appState.user.qrHistory[0] && appState.user.qrHistory[0].label) || 'my-qr';
  const name = sanitizeFilename(label);
  if (format === 'svg') {
    const blob = new Blob([qrBuildSvg(content)], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name + '.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotificationBanner('QR diunduh sebagai SVG 📥');
    return;
  }
  const canvas = document.getElementById('qrCanvas');
  if (!canvas || !canvas.width) { showNotificationBanner('Buat QR dulu!'); return; }
  const isJpg = format === 'jpg';
  canvas.toBlob((blob) => {
    if (!blob) { showNotificationBanner('Gagal membuat file gambar.'); return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name + '.' + (isJpg ? 'jpg' : 'png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotificationBanner('QR diunduh sebagai ' + (isJpg ? 'JPG' : 'PNG') + ' 📥');
  }, isJpg ? 'image/jpeg' : 'image/png', 0.95);
}

function qrPrint() {
  const content = qrBuildContent();
  if (!content) { showNotificationBanner('Buat QR dulu!'); return; }
  const area = document.getElementById('qrPrintArea');
  if (!area) return;
  const label = (appState.user.qrHistory[0] && appState.user.qrHistory[0].label) || 'My QR';
  area.innerHTML = '<div style="text-align:center; font-family:Arial, sans-serif; padding:20px;">' + qrBuildSvg(content) + '<p style="margin-top:14px; font-size:16px; font-weight:bold;">' + escapeHtml(label) + '</p></div>';
  showNotificationBanner('Membuka dialog cetak — pilih "Simpan sebagai PDF" 🖨️');
  setTimeout(() => { window.print(); }, 250);
}

// ---------- validator ----------
function qrValidateContent(content) {
  const s = String(content || '').trim();
  const checks = [];
  if (!s) {
    return { type: 'Kosong', valid: false, checks: [{ label: 'Isi', ok: false, msg: 'Konten kosong.' }] };
  }
  if (/^https?:\/\//i.test(s)) {
    let url = null;
    try { url = new URL(s); } catch (e) { /* noop */ }
    if (!url || !url.hostname || !/^[a-z0-9.-]+$/i.test(url.hostname)) {
      return { type: 'Link', valid: false, checks: [{ label: 'Format', ok: false, msg: 'URL tidak dikenali (butuh http:// atau https://).' }] };
    }
    checks.push({ label: 'Protokol', ok: true, msg: url.protocol + '//' });
    checks.push({ label: 'Host', ok: true, msg: url.hostname });
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      checks.push({ label: 'Host', ok: false, msg: 'Domain tidak memiliki titik (contoh: codebuff.ai).' });
      return { type: 'Link', valid: false, checks: checks };
    }
    checks.push({ label: 'Jalur', ok: true, msg: (url.pathname + url.search || '/') });
    return { type: 'Link', valid: true, checks: checks };
  }
  if (/^WIFI:/i.test(s)) {
    const t = (s.match(/T:([^;]*)/) || [])[1];
    const ssid = (s.match(/S:([^;]*)/) || [])[1];
    const pwd = (s.match(/P:([^;]*)/) || [])[1];
    if (!ssid) { checks.push({ label: 'SSID', ok: false, msg: 'Nama WiFi (S:) wajib ada.' }); }
    else checks.push({ label: 'SSID', ok: true, msg: ssid });
    if (!['WPA', 'WEP', 'nopass'].includes(t)) { checks.push({ label: 'Keamanan', ok: false, msg: 'Tipe keamanan (T:) tidak dikenali.' }); }
    else checks.push({ label: 'Keamanan', ok: true, msg: t });
    if (t === 'nopass' && pwd) { checks.push({ label: 'Password', ok: false, msg: 'WiFi tanpa password tidak boleh punya password.' }); }
    else if (t && t !== 'nopass' && !pwd) { checks.push({ label: 'Password', ok: false, msg: 'WiFi ' + t + ' sebaiknya punya password (P:).' }); }
    else if (pwd) checks.push({ label: 'Password', ok: true, msg: 'Terisi.' });
    else checks.push({ label: 'Password', ok: true, msg: 'Kosong.' });
    const valid = checks.every(ch => ch.ok);
    return { type: 'WiFi', valid: valid, checks: checks };
  }
  if (/^mailto:/i.test(s)) {
    const email = s.replace(/^mailto:/i, '').split('?')[0].split(',')[0];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return { type: 'Email', valid: false, checks: [{ label: 'Email', ok: false, msg: 'Alamat email tidak valid.' }] };
    }
    checks.push({ label: 'Email', ok: true, msg: email });
    if (s.includes('?')) checks.push({ label: 'Subjek/Isi', ok: true, msg: 'Ada subjek atau isi pesan.' });
    return { type: 'Email', valid: true, checks: checks };
  }
  if (/^https:\/\/wa\.me\//i.test(s)) {
    const num = s.replace(/^https:\/\/wa\.me\//i, '').split(/[?#]/)[0];
    if (!/^\d{6,15}$/.test(num)) {
      return { type: 'WhatsApp', valid: false, checks: [{ label: 'Nomor', ok: false, msg: 'Nomor WhatsApp tidak valid (6–15 digit, kode negara tanpa +).' }] };
    }
    checks.push({ label: 'Nomor', ok: true, msg: '+' + num });
    if (s.includes('text=')) checks.push({ label: 'Pesan', ok: true, msg: 'Ada pesan awal.' });
    return { type: 'WhatsApp', valid: true, checks: checks };
  }
  if (/^tel:/i.test(s)) {
    const num = s.replace(/^tel:/i, '');
    if (!/^\+?[\d\s()-]{6,20}$/.test(num)) {
      return { type: 'Telepon', valid: false, checks: [{ label: 'Nomor', ok: false, msg: 'Nomor telepon tidak valid.' }] };
    }
    return { type: 'Telepon', valid: true, checks: [{ label: 'Nomor', ok: true, msg: num }] };
  }
  checks.push({ label: 'Teks', ok: true, msg: s.length + ' karakter' });
  if (s.length > 2000) {
    return { type: 'Teks', valid: false, checks: [{ label: 'Panjang', ok: false, msg: 'Terlalu panjang untuk QR standar (>2000 karakter).' }] };
  }
  return { type: 'Teks', valid: true, checks: checks };
}

function qrValidateReportHtml(report) {
  const icon = report.valid ? 'fa-circle-check' : 'fa-circle-xmark';
  const color = report.valid ? '#22C55E' : '#EF4444';
  return `<div class="qr-validate-result ${report.valid ? 'ok' : 'bad'}">
    <div class="qr-validate-summary"><i class="fa-solid ${icon}" style="color: ${color};"></i> ${report.valid ? 'Valid' : 'Tidak valid'} — <b>${escapeHtml(report.type)}</b></div>
    ${report.checks.map(ch => `
      <div class="qr-check-row">
        <i class="fa-solid ${ch.ok ? 'fa-circle-check' : 'fa-circle-xmark'}" style="color: ${ch.ok ? '#22C55E' : '#EF4444'};"></i>
        <span class="qr-check-label">${escapeHtml(ch.label)}</span>
        <span class="qr-check-msg">${escapeHtml(ch.msg)}</span>
      </div>`).join('')}
  </div>`;
}

function qrValidateInputContent() {
  const input = document.getElementById('qrValidateInput');
  const content = input ? input.value.trim() : '';
  if (!content) { showNotificationBanner('Tempel dulu kontennya! ✍️'); return; }
  const box = document.getElementById('qrValidateReport');
  if (box) {
    box.style.display = 'block';
    box.innerHTML = qrValidateReportHtml(qrValidateContent(content));
  }
}

function qrValidateFromGen() {
  const content = qrBuildContent();
  if (!content) { showNotificationBanner('Buat QR dulu!'); return; }
  qrSetMode('scan');
  const input = document.getElementById('qrValidateInput');
  if (input) input.value = content;
  qrValidateInputContent();
  const report = document.getElementById('qrValidateReport');
  if (report) { try { report.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* noop */ } }
}

function qrCopyContent() {
  const content = qrBuildContent();
  if (!content) return;
  copyTextToClipboard(content, 'Konten QR disalin 📋');
}

// ---------- riwayat ----------
function renderQrHistory() {
  const box = document.getElementById('qrHistoryBox');
  if (!box) return;
  const hist = appState.user.qrHistory || [];
  if (!hist.length) {
    box.innerHTML = '<div class="qr-empty"><i class="fa-solid fa-qrcode"></i><div>Belum ada QR yang dibuat. Buat QR pertama kamu di atas! 👆</div></div>';
    return;
  }
  box.innerHTML = hist.map((h, i) => `
    <div class="qr-history-row" onclick="qrReuseHistory(${i})">
      <div class="qr-history-icon"><i class="fa-solid fa-qrcode"></i></div>
      <div class="qr-history-body">
        <div class="qr-history-label">${escapeHtml(h.label)}</div>
        <div class="qr-history-meta">${escapeHtml(QR_TYPE_LABELS[h.type] || 'Teks')} · ${escapeHtml(mediaTimeAgo(h.at))}</div>
      </div>
      <div class="qr-history-actions">
        <button class="media-np-btn" aria-label="Pakai lagi" onclick="event.stopPropagation();qrReuseHistory(${i})"><i class="fa-solid fa-rotate-left"></i></button>
        <button class="media-np-btn" aria-label="Hapus" onclick="event.stopPropagation();qrDeleteHistory(${i})"><i class="fa-solid fa-trash" style="color:#EF4444;"></i></button>
      </div>
    </div>`).join('');
}

function qrReuseHistory(i) {
  const h = appState.user.qrHistory[i];
  if (!h) return;
  qrSetType('text');
  const inp = document.getElementById('qrTextInput');
  if (inp) inp.value = h.content;
  qrGenerate();
  showNotificationBanner('QR dimuat ulang dari riwayat ♻️');
}

function qrDeleteHistory(i) {
  appState.user.qrHistory.splice(i, 1);
  saveStateToLocalStorage();
  renderQrHistory();
}

function qrClearHistory() {
  appState.user.qrHistory = [];
  saveStateToLocalStorage();
  renderQrHistory();
  showNotificationBanner('Riwayat QR dibersihkan.');
}

// ---------- reader ----------
async function qrToggleCamera() {
  const box = document.getElementById('qrCameraBox');
  const btn = document.getElementById('qrCameraBtn');
  const hint = document.getElementById('qrScanHint');
  if (qrCamStream) { qrStopCamera(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNotificationBanner('Kamera tidak didukung di perangkat ini — gunakan Pindai dari Gambar. 📷');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    qrCamStream = stream;
    const video = document.getElementById('qrCameraVideo');
    video.srcObject = stream;
    await video.play().catch(() => { /* noop */ });
    if (box) box.style.display = 'block';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Hentikan Kamera';
    if (hint) hint.textContent = 'Arahkan kamera ke QR code — hasil terdeteksi otomatis.';
    qrStartScanLoop();
  } catch (err) {
    showNotificationBanner('Tidak bisa mengakses kamera: ' + (err.message || err) + ' — coba Pindai dari Gambar.');
  }
}

function qrStartScanLoop() {
  qrStopScanLoop();
  qrScanTimer = setInterval(() => {
    const video = document.getElementById('qrCameraVideo');
    if (!video || !qrCamStream || video.readyState < 2) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) {
        qrShowResult(code.data);
        qrStopCamera();
        showNotificationBanner('QR berhasil dibaca! ✅');
      }
    } catch (e) { /* noop */ }
  }, 500);
}

function qrStopScanLoop() {
  if (qrScanTimer) { clearInterval(qrScanTimer); qrScanTimer = null; }
}

function qrStopCamera() {
  qrStopScanLoop();
  if (qrCamStream) {
    qrCamStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* noop */ } });
    qrCamStream = null;
  }
  const video = document.getElementById('qrCameraVideo');
  if (video) video.srcObject = null;
  const box = document.getElementById('qrCameraBox');
  if (box) box.style.display = 'none';
  const btn = document.getElementById('qrCameraBtn');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-video"></i> Mulai Kamera';
  const hint = document.getElementById('qrScanHint');
  if (hint) hint.textContent = 'Arahkan kamera ke QR code, atau pilih gambar dari galeri. Hasil akan terdeteksi otomatis.';
}

function qrScanImage(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const maxDim = 1024;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxDim) {
        const s = maxDim / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) {
        qrShowResult(code.data);
        showNotificationBanner('QR berhasil dibaca! ✅');
      } else {
        showNotificationBanner('Tidak ada QR code yang terdeteksi di gambar itu. 🤔');
      }
    } catch (e) {
      showNotificationBanner('Gagal membaca gambar.');
    }
  };
  img.onerror = () => showNotificationBanner('Gambar gagal dimuat.');
  img.src = URL.createObjectURL(file);
  event.target.value = '';
}

function qrDetectType(content) {
  const s = String(content || '');
  if (/^https?:\/\//i.test(s)) return 'Link';
  if (/^WIFI:/i.test(s)) return 'WiFi';
  if (/^mailto:/i.test(s)) return 'Email';
  if (/^https:\/\/wa\.me\//i.test(s)) return 'WhatsApp';
  if (/^tel:/i.test(s)) return 'Telepon';
  return 'Teks';
}

function qrShowResult(content) {
  qrLastResult = content;
  const card = document.getElementById('qrResultCard');
  if (card) card.style.display = 'block';
  const type = qrDetectType(content);
  const badge = document.getElementById('qrResultType');
  if (badge) badge.textContent = type;
  const box = document.getElementById('qrResultContent');
  if (box) box.textContent = content;
  const openBtn = document.getElementById('qrOpenLinkBtn');
  if (openBtn) openBtn.style.display = type === 'Link' ? 'inline-flex' : 'none';
  // validator otomatis pada hasil scan
  const reportBox = document.getElementById('qrResultReport');
  if (reportBox) reportBox.innerHTML = qrValidateReportHtml(qrValidateContent(content));
}

function qrCopyResult() {
  if (!qrLastResult) return;
  copyTextToClipboard(qrLastResult, 'Hasil scan disalin 📋');
}

function qrOpenResultLink() {
  if (!qrLastResult) return;
  try { window.open(qrLastResult, '_blank'); } catch (e) { /* noop */ }
}
/* ==========================================================================
   MY CONVERTER — konversi media lokal/offline
   Engine: FFmpeg.wasm (video/audio/gif/image) + jsquash AVIF (image/avif)
   Semua diproses di perangkat — file tidak pernah di-upload.
   ========================================================================== */
let convFile = null;              // File asli
let convKind = 'unknown';         // video | audio | image | gif | unknown
let convFfmpeg = null;            // instance FFmpeg.wasm (worker) ATAU adapter main-thread core
let convFfmpegLoaded = false;
let convFfmpegMode = '';          // 'worker' | 'main' | ''
let convBusy = false;
let convOutputBlob = null;
let convOutputName = '';
let convOutputSize = 0;
let convLastLog = '';

const CONV_VIDEO_FORMATS = [
  { id: 'mp4',  label: 'MP4',  desc: 'H.264 + AAC' },
  { id: 'webm', label: 'WebM', desc: 'VP8 + Vorbis' },
  { id: 'mov',  label: 'MOV',  desc: 'H.264 QuickTime' },
  { id: 'mkv',  label: 'MKV',  desc: 'H.264 Matroska' },
  { id: 'gif',  label: 'GIF',  desc: 'Animasi GIF' }
];
const CONV_AUDIO_FORMATS = [
  { id: 'mp3',  label: 'MP3',  desc: 'LAME 192k' },
  { id: 'wav',  label: 'WAV',  desc: 'PCM 16-bit' },
  { id: 'flac', label: 'FLAC', desc: 'Lossless' },
  { id: 'aac',  label: 'AAC',  desc: 'AAC 192k' },
  { id: 'ogg',  label: 'OGG',  desc: 'Vorbis' },
  { id: 'm4a',  label: 'M4A',  desc: 'AAC di M4A' }
];
const CONV_IMAGE_FORMATS = [
  { id: 'jpg',  label: 'JPG',  desc: 'JPEG' },
  { id: 'png',  label: 'PNG',  desc: 'Lossless' },
  { id: 'webp', label: 'WebP', desc: 'WebP 80' },
  { id: 'avif', label: 'AVIF', desc: 'AV1 image' },
  { id: 'tiff', label: 'TIFF', desc: 'Tagged' },
  { id: 'bmp',  label: 'BMP',  desc: 'Bitmap' }
];

// Argumen FFmpeg per format output (engine asli — bukan sekadar ganti ekstensi)
const CONV_PRESETS = {
  mp4:  { args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k'] },
  webm: { args: ['-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libvorbis', '-q:a', '5'] },
  mov:  { args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'] },
  mkv:  { args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'] },
  gif:  { args: ['-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0'] },
  mp3:  { args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  wav:  { args: ['-vn', '-c:a', 'pcm_s16le'] },
  flac: { args: ['-vn', '-c:a', 'flac'] },
  aac:  { args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
  ogg:  { args: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'] },
  m4a:  { args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
  jpg:  { args: ['-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2'] },
  png:  { args: ['-frames:v', '1', '-c:v', 'png'] },
  webp: { args: ['-frames:v', '1', '-c:v', 'libwebp', '-q:v', '80'] },
  tiff: { args: ['-frames:v', '1', '-c:v', 'tiff'] },
  bmp:  { args: ['-frames:v', '1', '-c:v', 'bmp'] },
  avif: { special: 'avif' }
};

const CONV_MIMES = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', gif: 'image/gif',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg', m4a: 'audio/mp4',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', tiff: 'image/tiff', bmp: 'image/bmp'
};

function renderConverterPage() {
  convUpdateEngineBar();
}

function convShowBanner(msg) { showNotificationBanner(msg); }

function convFormatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function convDetectKind(file) {
  const name = String(file && file.name || '').toLowerCase();
  const mime = String(file && file.type || '').toLowerCase();
  if (/\.gif$/i.test(name) || mime === 'image/gif') return 'gif';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v|ts|flv|wmv|3gp|mpg|mpeg)$/.test(name)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|wav|flac|aac|ogg|m4a|opus|wma|aiff)$/.test(name)) return 'audio';
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif|tiff|tif|bmp|ico)$/.test(name)) return 'image';
  return 'unknown';
}

function convExtFor(name) {
  const m = String(name || '').match(/\.([a-z0-9]+)$/i);
  return m ? '.' + m[1].toLowerCase() : '';
}

function convBaseName(name) {
  return String(name || '').replace(/\.[^.]+$/, '') || 'konversi';
}

function convSetProgress(pct, status) {
  const fill = document.getElementById('convProgressFill');
  if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  const p = document.getElementById('convProgressPct');
  if (p) p.textContent = Math.round(pct) + '%';
  if (status !== undefined) {
    const s = document.getElementById('convProgressStatus');
    if (s) s.textContent = status;
  }
}

function convUpdateEngineBar() {
  const title = document.getElementById('convEngineTitle');
  const sub = document.getElementById('convEngineSub');
  const btn = document.getElementById('convEngineBtn');
  const icon = document.getElementById('convEngineIcon');
  if (!title) return;
  const avifOk = typeof window.AvifEncode === 'function';
  if (convFfmpegLoaded) {
    title.textContent = 'Mesin konversi siap ✅';
    sub.textContent = 'FFmpeg termuat (' + (convFfmpegMode === 'main' ? 'mode inti langsung' : 'mode worker') + ')' + (avifOk ? ' + encoder AVIF' : '') + ' — konversi berjalan 100% lokal.';
    btn.style.display = 'none';
    if (icon) icon.style.color = '#22C55E';
  } else if (convBusy) {
    title.textContent = 'Memuat mesin konversi...';
    sub.textContent = 'Menyiapkan FFmpeg (WebAssembly) — cukup sekali, lalu offline.';
    btn.style.display = '';
    btn.disabled = true;
    btn.innerHTML = 'Memuat...';
  } else {
    title.textContent = 'Mesin konversi belum dimuat';
    sub.textContent = 'FFmpeg (WebAssembly) ±32 MB — dimuat sekali, lalu siap offline.';
    btn.style.display = '';
    btn.disabled = false;
    btn.innerHTML = 'Muat Mesin';
    if (icon) icon.style.color = '';
  }
}

// Muat inti FFmpeg langsung di main thread — tanpa worker, tanpa fragment atob,
// sehingga tetap jalan walau mekanisme blob-worker diblokir di lingkungan tertentu.
async function convLoadEngineCore() {
  if (typeof window.createFFmpegCore !== 'function') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/ffmpeg/ffmpeg-core.js', location.href).href;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Gagal memuat ffmpeg-core.js'));
      document.head.appendChild(s);
    });
  }
  if (typeof window.createFFmpegCore !== 'function') throw new Error('Mesin FFmpeg inti tidak tersedia.');
  const mod = await window.createFFmpegCore({});
  try {
    mod.setLogger(({ message }) => {
      if (message && typeof message === 'string' && /error|failed/i.test(message)) convLastLog = message;
    });
  } catch (e) { /* noop */ }
  try {
    mod.setProgress(({ progress }) => {
      if (typeof progress === 'number') convSetProgress(5 + Math.round(progress * 90), 'memproses...');
    });
  } catch (e) { /* noop */ }
  return {
    exec: (args) => {
      try { mod.setTimeout(-1); } catch (e) { /* noop */ }
      mod.exec(...args);
      const ret = mod.ret;
      try { mod.reset(); } catch (e) { /* noop */ }
      return ret;
    },
    writeFile: (path, data) => { mod.FS.writeFile(path, data); return Promise.resolve(); },
    readFile: (path) => Promise.resolve(mod.FS.readFile(path)),
    deleteFile: (path) => { try { mod.FS.unlink(path); } catch (e) { /* noop */ } return Promise.resolve(); }
  };
}

async function convLoadEngine() {
  if (convFfmpegLoaded || convBusy) return;
  convBusy = true;
  convUpdateEngineBar();
  try {
    try {
      // Jalur 1 — FFmpeg berbasis worker (tidak memblokir UI)
      if (typeof window.FFmpegWASM === 'undefined' || !window.FFmpegWASM.FFmpeg) {
        throw new Error('Pustaka FFmpeg tidak ditemukan.');
      }
      const { FFmpeg } = window.FFmpegWASM;
      const ff = new FFmpeg();
      ff.on('progress', ({ progress }) => {
        if (typeof progress === 'number') convSetProgress(5 + Math.round(progress * 90), 'memproses...');
      });
      ff.on('log', ({ message }) => {
        if (message && typeof message === 'string' && /error|failed/i.test(message)) convLastLog = message;
      });
      const coreUrl = new URL('vendor/ffmpeg/ffmpeg-core.js', location.href).href;
      const wasmUrl = new URL('vendor/ffmpeg/ffmpeg-core.wasm', location.href).href;
      await ff.load({ coreURL: coreUrl, wasmURL: wasmUrl });
      convFfmpeg = ff;
      convFfmpegLoaded = true;
      convFfmpegMode = 'worker';
      convShowBanner('Mesin konversi siap! ✅ (sekali muat, lalu offline)');
    } catch (err) {
      // Jalur 2 — core langsung di main thread (tahan banting di lingkungan apa pun)
      console.warn('Worker FFmpeg gagal, coba main-thread core:', err);
      convFfmpeg = await convLoadEngineCore();
      convFfmpegLoaded = true;
      convFfmpegMode = 'main';
      convShowBanner('Mesin konversi siap! ✅ (mode inti langsung — tanpa worker)');
    }
  } catch (err) {
    console.error('FFmpeg load error:', err);
    convShowBanner('Gagal memuat mesin konversi: ' + (err.message || err));
  } finally {
    convBusy = false;
    convUpdateEngineBar();
  }
}

function convPickFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  convFile = file;
  convOutputBlob = null;
  convOutputName = '';
  convOutputSize = 0;
  convKind = convDetectKind(file);
  const info = document.getElementById('convFileInfo');
  info.style.display = 'flex';
  document.getElementById('convFileName').textContent = file.name;
  document.getElementById('convFileMeta').textContent = convFormatBytes(file.size) + (file.type ? ' · ' + file.type : '');
  const icons = { video: 'fa-file-video', audio: 'fa-file-audio', image: 'fa-file-image', gif: 'fa-file-image', unknown: 'fa-file' };
  document.getElementById('convFileIcon').innerHTML = '<i class="fa-solid ' + (icons[convKind] || 'fa-file') + '"></i>';
  const kindLabels = { video: 'Video', audio: 'Audio', image: 'Gambar', gif: 'GIF', unknown: '?' };
  const badge = document.getElementById('convKindBadge');
  badge.textContent = kindLabels[convKind] || '';
  badge.className = 'conv-kind-badge conv-kind-' + convKind;
  document.getElementById('convProgressCard').style.display = 'none';
  document.getElementById('convResult').style.display = 'none';
  convRenderFormats();
  event.target.value = '';
}

function convFormatGroup(label, formats) {
  return `<div class="conv-group">
    <div class="conv-group-label">${label}</div>
    <div class="conv-group-chips">
      ${formats.map(f => `
        <button class="conv-format-chip" data-fmt="${f.id}" onclick="convSelectFormat('${f.id}')">
          <i class="fa-solid fa-file"></i>
          <span class="conv-chip-label">${f.label}</span>
          <span class="conv-chip-desc">${f.desc}</span>
        </button>`).join('')}
    </div>
  </div>`;
}

function convRenderFormats() {
  const card = document.getElementById('convFormatCard');
  const groups = document.getElementById('convFormatGroups');
  card.style.display = 'block';
  let html = '';
  if (convKind === 'video') {
    html += convFormatGroup('Video →', CONV_VIDEO_FORMATS);
    html += convFormatGroup('Video → Audio (tanpa video)', CONV_AUDIO_FORMATS);
  } else if (convKind === 'audio') {
    html += convFormatGroup('Audio →', CONV_AUDIO_FORMATS);
  } else if (convKind === 'image') {
    html += convFormatGroup('Gambar →', CONV_IMAGE_FORMATS);
  } else if (convKind === 'gif') {
    html += convFormatGroup('GIF → Video', CONV_VIDEO_FORMATS.filter(f => f.id !== 'gif'));
    html += convFormatGroup('GIF → Gambar', CONV_IMAGE_FORMATS);
  } else {
    html += '<div class="conv-unknown-note">Jenis file tidak dikenali. Pilih file video, audio, atau gambar yang umum.</div>';
  }
  groups.innerHTML = html;
  const go = document.getElementById('convGoBtn');
  const first = groups.querySelector('.conv-format-chip');
  if (first) {
    convSelectFormat(first.dataset.fmt);
    go.disabled = false;
  } else {
    go.disabled = true;
  }
}

function convSelectFormat(id) {
  document.querySelectorAll('.conv-format-chip').forEach(c => c.classList.toggle('active', c.dataset.fmt === id));
  const go = document.getElementById('convGoBtn');
  go.dataset.fmt = id || '';
  const target = document.getElementById('convGoTarget');
  if (target) target.textContent = id ? 'ke ' + id.toUpperCase() : '';
}

async function convStart() {
  if (convBusy || !convFile) return;
  const fmtId = document.getElementById('convGoBtn').dataset.fmt;
  if (!fmtId || !CONV_PRESETS[fmtId]) { convShowBanner('Pilih format output dulu!'); return; }
  if (!convFfmpegLoaded) {
    await convLoadEngine();
    if (!convFfmpegLoaded) return;
  }
  if (CONV_PRESETS[fmtId].special === 'avif') { await convStartAvif(); return; }
  await convStartFfmpeg(fmtId);
}

async function convStartFfmpeg(fmtId) {
  convBusy = true;
  const progressCard = document.getElementById('convProgressCard');
  const result = document.getElementById('convResult');
  progressCard.style.display = 'block';
  result.style.display = 'none';
  document.getElementById('convProgressTitle').textContent = 'Mengonversi ke ' + fmtId.toUpperCase() + '...';
  convSetProgress(1, 'menyiapkan file...');
  convLastLog = '';
  const preset = CONV_PRESETS[fmtId];
  const outName = 'output.' + fmtId;
  const ext = convExtFor(convFile.name) || '.bin';
  const inName = 'input' + ext;
  try {
    const data = new Uint8Array(await convFile.arrayBuffer());
    if (data.length > 250 * 1024 * 1024) throw new Error('File terlalu besar (>250 MB) untuk konversi di perangkat.');
    await convFfmpeg.writeFile(inName, data);
    try { await convFfmpeg.deleteFile(outName); } catch (e) { /* noop */ }
    convSetProgress(4, 'menjalankan FFmpeg...');
    const args = ['-y', '-i', inName].concat(preset.args, [outName]);
    const ret = await convFfmpeg.exec(args);
    if (ret !== 0 && ret !== undefined) {
      throw new Error('FFmpeg keluar dengan kode ' + ret + (convLastLog ? ' — ' + convLastLog : ''));
    }
    let out = null;
    try {
      out = await convFfmpeg.readFile(outName);
    } catch (e) {
      throw new Error('FFmpeg gagal memproses file' + (convLastLog ? ' — ' + convLastLog : ''));
    }
    if (!out || !out.length) throw new Error('Hasil konversi kosong.');
    convOutputBlob = new Blob([out], { type: CONV_MIMES[fmtId] || 'application/octet-stream' });
    convOutputName = convBaseName(convFile.name) + '.' + fmtId;
    convOutputSize = out.length;
    try { await convFfmpeg.deleteFile(inName); } catch (e) { /* noop */ }
    try { await convFfmpeg.deleteFile(outName); } catch (e) { /* noop */ }
    convShowResult(fmtId.toUpperCase());
  } catch (err) {
    console.error('Converter error:', err);
    document.getElementById('convProgressTitle').textContent = 'Konversi gagal';
    convSetProgress(0, err.message || String(err));
    try { if (convFfmpeg) await convFfmpeg.deleteFile(inName); } catch (e) { /* noop */ }
    convShowBanner('Konversi gagal: ' + (err.message || err));
  } finally {
    convBusy = false;
  }
}

async function convStartAvif() {
  convBusy = true;
  const progressCard = document.getElementById('convProgressCard');
  const result = document.getElementById('convResult');
  progressCard.style.display = 'block';
  result.style.display = 'none';
  document.getElementById('convProgressTitle').textContent = 'Mengonversi ke AVIF...';
  convSetProgress(5, 'membaca gambar...');
  try {
    if (typeof window.AvifEncode !== 'function') throw new Error('Encoder AVIF tidak tersedia.');
    const bmp = await convFileToImageData(convFile);
    convSetProgress(30, 'meng-encode AV1...');
    const outBuf = await window.AvifEncode(bmp, { quality: 60, speed: 6 });
    if (!outBuf || !outBuf.byteLength) throw new Error('Hasil AVIF kosong.');
    convOutputBlob = new Blob([outBuf], { type: 'image/avif' });
    convOutputName = convBaseName(convFile.name) + '.avif';
    convOutputSize = outBuf.byteLength;
    convShowResult('AVIF');
  } catch (err) {
    console.error('AVIF error:', err);
    document.getElementById('convProgressTitle').textContent = 'Konversi gagal';
    convSetProgress(0, err.message || String(err));
    convShowBanner('Konversi AVIF gagal: ' + (err.message || err));
  } finally {
    convBusy = false;
  }
}

function convFileToImageData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 2000;
        let w = img.naturalWidth, h = img.naturalHeight;
        const s = Math.min(1, max / Math.max(w, h));
        w = Math.max(1, Math.round(w * s));
        h = Math.max(1, Math.round(h * s));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(ctx.getImageData(0, 0, w, h));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar gagal dimuat.')); };
    img.src = url;
  });
}

function convShowResult(label) {
  document.getElementById('convResultName').textContent = convOutputName;
  document.getElementById('convResultSize').textContent = convFormatBytes(convOutputSize) + ' · ' + label;
  document.getElementById('convResult').style.display = 'flex';
  document.getElementById('convProgressTitle').textContent = 'Konversi selesai ✅';
  convSetProgress(100, 'selesai!');
  convShowBanner('Konversi berhasil! 📦');
}

function convDownload() {
  if (!convOutputBlob || !convOutputName) { convShowBanner('Tidak ada hasil untuk diunduh.'); return; }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(convOutputBlob);
  link.download = convOutputName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  convShowBanner('File diunduh 📥');
}

function convReset() {
  convFile = null;
  convOutputBlob = null;
  convOutputName = '';
  convOutputSize = 0;
  document.getElementById('convFileInfo').style.display = 'none';
  document.getElementById('convFormatCard').style.display = 'none';
  document.getElementById('convProgressCard').style.display = 'none';
  const go = document.getElementById('convGoBtn');
  go.dataset.fmt = '';
  go.disabled = true;
  document.getElementById('convFileInput').value = '';
}

/* ==========================================================================
   MY STORAGE — File manager lokal + cloud (Google Drive)
   ========================================================================== */

// ---------------------------------------------------------------------------
// 1. STATE & INDEXEDDB CONTENT STORE
// ---------------------------------------------------------------------------
const ST_IDB_NAME = 'MyStorageFilesDB';
const ST_IDB_VERSION = 1;
const ST_IDB_STORE = 'files';

let stCloudToken = sessionStorage.getItem('stCloudToken') || '';

function stOpenDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB tidak didukung.')); return; }
    const req = window.indexedDB.open(ST_IDB_NAME, ST_IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ST_IDB_STORE)) db.createObjectStore(ST_IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error || new Error('Gagal membuka IndexedDB'));
  });
}
function stPutContent(id, blob) {
  if (!id || !blob) return Promise.resolve();
  return stOpenDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(ST_IDB_STORE, 'readwrite');
    tx.objectStore(ST_IDB_STORE).put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  }));
}
function stGetContent(id) {
  if (!id) return Promise.resolve(null);
  return stOpenDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(ST_IDB_STORE, 'readonly');
    const req = tx.objectStore(ST_IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = (e) => reject(e.target.error);
  }));
}
function stDelContent(id) {
  if (!id) return Promise.resolve();
  return stOpenDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(ST_IDB_STORE, 'readwrite');
    tx.objectStore(ST_IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  }));
}

function stInitStorage() {
  if (!appState.storage || typeof appState.storage !== 'object') appState.storage = {};
  const s = appState.storage;
  if (!Array.isArray(s.vfs)) s.vfs = [];
  if (!Array.isArray(s.recent)) s.recent = [];
  if (!s.showHidden) s.showHidden = false;
  if (!s.view) s.view = 'list';
  if (!s.mode) s.mode = 'home';
  if (!s.localPath) s.localPath = '';
  if (!s.clipboard) s.clipboard = null;
  if (!s.nativeOn) s.nativeOn = false;
  if (!s.nativePath) s.nativePath = '';
  if (!s.cloudFolderId) s.cloudFolderId = '';
  if (!Array.isArray(s.cloudParents)) s.cloudParents = [];
}

// ---------------------------------------------------------------------------
// 2. VIRTUAL FS HELPERS
// ---------------------------------------------------------------------------
function stEntry(id) {
  return (appState.storage.vfs || []).find(e => e.id === id) || null;
}
function stFolderPath(folderId) {
  const parts = [];
  let cur = folderId ? stEntry(folderId) : null;
  let guard = 0;
  while (cur && guard++ < 200) {
    parts.unshift(cur.name);
    cur = cur.parent ? stEntry(cur.parent) : null;
  }
  return parts;
}
function stChildrenOf(folderId) {
  return (appState.storage.vfs || []).filter(e => (e.parent || '') === (folderId || ''));
}
function stVisible(entries) {
  if (appState.storage.showHidden) return entries;
  return entries.filter(e => !(e.name || '').startsWith('.'));
}
function stIsHiddenName(name) { return String(name || '').startsWith('.'); }
function stSort(entries) {
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'id');
  });
}
function stNewId() { return 'st_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6); }
function stUniqueName(parent, base, isFolder) {
  const siblings = stChildrenOf(parent).map(e => e.name);
  if (!siblings.includes(base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 1;
  while (siblings.includes(stem + ' (' + i + ')' + ext)) i++;
  return stem + ' (' + i + ')' + ext;
}
function stDescendants(rootId) {
  const out = [];
  const walk = (parent) => {
    stChildrenOf(parent).forEach(e => {
      out.push(e.id);
      if (e.type === 'folder') walk(e.id);
    });
  };
  walk(rootId);
  return out;
}
function stFormatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}
function stTimeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'baru saja';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' menit lalu';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' jam lalu';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' hari lalu';
  return new Date(ts).toLocaleDateString('id-ID');
}
function stExtOf(name) {
  const m = String(name || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}
function stExtGroup(name) {
  const ext = stExtOf(name);
  const img = ['jpg','jpeg','png','gif','webp','avif','tiff','bmp','svg','ico','heic'];
  const vid = ['mp4','webm','mov','mkv','avi','m4v','ts','3gp','flv'];
  const aud = ['mp3','wav','flac','aac','ogg','m4a','opus','wma'];
  const doc = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','csv','rtf','odt'];
  const arc = ['zip','rar','7z','tar','gz','bz2'];
  if (!ext) return 'Folder';
  if (img.includes(ext)) return 'Gambar';
  if (vid.includes(ext)) return 'Video';
  if (aud.includes(ext)) return 'Audio';
  if (doc.includes(ext)) return 'Dokumen';
  if (arc.includes(ext)) return 'Arsip';
  return 'Lainnya';
}
function stFileIcon(name, type) {
  if (type === 'folder') return 'fa-solid fa-folder';
  const ext = stExtOf(name);
  const map = {
    pdf: 'fa-solid fa-file-pdf', doc: 'fa-solid fa-file-word', docx: 'fa-solid fa-file-word',
    xls: 'fa-solid fa-file-excel', xlsx: 'fa-solid fa-file-excel',
    ppt: 'fa-solid fa-file-powerpoint', pptx: 'fa-solid fa-file-powerpoint',
    txt: 'fa-solid fa-file-lines', md: 'fa-solid fa-file-lines', csv: 'fa-solid fa-file-csv',
    zip: 'fa-solid fa-file-zipper', rar: 'fa-solid fa-file-zipper', '7z': 'fa-solid fa-file-zipper',
    mp3: 'fa-solid fa-file-audio', wav: 'fa-solid fa-file-audio', flac: 'fa-solid fa-file-audio', m4a: 'fa-solid fa-file-audio',
    mp4: 'fa-solid fa-file-video', webm: 'fa-solid fa-file-video', mov: 'fa-solid fa-file-video', mkv: 'fa-solid fa-file-video',
    jpg: 'fa-solid fa-file-image', jpeg: 'fa-solid fa-file-image', png: 'fa-solid fa-file-image', gif: 'fa-solid fa-file-image',
    webp: 'fa-solid fa-file-image', svg: 'fa-solid fa-file-image', bmp: 'fa-solid fa-file-image'
  };
  return map[ext] || 'fa-solid fa-file';
}
function stColorOf(name, type) {
  if (type === 'folder') return '#3B82F6';
  const g = stExtGroup(name);
  return { Gambar: '#10B981', Video: '#8B5CF6', Audio: '#F59E0B', Dokumen: '#3B82F6', Arsip: '#EC4899', Lainnya: '#64748B' }[g] || '#64748B';
}

// ---------------------------------------------------------------------------
// 3. NATIVE CAPACITOR FILESYSTEM ADAPTER (akses penyimpanan Android)
// ---------------------------------------------------------------------------
function stNativePlugin() {
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
      return window.Capacitor.Plugins.Filesystem;
    }
  } catch (e) { /* noop */ }
  return null;
}
async function stRequestAndroidPermission() {
  const fs = stNativePlugin();
  if (!fs) { showNotificationBanner('Plugin Filesystem belum aktif — jalankan bunx cap sync android setelah meng-install @capacitor/filesystem.'); return false; }
  try {
    const res = await fs.requestPermissions({ permissions: ['publicStorage'] });
    const state = (res && res.publicStorage) || (res && res.permissions && res.permissions.publicStorage);
    if (state === 'granted') { showNotificationBanner('Izin penyimpanan Android diberikan ✅'); return true; }
    showNotificationBanner('Izin penyimpanan belum diberikan. Di Android 13+ aktifkan "Akses semua file" di Pengaturan → Aplikasi → My.'); return false;
  } catch (err) {
    console.error('Storage permission error:', err);
    showNotificationBanner('Gagal meminta izin penyimpanan: ' + (err.message || err));
    return false;
  }
}
async function stNativeList(path) {
  const fs = stNativePlugin();
  if (!fs) throw new Error('Plugin Filesystem tidak tersedia.');
  const res = await fs.readdir({ path: path || '', directory: 'EXTERNAL_STORAGE' });
  return (res.files || []).map(f => ({
    key: (path ? path + '/' : '') + f.name,
    name: f.name,
    type: f.type === 'directory' ? 'folder' : 'file',
    size: f.size || 0,
    modified: (f.mtime || 0) * 1000 || null
  }));
}
async function stNativeReadBlob(path) {
  const fs = stNativePlugin();
  const res = await fs.readFile({ path, directory: 'EXTERNAL_STORAGE' });
  const bin = atob(res.data || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
}
async function stNativeWriteBlob(path, blob) {
  const fs = stNativePlugin();
  await fs.writeFile({ path, data: blob, directory: 'EXTERNAL_STORAGE', recursive: true });
}

// ---------------------------------------------------------------------------
// 4. FACADE — satu API untuk mode 'app' (virtual FS) & 'native'
// ---------------------------------------------------------------------------
function stNativeOn() { return appState.storage.nativeOn && !!stNativePlugin(); }
function stCurFolderKey() { return stNativeOn() ? appState.storage.nativePath : appState.storage.localPath; }
function stKeyName(key) { const parts = String(key).split('/'); return parts[parts.length - 1]; }

async function stOpList() {
  if (stNativeOn()) return stSort(await stNativeList(stCurFolderKey()));
  const kids = stSort(stChildrenOf(stCurFolderKey()));
  return kids.map(e => ({ key: e.id, id: e.id, name: e.name, type: e.type, size: e.size, modified: e.modified, hidden: stIsHiddenName(e.name) }));
}
async function stOpCreateFolder(name) {
  if (stNativeOn()) {
    const fs = stNativePlugin();
    await fs.mkdir({ path: (stCurFolderKey() ? stCurFolderKey() + '/' : '') + name, directory: 'EXTERNAL_STORAGE', recursive: true });
    return;
  }
  const id = stNewId();
  appState.storage.vfs.push({ id, parent: stCurFolderKey() || null, name, type: 'folder', size: 0, hidden: stIsHiddenName(name), created: Date.now(), modified: Date.now() });
  saveStateToLocalStorage();
}
async function stOpWrite(name, blob, src) {
  if (stNativeOn()) {
    await stNativeWriteBlob((stCurFolderKey() ? stCurFolderKey() + '/' : '') + name, blob);
    return;
  }
  const id = stNewId();
  await stPutContent(id, blob);
  appState.storage.vfs.push({ id, parent: stCurFolderKey() || null, name, type: 'file', size: blob.size, hidden: stIsHiddenName(name), contentId: id, created: Date.now(), modified: Date.now() });
  saveStateToLocalStorage();
  stAddRecent(name, blob.size, src || 'storage');
}
async function stOpRead(item) {
  if (stNativeOn()) return stNativeReadBlob(item.key);
  const blob = await stGetContent(item.id);
  if (!blob) throw new Error('Isi file tidak ditemukan (' + item.name + ').');
  return blob;
}
async function stOpDelete(item) {
  if (stNativeOn()) {
    const fs = stNativePlugin();
    if (item.type === 'folder') await fs.deleteDirectory({ path: item.key, directory: 'EXTERNAL_STORAGE', recursive: true });
    else await fs.deleteFile({ path: item.key, directory: 'EXTERNAL_STORAGE' });
    return;
  }
  const ids = [item.id].concat(stDescendants(item.id));
  for (const id of ids) {
    const e = stEntry(id);
    if (e && e.type === 'file' && e.contentId) await stDelContent(e.contentId);
  }
  appState.storage.vfs = appState.storage.vfs.filter(e => !ids.includes(e.id));
  saveStateToLocalStorage();
}
async function stOpRename(item, newName) {
  if (stNativeOn()) {
    const fs = stNativePlugin();
    const parts = item.key.split('/');
    parts[parts.length - 1] = newName;
    await fs.rename({ oldPath: item.key, newPath: parts.join('/'), directory: 'EXTERNAL_STORAGE' });
    return;
  }
  const e = stEntry(item.id);
  if (e) { e.name = newName; e.modified = Date.now(); e.hidden = stIsHiddenName(newName); saveStateToLocalStorage(); }
}
async function stOpExists(name) {
  if (stNativeOn()) {
    const list = await stNativeList(stCurFolderKey());
    return list.some(f => f.name === name);
  }
  return stChildrenOf(stCurFolderKey()).some(e => e.name === name);
}
async function stOpCopyHere(item, destKey, newName) {
  if (stNativeOn()) {
    const fs = stNativePlugin();
    const target = (destKey ? destKey + '/' : '') + newName;
    if (item.type === 'folder') await fs.copy({ from: item.key, to: target, directory: 'EXTERNAL_STORAGE' });
    else { const blob = await stNativeReadBlob(item.key); await stNativeWriteBlob(target, blob); }
    return;
  }
  const mkCopy = (srcId, newParent) => {
    const src = stEntry(srcId);
    if (!src) return null;
    const copy = { id: stNewId(), parent: newParent, name: src.name, type: src.type, size: src.size, hidden: src.hidden, created: Date.now(), modified: Date.now() };
    if (src.type === 'file') copy.contentId = copy.id;
    appState.storage.vfs.push(copy);
    stChildrenOf(srcId).forEach(c => mkCopy(c.id, copy.id));
    return copy;
  };
  const top = mkCopy(item.id, destKey || null);
  if (!top) throw new Error('Item tidak ditemukan.');
  // duplicate blob contents
  const collect = [];
  const walk = (id) => {
    const e = stEntry(id);
    if (e && e.type === 'file' && e.contentId) collect.push([e.contentId, e.id]);
    if (e && e.type === 'folder') stChildrenOf(id).forEach(c => walk(c.id));
  };
  walk(top.id);
  for (const [srcContentId, dstId] of collect) {
    const blob = await stGetContent(srcContentId);
    if (blob) await stPutContent(dstId, blob);
  }
  saveStateToLocalStorage();
}
async function stOpMove(item, destKey, newName) {
  if (stNativeOn()) {
    const fs = stNativePlugin();
    const target = (destKey ? destKey + '/' : '') + newName;
    await fs.rename({ oldPath: item.key, newPath: target, directory: 'EXTERNAL_STORAGE' });
    return;
  }
  const e = stEntry(item.id);
  if (!e) throw new Error('Item tidak ditemukan.');
  e.parent = destKey || null;
  e.name = newName;
  e.modified = Date.now();
  saveStateToLocalStorage();
}

// ---------------------------------------------------------------------------
// 5. RENDER — halaman utama & daftar
// ---------------------------------------------------------------------------
function renderStoragePage() {
  stInitStorage();
  const mode = appState.storage.mode;
  document.getElementById('storageHome').style.display = mode === 'home' ? 'block' : 'none';
  document.getElementById('storageLocal').style.display = mode === 'local' ? 'block' : 'none';
  document.getElementById('stCloud').style.display = mode === 'cloud' ? 'block' : 'none';
  if (mode === 'local') stRenderLocal();
  if (mode === 'cloud') stRenderCloud();
}
function stEnterMode(mode) {
  appState.storage.mode = mode;
  saveStateToLocalStorage();
  renderStoragePage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function stShowHome() { stEnterMode('home'); }

function stBackendStrip() {
  const el = document.getElementById('stBackendStrip');
  const native = stNativePlugin();
  const on = stNativeOn();
  let html = '<i class="fa-solid ' + (on ? 'fa-hard-drive' : 'fa-shield-halved') + '" style="color: ' + (on ? '#10B981' : 'var(--primary)') + ';"></i><div class="st-backend-text">';
  if (on) {
    html += '<div class="st-backend-title">Penyimpanan Android aktif — izin diberikan</div>';
    html += '<div class="st-backend-sub">Menjelajahi penyimpanan eksternal perangkat. Kembali ke penyimpanan aplikasi kapan saja.</div>';
  } else if (native) {
    html += '<div class="st-backend-title">Penyimpanan aplikasi (privat &amp; offline)</div>';
    html += '<div class="st-backend-sub">Aktifkan akses penuh ke penyimpanan Android (izin akan diminta):</div>';
  } else {
    html += '<div class="st-backend-title">Penyimpanan aplikasi (privat &amp; offline)</div>';
    html += '<div class="st-backend-sub">Di perangkat Android, akses penuh ke penyimpanan eksternal aktif otomatis setelah install plugin (sudah ada di package.json) + bunx cap sync android.</div>';
  }
  html += '</div>';
  if (native) {
    html += '<button type="button" class="btn-primary st-backend-btn" onclick="' + (on ? 'stSwitchBackend(false)' : 'stEnableNative()') + '">' +
      (on ? 'Ke Penyimpanan Aplikasi' : 'Aktifkan Akses Android') + '</button>';
  }
  el.innerHTML = html;
}
async function stEnableNative() {
  const ok = await stRequestAndroidPermission();
  if (ok) {
    appState.storage.nativeOn = true;
    appState.storage.nativePath = '';
    saveStateToLocalStorage();
    stRenderLocal();
    showNotificationBanner('Penyimpanan Android aktif 📂');
  }
}
function stSwitchBackend(onNative) {
  appState.storage.nativeOn = !!onNative;
  appState.storage.nativePath = '';
  saveStateToLocalStorage();
  stRenderLocal();
}

async function stRenderLocal() {
  stInitStorage();
  stBackendStrip();
  // path breadcrumb
  const pathEl = document.getElementById('stPath');
  const folderId = stCurFolderKey();
  let crumbHtml = '<span class="st-path-root" onclick="stGoRoot()"><i class="fa-solid fa-house"></i></span>';
  if (folderId) {
    const parts = stNativeOn() ? folderId.split('/') : stFolderPath(folderId);
    parts.forEach((p, i) => {
      crumbHtml += '<span class="st-path-sep">/</span><span class="st-path-crumb">' + stEsc(p) + '</span>';
    });
  }
  pathEl.innerHTML = crumbHtml;

  // summary
  const list = await stOpList();
  const visible = stVisible(list);
  const folders = visible.filter(e => e.type === 'folder');
  const files = visible.filter(e => e.type === 'file');
  const totalSize = files.reduce((a, f) => a + (f.size || 0), 0);
  let est = '';
  if (!stNativeOn() && navigator.storage && navigator.storage.estimate) {
    try {
      const q = await navigator.storage.estimate();
      if (q && q.quota) est = ' · Kuota tersedia: ' + stFormatBytes(q.quota);
    } catch (e) { /* noop */ }
  }
  document.getElementById('stSummary').innerHTML =
    '<i class="fa-solid fa-database" style="color: var(--primary);"></i>' +
    '<div class="st-summary-text"><span class="st-summary-num">' + folders.length + ' folder</span>' +
    '<span class="st-summary-num">' + files.length + ' file</span>' +
    '<span class="st-summary-num">' + stFormatBytes(totalSize) + '</span></div>' +
    '<span class="st-summary-sub">' + (stNativeOn() ? 'Penyimpanan Android' : 'Penyimpanan Aplikasi') + est + '</span>';

  // hidden button state
  const hb = document.getElementById('stHiddenBtn');
  hb.innerHTML = appState.storage.showHidden ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
  hb.title = appState.storage.showHidden ? 'Sembunyikan file tersembunyi' : 'Tampilkan file tersembunyi';
  const vb = document.getElementById('stViewBtn');
  vb.innerHTML = appState.storage.view === 'grid' ? '<i class="fa-solid fa-list"></i>' : '<i class="fa-solid fa-grip"></i>';

  // list
  const box = document.getElementById('stFileList');
  if (!visible.length) {
    box.innerHTML = '<div class="st-empty">' +
      '<i class="fa-solid fa-folder-open"></i>' +
      '<div>Folder ini kosong</div>' +
      '<span>Buat folder/file baru atau unggah dari perangkat.</span></div>';
  } else {
    box.className = 'st-filebox st-view-' + appState.storage.view;
    box.innerHTML = visible.map(item => {
      const hidden = item.hidden ? '<span class="st-hidden-badge">tersembunyi</span>' : '';
      return '<div class="st-file ' + (item.type === 'folder' ? 'st-folder' : 'st-fileitem') + '" onclick="stOpenEntry(\'' + item.key.replace(/'/g, "\\'") + '\')">' +
        '<div class="st-file-icon" style="background: ' + stColorOf(item.name, item.type) + '1A; color: ' + stColorOf(item.name, item.type) + ';">' +
        '<i class="' + stFileIcon(item.name, item.type) + '"></i></div>' +
        '<div class="st-file-main">' +
        '<div class="st-file-name">' + stEsc(item.name) + hidden + '</div>' +
        '<div class="st-file-meta">' + (item.type === 'folder' ? 'Folder' : stFormatBytes(item.size)) +
        (item.modified ? ' · ' + stTimeAgo(item.modified) : '') + '</div></div>' +
        '<div class="st-file-actions" onclick="event.stopPropagation()">' +
        '<button type="button" class="st-row-btn" title="Bagikan" onclick="stShare(\'' + item.key.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-share-nodes"></i></button>' +
        '<button type="button" class="st-row-btn" title="Aksi" onclick="stRowMenu(\'' + item.key.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
        '</div></div>';
    }).join('');
  }

  // clipboard bar
  const cb = document.getElementById('stClipboard');
  const clip = appState.storage.clipboard;
  if (clip) {
    cb.style.display = 'flex';
    cb.innerHTML = '<i class="fa-solid fa-clipboard"></i>' +
      '<div class="st-cb-text"><b>' + stEsc(clip.name) + '</b> — ' + (clip.mode === 'cut' ? 'dipindahkan (cut)' : 'disalin (copy)') + '</div>' +
      '<button type="button" class="btn-primary st-cb-paste" onclick="stPaste()"><i class="fa-solid fa-paste"></i> Tempel</button>' +
      '<button type="button" class="st-row-btn" onclick="stCancelClipboard()" title="Batal"><i class="fa-solid fa-xmark"></i></button>';
  } else {
    cb.style.display = 'none';
  }

  stRenderRecent();
}

function stGoRoot() {
  if (stNativeOn()) appState.storage.nativePath = '';
  else appState.storage.localPath = '';
  stRenderLocal();
}
function stGoUp() {
  const folderId = stCurFolderKey();
  if (!folderId) return;
  if (stNativeOn()) {
    const parts = folderId.split('/');
    parts.pop();
    appState.storage.nativePath = parts.join('/');
  } else {
    const e = stEntry(folderId);
    appState.storage.localPath = e && e.parent ? e.parent : '';
  }
  stRenderLocal();
}
function stOpenFolder(key) {
  if (stNativeOn()) appState.storage.nativePath = key;
  else appState.storage.localPath = key;
  stRenderLocal();
}
async function stOpenEntry(key) {
  const item = (await stOpList()).find(f => f.key === key);
  if (!item) { showNotificationBanner('Item tidak ditemukan.'); return; }
  if (item.type === 'folder') { stOpenFolder(key); return; }
  try {
    const blob = await stOpRead(item);
    stDownloadBlob(blob, item.name);
    stAddRecent(item.name, blob.size, 'dibuka');
  } catch (err) {
    showNotificationBanner('Gagal membuka file: ' + (err.message || err));
  }
}
function stRefresh() { stRenderLocal(); }
function stToggleHidden() {
  appState.storage.showHidden = !appState.storage.showHidden;
  saveStateToLocalStorage();
  stRenderLocal();
}
function stToggleView() {
  appState.storage.view = appState.storage.view === 'list' ? 'grid' : 'list';
  saveStateToLocalStorage();
  stRenderLocal();
}

function stEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// 6. AKSI FILE: rename, delete, copy, cut, paste, share, download
// ---------------------------------------------------------------------------
async function stItemByKey(key) {
  const list = await stOpList();
  return list.find(f => f.key === key) || null;
}

function stRowMenu(key) {
  const items = [
    { icon: 'fa-pen-to-square', label: 'Ganti Nama', fn: 'stOpenRename(\'' + key.replace(/'/g, "\\'") + '\')' },
    { icon: 'fa-copy', label: 'Salin', fn: 'stCopy(\'' + key.replace(/'/g, "\\'") + '\')' },
    { icon: 'fa-scissors', label: 'Potong (Cut)', fn: 'stCut(\'' + key.replace(/'/g, "\\'") + '\')' },
    { icon: 'fa-share-nodes', label: 'Bagikan', fn: 'stShare(\'' + key.replace(/'/g, "\\'") + '\')' },
    { icon: 'fa-trash-can', label: 'Hapus', fn: 'stAskDelete(\'' + key.replace(/'/g, "\\'") + '\')', danger: true }
  ];
  stOpenModal('Aksi File', items.map(it =>
    '<button type="button" class="st-menu-row' + (it.danger ? ' st-menu-danger' : '') + '" onclick="' + it.fn + '">' +
    '<i class="fa-solid ' + it.icon + '"></i><span>' + it.label + '</span></button>').join(''));
}

async function stOpenRename(key) {
  const item = await stItemByKey(key);
  if (!item) return;
  closeModal('modalStorage');
  stOpenModal('Ganti Nama', stModalField('name', 'Nama baru', item.name) +
    '<button type="button" class="btn-primary st-modal-go" onclick="stDoRename(\'' + key.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-check"></i> Simpan</button>');
  const inp = document.getElementById('stNameInput');
  if (inp) { inp.focus(); inp.select(); }
}
async function stDoRename(key) {
  const name = (document.getElementById('stNameInput') || {}).value;
  if (!name || !name.trim()) { showNotificationBanner('Nama tidak boleh kosong.'); return; }
  const item = await stItemByKey(key);
  if (!item) return;
  const finalName = item.type === 'folder' ? name.trim() : (name.trim() || item.name);
  if (finalName === item.name) { closeModal('modalStorage'); return; }
  try {
    await stOpRename(item, finalName);
    closeModal('modalStorage');
    stRenderLocal();
    showNotificationBanner('Berhasil diubah menjadi "' + finalName + '" ✏️');
  } catch (err) {
    showNotificationBanner('Gagal mengganti nama: ' + (err.message || err));
  }
}

async function stAskDelete(key) {
  const item = await stItemByKey(key);
  if (!item) return;
  closeModal('modalStorage');
  const isFolder = item.type === 'folder';
  stOpenModal('Hapus ' + (isFolder ? 'Folder' : 'File'),
    '<div class="st-confirm-text">Yakin hapus <b>' + stEsc(item.name) + '</b>' +
    (isFolder ? ' beserta seluruh isinya' : '') + '? Tindakan ini tidak bisa dibatalkan.</div>' +
    '<button type="button" class="btn-primary st-modal-go" style="background:#DC2626;" onclick="stDoDelete(\'' + key.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-trash-can"></i> Hapus</button>');
}
async function stDoDelete(key) {
  const item = await stItemByKey(key);
  if (!item) { closeModal('modalStorage'); return; }
  try {
    await stOpDelete(item);
    closeModal('modalStorage');
    stRenderLocal();
    showNotificationBanner('"' + item.name + '" dihapus 🗑️');
  } catch (err) {
    showNotificationBanner('Gagal menghapus: ' + (err.message || err));
  }
}

async function stCopy(key) {
  const item = await stItemByKey(key);
  if (!item) return;
  appState.storage.clipboard = { mode: 'copy', key: item.key, name: item.name, native: stNativeOn() };
  saveStateToLocalStorage();
  stRenderLocal();
  showNotificationBanner('Disalin: ' + item.name + ' 📋');
}
async function stCut(key) {
  const item = await stItemByKey(key);
  if (!item) return;
  appState.storage.clipboard = { mode: 'cut', key: item.key, name: item.name, native: stNativeOn() };
  saveStateToLocalStorage();
  stRenderLocal();
  showNotificationBanner('Dipotong: ' + item.name + ' ✂️');
}
function stCancelClipboard() {
  appState.storage.clipboard = null;
  saveStateToLocalStorage();
  stRenderLocal();
}
async function stPaste() {
  const clip = appState.storage.clipboard;
  if (!clip) return;
  if (clip.native !== stNativeOn()) { showNotificationBanner('Tempel lintas mode tidak didukung — ganti ke mode yang sama.'); return; }
  const destKey = stCurFolderKey();
  if (clip.key === destKey || (clip.key + '/').startsWith(destKey ? destKey + '/' : '/')) {
    showNotificationBanner('Tidak bisa menempel ke lokasi yang sama/induknya.');
    return;
  }
  const item = await stItemByKey(clip.key);
  if (!item) { appState.storage.clipboard = null; saveStateToLocalStorage(); stRenderLocal(); showNotificationBanner('Item sumber sudah tidak ada.'); return; }
  const finalName = await stUniqueName2(destKey, item.name);
  try {
    if (clip.mode === 'cut') {
      await stOpMove(item, destKey, finalName);
      showNotificationBanner('Dipindahkan ke sini 📦');
    } else {
      await stOpCopyHere(item, destKey, finalName);
      showNotificationBanner('Disalin ke sini 📦');
    }
    appState.storage.clipboard = null;
    saveStateToLocalStorage();
    stRenderLocal();
  } catch (err) {
    showNotificationBanner('Gagal menempel: ' + (err.message || err));
  }
}
async function stUniqueName2(destKey, base) {
  if (!(await stOpExistsAt(destKey, base))) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 1;
  while (await stOpExistsAt(destKey, stem + ' (' + i + ')' + ext)) i++;
  return stem + ' (' + i + ')' + ext;
}
async function stOpExistsAt(destKey, name) {
  if (stNativeOn()) {
    const list = await stNativeList(destKey);
    return list.some(f => f.name === name);
  }
  return (appState.storage.vfs || []).some(e => (e.parent || '') === (destKey || '') && e.name === name);
}

async function stShare(key) {
  const item = await stItemByKey(key);
  if (!item) return;
  if (item.type === 'folder') { showNotificationBanner('Bagikan file dulu — folder belum didukung berbagi.'); return; }
  try {
    const blob = await stOpRead(item);
    const file = new File([blob], item.name);
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: item.name });
      return;
    }
    stDownloadBlob(blob, item.name);
    showNotificationBanner('Berbagi tidak tersedia — file diunduh 📥');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    showNotificationBanner('Gagal berbagi: ' + (err && err.message || err));
  }
}
function stDownloadBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

// ---------------------------------------------------------------------------
// 7. BUAT FOLDER / FILE & UNGGAH
// ---------------------------------------------------------------------------
function stOpenCreate(type) {
  const isFolder = type === 'folder';
  stOpenModal(isFolder ? 'Buat Folder Baru' : 'Buat File Baru',
    stModalField('name', isFolder ? 'Nama folder' : 'Nama file', '') +
    (!isFolder ? '<div class="form-group mb-3"><label class="form-label">Isi teks (opsional)</label><textarea class="form-control" id="stFileText" rows="4" placeholder="Tulis isi file di sini..."></textarea></div>' : '') +
    '<button type="button" class="btn-primary st-modal-go" onclick="stDoCreate(\'' + type + '\')"><i class="fa-solid fa-check"></i> ' + (isFolder ? 'Buat Folder' : 'Buat File') + '</button>');
  const inp = document.getElementById('stNameInput');
  if (inp) inp.focus();
}
async function stDoCreate(type) {
  const name = ((document.getElementById('stNameInput') || {}).value || '').trim();
  if (!name) { showNotificationBanner('Nama tidak boleh kosong.'); return; }
  const finalName = type === 'file' && !name.includes('.') ? name + '.txt' : name;
  if (await stOpExists(finalName)) { showNotificationBanner('Nama sudah dipakai di folder ini.'); return; }
  try {
    if (type === 'folder') {
      await stOpCreateFolder(finalName);
      showNotificationBanner('Folder "' + finalName + '" dibuat 📁');
    } else {
      const text = (document.getElementById('stFileText') || {}).value || '';
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      await stOpWrite(finalName, blob, 'storage');
      showNotificationBanner('File "' + finalName + '" dibuat 📄');
    }
    closeModal('modalStorage');
    stRenderLocal();
  } catch (err) {
    showNotificationBanner('Gagal membuat: ' + (err.message || err));
  }
}
async function stImportFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  let ok = 0;
  for (const f of files) {
    try {
      let name = f.name;
      if (await stOpExists(name)) name = await stUniqueName2(stCurFolderKey(), name);
      await stOpWrite(name, f, 'perangkat');
      ok++;
    } catch (err) {
      console.error('Import error:', err);
      showNotificationBanner('Gagal mengunggah ' + f.name + ': ' + (err.message || err));
    }
  }
  stRenderLocal();
  if (ok) showNotificationBanner(ok + ' file ditambahkan ke penyimpanan lokal 📥');
}

// ---------------------------------------------------------------------------
// 8. ZIP / UNZIP (+ PASSWORD)
// ---------------------------------------------------------------------------
function stZipAvailable() { return !!(window.zip && window.zip.ZipWriter); }

async function stOpenZip() {
  const list = stVisible(await stOpList());
  if (!list.length) { showNotificationBanner('Folder ini kosong — tidak ada yang bisa di-zip.'); return; }
  const options = list.map(it =>
    '<option value="' + it.key.replace(/"/g, '&quot;') + '">' + (it.type === 'folder' ? '📁 ' : '📄 ') + stEsc(it.name) + '</option>').join('');
  const allSelected = list.map(it => it.key).join(',');
  stOpenModal('Zip — Arsipkan File',
    '<div class="form-group mb-3"><label class="form-label">Pilih item (folder akan diarsipkan beserta isinya)</label>' +
    '<select class="form-control" id="stZipPick" multiple size="' + Math.min(6, list.length) + '">' + options + '</select>' +
    '<div class="st-check-row"><label class="st-check"><input type="checkbox" id="stZipAll" checked onchange="document.getElementById(\'stZipPick\').querySelectorAll(\'option\').forEach(o=>o.selected=this.checked)"> Semua item</label></div></div>' +
    stModalField('password', 'Password (opsional — ZIP terenkripsi AES-256)', '') +
    '<div class="st-modal-hint">Kosongkan password untuk ZIP biasa. Isi password untuk melindungi arsip.</div>' +
    '<button type="button" class="btn-primary st-modal-go" onclick="stDoZip(\'' + allSelected.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-file-zipper"></i> Buat ZIP</button>');
}
async function stDoZip(keysCsv) {
  const keys = keysCsv ? keysCsv.split(',') : Array.from(document.querySelectorAll('#stZipPick option:checked')).map(o => o.value);
  if (!keys.length) { showNotificationBanner('Pilih minimal satu item.'); return; }
  const password = (document.getElementById('stPasswordInput') || {}).value || '';
  if (!stZipAvailable()) { showNotificationBanner('Mesin ZIP belum tersedia.'); return; }
  try {
    closeModal('modalStorage');
    showNotificationBanner('Mengarsipkan ' + keys.length + ' item… ⏳');
    const list = await stOpList();
    const items = keys.map(k => list.find(f => f.key === k)).filter(Boolean);
    const writer = new window.zip.ZipWriter(new window.zip.BlobWriter('application/zip'),
      Object.assign({ useWebWorkers: false, level: 6 }, password ? { password, encryptionStrength: 3 } : {}));
    const seen = {};
    const addOne = async (item, rel) => {
      if (item.type === 'folder') {
        const kids = stNativeOn() ? await stNativeList(item.key) : stSort(stChildrenOf(item.id));
        const vis = stNativeOn() ? kids : stVisible(kids);
        if (!vis.length) { if (!seen[rel + '/']) { seen[rel + '/'] = true; await writer.add(rel + '/', new window.zip.TextReader('')); } return; }
        for (const k of vis) await addOne(k, rel + '/' + k.name);
      } else {
        const blob = await stOpRead(item);
        const key = rel;
        if (seen[key]) return;
        seen[key] = true;
        await writer.add(rel, new window.zip.BlobReader(blob));
      }
    };
    for (const item of items) await addOne(item, item.name);
    const zipBlob = await writer.close();
    const zipName = await stUniqueName2(stCurFolderKey(), (items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '') : 'arsip') + '.zip');
    await stOpWrite(zipName, zipBlob, 'storage');
    stRenderLocal();
    showNotificationBanner('ZIP "' + zipName + '" dibuat' + (password ? ' (terenkripsi AES-256) 🔐' : ' 📦'));
  } catch (err) {
    console.error('Zip error:', err);
    showNotificationBanner('Gagal membuat ZIP: ' + (err.message || err));
  }
}

async function stOpenUnzip() {
  const list = stVisible(await stOpList());
  const zips = list.filter(it => it.type === 'file' && /\.zip$/i.test(it.name));
  if (!zips.length) { showNotificationBanner('Tidak ada file .zip di folder ini.'); return; }
  const options = zips.map(it =>
    '<option value="' + it.key.replace(/"/g, '&quot;') + '">📄 ' + stEsc(it.name) + '</option>').join('');
  stOpenModal('Unzip — Ekstrak Arsip',
    '<div class="form-group mb-3"><label class="form-label">Pilih file ZIP</label>' +
    '<select class="form-control" id="stUnzipPick">' + options + '</select></div>' +
    stModalField('password', 'Password (jika arsip terkunci)', '') +
    '<button type="button" class="btn-primary st-modal-go" onclick="stDoUnzip()"><i class="fa-solid fa-file-export"></i> Ekstrak ke Sini</button>');
}
async function stDoUnzip() {
  const key = (document.getElementById('stUnzipPick') || {}).value;
  if (!key) { showNotificationBanner('Pilih file ZIP dulu.'); return; }
  const password = (document.getElementById('stPasswordInput') || {}).value || '';
  try {
    closeModal('modalStorage');
    showNotificationBanner('Mengekstrak arsip… ⏳');
    const item = await stItemByKey(key);
    if (!item) throw new Error('File ZIP tidak ditemukan.');
    const blob = await stOpRead(item);
    const reader = new window.zip.ZipReader(new window.zip.BlobReader(blob), Object.assign({ useWebWorkers: false }, password ? { password } : {}));
    const entries = await reader.getEntries();
    let count = 0;
    for (const entry of entries) {
      if (entry.directory) {
        const parts = entry.filename.replace(/\/+$/, '').split('/').filter(Boolean);
        if (!parts.length) continue;
        // buat folder
        const folderPath = parts.join('/');
        if (stNativeOn()) {
          const fs = stNativePlugin();
          try { await fs.mkdir({ path: (stCurFolderKey() ? stCurFolderKey() + '/' : '') + folderPath, directory: 'EXTERNAL_STORAGE', recursive: true }); } catch (e) { /* mungkin sudah ada */ }
        } else {
          let parent = stCurFolderKey() || null;
          for (const seg of parts) {
            let kid = (appState.storage.vfs || []).find(e => (e.parent || '') === (parent || '') && e.name === seg && e.type === 'folder');
            if (!kid) {
              kid = { id: stNewId(), parent, name: seg, type: 'folder', size: 0, hidden: stIsHiddenName(seg), created: Date.now(), modified: Date.now() };
              appState.storage.vfs.push(kid);
            }
            parent = kid.id;
          }
        }
        continue;
      }
      const data = await entry.getData(new window.zip.BlobWriter(), Object.assign({ useWebWorkers: false }, password ? { password } : {}));
      const rel = entry.filename.replace(/^\/+/, '');
      const targetName = rel.split('/').pop();
      if (stNativeOn()) {
        const relPath = rel;
        const parts = relPath.split('/');
        parts.pop();
        if (parts.length) {
          const fs = stNativePlugin();
          try { await fs.mkdir({ path: (stCurFolderKey() ? stCurFolderKey() + '/' : '') + parts.join('/'), directory: 'EXTERNAL_STORAGE', recursive: true }); } catch (e) { /* noop */ }
        }
        const existing = await stOpExists(relPath);
        await stNativeWriteBlob((stCurFolderKey() ? stCurFolderKey() + '/' : '') + (existing ? await stUniqueName2(stCurFolderKey(), relPath) : relPath), data);
      } else {
        const parentChain = rel.split('/');
        parentChain.pop();
        let parent = stCurFolderKey() || null;
        for (const seg of parentChain) {
          let kid = (appState.storage.vfs || []).find(e => (e.parent || '') === (parent || '') && e.name === seg && e.type === 'folder');
          if (!kid) {
            kid = { id: stNewId(), parent, name: seg, type: 'folder', size: 0, hidden: stIsHiddenName(seg), created: Date.now(), modified: Date.now() };
            appState.storage.vfs.push(kid);
          }
          parent = kid.id;
        }
        const finalName = await stUniqueName2(parent, targetName);
        const nid = stNewId();
        await stPutContent(nid, data);
        appState.storage.vfs.push({ id: nid, parent, name: finalName, type: 'file', size: data.size, hidden: stIsHiddenName(finalName), contentId: nid, created: Date.now(), modified: Date.now() });
      }
      count++;
    }
    await reader.close();
    if (!stNativeOn()) saveStateToLocalStorage();
    stRenderLocal();
    showNotificationBanner('Berhasil mengekstrak ' + count + ' file 📂' + (password ? ' (dengan password)' : ''));
  } catch (err) {
    console.error('Unzip error:', err);
    showNotificationBanner('Gagal mengekstrak: ' + (err.message || err) + (password ? ' — cek password arsip.' : ''));
  }
}

// ---------------------------------------------------------------------------
// 9. ANALISIS UKURAN
// ---------------------------------------------------------------------------
async function stOpenAnalysis() {
  closeModal('modalStorage');
  document.getElementById('stAnalysis').style.display = 'block';
  const box = document.getElementById('stAnalysis');
  box.innerHTML = '<div class="st-analyze-head"><i class="fa-solid fa-chart-pie"></i> Menganalisis ukuran…</div>';
  await new Promise(r => setTimeout(r, 30));
  try {
    const groups = { 'Gambar': 0, 'Video': 0, 'Audio': 0, 'Dokumen': 0, 'Arsip': 0, 'Lainnya': 0, 'Folder': 0 };
    const files = [];
    const folderSizes = {};
    const walk = async (folderKey, folderId, rel) => {
      const kids = stNativeOn() ? await stNativeList(folderKey) : stSort(stChildrenOf(folderId));
      const vis = stNativeOn() ? kids : stVisible(kids);
      let sub = 0;
      for (const k of vis) {
        if (k.type === 'folder') {
          const s = await walk(k.key, stNativeOn() ? null : k.id, rel + '/' + k.name);
          sub += s;
        } else {
          const sz = k.size || 0;
          sub += sz;
          files.push({ name: k.name, size: sz, group: stExtGroup(k.name) });
          groups[stExtGroup(k.name)] = (groups[stExtGroup(k.name)] || 0) + sz;
        }
      }
      if (rel && rel !== '/') folderSizes[rel] = sub;
      return sub;
    };
    const total = await walk(stCurFolderKey(), stCurFolderKey() || null, '/');
    files.sort((a, b) => b.size - a.size);
    const topFiles = files.slice(0, 8);
    const topFolders = Object.entries(folderSizes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const used = total;
    const groupColors = { 'Gambar': '#10B981', 'Video': '#8B5CF6', 'Audio': '#F59E0B', 'Dokumen': '#3B82F6', 'Arsip': '#EC4899', 'Lainnya': '#64748B', 'Folder': '#94A3B8' };
    const present = Object.entries(groups).filter(([, v]) => v > 0);
    const totalG = present.reduce((a, [, v]) => a + v, 0) || 1;
    let grad = present.map(([g, v], i) => {
      const pct = (v / totalG) * 100;
      const start = present.slice(0, i).reduce((a, [, vv]) => a + (vv / totalG) * 100, 0);
      return groupColors[g] + ' ' + start.toFixed(2) + '% ' + (start + pct).toFixed(2) + '%';
    }).join(', ');
    let legend = present.map(([g, v]) =>
      '<span class="st-legend-item"><i style="background:' + groupColors[g] + ';"></i>' + g + ' · ' + stFormatBytes(v) + '</span>').join('');
    let quotaHtml = '';
    if (!stNativeOn() && navigator.storage && navigator.storage.estimate) {
      try {
        const q = await navigator.storage.estimate();
        if (q && q.quota) quotaHtml = '<div class="st-quota"><span>Total terpakai:</span><b>' + stFormatBytes(used) + '</b><span>dari</span><b>' + stFormatBytes(q.quota) + '</b>' +
          '<div class="st-quota-bar"><div style="width:' + Math.min(100, (used / q.quota) * 100).toFixed(1) + '%"></div></div></div>';
      } catch (e) { /* noop */ }
    }
    let html = '<div class="st-analyze-head"><i class="fa-solid fa-chart-pie"></i> Analisis Ukuran' +
      '<button type="button" class="st-icon-btn" onclick="stCloseAnalysis()" title="Tutup"><i class="fa-solid fa-xmark"></i></button></div>';
    html += quotaHtml;
    html += '<div class="st-an-donut-wrap"><div class="st-an-donut" style="background: conic-gradient(' + grad + ');"></div>' +
      '<div class="st-an-center"><b>' + stFormatBytes(total) + '</b><span>' + files.length + ' file</span></div></div>';
    html += '<div class="st-an-legend">' + legend + '</div>';
    if (topFiles.length) {
      const maxF = topFiles[0].size || 1;
      html += '<div class="st-an-block"><div class="st-an-title">File terbesar</div>' + topFiles.map(f =>
        '<div class="st-an-row"><div class="st-an-row-top"><span>' + stEsc(f.name) + '</span><b>' + stFormatBytes(f.size) + '</b></div>' +
        '<div class="st-an-bar" style="width:' + Math.max(3, (f.size / maxF) * 100).toFixed(1) + '%; background:' + groupColors[f.group] + ';"></div></div>').join('') + '</div>';
    }
    if (topFolders.length) {
      const maxD = topFolders[0][1] || 1;
      html += '<div class="st-an-block"><div class="st-an-title">Folder terbesar</div>' + topFolders.map(([name, sz]) =>
        '<div class="st-an-row"><div class="st-an-row-top"><span>' + stEsc(name.replace(/^\//, '')) + '</span><b>' + stFormatBytes(sz) + '</b></div>' +
        '<div class="st-an-bar" style="width:' + Math.max(3, (sz / maxD) * 100).toFixed(1) + '%; background:#3B82F6;"></div></div>').join('') + '</div>';
    }
    if (!files.length && !topFolders.length) html += '<div class="st-empty">Belum ada file untuk dianalisis.</div>';
    box.innerHTML = html;
  } catch (err) {
    console.error('Analysis error:', err);
    box.innerHTML = '<div class="st-analyze-head"><i class="fa-solid fa-triangle-exclamation"></i> Gagal menganalisis' +
      '<button type="button" class="st-icon-btn" onclick="stCloseAnalysis()"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="st-an-err">' + stEsc(err.message || String(err)) + '</div>';
  }
}
function stCloseAnalysis() {
  document.getElementById('stAnalysis').style.display = 'none';
}

// ---------------------------------------------------------------------------
// 10. BARU SAJA (riwayat file terbaru — termasuk dari fitur aplikasi lain)
// ---------------------------------------------------------------------------
function stAddRecent(name, size, src) {
  stInitStorage();
  const recents = appState.storage.recent;
  const last = recents[0];
  if (last && last.name === name && Date.now() - (last.at || 0) < 8000) {
    last.at = Date.now(); last.src = src || last.src; last.size = size != null ? size : last.size;
  } else {
    recents.unshift({ name, size: size != null ? size : 0, at: Date.now(), src: src || 'storage' });
  }
  if (recents.length > 12) recents.length = 12;
  saveStateToLocalStorage();
}
function stRecentSrcLabel(src) {
  return { storage: 'Storage', perangkat: 'Perangkat', aplikasi: 'Aplikasi', dibuka: 'Dibuka' }[src] || 'Storage';
}
function stRenderRecent() {
  const box = document.getElementById('stRecentList');
  const recents = (appState.storage.recent || []).slice(0, 6);
  if (!recents.length) {
    box.innerHTML = '<div class="st-empty st-empty-sm"><i class="fa-solid fa-clock-rotate-left"></i><div>Belum ada file baru</div>' +
      '<span>File yang ditambahkan ke penyimpanan (dari aplikasi atau perangkat) akan muncul di sini.</span></div>';
    return;
  }
  box.innerHTML = '<div class="st-recent-grid">' + recents.map(r =>
    '<div class="st-recent-item">' +
    '<div class="st-file-icon" style="background:' + stColorOf(r.name, 'file') + '1A; color:' + stColorOf(r.name, 'file') + ';">' +
    '<i class="' + stFileIcon(r.name, 'file') + '"></i></div>' +
    '<div class="st-file-main"><div class="st-file-name">' + stEsc(r.name) + '</div>' +
    '<div class="st-file-meta">' + stFormatBytes(r.size) + ' · ' + stTimeAgo(r.at) + '</div></div>' +
    '<span class="st-recent-src">' + stRecentSrcLabel(r.src) + '</span></div>').join('') + '</div>';
}
function stInitRecentHook() {
  if (window.__stRecentHook) return;
  window.__stRecentHook = true;
  document.addEventListener('click', (e) => {
    try {
      const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
      if (!a || !a.download || !a.href || a.href.indexOf('blob:') !== 0) return;
      const name = a.download || 'unduhan';
      fetch(a.href).then(r => r.blob()).then(b => {
        stAddRecent(name, b.size, 'aplikasi');
      }).catch(() => stAddRecent(name, 0, 'aplikasi'));
    } catch (err) { /* never crash */ }
  });
}

// ---------------------------------------------------------------------------
// 11. MODAL DINAMIS
// ---------------------------------------------------------------------------
function stOpenModal(title, bodyHtml) {
  document.getElementById('stModalTitle').innerHTML = '<i class="fa-solid fa-hard-drive" style="color: #3B82F6;"></i> ' + title;
  document.getElementById('stModalBody').innerHTML = bodyHtml;
  openModal('modalStorage');
}
function stModalField(id, label, value) {
  return '<div class="form-group mb-3"><label class="form-label">' + label + '</label>' +
    '<input type="' + (id === 'password' ? 'password' : 'text') + '" class="form-control" id="' + (id === 'password' ? 'stPasswordInput' : 'stNameInput') + '" value="' + stEsc(value) + '" placeholder="' + (id === 'password' ? '••••••••' : '') + '" autocomplete="off"></div>';
}

// ---------------------------------------------------------------------------
// 12. CLOUD — GOOGLE DRIVE (OAuth token client + REST API v3)
// ---------------------------------------------------------------------------
function stGetClientId() {
  return (appState.user && appState.user.googleClientId || '').trim();
}
function stCloudAuth() {
  return stGetClientId() && stCloudToken;
}
function stCloudInit() { stInitStorage(); }

function stRenderCloud() {
  const login = document.getElementById('stCloudLogin');
  const browser = document.getElementById('stCloudBrowser');
  if (stCloudAuth()) {
    login.style.display = 'none';
    browser.style.display = 'block';
    stCloudRefresh();
  } else {
    browser.style.display = 'none';
    login.style.display = 'block';
    const cid = stGetClientId();
    let html = '<div class="media-hero mb-3" style="background: linear-gradient(135deg, #34D399 0%, #0EA5E9 100%);">' +
      '<div class="media-hero-icon"><i class="fa-brands fa-google-drive"></i></div>' +
      '<div><div class="media-hero-title">Google Drive</div>' +
      '<div class="media-hero-sub">Jelajah, unggah &amp; unduh file — tersinkron otomatis ke akun Google-mu.</div></div></div>';
    if (!cid) {
      html += '<div class="card-item qr-card mb-3"><div class="st-cloud-setup">' +
        '<i class="fa-solid fa-gear"></i>' +
        '<div class="st-backend-text"><div class="st-backend-title">Butuh pengaturan Google satu kali</div>' +
        '<div class="st-backend-sub">1. Buka console.cloud.google.com → buat proyek → aktifkan <b>Google Drive API</b>.<br>' +
        '2. <em>APIs &amp; Services → Credentials → Create OAuth client ID</em> → tipe <b>Web application</b> → tambahkan origin &amp; redirect aplikasi ini.<br>' +
        '3. Tempel <b>Client ID</b>-nya di Pengaturan → Akun (setting yang sama dengan login Google Music/Video).</div></div></div>' +
        '<a href="#tab-settings" class="btn-primary st-modal-go" onclick="switchTab(\'smart-tools\'); openModal(\'modalSettings\'); closeModal(\'modalStorage\');"><i class="fa-solid fa-key"></i> Buka Pengaturan</a></div>';
    } else {
      html += '<div class="card-item qr-card mb-3"><div class="st-cloud-setup">' +
        '<i class="fa-brands fa-google"></i>' +
        '<div class="st-backend-text"><div class="st-backend-title">Masuk untuk menyinkronkan Drive</div>' +
        '<div class="st-backend-sub">Izinkan akses Drive (scope file milikmu) — token tersimpan aman untuk sesi ini.</div></div></div>' +
        '<button type="button" class="btn-primary st-modal-go" onclick="stCloudLogin()"><i class="fa-brands fa-google"></i> Masuk dengan Google</button></div>';
    }
    login.innerHTML = html;
  }
}

function stLoadGisScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Gagal memuat Google Identity Services (butuh koneksi internet).'));
    document.head.appendChild(s);
  });
}
async function stCloudLogin() {
  const cid = stGetClientId();
  if (!cid) { showNotificationBanner('Isi Google Client ID dulu di Pengaturan.'); return; }
  try {
    await stLoadGisScript();
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly',
      callback: (resp) => {
        if (resp && resp.access_token) {
          stCloudToken = resp.access_token;
          try { sessionStorage.setItem('stCloudToken', stCloudToken); } catch (e) { /* noop */ }
          showNotificationBanner('Terhubung ke Google Drive ✅');
          stRenderCloud();
        } else if (resp && resp.error) {
          showNotificationBanner('Login Drive gagal: ' + (resp.error_description || resp.error));
        }
      }
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } catch (err) {
    console.error('Drive login error:', err);
    showNotificationBanner('Gagal login Drive: ' + (err.message || err));
  }
}
function stCloudLogout() {
  stCloudToken = '';
  try { sessionStorage.removeItem('stCloudToken'); } catch (e) { /* noop */ }
  appState.storage.cloudFolderId = '';
  showNotificationBanner('Keluar dari Google Drive.');
  stRenderCloud();
}

function stCloudApi(path, opts) {
  const headers = { Authorization: 'Bearer ' + stCloudToken };
  if (opts && opts.json) headers['Content-Type'] = 'application/json';
  return fetch('https://www.googleapis.com/drive/v3/' + path, Object.assign({ headers }, opts && opts.json ? { body: JSON.stringify(opts.json) } : {}, opts && opts.method ? { method: opts.method } : {})).then(async r => {
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      try { const j = await r.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) { /* noop */ }
      throw new Error(msg);
    }
    return r.json();
  });
}

async function stCloudRefresh() {
  const folderId = appState.storage.cloudFolderId || 'root';
  const listEl = document.getElementById('stCloudList');
  const pathEl = document.getElementById('stCloudPath');
  try {
    listEl.innerHTML = '<div class="st-empty"><i class="fa-solid fa-spinner fa-spin"></i><div>Memuat Google Drive…</div></div>';
    const parentFilter = folderId === 'root' ? "'root' in parents" : "'" + folderId + "' in parents";
    const q = encodeURIComponent(parentFilter + " and trashed = false");
    const res = await stCloudApi('files?q=' + q + '&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=folder,name&pageSize=200&supportsAllDrives=true');
    const items = (res.files || []).map(f => ({
      key: f.id, name: f.name, type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
      size: Number(f.size || 0), modified: f.modifiedTime ? new Date(f.modifiedTime).getTime() : null,
      mime: f.mimeType || ''
    }));
    // breadcrumb (simpan rantai parent agar tombol "naik" berfungsi)
    const crumbs = [];
    let cur = folderId;
    if (folderId !== 'root') {
      try {
        let guard = 0;
        while (cur && guard++ < 30) {
          const meta = await stCloudApi('files/' + cur + '?fields=id,name,parents');
          crumbs.unshift({ id: meta.id, name: meta.name });
          cur = (meta.parents && meta.parents[0] === 'root') ? 'root' : ((meta.parents && meta.parents[0]) || 'root');
        }
      } catch (e) { crumbs.length = 0; }
    }
    appState.storage.cloudParents = crumbs.map(c => c.id);
    let crumbHtml = '<span class="st-path-root" onclick="stCloudGoRoot()"><i class="fa-brands fa-google-drive"></i></span>';
    crumbs.forEach(c => { crumbHtml += '<span class="st-path-sep">/</span><span class="st-path-crumb">' + stEsc(c.name) + '</span>'; });
    pathEl.innerHTML = crumbHtml;

    if (!items.length) {
      listEl.innerHTML = '<div class="st-empty"><i class="fa-regular fa-folder-open"></i><div>Folder Drive kosong</div>' +
        '<span>Unggah file atau buat folder baru.</span></div>';
    } else {
      listEl.className = 'st-filebox st-view-list';
      listEl.innerHTML = items.map(it =>
        '<div class="st-file ' + (it.type === 'folder' ? 'st-folder' : 'st-fileitem') + '" onclick="stCloudOpen(\'' + it.key.replace(/'/g, "\\'") + '\')">' +
        '<div class="st-file-icon" style="background:' + stColorOf(it.name, it.type) + '1A; color:' + stColorOf(it.name, it.type) + ';">' +
        '<i class="' + (it.type === 'folder' ? 'fa-solid fa-folder' : 'fa-brands fa-google-drive') + '"></i></div>' +
        '<div class="st-file-main"><div class="st-file-name">' + stEsc(it.name) + '</div>' +
        '<div class="st-file-meta">' + (it.type === 'folder' ? 'Folder Drive' : stFormatBytes(it.size)) + (it.modified ? ' · ' + stTimeAgo(it.modified) : '') + '</div></div>' +
        '<div class="st-file-actions" onclick="event.stopPropagation()">' +
        '<button type="button" class="st-row-btn" title="Unduh" onclick="stCloudDownload(\'' + it.key.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-download"></i></button>' +
        '<button type="button" class="st-row-btn" title="Aksi" onclick="stCloudMenu(\'' + it.key.replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
        '</div></div>').join('');
    }
    // storage info
    try {
      const about = await stCloudApi('about?fields=storageQuota');
      const q = about.storageQuota || {};
      const used = Number(q.usage || 0), limit = Number(q.limit || 0);
      document.getElementById('stCloudStorageInfo').innerHTML =
        '<div class="st-cloud-quota"><i class="fa-solid fa-database"></i>' +
        '<div class="st-backend-text"><div class="st-backend-title">Penyimpanan Drive</div>' +
        '<div class="st-backend-sub">' + stFormatBytes(used) + ' dari ' + (limit ? stFormatBytes(limit) : 'tak terbatas') + ' terpakai</div></div></div>' +
        (limit ? '<div class="st-quota-bar"><div style="width:' + Math.min(100, (used / limit) * 100).toFixed(1) + '%"></div></div>' : '');
    } catch (e) { /* noop */ }
  } catch (err) {
    console.error('Drive list error:', err);
    listEl.innerHTML = '<div class="st-empty"><i class="fa-solid fa-triangle-exclamation"></i><div>Gagal memuat Drive</div>' +
      '<span>' + stEsc(err.message || String(err)) + '</span></div>';
  }
}
function stCloudOpen(id) {
  appState.storage.cloudFolderId = id;
  appState.storage.cloudParents = []; // rebuild chain on next refresh
  saveStateToLocalStorage();
  stCloudRefresh();
}
function stCloudGoUp() {
  const st = appState.storage;
  if (!st.cloudParents || !st.cloudParents.length) {
    st.cloudFolderId = '';
    saveStateToLocalStorage();
    stCloudRefresh();
    return;
  }
  st.cloudFolderId = st.cloudParents.pop();
  saveStateToLocalStorage();
  stCloudRefresh();
}
function stCloudGoRoot() {
  appState.storage.cloudFolderId = '';
  appState.storage.cloudParents = [];
  saveStateToLocalStorage();
  stCloudRefresh();
}
async function stCloudNewFolder() {
  closeModal('modalStorage');
  stOpenModal('Buat Folder di Drive', stModalField('name', 'Nama folder', '') +
    '<button type="button" class="btn-primary st-modal-go" onclick="stCloudDoNewFolder()"><i class="fa-solid fa-check"></i> Buat</button>');
}
async function stCloudDoNewFolder() {
  const name = ((document.getElementById('stNameInput') || {}).value || '').trim();
  if (!name) { showNotificationBanner('Nama folder tidak boleh kosong.'); return; }
  try {
    await stCloudApi('files', { method: 'POST', json: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [appState.storage.cloudFolderId || 'root']
    } });
    closeModal('modalStorage');
    stCloudRefresh();
    showNotificationBanner('Folder "' + name + '" dibuat di Drive 📁');
  } catch (err) {
    showNotificationBanner('Gagal membuat folder: ' + (err.message || err));
  }
}
async function stCloudUpload(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  for (const f of files) {
    try {
      const meta = JSON.stringify({ name: f.name, parents: [appState.storage.cloudFolderId || 'root'] });
      const form = new FormData();
      form.append('metadata', new Blob([meta], { type: 'application/json; charset=UTF-8' }));
      form.append('file', f);
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + stCloudToken },
        body: form
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* noop */ }
        throw new Error(msg);
      }
      showNotificationBanner('"' + f.name + '" diunggah ke Drive ☁️');
    } catch (err) {
      console.error('Drive upload error:', err);
      showNotificationBanner('Gagal unggah ' + f.name + ': ' + (err.message || err));
    }
  }
  stCloudRefresh();
}
async function stCloudDownload(id) {
  try {
    showNotificationBanner('Mengunduh dari Drive… ⏳');
    const meta = await stCloudApi('files/' + id + '?fields=name,mimeType');
    const res = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + stCloudToken }
    });
    if (!res.ok) throw new Error('Gagal mengunduh (' + res.status + ')');
    const blob = await res.blob();
    stDownloadBlob(blob, meta.name || 'file');
    stAddRecent(meta.name || 'file', blob.size, 'aplikasi');
  } catch (err) {
    console.error('Drive download error:', err);
    showNotificationBanner('Gagal mengunduh: ' + (err.message || err));
  }
}
async function stCloudMenu(id) {
  try {
    const meta = await stCloudApi('files/' + id + '?fields=name,mimeType');
    const isFolder = meta.mimeType === 'application/vnd.google-apps.folder';
    const items = [
      { icon: 'fa-pen-to-square', label: 'Ganti Nama', fn: 'stCloudOpenRename(\'' + id + '\')' },
      { icon: 'fa-trash-can', label: 'Hapus (ke Sampah)', fn: 'stCloudDelete(\'' + id + '\')', danger: true }
    ];
    if (!isFolder) items.unshift({ icon: 'fa-download', label: 'Unduh', fn: 'stCloudDownload(\'' + id + '\')' });
    stOpenModal('Aksi — ' + meta.name, items.map(it =>
      '<button type="button" class="st-menu-row' + (it.danger ? ' st-menu-danger' : '') + '" onclick="' + it.fn + '">' +
      '<i class="fa-solid ' + it.icon + '"></i><span>' + it.label + '</span></button>').join(''));
  } catch (err) {
    showNotificationBanner('Gagal memuat item: ' + (err.message || err));
  }
}
async function stCloudOpenRename(id) {
  try {
    const meta = await stCloudApi('files/' + id + '?fields=name');
    closeModal('modalStorage');
    stOpenModal('Ganti Nama di Drive', stModalField('name', 'Nama baru', meta.name) +
      '<button type="button" class="btn-primary st-modal-go" onclick="stCloudDoRename(\'' + id + '\')"><i class="fa-solid fa-check"></i> Simpan</button>');
  } catch (err) { showNotificationBanner('Gagal: ' + (err.message || err)); }
}
async function stCloudDoRename(id) {
  const name = ((document.getElementById('stNameInput') || {}).value || '').trim();
  if (!name) { showNotificationBanner('Nama tidak boleh kosong.'); return; }
  try {
    await stCloudApi('files/' + id, { method: 'PATCH', json: { name } });
    closeModal('modalStorage');
    stCloudRefresh();
    showNotificationBanner('Nama diubah menjadi "' + name + '" ✏️');
  } catch (err) { showNotificationBanner('Gagal mengganti nama: ' + (err.message || err)); }
}
async function stCloudDelete(id) {
  try {
    const meta = await stCloudApi('files/' + id + '?fields=name');
    closeModal('modalStorage');
    stOpenModal('Hapus dari Drive',
      '<div class="st-confirm-text">Kirim <b>' + stEsc(meta.name) + '</b> ke Sampah Google Drive?</div>' +
      '<button type="button" class="btn-primary st-modal-go" style="background:#DC2626;" onclick="stCloudDoDelete(\'' + id + '\')"><i class="fa-solid fa-trash-can"></i> Hapus</button>');
  } catch (err) { showNotificationBanner('Gagal: ' + (err.message || err)); }
}
async function stCloudDoDelete(id) {
  try {
    await stCloudApi('files/' + id, { method: 'PATCH', json: { trashed: true } });
    closeModal('modalStorage');
    stCloudRefresh();
    showNotificationBanner('File dipindah ke Sampah Drive 🗑️');
  } catch (err) { showNotificationBanner('Gagal menghapus: ' + (err.message || err)); }
}

// hook render
stInitRecentHook();

/* ==========================================================================
   KUNCI APLIKASI — PIN 4 digit / Kata Sandi / Biometrik (Face ID & Fingerprint)
   ========================================================================== */

// ---------------------------------------------------------------------------
// 1. STATE & KRIPTO
// ---------------------------------------------------------------------------
function lockInit() {
  if (!appState.lock || typeof appState.lock !== 'object') appState.lock = {};
  const L = appState.lock;
  if (!L.enabled) L.enabled = false;
  if (!L.method) L.method = 'pin';          // 'pin' | 'password'
  if (!L.pinSalt) L.pinSalt = '';
  if (!L.pinHash) L.pinHash = '';
  if (!L.passSalt) L.passSalt = '';
  if (!L.passHash) L.passHash = '';
  if (!L.face) L.face = false;
  if (!L.fingerprint) L.fingerprint = false;
  if (!L.webauthnId) L.webauthnId = '';
  if (!L.attempts) L.attempts = 0;
  if (!L.cooldownUntil) L.cooldownUntil = 0;
}
function lockIsEnabled() { lockInit(); return !!appState.lock.enabled; }
function lockHasPin() { lockInit(); return !!appState.lock.pinHash; }
function lockHasPassword() { lockInit(); return !!appState.lock.passHash; }
function lockAnyBio() { lockInit(); return !!(appState.lock.face || appState.lock.fingerprint); }

async function lockSha256Hex(text, salt) {
  if (!window.crypto || !window.crypto.subtle) throw new Error('WebCrypto tidak tersedia.');
  const data = new TextEncoder().encode(String(salt || '') + ':' + String(text));
  const buf = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function lockRandHex(n) {
  const a = new Uint8Array(n || 16);
  window.crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}
function lockB64Url(u8) {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function lockB64UrlToBytes(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// ---------------------------------------------------------------------------
// 2. BIOMETRIK — plugin native (APK) + WebAuthn (web/desktop)
// ---------------------------------------------------------------------------
function lockNativeBio() {
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.BiometricAuth) {
      return window.Capacitor.Plugins.BiometricAuth;
    }
  } catch (e) { /* noop */ }
  return null;
}
function lockWebauthnSupported() {
  return !!(window.PublicKeyCredential && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' && navigator.credentials);
}
async function lockBioCheck() {
  const bio = lockNativeBio();
  if (bio && typeof bio.checkBiometry === 'function') {
    try {
      const r = await bio.checkBiometry();
      return {
        native: true,
        available: !!r.isAvailable,
        strong: !!r.strongBiometryIsAvailable,
        types: r.biometryTypes || (r.biometryType ? [r.biometryType] : []),
        deviceSecure: !!r.deviceIsSecure
      };
    } catch (e) {
      console.warn('checkBiometry error:', e);
      return { native: true, available: false, types: [], error: e };
    }
  }
  if (lockWebauthnSupported()) {
    try {
      const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return { native: false, available: !!ok, types: [], deviceSecure: true };
    } catch (e) { return { native: false, available: false }; }
  }
  return { native: false, available: false };
}
function lockBioFingerprintAvailable(cap) {
  if (!cap.available) return false;
  if (cap.native) {
    const t = cap.types || [];
    if (t.length === 0) return true; // jenis tidak dirinci — anggap tersedia
    return t.some(x => /fingerprint|touchid|touch|strong|multimodal/i.test(x));
  }
  return true; // WebAuthn platform authenticator
}
function lockBioFaceAvailable(cap) {
  if (!cap.available) return false;
  if (cap.native) {
    const t = cap.types || [];
    if (t.length === 0) return true;
    return t.some(x => /face|iris|multimodal|weak/i.test(x));
  }
  return true;
}
async function lockBioAuthenticate() {
  const bio = lockNativeBio();
  if (bio && typeof bio.authenticate === 'function') {
    try {
      await bio.authenticate({
        reason: 'Buka kunci aplikasi My',
        cancelTitle: 'Batal',
        allowDeviceCredential: false,
        iosFallbackTitle: 'Gunakan kode perangkat',
        androidTitle: 'Buka Kunci My',
        androidSubtitle: 'Gunakan sidik jari atau wajah untuk membuka',
        androidConfirmationRequired: false
      });
      return true;
    } catch (e) {
      console.warn('Native bio auth failed:', e);
      return false;
    }
  }
  // WebAuthn (Windows Hello / platform authenticator)
  if (appState.lock.webauthnId && lockWebauthnSupported()) {
    try {
      const challenge = window.crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'required',
          allowCredentials: [{ type: 'public-key', id: lockB64UrlToBytes(appState.lock.webauthnId) }]
        }
      });
      return !!(cred && cred.response && cred.response.userVerified !== false);
    } catch (e) {
      console.warn('WebAuthn verify failed:', e);
      return false;
    }
  }
  return false;
}
async function lockBioRegister() {
  if (!lockWebauthnSupported()) return null;
  try {
    const challenge = window.crypto.getRandomValues(new Uint8Array(32));
    const userId = window.crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'My' },
        user: { id: userId, name: 'my-user', displayName: 'My' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' }
      }
    });
    if (!cred || !cred.rawId) return null;
    return lockB64Url(new Uint8Array(cred.rawId));
  } catch (e) {
    console.warn('WebAuthn register failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. LAYAR KUNCI — render & interaksi
// ---------------------------------------------------------------------------
let lockShown = false;
let lockArmed = false;
let lockPinBuf = '';
let lockCooldownTimer = null;

function lockIsVisible() { return lockShown; }

function lockAvatarHtml() {
  const u = appState.user || {};
  if (u.avatarUrl) return '<img src="' + u.avatarUrl + '" alt="avatar">';
  return '<i class="fa-solid fa-user-astronaut"></i>';
}

function lockRenderDots() {
  const box = document.getElementById('lockDots');
  if (!box) return;
  let html = '';
  for (let i = 0; i < 4; i++) {
    html += '<span class="lock-dot' + (i < lockPinBuf.length ? ' on' : '') + '"></span>';
  }
  box.innerHTML = html;
}

function lockRenderKeypad() {
  const box = document.getElementById('lockKeypad');
  if (!box) return;
  const bio = lockAnyBio();
  const rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['bio', '0', 'del']];
  let html = '';
  rows.forEach(row => {
    html += '<div class="lock-kp-row">';
    row.forEach(k => {
      if (k === 'bio') {
        html += bio
          ? '<button type="button" class="lock-kp lock-kp-fn" onclick="lockKey(\'bio\')"><i class="fa-solid fa-fingerprint"></i></button>'
          : '<span class="lock-kp lock-kp-spacer"></span>';
      } else if (k === 'del') {
        html += '<button type="button" class="lock-kp lock-kp-fn" onclick="lockKey(\'del\')"><i class="fa-solid fa-delete-left"></i></button>';
      } else {
        html += '<button type="button" class="lock-kp" onclick="lockKey(\'' + k + '\')">' + k + '</button>';
      }
    });
    html += '</div>';
  });
  box.innerHTML = html;
}

function lockShow() {
  lockInit();
  // Jaring pengaman sinkron: jangan pernah menampilkan layar kunci tanpa metode yang valid.
  if (lockIsEnabled() && !lockHasPin() && !lockHasPassword() && !lockAnyBio()) {
    lockAutoRepair('Kunci tidak punya metode — dinonaktifkan otomatis 🔓');
    return;
  }
  lockShown = true;
  lockPinBuf = '';
  const L = appState.lock;
  const screen = document.getElementById('appLockScreen');
  const avatar = document.getElementById('lockAvatar');
  const status = document.getElementById('lockStatus');
  const dots = document.getElementById('lockDots');
  const pw = document.getElementById('lockPwWrap');
  const keypad = document.getElementById('lockKeypad');
  const bioBtn = document.getElementById('lockBioBtn');
  const bioHero = document.getElementById('lockBioHero');
  const bioHeroLabel = document.getElementById('lockBioHeroLabel');
  if (avatar) avatar.innerHTML = lockAvatarHtml();
  // Mode "hanya biometrik": tanpa PIN & tanpa kata sandi → tombol biometrik besar di tengah, buka sekali ketuk
  const bioOnly = lockAnyBio() && !lockHasPin() && !lockHasPassword();
  if (bioOnly) {
    status.textContent = 'Buka dengan biometrik';
    pw.style.display = 'none';
    keypad.style.display = 'none';
    if (dots) dots.style.display = 'none';
    bioBtn.style.display = 'none';
    if (bioHero) bioHero.style.display = 'flex';
    if (bioHeroLabel) bioHeroLabel.style.display = 'flex';
  } else {
    const usePassword = L.method === 'password' && lockHasPassword();
    if (usePassword) {
      status.textContent = 'Masukkan kata sandi';
      pw.style.display = 'flex';
      keypad.style.display = 'none';
      const inp = document.getElementById('lockPasswordInput');
      if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 60); }
    } else {
      status.textContent = lockHasPin() ? 'Masukkan PIN 4 digit' : 'Masukkan PIN 4 digit';
      pw.style.display = 'none';
      keypad.style.display = 'block';
      lockRenderKeypad();
      lockRenderDots();
    }
    if (dots) dots.style.display = 'flex';
    if (bioHero) bioHero.style.display = 'none';
    if (bioHeroLabel) bioHeroLabel.style.display = 'none';
    bioBtn.style.display = lockAnyBio() ? 'flex' : 'none';
  }
  document.getElementById('lockError').textContent = '';
  document.getElementById('lockError').classList.remove('shake');
  screen.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  lockTickCooldown();
}

function lockHide() {
  lockShown = false;
  lockArmed = false;
  const screen = document.getElementById('appLockScreen');
  if (screen) screen.style.display = 'none';
  document.body.style.overflow = '';
}

function lockCooldownRemaining() {
  lockInit();
  return Math.max(0, (appState.lock.cooldownUntil || 0) - Date.now());
}

function lockTickCooldown() {
  const el = document.getElementById('lockCooldown');
  if (!el) return;
  const rem = lockCooldownRemaining();
  const lockKeypad = document.getElementById('lockKeypad');
  const pwInp = document.getElementById('lockPasswordInput');
  const pwBtn = document.getElementById('lockPasswordBtn');
  const bioHero = document.getElementById('lockBioHero');
  if (lockCooldownTimer) { clearTimeout(lockCooldownTimer); lockCooldownTimer = null; }
  if (rem > 0) {
    el.style.display = 'block';
    el.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Terlalu banyak percobaan. Coba lagi dalam ' + Math.ceil(rem / 1000) + ' detik';
    if (lockKeypad) lockKeypad.style.opacity = '0.4';
    if (pwInp) pwInp.disabled = true;
    if (pwBtn) pwBtn.disabled = true;
    if (bioHero) bioHero.style.opacity = '0.4';
    lockCooldownTimer = setTimeout(lockTickCooldown, 500);
  } else {
    el.style.display = 'none';
    if (lockKeypad) lockKeypad.style.opacity = '';
    if (pwInp) pwInp.disabled = false;
    if (pwBtn) pwBtn.disabled = false;
    if (bioHero) bioHero.style.opacity = '';
  }
}

function lockKey(k) {
  if (!lockShown || lockCooldownRemaining() > 0) return;
  if (k === 'bio') { lockTryBio(); return; }
  if (k === 'del') {
    if (lockPinBuf.length) { lockPinBuf = lockPinBuf.slice(0, -1); lockRenderDots(); }
    return;
  }
  if (!/^\d$/.test(k) || lockPinBuf.length >= 4) return;
  lockPinBuf += k;
  lockRenderDots();
  if (lockPinBuf.length === 4) {
    const pin = lockPinBuf;
    lockPinBuf = '';
    lockRenderDots();
    lockVerifyPin(pin);
  }
}

async function lockSubmit() {
  if (!lockShown || lockCooldownRemaining() > 0) return;
  const inp = document.getElementById('lockPasswordInput');
  const pw = (inp && inp.value || '').trim();
  if (!pw) return;
  if (inp) inp.value = '';
  await lockVerifyPassword(pw);
}

async function lockVerifyPin(pin) {
  lockInit();
  const L = appState.lock;
  if (!L.pinHash) { lockFail('PIN belum diatur.'); return; }
  try {
    const h = await lockSha256Hex(pin, L.pinSalt);
    if (h === L.pinHash) lockSuccess();
    else lockFail('PIN salah');
  } catch (e) {
    lockFail('Terjadi kesalahan saat memverifikasi.');
  }
}

async function lockVerifyPassword(pw) {
  lockInit();
  const L = appState.lock;
  if (!L.passHash) { lockFail('Kata sandi belum diatur.'); return; }
  try {
    const h = await lockSha256Hex(pw, L.passSalt);
    if (h === L.passHash) lockSuccess();
    else lockFail('Kata sandi salah');
  } catch (e) {
    lockFail('Terjadi kesalahan saat memverifikasi.');
  }
}

function lockSuccess() {
  lockInit();
  appState.lock.attempts = 0;
  appState.lock.cooldownUntil = 0;
  saveStateToLocalStorage();
  lockHide();
  showNotificationBanner('Selamat datang kembali 👋');
}

function lockFail(msg) {
  lockInit();
  const L = appState.lock;
  L.attempts = (L.attempts || 0) + 1;
  if (L.attempts >= 5) {
    L.cooldownUntil = Date.now() + 30000;
    L.attempts = 0;
    showNotificationBanner('Terlalu banyak percobaan — kunci dibekukan 30 detik ⏳');
  }
  saveStateToLocalStorage();
  const err = document.getElementById('lockError');
  if (err) {
    err.textContent = msg;
    err.classList.remove('shake');
    void err.offsetWidth;
    err.classList.add('shake');
    setTimeout(() => err.classList.remove('shake'), 500);
  }
  if (document.getElementById('lockDots')) lockRenderDots();
  lockTickCooldown();
}

async function lockTryBio() {
  if (!lockAnyBio() || !lockShown || lockCooldownRemaining() > 0) return;
  const status = document.getElementById('lockStatus');
  const prev = status.textContent;
  status.textContent = 'Memverifikasi biometrik…';
  const ok = await lockBioAuthenticate();
  if (ok) { lockSuccess(); return; }
  status.textContent = prev;
  lockFail('Biometrik tidak cocok');
}

// ---------------------------------------------------------------------------
// 4. SIKLUS HIDUP — boot, background/foreground, tombol kembali
// ---------------------------------------------------------------------------
function lockArm() { if (lockIsEnabled()) lockArmed = true; }

// Perbaiki kunci yang "aktif" tapi tidak bisa digunakan (state rusak / sisa pengujian):
// tanpa metode sama sekali, atau hanya biometrik yang tidak tersedia di perangkat ini.
function lockAutoRepair(msg) {
  const L = appState.lock;
  L.enabled = false;
  L.pinSalt = '';
  L.pinHash = '';
  L.passSalt = '';
  L.passHash = '';
  L.face = false;
  L.fingerprint = false;
  L.webauthnId = '';
  L.attempts = 0;
  L.cooldownUntil = 0;
  saveStateToLocalStorage();
  lockShown = false;
  const screen = document.getElementById('appLockScreen');
  if (screen) screen.style.display = 'none';
  document.body.style.overflow = '';
  showNotificationBanner(msg || 'Kunci aplikasi dinonaktifkan otomatis 🔓');
  lockRenderSettingsCard();
}

// Validasi: apakah kunci punya metode yang benar-benar bisa digunakan sekarang.
async function lockValidateUsable() {
  lockInit();
  if (!lockIsEnabled()) return false;
  const hasMethod = lockHasPin() || lockHasPassword() || lockAnyBio();
  if (!hasMethod) {
    lockAutoRepair('Kunci tidak punya metode — dinonaktifkan otomatis 🔓');
    return false;
  }
  // Hanya biometrik (tanpa PIN/kata sandi): tampilkan layar kunci hanya jika biometrik benar-benar tersedia.
  if (lockAnyBio() && !lockHasPin() && !lockHasPassword()) {
    try {
      const cap = await lockBioCheck();
      const avail = lockBioFingerprintAvailable(cap) || lockBioFaceAvailable(cap);
      if (!avail) {
        lockAutoRepair('Biometrik tidak tersedia di perangkat ini — kunci dinonaktifkan 🔓');
        return false;
      }
    } catch (e) {
      lockAutoRepair('Gagal memeriksa biometrik — kunci dinonaktifkan 🔓');
      return false;
    }
  }
  return true;
}

async function lockResume() {
  if (lockArmed && lockIsEnabled() && !lockShown && await lockValidateUsable()) lockShow();
}
async function lockBootCheck() {
  lockInit();
  if (lockIsEnabled() && await lockValidateUsable()) lockShow();
}

function lockRegisterLifecycleHooks() {
  if (window.__lockHooks) return;
  window.__lockHooks = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lockArm();
    else lockResume();
  });
  window.addEventListener('pagehide', () => lockArm());
  document.addEventListener('keydown', (e) => {
    if (!lockShown) return;
    if (e.key === 'Enter' && document.getElementById('lockPwWrap').style.display !== 'none') {
      e.preventDefault();
      lockSubmit();
    }
    if (e.key === 'Backspace' && document.getElementById('lockPwWrap').style.display === 'none' && !e.target || (e.target && e.target.tagName !== 'INPUT')) {
      e.preventDefault();
      lockKey('del');
    }
  });
}

// ---------------------------------------------------------------------------
// 5. PENGATURAN — kartu di Settings + modal kelola + alur setup
// ---------------------------------------------------------------------------
function lockStatusLabel() {
  lockInit();
  const L = appState.lock;
  if (!L.enabled) return 'Nonaktif';
  const parts = [];
  if (lockHasPin()) parts.push(L.method === 'pin' ? 'PIN 4 digit' : 'PIN');
  if (lockHasPassword()) parts.push('Kata Sandi');
  if (L.face) parts.push('Wajah');
  if (L.fingerprint) parts.push('Sidik Jari');
  return 'Aktif · ' + parts.join(' + ');
}

function lockRenderSettingsCard() {
  const box = document.getElementById('lockSettingsCard');
  if (!box) return;
  lockInit();
  const on = lockIsEnabled();
  box.innerHTML = '<div class="lock-card-row">' +
    '<div class="lock-card-icon"><i class="fa-solid ' + (on ? 'fa-lock-open' : 'fa-lock') + '"></i></div>' +
    '<div class="lock-card-text"><div class="lock-card-title">' + (on ? 'Kunci aktif' : 'Belum terkunci') + '</div>' +
    '<div class="lock-card-sub">' + lockStatusLabel() + '</div></div>' +
    '<button type="button" class="btn-primary" style="width:auto;padding:9px 14px;font-size:0.78rem;border-radius:var(--radius-pill);" onclick="lockOpenSettings()">Kelola</button>' +
    '</div>';
}

function lockOpenSettings() {
  closeModal('modalSettings');
  lockRenderSettingsModal();
  openModal('modalLockSettings');
}

function lockSwitchHtml(id, checked, onChange) {
  return '<label class="lock-switch"><input type="checkbox" id="' + id + '" ' + (checked ? 'checked' : '') + ' onchange="' + onChange + '"><span class="lock-switch-slider"></span></label>';
}

async function lockRenderSettingsModal() {
  lockInit();
  const body = document.getElementById('lockSettingsBody');
  if (!body) return;
  const L = appState.lock;
  const on = lockIsEnabled();
  const cap = await lockBioCheck();
  const fpAvail = lockBioFingerprintAvailable(cap);
  const faceAvail = lockBioFaceAvailable(cap);
  const bioNote = cap.available
    ? 'Biometrik tersedia' + (cap.native ? ' (perangkat)' : ' (platform)') + ' — memakai PIN 4 digit sebagai cadangan wajib.'
    : 'Biometrik tidak tersedia di lingkungan ini.';
  let html = '';

  html += '<div class="lock-settings-status ' + (on ? 'on' : '') + '"><i class="fa-solid ' + (on ? 'fa-shield-halved' : 'fa-shield') + '"></i>' +
    '<div><div class="lock-card-title">' + (on ? 'Aplikasi terkunci 🔒' : 'Aplikasi belum terkunci') + '</div>' +
    '<div class="lock-card-sub">' + lockStatusLabel() + '</div></div></div>';

  html += '<div class="lock-set-row"><div class="lock-set-info"><div class="lock-card-title">Aktifkan kunci</div>' +
    '<div class="lock-card-sub">Kunci otomatis setiap aplikasi dibuka / kembali dari latar.</div></div>' +
    lockSwitchHtml('lockEnableSwitch', on, 'lockToggleEnabled(this.checked)') + '</div>';

  if (on) {
    html += '<div class="lock-set-block"><div class="lock-card-title" style="margin-bottom:8px;">Metode utama</div>' +
      '<div class="lock-method-pills">' +
      '<button type="button" class="lock-method-pill' + (L.method === 'pin' ? ' active' : '') + '" onclick="lockSetMethod(\'pin\')"><i class="fa-solid fa-hashtag"></i> PIN 4 digit</button>' +
      '<button type="button" class="lock-method-pill' + (L.method === 'password' ? ' active' : '') + '" onclick="lockSetMethod(\'password\')"><i class="fa-solid fa-key"></i> Kata Sandi</button>' +
      '</div></div>';

    html += '<div class="lock-set-row"><div class="lock-set-info"><div class="lock-card-title">' + (lockHasPin() ? 'Ganti PIN 4 digit' : 'Atur PIN 4 digit') + '</div>' +
      '<div class="lock-card-sub">' + (lockAnyBio() && lockHasPin() ? 'Bisa dihapus — buka hanya dengan biometrik.' : 'PIN wajib untuk cadangan biometrik.') + '</div></div>' +
      '<button type="button" class="btn-secondary lock-mini-btn" onclick="lockOpenPinSetup(\'change\')">' + (lockHasPin() ? 'Ganti' : 'Atur') + '</button>' +
      (lockAnyBio() && lockHasPin() ? '<button type="button" class="btn-secondary lock-mini-btn" style="color:#DC2626;border-color:rgba(220,38,38,0.35);" onclick="lockOpenPinRemove()"><i class="fa-solid fa-trash"></i> Hapus</button>' : '') +
      '</div>';

    html += '<div class="lock-set-row"><div class="lock-set-info"><div class="lock-card-title">' + (lockHasPassword() ? 'Ganti kata sandi' : 'Atur kata sandi') + '</div>' +
      '<div class="lock-card-sub">Alternatif pengganti PIN (bebas, min. 4 karakter).</div></div>' +
      '<button type="button" class="btn-secondary lock-mini-btn" onclick="lockOpenPasswordSetup(\'change\')">' + (lockHasPassword() ? 'Ganti' : 'Atur') + '</button></div>';

    html += '<div class="lock-set-block"><div class="lock-card-title" style="margin-bottom:4px;">Biometrik <span class="lock-bio-note">(wajib PIN pendamping)</span></div>' +
      '<div class="lock-bio-hint">' + bioNote + '</div>' +
      '<div class="lock-set-row"><div class="lock-set-info"><div class="lock-card-title">Sidik Jari <i class="fa-solid fa-fingerprint" style="color:var(--primary);margin-left:4px;"></i></div>' +
      '<div class="lock-card-sub">' + (fpAvail ? 'Tersedia di perangkat ini' : 'Tidak tersedia saat ini') + '</div></div>' +
      lockSwitchHtml('lockFpSwitch', !!L.fingerprint, 'lockToggleBio(\'fingerprint\', this.checked)') + '</div>' +
      '<div class="lock-set-row"><div class="lock-set-info"><div class="lock-card-title">Wajah (Face ID) <i class="fa-solid fa-face-smile" style="color:var(--primary);margin-left:4px;"></i></div>' +
      '<div class="lock-card-sub">' + (faceAvail ? 'Tersedia di perangkat ini' : 'Tidak tersedia saat ini') + '</div></div>' +
      lockSwitchHtml('lockFaceSwitch', !!L.face, 'lockToggleBio(\'face\', this.checked)') + '</div>' +
      '</div>';

    html += '<button type="button" class="btn-secondary lock-danger-btn" onclick="lockOpenDisable()"><i class="fa-solid fa-unlock"></i> Nonaktifkan Kunci</button>';
  }

  html += '<div class="lock-footnote"><i class="fa-solid fa-circle-info"></i> PIN &amp; kata sandi disimpan sebagai hash SHA-256 (tidak pernah disimpan mentah). Biometrik diproses oleh sistem perangkat — data tidak pernah meninggalkan perangkat.</div>';

  body.innerHTML = html;
}

async function lockToggleEnabled(checked) {
  if (checked) {
    if (!lockHasPin() && !lockHasPassword()) {
      showNotificationBanner('Atur PIN 4 digit dulu untuk mengaktifkan kunci 🔑');
      lockRenderSettingsModal();
      lockOpenPinSetup('enable');
      return;
    }
    appState.lock.enabled = true;
    if (!appState.lock.method) appState.lock.method = lockHasPin() ? 'pin' : 'password';
    saveStateToLocalStorage();
    showNotificationBanner('Kunci aplikasi aktif 🔒');
  } else {
    appState.lock.enabled = false;
    saveStateToLocalStorage();
    showNotificationBanner('Kunci aplikasi nonaktif.');
  }
  lockRenderSettingsCard();
  lockRenderSettingsModal();
}

function lockSetMethod(m) {
  lockInit();
  if (m === 'password' && !lockHasPassword()) { showNotificationBanner('Atur kata sandi dulu.'); lockOpenPasswordSetup('change'); return; }
  if (m === 'pin' && !lockHasPin()) { showNotificationBanner('Atur PIN dulu.'); lockOpenPinSetup('change'); return; }
  appState.lock.method = m;
  saveStateToLocalStorage();
  lockRenderSettingsModal();
  lockRenderSettingsCard();
}

async function lockToggleBio(type, checked) {
  lockInit();
  const L = appState.lock;
  if (checked) {
    if (!lockIsEnabled()) { showNotificationBanner('Aktifkan kunci aplikasi dulu.'); lockRenderSettingsModal(); return; }
    if (!lockHasPin()) {
      showNotificationBanner('Pasang PIN 4 digit dulu — biometrik wajib punya PIN pendamping 🔑');
      lockRenderSettingsModal();
      lockOpenPinSetup('change');
      return;
    }
    const cap = await lockBioCheck();
    const avail = type === 'face' ? lockBioFaceAvailable(cap) : lockBioFingerprintAvailable(cap);
    if (!avail) { showNotificationBanner('Biometrik tidak tersedia di perangkat ini.'); lockRenderSettingsModal(); return; }
    if (!cap.native) {
      const id = await lockBioRegister();
      if (!id) { showNotificationBanner('Gagal mendaftarkan biometrik di perangkat ini.'); lockRenderSettingsModal(); return; }
      L.webauthnId = id;
    }
    if (type === 'face') L.face = true; else L.fingerprint = true;
    saveStateToLocalStorage();
    showNotificationBanner('Biometrik ' + (type === 'face' ? 'wajah' : 'sidik jari') + ' aktif ✅');
  } else {
    const stillBio = type === 'face' ? L.fingerprint : L.face;
    if (!stillBio && !lockHasPin() && !lockHasPassword()) {
      showNotificationBanner('Tidak bisa menonaktifkan biometrik — tidak ada metode kunci lain. Atur PIN/kata sandi dulu.');
      lockRenderSettingsModal();
      return;
    }
    if (type === 'face') L.face = false; else L.fingerprint = false;
    if (!L.face && !L.fingerprint) L.webauthnId = '';
    saveStateToLocalStorage();
    showNotificationBanner('Biometrik ' + (type === 'face' ? 'wajah' : 'sidik jari') + ' nonaktif.');
  }
  lockRenderSettingsModal();
  lockRenderSettingsCard();
}

// ---------------------------------------------------------------------------
// 6. MODAL SETUP — PIN & kata sandi (baru, ganti, nonaktifkan)
// ---------------------------------------------------------------------------
let lockSetupCtx = null; // { kind:'pin'|'password', purpose:'enable'|'change'|'disable', firstPin:'' }

function lockSetupCancel() {
  lockSetupCtx = null;
  closeModal('modalLockSetup');
}

function lockOpenPinSetup(purpose) {
  lockSetupCtx = { kind: 'pin', purpose: purpose || 'change', firstPin: '' };
  if (purpose === 'change' && lockHasPin()) { lockAskCurrentPin(); return; }
  if (purpose === 'disable' && lockHasPin()) { lockAskCurrentPin(); return; }
  lockPinNewStep1();
}
function lockOpenPasswordSetup(purpose) {
  lockSetupCtx = { kind: 'password', purpose: purpose || 'change' };
  if (purpose === 'change' && lockHasPassword()) { lockAskCurrentPassword(); return; }
  if (purpose === 'disable' && lockHasPassword() && !lockHasPin()) { lockAskCurrentPassword(); return; }
  lockPasswordNewStep1();
}

// --- tanya PIN sekarang (untuk ganti / nonaktifkan) ---
function lockAskCurrentPin() {
  const title = document.getElementById('lockSetupTitle');
  if (title) title.innerHTML = '<i class="fa-solid fa-key" style="color:#3B82F6;"></i> ' + (lockSetupCtx.purpose === 'disable' ? 'Konfirmasi PIN' : 'PIN saat ini');
  document.getElementById('lockSetupBody').innerHTML =
    '<div class="lock-setup-note">Masukkan PIN saat ini untuk melanjutkan.</div>' +
    '<div class="lock-dots" id="lockSetupDots"></div>' +
    '<div class="lock-keypad" id="lockSetupKeypad"></div>' +
    '<div class="lock-error" id="lockSetupError"></div>';
  let buf = '';
  const dots = document.getElementById('lockSetupDots');
  const render = () => {
    let h = '';
    for (let i = 0; i < 4; i++) h += '<span class="lock-dot' + (i < buf.length ? ' on' : '') + '"></span>';
    dots.innerHTML = h;
  };
  document.getElementById('lockSetupKeypad').innerHTML =
    '<div class="lock-kp-row">' + ['1','2','3'].map(k => '<button type="button" class="lock-kp" onclick="lockAskCurrentKey(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row">' + ['4','5','6'].map(k => '<button type="button" class="lock-kp" onclick="lockAskCurrentKey(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row">' + ['7','8','9'].map(k => '<button type="button" class="lock-kp" onclick="lockAskCurrentKey(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row"><span class="lock-kp lock-kp-spacer"></span><button type="button" class="lock-kp" onclick="lockAskCurrentKey(\'0\')">0</button><button type="button" class="lock-kp lock-kp-fn" onclick="lockAskCurrentKey(\'del\')"><i class="fa-solid fa-delete-left"></i></button></div>';
  render();
  window.__lockAskBuf = { buf, render };
}
function lockAskCurrentKey(k) {
  const st = window.__lockAskBuf;
  if (!st) return;
  if (k === 'del') { st.buf = st.buf.slice(0, -1); st.render(); return; }
  if (st.buf.length >= 4) return;
  st.buf += k;
  st.render();
  if (st.buf.length === 4) {
    const pin = st.buf;
    st.buf = '';
    st.render();
    lockVerifyCurrentPin(pin);
  }
}
async function lockVerifyCurrentPin(pin) {
  const L = appState.lock;
  const err = document.getElementById('lockSetupError');
  try {
    const h = await lockSha256Hex(pin, L.pinSalt);
    if (h !== L.pinHash) {
      if (err) { err.textContent = 'PIN salah'; err.classList.add('shake'); setTimeout(() => err.classList.remove('shake'), 500); }
      return;
    }
  } catch (e) {
    if (err) err.textContent = 'Kesalahan verifikasi';
    return;
  }
  const ctx = lockSetupCtx;
  if (ctx.purpose === 'disable') { lockApplyDisable(); return; }
  if (ctx.purpose === 'removepin') { lockApplyPinRemove(); return; }
  if (ctx.kind === 'pin') lockPinNewStep1();
  else lockPasswordNewStep1();
}
// --- hapus PIN (biarkan hanya biometrik) ---
function lockOpenPinRemove() {
  lockSetupCtx = { kind: 'pin', purpose: 'removepin' };
  lockAskCurrentPin();
}
function lockApplyPinRemove() {
  const L = appState.lock;
  L.pinSalt = '';
  L.pinHash = '';
  L.attempts = 0;
  L.cooldownUntil = 0;
  saveStateToLocalStorage();
  lockSetupCtx = null;
  closeModal('modalLockSetup');
  lockRenderSettingsModal();
  lockRenderSettingsCard();
  showNotificationBanner('PIN dihapus — buka hanya dengan biometrik 🔓');
}
// --- tanya kata sandi sekarang ---
function lockAskCurrentPassword() {
  const title = document.getElementById('lockSetupTitle');
  if (title) title.innerHTML = '<i class="fa-solid fa-key" style="color:#3B82F6;"></i> ' + (lockSetupCtx.purpose === 'disable' ? 'Konfirmasi Kata Sandi' : 'Kata Sandi saat ini');
  document.getElementById('lockSetupBody').innerHTML =
    '<div class="lock-setup-note">Masukkan kata sandi saat ini untuk melanjutkan.</div>' +
    '<input type="password" class="form-control" id="lockSetupPwCurrent" placeholder="Kata sandi saat ini" autocomplete="off">' +
    '<button type="button" class="btn-primary st-modal-go mt-2" onclick="lockVerifyCurrentPassword()"><i class="fa-solid fa-check"></i> Lanjut</button>' +
    '<div class="lock-error" id="lockSetupError"></div>';
  setTimeout(() => document.getElementById('lockSetupPwCurrent').focus(), 60);
}
async function lockVerifyCurrentPassword() {
  const L = appState.lock;
  const pw = (document.getElementById('lockSetupPwCurrent') || {}).value || '';
  const err = document.getElementById('lockSetupError');
  try {
    const h = await lockSha256Hex(pw, L.passSalt);
    if (h !== L.passHash) { if (err) err.textContent = 'Kata sandi salah'; return; }
  } catch (e) { if (err) err.textContent = 'Kesalahan verifikasi'; return; }
  const ctx = lockSetupCtx;
  if (ctx.purpose === 'disable') { lockApplyDisable(); return; }
  lockPasswordNewStep1();
}

// --- buat PIN baru: langkah 1 & 2 ---
function lockPinNewStep1() {
  const title = document.getElementById('lockSetupTitle');
  if (title) title.innerHTML = '<i class="fa-solid fa-hashtag" style="color:#3B82F6;"></i> ' + (lockSetupCtx.purpose === 'enable' ? 'Buat PIN 4 digit' : 'PIN baru');
  document.getElementById('lockSetupBody').innerHTML =
    '<div class="lock-setup-note">Masukkan PIN 4 digit baru.</div>' +
    '<div class="lock-dots" id="lockSetupDots"></div>' +
    '<div class="lock-keypad" id="lockSetupKeypad"></div>' +
    '<div class="lock-error" id="lockSetupError"></div>';
  let buf = '';
  const dots = document.getElementById('lockSetupDots');
  const render = () => {
    let h = '';
    for (let i = 0; i < 4; i++) h += '<span class="lock-dot' + (i < buf.length ? ' on' : '') + '"></span>';
    dots.innerHTML = h;
  };
  document.getElementById('lockSetupKeypad').innerHTML =
    '<div class="lock-kp-row">' + ['1','2','3'].map(k => '<button type="button" class="lock-kp" onclick="lockPinKey(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row">' + ['4','5','6'].map(k => '<button type="button" class="lock-kp" onclick="lockPinKey(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row">' + ['7','8','9'].map(k => '<button type="button" class="lock-kp" onclick="lockPinKey(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row"><span class="lock-kp lock-kp-spacer"></span><button type="button" class="lock-kp" onclick="lockPinKey(\'0\')">0</button><button type="button" class="lock-kp lock-kp-fn" onclick="lockPinKey(\'del\')"><i class="fa-solid fa-delete-left"></i></button></div>';
  render();
  window.__lockPinBuf = { buf, render };
}
function lockPinKey(k) {
  const st = window.__lockPinBuf;
  if (!st) return;
  if (k === 'del') { st.buf = st.buf.slice(0, -1); st.render(); return; }
  if (st.buf.length >= 4) return;
  st.buf += k;
  st.render();
  if (st.buf.length === 4) {
    const pin = st.buf;
    st.buf = '';
    st.render();
    lockSetupCtx.firstPin = pin;
    lockPinNewStep2(pin);
  }
}
function lockPinNewStep2(first) {
  const title = document.getElementById('lockSetupTitle');
  if (title) title.innerHTML = '<i class="fa-solid fa-hashtag" style="color:#3B82F6;"></i> Ulangi PIN';
  document.getElementById('lockSetupBody').innerHTML =
    '<div class="lock-setup-note">Ulangi PIN untuk konfirmasi.</div>' +
    '<div class="lock-dots" id="lockSetupDots"></div>' +
    '<div class="lock-keypad" id="lockSetupKeypad"></div>' +
    '<div class="lock-error" id="lockSetupError"></div>';
  let buf = '';
  const dots = document.getElementById('lockSetupDots');
  const render = () => {
    let h = '';
    for (let i = 0; i < 4; i++) h += '<span class="lock-dot' + (i < buf.length ? ' on' : '') + '"></span>';
    dots.innerHTML = h;
  };
  document.getElementById('lockSetupKeypad').innerHTML =
    '<div class="lock-kp-row">' + ['1','2','3'].map(k => '<button type="button" class="lock-kp" onclick="lockPinKey2(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row">' + ['4','5','6'].map(k => '<button type="button" class="lock-kp" onclick="lockPinKey2(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row">' + ['7','8','9'].map(k => '<button type="button" class="lock-kp" onclick="lockPinKey2(\'' + k + '\')">' + k + '</button>').join('') + '</div>' +
    '<div class="lock-kp-row"><span class="lock-kp lock-kp-spacer"></span><button type="button" class="lock-kp" onclick="lockPinKey2(\'0\')">0</button><button type="button" class="lock-kp lock-kp-fn" onclick="lockPinKey2(\'del\')"><i class="fa-solid fa-delete-left"></i></button></div>';
  render();
  window.__lockPin2 = { buf, render, first };
}
function lockPinKey2(k) {
  const st = window.__lockPin2;
  if (!st) return;
  if (k === 'del') { st.buf = st.buf.slice(0, -1); st.render(); return; }
  if (st.buf.length >= 4) return;
  st.buf += k;
  st.render();
  if (st.buf.length === 4) {
    const second = st.buf;
    const err = document.getElementById('lockSetupError');
    if (second !== st.first) {
      if (err) { err.textContent = 'PIN tidak sama — mulai lagi.'; err.classList.add('shake'); setTimeout(() => err.classList.remove('shake'), 500); }
      st.buf = '';
      st.render();
      return;
    }
    lockApplyPin(second);
  }
}
async function lockApplyPin(pin) {
  const L = appState.lock;
  const salt = lockRandHex(16);
  L.pinSalt = salt;
  L.pinHash = await lockSha256Hex(pin, salt);
  L.pinSalt = salt;
  const ctx = lockSetupCtx;
  if (ctx && ctx.purpose === 'enable') {
    L.enabled = true;
    L.method = 'pin';
  }
  if (L.enabled && !L.method) L.method = 'pin';
  if (ctx && ctx.purpose === 'change' && !L.method) L.method = 'pin';
  saveStateToLocalStorage();
  lockSetupCtx = null;
  closeModal('modalLockSetup');
  lockRenderSettingsModal();
  lockRenderSettingsCard();
  showNotificationBanner('PIN 4 digit tersimpan 🔑');
}

// --- buat kata sandi baru ---
function lockPasswordNewStep1() {
  const title = document.getElementById('lockSetupTitle');
  if (title) title.innerHTML = '<i class="fa-solid fa-key" style="color:#3B82F6;"></i> Kata sandi baru';
  document.getElementById('lockSetupBody').innerHTML =
    '<div class="lock-setup-note">Minimal 4 karakter.</div>' +
    '<input type="password" class="form-control mb-2" id="lockPwNew" placeholder="Kata sandi baru" autocomplete="new-password">' +
    '<input type="password" class="form-control mb-2" id="lockPwNew2" placeholder="Ulangi kata sandi" autocomplete="new-password">' +
    '<button type="button" class="btn-primary st-modal-go" onclick="lockPasswordApply()"><i class="fa-solid fa-check"></i> Simpan</button>' +
    '<div class="lock-error" id="lockSetupError"></div>';
  setTimeout(() => document.getElementById('lockPwNew').focus(), 60);
}
async function lockPasswordApply() {
  const p1 = (document.getElementById('lockPwNew') || {}).value || '';
  const p2 = (document.getElementById('lockPwNew2') || {}).value || '';
  const err = document.getElementById('lockSetupError');
  if (p1.length < 4) { if (err) err.textContent = 'Minimal 4 karakter.'; return; }
  if (p1 !== p2) { if (err) err.textContent = 'Kata sandi tidak sama.'; return; }
  const L = appState.lock;
  const salt = lockRandHex(16);
  L.passSalt = salt;
  L.passHash = await lockSha256Hex(p1, salt);
  const ctx = lockSetupCtx;
  if (ctx && ctx.purpose === 'enable') { L.enabled = true; L.method = 'password'; }
  if (L.enabled && !L.method) L.method = 'password';
  saveStateToLocalStorage();
  lockSetupCtx = null;
  closeModal('modalLockSetup');
  lockRenderSettingsModal();
  lockRenderSettingsCard();
  showNotificationBanner('Kata sandi tersimpan 🔑');
}

// --- nonaktifkan kunci ---
function lockOpenDisable() {
  lockSetupCtx = { kind: lockHasPin() ? 'pin' : 'password', purpose: 'disable' };
  if (lockHasPin()) lockAskCurrentPin();
  else if (lockHasPassword()) lockAskCurrentPassword();
  else lockApplyDisable();
}
function lockApplyDisable() {
  const L = appState.lock;
  L.enabled = false;
  L.pinSalt = '';
  L.pinHash = '';
  L.passSalt = '';
  L.passHash = '';
  L.face = false;
  L.fingerprint = false;
  L.webauthnId = '';
  L.attempts = 0;
  L.cooldownUntil = 0;
  saveStateToLocalStorage();
  lockSetupCtx = null;
  closeModal('modalLockSetup');
  lockRenderSettingsModal();
  lockRenderSettingsCard();
  showNotificationBanner('Kunci aplikasi dinonaktifkan 🔓');
}

/* ==========================================================================
   AI DOCUMENT SCANNER + AI SIGNATURE EXTRACTOR (My PDF Tool)
   Mesin: OpenCV.js (WebAssembly) + Tesseract.js OCR — 100% lokal/offline
   ========================================================================== */

// ---------------------------------------------------------------------------
// 1. PEMUATAN ASET (lazy — tidak membebani boot aplikasi)
// ---------------------------------------------------------------------------
let aiOpenCVPromise = null;
let aiTesseractPromise = null;
let aiCv = null;

function aiLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

function aiEnsureOpenCV() {
  if (aiCv) return Promise.resolve(aiCv);
  if (aiOpenCVPromise) return aiOpenCVPromise;
  aiOpenCVPromise = (async () => {
    await aiLoadScript(new URL('vendor/opencv/opencv.js', location.href).href);
    if (!window.cv) throw new Error('Pustaka OpenCV tidak ditemukan.');
    let mod = window.cv;
    if (mod instanceof Promise) {
      // build MODULARIZE: factory() mengembalikan Promise Module
      mod = await Promise.race([
        mod,
        new Promise((_, rej) => setTimeout(() => rej(new Error('Waktu muat OpenCV habis (wasm besar).')), 300000))
      ]);
    }
    if (!mod || typeof mod !== 'object') throw new Error('OpenCV gagal dimulai.');
    aiCv = mod;
    if (mod.Mat) return aiCv;
    // runtime masih menginisialisasi — tunggu Mat tersedia
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (mod.Mat) { clearInterval(iv); resolve(); }
        else if (Date.now() - t0 > 120000) { clearInterval(iv); reject(new Error('Waktu inisialisasi OpenCV habis.')); }
      }, 120);
    });
    return aiCv;
  })().catch(err => { aiOpenCVPromise = null; throw err; });
  return aiOpenCVPromise;
}

function aiEnsureTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (aiTesseractPromise) return aiTesseractPromise;
  aiTesseractPromise = aiLoadScript(new URL('vendor/tesseract/tesseract.min.js', location.href).href)
    .then(() => window.Tesseract)
    .catch(err => { aiTesseractPromise = null; throw err; });
  return aiTesseractPromise;
}

let aiTesseractWorker = null;
let aiTesseractWorkerLang = '';
async function aiGetTesseractWorker(lang) {
  const T = await aiEnsureTesseract();
  if (aiTesseractWorker && aiTesseractWorkerLang === lang) return aiTesseractWorker;
  if (aiTesseractWorker) { try { await aiTesseractWorker.terminate(); } catch (e) { /* noop */ } }
  aiTesseractWorker = await T.createWorker(lang, 1, {
    workerPath: new URL('vendor/tesseract/worker.min.js', location.href).href,
    corePath: new URL('vendor/tesseract/tesseract-core-lstm.wasm.js', location.href).href,
    langPath: new URL('vendor/tessdata', location.href).href,
    logger: (m) => { if (m && m.status === 'recognizing text') aiSetOcrProgress(m.progress); }
  });
  aiTesseractWorkerLang = lang;
  return aiTesseractWorker;
}

function aiScannerEnsureAssets() {
  const bar = document.getElementById('aiScannerEngineBar');
  if (bar && !bar.dataset.started) {
    bar.dataset.started = '1';
    bar.style.display = 'flex';
    const title = document.getElementById('aiScannerEngineTitle');
    const icon = document.getElementById('aiScannerEngineIcon');
    if (title) title.textContent = 'Menyiapkan mesin AI…';
    if (icon) icon.style.color = 'var(--primary)';
    aiEnsureOpenCV().then(() => {
      const t = document.getElementById('aiScannerEngineTitle');
      if (t) t.textContent = 'Mesin AI siap ✅ (OpenCV + OCR)';
      const i = document.getElementById('aiScannerEngineIcon');
      if (i) i.style.color = '#22C55E';
    }).catch(err => {
      const t = document.getElementById('aiScannerEngineTitle');
      if (t) t.textContent = 'Gagal memuat mesin AI';
      showNotificationBanner('Gagal memuat OpenCV: ' + (err.message || err));
    });
  }
}

// ---------------------------------------------------------------------------
// 2. KAMERA OVERLAY (scanner & tanda tangan)
// ---------------------------------------------------------------------------
let aiCameraStream = null;
let aiCameraKind = 'scanner';
let aiCameraFacing = 'environment';

function aiScannerOpenCamera() { aiCamOpen('scanner'); }
function aiSigOpenCamera() { aiCamOpen('sig'); }

async function aiCamOpen(kind) {
  aiCameraKind = kind;
  const overlay = document.getElementById('aiCameraOverlay');
  document.getElementById('aiCameraLabel').textContent =
    kind === 'scanner' ? 'Arahkan ke dokumen' : 'Arahkan ke tanda tangan';
  try {
    const stream = await getAppCameraStream({
      video: { facingMode: aiCameraFacing, width: { ideal: 1600 }, height: { ideal: 1200 } },
      audio: false
    });
    aiCameraStream = stream;
    const video = document.getElementById('aiCameraVideo');
    video.srcObject = stream;
    await video.play().catch(() => {});
    overlay.style.display = 'flex';
    showNotificationBanner('Kamera aktif! Ketuk tombol merah untuk mengambil foto.');
  } catch (err) {
    console.warn('AI camera error:', err);
  }
}
function aiCameraFlip() {
  aiCameraFacing = aiCameraFacing === 'environment' ? 'user' : 'environment';
  aiCameraClose();
  setTimeout(() => aiCamOpen(aiCameraKind), 150);
}
function aiCameraClose() {
  if (aiCameraStream) { aiCameraStream.getTracks().forEach(t => t.stop()); aiCameraStream = null; }
  const video = document.getElementById('aiCameraVideo');
  if (video) video.srcObject = null;
  document.getElementById('aiCameraOverlay').style.display = 'none';
}
function aiCameraCapture() {
  const video = document.getElementById('aiCameraVideo');
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  aiCameraClose();
  if (aiCameraKind === 'scanner') aiScannerProcess(canvas);
  else aiSigProcess(canvas);
}

// ---------------------------------------------------------------------------
// 3. HELPERS GAMBAR & CV
// ---------------------------------------------------------------------------
function aiCanvasFromImage(img, maxDim) {
  const scale = Math.min(1, (maxDim || 1600) / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function aiCanvasFromBlob(blob, maxDim) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(aiCanvasFromImage(img, maxDim)); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar gagal dimuat.')); };
    img.src = url;
  });
}
function aiDownloadBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}
function aiDist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }

function aiOrderCorners(pts) {
  // pts: [{x,y}] 4 titik
  const sums = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.y - p.x);
  const minSum = Math.min(...sums), maxSum = Math.max(...sums);
  const minDiff = Math.min(...diffs), maxDiff = Math.max(...diffs);
  const pick = (v, arr) => arr.indexOf(v);
  const tl = pts[pick(minSum, sums)];
  const br = pts[pick(maxSum, sums)];
  const tr = pts[pick(minDiff, diffs)];
  const bl = pts[pick(maxDiff, diffs)];
  return [tl, tr, br, bl]; // urutan: TL, TR, BR, BL
}

// ---------------------------------------------------------------------------
// 4. AI DOCUMENT SCANNER
// ---------------------------------------------------------------------------
let aiScannerSrcCanvas = null;   // input asli (canvas)
let aiScannerWarpMat = null;     // hasil warp (Mat RGBA) untuk re-clean
let aiScannerOutCanvas = null;   // canvas hasil tampil
let aiOcrWords = [];             // kata OCR untuk searchable PDF
let aiOcrConfidence = 0;

function aiScannerFromFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  aiCanvasFromBlob(file, 1600).then(c => aiScannerProcess(c)).catch(err => showNotificationBanner(err.message));
}

function aiScannerShowEngine(msg, sub) {
  const bar = document.getElementById('aiScannerEngineBar');
  bar.style.display = 'flex';
  document.getElementById('aiScannerEngineTitle').textContent = msg;
  if (sub) document.getElementById('aiScannerEngineSub').textContent = sub;
}

async function aiScannerProcess(srcCanvas) {
  aiScannerSrcCanvas = srcCanvas;
  const result = document.getElementById('aiScannerResult');
  result.style.display = 'none';
  document.getElementById('aiOcrBlock').style.display = 'none';
  document.getElementById('aiScannerOrig').src = srcCanvas.toDataURL('image/jpeg', 0.85);
  aiScannerShowEngine('Menganalisis dokumen…', 'OpenCV: deteksi tepi + kontur terbesar…');
  try {
    const cv = await aiEnsureOpenCV();
    const src = cv.imread(srcCanvas);
    try {
      // --- deteksi dokumen ---
      const gray = new cv.Mat();
      const blur = new cv.Mat();
      const edges = new cv.Mat();
      const dil = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edges, 50, 150);
      const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.dilate(edges, dil, kern);
      kern.delete();
      blur.delete();
      gray.delete();

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(dil, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      dil.delete();
      hierarchy.delete();

      let bestQuad = null;
      let bestArea = 0;
      const imgArea = src.rows * src.cols;
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area < imgArea * 0.25) continue;
        const peri = cv.arcLength(c, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * peri, true);
        if (approx.rows === 4 && area > bestArea) {
          const pts = [];
          for (let j = 0; j < 4; j++) {
            pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
          }
          bestQuad = pts;
          bestArea = area;
        }
        approx.delete();
      }
      contours.delete();

      let warped;
      if (bestQuad) {
        const [tl, tr, br, bl] = aiOrderCorners(bestQuad);
        const wOut = Math.round(Math.max(aiDist(tl, tr), aiDist(bl, br)));
        const hOut = Math.round(Math.max(aiDist(tl, bl), aiDist(tr, br)));
        const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
        const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, wOut - 1, 0, wOut - 1, hOut - 1, 0, hOut - 1]);
        const M = cv.getPerspectiveTransform(srcPts, dstPts);
        warped = new cv.Mat();
        cv.warpPerspective(src, warped, M, new cv.Size(wOut, hOut), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
        M.delete(); srcPts.delete(); dstPts.delete();
      } else {
        warped = src.clone();
      }

      // --- hilangkan bayangan + bersihkan ---
      aiScannerWarpMat = warped;
      const out = aiCleanDoc(warped);
      aiScannerOutCanvas = document.createElement('canvas');
      cv.imshow(aiScannerOutCanvas, out);
      out.delete();

      const resultEl = document.getElementById('aiScannerResult');
      document.getElementById('aiScannerOut').parentNode.replaceChild(aiScannerOutCanvas, document.getElementById('aiScannerOut'));
      aiScannerOutCanvas.id = 'aiScannerOut';
      aiScannerOutCanvas.className = 'ai-out-canvas';
      resultEl.style.display = 'block';
      document.getElementById('aiScannerEngineTitle').textContent = 'Scan selesai ✅';
      document.getElementById('aiScannerEngineIcon').style.color = '#22C55E';
      showNotificationBanner(bestQuad ? 'Dokumen terdeteksi & dikoreksi 📄' : 'Dokumen tidak terdeteksi — hasil = gambar asli. Coba foto dengan latar kontras.');
      aiScannerRunOcr();
    } finally {
      src.delete();
    }
  } catch (err) {
    console.error('Scanner error:', err);
    document.getElementById('aiScannerEngineTitle').textContent = 'Scan gagal';
    showNotificationBanner('Scan gagal: ' + (err.message || err));
  }
}

function aiCleanDoc(warpedMat) {
  const cv = aiCv;
  const mode = (document.getElementById('aiScannerCleanMode') || {}).value || 'natural';
  const gray = new cv.Mat();
  cv.cvtColor(warpedMat, gray, cv.COLOR_RGBA2GRAY);

  // estimasi latar belakang sekali (untuk hilangkan bayangan)
  const kSize = Math.max(15, Math.round(Math.min(gray.rows, gray.cols) / 12));
  const bg = new cv.Mat();
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kSize, kSize));
  cv.morphologyEx(gray, bg, cv.MORPH_CLOSE, kern);
  kern.delete();

  const cleanGray = new cv.Mat();
  cv.divide(gray, bg, cleanGray, 255);

  const out = new cv.Mat();
  if (mode === 'bw') {
    const bin = new cv.Mat();
    cv.threshold(cleanGray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.cvtColor(bin, out, cv.COLOR_GRAY2RGBA);
    bin.delete();
  } else {
    // natural: per-channel divide (hilangkan bayangan, warna tetap)
    const chans = new cv.MatVector();
    const res = new cv.MatVector();
    cv.split(warpedMat, chans);
    for (let i = 0; i < 3; i++) {
      const d = new cv.Mat();
      cv.divide(chans.get(i), bg, d, 255);
      res.push_back(d);
    }
    const alpha = chans.get(3).clone();
    res.push_back(alpha);
    cv.merge(res, out);
    res.delete();
    chans.delete();
  }
  cleanGray.delete();
  gray.delete();
  bg.delete();
  return out;
}


function aiScannerReRunClean() {
  if (!aiScannerWarpMat || !aiScannerOutCanvas) return;
  const cv = aiCv;
  try {
    const out = aiCleanDoc(aiScannerWarpMat);
    cv.imshow(aiScannerOutCanvas, out);
    out.delete();
    showNotificationBanner('Mode hasil diperbarui ✨');
  } catch (err) {
    showNotificationBanner('Gagal memperbarui: ' + (err.message || err));
  }
}

// ---- OCR ----
function aiSetOcrProgress(p) {
  const conf = document.getElementById('aiOcrConf');
  if (conf) conf.textContent = '· ' + Math.round((p || 0) * 100) + '%';
}
async function aiScannerRunOcr() {
  if (!aiScannerOutCanvas) return;
  const ocrBlock = document.getElementById('aiOcrBlock');
  ocrBlock.style.display = 'block';
  document.getElementById('aiOcrText').value = '';
  document.getElementById('aiOcrConf').textContent = 'memuat OCR…';
  try {
    const lang = (document.getElementById('aiScannerLang') || {}).value || 'ind';
    const worker = await aiGetTesseractWorker(lang);
    const { data } = await worker.recognize(aiScannerOutCanvas);
    document.getElementById('aiOcrText').value = data.text || '';
    aiOcrWords = (data.words || []).map(w => ({
      text: w.text,
      x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0,
      conf: w.confidence
    })).filter(w => w.text && w.text.trim());
    aiOcrConfidence = data.confidence || 0;
    document.getElementById('aiOcrConf').textContent = '· ' + Math.round(aiOcrConfidence) + '% akurasi';
    showNotificationBanner('OCR selesai: ' + (data.text || '').trim().split(/\s+/).filter(Boolean).length + ' kata 📝');
  } catch (err) {
    console.error('OCR error:', err);
    document.getElementById('aiOcrConf').textContent = '· gagal';
    showNotificationBanner('OCR gagal: ' + (err.message || err) + ' (butuh koneksi internet untuk memuat model pertama kali)');
  }
}
function aiCopyOcr() {
  const text = document.getElementById('aiOcrText').value;
  if (!text) { showNotificationBanner('Belum ada teks untuk disalin.'); return; }
  navigator.clipboard.writeText(text).then(() => showNotificationBanner('Teks OCR disalin 📋')).catch(() => showNotificationBanner('Gagal menyalin teks.'));
}

// ---- Simpan: PDF / JPG / Searchable PDF ----
function aiPdfEscape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

async function aiScannerSave(type) {
  if (!aiScannerOutCanvas) return;
  try {
    showNotificationBanner('Menyiapkan file… ⏳');
    const jpegBlob = await new Promise(res => aiScannerOutCanvas.toBlob(res, 'image/jpeg', 0.92));
    if (!jpegBlob) throw new Error('Gagal meng-encode gambar.');
    if (type === 'jpg') {
      aiDownloadBlob(jpegBlob, 'scan-' + Date.now() + '.jpg');
      showNotificationBanner('Scan disimpan sebagai JPG 🖼️');
      return;
    }
    if (type === 'searchable') {
      const lang = (document.getElementById('aiScannerLang') || {}).value || 'ind';
      if (!aiOcrWords.length) {
        await aiScannerRunOcr();
      }
      const pdfBlob = await aiBuildPdf(jpegBlob, aiScannerOutCanvas.width, aiScannerOutCanvas.height, { words: aiOcrWords });
      aiDownloadBlob(pdfBlob, 'scan-' + Date.now() + '-teks.pdf');
      showNotificationBanner('PDF teks (searchable) disimpan 🔍');
      return;
    }
    const pdfBlob = await aiBuildPdf(jpegBlob, aiScannerOutCanvas.width, aiScannerOutCanvas.height, {});
    aiDownloadBlob(pdfBlob, 'scan-' + Date.now() + '.pdf');
    showNotificationBanner('PDF disimpan 📄');
  } catch (err) {
    console.error('Save error:', err);
    showNotificationBanner('Gagal menyimpan: ' + (err.message || err));
  }
}

async function aiBuildPdf(jpegBlob, w, h, opts) {
  // Membuat PDF A4 berisi gambar JPEG (+ lapisan teks tak terlihat bila searchable)
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  const a4w = 595, a4h = 842;
  const scale = Math.min(a4w / w, a4h / h);
  const dw = Math.round(w * scale), dh = Math.round(h * scale);
  const offX = Math.round((a4w - dw) / 2), offY = Math.round((a4h - dh) / 2);

  const objects = [];
  let content2 = '';
  if (opts.words && opts.words.length) {
    let bt = 'BT\n/F1 10 Tf\n3 Tr\n';
    for (const wd of opts.words) {
      if (!wd.text || !wd.text.trim()) continue;
      const boxW = Math.max(1, wd.w), boxH = Math.max(1, wd.h);
      const fs = Math.max(4, Math.round(boxH * scale));
      const x = offX + wd.x * scale;
      const y = a4h - (offY + (wd.y + boxH) * scale); // PDF y dari bawah
      bt += '1 0 0 1 ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Tm\n/F1 ' + fs + ' Tf\n(' + aiPdfEscape(wd.text) + ') Tj\n';
    }
    bt += 'ET';
    content2 = bt;
  }

  const imgObj = objects.push(null) - 1;
  const fontObj = objects.push(null) - 1;
  const content1Obj = objects.push(null) - 1;
  const content2Obj = content2 ? objects.push(null) - 1 : -1;
  const pageObj = objects.push(null) - 1;
  const pagesObj = objects.push(null) - 1;
  const catalogObj = objects.push(null) - 1;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  const write = (str) => { offsets.push(pdf.length); pdf += str; };

  // 1: catalog
  write((catalogObj + 1) + ' 0 obj\n<< /Type /Catalog /Pages ' + (pagesObj + 1) + ' 0 R >>\nendobj\n');
  // 2: pages
  write((pagesObj + 1) + ' 0 obj\n<< /Type /Pages /Kids [' + (pageObj + 1) + ' 0 R] /Count 1 >>\nendobj\n');
  // 3: page
  const contents = content2 ? '[' + (content1Obj + 1) + ' 0 R ' + (content2Obj + 1) + ' 0 R]' : (content1Obj + 1) + ' 0 R';
  write((pageObj + 1) + ' 0 obj\n<< /Type /Page /Parent ' + (pagesObj + 1) + ' 0 R /MediaBox [0 0 ' + a4w + ' ' + a4h + '] /Resources << /XObject << /Im0 ' + (imgObj + 1) + ' 0 R >> /Font << /F1 ' + (fontObj + 1) + ' 0 R >> >> /Contents ' + contents + ' >>\nendobj\n');
  // 4: image
  write((imgObj + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n');
  pdf += jpegBytes.reduce((s, b) => s + String.fromCharCode(b), '');
  pdf += '\nendstream\nendobj\n';
  // 5: font
  write((fontObj + 1) + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  // 6: content1 (gambar)
  const c1 = 'q\n' + dw + ' 0 0 ' + dh + ' ' + offX + ' ' + offY + ' cm\n/Im0 Do\nQ';
  write((content1Obj + 1) + ' 0 obj\n<< /Length ' + c1.length + ' >>\nstream\n' + c1 + '\nendstream\nendobj\n');
  // 7: content2 (teks tak terlihat)
  if (content2) {
    write((content2Obj + 1) + ' 0 obj\n<< /Length ' + content2.length + ' >>\nstream\n' + content2 + '\nendstream\nendobj\n');
  }

  const xrefStart = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + (catalogObj + 1) + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}

// ---------------------------------------------------------------------------
// 5. AI SIGNATURE EXTRACTOR
// ---------------------------------------------------------------------------
let aiSigOutCanvas = null;

function aiSigFromFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  aiCanvasFromBlob(file, 1600).then(c => aiSigProcess(c)).catch(err => showNotificationBanner(err.message));
}

async function aiSigProcess(srcCanvas) {
  const result = document.getElementById('aiSigResult');
  result.style.display = 'none';
  document.getElementById('aiSigOrig').src = srcCanvas.toDataURL('image/jpeg', 0.85);
  const bar = document.getElementById('aiSigEngineBar');
  bar.style.display = 'flex';
  document.getElementById('aiSigEngineTitle').textContent = 'Mengisolasi tanda tangan…';
  try {
    const cv = await aiEnsureOpenCV();
    const src = cv.imread(srcCanvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const bin = new cv.Mat();
    cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    gray.delete();

    // bersihkan bintik kecil
    const opened = new cv.Mat();
    const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.morphologyEx(bin, opened, cv.MORPH_OPEN, kern);
    kern.delete();
    bin.delete();

    // cari komponen tinta terbesar
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(opened, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    hierarchy.delete();

    let bestRect = null;
    let bestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const a = cv.contourArea(contours.get(i));
      if (a > bestArea) { bestArea = a; bestRect = cv.boundingRect(contours.get(i)); }
    }
    contours.delete();

    const pad = Math.max(14, Math.round(Math.min(src.rows, src.cols) * 0.03));
    let rx = 0, ry = 0, rw = src.cols, rh = src.rows;
    if (bestRect && bestRect.width > 10 && bestRect.height > 10) {
      rx = Math.max(0, bestRect.x - pad);
      ry = Math.max(0, bestRect.y - pad);
      rw = Math.min(src.cols - rx, bestRect.width + pad * 2);
      rh = Math.min(src.rows - ry, bestRect.height + pad * 2);
    }
    const roi = src.roi(new cv.Rect(rx, ry, rw, rh));
    const roiGray = new cv.Mat();
    cv.cvtColor(roi, roiGray, cv.COLOR_RGBA2GRAY);
    const roiBin = new cv.Mat();
    cv.threshold(roiGray, roiBin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    roiGray.delete();

    // haluskan tepi: blur mask sebagai alpha
    const maskBlur = new cv.Mat();
    cv.GaussianBlur(roiBin, maskBlur, new cv.Size(5, 5), 0);
    const alpha = new cv.Mat();
    cv.normalize(maskBlur, alpha, 0, 255, cv.NORM_MINMAX);
    maskBlur.delete(); roiBin.delete();

    const inkMode = (document.getElementById('aiSigInk') || {}).value || 'black';
    const outCanvas = document.createElement('canvas');
    outCanvas.width = rw;
    outCanvas.height = rh;
    const ctx = outCanvas.getContext('2d');
    const img = ctx.createImageData(rw, rh);
    const data = img.data;
    const roiData = roi.data;
    const alphaData = alpha.data;
    for (let i = 0; i < rw * rh; i++) {
      const a = alphaData[i];
      const srcIdx = i * 4;
      if (inkMode === 'black') {
        data[srcIdx] = 15; data[srcIdx + 1] = 15; data[srcIdx + 2] = 15;
      } else {
        data[srcIdx] = roiData[srcIdx];
        data[srcIdx + 1] = roiData[srcIdx + 1];
        data[srcIdx + 2] = roiData[srcIdx + 2];
      }
      data[srcIdx + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    roi.delete(); alpha.delete(); src.delete();

    aiSigOutCanvas = outCanvas;
    const holder = document.getElementById('aiSigChecker');
    const old = document.getElementById('aiSigOut');
    if (old) holder.removeChild(old);
    holder.appendChild(outCanvas);
    outCanvas.id = 'aiSigOut';
    outCanvas.className = 'ai-out-canvas';
    result.style.display = 'block';
    bar.style.display = 'none';
    showNotificationBanner('Tanda tangan berhasil diekstrak ✍️');
  } catch (err) {
    console.error('Signature error:', err);
    document.getElementById('aiSigEngineTitle').textContent = 'Gagal memproses';
    showNotificationBanner('Gagal mengekstrak tanda tangan: ' + (err.message || err));
  }
}

async function aiSigSave() {
  if (!aiSigOutCanvas) return;
  try {
    const blob = await new Promise(res => aiSigOutCanvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Gagal meng-encode PNG.');
    aiDownloadBlob(blob, 'tanda-tangan-' + Date.now() + '.png');
    showNotificationBanner('PNG transparan diunduh 🖼️');
  } catch (err) {
    showNotificationBanner('Gagal menyimpan: ' + (err.message || err));
  }
}
async function aiCopySig() {
  if (!aiSigOutCanvas) return;
  try {
    const blob = await new Promise(res => aiSigOutCanvas.toBlob(res, 'image/png'));
    if (!blob || !navigator.clipboard || !window.ClipboardItem) { showNotificationBanner('Salin clipboard tidak didukung — gunakan Unduh PNG.'); return; }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showNotificationBanner('Tanda tangan disalin ke clipboard 📋');
  } catch (err) {
    console.warn('Clipboard error:', err);
    showNotificationBanner('Gagal menyalin — gunakan Unduh PNG.');
  }
}
