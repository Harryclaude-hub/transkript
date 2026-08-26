/* ------------------------------------------------------------------
   Transkript im Browser - Funktion.
   Diese Datei steuert, WAS passiert. Wie es aussieht, steht in stil.css.
   ------------------------------------------------------------------ */

import * as Motor from './motor.js?v=3';
import { Tonband, alsWav, dateiLesen, RATE } from './ton.js?v=3';
import * as Ablage from './ablage.js?v=3';

const $ = (a) => document.querySelector(a);
const $$ = (a) => Array.from(document.querySelectorAll(a));

/* Absatz-Regeln, gleiche Werte wie in der Laptop-Fassung */
const PAUSE_FUER_NEUEN_ABSATZ = 1.4;
const MAX_ZEICHEN_PRO_ABSATZ = 700;
const MIN_ZEICHEN_PRO_ABSATZ = 80;
const SATZENDE = ['.', '!', '?', ':'];

const FARBEN = ['#2563eb', '#dc2626', '#16a34a', '#d97706',
                '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const farbeVon = (p) => (p > 0 ? FARBEN[(p - 1) % FARBEN.length] : '#6b7280');

/* Live-Erkennung: so viel Ton sammeln, bevor ein Block erkannt wird,
   plus Reserve, damit im Leisen geschnitten werden kann statt im Wort. */
const BLOCK_SEKUNDEN = 20;
const RESERVE_SEKUNDEN = 3;

const SPEICHER = {
  orion: 'tr.orion_an', begriffe: 'tr.begriffe', korrekturen: 'tr.korrekturen',
  modell: 'tr.modell', sprache: 'tr.sprache', zeitstempel: 'tr.zeitstempel',
  empf: 'tr.empfindlichkeit', stimmen: 'tr.stimmen_an',
  anzahl: 'tr.anzahl_personen', aehnlich: 'tr.aehnlichkeit',
  toene: 'tr.toene_an', musik: 'tr.musik_weglassen', tonSchwelle: 'tr.ton_schwelle',
};

let orion = new Orion(ORION_BEGRIFFE, ORION_KORREKTUREN);
let band = new Tonband();
let segmente = [];
let sprecherAbschnitte = [];
let geraeusche = [];
let namen = {};
let kennung = null;
let personenBestimmt = false;

let laeuft = false, pausiert = false, erkenntGerade = false;
let erkanntBis = 0;          // bis zu welcher Sekunde schon Text da ist
let uhrTakt = null, arbeitTakt = null, wachhalter = null;
let abgewaehlt = new Set();
let letzteAbsaetze = [];
let laufendeZeile = null;
const protokoll = [];

/* --------------------------- Hilfen --------------------------- */

function entschaerfe(t) {
  const h = document.createElement('div');
  h.textContent = t == null ? '' : String(t);
  return h.innerHTML;
}

let meldungsUhr = null;
function melde(text, art) {
  const k = $('#meldung');
  k.textContent = text;
  k.className = 'meldung sichtbar' + (art ? ' ' + art : '');
  clearTimeout(meldungsUhr);
  meldungsUhr = setTimeout(() => { k.className = 'meldung'; }, 4600);
}

function notiere(text) {
  protokoll.push(new Date().toLocaleTimeString('de-DE') + '  ' + text);
  protokoll.splice(0, Math.max(0, protokoll.length - 60));
  $('#protokoll').textContent = protokoll.slice(-14).join('\n');
}

function stand(text) { $('#standText').textContent = text; notiere(text); }

function zeit(s) {
  s = Math.floor(s || 0);
  const ss = String(s % 60).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const hh = Math.floor(s / 3600);
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

const einst = (k, standardwert) => {
  const v = localStorage.getItem(SPEICHER[k]);
  return v === null ? standardwert : v;
};
const einstZahl = (k, s) => parseFloat(einst(k, s));
const einstJa = (k, s) => einst(k, s ? 'true' : 'false') === 'true';

Motor.beiMeldung((t) => { stand(t); });

/* --------------------------- Reiter --------------------------- */

$$('.reiterKnopf').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    $$('.reiterKnopf').forEach((k) => k.classList.remove('aktiv'));
    $$('.tafel').forEach((t) => t.classList.remove('aktiv'));
    knopf.classList.add('aktiv');
    $('#' + knopf.dataset.ziel).classList.add('aktiv');
    if (knopf.dataset.ziel === 'tafelAblage') ablageZeigen();
  });
});

/* --------------------------- Absaetze --------------------------- */

function absaetzeBauen() {
  const raus = [];
  let jetzt = null;

  for (const s of segmente) {
    const text = (s.text || '').trim();
    if (!text) continue;
    const neu = { start: s.start, ende: s.ende, text,
                  person: s.person || 0, geraeusch: !!s.geraeusch };

    if (!jetzt) { jetzt = neu; continue; }

    if (neu.person !== jetzt.person || neu.geraeusch || jetzt.geraeusch) {
      raus.push(jetzt); jetzt = neu; continue;
    }

    const pause = neu.start - jetzt.ende;
    const zuLang = jetzt.text.length >= MAX_ZEICHEN_PRO_ABSATZ;
    const satzEnde = SATZENDE.some((z) => jetzt.text.endsWith(z));
    const langGenug = jetzt.text.length >= MIN_ZEICHEN_PRO_ABSATZ;

    if ((pause >= PAUSE_FUER_NEUEN_ABSATZ && satzEnde && langGenug) || zuLang) {
      raus.push(jetzt); jetzt = neu;
    } else {
      jetzt.text = (jetzt.text + ' ' + neu.text).trim();
      jetzt.ende = neu.ende;
    }
  }
  if (jetzt) raus.push(jetzt);
  raus.forEach((a) => { a.dauer = Math.max(0, a.ende - a.start); });
  return raus;
}

function nameVon(person) {
  if (namen[person] && namen[person].trim()) return namen[person].trim();
  return person > 0 ? 'Person ' + person : 'Unbekannt';
}

function personenListe(absaetze) {
  const map = new Map();
  for (const a of absaetze) {
    if (a.geraeusch || !a.person) continue;
    const e = map.get(a.person)
      || { person: a.person, sekunden: 0, woerter: 0, absaetze: 0 };
    e.sekunden += a.dauer;
    e.woerter += a.text.split(/\s+/).filter(Boolean).length;
    e.absaetze++;
    map.set(a.person, e);
  }
  return [...map.values()].sort((x, y) => x.person - y.person);
}

/* --------------------------- Anzeige --------------------------- */

function gleich(a, b) {
  return a.length === b.length && a.every((x, i) =>
    x.text === b[i].text && x.person === b[i].person && x.start === b[i].start);
}

function zeichnen() {
  const kasten = $('#transkript');
  const absaetze = absaetzeBauen();

  if (!absaetze.length) {
    if (letzteAbsaetze.length) {
      kasten.innerHTML = '<p class="leer">Noch nichts aufgenommen.</p>';
      letzteAbsaetze = [];
    }
    $('#transkriptZahlen').textContent = 'noch leer';
    personenZeichnen([]);
    return;
  }

  if (!gleich(absaetze, letzteAbsaetze)) {
    const unten = kasten.scrollHeight - kasten.scrollTop - kasten.clientHeight < 60;

    kasten.innerHTML = absaetze.map((a) => {
      const farbe = farbeVon(a.person);
      const kopf = [];
      if (!a.geraeusch && a.person > 0) {
        kopf.push(`<span class="zeileName" style="color:${farbe}">`
          + `${entschaerfe(nameVon(a.person))}</span>`);
      }
      kopf.push(`<span class="zeileZeit">${zeit(a.start)}</span>`);
      kopf.push(`<span class="zeileDauer">${a.dauer.toFixed(1)} s</span>`);

      return `<div class="absatz ${a.geraeusch ? 'geraeusch' : ''}"
                   data-von="${a.start}" data-bis="${a.ende}" tabindex="0"
                   style="--farbe:${farbe}" title="Antippen zum Anhoeren">
                <div class="zeileKopf">${kopf.join('')}
                  <span class="zeileSpiel">&#9654;</span></div>
                <p>${entschaerfe(a.text)}</p>
              </div>`;
    }).join('');

    $$('#transkript .absatz').forEach((zeile) => {
      const los = () => abspielen(zeile, parseFloat(zeile.dataset.von),
                                  parseFloat(zeile.dataset.bis));
      zeile.addEventListener('click', los);
      zeile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); los(); }
      });
    });

    if (unten) kasten.scrollTop = kasten.scrollHeight;
    letzteAbsaetze = absaetze;
  }

  const woerter = absaetze.filter((a) => !a.geraeusch)
    .reduce((n, a) => n + a.text.split(/\s+/).filter(Boolean).length, 0);
  const leute = personenListe(absaetze);
  let z = `${woerter} Woerter &middot; ${absaetze.length} Absaetze `
        + `&middot; ${zeit(band.sekunden)}`;
  if (leute.length) z += ` &middot; ${leute.length} `
    + (leute.length === 1 ? 'Person' : 'Personen');
  $('#transkriptZahlen').innerHTML = z;

  personenZeichnen(leute);
}

function personenZeichnen(leute) {
  const leiste = $('#personenLeiste');
  if (!leute.length) {
    leiste.innerHTML = '';
    $('#filterHinweis').textContent = '';
    return;
  }

  leiste.innerHTML = leute.map((p) => {
    const aus = abgewaehlt.has(p.person);
    return `<div class="personChip ${aus ? 'aus' : ''}" style="--farbe:${farbeVon(p.person)}">
      <button class="chipWahl" data-person="${p.person}"
              title="Beim Herunterladen mitnehmen oder weglassen">
        <span class="chipPunkt"></span>
        <span class="chipName">${entschaerfe(nameVon(p.person))}</span>
        <span class="chipZahl">${zeit(p.sekunden)}</span>
      </button>
      <button class="chipStift" data-umbenennen="${p.person}"
              title="Umbenennen">&#9998;</button>
    </div>`;
  }).join('');

  $$('[data-person]').forEach((k) => k.addEventListener('click', () => {
    const n = parseInt(k.dataset.person, 10);
    if (abgewaehlt.has(n)) abgewaehlt.delete(n); else abgewaehlt.add(n);
    personenZeichnen(leute);
  }));

  $$('[data-umbenennen]').forEach((k) => k.addEventListener('click', async () => {
    const n = parseInt(k.dataset.umbenennen, 10);
    const neu = prompt(`Wie soll ${nameVon(n)} heissen?`, namen[n] || '');
    if (neu === null) return;
    if (neu.trim()) namen[n] = neu.trim().slice(0, 40); else delete namen[n];
    letzteAbsaetze = [];
    zeichnen();
    if (kennung) await ablageSpeichern(true);
    melde(neu.trim() ? `Heisst jetzt ${neu.trim()}.` : 'Name entfernt.');
  }));

  $('#filterHinweis').textContent = abgewaehlt.size
    ? 'Beim Herunterladen weggelassen: '
      + leute.filter((p) => abgewaehlt.has(p.person)).map((p) => nameVon(p.person)).join(', ')
    : '';
}

/* --------------------------- Abspielen --------------------------- */

function abspielenBeenden() {
  if (laufendeZeile) { laufendeZeile.classList.remove('spielt'); laufendeZeile = null; }
}

function abspielen(zeile, von, bis) {
  if (!band.anzahl) { melde('Zu diesem Transkript gibt es keinen Ton.', 'fehler'); return; }

  if (laufendeZeile === zeile) { band.abspielenStoppen(); abspielenBeenden(); return; }

  abspielenBeenden();
  laufendeZeile = zeile;
  zeile.classList.add('spielt');
  band.abspielen(Math.max(0, von - 0.15), bis + 0.2, abspielenBeenden);
}

/* --------------------------- Aufnahme --------------------------- */

function knoepfe() {
  $('#knopfStart').disabled = laeuft;
  $('#knopfPause').disabled = !laeuft;
  $('#knopfStopp').disabled = !laeuft;
  $('#knopfPause').textContent = pausiert ? 'Weiter' : 'Pause';
  document.body.classList.toggle('nimmtAuf', laeuft && !pausiert);
  $('#knopfSprecher').disabled = !band.anzahl || !segmente.length || erkenntGerade;
}

async function wachHalten(an) {
  try {
    if (an && 'wakeLock' in navigator) wachhalter = await navigator.wakeLock.request('screen');
    else if (wachhalter) { await wachhalter.release(); wachhalter = null; }
  } catch (f) { /* nicht ueberall vorhanden */ }
}

/* Sucht im hinteren Teil die leiseste Stelle, damit nicht im Wort geschnitten wird. */
function schnittFinden(werte, mindestens) {
  const fenster = Math.round(0.25 * RATE);
  if (werte.length - mindestens < fenster * 2) return werte.length;

  let besteStelle = werte.length, besterWert = Infinity;
  const schritt = Math.round(0.05 * RATE);
  for (let i = mindestens; i < werte.length - fenster; i += schritt) {
    let summe = 0;
    for (let k = i; k < i + fenster; k += 4) summe += Math.abs(werte[k]);
    const wert = summe / (fenster / 4);
    if (wert < besterWert) { besterWert = wert; besteStelle = i + fenster / 2; }
  }
  return Math.round(besteStelle);
}

const RUHE_SCHWELLE = { 1: 0.010, 2: 0.006, 3: 0.004, 4: 0.0025, 5: 0.0012 };

async function blockErkennen(vonSekunde, bisSekunde) {
  const werte = band.alsFloat(vonSekunde, bisSekunde);
  if (werte.length < RATE * 0.5) return;

  let summe = 0;
  for (let i = 0; i < werte.length; i += 8) summe += Math.abs(werte[i]);
  const laut = summe / (werte.length / 8);
  const schwelle = RUHE_SCHWELLE[parseInt($('#empfindlichkeit').value, 10)] || 0.0025;
  if (laut < schwelle) return;         // nur Stille, nichts zu erkennen

  const modell = $('#modellGroesse').value;
  const sprache = $('#sprache').value;

  let neue = await Motor.textErkennen(werte, modell, sprache, vonSekunde);
  if ($('#orionSchalter').checked) {
    neue = neue.map((s) => ({ ...s, text: orion.korrigieren(s.text).text }));
  }
  neue.forEach((s) => { s.person = 0; });
  segmente.push(...neue);
  segmente.sort((a, b) => a.start - b.start);
}

async function arbeitsrunde() {
  if (erkenntGerade || !laeuft || pausiert) return;
  const offen = band.sekunden - erkanntBis;
  if (offen < BLOCK_SEKUNDEN + RESERVE_SEKUNDEN) return;

  erkenntGerade = true;
  try {
    const werte = band.alsFloat(erkanntBis, band.sekunden);
    const schnitt = schnittFinden(werte, BLOCK_SEKUNDEN * RATE);
    const bis = erkanntBis + schnitt / RATE;

    stand('Wird erkannt ...');
    await blockErkennen(erkanntBis, bis);
    erkanntBis = bis;
    zeichnen();
    stand('Laeuft, hoert zu.');
  } catch (f) {
    notiere('Ein Block ging schief: ' + f.message);
  } finally {
    erkenntGerade = false;
  }
}

$('#knopfStart').addEventListener('click', async () => {
  if (laeuft) return;
  $('#knopfStart').disabled = true;

  try {
    if (band.anzahl && !confirm('Es gibt schon eine Aufnahme. Neu anfangen?')) {
      $('#knopfStart').disabled = false; return;
    }
    if (band.anzahl) neuAnfangen(false);

    stand('Spracherkennung wird vorbereitet ...');
    await Motor.textErkennerLaden($('#modellGroesse').value);

    band = new Tonband();
    await band.starten();
  } catch (f) {
    $('#knopfStart').disabled = false;
    melde('Aufnahme geht nicht: ' + f.message, 'fehler');
    stand('Bereit.');
    return;
  }

  laeuft = true; pausiert = false; erkanntBis = 0;
  knoepfe(); wachHalten(true);
  stand('Laeuft, hoert zu.');
  melde('Aufnahme laeuft. Fenster offen lassen.');

  clearInterval(uhrTakt);
  uhrTakt = setInterval(() => {
    $('#uhr').textContent = zeit(band.sekunden);
    $('#pegel').style.width = Math.min(100, band.pegel * 1200) + '%';
  }, 300);

  clearInterval(arbeitTakt);
  arbeitTakt = setInterval(arbeitsrunde, 1500);
});

$('#knopfPause').addEventListener('click', () => {
  if (!laeuft) return;
  pausiert = !pausiert;
  band.pause(pausiert);
  knoepfe();
  stand(pausiert ? 'Pause.' : 'Laeuft, hoert zu.');
});

$('#knopfStopp').addEventListener('click', async () => {
  if (!laeuft) return;
  laeuft = false; pausiert = false;
  clearInterval(arbeitTakt); clearInterval(uhrTakt);
  band.stoppen();
  $('#pegel').style.width = '0%';
  knoepfe(); wachHalten(false);

  // Der Rest, der noch nicht erkannt wurde
  if (band.sekunden - erkanntBis > 0.6) {
    stand('Letztes Stueck wird erkannt ...');
    erkenntGerade = true;
    try { await blockErkennen(erkanntBis, band.sekunden); }
    catch (f) { notiere('Letzter Block: ' + f.message); }
    erkanntBis = band.sekunden;
    erkenntGerade = false;
    zeichnen();
  }

  stand('Beendet.');
  knoepfe();

  if ($('#stimmenAn').checked) await sprecherBestimmen();
  else melde('Aufnahme beendet.');
});

/* --------------------------- Datei --------------------------- */

const ablegeFeld = $('#ablegeFeld');
$('#ablegeFeld').addEventListener('click', () => $('#dateiWahl').click());
$('#dateiWahl').addEventListener('change', (e) => {
  if (e.target.files[0]) dateiVerarbeiten(e.target.files[0]);
  e.target.value = '';
});
['dragenter', 'dragover'].forEach((a) => ablegeFeld.addEventListener(a, (e) => {
  e.preventDefault(); ablegeFeld.classList.add('darueber');
}));
['dragleave', 'drop'].forEach((a) => ablegeFeld.addEventListener(a, (e) => {
  e.preventDefault(); ablegeFeld.classList.remove('darueber');
}));
ablegeFeld.addEventListener('drop', (e) => {
  if (e.dataTransfer.files[0]) dateiVerarbeiten(e.dataTransfer.files[0]);
});

async function dateiVerarbeiten(datei) {
  if (laeuft) { melde('Erst die Aufnahme stoppen.', 'fehler'); return; }
  if (segmente.length && !confirm('Neues Transkript aus dieser Datei? '
      + 'Ungespeichertes ist dann weg.')) return;

  neuAnfangen(false);
  if (!$('#titel').value.trim()) {
    $('#titel').value = datei.name.replace(/\.[^.]+$/, '');
  }

  try {
    stand(`"${datei.name}" wird eingelesen ...`);
    band = await dateiLesen(datei);
    stand(`${zeit(band.sekunden)} Ton eingelesen.`);
    $('#uhr').textContent = zeit(band.sekunden);

    await Motor.textErkennerLaden($('#modellGroesse').value);

    // Blockweise, damit ein Aussetzer nie den Rest kostet
    const gesamt = band.sekunden;
    let von = 0;
    erkenntGerade = true;
    knoepfe();

    while (von < gesamt) {
      const bis = Math.min(gesamt, von + BLOCK_SEKUNDEN);
      stand(`Text wird erkannt ... ${zeit(von)} von ${zeit(gesamt)}`);
      try { await blockErkennen(von, bis); }
      catch (f) { notiere(`Block bei ${zeit(von)} ging schief: ${f.message}`); }
      von = bis;
      zeichnen();
    }
    erkanntBis = gesamt;
    erkenntGerade = false;
    knoepfe();

    if ($('#stimmenAn').checked) await sprecherBestimmen();
    else melde('Fertig.');
  } catch (f) {
    erkenntGerade = false; knoepfe();
    melde('Datei ging nicht: ' + f.message, 'fehler');
    stand('Bereit.');
  }
}

/* --------------------------- Stimmen --------------------------- */

async function sprecherBestimmen() {
  if (!band.anzahl) { melde('Es gibt keinen Ton zum Auswerten.', 'fehler'); return; }
  if (!segmente.length) { melde('Es gibt noch kein Transkript.', 'fehler'); return; }

  erkenntGerade = true; knoepfe();
  try {
    const ton = band.alsFloat();

    sprecherAbschnitte = await Motor.sprecherFinden(ton, {
      schwelle: parseFloat($('#aehnlichkeit').value),
      anzahl: parseInt($('#anzahlPersonen').value, 10) || 0,
    });

    const nurText = segmente.filter((s) => !s.geraeusch);
    Motor.personenZuordnen(nurText, sprecherAbschnitte);

    geraeusche = [];
    if ($('#toeneAn').checked) {
      const r = await Motor.geraeuscheFinden(ton, sprecherAbschnitte,
        { schwelle: parseFloat($('#tonSchwelle').value) });
      geraeusche = r.geraeusche;
    }

    segmente = Motor.zusammenfuehren(nurText, geraeusche, $('#musikWeglassen').checked);
    personenBestimmt = true;
    letzteAbsaetze = [];
    zeichnen();

    const anzahl = new Set(sprecherAbschnitte.map((a) => a.person)).size;
    stand(`Fertig: ${anzahl} Personen, ${geraeusche.length} Geraeusche.`);
    melde(`Fertig: ${anzahl} ${anzahl === 1 ? 'Person' : 'Personen'} erkannt.`);
  } catch (f) {
    melde('Stimmenerkennung ging schief: ' + f.message, 'fehler');
    notiere('Stimmen: ' + f.message);
  } finally {
    erkenntGerade = false; knoepfe();
  }
}

$('#knopfSprecher').addEventListener('click', sprecherBestimmen);

/* --------------------------- Orion --------------------------- */

const listeZuText = (l) => l.join('\n');
const karteZuText = (k) => Object.keys(k).map((x) => x + ' = ' + k[x]).join('\n');
const textZuListe = (t) => t.split('\n').map((z) => z.trim())
  .filter((z) => z && !z.startsWith('#'));
function textZuKarte(t) {
  const k = {};
  for (const zeile of t.split('\n')) {
    const s = zeile.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const teile = s.split('=');
    const falsch = teile.shift().trim().toLowerCase();
    const richtig = teile.join('=').trim();
    if (falsch && richtig) k[falsch] = richtig;
  }
  return k;
}

function begriffeZeigen() {
  $('#feldBegriffe').value = listeZuText(orion.begriffe);
  $('#feldKorrekturen').value = karteZuText(orion.korrekturen);
  $('#zahlBegriffe').textContent = orion.begriffe.length;
  $('#zahlKorrekturen').textContent = Object.keys(orion.korrekturen).length;
}

$('#knopfBegriffeSpeichern').addEventListener('click', () => {
  const b = $('#feldBegriffe').value, k = $('#feldKorrekturen').value;
  localStorage.setItem(SPEICHER.begriffe, b);
  localStorage.setItem(SPEICHER.korrekturen, k);
  orion = new Orion(textZuListe(b), textZuKarte(k));
  begriffeZeigen();
  melde(`Gespeichert: ${orion.begriffe.length} Begriffe.`);
});

$('#knopfBegriffeZurueck').addEventListener('click', () => {
  if (!confirm('Eigene Begriffe verwerfen und den Standard laden?')) return;
  localStorage.removeItem(SPEICHER.begriffe);
  localStorage.removeItem(SPEICHER.korrekturen);
  orion = new Orion(ORION_BEGRIFFE, ORION_KORREKTUREN);
  begriffeZeigen();
  melde('Standard wiederhergestellt.');
});

$('#orionSchalter').addEventListener('change', (e) => {
  localStorage.setItem(SPEICHER.orion, e.target.checked ? 'true' : 'false');
  document.body.classList.toggle('orionAus', !e.target.checked);
  melde(e.target.checked ? 'Orion-Funktion an.' : 'Orion-Funktion aus.');
});

/* --------------------------- Einstellungen merken --------------------------- */

const MERKEN = {
  modellGroesse: SPEICHER.modell, sprache: SPEICHER.sprache,
  zeitstempel: SPEICHER.zeitstempel, empfindlichkeit: SPEICHER.empf,
  stimmenAn: SPEICHER.stimmen, anzahlPersonen: SPEICHER.anzahl,
  aehnlichkeit: SPEICHER.aehnlich, toeneAn: SPEICHER.toene,
  musikWeglassen: SPEICHER.musik, tonSchwelle: SPEICHER.tonSchwelle,
};

Object.keys(MERKEN).forEach((id) => {
  const feld = $('#' + id);
  feld.addEventListener('change', () => {
    localStorage.setItem(MERKEN[id],
      feld.type === 'checkbox' ? String(feld.checked) : feld.value);
  });
});

[['empfindlichkeit', '#empfindlichkeitText', (v) => v],
 ['aehnlichkeit', '#aehnlichkeitText', (v) => Number(v).toFixed(2)],
 ['tonSchwelle', '#tonSchwelleText', (v) => Number(v).toFixed(2)]]
.forEach(([id, ziel, zeigen]) => {
  $('#' + id).addEventListener('input', (e) => {
    $(ziel).textContent = zeigen(e.target.value);
  });
});

/* --------------------------- Herunterladen --------------------------- */

function dateiname(endung) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stempel = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `_${p(d.getHours())}-${p(d.getMinutes())}`;
  const t = ($('#titel').value.trim() || 'Transkript')
    .replace(/[^\wäöüÄÖÜß \-]/g, '').replace(/\s+/g, '_').slice(0, 50);
  return `${stempel}_${t}.${endung}`;
}

function herunterladen(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function auswahl() {
  return absaetzeBauen().filter((a) =>
    a.geraeusch || !a.person || !abgewaehlt.has(a.person));
}

function kopfzeilen(absaetze) {
  const woerter = absaetze.filter((a) => !a.geraeusch)
    .reduce((n, a) => n + a.text.split(/\s+/).filter(Boolean).length, 0);
  const leute = personenListe(absaetze);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const zeilen = [
    `Erstellt: ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} `
      + `um ${p(d.getHours())}:${p(d.getMinutes())} Uhr`,
    `Laenge: ${zeit(band.sekunden)}`,
    `Woerter: ${woerter}`,
    `Absaetze: ${absaetze.length}`,
  ];
  if (leute.length) zeilen.push('Personen: '
    + leute.map((p2) => nameVon(p2.person)).join(', '));
  zeilen.push(`Orion-Funktion: ${$('#orionSchalter').checked
    ? 'eingeschaltet' : 'ausgeschaltet'}`);
  return zeilen;
}

$$('[data-format]').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    const absaetze = auswahl();
    if (!absaetze.length) { melde('Mit dieser Auswahl bleibt nichts uebrig.', 'fehler'); return; }

    const titel = $('#titel').value.trim() || 'Transkript';
    const kopf = kopfzeilen(absaetze);
    const mitZeit = $('#zeitstempel').checked;
    const format = knopf.dataset.format;

    try {
      if (format === 'txt') {
        const zeilen = [titel, '='.repeat(titel.length), '', ...kopf, '',
                        '-'.repeat(60), ''];
        absaetze.forEach((a) => {
          const k = [];
          if (mitZeit) k.push(`[${zeit(a.start)}]`);
          if (!a.geraeusch && a.person) k.push(nameVon(a.person) + ':');
          if (k.length) zeilen.push(k.join(' '));
          zeilen.push(a.text, '');
        });
        herunterladen(new Blob([zeilen.join('\n')],
          { type: 'text/plain;charset=utf-8' }), dateiname('txt'));

      } else if (format === 'doc') {
        const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
          + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
          + 'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">'
          + `<title>${entschaerfe(titel)}</title></head><body>`
          + `<h1 style="font-family:Calibri">${entschaerfe(titel)}</h1>`
          + kopf.map((z) => `<p style="font-family:Calibri;font-size:9pt;color:#666;`
              + `margin:0">${entschaerfe(z)}</p>`).join('')
          + '<hr>'
          + absaetze.map((a) => {
              const marke = (!a.geraeusch && a.person)
                ? `<p style="font-family:Calibri;font-size:9.5pt;font-weight:bold;`
                  + `color:${farbeVon(a.person)};margin:0">${entschaerfe(nameVon(a.person))}`
                  + (mitZeit ? ` <span style="color:#999;font-weight:normal">${zeit(a.start)}</span>` : '')
                  + '</p>'
                : (mitZeit ? `<p style="font-size:9pt;color:#999;margin:0">${zeit(a.start)}</p>` : '');
              const stil = a.geraeusch
                ? 'font-family:Calibri;font-size:11pt;font-style:italic;color:#777'
                : 'font-family:Calibri;font-size:11pt;line-height:1.5';
              return marke + `<p style="${stil}">${entschaerfe(a.text)}</p>`;
            }).join('')
          + '</body></html>';
        herunterladen(new Blob(['﻿' + html], { type: 'application/msword' }),
                      dateiname('doc'));

      } else {
        const fuerPdf = absaetze.map((a) => ({
          text: a.text,
          zeit: zeit(a.start),
          person: (!a.geraeusch && a.person) ? nameVon(a.person) : '',
          farbe: farbeVon(a.person),
          geraeusch: a.geraeusch,
        }));
        herunterladen(pdfErzeugen(titel, kopf, fuerPdf, mitZeit), dateiname('pdf'));
      }
      melde('Datei wurde heruntergeladen.');
    } catch (f) {
      melde('Beim Schreiben ging etwas schief: ' + f.message, 'fehler');
    }
  });
});

$('#knopfKopieren').addEventListener('click', async () => {
  const text = auswahl().map((a) =>
    (!a.geraeusch && a.person ? nameVon(a.person) + ': ' : '') + a.text).join('\n\n');
  if (!text) { melde('Nichts zum Kopieren da.', 'fehler'); return; }
  try { await navigator.clipboard.writeText(text); melde('Kopiert.'); }
  catch (f) { melde('Kopieren hat der Browser blockiert.', 'fehler'); }
});

$('#knopfTon').addEventListener('click', () => {
  if (!band.anzahl) { melde('Es gibt keinen Ton.', 'fehler'); return; }
  herunterladen(alsWav(band.alsInt16()), dateiname('wav'));
  melde('Tonaufnahme heruntergeladen.');
});

/* --------------------------- Ablage --------------------------- */

function neuAnfangen(fragen = true) {
  if (fragen && segmente.length
      && !confirm('Neues Transkript? Ungespeichertes ist dann weg.')) return false;
  band.abspielenStoppen();
  if (band.laeuft) band.stoppen();
  band = new Tonband();
  segmente = []; sprecherAbschnitte = []; geraeusche = [];
  namen = {}; kennung = null; personenBestimmt = false;
  erkanntBis = 0; abgewaehlt.clear(); letzteAbsaetze = [];
  $('#titel').value = ''; $('#uhr').textContent = '00:00';
  zeichnen(); knoepfe();
  return true;
}

async function ablageSpeichern(still = false) {
  if (!segmente.length) {
    if (!still) melde('Es gibt nichts zu speichern.', 'fehler');
    return;
  }
  try {
    kennung = await Ablage.speichern({
      kennung, titel: $('#titel').value.trim() || 'Ohne Titel',
      segmente, dauer: band.sekunden, namen,
      ton: band.anzahl ? band.alsInt16() : null,
      personenBestimmt, quelle: 'Browser',
    });
    if (!still) { melde('In der Ablage gespeichert.'); ablageZeigen(); }
  } catch (f) {
    melde('Speichern ging nicht: ' + f.message, 'fehler');
  }
}

$('#knopfAblageSpeichern').addEventListener('click', () => ablageSpeichern(false));
$('#knopfNeu').addEventListener('click', () => {
  if (neuAnfangen(true)) melde('Neues Transkript begonnen.');
});
$('#knopfLeeren').addEventListener('click', () => {
  if (neuAnfangen(true)) melde('Geleert.');
});

async function ablageZeigen() {
  const kasten = $('#ablageListe');
  let eintraege = [];
  try { eintraege = await Ablage.liste(); }
  catch (f) { kasten.innerHTML = '<p class="leer">Ablage nicht lesbar.</p>'; return; }

  const p = await Ablage.platz();
  $('#platzStand').textContent = p
    ? `Belegt: ${(p.benutzt / 1048576).toFixed(0)} MB`
      + `, frei: ${(p.frei / 1073741824).toFixed(1)} GB`
    : '';

  if (!eintraege.length) {
    kasten.innerHTML = '<p class="leer">Noch nichts gespeichert.</p>';
    return;
  }

  kasten.innerHTML = eintraege.map((e) => `
    <div class="ablageZeile">
      <button class="ablageOeffnen" data-oeffnen="${e.kennung}">
        <span class="ablageName">${entschaerfe(e.titel)}</span>
        <span class="ablageInfo">${zeit(e.dauer)} &middot; ${e.woerter} Woerter`
          + (e.personen ? ` &middot; ${e.personen} Personen` : '')
          + (e.hatTon ? ` &middot; Ton ${(e.groesse / 1048576).toFixed(0)} MB` : '')
          + `</span>
      </button>
      <button class="wegKnopf" data-loeschen="${e.kennung}" title="Loeschen">&times;</button>
    </div>`).join('');

  $$('[data-oeffnen]').forEach((k) => k.addEventListener('click', async () => {
    try {
      const e = await Ablage.laden(k.dataset.oeffnen);
      if (!e) { melde('Nicht gefunden.', 'fehler'); return; }
      band.abspielenStoppen();
      band = e.ton ? Tonband.ausInt16(e.ton) : new Tonband();
      segmente = e.segmente || [];
      namen = e.namen || {};
      kennung = e.kennung;
      personenBestimmt = !!e.personenBestimmt;
      erkanntBis = band.sekunden;
      abgewaehlt.clear(); letzteAbsaetze = [];
      $('#titel').value = e.titel || '';
      $('#uhr').textContent = zeit(band.sekunden);
      zeichnen(); knoepfe();
      melde('Transkript geoeffnet.');
    } catch (f) { melde('Oeffnen ging nicht: ' + f.message, 'fehler'); }
  }));

  $$('[data-loeschen]').forEach((k) => k.addEventListener('click', async () => {
    if (!confirm('Dieses Transkript wirklich loeschen?')) return;
    await Ablage.loeschen(k.dataset.loeschen);
    if (kennung === k.dataset.loeschen) kennung = null;
    ablageZeigen();
    melde('Geloescht.');
  }));
}

/* --------------------------- Start --------------------------- */

(function start() {
  const b = localStorage.getItem(SPEICHER.begriffe);
  const k = localStorage.getItem(SPEICHER.korrekturen);
  if (b || k) {
    orion = new Orion(b ? textZuListe(b) : ORION_BEGRIFFE,
                      k ? textZuKarte(k) : ORION_KORREKTUREN);
  }
  begriffeZeigen();

  $('#orionSchalter').checked = einstJa('orion', true);
  document.body.classList.toggle('orionAus', !$('#orionSchalter').checked);
  $('#modellGroesse').value = einst('modell', 'mittel');
  $('#sprache').value = einst('sprache', 'de');
  $('#zeitstempel').checked = einstJa('zeitstempel', false);
  $('#empfindlichkeit').value = einst('empf', '4');
  $('#empfindlichkeitText').textContent = $('#empfindlichkeit').value;
  $('#stimmenAn').checked = einstJa('stimmen', true);
  $('#anzahlPersonen').value = einst('anzahl', '0');
  $('#aehnlichkeit').value = einst('aehnlich', '0.83');
  $('#aehnlichkeitText').textContent = Number($('#aehnlichkeit').value).toFixed(2);
  $('#toeneAn').checked = einstJa('toene', false);
  $('#musikWeglassen').checked = einstJa('musik', false);
  $('#tonSchwelle').value = einst('tonSchwelle', '0.3');
  $('#tonSchwelleText').textContent = Number($('#tonSchwelle').value).toFixed(2);

  zeichnen(); knoepfe(); ablageZeigen();

  const w = $('#warnung');
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') {
    w.hidden = false;
    w.innerHTML = '<strong>Diese Seite laeuft nicht ueber HTTPS.</strong> '
      + 'Ohne sichere Verbindung gibt der Browser das Mikrofon nicht frei.';
  } else if (!navigator.mediaDevices || !window.AudioWorkletNode) {
    w.hidden = false;
    w.innerHTML = '<strong>Dieser Browser kann keine Tonaufnahme.</strong> '
      + 'Nimm Chrome oder Edge, am Handy Chrome.';
  }

  window.addEventListener('beforeunload', (e) => {
    if (laeuft || (segmente.length && !kennung)) { e.preventDefault(); e.returnValue = ''; }
  });
})();
