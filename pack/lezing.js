/**
 * Het pack-type voor de lezing. NIEUW, niet uit zelfscanner-v2 overgenomen:
 * pack/runtime.js daar is de story-sequencer van de speurtocht (splash, hint,
 * reward, end) en de lezing heeft een andere vorm -- een presentator die vrij
 * door zijn materiaal springt, met een tweede scherm op de beamer.
 *
 * Wat dit bestand doet, op het schermpje in Sjefs hand:
 *
 *   1. leest lezing.json van het filesystem (zelfde formaat als
 *      ~/Development/2026/zelfscanner-lezing/shared/manifest-schema.js);
 *   2. handelt window.onNativeScan(code) af en zet meteen de note van het
 *      juiste frame beeldvullend in beeld -- lokaal, dus ook zonder netwerk
 *      heeft Sjef altijd zijn tekst;
 *   3. POST elke scan naar de runner op /api/scan. Antwoordt die, dan is zijn
 *      stand leidend en passen we die toe (de runner houdt de frame-teller bij
 *      en stuurt het beeld naar de beamer). Mislukt de POST, dan rekent dit
 *      bestand het frame zelf uit -- volgend frame, na het laatste weer het
 *      eerste -- en trekt bij zodra de verbinding terug is;
 *   4. zoekt de runner op: 127.0.0.1 (usb-kabel met
 *      `adb reverse tcp:8080 tcp:8080`), het adres van de koppel-barcode en
 *      het lan-adres uit settings.json. /api/hello is de health check;
 *   5. laat onderaan in één regel zien of de verbinding er is. Klein, want een
 *      storing mag de lezing niet overnemen (docs/04, spoor 2);
 *   6. werkt zonder adb: de koppel-barcode (`ZSL:<ip>:<poort>`, op /koppel van
 *      de runner) zet het adres van de laptop, en de app haalt de actieve
 *      lezing zelf op via /api/pack zodra `rev` in /api/hello verandert. Beide
 *      gaan in localStorage, zodat ze een herstart overleven.
 *
 * ES5 / Chromium 46: geen const, geen let, geen pijlfuncties, geen template
 * literals, geen trailing comma's, geen CSS-variabelen. De MC18N0 (Android
 * 5.1.1) moet mee kunnen doen. `npm run pack:check` controleert dat.
 *
 * API: ZSLezing.start(onFout)   (index.html roept dat aan)
 */
window.ZSLezing = (function () {
  var MANIFEST_FILE = 'lezing.json';
  var SETTINGS_FILE = 'settings.json';

  // Koppel-barcode van runner/public/koppel.html: `ZSL:192.168.1.23:8080`.
  var KOPPEL_PREFIX = 'ZSL:';
  var OPSLAG_RUNNER = 'zsl.runner'; // 'http://192.168.1.23:8080'
  var OPSLAG_LEZING = 'zsl.lezing'; // {rev, bestand, manifest}
  var PACK_TIMEOUT_MS = 5000;

  // De usb-noodoplossing uit docs/04: scanner aan de laptop,
  // `adb reverse tcp:8080 tcp:8080`, helemaal geen netwerk nodig. Staat
  // vooraan omdat een kabel niet uitvalt.
  var USB_BASE = 'http://127.0.0.1:8080';

  var HELLO_TIMEOUT_MS = 1200;
  var SCAN_TIMEOUT_MS = 2000;
  var PROBE_WEG_MS = 4000; // zonder verbinding: zo vaak opnieuw zoeken
  var PROBE_OK_MS = 15000; // met verbinding: af en toe controleren
  var TOAST_MS = 2600;

  var noteEl = null;
  var noteSpan = null;
  var statusEl = null;
  var toastEl = null;
  var toastTimer = null;

  var manifest = null;
  var slideOpBarcode = {};
  var settings = {};
  var bases = []; // adressen om te proberen, in volgorde
  var base = null; // het adres dat antwoordde
  var verbonden = false;
  var probeTimer = null;
  var onFout = null;
  var gekoppeld = null; // adres van de koppel-barcode
  var lezingRev = null; // rev van de lezing die nu geladen is, als die van de runner kwam
  var bestandStempel = ''; // vingerafdruk van lezing.json op het filesystem
  var bezigMetOphalen = false;

  // De stand zoals die nu in beeld staat. Spiegelt `standVoorClients()` in
  // runner/server.js, zodat het lokale geval en het server-geval hetzelfde
  // object gebruiken.
  var stand = {
    barcode: null,
    frameIndex: 0,
    frameCount: 0,
    note: '',
    label: '',
    bron: 'start'
  };

  // ------------------------------------------------------------------ helpers

  function el(id) {
    return document.getElementById(id);
  }

  /** Lokaal bestand synchroon inlezen. Zelfde truc als in index.html. */
  function leesLokaalTekst(path) {
    var xhr = new XMLHttpRequest();
    try {
      xhr.open('GET', path, false);
      xhr.overrideMimeType('text/plain; charset=utf-8');
      xhr.send();
    } catch (e) {
      return null;
    }
    return xhr.responseText || null;
  }

  function leesJson(tekstje) {
    if (!tekstje) {
      return null;
    }
    try {
      return JSON.parse(tekstje);
    } catch (e) {
      return null;
    }
  }

  function leesLokaal(path) {
    return leesJson(leesLokaalTekst(path));
  }

  /**
   * localStorage, maar zonder te vallen: in een WebView zonder domStorage of
   * met een vol geheugen gooit het. Dan werkt koppelen alleen tot de herstart.
   */
  function opslagLees(sleutel) {
    try {
      return leesJson(window.localStorage.getItem(sleutel));
    } catch (e) {
      return null;
    }
  }

  function opslagSchrijf(sleutel, waarde) {
    try {
      window.localStorage.setItem(sleutel, JSON.stringify(waarde));
    } catch (e) {}
  }

  /**
   * Korte vingerafdruk (djb2). Zo zien we of iemand met adb een nieuwe
   * lezing.json heeft gepusht sinds de lezing van de runner is opgeslagen:
   * dan wint het bestand.
   */
  function stempel(tekstje) {
    var h = 5381;
    tekstje = tekstje || '';
    for (var i = 0; i < tekstje.length; i++) {
      h = ((h << 5) + h + tekstje.charCodeAt(i)) | 0;
    }
    return tekstje.length + '-' + (h >>> 0).toString(16);
  }

  function tekst(v) {
    return typeof v === 'string' ? v : '';
  }

  /**
   * Zelfde afleiding als normalizeManifest() in shared/manifest-schema.js: een
   * frame zonder eigen note erft die van de slide, zodat Sjef in het gewone
   * geval één keer zijn tekst schrijft. Het `type` van een frame laten we hier
   * liggen -- het beeld komt op de beamer, niet op dit schermpje.
   */
  function normaliseer(raw) {
    var out = {
      version: tekst(raw.version) || '1.0.0',
      title: tekst(raw.title),
      clearScan: tekst(raw.clearScan),
      slides: []
    };
    var slides = raw.slides || [];
    for (var i = 0; i < slides.length; i++) {
      var s = slides[i] || {};
      var frames = s.frames || [];
      var uit = [];
      for (var j = 0; j < frames.length; j++) {
        var f = frames[j] || {};
        uit.push({
          src: tekst(f.src),
          note: typeof f.note === 'string' ? f.note : tekst(s.note)
        });
      }
      out.slides.push({
        index: i,
        barcode: String(s.barcode),
        label: tekst(s.label),
        note: tekst(s.note),
        frames: uit
      });
    }
    return out;
  }

  function laadManifest(raw) {
    manifest = normaliseer(raw);
    slideOpBarcode = {};
    for (var i = 0; i < manifest.slides.length; i++) {
      slideOpBarcode[manifest.slides[i].barcode] = manifest.slides[i];
    }
  }

  /** Naar de HUD in App.tsx (alleen zichtbaar met SHOW_DEBUG_INFO = true). */
  function meldAanNative(text) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      try {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({type: 'status', payload: {text: text}})
        );
      } catch (e) {}
    }
  }

  // -------------------------------------------------------------------- beeld

  function zetNote(html, isLeeg) {
    noteSpan.innerHTML = html;
    noteEl.className = isLeeg ? 'leeg' : '';
    noteEl.scrollTop = 0;
    // Alleen overvloeien, geen beweging: dit is tekst die iemand staat te
    // lezen terwijl hij praat.
    if (window.ZSFx) {
      window.ZSFx.play(noteSpan, 'fade');
    }
  }

  function toonStatus() {
    var links = verbonden
      ? '<span class="link">verbonden</span>'
      : '<span class="link weg">geen verbinding</span>';
    var rechts = '';
    if (stand.frameCount > 1) {
      rechts = stand.frameIndex + 1 + '/' + stand.frameCount;
    } else if (stand.frameCount === 1) {
      rechts = '1/1';
    }
    var midden = stand.label ? ' &middot; ' + stand.label : '';
    statusEl.innerHTML =
      '<span class="frames">' + rechts + '</span>' + links + midden;
    meldAanNative(
      (verbonden ? 'verbonden' : 'geen verbinding') +
        (stand.barcode ? ' / ' + stand.barcode + ' ' + rechts : '')
    );
  }

  function toon(melding) {
    toastEl.innerHTML = melding;
    toastEl.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = '';
    }, TOAST_MS);
  }

  /** Eén plek waar de stand in beeld komt, voor zowel lokaal als server. */
  function pasStandToe(nieuw) {
    stand.barcode = nieuw.barcode || null;
    stand.frameIndex = nieuw.frameIndex || 0;
    stand.frameCount = nieuw.frameCount || 0;
    stand.note = tekst(nieuw.note);
    stand.label = tekst(nieuw.label);
    stand.bron = nieuw.bron || 'scan';
    if (!stand.barcode) {
      zetNote('Scherm leeg.', true);
    } else {
      zetNote(stand.note || '(geen note bij dit frame)', !stand.note);
    }
    toonStatus();
  }

  // ---------------------------------------------------------------- transport

  function vraag(method, url, body, timeoutMs, ok, mis) {
    var xhr = new XMLHttpRequest();
    var klaar = false;
    function af(gelukt, data) {
      if (klaar) {
        return;
      }
      klaar = true;
      if (gelukt) {
        if (ok) {
          ok(data);
        }
      } else if (mis) {
        mis();
      }
    }
    try {
      xhr.open(method, url, true);
    } catch (e) {
      af(false);
      return;
    }
    xhr.timeout = timeoutMs;
    if (body !== null) {
      xhr.setRequestHeader('Content-Type', 'application/json');
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) {
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        var data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e2) {
          af(false);
          return;
        }
        af(true, data);
      } else {
        af(false);
      }
    };
    xhr.ontimeout = function () {
      af(false);
    };
    xhr.onerror = function () {
      af(false);
    };
    try {
      xhr.send(body === null ? null : body);
    } catch (e3) {
      af(false);
    }
  }

  function zetVerbinding(aan, welkeBase) {
    var veranderd = aan !== verbonden;
    verbonden = aan;
    if (aan) {
      base = welkeBase || base;
    }
    if (veranderd) {
      toonStatus();
    }
    return veranderd;
  }

  /**
   * De stand van de runner overnemen. Gebeurt als de verbinding terugkomt: de
   * beamer hangt aan de runner, dus wat daar staat is wat de zaal ziet -- ook
   * als Ibo in de tussentijd met de operator-pagina verder is gegaan. Zonder
   * dit staat Sjefs note op iets anders dan het beeld.
   */
  function haalStand() {
    if (!base) {
      return;
    }
    vraag('GET', base + '/api/state', null, HELLO_TIMEOUT_MS, function (data) {
      pasStandToe({
        barcode: data.barcode,
        frameIndex: data.frameIndex,
        frameCount: data.frameCount,
        note: data.note,
        label: data.label,
        bron: 'bijgetrokken'
      });
    });
  }

  /**
   * De actieve lezing van de runner ophalen en bewaren. Zo komt een nieuwe
   * lezing op de scanner zonder adb: in de editor of op de operator-pagina
   * een andere lezing actief zetten is genoeg.
   */
  function haalLezing() {
    if (!base || bezigMetOphalen) {
      return;
    }
    bezigMetOphalen = true;
    vraag(
      'GET',
      base + '/api/pack',
      null,
      PACK_TIMEOUT_MS,
      function (data) {
        bezigMetOphalen = false;
        if (!data || !data.slides || !data.slides.length) {
          return;
        }
        var eerder = manifest;
        laadManifest(data);
        lezingRev = data.rev || null;
        opslagSchrijf(OPSLAG_LEZING, {
          rev: lezingRev,
          bestand: bestandStempel,
          manifest: data
        });
        if (!eerder || eerder.title !== manifest.title) {
          zetNote(
            (manifest.title ? manifest.title + '<br>' : '') + 'Scan een barcode.',
            true
          );
        }
        toon('lezing bijgewerkt');
        haalStand();
      },
      function () {
        bezigMetOphalen = false;
      }
    );
  }

  /** De adressen om te proberen, in volgorde. Dubbele eruit. */
  function bouwBases() {
    var lijst = [];
    function voeg(adres) {
      if (typeof adres !== 'string' || adres === '') {
        return;
      }
      adres = adres.replace(/\/+$/, '');
      for (var k = 0; k < lijst.length; k++) {
        if (lijst[k] === adres) {
          return;
        }
      }
      lijst.push(adres);
    }
    if (settings.usb !== false) {
      voeg(USB_BASE);
    }
    // De koppel-barcode is het laatst bewust gekozen adres, dus vóór
    // settings.json: dat kan nog van een ander netwerk zijn.
    voeg(gekoppeld);
    voeg(settings.runner);
    if (settings.runners && settings.runners.length) {
      for (var j = 0; j < settings.runners.length; j++) {
        voeg(settings.runners[j]);
      }
    }
    bases = lijst;
  }

  /** Een gescande koppel-barcode: `ZSL:192.168.1.23:8080`. */
  function koppel(rest) {
    rest = rest.replace(/^https?:\/\//, '');
    if (!/^[A-Za-z0-9.\-]+:[0-9]{1,5}$/.test(rest)) {
      toon('koppel-barcode niet te lezen');
      return;
    }
    gekoppeld = 'http://' + rest;
    opslagSchrijf(OPSLAG_RUNNER, gekoppeld);
    bouwBases();
    base = null;
    zetVerbinding(false);
    toon('laptop ' + rest + ' zoeken…');
    clearTimeout(probeTimer);
    zoekRunner(function (gelukt) {
      toon(gelukt ? 'gekoppeld met ' + rest : 'laptop ' + rest + ' antwoordt niet');
      probeTimer = setTimeout(hartslag, gelukt ? PROBE_OK_MS : PROBE_WEG_MS);
    });
  }

  /**
   * Adressen aflopen tot er één antwoordt. Geeft het eerste werkende adres,
   * dus usb (127.0.0.1) wint van het lan: een kabel valt niet uit.
   */
  function zoekRunner(klaar) {
    var i = 0;
    function volgende() {
      if (i >= bases.length) {
        zetVerbinding(false);
        if (klaar) {
          klaar(false);
        }
        return;
      }
      var kandidaat = bases[i++];
      vraag(
        'GET',
        kandidaat + '/api/hello?van=scanner',
        null,
        HELLO_TIMEOUT_MS,
        function (data) {
          var terug = !verbonden;
          zetVerbinding(true, kandidaat);
          if (data && data.rev && data.rev !== lezingRev) {
            haalLezing();
          } else if (terug) {
            haalStand();
          }
          if (klaar) {
            klaar(true);
          }
        },
        volgende
      );
    }
    volgende();
  }

  /** Blijft zoeken zolang de app draait. Vaker als de verbinding weg is. */
  function hartslag() {
    clearTimeout(probeTimer);
    zoekRunner(function (gelukt) {
      probeTimer = setTimeout(hartslag, gelukt ? PROBE_OK_MS : PROBE_WEG_MS);
    });
  }

  // --------------------------------------------------------------------- scan

  /**
   * Hetzelfde rekenwerk als scan() in runner/server.js, voor als de POST niet
   * aankomt: dezelfde barcode opnieuw is het volgende frame, na het laatste
   * weer het eerste.
   */
  function lokaleScan(code) {
    if (manifest.clearScan && code === manifest.clearScan) {
      return {soort: 'leeg'};
    }
    var slide = slideOpBarcode[code];
    if (!slide) {
      return {soort: 'onbekend', barcode: code};
    }
    var i = stand.barcode === code ? (stand.frameIndex + 1) % slide.frames.length : 0;
    return {
      soort: 'stand',
      barcode: code,
      frameIndex: i,
      frameCount: slide.frames.length,
      note: slide.frames[i].note,
      label: slide.label
    };
  }

  function pasLokaalToe(uitkomst) {
    if (uitkomst.soort === 'leeg') {
      pasStandToe({barcode: null});
      return;
    }
    if (uitkomst.soort === 'onbekend') {
      toon('deze barcode staat niet in de lezing');
      return;
    }
    pasStandToe(uitkomst);
  }

  /**
   * Een scan van de hardware-scanner (App.tsx injecteert dit).
   *
   * Eerst lokaal in beeld zetten, dan POSTen. De note moet er staan op het
   * moment dat Sjef kijkt, niet als het netwerk toevallig meewerkt. Antwoordt
   * de runner, dan is zijn stand leidend en zetten we die erover -- die heeft
   * ook de operator-pagina en de beamer meegenomen.
   */
  function scan(code) {
    code = String(code === null || code === undefined ? '' : code).replace(/[\r\n]+/g, '');
    code = code.replace(/^\s+|\s+$/g, '');
    if (code === '') {
      return;
    }
    // Vóór de manifest-check: een nieuwe scanner zonder lezing moet ook te
    // koppelen zijn.
    if (code.indexOf(KOPPEL_PREFIX) === 0) {
      koppel(code.slice(KOPPEL_PREFIX.length));
      return;
    }
    if (!manifest) {
      toon('nog geen lezing: scan de koppel-barcode op de laptop');
      return;
    }

    var lokaal = lokaleScan(code);
    pasLokaalToe(lokaal);

    if (!base) {
      // Nog nooit een adres gevonden: wel blijven zoeken, maar niet wachten.
      hartslag();
      return;
    }

    vraag(
      'POST',
      base + '/api/scan',
      JSON.stringify({barcode: code}),
      SCAN_TIMEOUT_MS,
      function (data) {
        zetVerbinding(true, base);
        if (!data || data.ok === false) {
          return;
        }
        if (data.bekend === false) {
          toon('deze barcode staat niet in de lezing');
          return;
        }
        if (data.leeg) {
          pasStandToe({barcode: null});
          return;
        }
        // De runner is leidend: ook als hij een ander frame teruggeeft dan we
        // lokaal hadden (bijvoorbeeld na een stuk zonder netwerk, of nadat de
        // operator-pagina iets heeft aangeklikt).
        pasStandToe({
          barcode: data.barcode,
          frameIndex: data.frameIndex,
          frameCount: data.frameCount,
          note: data.note,
          label: data.label,
          bron: 'runner'
        });
      },
      function () {
        // De lokale stand staat er al; alleen de melding erbij en meteen
        // opnieuw gaan zoeken.
        if (zetVerbinding(false)) {
          toon('runner antwoordt niet, lezing loopt lokaal door');
        }
        hartslag();
      }
    );
  }

  // -------------------------------------------------------------------- start

  function start(foutmelding) {
    onFout = foutmelding || null;
    noteEl = el('note');
    noteSpan = noteEl.getElementsByTagName('span')[0];
    statusEl = el('status');
    toastEl = el('toast');

    // De lezing: lezing.json van het filesystem (gepusht met adb), of de
    // lezing die de app zelf bij de runner heeft opgehaald. Die laatste wint,
    // tenzij lezing.json daarna veranderd is -- dan heeft iemand met adb een
    // nieuwe gepusht.
    var bestandTekst = leesLokaalTekst(MANIFEST_FILE);
    bestandStempel = stempel(bestandTekst);
    var raw = leesJson(bestandTekst);
    var bewaard = opslagLees(OPSLAG_LEZING);
    if (
      bewaard &&
      bewaard.manifest &&
      (!raw || bewaard.bestand === bestandStempel)
    ) {
      raw = bewaard.manifest;
      lezingRev = bewaard.rev || null;
    }

    // settings.json is van het apparaat, niet van de lezing: het lan-adres van
    // de laptop staat daar, zodat hetzelfde pack in een andere zaal alleen een
    // ander settings.json nodig heeft. Ontbreekt het bestand, dan blijven usb
    // en de koppel-barcode over.
    settings = leesLokaal(SETTINGS_FILE) || {};
    var opgeslagen = opslagLees(OPSLAG_RUNNER);
    gekoppeld = typeof opgeslagen === 'string' ? opgeslagen : null;
    bouwBases();

    if (raw && raw.slides && raw.slides.length) {
      laadManifest(raw);
      zetNote(
        (manifest.title ? manifest.title + '<br>' : '') + 'Scan een barcode.',
        true
      );
    } else {
      zetNote('Geen lezing.<br>Scan de koppel-barcode op de laptop.', true);
    }
    toonStatus();

    window.onNativeScan = scan;

    // Op de statusregel tikken zoekt meteen opnieuw: handig als de runner
    // tijdens het opstellen herstart is en Sjef niet wil wachten.
    statusEl.onclick = function () {
      toon('opnieuw zoeken…');
      hartslag();
    };

    // Toetsenbord-invoer als tweede weg naar binnen: een usb-scanner aan de
    // laptop of het papieren noodplan (docs/04, spoor 2 punt 5), en het is de
    // manier om dit pack in een gewone browser te testen zonder device.
    var buffer = '';
    document.addEventListener(
      'keydown',
      function (ev) {
        var k = ev.keyCode || 0;
        if (k === 13) {
          var code = buffer;
          buffer = '';
          scan(code);
        } else if (k >= 48 && k <= 57) {
          buffer += String(k - 48);
        } else if (k >= 96 && k <= 105) {
          buffer += String(k - 96);
        }
      },
      false
    );

    hartslag();
  }

  return {start: start, scan: scan};
})();
