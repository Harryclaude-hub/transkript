# -*- coding: utf-8 -*-
"""
Erzeugt die App-Symbole fuer den Startbildschirm.

Das Bild zeigt zwei Transkript-Zeilen mit farbigem Rand, genau wie sie in
der App aussehen. Blau und rot stehen fuer zwei verschiedene Personen.

Einmal ausfuehren, danach liegen die PNG-Dateien in docs/.
"""

from pathlib import Path
from PIL import Image, ImageDraw

HIER = Path(__file__).resolve().parent

GRUND = (14, 17, 22)
KARTE = (22, 27, 34)
BLAU = (37, 99, 235)
ROT = (220, 38, 38)
HELL = (230, 237, 243)
LEISE = (110, 122, 138)


def zeichnen(kante, rand_anteil=0.0):
    """rand_anteil: Luft aussen herum, fuer die maskierbare Fassung."""
    bild = Image.new("RGBA", (kante, kante), (0, 0, 0, 0))
    stift = ImageDraw.Draw(bild)

    luft = int(kante * rand_anteil)
    innen = kante - 2 * luft
    ecke = int(innen * 0.22)

    stift.rounded_rectangle([luft, luft, luft + innen, luft + innen],
                            radius=ecke, fill=GRUND)

    # Zwei Zeilen wie im Transkript
    zeilen_hoehe = innen * 0.30
    abstand = innen * 0.09
    links = luft + innen * 0.17
    breite = innen * 0.66
    oben = luft + (innen - (2 * zeilen_hoehe + abstand)) / 2

    for nummer, farbe in enumerate((BLAU, ROT)):
        y = oben + nummer * (zeilen_hoehe + abstand)
        balken = max(3, int(innen * 0.045))

        # farbiger Rand links
        stift.rounded_rectangle(
            [links, y, links + balken, y + zeilen_hoehe],
            radius=balken // 2, fill=farbe)

        # Textzeilen daneben
        text_links = links + balken + innen * 0.055
        strich = max(2, int(innen * 0.035))
        for i, anteil in enumerate((1.0, 0.72)):
            sy = y + zeilen_hoehe * (0.22 + i * 0.42)
            stift.rounded_rectangle(
                [text_links, sy,
                 text_links + (breite - balken - innen * 0.055) * anteil,
                 sy + strich],
                radius=strich / 2,
                fill=HELL if i == 0 else LEISE)

    return bild


def main():
    for kante in (192, 512):
        zeichnen(kante).save(HIER / f"symbol-{kante}.png")
        print(f"symbol-{kante}.png geschrieben")

    # Maskierbar: Android schneidet die Ecken selbst, deshalb Luft lassen
    maske = Image.new("RGBA", (512, 512), GRUND + (255,))
    maske.alpha_composite(zeichnen(512, rand_anteil=0.12))
    maske.save(HIER / "symbol-maske.png")
    print("symbol-maske.png geschrieben")


if __name__ == "__main__":
    main()
