# -*- coding: utf-8 -*-
"""
Transkript - schlichtes Mitschrift-Programm.

Startet einen kleinen Server auf diesem Laptop. Die Bedienung laeuft ueber
den Browser, auch vom Handy aus, solange beide im gleichen WLAN sind.

Nichts verlaesst diesen Rechner. Die Erkennung passiert lokal.
"""

import os
import socket
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path

# Damit "from kern import ..." auch bei Doppelklick funktioniert.
BASIS = Path(__file__).resolve().parent
sys.path.insert(0, str(BASIS))

# Umlaute im schwarzen Fenster nicht am Programm scheitern lassen.
for kanal in (sys.stdout, sys.stderr):
    try:
        kanal.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from kern import absaetze as absatz_bauer      # noqa: E402
from kern import ausgabe, einstellungen, live, motor  # noqa: E402
from kern.orion import orion                   # noqa: E402

try:
    from flask import (Flask, jsonify, request, send_from_directory,
                       send_file)
except ImportError:
    print("\nFlask fehlt. Bitte einmal installieren.bat ausfuehren.\n")
    input("Enter zum Schliessen ...")
    sys.exit(1)


app = Flask(__name__, static_folder=None)

EINST = einstellungen.laden()

# Das Transkript, an dem gerade gearbeitet wird.
AKTUELL = {"titel": "", "segmente": [], "dauer": 0.0, "quelle": "",
           "korrekturen": 0}

LIVE = {"lauf": None}
AUFTRAEGE = {}
PROTOKOLL = []
SCHLOSS = threading.Lock()


# ----------------------------------------------------------------------
def melden(text):
    zeile = "%s  %s" % (datetime.now().strftime("%H:%M:%S"), text)
    print(zeile, flush=True)
    with SCHLOSS:
        PROTOKOLL.append(zeile)
        del PROTOKOLL[:-200]


def eigene_adresse():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        adresse = s.getsockname()[0]
        s.close()
        return adresse
    except Exception:
        return "127.0.0.1"


def aktuelle_absaetze():
    return absatz_bauer.bauen(AKTUELL["segmente"])


# ----------------------------------------------------------------------
# Oberflaeche ausliefern
# ----------------------------------------------------------------------
OBERFLAECHE = BASIS / "weboberflaeche"


@app.route("/")
def seite():
    return send_from_directory(OBERFLAECHE, "index.html")


@app.route("/<pfad>")
def dateien(pfad):
    if pfad in ("stil.css", "logik.js"):
        return send_from_directory(OBERFLAECHE, pfad)
    return ("Nicht gefunden", 404)


# ----------------------------------------------------------------------
# Zustand
# ----------------------------------------------------------------------
@app.route("/api/zustand")
def zustand():
    lauf = LIVE["lauf"]

    if lauf and lauf.laeuft:
        AKTUELL["segmente"] = lauf.stand()
        AKTUELL["dauer"] = lauf.aufgenommene_sekunden
        AKTUELL["korrekturen"] = lauf.korrekturen

    ab = aktuelle_absaetze()

    auftraege = []
    with SCHLOSS:
        for kennung, a in list(AUFTRAEGE.items()):
            auftraege.append({
                "id": kennung, "name": a["name"], "stand": a["stand"],
                "text": a["text"], "anteil": a["anteil"],
            })

    return jsonify({
        "einstellungen": EINST,
        "live": {
            "laeuft": bool(lauf and lauf.laeuft),
            "pausiert": bool(lauf and lauf.pausiert),
            "aufgenommen": round(lauf.aufgenommene_sekunden, 1) if lauf else 0,
            "erkannt": round(lauf.erkannte_sekunden, 1) if lauf else 0,
            "pegel": round(min(1.0, (lauf.pegel * 12) if lauf else 0), 3),
            "fehler": lauf.fehler if lauf else None,
        },
        "transkript": {
            "titel": AKTUELL["titel"],
            "quelle": AKTUELL["quelle"],
            "dauer": round(AKTUELL["dauer"], 1),
            "korrekturen": AKTUELL["korrekturen"],
            "absaetze": ab,
            "woerter": sum(len(a["text"].split()) for a in ab),
        },
        "auftraege": auftraege,
        "protokoll": PROTOKOLL[-12:],
    })


@app.route("/api/geraete")
def geraete():
    liste, fehler = live.geraete_auflisten()
    return jsonify({"geraete": liste, "fehler": fehler})


# ----------------------------------------------------------------------
# Einstellungen und Orion
# ----------------------------------------------------------------------
@app.route("/api/einstellungen", methods=["POST"])
def einstellungen_speichern():
    global EINST
    daten = request.get_json(silent=True) or {}
    neu = dict(EINST)
    for schluessel in ("orion_an", "modell_live", "modell_datei", "sprache",
                       "zeitstempel", "live_block_sekunden"):
        if schluessel in daten:
            neu[schluessel] = daten[schluessel]
    EINST = einstellungen.speichern(neu)
    melden("Einstellungen gespeichert. Orion-Funktion: %s"
           % ("AN" if EINST["orion_an"] else "AUS"))
    return jsonify({"ok": True, "einstellungen": EINST})


@app.route("/api/begriffe", methods=["GET", "POST"])
def begriffe():
    from kern.orion import DATEI_BEGRIFFE, DATEI_KORREKTUREN

    if request.method == "POST":
        daten = request.get_json(silent=True) or {}
        if "begriffe" in daten:
            DATEI_BEGRIFFE.write_text(daten["begriffe"], encoding="utf-8")
        if "korrekturen" in daten:
            DATEI_KORREKTUREN.write_text(daten["korrekturen"], encoding="utf-8")
        zahlen = orion.laden()
        melden("Orion-Begriffe neu geladen: %d Begriffe, %d Korrekturen"
               % (zahlen["begriffe"], zahlen["korrekturen"]))
        return jsonify({"ok": True, **zahlen})

    return jsonify({
        "begriffe": DATEI_BEGRIFFE.read_text(encoding="utf-8")
                    if DATEI_BEGRIFFE.exists() else "",
        "korrekturen": DATEI_KORREKTUREN.read_text(encoding="utf-8")
                       if DATEI_KORREKTUREN.exists() else "",
        "anzahl_begriffe": len(orion.begriffe),
        "anzahl_korrekturen": len(orion.korrekturen),
    })


# ----------------------------------------------------------------------
# Live-Aufnahme
# ----------------------------------------------------------------------
@app.route("/api/live/start", methods=["POST"])
def live_start():
    if LIVE["lauf"] and LIVE["lauf"].laeuft:
        return jsonify({"ok": False, "fehler": "Es laeuft schon eine Aufnahme."})

    daten = request.get_json(silent=True) or {}
    geraet_id = daten.get("geraet")
    if not geraet_id:
        return jsonify({"ok": False, "fehler": "Kein Mikrofon ausgewaehlt."})

    titel = daten.get("titel") or ("Mitschrift %s"
                                   % datetime.now().strftime("%d.%m.%Y %H:%M"))

    lauf = live.LiveAufnahme(
        geraet_id=geraet_id,
        modell_name=EINST["modell_live"],
        sprache=EINST["sprache"],
        orion_an=bool(EINST["orion_an"]),
        block_sekunden=EINST["live_block_sekunden"],
        titel=titel,
        melden=melden,
    )

    try:
        lauf.starten()
    except Exception as fehler:
        melden("Start fehlgeschlagen: %s" % fehler)
        return jsonify({"ok": False, "fehler": str(fehler)})

    LIVE["lauf"] = lauf
    AKTUELL.update({"titel": titel, "segmente": [], "dauer": 0.0,
                    "quelle": "Live-Aufnahme", "korrekturen": 0})
    return jsonify({"ok": True})


@app.route("/api/live/stopp", methods=["POST"])
def live_stopp():
    lauf = LIVE["lauf"]
    if not lauf:
        return jsonify({"ok": False, "fehler": "Es laeuft keine Aufnahme."})

    lauf.stoppen()
    AKTUELL["segmente"] = lauf.stand()
    AKTUELL["dauer"] = lauf.aufgenommene_sekunden
    AKTUELL["korrekturen"] = lauf.korrekturen
    melden("Fertig. %d Abschnitte erkannt. Tondatei: %s"
           % (len(AKTUELL["segmente"]),
              lauf.wav_pfad.name if lauf.wav_pfad else "-"))
    return jsonify({"ok": True})


@app.route("/api/live/pause", methods=["POST"])
def live_pause():
    lauf = LIVE["lauf"]
    if not lauf or not lauf.laeuft:
        return jsonify({"ok": False, "fehler": "Es laeuft keine Aufnahme."})
    return jsonify({"ok": True, "pausiert": lauf.pause_umschalten()})


# ----------------------------------------------------------------------
# Datei-Transkription
# ----------------------------------------------------------------------
ERLAUBT = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".opus", ".flac",
           ".aac", ".wma", ".webm", ".mkv", ".mov", ".amr", ".3gp"}


def auftrag_abarbeiten(kennung, pfad, titel, modell_name):
    def stand(text, anteil=None):
        with SCHLOSS:
            if kennung in AUFTRAEGE:
                AUFTRAEGE[kennung]["text"] = text
                if anteil is not None:
                    AUFTRAEGE[kennung]["anteil"] = anteil
        melden("[%s] %s" % (titel[:24], text))

    try:
        with SCHLOSS:
            AUFTRAEGE[kennung]["stand"] = "laeuft"

        stand("Modell wird vorbereitet ...", 0.02)

        dauer = [0.0]

        def fortschritt(sekunde):
            dauer[0] = max(dauer[0], sekunde)
            stand("Erkannt bis Minute %d ..." % int(sekunde // 60))

        segmente, info = motor.transkribieren(
            str(pfad), modell_name,
            sprache=EINST["sprache"], orion_an=bool(EINST["orion_an"]),
            melden=stand, fortschritt=fortschritt,
        )

        gesamt = float(getattr(info, "duration", 0) or dauer[0])
        segmente, korrekturen = motor.nachbearbeiten(
            segmente, orion_an=bool(EINST["orion_an"])
        )

        AKTUELL.update({
            "titel": titel, "segmente": segmente, "dauer": gesamt,
            "quelle": pfad.name, "korrekturen": korrekturen,
        })

        with SCHLOSS:
            AUFTRAEGE[kennung]["stand"] = "fertig"
            AUFTRAEGE[kennung]["anteil"] = 1.0
            AUFTRAEGE[kennung]["text"] = (
                "Fertig: %d Abschnitte, %d Fachbegriffe korrigiert."
                % (len(segmente), korrekturen)
            )
        melden("Fertig mit '%s'." % titel)

    except Exception as fehler:
        traceback.print_exc()
        with SCHLOSS:
            AUFTRAEGE[kennung]["stand"] = "fehler"
            AUFTRAEGE[kennung]["text"] = str(fehler)
        melden("FEHLER bei '%s': %s" % (titel, fehler))


@app.route("/api/datei", methods=["POST"])
def datei_hochladen():
    if "datei" not in request.files:
        return jsonify({"ok": False, "fehler": "Keine Datei angekommen."})

    datei = request.files["datei"]
    if not datei.filename:
        return jsonify({"ok": False, "fehler": "Keine Datei ausgewaehlt."})

    endung = Path(datei.filename).suffix.lower()
    if endung not in ERLAUBT:
        return jsonify({
            "ok": False,
            "fehler": "Dateiart %s wird nicht unterstuetzt. Erlaubt: %s"
                      % (endung, ", ".join(sorted(ERLAUBT))),
        })

    live.AUFNAHME_ORDNER.mkdir(parents=True, exist_ok=True)
    stempel = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    sicher = "".join(c for c in Path(datei.filename).stem
                     if c.isalnum() or c in " -_")[:50] or "audio"
    ziel = live.AUFNAHME_ORDNER / ("%s_%s%s" % (stempel, sicher, endung))
    datei.save(str(ziel))

    groesse = ziel.stat().st_size / (1024 * 1024)
    melden("Datei angekommen: %s (%.1f MB)" % (ziel.name, groesse))

    kennung = uuid.uuid4().hex[:8]
    titel = request.form.get("titel") or Path(datei.filename).stem

    with SCHLOSS:
        AUFTRAEGE[kennung] = {"name": titel, "stand": "wartet",
                              "text": "In der Warteschlange ...", "anteil": 0.0}

    threading.Thread(
        target=auftrag_abarbeiten,
        args=(kennung, ziel, titel, EINST["modell_datei"]),
        daemon=True,
    ).start()

    return jsonify({"ok": True, "id": kennung})


@app.route("/api/auftrag/<kennung>", methods=["DELETE"])
def auftrag_entfernen(kennung):
    with SCHLOSS:
        AUFTRAEGE.pop(kennung, None)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Speichern und Herunterladen
# ----------------------------------------------------------------------
@app.route("/api/speichern", methods=["POST"])
def speichern():
    daten = request.get_json(silent=True) or {}
    format_name = (daten.get("format") or "pdf").lower()

    lauf = LIVE["lauf"]
    if lauf and lauf.laeuft:
        AKTUELL["segmente"] = lauf.stand()
        AKTUELL["dauer"] = lauf.aufgenommene_sekunden

    ab = aktuelle_absaetze()
    if not ab:
        return jsonify({"ok": False,
                        "fehler": "Es gibt noch kein Transkript zum Speichern."})

    titel = daten.get("titel") or AKTUELL["titel"] or "Transkript"

    try:
        pfad = ausgabe.schreiben(
            format_name, titel, ab,
            orion_an=bool(EINST["orion_an"]),
            mit_zeit=bool(EINST["zeitstempel"]),
            dauer_sekunden=AKTUELL["dauer"],
        )
    except Exception as fehler:
        melden("Speichern fehlgeschlagen: %s" % fehler)
        return jsonify({"ok": False, "fehler": str(fehler)})

    melden("Gespeichert: %s" % pfad.name)
    return jsonify({"ok": True, "name": pfad.name,
                    "link": "/ergebnis/" + pfad.name})


@app.route("/api/ergebnisse")
def ergebnisse():
    ausgabe.ERGEBNIS_ORDNER.mkdir(parents=True, exist_ok=True)
    liste = []
    for p in sorted(ausgabe.ERGEBNIS_ORDNER.iterdir(),
                    key=lambda x: x.stat().st_mtime, reverse=True)[:40]:
        if p.is_file():
            liste.append({
                "name": p.name,
                "groesse": round(p.stat().st_size / 1024, 1),
                "link": "/ergebnis/" + p.name,
                "wann": datetime.fromtimestamp(p.stat().st_mtime)
                        .strftime("%d.%m. %H:%M"),
            })
    return jsonify({"dateien": liste,
                    "ordner": str(ausgabe.ERGEBNIS_ORDNER)})


@app.route("/ergebnis/<name>")
def ergebnis_holen(name):
    pfad = (ausgabe.ERGEBNIS_ORDNER / name).resolve()
    if not str(pfad).startswith(str(ausgabe.ERGEBNIS_ORDNER.resolve())):
        return ("Nicht erlaubt", 403)
    if not pfad.exists():
        return ("Nicht gefunden", 404)
    return send_file(str(pfad), as_attachment=True, download_name=name)


@app.route("/api/ordner-oeffnen", methods=["POST"])
def ordner_oeffnen():
    try:
        os.startfile(str(ausgabe.ERGEBNIS_ORDNER))
        return jsonify({"ok": True})
    except Exception as fehler:
        return jsonify({"ok": False, "fehler": str(fehler)})


@app.route("/api/leeren", methods=["POST"])
def leeren():
    AKTUELL.update({"titel": "", "segmente": [], "dauer": 0.0,
                    "quelle": "", "korrekturen": 0})
    melden("Transkript geleert.")
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
def start():
    port = int(EINST.get("port", 7345))
    adresse = eigene_adresse()

    print("")
    print("=" * 62)
    print("  T R A N S K R I P T")
    print("=" * 62)
    print("  Auf diesem Laptop :  http://localhost:%d" % port)
    print("  Vom Handy aus     :  http://%s:%d" % (adresse, port))
    print("  (Handy muss im gleichen WLAN sein)")
    print("")
    print("  Orion-Funktion    :  %s"
          % ("EIN" if EINST["orion_an"] else "AUS"))
    print("  Fachbegriffe      :  %d geladen" % len(orion.begriffe))
    print("  Ergebnisse        :  %s" % ausgabe.ERGEBNIS_ORDNER)
    print("")
    print("  Dieses Fenster offen lassen. Zum Beenden: Strg + C")
    print("=" * 62)
    print("")

    def browser_oeffnen():
        time.sleep(1.5)
        try:
            webbrowser.open("http://localhost:%d" % port)
        except Exception:
            pass

    if not os.environ.get("TRANSKRIPT_KEIN_BROWSER"):
        threading.Thread(target=browser_oeffnen, daemon=True).start()

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True,
            use_reloader=False)


if __name__ == "__main__":
    try:
        start()
    except KeyboardInterrupt:
        print("\nBeendet.")
    except Exception as fehler:
        traceback.print_exc()
        input("\nFehler. Enter zum Schliessen ...")
