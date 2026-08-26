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

    # --- Empfindlichkeit, 1 bis 5 ---
    # 1 = nur laute, klare Stimmen. 5 = auch leises Gemurmel, Zwischenrufe
    # und kurze Einwuerfe werden mitgeschrieben. Hoch heisst auch: eher mal
    # ein Huster oder ein Rascheln zu viel im Text.
    "empfindlichkeit": 4,

    # --- Stimmenerkennung ---
    "stimmen_an": True,
    # 0 = selbst herausfinden, wie viele Personen sprechen.
    # Sonst die feste Anzahl, wenn du sie sicher weisst.
    "anzahl_personen": 0,
    # Wie streng zwei Stimmen als dieselbe Person gelten.
    # Kleiner = schneller getrennt (mehr Personen),
    # groesser = eher zusammengefasst (weniger Personen).
    "stimmen_aehnlichkeit": 0.5,

    # --- Tonerkennung (Musik, Hund, Applaus ...) ---
    "toene_an": True,
    # Ab welcher Sicherheit ein Geraeusch ins Transkript kommt.
    "ton_schwelle": 0.35,
    # Musik gar nicht erst eintragen, wenn im Hintergrund dauernd welche laeuft.
    "musik_weglassen": False,

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
