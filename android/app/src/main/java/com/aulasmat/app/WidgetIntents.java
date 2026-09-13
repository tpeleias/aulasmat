package com.aulasmat.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

final class WidgetIntents {
    private WidgetIntents() {}

    // Distinct request codes keep PendingIntents with different "route" extras from
    // collapsing into one another (extras are not part of intent equality).
    static PendingIntent openRoute(Context context, String route, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("route", route);
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
