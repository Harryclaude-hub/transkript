# -*- coding: utf-8 -*-
"""Einstellungen laden und speichern. Alles liegt in einstellungen.json."""

import json
from pathlib import Path

DATEI = Path(__file__).resolve().parent.parent / "einstellungen.json"

STANDARD = {
    # Orion-Funktion: Fachbegriffe fuer Sportwetten. True = an, False = aus.
    "orion_an": True,

    # Welches Modell fuer welchen Zweck.
    #   tiny   = sehr schnell, ungenau
    #   base   = schnell, brauchbar
    #   small  = guter Kompromiss   <- Standard fuer live
    #   medium = deutlich genauer, langsamer  <- Standard fuer Dateien
    #   large-v3-turbo = am genauesten, auf diesem Laptop sehr langsam
    "modell_live": "small",
    "modell_datei": "medium",

    # Sprache. "de" = Deutsch. "auto" = selbst erkennen.
    "sprache": "de",

    # Zeitstempel im Transkript anzeigen.
    "zeitstempel": False,

    # Wie viele Sekunden Ton sammelt der Live-Modus, bevor er erkennt.
    "live_block_sekunden": 25,

    # Auf welchem Port laeuft die Oberflaeche.
    "port": 7345,
}


def laden():
    daten = dict(STANDARD)
    if DATEI.exists():
        try:
            gespeichert = json.loads(DATEI.read_text(encoding="utf-8"))
            if isinstance(gespeichert, dict):
                daten.update(gespeichert)
        except Exception as fehler:
            print("[Einstellungen] Datei unlesbar, nehme Standardwerte:", fehler)
    return daten


def speichern(daten):
    vollstaendig = dict(STANDARD)
    vollstaendig.update(daten or {})
    DATEI.write_text(
        json.dumps(vollstaendig, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return vollstaendig
