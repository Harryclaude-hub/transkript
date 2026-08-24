/* ------------------------------------------------------------------
   Transkript - Funktion.
   Diese Datei steuert, WAS passiert. Wie es aussieht, steht in stil.css.
   ------------------------------------------------------------------ */

const $ = (auswahl) => document.querySelector(auswahl);
const $$ = (auswahl) => Array.from(document.querySelectorAll(auswahl));

let einstellungen = {};
let liveLaeuft = false;
let eingabeAktiv = false;   // damit Tippen im Textfeld nicht ueberschrieben wird

/* --------------------------- Hilfen --------------------------- */

async function hole(pfad, optionen) {
  const antwort = await fetch(pfad, optionen);
  return antwort.json();
}

async function sende(pfad, daten) {
  return hole(pfad, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(daten || {}),
  });
}

let meldungsUhr = null;
function melde(text, art) {
  const kasten = $('#meldung');
  kasten.textContent = text;
  kasten.className = 'meldung sichtbar' + (art ? ' ' + art : '');
  clearTimeout(meldungsUhr);
  meldungsUhr = setTimeout(() => { kasten.className = 'meldung'; }, 4200);
}

function zeit(sekunden) {
  sekunden = Math.floor(sekunden || 0);
  const s = String(sekunden % 60).padStart(2, '0');
  const m = String(Math.floor(sekunden / 60) % 60).padStart(2, '0');
  const h = Math.floor(sekunden / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/* --------------------------- Reiter --------------------------- */

$$('.reiterKnopf').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    $$('.reiterKnopf').forEach((k) => k.classList.remove('aktiv'));
    $$('.tafel').forEach((t) => t.classList.remove('aktiv'));
    knopf.classList.add('aktiv');
    $('#' + knopf.dataset.ziel).classList.add('aktiv');
    if (knopf.dataset.ziel === 'tafelAblage') ablageLaden();
    if (knopf.dataset.ziel === 'tafelOrion') begriffeLaden();
  });
});

/* ------------------- Orion-Schalter + Einstellungen ------------------- */

$('#orionSchalter').addEventListener('change', async (ereignis) => {
  const an = ereignis.target.checked;
  await sende('/api/einstellungen', { orion_an: an });
  document.body.classList.toggle('orionAus', !an);
  melde(an
    ? 'Orion-Funktion eingeschaltet. Fachbegriffe werden beruecksichtigt.'
    : 'Orion-Funktion ausgeschaltet. Ganz normale Transkription.');
});

['modellLive', 'modellDatei', 'sprache', 'zeitstempel'].forEach((kennung) => {
  $('#' + kennung).addEventListener('change', async (ereignis) => {
    const ziel = ereignis.target;
    const schluessel = {
      modellLive: 'modell_live', modellDatei: 'modell_datei',
      sprache: 'sprache', zeitstempel: 'zeitstempel',
    }[kennung];
    const wert = ziel.type === 'checkbox' ? ziel.checked : ziel.value;
    await sende('/api/einstellungen', { [schluessel]: wert });
    melde('Gespeichert.');
  });
});

/* --------------------------- Geraete --------------------------- */

async function geraeteLaden() {
  const daten = await hole('/api/geraete');
  const wahl = $('#geraetWahl');
  wahl.innerHTML = '';

  if (daten.fehler || !daten.geraete.length) {
    wahl.innerHTML = '<option value="">Kein Mikrofon gefunden</option>';
    if (daten.fehler) melde(daten.fehler, 'fehler');
    return;
  }

  daten.geraete.forEach((g) => {
    const eintrag = document.createElement('option');
    eintrag.value = g.id;
    eintrag.textContent = g.name + (g.standard ? '  (Standard)' : '');
    if (g.standard) eintrag.selected = true;
    wahl.appendChild(eintrag);
  });
}

/* --------------------------- Live --------------------------- */

$('#knopfStart').addEventListener('click', async () => {
  const geraet = $('#geraetWahl').value;
  if (!geraet) { melde('Bitte erst eine Aufnahmequelle waehlen.', 'fehler'); return; }

  $('#knopfStart').disabled = true;
  const antwort = await sende('/api/live/start', {
    geraet, titel: $('#liveTitel').value.trim(),
  });

  if (!antwort.ok) {
    $('#knopfStart').disabled = false;
    melde(antwort.fehler, 'fehler');
    return;
  }
  melde('Aufnahme laeuft. Du kannst das Fenster jetzt zuklappen.');
});

$('#knopfPause').addEventListener('click', async () => {
  const antwort = await sende('/api/live/pause');
  if (antwort.ok) {
    $('#knopfPause').textContent = antwort.pausiert ? 'Weiter' : 'Pause';
  }
});

$('#knopfStopp').addEventListener('click', async () => {
  $('#knopfStopp').disabled = true;
  melde('Wird beendet, der letzte Block wird noch erkannt ...');
  const antwort = await sende('/api/live/stopp');
  if (!antwort.ok) melde(antwort.fehler, 'fehler');
  else melde('Aufnahme beendet. Jetzt speichern nicht vergessen.');
});

/* --------------------------- Dateien --------------------------- */

const ablegeFeld = $('#ablegeFeld');
const dateiWahl = $('#dateiWahl');

ablegeFeld.addEventListener('click', () => dateiWahl.click());
dateiWahl.addEventListener('change', () => dateienSchicken(dateiWahl.files));

['dragenter', 'dragover'].forEach((art) =>
  ablegeFeld.addEventListener(art, (e) => {
    e.preventDefault(); ablegeFeld.classList.add('darueber');
  }));
['dragleave', 'drop'].forEach((art) =>
  ablegeFeld.addEventListener(art, (e) => {
    e.preventDefault(); ablegeFeld.classList.remove('darueber');
  }));
ablegeFeld.addEventListener('drop', (e) => dateienSchicken(e.dataTransfer.files));

async function dateienSchicken(dateien) {
  for (const datei of Array.from(dateien || [])) {
    const paket = new FormData();
    paket.append('datei', datei);
    paket.append('titel', datei.name.replace(/\.[^.]+$/, ''));

    melde(`"${datei.name}" wird hochgeladen ...`);
    try {
      const antwort = await hole('/api/datei', { method: 'POST', body: paket });
      if (!antwort.ok) melde(antwort.fehler, 'fehler');
      else melde(`"${datei.name}" ist dran. Lange Dateien brauchen Geduld.`);
    } catch (fehler) {
      melde('Hochladen fehlgeschlagen: ' + fehler.message, 'fehler');
    }
  }
  dateiWahl.value = '';
}

function auftraegeZeichnen(auftraege) {
  const kasten = $('#auftragsListe');
  if (!auftraege.length) { kasten.innerHTML = ''; return; }

  kasten.innerHTML = auftraege.map((a) => `
    <div class="auftrag ${a.stand}">
      <div class="auftragKopf">
        <strong>${entschaerfe(a.name)}</strong>
        <button class="wegKnopf" data-weg="${a.id}">&times;</button>
      </div>
      <div class="auftragText">${entschaerfe(a.text)}</div>
    </div>`).join('');

  $$('[data-weg]').forEach((knopf) => {
    knopf.addEventListener('click', async () => {
      await fetch('/api/auftrag/' + knopf.dataset.weg, { method: 'DELETE' });
    });
  });
}

function entschaerfe(text) {
  const hilfe = document.createElement('div');
  hilfe.textContent = text == null ? '' : String(text);
  return hilfe.innerHTML;
}

/* --------------------------- Orion-Begriffe --------------------------- */

async function begriffeLaden() {
  if (eingabeAktiv) return;
  const daten = await hole('/api/begriffe');
  $('#feldBegriffe').value = daten.begriffe;
  $('#feldKorrekturen').value = daten.korrekturen;
  $('#zahlBegriffe').textContent = daten.anzahl_begriffe;
  $('#zahlKorrekturen').textContent = daten.anzahl_korrekturen;
}

['feldBegriffe', 'feldKorrekturen'].forEach((kennung) => {
  $('#' + kennung).addEventListener('focus', () => { eingabeAktiv = true; });
  $('#' + kennung).addEventListener('blur', () => { eingabeAktiv = false; });
});

$('#knopfBegriffeSpeichern').addEventListener('click', async () => {
  const antwort = await sende('/api/begriffe', {
    begriffe: $('#feldBegriffe').value,
    korrekturen: $('#feldKorrekturen').value,
  });
  if (antwort.ok) {
    $('#zahlBegriffe').textContent = antwort.begriffe;
    $('#zahlKorrekturen').textContent = antwort.korrekturen;
    melde(`Gespeichert: ${antwort.begriffe} Begriffe, ${antwort.korrekturen} Korrekturen.`);
  }
});

/* --------------------------- Speichern --------------------------- */

$$('[data-format]').forEach((knopf) => {
  knopf.addEventListener('click', async () => {
    const format = knopf.dataset.format;
    knopf.disabled = true;
    melde('Wird geschrieben ...');
    const antwort = await sende('/api/speichern', {
      format, titel: $('#liveTitel').value.trim() || undefined,
    });
    knopf.disabled = false;

    if (!antwort.ok) { melde(antwort.fehler, 'fehler'); return; }
    melde('Fertig: ' + antwort.name);

    const link = document.createElement('a');
    link.href = antwort.link;
    link.download = antwort.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    ablageLaden();
  });
});

$('#knopfKopieren').addEventListener('click', async () => {
  const text = $$('#transkript .absatz p').map((p) => p.textContent).join('\n\n');
  if (!text) { melde('Nichts zum Kopieren da.', 'fehler'); return; }
  try {
    await navigator.clipboard.writeText(text);
    melde('In die Zwischenablage kopiert.');
  } catch (fehler) {
    melde('Kopieren hat der Browser blockiert.', 'fehler');
  }
});

$('#knopfLeeren').addEventListener('click', async () => {
  if (!confirm('Transkript wirklich leeren? Ungespeichertes ist dann weg.')) return;
  await sende('/api/leeren');
  melde('Geleert.');
});

/* --------------------------- Ablage --------------------------- */

async function ablageLaden() {
  const daten = await hole('/api/ergebnisse');
  const kasten = $('#ablageListe');

  if (!daten.dateien.length) {
    kasten.innerHTML = '<p class="leer">Noch nichts gespeichert.</p>';
    return;
  }
  kasten.innerHTML = daten.dateien.map((d) => `
    <a class="ablageZeile" href="${d.link}" download>
      <span class="ablageName">${entschaerfe(d.name)}</span>
      <span class="ablageInfo">${d.wann} &middot; ${d.groesse} KB</span>
    </a>`).join('');
}

$('#knopfOrdner').addEventListener('click', async () => {
  const antwort = await sende('/api/ordner-oeffnen');
  if (!antwort.ok) melde('Ordner laesst sich nur am Laptop oeffnen.', 'fehler');
});

/* --------------------------- Dauerabfrage --------------------------- */

function transkriptZeichnen(t) {
  const kasten = $('#transkript');

  if (!t.absaetze.length) {
    kasten.innerHTML = '<p class="leer">Noch nichts aufgenommen. '
      + 'Starte oben eine Aufnahme oder lege eine Audiodatei ab.</p>';
    $('#transkriptZahlen').textContent = 'noch leer';
    return;
  }

  const unten = kasten.scrollHeight - kasten.scrollTop - kasten.clientHeight < 60;

  kasten.innerHTML = t.absaetze.map((a) => `
    <div class="absatz">
      <span class="absatzZeit">${zeit(a.start)}</span>
      <p>${entschaerfe(a.text)}</p>
    </div>`).join('');

  if (unten) kasten.scrollTop = kasten.scrollHeight;

  let zeile = `${t.woerter} Woerter &middot; ${t.absaetze.length} Absaetze `
            + `&middot; ${zeit(t.dauer)}`;
  if (t.korrekturen > 0) zeile += ` &middot; ${t.korrekturen}x Orion korrigiert`;
  $('#transkriptZahlen').innerHTML = zeile;
}

function einstellungenAnzeigen(e) {
  einstellungen = e;
  $('#orionSchalter').checked = !!e.orion_an;
  document.body.classList.toggle('orionAus', !e.orion_an);
  $('#modellLive').value = e.modell_live;
  $('#modellDatei').value = e.modell_datei;
  $('#sprache').value = e.sprache;
  $('#zeitstempel').checked = !!e.zeitstempel;
}

let ersterDurchlauf = true;

async function abfragen() {
  let daten;
  try {
    daten = await hole('/api/zustand');
  } catch (fehler) {
    $('#liveStand').textContent = 'Keine Verbindung zum Programm. '
      + 'Laeuft das schwarze Fenster noch?';
    return;
  }

  if (ersterDurchlauf) { einstellungenAnzeigen(daten.einstellungen); ersterDurchlauf = false; }

  const l = daten.live;
  liveLaeuft = l.laeuft;

  $('#knopfStart').disabled = l.laeuft;
  $('#knopfPause').disabled = !l.laeuft;
  $('#knopfStopp').disabled = !l.laeuft;
  $('#geraetWahl').disabled = l.laeuft;
  document.body.classList.toggle('nimmtAuf', l.laeuft);
  $('#pegel').style.width = (l.laeuft ? l.pegel * 100 : 0) + '%';

  if (l.fehler) {
    $('#liveStand').textContent = 'Fehler: ' + l.fehler;
  } else if (l.laeuft) {
    const rueckstand = Math.max(0, l.aufgenommen - l.erkannt);
    $('#liveStand').textContent =
      `Laeuft seit ${zeit(l.aufgenommen)}. Erkannt bis ${zeit(l.erkannt)}`
      + (rueckstand > 3 ? ` (${Math.round(rueckstand)}s Rueckstand, normal).` : '.');
  } else {
    $('#liveStand').textContent = 'Bereit.';
    $('#knopfPause').textContent = 'Pause';
  }

  transkriptZeichnen(daten.transkript);
  auftraegeZeichnen(daten.auftraege);
  $('#protokoll').textContent = daten.protokoll.join('\n');
}

/* --------------------------- Start --------------------------- */

geraeteLaden();
begriffeLaden();
ablageLaden();
abfragen();
setInterval(abfragen, 1500);

window.addEventListener('beforeunload', (e) => {
  if (liveLaeuft) {
    e.preventDefault();
    e.returnValue = 'Die Aufnahme laeuft im Hintergrund weiter.';
  }
});
