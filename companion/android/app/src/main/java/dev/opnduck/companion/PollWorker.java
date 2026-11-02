package dev.opnduck.companion;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Every 15 minutes (the shortest Android allows) asks each paired computer which jobs are finished and says "... is
 * ready" for ones it has not mentioned yet. No Google services: plain WorkManager and an ordinary notification.
 */
public class PollWorker extends Worker {
    static final String CHANNEL = "ready";
    private static final String SEEN = "notified_ids";

    public PollWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        try {
            String raw = Secrets.get(c, "hosts.v1");
            android.util.Log.i("OpnduckPoll", "started, paired computers stored: " + (raw != null));
            if (raw == null) return Result.success();
            JSONArray hosts = new JSONArray(raw);
            SharedPreferences sp = c.getSharedPreferences("opnduck_poll", Context.MODE_PRIVATE);
            Set<String> seen = new HashSet<>(sp.getStringSet(SEEN, new HashSet<>()));
            boolean firstRun = !sp.contains(SEEN); // what was already finished before we started watching is not news
            Set<String> now = new HashSet<>(seen);
            for (int i = 0; i < hosts.length(); i++) {
                JSONObject host = hosts.getJSONObject(i);
                JSONObject engine = host.optJSONObject("engine");
                if (engine == null) continue;
                JSONArray tasks = fetchTasks(engine.getString("baseUrl"), engine.getString("token"));
                android.util.Log.i("OpnduckPoll", "checked " + host.optString("name") + ": " + tasks.length() + " jobs, first run: " + firstRun);
                for (int t = 0; t < tasks.length(); t++) {
                    JSONObject task = tasks.getJSONObject(t);
                    if (!"done".equals(task.optString("status"))) continue;
                    String id = host.getString("id") + ":" + task.getString("id");
                    if (now.add(id) && !firstRun) notifyReady(c, host.optString("name", "your computer"), task.optString("label", "A file"));
                }
            }
            sp.edit().putStringSet(SEEN, now).apply();
            return Result.success();
        } catch (Exception e) {
            android.util.Log.w("OpnduckPoll", "check failed: " + e);
            return Result.retry(); // the computer is off or out of reach: try again later
        }
    }

    private static JSONArray fetchTasks(String baseUrl, String token) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(baseUrl + "/v1/tasks").openConnection();
        con.setConnectTimeout(8000);
        con.setReadTimeout(8000);
        con.setRequestProperty("Authorization", "Bearer " + token);
        if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
        try (InputStream in = con.getInputStream()) {
            return new JSONObject(new String(in.readAllBytes(), StandardCharsets.UTF_8)).getJSONArray("tasks");
        }
    }

    static void ensureChannel(Context c) {
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Finished jobs", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Tells you when a file you sent to your computer is ready to download");
        c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private static void notifyReady(Context c, String hostName, String label) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return;
        ensureChannel(c);
        Intent open = new Intent(c, MainActivity.class).putExtra("tab", "done").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, label.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(label + " is ready")
            .setContentText("On " + hostName + ". Tap to download it to this phone.")
            .setContentIntent(pi)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(c).notify(label.hashCode() ^ (int) System.nanoTime(), b.build());
        } catch (SecurityException ignored) {
            /* notifications switched off since the check above */
        }
    }
}
