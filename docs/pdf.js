/* ------------------------------------------------------------------
   Kleiner PDF-Schreiber.

   Baut ein echtes PDF direkt im Browser, ohne fremde Bibliothek und ohne
   irgendetwas nachzuladen. Kann genau das, was hier gebraucht wird:
   Fliesstext in Helvetica, Umlaute, Seitenumbruch, Seitenzahlen.
   ------------------------------------------------------------------ */

const SEITE_BREIT = 595.28;      // A4 in Punkt
const SEITE_HOCH = 841.89;
const RAND_LINKS = 62;
const RAND_RECHTS = 62;
const RAND_OBEN = 57;
const RAND_UNTEN = 62;

/* Windows-Zeichensatz: alles ueber 255 muss uebersetzt werden. */
const SONDERZEICHEN = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C,
  'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B,
  'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};

function nachWinAnsi(text) {
  let raus = '';
  for (const zeichen of text) {
    const nummer = zeichen.codePointAt(0);
    if (nummer <= 0xFF) raus += String.fromCharCode(nummer);
    else if (SONDERZEICHEN[zeichen]) raus += String.fromCharCode(SONDERZEICHEN[zeichen]);
    else raus += '?';
  }
  return raus;
}

function pdfText(text) {
  return nachWinAnsi(text).replace(/[\\()]/g, '\\$&');
}

/* Breite messen. Der Browser rechnet mit derselben Schrift wie das PDF,
   deshalb passt die Zeilenlaenge hinterher auch wirklich. */
let messleinwand = null;
function breite(text, groesse, fett) {
  if (!messleinwand) messleinwand = document.createElement('canvas').getContext('2d');
  messleinwand.font = (fett ? 'bold ' : '') + groesse + 'px Helvetica, Arial, sans-serif';
  return messleinwand.measureText(text).width;
}

function umbrechen(text, groesse, maxBreite, fett) {
  const woerter = String(text).split(/\s+/).filter(Boolean);
  const zeilen = [];
  let aktuell = '';

  for (const wort of woerter) {
    const versuch = aktuell ? aktuell + ' ' + wort : wort;
    if (breite(versuch, groesse, fett) <= maxBreite || !aktuell) {
      aktuell = versuch;
    } else {
      zeilen.push(aktuell);
      aktuell = wort;
    }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen.length ? zeilen : [''];
}


/* ------------------------------------------------------------------
   Hauptfunktion. Gibt einen Blob zurueck, fertig zum Herunterladen.
   ------------------------------------------------------------------ */
function pdfErzeugen(titel, kopfzeilen, absaetze, mitZeit) {
  const NUTZBREITE = SEITE_BREIT - RAND_LINKS - RAND_RECHTS;
  const seiten = [];
  let zeilen = [];
  let y = SEITE_HOCH - RAND_OBEN;

  function neueSeite() {
    seiten.push(zeilen);
    zeilen = [];
    y = SEITE_HOCH - RAND_OBEN;
  }
  function platzPruefen(hoehe) {
    if (y - hoehe < RAND_UNTEN) neueSeite();
  }
  function schreiben(text, groesse, fett, grau, abstand, farbe) {
    for (const zeile of umbrechen(text, groesse, NUTZBREITE, fett)) {
      platzPruefen(groesse * 1.45);
      y -= groesse * 1.45;
      zeilen.push({ text: zeile, groesse: groesse, fett: fett, grau: grau,
                    y: y, farbe: farbe });
    }
    y -= (abstand || 0);
  }

  /* "#2563eb" -> "0.15 0.39 0.92" fuer den PDF-Farbbefehl */
  function pdfFarbe(hex) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return null;
    const z = (a) => (parseInt(hex.slice(a, a + 2), 16) / 255).toFixed(3);
    return `${z(1)} ${z(3)} ${z(5)}`;
  }

  /* --- Titel --- */
  schreiben(titel, 19, true, false, 4);

  /* --- Kopfzeile mit Datum, Laenge, Wortzahl --- */
  schreiben(kopfzeilen.join('   |   '), 8.5, false, true, 8);

  /* --- Trennlinie --- */
  platzPruefen(10);
  y -= 6;
  const linie = y;
  y -= 12;

  /* --- Absaetze --- */
  for (const absatz of absaetze) {
    const marke = [];
    if (absatz.person) marke.push(absatz.person);
    if (mitZeit && absatz.zeit) marke.push(absatz.zeit);

    if (marke.length) {
      schreiben(marke.join('   '), 9, true, !absatz.person, 0,
                absatz.person ? pdfFarbe(absatz.farbe) : null);
    }
    schreiben(absatz.text, 10.5, false, !!absatz.geraeusch, 7);
  }
  seiten.push(zeilen);

  /* ---------------- PDF zusammenbauen ---------------- */
  const objekte = [];
  const seitenZahl = seiten.length;
  const ersteSeite = 5;                       // Objektnummer der ersten Seite

  objekte[1] = '<< /Type /Catalog /Pages 2 0 R >>';

  const kinder = [];
  for (let i = 0; i < seitenZahl; i++) kinder.push((ersteSeite + i * 2) + ' 0 R');
  objekte[2] = '<< /Type /Pages /Kids [' + kinder.join(' ') + '] /Count ' + seitenZahl + ' >>';

  objekte[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objekte[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  seiten.forEach((seitenZeilen, index) => {
    const nummerSeite = ersteSeite + index * 2;
    const nummerInhalt = nummerSeite + 1;

    let strom = '';
    for (const z of seitenZeilen) {
      const schrift = z.fett ? '/F2' : '/F1';
      const farbe = z.farbe ? z.farbe + ' rg'
                  : (z.grau ? '0.45 0.45 0.45 rg' : '0.1 0.1 0.1 rg');
      strom += 'BT ' + farbe + ' ' + schrift + ' ' + z.groesse + ' Tf 1 0 0 1 '
             + RAND_LINKS.toFixed(2) + ' ' + z.y.toFixed(2) + ' Tm ('
             + pdfText(z.text) + ') Tj ET\n';
    }

    /* Trennlinie nur auf der ersten Seite */
    if (index === 0) {
      strom += '0.85 0.85 0.85 RG 0.6 w ' + RAND_LINKS + ' ' + linie.toFixed(2)
             + ' m ' + (SEITE_BREIT - RAND_RECHTS) + ' ' + linie.toFixed(2) + ' l S\n';
    }

    /* Seitenzahl */
    const fuss = 'Seite ' + (index + 1) + ' von ' + seitenZahl;
    strom += 'BT 0.6 0.6 0.6 rg /F1 8 Tf 1 0 0 1 '
           + (SEITE_BREIT - RAND_RECHTS - breite(fuss, 8, false)).toFixed(2)
           + ' 34 Tm (' + pdfText(fuss) + ') Tj ET\n';

    objekte[nummerSeite] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + SEITE_BREIT + ' ' + SEITE_HOCH
      + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '
      + nummerInhalt + ' 0 R >>';

    objekte[nummerInhalt] =
      '<< /Length ' + strom.length + ' >>\nstream\n' + strom + 'endstream';
  });

  /* ---------------- Datei schreiben ---------------- */
  let datei = '%PDF-1.4\n';
  const stellen = [];

  for (let i = 1; i < objekte.length; i++) {
    if (objekte[i] === undefined) continue;
    stellen[i] = datei.length;
    datei += i + ' 0 obj\n' + objekte[i] + '\nendobj\n';
  }

  const xrefStelle = datei.length;
  const anzahl = objekte.length;
  datei += 'xref\n0 ' + anzahl + '\n0000000000 65535 f \n';
  for (let i = 1; i < anzahl; i++) {
    const stelle = stellen[i] === undefined ? 0 : stellen[i];
    datei += String(stelle).padStart(10, '0') + ' 00000 n \n';
  }
  datei += 'trailer\n<< /Size ' + anzahl + ' /Root 1 0 R >>\nstartxref\n'
         + xrefStelle + '\n%%EOF';

  const bytes = new Uint8Array(datei.length);
  for (let i = 0; i < datei.length; i++) bytes[i] = datei.charCodeAt(i) & 0xFF;
  return new Blob([bytes], { type: 'application/pdf' });
}
