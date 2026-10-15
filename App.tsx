/**
 * HERKOMST: gekopieerd uit ~/Development/2026/zelfscanner-v2/App.tsx (2026-10-15)
 * en uitgekleed voor de lezing. Bewust een kopie, geen afhankelijkheid: zie
 * ~/Development/2026/zelfscanner-lezing/docs/05-hergebruik-v2.md.
 *
 * Wat ongewijzigd is overgenomen (op het device uitgemeten, niet herschrijven):
 *   - de scan-commit: debounce SCAN_IDLE_MS, commit op Enter, veld legen,
 *     refocus bij blur en bij elke tap via een gewone onTouchEnd;
 *   - de WebView-instellingen (file-toegang, autoplay, zoom uit).
 *
 * Wat eruit is: de cradle-module, de agent naar het story-dashboard, de
 * kiosk-lockdown en de story-HUD. De lezing heeft geen cradle, geen fleet en
 * geen publiek dat uit de app probeert te komen -- Sjef houdt het apparaat zelf
 * vast.
 *
 * De app zelf is leeg van inhoud: de WebView laadt het pack van het
 * filesystem (PACK_URL), niet uit de APK. Scannen -> window.onNativeScan(code)
 * in de pagina. De pagina doet zelf de http-POST naar de runner, dat kan omdat
 * allowUniversalAccessFromFileURLs aan staat en targetSdk 22 cleartext toestaat.
 */
import React, {useCallback, useRef, useState} from 'react';
import {
  BackHandler,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import WebView from 'react-native-webview';

// false = lezing: alleen het pack in beeld, geen HUD. true tijdens het
// inregelen van een nieuw device (zie je of scans binnenkomen).
const SHOW_DEBUG_INFO = false;

// Pack op het filesystem, gepusht met adb (tools/push-pack.js). Eigen pad, dus
// de speurtocht-app (/sdcard/zelfscanner/pack) blijft los hiervan staan.
const PACK_URL = 'file:///sdcard/zelfscanner-lezing/pack/index.html';
const SCAN_IDLE_MS = 200; // commit zodra de keystroke-burst van de scanner stil valt

function App(): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webviewRef = useRef<WebView>(null);
  const [buffer, setBuffer] = useState('');
  const [lastScan, setLastScan] = useState('— nog niets —');
  const [count, setCount] = useState(0);
  const [packStatus, setPackStatus] = useState('laden…');

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Het pack praat terug via ReactNativeWebView.postMessage.
  const onWebMessage = useCallback((e: {nativeEvent: {data: string}}) => {
    let msg: {type?: string; payload?: any} = {};
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'status') {
      // pack/lezing.js stuurt hier zijn stand naartoe; alleen voor de HUD.
      setPackStatus(String(msg.payload?.text ?? ''));
    } else if (msg.type === 'exit') {
      BackHandler.exitApp();
    }
  }, []);

  const commit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const code = bufferRef.current.replace(/[\r\n]+/g, '').trim();
    bufferRef.current = '';
    setBuffer('');
    // Ongecontroleerd invoerveld: leegmaken, anders plakt de volgende scan erachter.
    inputRef.current?.clear();
    if (code.length === 0) {
      return;
    }
    setLastScan(code);
    setCount(c => c + 1);
    webviewRef.current?.injectJavaScript(
      `window.onNativeScan && window.onNativeScan(${JSON.stringify(
        code,
      )}); true;`,
    );
    requestAnimationFrame(focusInput);
  }, [focusInput]);

  const onChange = useCallback(
    (text: string) => {
      bufferRef.current = text;
      setBuffer(text);
      // Meteen committen als er een afsluiter in zit, anders na een stille periode.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (/[\r\n]/.test(text)) {
        commit();
      } else {
        timerRef.current = setTimeout(commit, SCAN_IDLE_MS);
      }
    },
    [commit],
  );

  // Een tik op het scherm pakt de focus terug naar het verborgen invoerveld --
  // via een gewone bubbelende onTouchEnd, NIET via een Touchable. Een Touchable
  // maakt deze View de JS-responder en dan onderschept RN elke volgende MOVE:
  // de WebView krijgt ACTION_CANCEL (touchcancel na ~40ms) en slepen in het
  // pack werkt niet meer. Gemeten op de MC18N0, 2026-09-17.
  return (
    <View style={styles.root} onTouchEnd={focusInput}>
      <StatusBar hidden />
      <WebView
        ref={webviewRef}
        source={{uri: PACK_URL}}
        style={StyleSheet.absoluteFill}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        // Android staat standaard pinch-zoom toe; dat wil je niet op een note.
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        onMessage={onWebMessage}
        onLoadEnd={() => setPackStatus('geladen')}
        onError={e => setPackStatus('fout: ' + JSON.stringify(e?.nativeEvent))}
      />

      {/* Verborgen invoerveld waar de DataWedge-keystrokes in landen. */}
      <TextInput
        ref={inputRef}
        autoFocus
        blurOnSubmit={false}
        showSoftInputOnFocus={false}
        caretHidden
        onChangeText={onChange}
        onSubmitEditing={commit}
        onBlur={() => requestAnimationFrame(focusInput)}
        style={styles.hiddenInput}
      />

      {SHOW_DEBUG_INFO && (
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.label}>PACK</Text>
          <Text style={styles.value}>{packStatus}</Text>
          <Text style={styles.label}>LAATSTE BARCODE</Text>
          <Text style={styles.scan}>{lastScan}</Text>
          <Text style={styles.label}>SCANS</Text>
          <Text style={styles.value}>{count}</Text>
          <Text style={styles.label}>TIKKEN (live)</Text>
          <Text style={styles.typing}>{buffer || '—'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: -100,
  },
  hud: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
  },
  label: {
    color: '#9ad',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
  },
  value: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scan: {
    color: '#7CFC00',
    fontSize: 28,
    fontWeight: '700',
  },
  typing: {
    color: '#ffd166',
    fontSize: 14,
  },
});

export default App;
