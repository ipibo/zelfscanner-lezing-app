/**
 * HERKOMST: zelfscanner-v2/android/app/src/main/java/com/zelfscannerv2/MainActivity.java
 * (2026-10-15), uitgekleed voor de lezing.
 *
 * Wat is overgenomen: het toetsenbord nooit laten opkomen (het verborgen
 * invoerveld moet de focus houden, en op Android 10 popt de IME anders op), en
 * immersive-sticky zodat statusbar en navbar weg zijn. Scherm aan houden
 * tijdens de lezing.
 *
 * Wat eruit is: de kiosk (KioskController, lock task, device admin), de
 * keyguard-truc voor een device dat vanuit de achtergrond start, en de
 * EMDK-UiLockManager. Sjef houdt het apparaat zelf vast; er is geen publiek
 * dat uit de app probeert te komen, en het device start niet onbemand op.
 */
package com.zelfscannerlezing;

import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactActivityDelegate;

public class MainActivity extends ReactActivity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // Nooit het softkeyboard laten opkomen: de verborgen TextInput waar
    // DataWedge in typt heeft focus, en zonder dit popt de IME op (PS20J).
    getWindow()
        .setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
    // Het scherm mag tijdens de lezing niet in slaap vallen: Sjef kijkt naar
    // zijn notes en scant soms minuten niets.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }

  /** Duw het toetsenbord weg als iets het toch omhoog haalt. */
  private void hideKeyboard() {
    InputMethodManager imm =
        (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
    View focus = getCurrentFocus();
    if (imm != null && focus != null) {
      imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
    }
  }

  /** Statusbar en navigatiebalk weg (immersive sticky). Werkt op API 19+. */
  private void enableImmersive() {
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      enableImmersive();
      hideKeyboard();
    }
  }

  @Override
  protected String getMainComponentName() {
    return "ZelfscannerLezing";
  }

  @Override
  protected ReactActivityDelegate createReactActivityDelegate() {
    return new DefaultReactActivityDelegate(
        this,
        getMainComponentName(),
        DefaultNewArchitectureEntryPoint.getFabricEnabled());
  }
}
