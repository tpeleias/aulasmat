package com.aulasmat.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

// A home-screen shortcut into the assistant. RemoteViews has no text field, so the widget
// shows one and hands typing over to the app, with the keyboard already open.
public class AssistantWidgetProvider extends AppWidgetProvider {

    private static final String CHAT = "/admin/assistente?focus=1";
    private static final String ASK_TODAY = "/admin/assistente?q=" + "Como%20est%C3%A1%20minha%20agenda%20de%20hoje%3F";
    private static final String ASK_DEBTS = "/admin/assistente?q=" + "Quem%20est%C3%A1%20com%20aulas%20em%20aberto%3F";
    private static final String ASK_NEW = "/admin/assistente?q=" + "Quero%20marcar%20uma%20aula";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_assistant);

            int base = appWidgetId * 100 + 70;
            views.setOnClickPendingIntent(R.id.assistant_input, WidgetIntents.openRoute(context, CHAT, base));
            views.setOnClickPendingIntent(R.id.assistant_chip_today, WidgetIntents.openRoute(context, ASK_TODAY, base + 1));
            views.setOnClickPendingIntent(R.id.assistant_chip_debts, WidgetIntents.openRoute(context, ASK_DEBTS, base + 2));
            views.setOnClickPendingIntent(R.id.assistant_chip_new, WidgetIntents.openRoute(context, ASK_NEW, base + 3));

            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }
}
