package com.aulasmat.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

public class LessonsWidgetProvider extends AppWidgetProvider {

    private static final int MAX_ROWS = 4;
    private static final String PREFS_GROUP = "AulasMatPrefs";
    private static final String PREFS_KEY = "upcoming_lessons_widget";
    private static final long REFRESH_INTERVAL_MILLIS = 30 * 60 * 1000L;

    private static final int[] ROW_CONTAINER_IDS = { R.id.row1_container, R.id.row2_container, R.id.row3_container, R.id.row4_container };
    private static final int[] ROW_TIME_IDS = { R.id.row1_time, R.id.row2_time, R.id.row3_time, R.id.row4_time };
    private static final int[] ROW_NAME_IDS = { R.id.row1_name, R.id.row2_name, R.id.row3_name, R.id.row4_name };
    private static final int[] ROW_ADDRESS_IDS = { R.id.row1_address, R.id.row2_address, R.id.row3_address, R.id.row4_address };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onEnabled(Context context) {
        // updatePeriodicMillis in the widget's XML config fails to compile in this
        // project's toolchain, so periodic refresh is scheduled here instead as a
        // safety net independent of the app explicitly asking for a refresh.
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.setInexactRepeating(
                AlarmManager.ELAPSED_REALTIME,
                SystemClock.elapsedRealtime() + REFRESH_INTERVAL_MILLIS,
                REFRESH_INTERVAL_MILLIS,
                getRefreshPendingIntent(context)
            );
        }
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.cancel(getRefreshPendingIntent(context));
        }
    }

    private PendingIntent getRefreshPendingIntent(Context context) {
        Intent intent = new Intent(context, LessonsWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        ComponentName component = new ComponentName(context, LessonsWidgetProvider.class);
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(component);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        return PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_lessons);

        Intent openApp = new Intent(context, MainActivity.class);
        PendingIntent openAppPending = PendingIntent.getActivity(
            context,
            appWidgetId,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_title, openAppPending);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String json = prefs.getString(PREFS_KEY, null);

        JSONArray lessons = null;
        if (json != null) {
            try {
                lessons = new JSONArray(json);
            } catch (Exception e) {
                lessons = null;
            }
        }

        int count = lessons == null ? 0 : lessons.length();
        views.setViewVisibility(R.id.widget_empty, count == 0 ? View.VISIBLE : View.GONE);

        for (int i = 0; i < MAX_ROWS; i++) {
            if (lessons == null || i >= count) {
                views.setViewVisibility(ROW_CONTAINER_IDS[i], View.GONE);
                continue;
            }

            JSONObject lesson = lessons.optJSONObject(i);
            if (lesson == null) {
                views.setViewVisibility(ROW_CONTAINER_IDS[i], View.GONE);
                continue;
            }

            views.setViewVisibility(ROW_CONTAINER_IDS[i], View.VISIBLE);

            String time = lesson.optString("time", "");
            String student = lesson.optString("student", "");
            String subject = lesson.optString("subject", "");
            String address = lesson.optString("address", "");
            boolean isOnline = lesson.optBoolean("isOnline", false);

            views.setTextViewText(ROW_TIME_IDS[i], time);

            String nameLabel = subject.isEmpty() ? student : student + " · " + subject;
            views.setTextViewText(ROW_NAME_IDS[i], nameLabel);

            String addressLabel = isOnline ? "Online" : address;
            if (addressLabel.isEmpty()) {
                views.setViewVisibility(ROW_ADDRESS_IDS[i], View.GONE);
            } else {
                views.setViewVisibility(ROW_ADDRESS_IDS[i], View.VISIBLE);
                views.setTextViewText(ROW_ADDRESS_IDS[i], addressLabel);
            }

            if (!isOnline && !address.isEmpty()) {
                Intent waze = new Intent(Intent.ACTION_VIEW, Uri.parse("https://waze.com/ul?q=" + Uri.encode(address) + "&navigate=yes"));
                PendingIntent wazePending = PendingIntent.getActivity(
                    context,
                    appWidgetId * 10 + i + 1,
                    waze,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
                views.setOnClickPendingIntent(ROW_CONTAINER_IDS[i], wazePending);
            } else {
                views.setOnClickPendingIntent(ROW_CONTAINER_IDS[i], openAppPending);
            }
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
