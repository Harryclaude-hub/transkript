/* ------------------------------------------------------------------
   Transkript im Browser - Funktion.
   Diese Datei steuert, WAS passiert. Wie es aussieht, steht in stil.css.
   ------------------------------------------------------------------ */

const $ = (a) => document.querySelector(a);
const $$ = (a) => Array.from(document.querySelectorAll(a));

/* Absatz-Regeln, gleiche Werte wie in der Laptop-Fassung */
const PAUSE_FUER_NEUEN_ABSATZ = 1.4;
const MAX_ZEICHEN_PRO_ABSATZ = 700;
const MIN_ZEICHEN_PRO_ABSATZ = 80;
const SATZENDE = ['.', '!', '?', ':'];

const SPEICHER = {
  orion: 'transkript.orion_an',
  begriffe: 'transkript.begriffe',
  korrekturen: 'transkript.korrekturen',
  segmente: 'transkript.segmente',
  titel: 'transkript.titel',
};

let orion = new Orion(ORION_BEGRIFFE, ORION_KORREKTUREN);
let segmente = [];            // {start, ende, text} in Sekunden ab Aufnahmestart
let erkennung = null;
let sollLaufen = false;
let pausiert = false;
let startZeit = 0;
let verstricheneZeit = 0;     // ueber mehrere Start/Stopp-Runden hinweg
let sprechbeginn = null;
let letzterAbschluss = 0;
let uhrTakt = null;
let wachhalter = null;

/* --- Am Leben halten ---------------------------------------------
   Die Spracherkennung des Browsers hoert von selbst wieder auf, oft
   schon nach dem ersten Satz oder nach kurzer Stille. Ohne das Folgende
   nimmt die Seite dann nichts mehr auf, obwohl "laeuft" dasteht.
   Deshalb: bei jedem Ende sofort neu anwerfen, dazu ein Waechter, der
   nachschaut, ob ueberhaupt noch etwas passiert.               ------ */
let neustartUhr = null;
let waechterTakt = null;
let letzteAktivitaet = 0;
let neustarts = 0;

const WAECHTER_GEDULD = 14000;   // so lange darf gar nichts passieren
const AUFNAHME_STROM = { strom: null, aufnehmer: null, stuecke: [], art: '' };
let tonAdresse = '';

/* --------------------------- Hilfen --------------------------- */

function entschaerfe(text) {
  const h = document.createElement('div');
  h.textContent = text == null ? '' : String(text);
  return h.innerHTML;
}

let meldungsUhr = null;
function melde(text, art) {
  const kasten = $('#meldung');
  kasten.textContent = text;
  kasten.className = 'meldung sichtbar' + (art ? ' ' + art : '');
  clearTimeout(meldungsUhr);
  meldungsUhr = setTimeout(() => { kasten.className = 'meldung'; }, 4600);
}

function zeit(sekunden) {
  sekunden = Math.floor(sekunden || 0);
  const s = String(sekunden % 60).padStart(2, '0');
  const m = String(Math.floor(sekunden / 60) % 60).padStart(2, '0');
  const h = Math.floor(sekunden / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function jetzt() {
  if (!sollLaufen || pausiert) return verstricheneZeit;
  return verstricheneZeit + (Date.now() - startZeit) / 1000;
}

/* --------------------------- Absaetze --------------------------- */

function absaetzeBauen() {
  const absaetze = [];
  let aktuell = null;

  for (const seg of segmente) {
    const text = (seg.text || '').trim();
    if (!text) continue;

    if (!aktuell) {
      aktuell = { start: seg.start, ende: seg.ende, text: text };
      continue;
    }

    const pause = seg.start - aktuell.ende;
    const zuLang = aktuell.text.length >= MAX_ZEICHEN_PRO_ABSATZ;
    const satzZuEnde = SATZENDE.some((z) => aktuell.text.endsWith(z));
    const langGenug = aktuell.text.length >= MIN_ZEICHEN_PRO_ABSATZ;

    if ((pause >= PAUSE_FUER_NEUEN_ABSATZ && satzZuEnde && langGenug) || zuLang) {
      absaetze.push(aktuell);
      aktuell = { start: seg.start, ende: seg.ende, text: text };
    } else {
      aktuell.text = (aktuell.text + ' ' + text).trim();
      aktuell.ende = seg.ende;
    }
  }
  if (aktuell) absaetze.push(aktuell);
  return absaetze;
}

/* --------------------------- Anzeige --------------------------- */

function zeichnen() {
  const kasten = $('#transkript');
  const absaetze = absaetzeBauen();

  if (!absaetze.length) {
    kasten.innerHTML = '<p class="leer">Noch nichts aufgenommen. '
      + 'Druecke oben auf &bdquo;Aufnahme starten&ldquo;.</p>';
    $('#transkriptZahlen').textContent = 'noch leer';
    return;
  }

  const unten = kasten.scrollHeight - kasten.scrollTop - kasten.clientHeight < 60;

  kasten.innerHTML = absaetze.map((a) => `
    <div class="absatz">
      <span class="absatzZeit">${zeit(a.start)}</span>
      <p>${entschaerfe(a.text)}</p>
    </div>`).join('');

  if (unten) kasten.scrollTop = kasten.scrollHeight;

  const woerter = absaetze.reduce((n, a) => n + a.text.split(/\s+/).filter(Boolean).length, 0);
  $('#transkriptZahlen').textContent =
    `${woerter} Woerter · ${absaetze.length} Absaetze · ${zeit(jetzt())}`;
}

function standAnzeigen(text) {
  $('#standText').textContent = text;
}

function uhrLaufen() {
  clearInterval(uhrTakt);
  uhrTakt = setInterval(() => {
    $('#uhr').textContent = zeit(jetzt());
    if (segmente.length) zeichnen();

    // Zeigen, dass die Erkennung wirklich noch lebt.
    if (sollLaufen && !pausiert) {
      const still = Math.round((Date.now() - letzteAktivitaet) / 1000);
      standAnzeigen(still > 4
        ? `Laeuft, hoert zu (seit ${still}s still).`
        : 'Laeuft, hoert zu.');
    }
  }, 1000);
}

/* --------------------------- Speichern im Browser --------------------------- */

function merken() {
  try {
    localStorage.setItem(SPEICHER.segmente, JSON.stringify(segmente));
    localStorage.setItem(SPEICHER.titel, $('#titel').value);
  } catch (e) { /* Speicher voll oder gesperrt, nicht schlimm */ }
}

function laden() {
  try {
    const roh = localStorage.getItem(SPEICHER.segmente);
    if (roh) {
      segmente = JSON.parse(roh) || [];
      if (segmente.length) {
        verstricheneZeit = segmente[segmente.length - 1].ende;
        letzterAbschluss = verstricheneZeit;
      }
    }
    const t = localStorage.getItem(SPEICHER.titel);
    if (t) $('#titel').value = t;

    const an = localStorage.getItem(SPEICHER.orion);
    if (an !== null) $('#orionSchalter').checked = an === 'true';

    const b = localStorage.getItem(SPEICHER.begriffe);
    const k = localStorage.getItem(SPEICHER.korrekturen);
    if (b || k) {
      orion = new Orion(
        b ? textZuListe(b) : ORION_BEGRIFFE,
        k ? textZuKarte(k) : ORION_KORREKTUREN
      );
    }
  } catch (e) { /* nichts gespeichert */ }
}

/* --------------------------- Spracherkennung --------------------------- */

function erkennungBauen() {
  const Bau = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Bau) return null;

  const e = new Bau();
  e.lang = 'de-DE';
  e.continuous = true;
  e.interimResults = true;
  e.maxAlternatives = 1;

  e.onstart = () => { letzteAktivitaet = Date.now(); };
  e.onaudiostart = () => { letzteAktivitaet = Date.now(); };
  e.onspeechstart = () => { letzteAktivitaet = Date.now(); };
  e.onsoundstart = () => { letzteAktivitaet = Date.now(); };

  e.onresult = (ereignis) => {
    letzteAktivitaet = Date.now();
    let vorlaeufig = '';

    for (let i = ereignis.resultIndex; i < ereignis.results.length; i++) {
      const ergebnis = ereignis.results[i];
      const text = (ergebnis[0].transcript || '').trim();
      if (!text) continue;

      if (ergebnis.isFinal) {
        const ende = jetzt();
        const start = sprechbeginn === null ? letzterAbschluss : sprechbeginn;
        let fertig = text;

        if ($('#orionSchalter').checked) {
          fertig = orion.korrigieren(text).text;
        }

        segmente.push({ start: start, ende: ende, text: fertig });
        letzterAbschluss = ende;
        sprechbeginn = null;
        merken();
      } else {
        if (sprechbeginn === null) sprechbeginn = jetzt();
        vorlaeufig += text + ' ';
      }
    }

    $('#vorlaeufig').textContent = vorlaeufig.trim();
    zeichnen();
  };

  e.onerror = (ereignis) => {
    const art = ereignis.error;
    if (art === 'no-speech' || art === 'aborted') return;      // faengt sich selbst

    if (art === 'not-allowed' || art === 'service-not-allowed') {
      sollLaufen = false;
      knoepfeSetzen();
      standAnzeigen('Mikrofon nicht erlaubt.');
      melde('Der Browser laesst nicht ans Mikrofon. Erlaube den Zugriff '
          + 'ueber das Schloss-Symbol in der Adresszeile.', 'fehler');
    } else if (art === 'network') {
      standAnzeigen('Keine Verbindung.');
      melde('Die Spracherkennung braucht Internet. Verbindung pruefen.', 'fehler');
    } else if (art === 'audio-capture') {
      sollLaufen = false;
      knoepfeSetzen();
      melde('Kein Mikrofon gefunden.', 'fehler');
    }
  };

  /* Der Browser beendet die Erkennung von selbst, oft schon nach dem
     ersten Satz. Dann hier sofort wieder anwerfen. */
  e.onend = () => {
    if (sollLaufen && !pausiert) neuStarten(120);
  };

  return e;
}


/* Wirft die Erkennung neu an. Immer mit einem FRISCHEN Objekt: ein einmal
   gestorbenes laesst sich in Chrome nicht zuverlaessig wiederbeleben.
   Klappt der Start nicht, wird es mit wachsendem Abstand weiter versucht,
   statt nach zwei Fehlschlaegen aufzugeben. */
function neuStarten(verzoegerung) {
  if (!sollLaufen || pausiert) return;

  clearTimeout(neustartUhr);
  neustartUhr = setTimeout(() => {
    if (!sollLaufen || pausiert) return;

    if (erkennung) {
      erkennung.onend = null;
      erkennung.onerror = null;
      erkennung.onresult = null;
      try { erkennung.abort(); } catch (fehler) { /* war schon tot */ }
    }

    try {
      erkennung = erkennungBauen();
      erkennung.start();
      letzteAktivitaet = Date.now();
      neustarts++;
    } catch (fehler) {
      neuStarten(Math.min(4000, Math.max(250, verzoegerung * 2)));
    }
  }, verzoegerung);
}


/* Waechter: schaut nach, ob ueberhaupt noch etwas ankommt. Passiert eine
   ganze Weile gar nichts, wird ohne viel Federlesen neu gestartet. */
function waechterStarten() {
  clearInterval(waechterTakt);
  waechterTakt = setInterval(() => {
    if (!sollLaufen || pausiert) return;
    if (Date.now() - letzteAktivitaet > WAECHTER_GEDULD) {
      standAnzeigen('Erkennung war eingeschlafen, laeuft wieder.');
      letzteAktivitaet = Date.now();
      neuStarten(60);
    }
  }, 3000);
}

/* --------------------------- Bedienung --------------------------- */

function knoepfeSetzen() {
  $('#knopfStart').disabled = sollLaufen;
  $('#knopfPause').disabled = !sollLaufen;
  $('#knopfStopp').disabled = !sollLaufen;
  $('#knopfPause').textContent = pausiert ? 'Weiter' : 'Pause';
  document.body.classList.toggle('nimmtAuf', sollLaufen && !pausiert);
}

async function bildschirmWachHalten(an) {
  try {
    if (an && 'wakeLock' in navigator) {
      wachhalter = await navigator.wakeLock.request('screen');
    } else if (wachhalter) {
      await wachhalter.release();
      wachhalter = null;
    }
  } catch (e) { /* nicht ueberall vorhanden, kein Problem */ }
}

/* Nimmt den Ton nebenher als Datei mit. Die Spracherkennung des Browsers
   rueckt den Ton nicht heraus, deshalb ein zweiter, eigener Mitschnitt.
   Damit kannst du die Aufnahme spaeter in die Laptop-Fassung geben und
   dort die Stimmen trennen lassen. */
async function tonMitschnittStarten() {
  if (!navigator.mediaDevices || !window.MediaRecorder) return;
  try {
    AUFNAHME_STROM.strom = await navigator.mediaDevices.getUserMedia({ audio: true });
    AUFNAHME_STROM.stuecke = [];

    const arten = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
    const art = arten.find((a) => !a || MediaRecorder.isTypeSupported(a));
    AUFNAHME_STROM.art = art || '';

    const aufnehmer = new MediaRecorder(AUFNAHME_STROM.strom,
      art ? { mimeType: art } : undefined);
    aufnehmer.ondataavailable = (e) => {
      if (e.data && e.data.size) AUFNAHME_STROM.stuecke.push(e.data);
    };
    aufnehmer.start(4000);
    AUFNAHME_STROM.aufnehmer = aufnehmer;
  } catch (fehler) {
    // Ohne Mitschnitt laeuft die Erkennung trotzdem weiter.
    AUFNAHME_STROM.aufnehmer = null;
  }
}

function tonMitschnittBeenden() {
  const a = AUFNAHME_STROM.aufnehmer;
  if (!a) return;

  a.onstop = () => {
    if (!AUFNAHME_STROM.stuecke.length) return;
    const art = AUFNAHME_STROM.art || 'audio/webm';
    const blob = new Blob(AUFNAHME_STROM.stuecke, { type: art });
    if (tonAdresse) URL.revokeObjectURL(tonAdresse);
    tonAdresse = URL.createObjectURL(blob);
    $('#knopfTon').hidden = false;
    $('#knopfTon').dataset.endung = art.includes('mp4') ? 'm4a' : 'webm';
  };

  try { a.stop(); } catch (fehler) { /* schon aus */ }
  if (AUFNAHME_STROM.strom) {
    AUFNAHME_STROM.strom.getTracks().forEach((spur) => spur.stop());
  }
  AUFNAHME_STROM.aufnehmer = null;
}

$('#knopfStart').addEventListener('click', async () => {
  const Bau = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Bau) { melde('Dieser Browser kann keine Spracherkennung.', 'fehler'); return; }

  sollLaufen = true;
  pausiert = false;
  startZeit = Date.now();
  sprechbeginn = null;
  letzteAktivitaet = Date.now();
  neustarts = 0;

  await tonMitschnittStarten();

  erkennung = erkennungBauen();
  try { erkennung.start(); } catch (fehler) { neuStarten(300); }

  waechterStarten();
  knoepfeSetzen();
  uhrLaufen();
  bildschirmWachHalten(true);
  standAnzeigen('Laeuft. Sprich einfach los.');
  melde('Aufnahme laeuft. Fenster offen und sichtbar lassen.');
});

$('#knopfPause').addEventListener('click', () => {
  if (!sollLaufen) return;

  if (!pausiert) {
    pausiert = true;
    verstricheneZeit += (Date.now() - startZeit) / 1000;
    clearTimeout(neustartUhr);
    try { erkennung.stop(); } catch (e) {}
    if (AUFNAHME_STROM.aufnehmer) {
      try { AUFNAHME_STROM.aufnehmer.pause(); } catch (e) {}
    }
    standAnzeigen('Pause.');
  } else {
    pausiert = false;
    startZeit = Date.now();
    letzteAktivitaet = Date.now();
    if (AUFNAHME_STROM.aufnehmer) {
      try { AUFNAHME_STROM.aufnehmer.resume(); } catch (e) {}
    }
    neuStarten(80);
    standAnzeigen('Laeuft weiter.');
  }
  knoepfeSetzen();
});

$('#knopfStopp').addEventListener('click', () => {
  if (!pausiert) verstricheneZeit += (Date.now() - startZeit) / 1000;
  sollLaufen = false;
  pausiert = false;

  clearTimeout(neustartUhr);
  clearInterval(waechterTakt);
  if (erkennung) {
    erkennung.onend = null;
    try { erkennung.stop(); } catch (e) {}
  }
  tonMitschnittBeenden();

  clearInterval(uhrTakt);
  $('#vorlaeufig').textContent = '';
  knoepfeSetzen();
  bildschirmWachHalten(false);
  standAnzeigen('Beendet.');
  merken();
  zeichnen();
  melde('Aufnahme beendet. Jetzt herunterladen nicht vergessen.');
});

$('#knopfTon').addEventListener('click', () => {
  if (!tonAdresse) return;
  const link = document.createElement('a');
  link.href = tonAdresse;
  link.download = dateiname($('#knopfTon').dataset.endung || 'webm');
  document.body.appendChild(link);
  link.click();
  link.remove();
  melde('Tonaufnahme heruntergeladen. Die kannst du in die Laptop-Fassung geben.');
});

/* --------------------------- Reiter --------------------------- */

$$('.reiterKnopf').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    $$('.reiterKnopf').forEach((k) => k.classList.remove('aktiv'));
    $$('.tafel').forEach((t) => t.classList.remove('aktiv'));
    knopf.classList.add('aktiv');
    $('#' + knopf.dataset.ziel).classList.add('aktiv');
  });
});

/* --------------------------- Orion --------------------------- */

$('#orionSchalter').addEventListener('change', (e) => {
  const an = e.target.checked;
  localStorage.setItem(SPEICHER.orion, an ? 'true' : 'false');
  document.body.classList.toggle('orionAus', !an);
  melde(an
    ? 'Orion-Funktion an. Fachbegriffe werden geradegezogen.'
    : 'Orion-Funktion aus. Der Text bleibt wie erkannt.');
});

function listeZuText(liste) { return liste.join('\n'); }
function karteZuText(karte) {
  return Object.keys(karte).map((k) => k + ' = ' + karte[k]).join('\n');
}
function textZuListe(text) {
  return text.split('\n').map((z) => z.trim())
             .filter((z) => z && !z.startsWith('#'));
}
function textZuKarte(text) {
  const karte = {};
  for (const zeile of text.split('\n')) {
    const sauber = zeile.trim();
    if (!sauber || sauber.startsWith('#') || !sauber.includes('=')) continue;
    const teil = sauber.split('=');
    const falsch = teil.shift().trim().toLowerCase();
    const richtig = teil.join('=').trim();
    if (falsch && richtig) karte[falsch] = richtig;
  }
  return karte;
}

function begriffeAnzeigen() {
  $('#feldBegriffe').value = listeZuText(orion.begriffe);
  $('#feldKorrekturen').value = karteZuText(orion.korrekturen);
  $('#zahlBegriffe').textContent = orion.begriffe.length;
  $('#zahlKorrekturen').textContent = Object.keys(orion.korrekturen).length;
}

$('#knopfBegriffeSpeichern').addEventListener('click', () => {
  const b = $('#feldBegriffe').value;
  const k = $('#feldKorrekturen').value;
  localStorage.setItem(SPEICHER.begriffe, b);
  localStorage.setItem(SPEICHER.korrekturen, k);
  orion = new Orion(textZuListe(b), textZuKarte(k));
  begriffeAnzeigen();
  melde(`Gespeichert: ${orion.begriffe.length} Begriffe, `
      + `${Object.keys(orion.korrekturen).length} Korrekturen.`);
});

$('#knopfBegriffeZurueck').addEventListener('click', () => {
  if (!confirm('Deine eigenen Begriffe verwerfen und den Standard laden?')) return;
  localStorage.removeItem(SPEICHER.begriffe);
  localStorage.removeItem(SPEICHER.korrekturen);
  orion = new Orion(ORION_BEGRIFFE, ORION_KORREKTUREN);
  begriffeAnzeigen();
  melde('Standard wiederhergestellt.');
});

/* --------------------------- Herunterladen --------------------------- */

function dateiname(endung) {
  const jetztDatum = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stempel = `${jetztDatum.getFullYear()}-${p(jetztDatum.getMonth() + 1)}-`
                + `${p(jetztDatum.getDate())}_${p(jetztDatum.getHours())}-`
                + `${p(jetztDatum.getMinutes())}`;
  const titel = ($('#titel').value.trim() || 'Transkript')
    .replace(/[^\wäöüÄÖÜß \-]/g, '').replace(/\s+/g, '_').slice(0, 50);
  return `${stempel}_${titel}.${endung}`;
}

function herunterladen(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function kopfzeilen(absaetze) {
  const woerter = absaetze.reduce(
    (n, a) => n + a.text.split(/\s+/).filter(Boolean).length, 0);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return [
    `Erstellt: ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} `
      + `um ${p(d.getHours())}:${p(d.getMinutes())} Uhr`,
    `Laenge: ${zeit(jetzt())}`,
    `Woerter: ${woerter}`,
    `Absaetze: ${absaetze.length}`,
    `Orion-Funktion: ${$('#orionSchalter').checked ? 'eingeschaltet' : 'ausgeschaltet'}`,
  ];
}

$$('[data-format]').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    const absaetze = absaetzeBauen();
    if (!absaetze.length) { melde('Es gibt noch nichts zum Herunterladen.', 'fehler'); return; }

    const titel = $('#titel').value.trim() || 'Transkript';
    const kopf = kopfzeilen(absaetze);
    const format = knopf.dataset.format;

    try {
      if (format === 'txt') {
        const text = [titel, '='.repeat(titel.length), '', ...kopf, '',
                      '-'.repeat(60), '',
                      ...absaetze.map((a) => a.text + '\n')].join('\n');
        herunterladen(new Blob([text], { type: 'text/plain;charset=utf-8' }),
                      dateiname('txt'));

      } else if (format === 'doc') {
        const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
          + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
          + 'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">'
          + '<title>' + entschaerfe(titel) + '</title></head><body>'
          + '<h1 style="font-family:Calibri,sans-serif">' + entschaerfe(titel) + '</h1>'
          + kopf.map((z) => '<p style="font-family:Calibri,sans-serif;font-size:9pt;'
              + 'color:#666;margin:0">' + entschaerfe(z) + '</p>').join('')
          + '<hr>'
          + absaetze.map((a) => '<p style="font-family:Calibri,sans-serif;font-size:11pt;'
              + 'line-height:1.5">' + entschaerfe(a.text) + '</p>').join('')
          + '</body></html>';
        herunterladen(new Blob(['﻿' + html], { type: 'application/msword' }),
                      dateiname('doc'));

      } else {
        const fuerPdf = absaetze.map((a) => ({ text: a.text, zeit: zeit(a.start) }));
        herunterladen(pdfErzeugen(titel, kopf, fuerPdf, false), dateiname('pdf'));
      }
      melde('Datei wurde heruntergeladen.');
    } catch (fehler) {
      melde('Beim Schreiben ist etwas schiefgegangen: ' + fehler.message, 'fehler');
    }
  });
});

$('#knopfKopieren').addEventListener('click', async () => {
  const text = absaetzeBauen().map((a) => a.text).join('\n\n');
  if (!text) { melde('Nichts zum Kopieren da.', 'fehler'); return; }
  try {
    await navigator.clipboard.writeText(text);
    melde('In die Zwischenablage kopiert.');
  } catch (fehler) {
    melde('Kopieren hat der Browser blockiert.', 'fehler');
  }
});

$('#knopfLeeren').addEventListener('click', () => {
  if (!segmente.length) return;
  if (!confirm('Transkript wirklich leeren? Nicht Heruntergeladenes ist dann weg.')) return;
  segmente = [];
  verstricheneZeit = 0;
  letzterAbschluss = 0;
  sprechbeginn = null;
  $('#uhr').textContent = '00:00';
  merken();
  zeichnen();
  melde('Geleert.');
});

/* --------------------------- Start --------------------------- */

(function start() {
  laden();
  begriffeAnzeigen();
  zeichnen();
  document.body.classList.toggle('orionAus', !$('#orionSchalter').checked);

  const kann = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!kann) {
    const w = $('#warnung');
    w.hidden = false;
    w.innerHTML = '<strong>Dieser Browser kann keine Spracherkennung.</strong> '
      + 'Nimm Chrome oder Edge, am Handy Chrome. '
      + 'Herunterladen und Bearbeiten geht hier trotzdem.';
    $('#knopfStart').disabled = true;
  }

  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') {
    const w = $('#warnung');
    w.hidden = false;
    w.innerHTML = '<strong>Diese Seite laeuft nicht ueber HTTPS.</strong> '
      + 'Ohne sichere Verbindung gibt der Browser das Mikrofon nicht frei.';
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && sollLaufen && !pausiert) {
      standAnzeigen('Fenster im Hintergrund, der Browser bremst die Erkennung.');
    } else if (sollLaufen && !pausiert) {
      standAnzeigen('Laeuft.');
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (sollLaufen) { e.preventDefault(); e.returnValue = ''; }
  });
})();
