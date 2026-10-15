/**
 * HERKOMST: zelfscanner-v2/android/app/src/release/java/com/zelfscannerv2/ReactNativeFlipper.java
 * (2026-10-15). No-op gehouden: libflipper.so laadt niet op Android 5.1.1
 * (ontbrekend BoringSSL-symbool BN_set_flags) en crashte de app bij het
 * starten op de MC18N0.
 */
package com.zelfscannerlezing;

import android.content.Context;
import com.facebook.react.ReactInstanceManager;

public class ReactNativeFlipper {
  public static void initializeFlipper(Context context, ReactInstanceManager reactInstanceManager) {
    // Met opzet leeg.
  }
}
