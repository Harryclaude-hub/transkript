/* ------------------------------------------------------------------
   Orion-Funktion fuer den Browser.

   Gleiche Regeln wie in kern/orion.py am Laptop:
     1. feste Korrekturliste (falsch = richtig)
     2. vorsichtiger Aehnlichkeitsvergleich Wort fuer Wort

   Was hier fehlt und nur die Laptop-Fassung kann: den Vorspann VOR der
   Erkennung. Die Spracherkennung des Browsers laesst sich nicht auf
   Fachbegriffe einstellen. Deshalb arbeitet die Webfassung nur mit der
   Korrektur danach.
   ------------------------------------------------------------------ */

const AEHNLICHKEIT_SCHWELLE = 0.88;
const MIN_LAENGE_FUER_VERGLEICH = 6;
const MAX_LAENGEN_UNTERSCHIED = 2;

/* Diese Woerter werden vom Aehnlichkeitsvergleich nie angefasst. */
const TABU = new Set([
  'der', 'die', 'das', 'und', 'oder', 'aber', 'ist', 'war', 'sind', 'waren',
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'nicht', 'auch', 'noch',
  'schon', 'mehr', 'sehr', 'hier', 'dort', 'dann', 'wenn', 'weil', 'dass',
  'mit', 'ohne', 'fuer', 'für', 'auf', 'aus', 'bei', 'nach', 'vor', 'über',
  'ueber', 'unter', 'man', 'wir', 'ihr', 'sie', 'ich', 'du', 'es', 'was',
  'wer', 'wie', 'wo', 'hat', 'habe', 'haben', 'hatte', 'wird', 'werden',
  'wurde', 'kann', 'muss', 'immer', 'wieder', 'schnell', 'einfach',
]);

const WORTZEICHEN = '0-9A-Za-zÄÖÜäöüß';

function fluchtzeichen(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Wie weit sind zwei Woerter auseinander (Levenshtein-Abstand). */
function abstand(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let zeile = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) zeile[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let vorherige = zeile[0];
    zeile[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const merker = zeile[j];
      zeile[j] = Math.min(
        zeile[j] + 1,                                        // loeschen
        zeile[j - 1] + 1,                                    // einfuegen
        vorherige + (a[i - 1] === b[j - 1] ? 0 : 1)          // tauschen
      );
      vorherige = merker;
    }
  }
  return zeile[b.length];
}

function aehnlichkeit(a, b) {
  const laenge = Math.max(a.length, b.length);
  return laenge === 0 ? 1 : 1 - abstand(a, b) / laenge;
}


class Orion {
  constructor(begriffe, korrekturen) {
    this.laden(begriffe, korrekturen);
  }

  laden(begriffe, korrekturen) {
    this.begriffe = begriffe || [];
    this.korrekturen = korrekturen || {};

    /* Muster einmal bauen, laengste Eintraege zuerst, damit
       "bet fair exchange" vor "bet fair" greift. */
    this.muster = Object.keys(this.korrekturen)
      .sort((a, b) => b.length - a.length)
      .map((falsch) => {
        /* Zwischen den Wortteilen ist Leerzeichen, Bindestrich oder gar
           nichts erlaubt. So findet "bet fair" auch "Bet-Fair". */
        const kern = falsch.trim().split(/\s+/).map(fluchtzeichen).join('[\\s\\-]*');
        return {
          regel: new RegExp(
            '(^|[^' + WORTZEICHEN + '])(' + kern + ')(?![' + WORTZEICHEN + '])',
            'gi'
          ),
          richtig: this.korrekturen[falsch],
        };
      });

    /* Nur laengere Einzelwoerter kommen fuer den Vergleich in Frage. */
    this.nachschlag = new Map();
    for (const b of this.begriffe) {
      if (!b.includes(' ') && b.length >= MIN_LAENGE_FUER_VERGLEICH) {
        this.nachschlag.set(b.toLowerCase(), b);
      }
    }
    this.schluessel = Array.from(this.nachschlag.keys());
  }

  /* Gibt { text, anzahl } zurueck. */
  korrigieren(text) {
    if (!text) return { text: text, anzahl: 0 };
    let anzahl = 0;

    /* --- Stufe 1: feste Korrekturliste --- */
    for (const { regel, richtig } of this.muster) {
      regel.lastIndex = 0;
      text = text.replace(regel, (treffer, vor) => {
        anzahl++;
        return vor + richtig;
      });
    }

    /* --- Stufe 2: vorsichtiger Aehnlichkeitsvergleich --- */
    if (this.schluessel.length) {
      text = text.replace(/[A-Za-zÄÖÜäöüß]+/g, (wort) => {
        const klein = wort.toLowerCase();

        if (wort.length < MIN_LAENGE_FUER_VERGLEICH) return wort;
        if (this.nachschlag.has(klein)) return wort;
        if (TABU.has(klein)) return wort;

        let bester = null;
        let bestwert = AEHNLICHKEIT_SCHWELLE;
        for (const kandidat of this.schluessel) {
          if (Math.abs(kandidat.length - klein.length) > MAX_LAENGEN_UNTERSCHIED) {
            continue;
          }
          const wert = aehnlichkeit(klein, kandidat);
          if (wert >= bestwert) { bestwert = wert; bester = kandidat; }
        }
        if (!bester) return wort;

        /* SCHUTZ: gebeugte Form stehen lassen.
           "Gebuehren" ist kein verhoertes "Gebuehr", sondern der Plural.
           Gleiches gilt fuer Quote/Quoten. */
        if (klein.startsWith(bester) || bester.startsWith(klein)) return wort;

        anzahl++;
        return this.nachschlag.get(bester);
      });
    }

    return { text: text, anzahl: anzahl };
  }
}
