/* ------------------------------------------------------------------
   Rechenkern der Webfassung.

   Hier passiert alles, was frueher Google gemacht hat, jetzt aber im
   Browser selbst laeuft:

     Text          whisper
     Wer spricht   pyannote (Abschnitte) + wavlm (Stimm-Fingerabdruck)
     Geraeusche    AST auf AudioSet

   Die Modelle werden beim ersten Mal geholt und danach im Browser
   behalten. Ab dann geht alles auch ohne Internet.
   ------------------------------------------------------------------ */

const BIBLIOTHEK = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';
const RATE = 16000;

/* Auf schwacher Grafik ist die CPU schneller als WebGPU. Nachgemessen auf
   einem i5 mit Intel UHD: WebGPU 0,89x, CPU 1,30x Echtzeit. Deshalb wasm. */
const GERAET = 'wasm';

const MODELLE = {
  text_klein:  'onnx-community/whisper-tiny',
  text_mittel: 'onnx-community/whisper-base',
  text_gross:  'onnx-community/whisper-small',
  abschnitte:  'onnx-community/pyannote-segmentation-3.0',
  abdruck:     'Xenova/wavlm-base-plus-sv',
  geraeusche:  'Xenova/ast-finetuned-audioset-10-10-0.4593',
};

let T = null;
const geladen = {};
let melder = () => {};

export function beiMeldung(f) { melder = f || (() => {}); }

async function bibliothek() {
  if (!T) {
    melder('Rechenkern wird geladen ...');
    T = await import(BIBLIOTHEK);
    T.env.allowLocalModels = false;
  }
  return T;
}

/* Fortschritt beim Herunterladen in etwas Lesbares uebersetzen. */
function fortschrittMelder(was) {
  const gesehen = {};
  return (x) => {
    if (x.status === 'progress' && x.total) {
      gesehen[x.file] = x.progress;
      const werte = Object.values(gesehen);
      const schnitt = werte.reduce((a, b) => a + b, 0) / werte.length;
      melder(`${was} wird geholt ... ${Math.round(schnitt)}%`);
    } else if (x.status === 'done') {
      melder(`${was} wird vorbereitet ...`);
    }
  };
}


/* ================= Text ================= */

export async function textErkennerLaden(groesse) {
  const name = MODELLE['text_' + groesse] || MODELLE.text_mittel;
  if (geladen[name]) return geladen[name];

  const t = await bibliothek();
  melder('Spracherkennung wird geladen ...');
  geladen[name] = await t.pipeline('automatic-speech-recognition', name, {
    device: GERAET, dtype: 'q8',
    progress_callback: fortschrittMelder('Spracherkennung'),
  });
  melder('Spracherkennung ist bereit.');
  return geladen[name];
}

/**
 * Erkennt einen Tonabschnitt.
 * ton: Float32Array bei 16 kHz. versatz: Sekunden, die aufaddiert werden.
 * Rueckgabe: [{start, ende, text}]
 */
/* Grobe Schaetzung, wie lange ein Satz gesprochen dauert.
   Wird nur gebraucht, wenn Whisper keine brauchbare Endzeit liefert. */
function geschaetzteDauer(text) {
  const woerter = text.split(/\s+/).filter(Boolean).length;
  return Math.max(0.6, Math.min(20, woerter * 0.4));
}

export async function textErkennen(ton, groesse, sprache, versatz = 0) {
  const erkenner = await textErkennerLaden(groesse);
  const laenge = ton.length / RATE;

  const raus = await erkenner(ton, {
    language: sprache === 'auto' ? null : sprache,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,          // ein Block passt in EIN Fenster
    stride_length_s: 5,
  });

  const stuecke = (raus.chunks && raus.chunks.length)
    ? raus.chunks
    : [{ text: raus.text, timestamp: [0, laenge] }];

  const segmente = [];
  let letztesEnde = 0;
  let vorigerText = '';
  let wiederholungen = 0;

  for (let i = 0; i < stuecke.length; i++) {
    const s = stuecke[i];
    const text = (s.text || '').trim();
    if (!text) continue;

    /* --- Wiederholungsschleife abfangen ---
       Whisper haengt sich manchmal auf und gibt denselben Satz immer
       wieder aus, vor allem wenn die eingestellte Sprache nicht zum Ton
       passt. Ohne diese Bremse steht der Satz zehnmal im Transkript. */
    const vergleich = text.toLowerCase().replace(/[^\wäöüß ]/g, '');
    if (vergleich === vorigerText) {
      wiederholungen++;
      if (wiederholungen >= 1) continue;      // schon einmal dagewesen
    } else {
      wiederholungen = 0;
      vorigerText = vergleich;
    }

    /* --- Zeitmarken geradeziehen ---
       Whisper liefert die Endzeit manchmal als null oder sogar als 0,
       also VOR dem Start. Ungeprueft uebernommen ergibt das Absaetze mit
       0,0 Sekunden Dauer und eine kaputte Reihenfolge. */
    const rohVon = s.timestamp && s.timestamp[0];
    const rohBis = s.timestamp && s.timestamp[1];

    let von = Number.isFinite(rohVon) ? rohVon : letztesEnde;
    von = Math.max(0, Math.min(laenge, von));

    let bis = null;
    if (Number.isFinite(rohBis) && rohBis > von) bis = rohBis;

    if (bis === null) {
      const naechster = stuecke[i + 1];
      const naechsterStart = naechster && Number.isFinite(naechster.timestamp[0])
        ? naechster.timestamp[0] : null;
      bis = (naechsterStart !== null && naechsterStart > von)
        ? naechsterStart
        : von + geschaetzteDauer(text);
    }
    bis = Math.max(von + 0.3, Math.min(laenge, bis));

    segmente.push({ start: von + versatz, ende: bis + versatz, text });
    letztesEnde = bis;
  }

  return segmente;
}


/* ================= Wer spricht ================= */

let abschnittModell = null;
let abschnittAufbereiter = null;

async function abschnittLaden() {
  if (abschnittModell) return;
  const t = await bibliothek();
  melder('Sprecher-Trennung wird geladen ...');
  abschnittModell = await t.AutoModelForAudioFrameClassification.from_pretrained(
    MODELLE.abschnitte, { dtype: 'fp32',
      progress_callback: fortschrittMelder('Sprecher-Trennung') });
  abschnittAufbereiter = await t.AutoProcessor.from_pretrained(MODELLE.abschnitte);
}

let abdruckModell = null;
let abdruckAufbereiter = null;

async function abdruckLaden() {
  if (abdruckModell) return;
  const t = await bibliothek();
  melder('Stimm-Fingerabdruck wird geladen ...');
  abdruckAufbereiter = await t.AutoProcessor.from_pretrained(MODELLE.abdruck);
  abdruckModell = await t.AutoModel.from_pretrained(MODELLE.abdruck, {
    device: GERAET, dtype: 'q8',
    progress_callback: fortschrittMelder('Stimm-Fingerabdruck'),
  });
}

/* Zum Vorladen, damit die App danach ohne Internet laeuft. */
export async function vorladenStimmen() {
  await abschnittLaden();
  await abdruckLaden();
  melder('Stimmen-Erkennung ist bereit.');
}

export async function vorladenGeraeusche() {
  await geraeuschLaden();
  melder('Geraeusch-Erkennung ist bereit.');
}

/* pyannote arbeitet auf Fenstern von rund 10 Sekunden. Laengere Aufnahmen
   werden stueckweise durchgegeben und die Ergebnisse aneinandergehaengt. */
const FENSTER = 10.0;

async function abschnitteFinden(ton) {
  await abschnittLaden();

  const gesamt = ton.length / RATE;
  const alle = [];

  for (let von = 0; von < gesamt; von += FENSTER) {
    const bis = Math.min(gesamt, von + FENSTER);
    if (bis - von < 0.5) break;

    const stueck = ton.subarray(Math.round(von * RATE), Math.round(bis * RATE));
    const eingang = await abschnittAufbereiter(stueck);
    const { logits } = await abschnittModell(eingang);
    const roh = abschnittAufbereiter.post_process_speaker_diarization(
      logits, stueck.length)[0] || [];

    for (const a of roh) {
      // id 0 ist "niemand spricht" und faellt weg
      if (!a.id) continue;
      if (a.end - a.start < 0.35) continue;
      alle.push({ start: a.start + von, ende: a.end + von,
                  sicherheit: a.confidence });
    }
    melder(`Sprecher-Trennung ... ${Math.round((bis / gesamt) * 100)}%`);
  }

  // Direkt aneinandergrenzende Stuecke zusammenfassen
  const zusammen = [];
  for (const a of alle) {
    const letzter = zusammen[zusammen.length - 1];
    if (letzter && a.start - letzter.ende < 0.25) letzter.ende = a.ende;
    else zusammen.push({ ...a });
  }
  return zusammen;
}

async function abdruckVon(ton, von, bis) {
  // Zu kurze Stuecke geben keinen brauchbaren Fingerabdruck.
  const mitte = (von + bis) / 2;
  const halb = Math.max(0.75, Math.min(3.0, (bis - von) / 2));
  const a = Math.max(0, Math.round((mitte - halb) * RATE));
  const b = Math.min(ton.length, Math.round((mitte + halb) * RATE));
  if (b - a < RATE * 0.5) return null;

  const eingang = await abdruckAufbereiter(ton.subarray(a, b));
  const raus = await abdruckModell(eingang);
  const v = Array.from(raus.embeddings.data);

  let laenge = 0;
  for (const x of v) laenge += x * x;
  laenge = Math.sqrt(laenge) || 1;
  return v.map((x) => x / laenge);
}

function kosinus(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/* Zusammenfassen, was zusammengehoert.
   Immer die zwei aehnlichsten Gruppen verschmelzen, bis die Aehnlichkeit
   unter die Schwelle faellt oder die gewuenschte Anzahl erreicht ist. */
function gruppieren(abdruecke, schwelle, festeAnzahl) {
  const gruppen = abdruecke.map((a, i) => ({ mitglieder: [i], mitte: a.slice() }));

  while (gruppen.length > 1) {
    let besteA = -1, besteB = -1, bester = -Infinity;

    for (let i = 0; i < gruppen.length; i++) {
      for (let j = i + 1; j < gruppen.length; j++) {
        const w = kosinus(gruppen[i].mitte, gruppen[j].mitte);
        if (w > bester) { bester = w; besteA = i; besteB = j; }
      }
    }

    const nochZuViele = festeAnzahl > 0 && gruppen.length > festeAnzahl;
    if (!nochZuViele && bester < schwelle) break;
    if (festeAnzahl > 0 && gruppen.length <= festeAnzahl) break;

    const a = gruppen[besteA], b = gruppen[besteB];
    const neu = a.mitte.map((x, k) =>
      (x * a.mitglieder.length + b.mitte[k] * b.mitglieder.length)
      / (a.mitglieder.length + b.mitglieder.length));
    let laenge = 0;
    for (const x of neu) laenge += x * x;
    laenge = Math.sqrt(laenge) || 1;

    gruppen[besteA] = { mitglieder: a.mitglieder.concat(b.mitglieder),
                        mitte: neu.map((x) => x / laenge) };
    gruppen.splice(besteB, 1);
  }

  const zuordnung = new Array(abdruecke.length).fill(0);
  gruppen.forEach((g, nummer) => {
    g.mitglieder.forEach((i) => { zuordnung[i] = nummer + 1; });
  });
  return zuordnung;
}

/**
 * Findet heraus, wer wann spricht.
 * Rueckgabe: [{start, ende, person}] mit person ab 1.
 */
export async function sprecherFinden(ton, { schwelle = 0.83, anzahl = 0 } = {}) {
  const abschnitte = await abschnitteFinden(ton);
  if (!abschnitte.length) return [];

  await abdruckLaden();

  const abdruecke = [];
  const brauchbar = [];
  for (let i = 0; i < abschnitte.length; i++) {
    melder(`Stimmen werden verglichen ... ${i + 1} von ${abschnitte.length}`);
    const a = abschnitte[i];
    const v = await abdruckVon(ton, a.start, a.ende);
    if (v) { abdruecke.push(v); brauchbar.push(a); }
  }
  if (!abdruecke.length) return [];

  const zuordnung = gruppieren(abdruecke, schwelle, anzahl);

  // In der Reihenfolge des ersten Auftretens neu durchnummerieren, damit
  // "Person 1" auch wirklich zuerst gesprochen hat.
  const umbenennen = new Map();
  const fertig = brauchbar.map((a, i) => {
    const roh = zuordnung[i];
    if (!umbenennen.has(roh)) umbenennen.set(roh, umbenennen.size + 1);
    return { start: a.start, ende: a.ende, person: umbenennen.get(roh) };
  });

  melder(`${umbenennen.size} Stimmen gefunden.`);
  return fertig;
}


/* ================= Geraeusche ================= */

let geraeuschErkenner = null;

async function geraeuschLaden() {
  if (geraeuschErkenner) return geraeuschErkenner;
  const t = await bibliothek();
  melder('Geraeusch-Erkennung wird geladen ...');
  geraeuschErkenner = await t.pipeline('audio-classification', MODELLE.geraeusche, {
    device: GERAET, dtype: 'q8',
    progress_callback: fortschrittMelder('Geraeusch-Erkennung'),
  });
  return geraeuschErkenner;
}

const KEIN_EIGENER_EINTRAG = new Set([
  'Speech', 'Male speech, man speaking', 'Female speech, woman speaking',
  'Child speech, kid speaking', 'Conversation', 'Narration, monologue',
  'Speech synthesizer', 'Silence', 'Inside, small room',
  'Inside, large room or hall', 'Whispering',
]);

export const TON_DEUTSCH = {
  Music: 'Musik', 'Musical instrument': 'Musikinstrument', Singing: 'Gesang',
  Song: 'Lied', Guitar: 'Gitarre', Piano: 'Klavier', Drum: 'Schlagzeug',
  'Drum kit': 'Schlagzeug', 'Bass guitar': 'Bassgitarre',
  'Violin, fiddle': 'Geige', Dog: 'Hund', Bark: 'Hundebellen', Howl: 'Heulen',
  Cat: 'Katze', Meow: 'Katzenmiauen', Bird: 'Vogel',
  'Bird vocalization, bird call, bird song': 'Vogelgezwitscher',
  Applause: 'Applaus', Clapping: 'Klatschen', Laughter: 'Lachen',
  Giggle: 'Kichern', Cheering: 'Jubel', 'Crying, sobbing': 'Weinen',
  'Baby cry, infant cry': 'Babygeschrei', Cough: 'Husten', Sneeze: 'Niesen',
  'Telephone bell ringing': 'Telefonklingeln', Ringtone: 'Klingelton',
  Telephone: 'Telefon', Doorbell: 'Tuerklingel', 'Ding-dong': 'Tuerklingel',
  Knock: 'Klopfen', Door: 'Tuer', Alarm: 'Alarm', Siren: 'Sirene',
  Vehicle: 'Fahrzeug', Car: 'Auto', Motorcycle: 'Motorrad', Train: 'Zug',
  Aircraft: 'Flugzeug', Typing: 'Tippen', 'Computer keyboard': 'Tastatur',
  Water: 'Wasser', Rain: 'Regen', Wind: 'Wind', Thunder: 'Donner',
  Television: 'Fernseher', Radio: 'Radio', Noise: 'Geraeusch',
  'White noise': 'Rauschen', Static: 'Rauschen', 'Sound effect': 'Gerausch',
};

export const MUSIK_KLASSEN = new Set([
  'Music', 'Musical instrument', 'Singing', 'Song', 'Guitar', 'Piano',
  'Drum', 'Drum kit', 'Bass guitar', 'Violin, fiddle', 'Background music',
  'Theme music', 'Ringtone',
]);

function deutsch(name) { return TON_DEUTSCH[name] || name; }

/**
 * Sucht in den Sprechpausen nach anderen Geraeuschen.
 * Nur dort, weil waehrend des Redens der Text zaehlt und nicht "[Musik]".
 */
export async function geraeuscheFinden(ton, sprecherAbschnitte,
                                       { schwelle = 0.3, maxStuecke = 40 } = {}) {
  const erkenner = await geraeuschLaden();
  const gesamt = ton.length / RATE;

  const belegt = sprecherAbschnitte.map((a) => [a.start, a.ende])
    .sort((x, y) => x[0] - y[0]);
  const luecken = [];
  let zeiger = 0;
  for (const [von, bis] of belegt) {
    if (von - zeiger >= 1.2) luecken.push([zeiger, von]);
    zeiger = Math.max(zeiger, bis);
  }
  if (gesamt - zeiger >= 1.2) luecken.push([zeiger, gesamt]);

  const MAX = 6.0;
  const stuecke = [];
  for (const [von, bis] of luecken) {
    const anzahl = Math.max(1, Math.ceil((bis - von) / MAX));
    const schritt = (bis - von) / anzahl;
    for (let i = 0; i < anzahl; i++) {
      const a = von + i * schritt;
      const b = Math.min(bis, a + schritt);
      if (b - a >= 0.9) stuecke.push([a, b]);
    }
  }

  // Die Geraeusch-Erkennung ist der langsamste Teil. Deshalb ein Deckel,
  // damit eine lange Aufnahme nicht ewig braucht.
  const geprueft = stuecke.slice(0, maxStuecke);
  const uebergangen = stuecke.length - geprueft.length;

  const roh = [];
  for (let i = 0; i < geprueft.length; i++) {
    const [von, bis] = geprueft[i];
    melder(`Geraeusche werden bestimmt ... ${i + 1} von ${geprueft.length}`);

    const stueck = ton.subarray(Math.round(von * RATE), Math.round(bis * RATE));
    let laut = 0;
    for (let k = 0; k < stueck.length; k += 8) laut += Math.abs(stueck[k]);
    if (laut / (stueck.length / 8) < 0.0015) continue;   // zu leise

    const treffer = await erkenner(stueck, { top_k: 4 });
    for (const t of treffer) {
      if (KEIN_EIGENER_EINTRAG.has(t.label)) continue;
      if (t.score < schwelle) continue;
      roh.push({ start: von, ende: bis, was: deutsch(t.label),
                 klasse: t.label, sicherheit: t.score });
      break;
    }
  }

  // Gleiche Geraeusche direkt hintereinander zusammenfassen
  const fertig = [];
  for (const g of roh) {
    const letzter = fertig[fertig.length - 1];
    if (letzter && letzter.was === g.was && g.start - letzter.ende < 1.5) {
      letzter.ende = g.ende;
      letzter.sicherheit = Math.max(letzter.sicherheit, g.sicherheit);
    } else fertig.push({ ...g });
  }

  if (uebergangen > 0) {
    melder(`${fertig.length} Geraeusche erkannt, ${uebergangen} Stellen ausgelassen.`);
  } else {
    melder(`${fertig.length} Geraeusche erkannt.`);
  }
  return { geraeusche: fertig, uebergangen };
}


/* ================= Zusammenfuehren ================= */

export function personenZuordnen(segmente, sprecherAbschnitte) {
  if (!sprecherAbschnitte.length) {
    segmente.forEach((s) => { s.person = 0; });
    return segmente;
  }

  for (const seg of segmente) {
    const ueberlappung = new Map();
    for (const a of sprecherAbschnitte) {
      const von = Math.max(seg.start, a.start);
      const bis = Math.min(seg.ende, a.ende);
      if (bis > von) {
        ueberlappung.set(a.person, (ueberlappung.get(a.person) || 0) + (bis - von));
      }
    }

    if (ueberlappung.size) {
      let beste = 0, wert = -1;
      ueberlappung.forEach((v, k) => { if (v > wert) { wert = v; beste = k; } });
      seg.person = beste;
    } else {
      let naechste = sprecherAbschnitte[0], abstand = Infinity;
      for (const a of sprecherAbschnitte) {
        const d = Math.min(Math.abs(a.start - seg.ende), Math.abs(seg.start - a.ende));
        if (d < abstand) { abstand = d; naechste = a; }
      }
      seg.person = naechste.person;
    }
  }
  return segmente;
}

export function zusammenfuehren(segmente, geraeusche, musikWeglassen) {
  const zeilen = segmente.map((s) => ({ ...s }));

  for (const g of geraeusche || []) {
    if (musikWeglassen && MUSIK_KLASSEN.has(g.klasse)) continue;
    zeilen.push({ start: g.start, ende: g.ende, text: `[${g.was}]`,
                  person: 0, geraeusch: true, sicherheit: g.sicherheit });
  }

  zeilen.sort((a, b) => a.start - b.start);
  return zeilen;
}
