package cz.raven.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.lang.reflect.Method;

/**
 * Raven for Android: the school web app in a full-screen window.
 * Sign-in with Google happens in the phone's browser (Google does not allow it inside
 * apps); the web page shows a code, waits for the browser, and Raven links back here
 * with raven://open.
 */
public class MainActivity extends Activity {
    static final String BASE = "https://raven-kristators-projects.vercel.app";
    static final String HOST = Uri.parse(BASE).getHost();
    static final int BG = 0xFF121316;

    private WebView web;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        paintSystemBars();

        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportZoom(false);
        s.setUserAgentString(s.getUserAgentString() + " RavenApp/1 (Android)");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("ravenext:")) {          // the page asks for the system browser
                    openOutside(url.substring("ravenext:".length()));
                    return true;
                }
                if (url.startsWith("raven:")) return true; // our own deep link, nothing to load
                Uri u = Uri.parse(url);
                if (HOST.equals(u.getHost())) return false;
                openOutside(url);                          // other sites, mail, phone numbers
                return true;
            }

            @Override
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                view.loadDataWithBaseURL(BASE, OFFLINE, "text/html", "utf-8", null);
            }
        });

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(BASE + "/");
        setContentView(web);
    }

    private void openOutside(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
    }

    /** Dark status and navigation bars (Android 5+), set by reflection to stay buildable against old stubs. */
    private void paintSystemBars() {
        try {
            Window w = getWindow();
            w.addFlags(0x80000000); // FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS
            Method status = Window.class.getMethod("setStatusBarColor", int.class);
            Method nav = Window.class.getMethod("setNavigationBarColor", int.class);
            status.invoke(w, BG);
            nav.invoke(w, BG);
        } catch (Exception ignored) {
        }
    }

    private void resumePage() {
        if (web != null) web.loadUrl("javascript:window.dispatchEvent(new Event('raven:resume'))");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        resumePage();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumePage();
    }

    @Override
    protected void onPause() {
        super.onPause();
        try { // keep the sign-in cookie on disk
            CookieManager.class.getMethod("flush").invoke(CookieManager.getInstance());
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    static final String OFFLINE = "<!doctype html><html lang=cs><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;background:#121316;color:#E9E6DD;font:17px/1.5 sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box'>"
            + "<div><h1 style='letter-spacing:.12em;font-size:26px;margin:0 0 12px'>RAVEN</h1>"
            + "<p>Raven se teď nemůže spojit se serverem.<br>Zkontroluj připojení k internetu.</p>"
            + "<a href='" + BASE + "/' style='display:inline-block;margin-top:14px;padding:12px 22px;background:#F2B632;color:#121316;text-decoration:none;font-weight:700'>Zkusit znovu</a>"
            + "</div></body></html>";
}
