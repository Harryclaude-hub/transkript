# -*- coding: utf-8 -*-
"""
Schreibt das fertige Transkript als PDF, Word-Datei oder Textdatei.
Alle Dateien landen im Ordner 'ergebnisse'.
"""

import re
from datetime import datetime
from pathlib import Path

from kern.absaetze import zeitstempel

ERGEBNIS_ORDNER = Path(__file__).resolve().parent.parent / "ergebnisse"


def _sauberer_name(text):
    """Macht aus einem beliebigen Titel einen gueltigen Dateinamen."""
    text = (text or "Transkript").strip()
    text = re.sub(r"[^\w\s\-\.]", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", "_", text).strip("._")
    return text[:60] or "Transkript"


def _zielpfad(titel, endung):
    ERGEBNIS_ORDNER.mkdir(parents=True, exist_ok=True)
    stempel = datetime.now().strftime("%Y-%m-%d_%H-%M")
    pfad = ERGEBNIS_ORDNER / ("%s_%s.%s" % (stempel, _sauberer_name(titel), endung))

    # Falls der Name schon existiert, hinten durchzaehlen statt ueberschreiben.
    zaehler = 2
    while pfad.exists():
        pfad = ERGEBNIS_ORDNER / (
            "%s_%s_%d.%s" % (stempel, _sauberer_name(titel), zaehler, endung)
        )
        zaehler += 1
    return pfad


def _kopfzeilen(titel, absaetze, orion_an, dauer_sekunden):
    woerter = sum(len(a["text"].split()) for a in absaetze)
    return [
        ("Erstellt", datetime.now().strftime("%d.%m.%Y um %H:%M Uhr")),
        ("Laenge", zeitstempel(dauer_sekunden) if dauer_sekunden else "unbekannt"),
        ("Woerter", str(woerter)),
        ("Absaetze", str(len(absaetze))),
        ("Orion-Funktion", "eingeschaltet" if orion_an else "ausgeschaltet"),
    ]


# ----------------------------------------------------------------------
def als_txt(titel, absaetze, orion_an=True, mit_zeit=False, dauer_sekunden=0):
    pfad = _zielpfad(titel, "txt")

    zeilen = [titel, "=" * len(titel), ""]
    for schild, wert in _kopfzeilen(titel, absaetze, orion_an, dauer_sekunden):
        zeilen.append("%-16s %s" % (schild + ":", wert))
    zeilen.append("")
    zeilen.append("-" * 60)
    zeilen.append("")

    for a in absaetze:
        if mit_zeit:
            zeilen.append("[%s]" % zeitstempel(a["start"]))
        zeilen.append(a["text"])
        zeilen.append("")

    pfad.write_text("\n".join(zeilen), encoding="utf-8")
    return pfad


# ----------------------------------------------------------------------
def als_docx(titel, absaetze, orion_an=True, mit_zeit=False, dauer_sekunden=0):
    try:
        from docx import Document
        from docx.shared import Pt, RGBColor
    except ImportError:
        raise RuntimeError(
            "python-docx fehlt. Bitte einmal installieren.bat ausfuehren."
        )

    pfad = _zielpfad(titel, "docx")
    dok = Document()

    normal = dok.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)

    dok.add_heading(titel, level=0)

    for schild, wert in _kopfzeilen(titel, absaetze, orion_an, dauer_sekunden):
        p = dok.add_paragraph()
        lauf = p.add_run("%s: " % schild)
        lauf.bold = True
        lauf.font.size = Pt(9)
        lauf2 = p.add_run(wert)
        lauf2.font.size = Pt(9)
        p.paragraph_format.space_after = Pt(0)

    dok.add_paragraph()

    for a in absaetze:
        if mit_zeit:
            zp = dok.add_paragraph()
            lauf = zp.add_run(zeitstempel(a["start"]))
            lauf.bold = True
            lauf.font.size = Pt(9)
            lauf.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
            zp.paragraph_format.space_after = Pt(2)

        p = dok.add_paragraph(a["text"])
        p.paragraph_format.space_after = Pt(10)

    dok.save(str(pfad))
    return pfad


# ----------------------------------------------------------------------
def als_pdf(titel, absaetze, orion_an=True, mit_zeit=False, dauer_sekunden=0):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.lib import colors
        from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                        HRFlowable)
    except ImportError:
        raise RuntimeError(
            "reportlab fehlt. Bitte einmal installieren.bat ausfuehren."
        )

    from xml.sax.saxutils import escape

    pfad = _zielpfad(titel, "pdf")

    dok = SimpleDocTemplate(
        str(pfad), pagesize=A4,
        leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=20 * mm, bottomMargin=18 * mm,
        title=titel, author="Transkript",
    )

    basis = getSampleStyleSheet()

    stil_titel = ParagraphStyle(
        "TitelGross", parent=basis["Title"],
        fontName="Helvetica-Bold", fontSize=19, leading=23,
        spaceAfter=4, alignment=0, textColor=colors.HexColor("#111111"),
    )
    stil_kopf = ParagraphStyle(
        "Kopf", parent=basis["Normal"],
        fontName="Helvetica", fontSize=8.5, leading=12,
        textColor=colors.HexColor("#666666"),
    )
    stil_zeit = ParagraphStyle(
        "Zeit", parent=basis["Normal"],
        fontName="Helvetica-Bold", fontSize=8, leading=11,
        textColor=colors.HexColor("#999999"), spaceAfter=2,
    )
    stil_text = ParagraphStyle(
        "Fliesstext", parent=basis["Normal"],
        fontName="Helvetica", fontSize=10.5, leading=15.5,
        spaceAfter=9, textColor=colors.HexColor("#1a1a1a"),
    )

    inhalt = [Paragraph(escape(titel), stil_titel)]

    kopf = "&nbsp;&nbsp;|&nbsp;&nbsp;".join(
        "%s: %s" % (escape(s), escape(w))
        for s, w in _kopfzeilen(titel, absaetze, orion_an, dauer_sekunden)
    )
    inhalt.append(Paragraph(kopf, stil_kopf))
    inhalt.append(Spacer(1, 5))
    inhalt.append(HRFlowable(width="100%", thickness=0.6,
                             color=colors.HexColor("#dddddd")))
    inhalt.append(Spacer(1, 9))

    for a in absaetze:
        if mit_zeit:
            inhalt.append(Paragraph(zeitstempel(a["start"]), stil_zeit))
        inhalt.append(Paragraph(escape(a["text"]), stil_text))

    def seitenzahl(leinwand, dokument):
        leinwand.saveState()
        leinwand.setFont("Helvetica", 8)
        leinwand.setFillColor(colors.HexColor("#999999"))
        leinwand.drawRightString(A4[0] - 22 * mm, 12 * mm,
                                 "Seite %d" % dokument.page)
        leinwand.restoreState()

    dok.build(inhalt, onFirstPage=seitenzahl, onLaterPages=seitenzahl)
    return pfad


# ----------------------------------------------------------------------
SCHREIBER = {"pdf": als_pdf, "docx": als_docx, "txt": als_txt}


def schreiben(format_name, titel, absaetze, orion_an=True, mit_zeit=False,
              dauer_sekunden=0):
    if format_name not in SCHREIBER:
        raise ValueError("Unbekanntes Format: %s" % format_name)
    if not absaetze:
        raise ValueError("Es gibt nichts zu speichern, das Transkript ist leer.")
    return SCHREIBER[format_name](
        titel, absaetze, orion_an=orion_an, mit_zeit=mit_zeit,
        dauer_sekunden=dauer_sekunden,
    )
