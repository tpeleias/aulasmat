package com.aulasmat.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LessonsWidget")
public class LessonsWidgetPlugin extends Plugin {

    @PluginMethod
    public void refresh(PluginCall call) {
        Context context = getContext();
        broadcastUpdate(context, LessonsWidgetProvider.class);
        broadcastUpdate(context, BillingWidgetProvider.class);
        call.resolve();
    }

    @PluginMethod
    public void getPendingRoute(PluginCall call) {
        JSObject ret = new JSObject();
        String route = MainActivity.takePendingRoute();
        if (route == null) ret.put("route", JSObject.NULL); else ret.put("route", route);
        call.resolve(ret);
    }

    private static void broadcastUpdate(Context context, Class<?> provider) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
        if (ids.length == 0) return;
        Intent intent = new Intent(context, provider);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
