package com.sept132.myapk;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Native bridge exposed to the web app as `window.AndroidBridge`.
 *
 * The web layer (AppFileStorage in app.js) detects `window.AndroidBridge` and
 * uses it to store photo/document blobs in real device storage instead of
 * IndexedDB — far more storage and much faster for large files.
 *
 * Methods used by the app:
 *   - saveFile(id, base64, mimeType) -> boolean
 *   - readFile(id)                    -> base64 string or null
 *   - deleteFile(id)                  -> boolean
 *   - saveBackupZipToDownloads(base64Zip, fileName) -> boolean
 */
public class AndroidBridge {
    private static final String TAG = "AndroidBridge";
    private static final String DIR_NAME = "myapk_files";

    private final Context context;
    private final File storageDir;

    public AndroidBridge(Context context) {
        this.context = context.getApplicationContext();
        this.storageDir = new File(this.context.getFilesDir(), DIR_NAME);
        if (!storageDir.exists() && !storageDir.mkdirs()) {
            Log.w(TAG, "Could not create storage dir " + storageDir);
        }
    }

    /** Sanitize the id so it can never escape the storage directory. */
    private File fileFor(String id) {
        String safe = (id == null || id.isEmpty()) ? "unnamed" : id.replaceAll("[^A-Za-z0-9._-]", "_");
        return new File(storageDir, safe);
    }

    @JavascriptInterface
    public boolean saveFile(String id, String base64, String mimeType) {
        try {
            if (id == null || base64 == null) return false;
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            File target = fileFor(id);
            File tmp = new File(storageDir, target.getName() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data);
            }
            if (!tmp.renameTo(target)) {
                if (target.exists()) target.delete();
                if (!tmp.renameTo(target)) throw new IOException("rename failed");
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "saveFile failed for " + id, e);
            return false;
        }
    }

    @JavascriptInterface
    public String readFile(String id) {
        try {
            if (id == null) return null;
            File f = fileFor(id);
            if (!f.exists()) return null;
            byte[] data = new byte[(int) f.length()];
            try (FileInputStream in = new FileInputStream(f)) {
                int off = 0;
                while (off < data.length) {
                    int n = in.read(data, off, data.length - off);
                    if (n < 0) break;
                    off += n;
                }
            }
            return Base64.encodeToString(data, Base64.DEFAULT);
        } catch (Exception e) {
            Log.e(TAG, "readFile failed for " + id, e);
            return null;
        }
    }

    @JavascriptInterface
    public boolean deleteFile(String id) {
        try {
            if (id == null) return false;
            File f = fileFor(id);
            return !f.exists() || f.delete();
        } catch (Exception e) {
            Log.e(TAG, "deleteFile failed for " + id, e);
            return false;
        }
    }

    /** Save a backup .zip into the public Downloads folder (MediaStore, no permission needed on API 29+). */
    @JavascriptInterface
    public boolean saveBackupZipToDownloads(String base64Zip, String fileName) {
        try {
            if (base64Zip == null) return false;
            byte[] data = Base64.decode(base64Zip, Base64.DEFAULT);

            String safeName = (fileName == null || fileName.trim().isEmpty())
                    ? "MyMaid_Backup_" + System.currentTimeMillis() + ".zip"
                    : fileName.trim().replaceAll("[^A-Za-z0-9._ ()-]", "_");

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            }

            Uri collection = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    ? MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    : MediaStore.Files.getContentUri("external");

            Uri uri = context.getContentResolver().insert(collection, values);
            if (uri == null) return false;

            try (OutputStream out = context.getContentResolver().openOutputStream(uri)) {
                if (out == null) return false;
                out.write(data);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                context.getContentResolver().update(uri, values, null, null);
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "saveBackupZipToDownloads failed", e);
            return false;
        }
    }
}
