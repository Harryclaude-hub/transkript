# -*- coding: utf-8 -*-
"""
Transkript - Mitschrift mit Stimmenerkennung.

Startet einen kleinen Server auf diesem Laptop. Die Bedienung laeuft ueber
den Browser, auch vom Handy aus, solange beide im gleichen WLAN sind.

Nichts verlaesst diesen Rechner. Erkennung, Stimmentrennung und
Tonerkennung passieren lokal.
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

BASIS = Path(__file__).resolve().parent
sys.path.insert(0, str(BASIS))

# Umlaute im schwarzen Fenster nicht am Programm scheitern lassen.
for kanal in (sys.stdout, sys.stderr):
    try:
        kanal.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from kern import ablage, absaetze as absatz_bauer, ausgabe   # noqa: E402
from kern import einstellungen, live, motor, stimmen         # noqa: E402
from kern.orion import orion                                 # noqa: E402

try:
    from flask import Flask, jsonify, request, send_from_directory, send_file
except ImportError:
    print("\nFlask fehlt. Bitte einmal installieren.bat ausfuehren.\n")
    input("Enter zum Schliessen ...")
    sys.exit(1)


app = Flask(__name__, static_folder=None)

EINST = einstellungen.laden()

LEER = {
    "kennung": None, "titel": "", "segmente": [], "dauer": 0.0,
    "quelle": "", "korrekturen": 0, "ton": "", "namen": {},
    "personen_bestimmt": False,
}
AKTUELL = dict(LEER)

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


def auftrag_anlegen(name):
    kennung = uuid.uuid4().hex[:8]
    with SCHLOSS:
        AUFTRAEGE[kennung] = {"name": name, "stand": "wartet",
                              "text": "In der Warteschlange ...", "anteil": 0.0}
    return kennung


def auftrag_setzen(kennung, stand=None, text=None, anteil=None):
    with SCHLOSS:
        if kennung not in AUFTRAEGE:
            return
        if stand is not None:
            AUFTRAEGE[kennung]["stand"] = stand
        if text is not None:
            AUFTRAEGE[kennung]["text"] = text
        if anteil is not None:
            AUFTRAEGE[kennung]["anteil"] = anteil


# ----------------------------------------------------------------------
# Oberflaeche
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
            auftraege.append({"id": kennung, "name": a["name"],
                              "stand": a["stand"], "text": a["text"],
                              "anteil": a["anteil"]})

    leute = absatz_bauer.personen_liste(ab)
    for e in leute:
        e["name"] = absatz_bauer.name_von(e["person"], AKTUELL["namen"])
        e["farbe"] = ausgabe.farbe_von(e["person"])

    return jsonify({
        "einstellungen": EINST,
        "koennen": stimmen.modelle_da(),
        "live": {
            "laeuft": bool(lauf and lauf.laeuft),
            "pausiert": bool(lauf and lauf.pausiert),
            "aufgenommen": round(lauf.aufgenommene_sekunden, 1) if lauf else 0,
            "erkannt": round(lauf.erkannte_sekunden, 1) if lauf else 0,
            "pegel": round(min(1.0, (lauf.pegel * 12) if lauf else 0), 3),
            "fehler": lauf.fehler if lauf else None,
        },
        "transkript": {
            "kennung": AKTUELL["kennung"],
            "titel": AKTUELL["titel"],
            "quelle": AKTUELL["quelle"],
            "dauer": round(AKTUELL["dauer"], 1),
            "korrekturen": AKTUELL["korrekturen"],
            "ton": AKTUELL["ton"],
            "namen": AKTUELL["namen"],
            "personen_bestimmt": AKTUELL["personen_bestimmt"],
            "absaetze": ab,
            "personen": leute,
            "woerter": sum(len(a["text"].split()) for a in ab
                           if not a.get("geraeusch")),
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
                       "zeitstempel", "live_block_sekunden", "empfindlichkeit",
                       "stimmen_an", "anzahl_personen", "stimmen_aehnlichkeit",
                       "toene_an", "ton_schwelle", "musik_weglassen"):
        if schluessel in daten:
            neu[schluessel] = daten[schluessel]
    EINST = einstellungen.speichern(neu)
    melden("Einstellungen gespeichert.")
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
        return jsonify({"ok": False, "fehler": "Keine Aufnahmequelle ausgewaehlt."})

    titel = daten.get("titel") or ("Mitschrift %s"
                                   % datetime.now().strftime("%d.%m.%Y %H:%M"))

    lauf = live.LiveAufnahme(
        geraet_id=geraet_id, modell_name=EINST["modell_live"],
        sprache=EINST["sprache"], orion_an=bool(EINST["orion_an"]),
        block_sekunden=EINST["live_block_sekunden"], titel=titel,
        melden=melden, empfindlichkeit=EINST.get("empfindlichkeit", 3),
    )

    try:
        lauf.starten()
    except Exception as fehler:
        melden("Start fehlgeschlagen: %s" % fehler)
        return jsonify({"ok": False, "fehler": str(fehler)})

    LIVE["lauf"] = lauf
    AKTUELL.update(dict(LEER))
    AKTUELL.update({"titel": titel, "quelle": "Live-Aufnahme"})
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
    AKTUELL["ton"] = lauf.wav_pfad.name if lauf.wav_pfad else ""

    melden("Fertig. %d Abschnitte erkannt." % len(AKTUELL["segmente"]))

    if EINST.get("stimmen_an", True) and stimmen.modelle_da()["stimmen"]:
        sprecher_auftrag_starten()
        return jsonify({"ok": True, "sprecher_laeuft": True})

    return jsonify({"ok": True})


@app.route("/api/live/pause", methods=["POST"])
def live_pause():
    lauf = LIVE["lauf"]
    if not lauf or not lauf.laeuft:
        return jsonify({"ok": False, "fehler": "Es laeuft keine Aufnahme."})
    return jsonify({"ok": True, "pausiert": lauf.pause_umschalten()})


# ----------------------------------------------------------------------
# Stimmen bestimmen
# ----------------------------------------------------------------------
def sprecher_arbeit(kennung, tonpfad):
    def stand(text, anteil=None):
        auftrag_setzen(kennung, text=text, anteil=anteil)
        melden(text)

    try:
        auftrag_setzen(kennung, stand="laeuft")
        stand("Tonspur wird eingelesen ...", 0.05)
        ton = motor.ton_laden(tonpfad)

        stand("Stimmen werden getrennt ...", 0.2)
        abschnitte = stimmen.sprecher_finden(
            ton,
            empfindlichkeit=EINST.get("empfindlichkeit", 3),
            anzahl_personen=int(EINST.get("anzahl_personen", 0) or 0),
            aehnlichkeit=float(EINST.get("stimmen_aehnlichkeit", 0.5)),
            melden=lambda t: stand(t, 0.5),
        )

        segmente = [s for s in AKTUELL["segmente"] if not s.get("geraeusch")]
        stimmen.personen_zuordnen(segmente, abschnitte)

        toene = []
        if EINST.get("toene_an", True) and stimmen.modelle_da()["toene"]:
            stand("Geraeusche werden bestimmt ...", 0.75)
            toene = stimmen.toene_finden(
                ton, abschnitte,
                schwelle=float(EINST.get("ton_schwelle", 0.35)),
                melden=lambda t: stand(t, 0.85),
            )

        AKTUELL["segmente"] = stimmen.zusammenfuehren(
            segmente, toene,
            musik_weglassen=bool(EINST.get("musik_weglassen", False)))
        AKTUELL["personen_bestimmt"] = True

        anzahl = len({a["person"] for a in abschnitte})
        auftrag_setzen(kennung, stand="fertig", anteil=1.0,
                       text="Fertig: %d Personen, %d Geraeusche."
                            % (anzahl, len(toene)))
        melden("Stimmen bestimmt: %d Personen, %d Geraeusche."
               % (anzahl, len(toene)))

    except Exception as fehler:
        traceback.print_exc()
        auftrag_setzen(kennung, stand="fehler", text=str(fehler))
        melden("FEHLER bei der Stimmenerkennung: %s" % fehler)


def sprecher_auftrag_starten():
    if not AKTUELL["ton"]:
        return None
    tonpfad = live.AUFNAHME_ORDNER / AKTUELL["ton"]
    if not tonpfad.exists():
        return None

    kennung = auftrag_anlegen("Stimmen bestimmen")
    threading.Thread(target=sprecher_arbeit, args=(kennung, tonpfad),
                     daemon=True).start()
    return kennung


@app.route("/api/sprecher", methods=["POST"])
def sprecher():
    if not stimmen.modelle_da()["stimmen"]:
        return jsonify({"ok": False, "fehler":
                        "Die Modelle fehlen. Bitte 'python modelle_holen.py' "
                        "ausfuehren."})
    if not AKTUELL["segmente"]:
        return jsonify({"ok": False, "fehler": "Es gibt noch kein Transkript."})
    if not AKTUELL["ton"]:
        return jsonify({"ok": False, "fehler":
                        "Zu diesem Transkript ist keine Tonspur da."})

    kennung = sprecher_auftrag_starten()
    if not kennung:
        return jsonify({"ok": False, "fehler": "Die Tondatei wurde nicht gefunden."})
    return jsonify({"ok": True, "id": kennung})


@app.route("/api/namen", methods=["POST"])
def namen():
    daten = request.get_json(silent=True) or {}
    person = str(daten.get("person", "")).strip()
    name = (daten.get("name") or "").strip()[:40]
    if not person:
        return jsonify({"ok": False, "fehler": "Keine Person angegeben."})

    if name:
        AKTUELL["namen"][person] = name
    else:
        AKTUELL["namen"].pop(person, None)

    if AKTUELL["kennung"]:
        try:
            gespeichert = ablage.laden(AKTUELL["kennung"])
            gespeichert["namen"] = AKTUELL["namen"]
            ablage.speichern(gespeichert, AKTUELL["kennung"])
        except Exception:
            pass

    return jsonify({"ok": True, "namen": AKTUELL["namen"]})


# ----------------------------------------------------------------------
# Datei-Transkription
# ----------------------------------------------------------------------
ERLAUBT = {".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".opus", ".flac",
           ".aac", ".wma", ".webm", ".mkv", ".mov", ".amr", ".3gp"}


def datei_arbeit(kennung, pfad, titel):
    def stand(text, anteil=None):
        auftrag_setzen(kennung, text=text, anteil=anteil)
        melden("[%s] %s" % (titel[:20], text))

    try:
        auftrag_setzen(kennung, stand="laeuft")
        stand("Tonspur wird eingelesen ...", 0.02)
        ton = motor.ton_laden(pfad)
        gesamt = len(ton) / motor.ZIEL_RATE

        stand("Text wird erkannt ...", 0.05)

        def fortschritt(sekunde):
            anteil = 0.05 + 0.6 * (sekunde / gesamt if gesamt else 0)
            auftrag_setzen(kennung, anteil=min(0.65, anteil),
                           text="Text erkannt bis Minute %d von %d ..."
                                % (int(sekunde // 60), int(gesamt // 60)))

        segmente, _ = motor.transkribieren(
            ton, EINST["modell_datei"], sprache=EINST["sprache"],
            orion_an=bool(EINST["orion_an"]), melden=None,
            fortschritt=fortschritt,
            empfindlichkeit=EINST.get("empfindlichkeit", 3))

        segmente, korrekturen = motor.nachbearbeiten(
            segmente, orion_an=bool(EINST["orion_an"]))

        abschnitte = []
        toene = []
        if EINST.get("stimmen_an", True) and stimmen.modelle_da()["stimmen"]:
            stand("Stimmen werden getrennt ...", 0.7)
            abschnitte = stimmen.sprecher_finden(
                ton, empfindlichkeit=EINST.get("empfindlichkeit", 3),
                anzahl_personen=int(EINST.get("anzahl_personen", 0) or 0),
                aehnlichkeit=float(EINST.get("stimmen_aehnlichkeit", 0.5)),
                melden=lambda t: stand(t, 0.8))
            stimmen.personen_zuordnen(segmente, abschnitte)

            if EINST.get("toene_an", True) and stimmen.modelle_da()["toene"]:
                stand("Geraeusche werden bestimmt ...", 0.9)
                toene = stimmen.toene_finden(
                    ton, abschnitte,
                    schwelle=float(EINST.get("ton_schwelle", 0.35)),
                    melden=lambda t: stand(t, 0.95))

        AKTUELL.update(dict(LEER))
        AKTUELL.update({
            "titel": titel,
            "segmente": stimmen.zusammenfuehren(
                segmente, toene,
                musik_weglassen=bool(EINST.get("musik_weglassen", False))),
            "dauer": gesamt, "quelle": pfad.name, "korrekturen": korrekturen,
            "ton": pfad.name, "personen_bestimmt": bool(abschnitte),
        })

        anzahl = len({a["person"] for a in abschnitte}) if abschnitte else 0
        auftrag_setzen(kennung, stand="fertig", anteil=1.0,
                       text="Fertig: %d Abschnitte, %d Personen, %d Geraeusche."
                            % (len(segmente), anzahl, len(toene)))
        melden("Fertig mit '%s'." % titel)

    except Exception as fehler:
        traceback.print_exc()
        auftrag_setzen(kennung, stand="fehler", text=str(fehler))
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
        return jsonify({"ok": False,
                        "fehler": "Dateiart %s wird nicht unterstuetzt." % endung})

    live.AUFNAHME_ORDNER.mkdir(parents=True, exist_ok=True)
    stempel = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    sicher = "".join(c for c in Path(datei.filename).stem
                     if c.isalnum() or c in " -_")[:50] or "audio"
    ziel = live.AUFNAHME_ORDNER / ("%s_%s%s" % (stempel, sicher, endung))
    datei.save(str(ziel))

    melden("Datei angekommen: %s (%.1f MB)"
           % (ziel.name, ziel.stat().st_size / 1048576))

    titel = request.form.get("titel") or Path(datei.filename).stem
    kennung = auftrag_anlegen(titel)
    threading.Thread(target=datei_arbeit, args=(kennung, ziel, titel),
                     daemon=True).start()
    return jsonify({"ok": True, "id": kennung})


@app.route("/api/auftrag/<kennung>", methods=["DELETE"])
def auftrag_entfernen(kennung):
    with SCHLOSS:
        AUFTRAEGE.pop(kennung, None)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Ton abspielen
# ----------------------------------------------------------------------
@app.route("/ton/<name>")
def ton_holen(name):
    pfad = (live.AUFNAHME_ORDNER / name).resolve()
    if not str(pfad).startswith(str(live.AUFNAHME_ORDNER.resolve())):
        return ("Nicht erlaubt", 403)
    if not pfad.exists():
        return ("Nicht gefunden", 404)
    # conditional=True beantwortet Range-Anfragen, sonst kann der Browser
    # nicht an eine bestimmte Stelle springen.
    return send_file(str(pfad), conditional=True)


# ----------------------------------------------------------------------
# Ablage
# ----------------------------------------------------------------------
@app.route("/api/ablage", methods=["GET"])
def ablage_liste():
    return jsonify({"transkripte": ablage.liste()})


@app.route("/api/ablage/speichern", methods=["POST"])
def ablage_speichern():
    if not AKTUELL["segmente"]:
        return jsonify({"ok": False, "fehler": "Es gibt nichts zu speichern."})

    daten = request.get_json(silent=True) or {}
    if daten.get("titel"):
        AKTUELL["titel"] = daten["titel"].strip()[:80]

    kennung = ablage.speichern({
        "titel": AKTUELL["titel"] or "Ohne Titel",
        "segmente": AKTUELL["segmente"], "dauer": AKTUELL["dauer"],
        "quelle": AKTUELL["quelle"], "namen": AKTUELL["namen"],
        "ton": AKTUELL["ton"], "korrekturen": AKTUELL["korrekturen"],
        "personen_bestimmt": AKTUELL["personen_bestimmt"],
    }, AKTUELL["kennung"])

    AKTUELL["kennung"] = kennung
    melden("Transkript in der Ablage gespeichert: %s" % AKTUELL["titel"])
    return jsonify({"ok": True, "kennung": kennung})


@app.route("/api/ablage/oeffnen", methods=["POST"])
def ablage_oeffnen():
    daten = request.get_json(silent=True) or {}
    kennung = daten.get("kennung")
    try:
        gespeichert = ablage.laden(kennung)
    except Exception as fehler:
        return jsonify({"ok": False, "fehler": str(fehler)})

    AKTUELL.update(dict(LEER))
    AKTUELL.update({
        "kennung": kennung,
        "titel": gespeichert.get("titel", ""),
        "segmente": gespeichert.get("segmente", []),
        "dauer": float(gespeichert.get("dauer") or 0),
        "quelle": gespeichert.get("quelle", ""),
        "namen": gespeichert.get("namen", {}) or {},
        "ton": gespeichert.get("ton", ""),
        "korrekturen": int(gespeichert.get("korrekturen") or 0),
        "personen_bestimmt": bool(gespeichert.get("personen_bestimmt")),
    })
    melden("Transkript geoeffnet: %s" % AKTUELL["titel"])
    return jsonify({"ok": True})


@app.route("/api/ablage/<kennung>", methods=["DELETE"])
def ablage_loeschen(kennung):
    weg = ablage.loeschen(kennung)
    if AKTUELL["kennung"] == kennung:
        AKTUELL["kennung"] = None
    return jsonify({"ok": weg})


@app.route("/api/neu", methods=["POST"])
def neu():
    AKTUELL.update(dict(LEER))
    melden("Neues Transkript begonnen.")
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Herunterladen
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

    personen = daten.get("personen")
    if personen is not None:
        personen = [int(p) for p in personen]
    ab = absatz_bauer.filtern(ab, personen=personen,
                              geraeusche=bool(daten.get("geraeusche", True)))
    if not ab:
        return jsonify({"ok": False,
                        "fehler": "Mit dieser Auswahl bleibt nichts uebrig."})

    titel = daten.get("titel") or AKTUELL["titel"] or "Transkript"

    try:
        pfad = ausgabe.schreiben(
            format_name, titel, ab, orion_an=bool(EINST["orion_an"]),
            mit_zeit=bool(EINST["zeitstempel"]),
            dauer_sekunden=AKTUELL["dauer"], namen=AKTUELL["namen"],
            mit_person=bool(daten.get("mit_person", True)))
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
    return jsonify({"dateien": liste, "ordner": str(ausgabe.ERGEBNIS_ORDNER)})


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
    AKTUELL.update(dict(LEER))
    melden("Transkript geleert.")
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
def start():
    port = int(EINST.get("port", 7345))
    adresse = eigene_adresse()
    kann = stimmen.modelle_da()

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
    print("  Stimmenerkennung  :  %s"
          % ("bereit" if kann["stimmen"] else "Modelle fehlen"))
    print("  Tonerkennung      :  %s"
          % ("bereit" if kann["toene"] else "Modelle fehlen"))
    if not (kann["stimmen"] and kann["toene"]):
        print("                       -> python modelle_holen.py ausfuehren")
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
