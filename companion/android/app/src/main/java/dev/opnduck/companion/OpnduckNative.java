package dev.opnduck.companion;

import android.content.pm.PackageManager;
import android.os.Build;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.TimeUnit;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The few things the app needs from Android itself: secrets kept under a key that never leaves the Android Keystore,
 * the text another app shares to OPNduck, and downloads through the system DownloadManager. Nothing here uses Google
 * Play services, so the app builds cleanly for F-Droid.
 */
@CapacitorPlugin(name = "OpnduckNative", permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) })
public class OpnduckNative extends Plugin {
    private static String pendingShare = null;
    static String pendingTab = null;

    /** Called by MainActivity when another app shares text to us. */
    static void offerShare(Intent intent) {
        if (intent != null && intent.getStringExtra("tab") != null) pendingTab = intent.getStringExtra("tab");
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) return;
        pendingShare = text.length() > 4096 ? text.substring(0, 4096) : text;
    }

    void notifyShared() {
        if (pendingShare != null) {
            JSObject data = new JSObject();
            data.put("text", pendingShare);
            notifyListeners("shared", data, true);
        }
    }

    /** The shared text waiting to be handled (and clears it). */
    @PluginMethod
    public void consumeShared(PluginCall call) {
        JSObject out = new JSObject();
        out.put("text", pendingShare == null ? "" : pendingShare);
        pendingShare = null;
        call.resolve(out);
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String name = call.getString("key");
        String value = call.getString("value");
        if (name == null || value == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            Secrets.set(getContext(), name, value);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not store the secret: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String name = call.getString("key");
        JSObject out = new JSObject();
        try {
            String value = name == null ? null : Secrets.get(getContext(), name);
            out.put("value", value == null ? JSObject.NULL : value);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read the secret: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String name = call.getString("key");
        if (name != null) Secrets.remove(getContext(), name);
        call.resolve();
    }

    /** Turns the 15-minute "is anything ready?" check on or off. */
    @PluginMethod
    public void setChecks(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        WorkManager wm = WorkManager.getInstance(getContext());
        if (on) {
            Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
            wm.enqueueUniquePeriodicWork("opnduck-ready", ExistingPeriodicWorkPolicy.UPDATE, new PeriodicWorkRequest.Builder(PollWorker.class, 15, TimeUnit.MINUTES).setConstraints(net).build());
        } else wm.cancelUniqueWork("opnduck-ready");
        call.resolve();
    }

    /** Runs the "is anything ready?" check once, now. */
    @PluginMethod
    public void checkNow(PluginCall call) {
        WorkManager.getInstance(getContext()).enqueue(new OneTimeWorkRequest.Builder(PollWorker.class).build());
        call.resolve();
    }

    /** Asks for the notification permission (Android 13 and newer). Resolves with whether it is granted. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        PollWorker.ensureChannel(getContext());
        if (Build.VERSION.SDK_INT < 33 || getContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(out);
    }

    /** The tab a notification asked to open ("done"), once. */
    @PluginMethod
    public void consumeTab(PluginCall call) {
        JSObject out = new JSObject();
        out.put("tab", pendingTab == null ? "" : pendingTab);
        pendingTab = null;
        call.resolve(out);
    }

    /** Downloads a signed link into Downloads/OPNduck/ with the system DownloadManager (it resumes and shows progress). */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "opnduck-download");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("A download link is required");
            return;
        }
        String safe = fileName.replaceAll("[\\\\/\\u0000-\\u001f]", "_");
        if (safe.startsWith(".")) safe = "_" + safe.substring(1);
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle(safe);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "OPNduck/" + safe);
            r.allowScanningByMediaScanner();
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            JSObject out = new JSObject();
            out.put("id", dm.enqueue(r));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not start the download: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        offerShare(intent);
        notifyShared();
    }
}
