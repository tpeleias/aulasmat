package com.aulasmat.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LessonsWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
