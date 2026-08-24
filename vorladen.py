# -*- coding: utf-8 -*-
"""Laedt die Sprachmodelle einmalig herunter, damit der erste echte
Einsatz nicht mitten drin ins Warten geraet."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from kern import einstellungen, motor   # noqa: E402


def main():
    daten = einstellungen.laden()
    gewuenscht = []
    for name in (daten["modell_live"], daten["modell_datei"]):
        if name not in gewuenscht:
            gewuenscht.append(name)

    for name in gewuenscht:
        print("  -> Modell '%s' wird geholt ..." % name, flush=True)
        try:
            motor.modell_holen(name, melden=None)
            print("     fertig.", flush=True)
        except Exception as fehler:
            print("     FEHLGESCHLAGEN: %s" % fehler, flush=True)
            print("     Das Modell wird dann beim ersten Einsatz geholt.",
                  flush=True)


if __name__ == "__main__":
    main()
