# De app op een scanner zetten

Wat je één keer per apparaat doet. Daarna gaat een nieuwe lezing erop zonder
terminal, via "Naar de scanner" in de editor.

Niet verwarren:

| | Hoe vaak | Waarmee |
|---|---|---|
| **De app (APK) installeren** | één keer per apparaat | adb, dit document |
| **Een lezing erop zetten** | bij elke wijziging | de knop "Naar de scanner" in de editor |

## Voor je begint

- `adb` op de laptop. Check met `adb version`. Zit hij er niet, dan
  `brew install --cask android-platform-tools`.
- De APK. Die staat na een build in
  `android/app/build/outputs/apk/release/app-release.apk`.
- Op het apparaat: **USB debugging aan** (Instellingen → Developer options).
  Bij de eerste verbinding vraagt het apparaat zelf om toestemming, daar moet
  je op het schermpje op OK tikken.

## 1. Het apparaat aansluiten

**Met een kabel.** Aansluiten en controleren:

```bash
adb devices -l
```

Staat er `unauthorized` achter, kijk dan op het schermpje: daar wacht de vraag
om deze computer te vertrouwen.

**Over wifi**, handiger als je er meerdere tegelijk doet. Eerst één keer aan de
kabel:

```bash
adb -s <serienummer> tcpip 5555
```

Daarna kan de kabel eruit en verbind je op ip-adres:

```bash
adb connect 192.168.1.6:5555
```

Het ip-adres staat op het apparaat onder Instellingen → Wi-Fi → het netwerk
waarop hij zit. Na een herstart van het apparaat is de wifi-verbinding weg en
moet `tcpip` opnieuw via de kabel.

## 2. De APK bouwen

Alleen nodig als je de app zelf hebt aangepast. Heb je al een APK, sla dit over.

```bash
cd ~/Development/2026/zelfscanner-lezing-app
npm install
npm run pack:check
cd android && ./gradlew assembleRelease
```

`npm run pack:check` is de ES5-controle op alles in `pack/`. Die hoort groen te
zijn, anders doet het pack het niet op de MC18N0 (Chromium 46).

## 3. Installeren

**Op één apparaat:**

```bash
adb -s 192.168.1.6:5555 install -r android/app/build/outputs/apk/release/app-release.apk
```

`-r` betekent: vervang de versie die er al staat en laat de gegevens staan.

**Op alles wat nu aangesloten is.** Dit loopt over elk apparaat dat `adb devices`
noemt en zegt per stuk of het gelukt is:

```bash
cd ~/Development/2026/zelfscanner-lezing-app && APK=$(pwd)/android/app/build/outputs/apk/release/app-release.apk && for d in $(adb devices | awk 'NR>1 && $2=="device" {print $1}'); do m=$(adb -s $d shell getprop ro.product.model 2>/dev/null | tr -d '\r'); printf "%-20s %-8s " "$d" "$m"; uit=$(adb -s $d install -r "$APK" 2>&1 | tr -d '\r'); if echo "$uit" | grep -qi Success; then echo OK; else echo "MISLUKT: $(echo "$uit" | tail -2 | tr '\n' ' ')"; fi; done
```

Let op dat `adb devices` ook de speurtocht-apparaten noemt. Lees hieronder wat
dat voor ze betekent.

## 4. Eerste start op Android 10 (PS20J)

De PS20J laat bij de eerste start van een app met `targetSdk 22` een
permissie-review zien: *Choose what to allow Lezing to access*. Zolang die
dialoog staat gaan scans naar de dialoog in plaats van naar de app. Eén keer
wegwerken, op het apparaat op Continue tikken of vanaf de laptop:

```bash
adb -s 192.168.1.6:5555 shell pm grant com.zelfscannerlezing android.permission.READ_EXTERNAL_STORAGE
```

Daarna komt hij niet meer terug. Op de MC18N0 (Android 5.1) speelt dit niet:
daar worden rechten bij het installeren gegeven.

## 5. Controleren of het gelukt is

```bash
adb -s <device> shell pm list packages com.zelfscannerlezing
adb -s <device> shell ls /sdcard/zelfscanner-lezing/pack
```

De eerste regel hoort het pakket te noemen. De tweede is leeg tot je een lezing
hebt verstuurd: de APK bevat geen inhoud, dat is met opzet.

## 6. Een lezing erop zetten

Niet meer met de hand. Start de runner en ga naar de editor:

```bash
cd ~/Development/2026/zelfscanner-lezing && node runner/server.js
```

Dan in <http://localhost:8080/editor> op **Naar de scanner**. Die laat de
aangesloten apparaten zien, grijst de apparaten uit waar de app niet op staat,
stuurt de lezing en herstart de app.

Vanaf de terminal kan ook:

```bash
node tools/push-pack.js ~/Development/2026/zelfscanner-lezing/runner/packs/idfa --device 192.168.1.6:5555
```

## Let op bij de speurtocht-apparaten

De MC18N0's draaien de speurtocht (`com.zelfscannerv2`). De lezing-app staat die
niet in de weg:

- eigen `applicationId` (`com.zelfscannerlezing`), dus beide apps staan naast
  elkaar en de speurtocht wordt niet vervangen;
- eigen map op het apparaat (`/sdcard/zelfscanner-lezing/`), dus de content van
  de speurtocht in `/sdcard/zelfscanner/` blijft ongemoeid;
- de app meldt zich **niet** aan als HOME-app, want dat zou op een
  speurtocht-apparaat de launcher overnemen.

Wat wél gebeurt: **een lezing versturen start de lezing-app**. Dat apparaat
staat daarna dus niet meer in de speurtocht. Terug is een kwestie van de
speurtocht-app weer openen.

De lezing is bovendien **ongetest op de MC18N0**. Alles in `pack/` is ES5 en
`npm run pack:check` is groen, dus het hoort te werken, maar het is niet op het
apparaat gezien. Het advies blijft om de lezing op de PS20J te geven: moderne
WebView, geen TLS-probleem, en de MC18N0's blijven voor de speurtocht.

## De app er weer af halen

```bash
adb -s <device> uninstall com.zelfscannerlezing
adb -s <device> shell rm -rf /sdcard/zelfscanner-lezing
```

## Als het misgaat

| Melding | Wat het is |
|---|---|
| `device unauthorized` | op het schermpje staat de vraag of je deze computer vertrouwt |
| `device offline` | `adb disconnect` en opnieuw `adb connect`, of de kabel erin |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | er staat een versie met een andere sleutel op. Eerst `adb uninstall com.zelfscannerlezing` |
| `INSTALL_FAILED_INSUFFICIENT_STORAGE` | geen ruimte. De APK is 11 MB; kijk met `adb shell df /data` |
| `INSTALL_FAILED_OLDER_SDK` | het apparaat is ouder dan Android 5.0. Deze app vraagt `minSdk 21` |
| app start, scherm blijft zwart | er staat nog geen lezing op. Stuur er een met "Naar de scanner" |
| scans komen niet aan | op Android 10: de permissie-dialoog van stap 4 staat nog open |
