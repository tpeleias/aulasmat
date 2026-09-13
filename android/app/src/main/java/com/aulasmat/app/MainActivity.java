package com.aulasmat.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Route requested by a home-screen widget, parked until the web app asks for it.
    private static volatile String pendingRoute = null;

    public static synchronized String takePendingRoute() {
        String route = pendingRoute;
        pendingRoute = null;
        return route;
    }

    private static void storeRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra("route");
        if (route != null && route.startsWith("/")) {
            pendingRoute = route;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LessonsWidgetPlugin.class);
        storeRoute(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        storeRoute(intent);
    }
}
