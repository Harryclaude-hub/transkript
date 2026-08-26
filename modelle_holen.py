# -*- coding: utf-8 -*-
"""
Holt die Modelle fuer Stimmenerkennung und Tonerkennung.

Wird von installieren.bat aufgerufen. Kann jederzeit erneut laufen,
schon vorhandene Modelle werden uebersprungen.
"""

import sys
import tarfile
import urllib.request
from pathlib import Path

BASIS = Path(__file__).resolve().parent
ZIEL = BASIS / "modelle" / "stimmen"

QUELLE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"

PAKETE = [
    {
        "name": "Sprecher-Trennung",
        "url": QUELLE + "/speaker-segmentation-models/"
               "sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
        "pruefen": "sherpa-onnx-pyannote-segmentation-3-0/model.onnx",
        "auspacken": True,
    },
    {
        "name": "Sprecher-Fingerabdruck",
        "url": QUELLE + "/speaker-recongition-models/"
               "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        "pruefen": "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
        "auspacken": False,
    },
    {
        "name": "Tonerkennung (Musik, Hund, Applaus ...)",
        "url": QUELLE + "/audio-tagging-models/"
               "sherpa-onnx-ced-base-audio-tagging-2024-04-19.tar.bz2",
        "pruefen": "sherpa-onnx-ced-base-audio-tagging-2024-04-19/model.onnx",
        "auspacken": True,
    },
]


def herunterladen(url, ziel, melden):
    def fortschritt(bloecke, blockgroesse, gesamt):
        if gesamt <= 0:
            return
        anteil = min(100, bloecke * blockgroesse * 100 // gesamt)
        if anteil % 10 == 0:
            melden("     %d%%" % anteil)

    letzter = [-1]

    def haken(bloecke, blockgroesse, gesamt):
        if gesamt <= 0:
            return
        anteil = min(100, int(bloecke * blockgroesse * 100 / gesamt))
        if anteil >= letzter[0] + 20:
            letzter[0] = anteil
            melden("     %d%% von %.0f MB" % (anteil, gesamt / 1048576))

    urllib.request.urlretrieve(url, ziel, reporthook=haken)


def main():
    ZIEL.mkdir(parents=True, exist_ok=True)
    fehlgeschlagen = []

    for paket in PAKETE:
        pruefpfad = ZIEL / paket["pruefen"]
        if pruefpfad.exists():
            print("  -> %s: schon da." % paket["name"], flush=True)
            continue

        print("  -> %s wird geholt ..." % paket["name"], flush=True)
        try:
            dateiname = paket["url"].rsplit("/", 1)[-1]
            zwischen = ZIEL / dateiname
            herunterladen(paket["url"], zwischen,
                          lambda t: print(t, flush=True))

            if paket["auspacken"]:
                with tarfile.open(zwischen, "r:bz2") as archiv:
                    archiv.extractall(ZIEL)
                zwischen.unlink()

            print("     fertig.", flush=True)
        except Exception as fehler:
            print("     FEHLGESCHLAGEN: %s" % fehler, flush=True)
            fehlgeschlagen.append(paket["name"])

    if fehlgeschlagen:
        print("\n  Nicht geladen: %s" % ", ".join(fehlgeschlagen), flush=True)
        print("  Das Programm laeuft trotzdem, nur ohne Stimmenerkennung.",
              flush=True)
        return 1

    print("\n  Alle Modelle fuer Stimmen und Toene sind bereit.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
