package com.aulasmat.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

public class BillingWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_GROUP = "AulasMatPrefs";
    private static final String PREFS_KEY = "billing_widget";

    private static final int[] LINE_IDS = { R.id.debtor1, R.id.debtor2, R.id.debtor3 };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_billing);

        PendingIntent openBilling = WidgetIntents.openRoute(context, "/admin/organizacao", appWidgetId * 100 + 50);
        views.setOnClickPendingIntent(R.id.billing_root, openBilling);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String json = prefs.getString(PREFS_KEY, null);

        JSONObject data = null;
        if (json != null) {
            try {
                data = new JSONObject(json);
            } catch (Exception e) {
                data = null;
            }
        }

        if (data == null) {
            views.setTextViewText(R.id.billing_total, "—");
            views.setTextViewText(R.id.billing_subtitle, "Abra o app para carregar");
            for (int id : LINE_IDS) views.setViewVisibility(id, View.GONE);
            appWidgetManager.updateAppWidget(appWidgetId, views);
            return;
        }

        int count = data.optInt("count", 0);
        views.setTextViewText(R.id.billing_total, data.optString("total", "—"));
        String subtitle = count == 0
            ? "Tudo em dia"
            : count + (count == 1 ? " conta em aberto" : " contas em aberto");
        String updatedAt = data.optString("updatedAt", "");
        if (!updatedAt.isEmpty()) subtitle += " · " + updatedAt;
        views.setTextViewText(R.id.billing_subtitle, subtitle);

        JSONArray top = data.optJSONArray("top");
        for (int i = 0; i < LINE_IDS.length; i++) {
            JSONObject row = top == null ? null : top.optJSONObject(i);
            if (row == null) {
                views.setViewVisibility(LINE_IDS[i], View.GONE);
                continue;
            }
            views.setViewVisibility(LINE_IDS[i], View.VISIBLE);
            views.setTextViewText(LINE_IDS[i], row.optString("label", "") + "  ·  " + row.optString("owed", ""));
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
