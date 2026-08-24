# -*- coding: utf-8 -*-
"""
Baut aus den Begriffslisten die Datei docs/begriffe.js fuer die Webfassung.

So bleibt begriffe/*.txt die einzige Quelle. Nach jeder Aenderung an den
Listen einmal ausfuehren:

    python web_bauen.py
"""

import json
from pathlib import Path

BASIS = Path(__file__).resolve().parent
QUELLE = BASIS / "begriffe"
ZIEL = BASIS / "docs" / "begriffe.js"


def zeilen(pfad):
    if not pfad.exists():
        return []
    ergebnis = []
    for zeile in pfad.read_text(encoding="utf-8").splitlines():
        zeile = zeile.strip()
        if zeile and not zeile.startswith("#"):
            ergebnis.append(zeile)
    return ergebnis


def main():
    begriffe = zeilen(QUELLE / "orion.txt")

    korrekturen = {}
    for zeile in zeilen(QUELLE / "orion_korrekturen.txt"):
        if "=" not in zeile:
            continue
        falsch, richtig = zeile.split("=", 1)
        falsch, richtig = falsch.strip().lower(), richtig.strip()
        if falsch and richtig:
            korrekturen[falsch] = richtig

    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    ZIEL.write_text(
        "/* Erzeugt von web_bauen.py. Nicht von Hand aendern.\n"
        "   Quelle ist begriffe/orion.txt und begriffe/orion_korrekturen.txt. */\n\n"
        "const ORION_BEGRIFFE = %s;\n\n"
        "const ORION_KORREKTUREN = %s;\n"
        % (json.dumps(begriffe, ensure_ascii=False, indent=1),
           json.dumps(korrekturen, ensure_ascii=False, indent=1)),
        encoding="utf-8",
    )

    print("docs/begriffe.js geschrieben: %d Begriffe, %d Korrekturen"
          % (len(begriffe), len(korrekturen)))


if __name__ == "__main__":
    main()
