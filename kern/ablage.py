# -*- coding: utf-8 -*-
"""
Die Transkript-Ablage.

Jedes Transkript wird als eine JSON-Datei gespeichert: Text, Zeiten,
Personen, Namen und der Verweis auf die Tondatei. Damit laesst es sich
spaeter wieder oeffnen, anhoeren und neu herunterladen.
"""

import json
import re
import uuid
from datetime import datetime
from pathlib import Path

ORDNER = Path(__file__).resolve().parent.parent / "transkripte"


def _sauber(text):
    text = re.sub(r"[^\w\s\-]", "", (text or "Transkript"), flags=re.UNICODE)
    return re.sub(r"\s+", "_", text).strip("_")[:50] or "Transkript"


def speichern(daten, kennung=None):
    """
    daten: dict mit titel, segmente, dauer, quelle, namen, ton, einstellungen
    Rueckgabe: die Kennung.
    """
    ORDNER.mkdir(parents=True, exist_ok=True)

    if not kennung:
        kennung = "%s_%s" % (datetime.now().strftime("%Y-%m-%d_%H-%M-%S"),
                             uuid.uuid4().hex[:6])

    daten = dict(daten)
    daten["kennung"] = kennung
    daten.setdefault("angelegt", datetime.now().isoformat(timespec="seconds"))
    daten["geaendert"] = datetime.now().isoformat(timespec="seconds")

    pfad = ORDNER / ("%s.json" % kennung)
    pfad.write_text(json.dumps(daten, ensure_ascii=False, indent=1),
                    encoding="utf-8")
    return kennung


def laden(kennung):
    pfad = ORDNER / ("%s.json" % kennung)
    if not pfad.exists():
        raise RuntimeError("Dieses Transkript gibt es nicht mehr.")
    return json.loads(pfad.read_text(encoding="utf-8"))


def loeschen(kennung):
    pfad = ORDNER / ("%s.json" % kennung)
    if pfad.exists():
        pfad.unlink()
        return True
    return False


def liste():
    """Kurzuebersicht aller gespeicherten Transkripte, neueste zuerst."""
    ORDNER.mkdir(parents=True, exist_ok=True)
    eintraege = []

    for pfad in ORDNER.glob("*.json"):
        try:
            daten = json.loads(pfad.read_text(encoding="utf-8"))
        except Exception:
            continue

        segmente = daten.get("segmente") or []
        personen = sorted({int(s.get("person", 0) or 0) for s in segmente
                           if not s.get("geraeusch")} - {0})

        eintraege.append({
            "kennung": daten.get("kennung", pfad.stem),
            "titel": daten.get("titel") or "Ohne Titel",
            "dauer": round(float(daten.get("dauer") or 0), 1),
            "quelle": daten.get("quelle", ""),
            "angelegt": daten.get("angelegt", ""),
            "woerter": sum(len((s.get("text") or "").split())
                           for s in segmente if not s.get("geraeusch")),
            "personen": len(personen),
            "hat_ton": bool(daten.get("ton")),
        })

    eintraege.sort(key=lambda e: e["angelegt"], reverse=True)
    return eintraege
