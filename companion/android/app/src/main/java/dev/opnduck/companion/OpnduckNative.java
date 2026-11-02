package dev.opnduck.companion;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The few things the app needs from Android itself: secrets kept under a key that never leaves the Android Keystore,
 * the text another app shares to OPNduck, and downloads through the system DownloadManager. Nothing here uses Google
 * Play services, so the app builds cleanly for F-Droid.
 */
@CapacitorPlugin(name = "OpnduckNative")
public class OpnduckNative extends Plugin {
    private static final String KEY_ALIAS = "opnduck_secrets_v1";
    private static final String PREFS = "opnduck_secure";
    private static String pendingShare = null;

    /** Called by MainActivity when another app shares text to us. */
    static void offerShare(Intent intent) {
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

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            return gen.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
            prefs().edit().putString(name, packed).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not store the secret: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String name = call.getString("key");
        JSObject out = new JSObject();
        String packed = name == null ? null : prefs().getString(name, null);
        if (packed == null) {
            out.put("value", JSObject.NULL);
            call.resolve(out);
            return;
        }
        try {
            String[] parts = packed.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            out.put("value", new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("Could not read the secret: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String name = call.getString("key");
        if (name != null) prefs().edit().remove(name).apply();
        call.resolve();
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
