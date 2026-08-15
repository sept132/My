package com.sept132.myapk;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int REQ_APP_PERMISSIONS = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Expose the native file-storage bridge to the web app (window.AndroidBridge).
        // Registered here so it is available before the WebView loads the page.
        getBridge().getWebView().addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

        // The app's web layer uses getUserMedia (camera) and navigator.geolocation,
        // which need runtime permissions on Android 6+. Ask up front so those
        // features work on first use without additional prompt churn.
        requestAppPermissions();
    }

    private void requestAppPermissions() {
        List<String> needed = new ArrayList<>();
        needed.add(Manifest.permission.CAMERA);
        needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
        // Saving the backup .zip to Downloads on Android 8 and below needs storage.
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }

        List<String> missing = new ArrayList<>();
        for (String p : needed) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                missing.add(p);
            }
        }
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), REQ_APP_PERMISSIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Permission state is read live by the WebView (getUserMedia / geolocation),
        // so there is nothing else to do here.
    }
}
