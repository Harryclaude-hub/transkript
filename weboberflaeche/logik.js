/* ------------------------------------------------------------------
   Transkript - Funktion.
   Diese Datei steuert, WAS passiert. Wie es aussieht, steht in stil.css.
   ------------------------------------------------------------------ */

const $ = (a) => document.querySelector(a);
const $$ = (a) => Array.from(document.querySelectorAll(a));

let einstellungen = {};
let liveLaeuft = false;
let eingabeAktiv = false;
let abgewaehlt = new Set();     // Personen, die NICHT mit heruntergeladen werden
let letzteAbsaetze = [];
let aktuellerTon = '';
let spielStopp = null;          // Zeitpunkt, an dem das Abspielen enden soll
let laufendeZeile = null;

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
  meldungsUhr = setTimeout(() => { kasten.className = 'meldung'; }, 4600);
}

function zeit(sekunden) {
  sekunden = Math.floor(sekunden || 0);
  const s = String(sekunden % 60).padStart(2, '0');
  const m = String(Math.floor(sekunden / 60) % 60).padStart(2, '0');
  const h = Math.floor(sekunden / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function entschaerfe(text) {
  const h = document.createElement('div');
  h.textContent = text == null ? '' : String(text);
  return h.innerHTML;
}

/* --------------------------- Reiter --------------------------- */

$$('.reiterKnopf').forEach((knopf) => {
  knopf.addEventListener('click', () => {
    $$('.reiterKnopf').forEach((k) => k.classList.remove('aktiv'));
    $$('.tafel').forEach((t) => t.classList.remove('aktiv'));
    knopf.classList.add('aktiv');
    $('#' + knopf.dataset.ziel).classList.add('aktiv');
    if (knopf.dataset.ziel === 'tafelAblage') { ablageLaden(); dateienLaden(); }
    if (knopf.dataset.ziel === 'tafelOrion') begriffeLaden();
  });
});

/* --------------------------- Einstellungen --------------------------- */

$('#orionSchalter').addEventListener('change', async (e) => {
  const an = e.target.checked;
  await sende('/api/einstellungen', { orion_an: an });
  document.body.classList.toggle('orionAus', !an);
  melde(an ? 'Orion-Funktion eingeschaltet.' : 'Orion-Funktion ausgeschaltet.');
});

const EINFACHE_FELDER = {
  modellLive: 'modell_live', modellDatei: 'modell_datei',
  sprache: 'sprache', zeitstempel: 'zeitstempel',
  stimmenAn: 'stimmen_an', anzahlPersonen: 'anzahl_personen',
  toeneAn: 'toene_an', musikWeglassen: 'musik_weglassen',
};

Object.keys(EINFACHE_FELDER).forEach((kennung) => {
  $('#' + kennung).addEventListener('change', async (e) => {
    const ziel = e.target;
    let wert = ziel.type === 'checkbox' ? ziel.checked : ziel.value;
    if (kennung === 'anzahlPersonen') wert = parseInt(wert, 10);
    await sende('/api/einstellungen', { [EINFACHE_FELDER[kennung]]: wert });
    melde('Gespeichert.');
  });
});

const SCHIEBER = {
  empfindlichkeit: { schluessel: 'empfindlichkeit', text: '#empfindlichkeitText',
                     zeigen: (v) => v, zahl: (v) => parseInt(v, 10) },
  aehnlichkeit: { schluessel: 'stimmen_aehnlichkeit', text: '#aehnlichkeitText',
                  zeigen: (v) => Number(v).toFixed(2), zahl: (v) => parseFloat(v) },
  tonSchwelle: { schluessel: 'ton_schwelle', text: '#tonSchwelleText',
                 zeigen: (v) => Number(v).toFixed(2), zahl: (v) => parseFloat(v) },
};

Object.keys(SCHIEBER).forEach((kennung) => {
  const feld = $('#' + kennung);
  const regel = SCHIEBER[kennung];

  feld.addEventListener('input', () => {
    $(regel.text).textContent = regel.zeigen(feld.value);
  });
  feld.addEventListener('change', async () => {
    await sende('/api/einstellungen', { [regel.schluessel]: regel.zahl(feld.value) });
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
  const antwort = await sende('/api/live/start',
    { geraet, titel: $('#liveTitel').value.trim() });

  if (!antwort.ok) {
    $('#knopfStart').disabled = false;
    melde(antwort.fehler, 'fehler');
    return;
  }
  melde('Aufnahme laeuft. Du kannst das Fenster jetzt zuklappen.');
});

$('#knopfPause').addEventListener('click', async () => {
  const antwort = await sende('/api/live/pause');
  if (antwort.ok) $('#knopfPause').textContent = antwort.pausiert ? 'Weiter' : 'Pause';
});

$('#knopfStopp').addEventListener('click', async () => {
  $('#knopfStopp').disabled = true;
  melde('Wird beendet, der letzte Block wird noch erkannt ...');
  const antwort = await sende('/api/live/stopp');
  if (!antwort.ok) { melde(antwort.fehler, 'fehler'); return; }
  melde(antwort.sprecher_laeuft
    ? 'Aufnahme beendet. Die Stimmen werden jetzt getrennt.'
    : 'Aufnahme beendet.');
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
      <div class="balken"><div style="width:${Math.round((a.anteil || 0) * 100)}%"></div></div>
    </div>`).join('');

  $$('[data-weg]').forEach((knopf) => {
    knopf.addEventListener('click', () =>
      fetch('/api/auftrag/' + knopf.dataset.weg, { method: 'DELETE' }));
  });
}

/* --------------------------- Stimmen bestimmen --------------------------- */

$('#knopfSprecher').addEventListener('click', async () => {
  const antwort = await sende('/api/sprecher');
  if (!antwort.ok) melde(antwort.fehler, 'fehler');
  else melde('Die Stimmen werden getrennt. Das dauert einen Moment.');
});

async function personUmbenennen(nummer, alterName) {
  const name = prompt(`Wie soll Person ${nummer} heissen?`, alterName || '');
  if (name === null) return;
  const antwort = await sende('/api/namen', { person: String(nummer), name });
  if (antwort.ok) melde(name.trim() ? `Heisst jetzt ${name.trim()}.` : 'Name entfernt.');
}

function personenZeichnen(personen) {
  const leiste = $('#personenLeiste');
  const echte = personen.filter((p) => p.person > 0);

  if (!echte.length) {
    leiste.innerHTML = '';
    $('#filterHinweis').textContent = '';
    return;
  }

  leiste.innerHTML = echte.map((p) => {
    const aus = abgewaehlt.has(p.person);
    return `
      <div class="personChip ${aus ? 'aus' : ''}" style="--farbe:${p.farbe}">
        <button class="chipWahl" data-person="${p.person}"
                title="Beim Herunterladen mitnehmen oder weglassen">
          <span class="chipPunkt"></span>
          <span class="chipName">${entschaerfe(p.name)}</span>
          <span class="chipZahl">${zeit(p.sekunden)}</span>
        </button>
        <button class="chipStift" data-umbenennen="${p.person}"
                data-name="${entschaerfe(p.name)}" title="Umbenennen">&#9998;</button>
      </div>`;
  }).join('');

  $$('[data-person]').forEach((knopf) => {
    knopf.addEventListener('click', () => {
      const nummer = parseInt(knopf.dataset.person, 10);
      if (abgewaehlt.has(nummer)) abgewaehlt.delete(nummer);
      else abgewaehlt.add(nummer);
      personenZeichnen(personen);
    });
  });
  $$('[data-umbenennen]').forEach((knopf) => {
    knopf.addEventListener('click', () =>
      personUmbenennen(parseInt(knopf.dataset.umbenennen, 10), knopf.dataset.name));
  });

  $('#filterHinweis').textContent = abgewaehlt.size
    ? 'Beim Herunterladen weggelassen: '
      + echte.filter((p) => abgewaehlt.has(p.person)).map((p) => p.name).join(', ')
    : '';
}

/* --------------------------- Abspielen --------------------------- */

const spieler = $('#spieler');

spieler.addEventListener('timeupdate', () => {
  if (spielStopp !== null && spieler.currentTime >= spielStopp) {
    spieler.pause();
    spielStopp = null;
    abspielenBeenden();
  }
});
spieler.addEventListener('ended', abspielenBeenden);
spieler.addEventListener('pause', abspielenBeenden);

function abspielenBeenden() {
  if (laufendeZeile) {
    laufendeZeile.classList.remove('spielt');
    laufendeZeile = null;
  }
}

function abspielen(zeile, von, bis) {
  if (!aktuellerTon) {
    melde('Zu diesem Transkript ist keine Tonspur da.', 'fehler');
    return;
  }

  // Nochmal auf dieselbe Zeile tippen heisst: anhalten.
  if (laufendeZeile === zeile) {
    spieler.pause();
    spielStopp = null;
    abspielenBeenden();
    return;
  }

  abspielenBeenden();

  const quelle = '/ton/' + encodeURIComponent(aktuellerTon);
  if (!spieler.src.endsWith(quelle)) {
    spieler.src = quelle;
    spieler.load();          // ohne das holt der Browser nicht einmal die Laenge
  }

  spielStopp = bis + 0.25;
  laufendeZeile = zeile;
  zeile.classList.add('spielt');

  const los = () => {
    try {
      spieler.currentTime = Math.max(0, von - 0.15);
    } catch (fehler) { /* Datei noch nicht weit genug geladen */ }

    const versuch = spieler.play();
    if (versuch && versuch.catch) {
      versuch.catch((fehler) => {
        melde('Abspielen geht nicht: ' + fehler.message, 'fehler');
        abspielenBeenden();
      });
    }
  };

  // readyState 1 heisst: die Laenge ist bekannt, springen ist moeglich.
  if (spieler.readyState >= 1) los();
  else spieler.addEventListener('loadedmetadata', los, { once: true });
}

/* --------------------------- Transkript --------------------------- */

function gleich(a, b) {
  return a.length === b.length && a.every((x, i) =>
    x.text === b[i].text && x.person === b[i].person && x.start === b[i].start);
}

function transkriptZeichnen(t) {
  const kasten = $('#transkript');
  aktuellerTon = t.ton || '';

  if (!t.absaetze.length) {
    if (letzteAbsaetze.length) {
      kasten.innerHTML = '<p class="leer">Noch nichts aufgenommen. '
        + 'Starte oben eine Aufnahme oder lege eine Audiodatei ab.</p>';
      letzteAbsaetze = [];
    }
    $('#transkriptZahlen').textContent = 'noch leer';
    return;
  }

  // Nur neu zeichnen, wenn sich wirklich etwas geaendert hat.
  // Sonst reisst es bei jeder Abfrage das Abspielen ab.
  if (!gleich(t.absaetze, letzteAbsaetze)) {
    const unten = kasten.scrollHeight - kasten.scrollTop - kasten.clientHeight < 60;
    const namen = {};
    t.personen.forEach((p) => { namen[p.person] = p; });

    kasten.innerHTML = t.absaetze.map((a, i) => {
      const p = namen[a.person];
      const farbe = p ? p.farbe : '#6b7280';
      const kopfTeile = [];

      if (!a.geraeusch && a.person > 0) {
        kopfTeile.push(`<span class="zeileName" style="color:${farbe}">`
          + `${entschaerfe(p ? p.name : 'Person ' + a.person)}</span>`);
      }
      kopfTeile.push(`<span class="zeileZeit">${zeit(a.start)}</span>`);
      kopfTeile.push(`<span class="zeileDauer">${a.dauer.toFixed(1)} s</span>`);

      return `
        <div class="absatz ${a.geraeusch ? 'geraeusch' : ''}"
             data-von="${a.start}" data-bis="${a.ende}" tabindex="0"
             style="--farbe:${farbe}"
             title="Antippen zum Anhoeren">
          <div class="zeileKopf">${kopfTeile.join('')}
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
    letzteAbsaetze = t.absaetze;
  }

  let zeile = `${t.woerter} Woerter &middot; ${t.absaetze.length} Absaetze `
            + `&middot; ${zeit(t.dauer)}`;
  const echte = t.personen.filter((p) => p.person > 0).length;
  if (echte) zeile += ` &middot; ${echte} ${echte === 1 ? 'Person' : 'Personen'}`;
  if (t.korrekturen > 0) zeile += ` &middot; ${t.korrekturen}x Orion`;
  $('#transkriptZahlen').innerHTML = zeile;
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

/* --------------------------- Herunterladen --------------------------- */

$$('[data-format]').forEach((knopf) => {
  knopf.addEventListener('click', async () => {
    knopf.disabled = true;
    melde('Wird geschrieben ...');

    const alle = letzteAbsaetze
      .filter((a) => !a.geraeusch && a.person > 0)
      .map((a) => a.person);
    const behalten = Array.from(new Set(alle)).filter((p) => !abgewaehlt.has(p));

    const antwort = await sende('/api/speichern', {
      format: knopf.dataset.format,
      titel: $('#liveTitel').value.trim() || undefined,
      personen: behalten.length ? behalten : undefined,
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
    dateienLaden();
  });
});

$('#knopfKopieren').addEventListener('click', async () => {
  const text = $$('#transkript .absatz p').map((p) => p.textContent).join('\n\n');
  if (!text) { melde('Nichts zum Kopieren da.', 'fehler'); return; }
  try {
    await navigator.clipboard.writeText(text);
    melde('In die Zwischenablage kopiert.');
  } catch (fehler) { melde('Kopieren hat der Browser blockiert.', 'fehler'); }
});

$('#knopfLeeren').addEventListener('click', async () => {
  if (!confirm('Transkript wirklich leeren? Ungespeichertes ist dann weg.')) return;
  await sende('/api/leeren');
  letzteAbsaetze = [];
  abgewaehlt.clear();
  melde('Geleert.');
});

/* --------------------------- Ablage --------------------------- */

$('#knopfAblageSpeichern').addEventListener('click', async () => {
  const antwort = await sende('/api/ablage/speichern',
    { titel: $('#liveTitel').value.trim() || undefined });
  if (!antwort.ok) { melde(antwort.fehler, 'fehler'); return; }
  melde('In der Ablage gespeichert.');
  ablageLaden();
});

$('#knopfNeu').addEventListener('click', async () => {
  if (letzteAbsaetze.length
      && !confirm('Neues Transkript beginnen? Ungespeichertes ist dann weg.')) return;
  await sende('/api/neu');
  letzteAbsaetze = [];
  abgewaehlt.clear();
  $('#liveTitel').value = '';
  melde('Neues Transkript begonnen.');
});

async function ablageLaden() {
  const daten = await hole('/api/ablage');
  const kasten = $('#ablageListe');

  if (!daten.transkripte.length) {
    kasten.innerHTML = '<p class="leer">Noch nichts gespeichert.</p>';
    return;
  }

  kasten.innerHTML = daten.transkripte.map((t) => `
    <div class="ablageZeile">
      <button class="ablageOeffnen" data-oeffnen="${t.kennung}">
        <span class="ablageName">${entschaerfe(t.titel)}</span>
        <span class="ablageInfo">${zeit(t.dauer)} &middot; ${t.woerter} Woerter`
          + (t.personen ? ` &middot; ${t.personen} Personen` : '')
          + (t.hat_ton ? ' &middot; mit Ton' : '') + `</span>
      </button>
      <button class="wegKnopf" data-loeschen="${t.kennung}"
              title="Loeschen">&times;</button>
    </div>`).join('');

  $$('[data-oeffnen]').forEach((knopf) => {
    knopf.addEventListener('click', async () => {
      const antwort = await sende('/api/ablage/oeffnen',
        { kennung: knopf.dataset.oeffnen });
      if (!antwort.ok) { melde(antwort.fehler, 'fehler'); return; }
      letzteAbsaetze = [];
      abgewaehlt.clear();
      melde('Transkript geoeffnet.');
    });
  });
  $$('[data-loeschen]').forEach((knopf) => {
    knopf.addEventListener('click', async () => {
      if (!confirm('Dieses Transkript wirklich loeschen?')) return;
      await fetch('/api/ablage/' + knopf.dataset.loeschen, { method: 'DELETE' });
      ablageLaden();
      melde('Geloescht.');
    });
  });
}

async function dateienLaden() {
  const daten = await hole('/api/ergebnisse');
  const kasten = $('#dateiListe');

  if (!daten.dateien.length) {
    kasten.innerHTML = '<p class="leer">Noch nichts heruntergeladen.</p>';
    return;
  }
  kasten.innerHTML = daten.dateien.map((d) => `
    <a class="ablageZeile schlicht" href="${d.link}" download>
      <span class="ablageName">${entschaerfe(d.name)}</span>
      <span class="ablageInfo">${d.wann} &middot; ${d.groesse} KB</span>
    </a>`).join('');
}

$('#knopfOrdner').addEventListener('click', async () => {
  const antwort = await sende('/api/ordner-oeffnen');
  if (!antwort.ok) melde('Ordner laesst sich nur am Laptop oeffnen.', 'fehler');
});

/* --------------------------- Dauerabfrage --------------------------- */

function einstellungenAnzeigen(e) {
  einstellungen = e;
  $('#orionSchalter').checked = !!e.orion_an;
  document.body.classList.toggle('orionAus', !e.orion_an);
  $('#modellLive').value = e.modell_live;
  $('#modellDatei').value = e.modell_datei;
  $('#sprache').value = e.sprache;
  $('#zeitstempel').checked = !!e.zeitstempel;

  $('#empfindlichkeit').value = e.empfindlichkeit;
  $('#empfindlichkeitText').textContent = e.empfindlichkeit;
  $('#stimmenAn').checked = !!e.stimmen_an;
  $('#anzahlPersonen').value = String(e.anzahl_personen || 0);
  $('#aehnlichkeit').value = e.stimmen_aehnlichkeit;
  $('#aehnlichkeitText').textContent = Number(e.stimmen_aehnlichkeit).toFixed(2);
  $('#toeneAn').checked = !!e.toene_an;
  $('#musikWeglassen').checked = !!e.musik_weglassen;
  $('#tonSchwelle').value = e.ton_schwelle;
  $('#tonSchwelleText').textContent = Number(e.ton_schwelle).toFixed(2);
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

  if (ersterDurchlauf) {
    einstellungenAnzeigen(daten.einstellungen);
    $('#stimmenFehlt').hidden = daten.koennen.stimmen;
    ersterDurchlauf = false;
  }

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

  if (!$('#liveTitel').matches(':focus') && daten.transkript.titel
      && !$('#liveTitel').value) {
    $('#liveTitel').value = daten.transkript.titel;
  }

  $('#knopfSprecher').disabled = !daten.transkript.ton
                                 || !daten.transkript.absaetze.length;

  transkriptZeichnen(daten.transkript);
  personenZeichnen(daten.transkript.personen);
  auftraegeZeichnen(daten.auftraege);
  $('#protokoll').textContent = daten.protokoll.join('\n');
}

/* --------------------------- Start --------------------------- */

geraeteLaden();
begriffeLaden();
ablageLaden();
dateienLaden();
abfragen();
setInterval(abfragen, 1500);

window.addEventListener('beforeunload', (e) => {
  if (liveLaeuft) { e.preventDefault(); e.returnValue = ''; }
});
