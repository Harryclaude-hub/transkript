# -*- coding: utf-8 -*-
"""
Orion-Funktion: sorgt dafuer, dass Fachbegriffe richtig erkannt werden.

Zwei Stufen:
  1. VORHER  -> die wichtigsten Begriffe werden Whisper als Vorspann mitgegeben.
                Whisper hoert dann eher "Surebet" als "sicher Bett".
  2. NACHHER -> was trotzdem falsch ankam, wird ueber die Korrekturliste
                und einen vorsichtigen Aehnlichkeitsvergleich geradegezogen.

Ist die Orion-Funktion AUS, passiert hier gar nichts. Die Datei ist dann
komplett wirkungslos, das Transkript laeuft voellig normal durch.
"""

import re
import difflib
from pathlib import Path

ORDNER = Path(__file__).resolve().parent.parent / "begriffe"
DATEI_BEGRIFFE = ORDNER / "orion.txt"
DATEI_KORREKTUREN = ORDNER / "orion_korrekturen.txt"

# Whisper verkraftet nur einen kurzen Vorspann (rund 220 Zeichenbausteine).
# Wir nehmen deshalb nur die ersten Begriffe der Liste.
MAX_BEGRIFFE_IM_VORSPANN = 60

# Wie aehnlich muss ein Wort einem Fachbegriff sein, damit es ersetzt wird.
# 0.88 ist bewusst streng: lieber eine Korrektur zu wenig als ein zerstoertes Wort.
AEHNLICHKEIT_SCHWELLE = 0.88

# Ein Fachbegriff muss mindestens so lang sein, um ueberhaupt fuer den
# Aehnlichkeitsvergleich in Frage zu kommen.
MIN_LAENGE_FUER_VERGLEICH = 6

# So viele Zeichen Laengenunterschied sind hoechstens erlaubt.
MAX_LAENGEN_UNTERSCHIED = 2

# Diese Woerter werden vom Aehnlichkeitsvergleich nie angefasst.
# Sonst wird aus "Quote" schnell mal "Quoten" oder aus "war" ein "Back".
TABU = {
    "der", "die", "das", "und", "oder", "aber", "ist", "war", "sind", "waren",
    "ein", "eine", "einen", "einem", "einer", "eines", "nicht", "auch", "noch",
    "schon", "mehr", "sehr", "hier", "dort", "dann", "wenn", "weil", "dass",
    "mit", "ohne", "fuer", "auf", "aus", "bei", "nach", "vor", "ueber", "unter",
    "man", "wir", "ihr", "sie", "ich", "du", "es", "was", "wer", "wie", "wo",
    "hat", "habe", "haben", "hatte", "wird", "werden", "wurde", "kann", "muss",
}


def _zeilen(pfad):
    """Liest eine Datei zeilenweise, ohne Kommentare und Leerzeilen."""
    if not pfad.exists():
        return []
    roh = pfad.read_text(encoding="utf-8", errors="replace").splitlines()
    ergebnis = []
    for zeile in roh:
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#"):
            continue
        ergebnis.append(zeile)
    return ergebnis


class Orion:
    """Haelt die Begriffslisten im Speicher und wendet sie an."""

    def __init__(self):
        self.begriffe = []
        self.korrekturen = {}
        self._muster_speicher = {}
        self.laden()

    # ------------------------------------------------------------------
    def laden(self):
        """Liest beide Listen neu von der Festplatte."""
        self.begriffe = _zeilen(DATEI_BEGRIFFE)

        self.korrekturen = {}
        self._muster_speicher = {}
        for zeile in _zeilen(DATEI_KORREKTUREN):
            if "=" not in zeile:
                continue
            falsch, richtig = zeile.split("=", 1)
            falsch = falsch.strip().lower()
            richtig = richtig.strip()
            if falsch and richtig:
                self.korrekturen[falsch] = richtig

        return {
            "begriffe": len(self.begriffe),
            "korrekturen": len(self.korrekturen),
        }

    # ------------------------------------------------------------------
    def vorspann(self):
        """
        Der Satz, den Whisper vor dem Zuhoeren zu lesen bekommt.
        Whisper richtet seine Wortwahl danach aus.
        """
        if not self.begriffe:
            return None
        auswahl = self.begriffe[:MAX_BEGRIFFE_IM_VORSPANN]
        return (
            "Fachgespraech ueber Sportwetten, Wettboersen und Quotenrechnung. "
            "Es kommen folgende Fachbegriffe vor: " + ", ".join(auswahl) + "."
        )

    # ------------------------------------------------------------------
    def korrigieren(self, text):
        """
        Zieht einen fertigen Text gerade.
        Gibt (korrigierter_text, anzahl_aenderungen) zurueck.
        """
        if not text:
            return text, 0

        anzahl = 0

        # --- Stufe 1: feste Korrekturliste, laengste Eintraege zuerst -----
        # Laengste zuerst, damit "bet fair exchange" vor "bet fair" greift.
        for falsch in sorted(self.korrekturen, key=len, reverse=True):
            richtig = self.korrekturen[falsch]
            text, treffer = self._muster(falsch).subn(richtig, text)
            anzahl += treffer

        # --- Stufe 2: vorsichtiger Aehnlichkeitsvergleich Wort fuer Wort --
        einzelbegriffe = [b for b in self.begriffe
                          if " " not in b and len(b) >= MIN_LAENGE_FUER_VERGLEICH]
        if einzelbegriffe:
            nachschlag = {b.lower(): b for b in einzelbegriffe}
            schluessel = list(nachschlag.keys())

            def ersetze(treffer):
                nonlocal anzahl
                wort = treffer.group(0)
                klein = wort.lower()

                # Schon korrekt, zu kurz oder auf der Tabu-Liste: Finger weg.
                if (klein in nachschlag or klein in TABU
                        or len(wort) < MIN_LAENGE_FUER_VERGLEICH):
                    return wort

                kandidaten = difflib.get_close_matches(
                    klein, schluessel, n=1, cutoff=AEHNLICHKEIT_SCHWELLE
                )
                if not kandidaten:
                    return wort

                gefunden = kandidaten[0]

                # SCHUTZ 1: gebeugte Form stehen lassen.
                # "Gebuehren" ist kein verhoertes "Gebuehr", sondern der Plural.
                # Gleiches gilt fuer Quote/Quoten, Einsatz/Einsaetze und so weiter.
                if klein.startswith(gefunden) or gefunden.startswith(klein):
                    return wort

                # SCHUTZ 2: zu grosser Laengenunterschied heisst anderes Wort.
                if abs(len(klein) - len(gefunden)) > MAX_LAENGEN_UNTERSCHIED:
                    return wort

                anzahl += 1
                return nachschlag[gefunden]

            text = re.sub(r"\b[A-Za-zÄÖÜäöüß]+\b", ersetze, text)

        return text, anzahl

    # ------------------------------------------------------------------
    def _muster(self, falsch):
        """
        Baut das Suchmuster fuer einen Korrektureintrag.
        Zwischen den Wortteilen ist Leerzeichen, Bindestrich oder gar nichts
        erlaubt. So findet "bet fair" auch "Bet-Fair" und "BetFair".
        """
        if falsch in self._muster_speicher:
            return self._muster_speicher[falsch]

        teile = [re.escape(t) for t in falsch.split()]
        kern = r"[\s\-]*".join(teile)
        muster = re.compile(r"(?<!\w)" + kern + r"(?!\w)", re.IGNORECASE)

        self._muster_speicher[falsch] = muster
        return muster


# Eine gemeinsame Instanz fuer die ganze App.
orion = Orion()
