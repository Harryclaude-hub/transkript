# -*- coding: utf-8 -*-
"""
Macht aus den vielen kleinen Schnipseln lesbare Absaetze.

Regeln, in dieser Reihenfolge:
  1. Wechselt die Person, beginnt IMMER ein neuer Absatz.
  2. Ein Geraeusch ([Musik], [Hund]) steht immer allein.
  3. Sonst wird nach Sprechpause und Laenge umgebrochen.
"""

PAUSE_FUER_NEUEN_ABSATZ = 1.4
MAX_ZEICHEN_PRO_ABSATZ = 700
MIN_ZEICHEN_PRO_ABSATZ = 80

SATZENDE = (".", "!", "?", ":")


def zeitstempel(sekunden):
    """1837.4 -> '00:30:37'"""
    sekunden = int(sekunden)
    return "%02d:%02d:%02d" % (sekunden // 3600, (sekunden % 3600) // 60, sekunden % 60)


def kurz(sekunden):
    """1837.4 -> '30:37'"""
    sekunden = int(sekunden)
    if sekunden >= 3600:
        return zeitstempel(sekunden)
    return "%02d:%02d" % (sekunden // 60, sekunden % 60)


def bauen(segmente):
    """
    segmente: Liste von {'start', 'ende', 'text'} und optional
              'person' (0 = unbekannt oder Geraeusch) und 'geraeusch'.

    Rueckgabe: Liste von Absaetzen mit denselben Feldern plus 'dauer'.
    """
    if not segmente:
        return []

    absaetze = []
    aktuell = None

    for seg in segmente:
        text = (seg.get("text") or "").strip()
        if not text:
            continue

        start = float(seg.get("start", 0.0))
        ende = float(seg.get("ende", start))
        person = int(seg.get("person", 0) or 0)
        geraeusch = bool(seg.get("geraeusch"))

        neu = {
            "start": start, "ende": ende, "text": text,
            "person": person, "geraeusch": geraeusch,
        }

        if aktuell is None:
            aktuell = neu
            continue

        # --- Regel 1 und 2: Person gewechselt oder Geraeusch im Spiel ---
        if (person != aktuell["person"] or geraeusch or aktuell["geraeusch"]):
            absaetze.append(aktuell)
            aktuell = neu
            continue

        # --- Regel 3: Pause und Laenge ---
        pause = start - aktuell["ende"]
        zu_lang = len(aktuell["text"]) >= MAX_ZEICHEN_PRO_ABSATZ
        satz_zu_ende = aktuell["text"].endswith(SATZENDE)
        lang_genug = len(aktuell["text"]) >= MIN_ZEICHEN_PRO_ABSATZ

        if ((pause >= PAUSE_FUER_NEUEN_ABSATZ and satz_zu_ende and lang_genug)
                or zu_lang):
            absaetze.append(aktuell)
            aktuell = neu
        else:
            aktuell["text"] = (aktuell["text"] + " " + text).strip()
            aktuell["ende"] = ende

    if aktuell is not None:
        absaetze.append(aktuell)

    for a in absaetze:
        a["dauer"] = round(max(0.0, a["ende"] - a["start"]), 1)

    return absaetze


def personen_liste(absaetze):
    """Welche Personen kommen vor, und wie viel sagt jede."""
    zusammen = {}
    for a in absaetze:
        if a.get("geraeusch"):
            continue
        nummer = int(a.get("person", 0) or 0)
        eintrag = zusammen.setdefault(
            nummer, {"person": nummer, "absaetze": 0, "sekunden": 0.0, "woerter": 0})
        eintrag["absaetze"] += 1
        eintrag["sekunden"] += a.get("dauer", 0)
        eintrag["woerter"] += len(a["text"].split())

    for eintrag in zusammen.values():
        eintrag["sekunden"] = round(eintrag["sekunden"], 1)

    return sorted(zusammen.values(), key=lambda e: e["person"])


def name_von(person, namen=None):
    """Person 2 -> 'Person 2', oder der selbst vergebene Name."""
    person = int(person or 0)
    if namen and str(person) in namen and namen[str(person)].strip():
        return namen[str(person)].strip()
    if person <= 0:
        return "Unbekannt"
    return "Person %d" % person


def filtern(absaetze, personen=None, geraeusche=True):
    """
    Waehlt aus, was mitkommt.
    personen: Liste von Nummern, None = alle.
    """
    raus = []
    for a in absaetze:
        if a.get("geraeusch"):
            if geraeusche:
                raus.append(a)
            continue
        if personen is None or int(a.get("person", 0) or 0) in personen:
            raus.append(a)
    return raus


def als_text(absaetze, mit_zeit=False, namen=None, mit_person=True):
    """Absaetze zu einem fertigen Fliesstext zusammensetzen."""
    teile = []
    for a in absaetze:
        kopf = []
        if mit_zeit:
            kopf.append("[%s]" % zeitstempel(a["start"]))
        if mit_person and not a.get("geraeusch"):
            kopf.append("%s:" % name_von(a.get("person"), namen))

        if kopf:
            teile.append("%s\n%s" % (" ".join(kopf), a["text"]))
        else:
            teile.append(a["text"])
    return "\n\n".join(teile)
