# -*- coding: utf-8 -*-
"""
Macht aus den vielen kleinen Whisper-Schnipseln lesbare Absaetze.

Whisper liefert Saetze im 3-bis-8-Sekunden-Takt. Am Stueck gelesen ist das
eine Bleiwueste. Hier wird nach Sprechpausen und Satzenden gruppiert,
damit im PDF echte Absaetze stehen.
"""

# Ab dieser Sprechpause (in Sekunden) beginnt ein neuer Absatz.
PAUSE_FUER_NEUEN_ABSATZ = 1.4

# Spaetestens nach so vielen Zeichen wird umgebrochen, auch ohne Pause.
MAX_ZEICHEN_PRO_ABSATZ = 700

# So kurz darf ein Absatz nicht sein, sonst wird er angehaengt.
MIN_ZEICHEN_PRO_ABSATZ = 80

SATZENDE = (".", "!", "?", ":")


def zeitstempel(sekunden):
    """1837.4 -> '00:30:37'"""
    sekunden = int(sekunden)
    return "%02d:%02d:%02d" % (sekunden // 3600, (sekunden % 3600) // 60, sekunden % 60)


def bauen(segmente):
    """
    segmente: Liste von dicts mit 'start', 'ende', 'text'
    Rueckgabe: Liste von dicts mit 'start', 'ende', 'text'  (je ein Absatz)
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

        if aktuell is None:
            aktuell = {"start": start, "ende": ende, "text": text}
            continue

        pause = start - aktuell["ende"]
        zu_lang = len(aktuell["text"]) >= MAX_ZEICHEN_PRO_ABSATZ
        satz_zu_ende = aktuell["text"].endswith(SATZENDE)
        lang_genug = len(aktuell["text"]) >= MIN_ZEICHEN_PRO_ABSATZ

        # Neuer Absatz, wenn eine echte Pause auf ein Satzende trifft,
        # oder wenn der Absatz schlicht zu lang wird.
        neuer_absatz = (
            (pause >= PAUSE_FUER_NEUEN_ABSATZ and satz_zu_ende and lang_genug)
            or zu_lang
        )

        if neuer_absatz:
            absaetze.append(aktuell)
            aktuell = {"start": start, "ende": ende, "text": text}
        else:
            aktuell["text"] = (aktuell["text"] + " " + text).strip()
            aktuell["ende"] = ende

    if aktuell is not None:
        absaetze.append(aktuell)

    return absaetze


def als_text(absaetze, mit_zeit=False):
    """Absaetze zu einem fertigen Fliesstext zusammensetzen."""
    teile = []
    for a in absaetze:
        if mit_zeit:
            teile.append("[%s]\n%s" % (zeitstempel(a["start"]), a["text"]))
        else:
            teile.append(a["text"])
    return "\n\n".join(teile)
