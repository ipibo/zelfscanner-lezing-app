# zelfscanner-lezing-app

De Android-app voor de lezing: Sjef houdt de zelfscanner vast, scant een
barcode, en op het schermpje in zijn hand staat zijn eigen note. Het beeld gaat
naar de beamer via de runner op de laptop
(`~/Development/2026/zelfscanner-lezing`).

Een eigen app, los van de speurtocht in `~/Development/2026/zelfscanner-v2`.
Dat besluit staat in
[docs/05-hergebruik-v2.md](../zelfscanner-lezing/docs/05-hergebruik-v2.md): de
speurtocht is de gefinancierde deliverable met devices in het veld en mag niet
geraakt worden. Wat hier uit v2 komt is een **kopie**, geen afhankelijkheid, en
boven elk gekopieerd bestand staat waar het vandaan komt en van welke datum.

| Bestand | Herkomst |
|---|---|
| `App.tsx` | v2 `App.tsx` (2026-10-15), uitgekleed: scan-commit en WebView-instellingen over, cradle/agent/kiosk/HUD eruit |
| `android/` | v2 `android/` (2026-10-15), eigen `applicationId`, zonder kiosk, cradle, EMDK en HOME-intent |
| `pack/index.html` | v2 `pack/index.html` (2026-10-15), de XHR-plus-eval-laadtruc ongewijzigd, de inhoud nieuw |
| `pack/fx.js` | v2 `pack/fx.js` (2026-10-15), ongewijzigd |
| `tools/check-es5.js` | v2 `tools/check-es5.js` (2026-10-15), ongewijzigd |
| `pack/lezing.js` | nieuw |
| `tools/push-pack.js` | nieuw (geen `zsdeploy`: dat is fleet-gereedschap) |

## Hoe het werkt

De APK bevat geen inhoud. De WebView laadt
`file:///sdcard/zelfscanner-lezing/pack/index.html` van het filesystem; een
scan gaat als `window.onNativeScan(code)` naar die pagina. Alles waar je later
aan sleutelt zit in `pack/`, dus pushen in plaats van opnieuw bouwen.

`pack/lezing.js` doet drie dingen bij een scan:

1. **de note meteen in beeld**, uit de lokale `lezing.json`. Daarom heeft Sjef
   zijn tekst ook als het netwerk wegvalt -- dat is de hele reden dat beide
   kanten de lezing lokaal hebben;
2. **POST naar de runner** op `/api/scan`. Antwoordt die, dan is zijn stand
   leidend: hij houdt de frame-teller bij en stuurt het beeld naar de beamer;
3. **zelf rekenen als de POST mislukt** (volgend frame, na het laatste weer het
   eerste) en bijtrekken zodra de verbinding terug is. Onderaan het scherm
   staat in één kleine regel of de runner antwoordt.

De runner wordt op twee adressen gezocht, in deze volgorde:

1. `http://127.0.0.1:8080` -- usb-kabel met `adb reverse tcp:8080 tcp:8080`.
   Staat voorop omdat een kabel niet uitvalt.
2. het adres uit `settings.json` op het device, bijvoorbeeld
   `http://192.168.1.50:8080`.

`/api/hello` is de health check. Die loopt elke 15 seconden, en elke 4 seconden
zolang er geen verbinding is. Op de statusregel tikken zoekt meteen opnieuw.

## Het pack op het device

```
/sdcard/zelfscanner-lezing/pack/
  index.html      loader
  fx.js           animaties
  lezing.js       het pack-type voor de lezing
  lezing.json     de lezing (zelfde formaat als de runner)
  settings.json   van het apparaat: het lan-adres van de laptop
```

Geen assets: de media staan op de laptop en gaan naar de beamer. Een pack op
het device is daarmee een paar kilobyte.

```bash
node tools/push-pack.js ~/Development/2026/zelfscanner-lezing/runner/packs/demo \
  --device 192.168.1.6:5555 --runner http://192.168.1.50:8080
```

Zonder `--runner` pakt het script het ip van deze laptop met poort 8080.

## Bouwen en installeren

```bash
npm install
npm run pack:check                       # ES5-gate op alles in pack/
cd android && ./gradlew assembleRelease  # android/app/build/outputs/apk/release/app-release.apk
adb -s <serial> install -r android/app/build/outputs/apk/release/app-release.apk
```

Twee dingen uit v2 die hier ook gelden, allebei met schade geleerd:

- `react-native-webview` staat **vastgezet op 13.8.0**. Nieuwere versies
  trekken `androidx.webkit:webkit:1.14.0` mee en die eist AGP 8.1 plus
  compileSdk 34, wat deze RN-0.72-opzet niet heeft.
- De `force` op `kotlin-stdlib` in `android/build.gradle` moet blijven staan,
  anders botsen stdlib 1.8.10 (via webview) en stdlib-jdk7/jdk8 1.7.22 (via RN)
  als dubbele klassen.

### Eerste start op Android 10

De PS20J laat bij de eerste start van een app met `targetSdk 22` een
permissie-review zien ("Choose what to allow Lezing to access"). Zolang die
dialoog staat gaan scans naar de dialoog in plaats van naar de app. Eén keer
wegwerken:

```bash
adb -s <serial> shell pm grant com.zelfscannerlezing android.permission.READ_EXTERNAL_STORAGE
```

Of op het apparaat zelf op Continue tikken. Daarna komt hij niet meer terug.

## Devices

`minSdkVersion 21`, dus de MC18N0 (Android 5.1.1) kan mee. Daarom is alles in
`pack/` ES5: geen `const`, geen pijlfuncties, geen template literals, geen
trailing comma's, geen CSS-variabelen. `npm run pack:check` controleert dat en
hoort groen te zijn vóór elke push.

Het advies blijft de lezing op de **PS20J** (Android 10) te geven: moderne
WebView, geen TLS-probleem, en de MC18N0's blijven voor de speurtocht.

`targetSdkVersion 22` is met opzet: daarboven blokkeert Android cleartext http
en de POST naar de runner gaat over plain http naar een lokaal ip.

## Wat er NIET in zit

Geen kiosk-lockdown, geen cradle, geen fleet-deploy, geen story-sequencer. Sjef
houdt het apparaat zelf vast, er is geen publiek dat uit de app probeert te
komen, en er is één device. De app registreert zich ook **niet** als HOME-app:
op een speurtocht-device zou dat de launcher overnemen.

## Testen zonder device

`pack/lezing.js` luistert ook op het toetsenbord (cijfers plus Enter), zodat
het pack in een gewone browser te testen is:

```bash
cd ~/Development/2026/zelfscanner-lezing && node runner/server.js demo   # runner op 8080
cd ~/Development/2026/zelfscanner-lezing-app/pack && python3 -m http.server 8090
```

Daarna <http://127.0.0.1:8090/index.html> openen naast
<http://localhost:8080/show>. `pack/lezing.json` is in deze map de demo-lezing
als test-fixture; op het device wordt die door `push-pack.js` overschreven met
de lezing die je geeft.
