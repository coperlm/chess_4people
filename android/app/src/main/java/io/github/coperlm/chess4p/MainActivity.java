package io.github.coperlm.chess4p;

import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Capacitor 不接管返回键，默认行为是直接退出应用：联机局依赖进程存活，
     * 误触就整局没了。这里改成「有历史才后退，否则退回桌面」，回到前台可继续。
     */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        moveTaskToBack(true);
    }
}
