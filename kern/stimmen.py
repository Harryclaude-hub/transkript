# -*- coding: utf-8 -*-
"""
Stimmenerkennung und Tonerkennung.

Zwei Aufgaben:
  1. WER spricht wann. Die Tonspur wird in Sprecherabschnitte zerlegt und
     jede Stimme bekommt ihren eigenen Fingerabdruck. Gleiche Stimme
     spaeter wieder = gleiche Person.
  2. WAS ist sonst zu hoeren. Musik, Hund, Applaus, Klingeln und so weiter.

Laeuft ueber ONNX, ohne PyTorch. Alles auf diesem Rechner, nichts im Netz.
Fehlen die Modelle, meldet sich das Modul sauber ab und das Programm
transkribiert einfach ohne Stimmenerkennung weiter.
"""

import threading
from pathlib import Path

import numpy as np

BASIS = Path(__file__).resolve().parent.parent
MODELLE = BASIS / "modelle" / "stimmen"

PFAD_SEGMENTIERUNG = MODELLE / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"
PFAD_FINGERABDRUCK = MODELLE / "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
ORDNER_TOENE = MODELLE / "sherpa-onnx-ced-base-audio-tagging-2024-04-19"

ZIEL_RATE = 16000

_schloss = threading.Lock()
_tonerkenner = None


# ----------------------------------------------------------------------
# Deutsche Namen fuer die haeufigsten Toene.
# Alles was hier nicht steht, wird mit dem englischen Namen angezeigt.
# ----------------------------------------------------------------------
TON_DEUTSCH = {
    "Music": "Musik",
    "Musical instrument": "Musikinstrument",
    "Singing": "Gesang",
    "Song": "Lied",
    "Guitar": "Gitarre",
    "Piano": "Klavier",
    "Drum": "Schlagzeug",
    "Drum kit": "Schlagzeug",
    "Bass guitar": "Bassgitarre",
    "Violin, fiddle": "Geige",
    "Dog": "Hund",
    "Bark": "Hundebellen",
    "Howl": "Heulen",
    "Cat": "Katze",
    "Meow": "Katzenmiauen",
    "Bird": "Vogel",
    "Bird vocalization, bird call, bird song": "Vogelgezwitscher",
    "Applause": "Applaus",
    "Clapping": "Klatschen",
    "Laughter": "Lachen",
    "Giggle": "Kichern",
    "Cheering": "Jubel",
    "Crying, sobbing": "Weinen",
    "Baby cry, infant cry": "Babygeschrei",
    "Cough": "Husten",
    "Sneeze": "Niesen",
    "Telephone bell ringing": "Telefonklingeln",
    "Ringtone": "Klingelton",
    "Telephone": "Telefon",
    "Doorbell": "Tuerklingel",
    "Knock": "Klopfen",
    "Door": "Tuer",
    "Alarm": "Alarm",
    "Siren": "Sirene",
    "Vehicle": "Fahrzeug",
    "Car": "Auto",
    "Motorcycle": "Motorrad",
    "Train": "Zug",
    "Aircraft": "Flugzeug",
    "Typing": "Tippen",
    "Computer keyboard": "Tastatur",
    "Water": "Wasser",
    "Rain": "Regen",
    "Wind": "Wind",
    "Thunder": "Donner",
    "Silence": "Stille",
    "Speech": "Sprache",
    "Male speech, man speaking": "Sprache",
    "Female speech, woman speaking": "Sprache",
    "Child speech, kid speaking": "Sprache",
    "Conversation": "Gespraech",
    "Narration, monologue": "Sprache",
    "Speech synthesizer": "Sprache",
    "Whispering": "Fluestern",
    "Shout": "Rufen",
    "Screaming": "Schreien",
    "Television": "Fernseher",
    "Radio": "Radio",
    "Noise": "Geraeusch",
    "White noise": "Rauschen",
    "Static": "Rauschen",
}

# Diese Toene sind Sprache oder Stille und ergeben keine eigene Zeile.
KEIN_EIGENER_EINTRAG = {
    "Speech", "Male speech, man speaking", "Female speech, woman speaking",
    "Child speech, kid speaking", "Conversation", "Narration, monologue",
    "Speech synthesizer", "Silence", "Inside, small room",
    "Inside, large room or hall", "Whispering",
}


def deutsch(name):
    return TON_DEUTSCH.get(name, name)


# ----------------------------------------------------------------------
def modelle_da():
    """Sagt, was verfuegbar ist."""
    return {
        "stimmen": PFAD_SEGMENTIERUNG.exists() and PFAD_FINGERABDRUCK.exists(),
        "toene": (ORDNER_TOENE / "model.int8.onnx").exists()
                 and (ORDNER_TOENE / "class_labels_indices.csv").exists(),
    }


# ----------------------------------------------------------------------
# Empfindlichkeit 1 bis 5.
# 1 = nur laute, klare Stimmen.  5 = auch leises Gemurmel und Zwischenrufe.
# ----------------------------------------------------------------------
EMPFINDLICHKEIT = {
    1: {"vad": 0.68, "min_an": 0.60, "min_aus": 0.80, "min_sprache_ms": 400},
    2: {"vad": 0.55, "min_an": 0.45, "min_aus": 0.65, "min_sprache_ms": 300},
    3: {"vad": 0.42, "min_an": 0.30, "min_aus": 0.50, "min_sprache_ms": 200},
    4: {"vad": 0.30, "min_an": 0.20, "min_aus": 0.40, "min_sprache_ms": 120},
    5: {"vad": 0.18, "min_an": 0.12, "min_aus": 0.30, "min_sprache_ms": 60},
}


def stufe(wert):
    try:
        wert = int(wert)
    except Exception:
        wert = 3
    return EMPFINDLICHKEIT[min(5, max(1, wert))]


# ----------------------------------------------------------------------
def ton_lesen(pfad):
    """Liest eine Tondatei als 16-kHz-Mono."""
    from kern import motor
    return motor.ton_laden(pfad)


# ----------------------------------------------------------------------
def sprecher_finden(ton, empfindlichkeit=3, anzahl_personen=0,
                    aehnlichkeit=0.5, melden=None):
    """
    Zerlegt die Tonspur in Sprecherabschnitte.

    ton              : numpy-Array, 16 kHz Mono
    anzahl_personen  : 0 = selbst herausfinden, sonst feste Anzahl
    aehnlichkeit     : wie streng zwei Stimmen als dieselbe gelten.
                       Klein = schneller getrennt (mehr Personen),
                       gross = eher zusammengefasst (weniger Personen).

    Rueckgabe: Liste von {"start", "ende", "person"} mit person ab 1.
    """
    if not modelle_da()["stimmen"]:
        raise RuntimeError(
            "Die Modelle fuer die Stimmenerkennung fehlen. "
            "Bitte einmal 'python modelle_holen.py' ausfuehren."
        )

    import sherpa_onnx

    s = stufe(empfindlichkeit)

    aufbau = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=str(PFAD_SEGMENTIERUNG)),
            num_threads=4,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(PFAD_FINGERABDRUCK), num_threads=4),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=int(anzahl_personen) if anzahl_personen else -1,
            threshold=float(aehnlichkeit)),
        min_duration_on=s["min_an"],
        min_duration_off=s["min_aus"],
    )

    if not aufbau.validate():
        raise RuntimeError("Die Einstellungen fuer die Stimmenerkennung passen nicht.")

    if melden:
        melden("Stimmen werden getrennt ...")

    trenner = sherpa_onnx.OfflineSpeakerDiarization(aufbau)
    roh = trenner.process(np.asarray(ton, dtype=np.float32)).sort_by_start_time()

    # sherpa vergibt beliebige Nummern (0, 1, 2, 7 ...).
    # Wir nummerieren in der Reihenfolge des ersten Auftretens neu durch,
    # damit "Person 1" auch wirklich die ist, die zuerst gesprochen hat.
    umbenennen = {}
    abschnitte = []
    for a in roh:
        if a.speaker not in umbenennen:
            umbenennen[a.speaker] = len(umbenennen) + 1
        abschnitte.append({
            "start": float(a.start),
            "ende": float(a.end),
            "person": umbenennen[a.speaker],
        })

    if melden:
        melden("%d Stimmen gefunden." % len(umbenennen))

    return abschnitte


# ----------------------------------------------------------------------
def _tonerkenner_holen():
    global _tonerkenner
    with _schloss:
        if _tonerkenner is not None:
            return _tonerkenner

        import sherpa_onnx
        _tonerkenner = sherpa_onnx.AudioTagging(
            sherpa_onnx.AudioTaggingConfig(
                model=sherpa_onnx.AudioTaggingModelConfig(
                    ced=str(ORDNER_TOENE / "model.int8.onnx"), num_threads=4),
                labels=str(ORDNER_TOENE / "class_labels_indices.csv"),
                top_k=4,
            )
        )
        return _tonerkenner


def _stueck_bestimmen(erkenner, stueck):
    strom = erkenner.create_stream()
    strom.accept_waveform(ZIEL_RATE, np.asarray(stueck, dtype=np.float32))
    return erkenner.compute(strom)


def toene_finden(ton, sprachabschnitte, schwelle=0.35, melden=None):
    """
    Sucht in den Luecken zwischen dem Gesprochenen nach anderen Geraeuschen.

    Warum nur in den Luecken: waehrend jemand redet, soll der Text stehen,
    nicht "[Musik]". In den Pausen dagegen ist genau das interessant.

    Rueckgabe: Liste von {"start", "ende", "was", "sicherheit"}.
    """
    if not modelle_da()["toene"]:
        return []

    erkenner = _tonerkenner_holen()
    gesamt = len(ton) / ZIEL_RATE

    # Luecken zwischen den Sprachabschnitten bestimmen
    belegt = sorted([(a["start"], a["ende"]) for a in sprachabschnitte])
    luecken = []
    zeiger = 0.0
    for start, ende in belegt:
        if start - zeiger >= 1.0:
            luecken.append((zeiger, start))
        zeiger = max(zeiger, ende)
    if gesamt - zeiger >= 1.0:
        luecken.append((zeiger, gesamt))

    if melden and luecken:
        melden("%d Pausen werden auf Geraeusche geprueft ..." % len(luecken))

    MAX_STUECK = 6.0        # laengere Luecken werden zerlegt
    ergebnis = []

    for von, bis in luecken:
        laenge = bis - von
        anzahl = max(1, int(np.ceil(laenge / MAX_STUECK)))
        schritt = laenge / anzahl

        for i in range(anzahl):
            s_von = von + i * schritt
            s_bis = min(bis, s_von + schritt)
            if s_bis - s_von < 0.8:
                continue

            stueck = ton[int(s_von * ZIEL_RATE):int(s_bis * ZIEL_RATE)]
            if len(stueck) < ZIEL_RATE // 2:
                continue

            # Ganz leise Stellen gar nicht erst durchs Modell schicken
            if float(np.abs(stueck).mean()) < 0.0015:
                continue

            for treffer in _stueck_bestimmen(erkenner, stueck):
                if treffer.name in KEIN_EIGENER_EINTRAG:
                    continue
                if treffer.prob < schwelle:
                    continue
                ergebnis.append({
                    "start": s_von,
                    "ende": s_bis,
                    "was": deutsch(treffer.name),
                    "roh": treffer.name,
                    "sicherheit": float(treffer.prob),
                })
                break        # nur der staerkste Treffer je Stueck

    # Direkt aufeinanderfolgende gleiche Geraeusche zusammenfassen
    zusammengefasst = []
    for eintrag in ergebnis:
        if (zusammengefasst
                and zusammengefasst[-1]["was"] == eintrag["was"]
                and eintrag["start"] - zusammengefasst[-1]["ende"] < 1.5):
            zusammengefasst[-1]["ende"] = eintrag["ende"]
            zusammengefasst[-1]["sicherheit"] = max(
                zusammengefasst[-1]["sicherheit"], eintrag["sicherheit"])
        else:
            zusammengefasst.append(eintrag)

    if melden:
        melden("%d Geraeusche erkannt." % len(zusammengefasst))
    return zusammengefasst


# ----------------------------------------------------------------------
def personen_zuordnen(segmente, sprecherabschnitte):
    """
    Haengt an jedes Textstueck die Person, die es gesagt hat.

    Massstab ist die groesste zeitliche Ueberlappung. Wer waehrend eines
    Satzes am laengsten geredet hat, bekommt den Satz zugeschrieben.
    """
    if not sprecherabschnitte:
        for seg in segmente:
            seg["person"] = 0
        return segmente

    for seg in segmente:
        ueberlappung = {}
        for a in sprecherabschnitte:
            von = max(seg["start"], a["start"])
            bis = min(seg["ende"], a["ende"])
            if bis > von:
                ueberlappung[a["person"]] = ueberlappung.get(a["person"], 0.0) + (bis - von)

        if ueberlappung:
            seg["person"] = max(ueberlappung, key=ueberlappung.get)
        else:
            # Kein Treffer: die zeitlich naechste Person nehmen
            naechste = min(
                sprecherabschnitte,
                key=lambda a: min(abs(a["start"] - seg["ende"]),
                                  abs(seg["start"] - a["ende"])),
            )
            seg["person"] = naechste["person"]

    return segmente


# ----------------------------------------------------------------------
def zusammenfuehren(segmente, toene, musik_weglassen=False):
    """
    Mischt Textstuecke und Geraeusche zu einer Zeitleiste.
    Geraeusche bekommen person = 0 und ein eigenes Kennzeichen.
    """
    zeilen = list(segmente)

    for ton in toene:
        if musik_weglassen and ton["roh"] in (
                "Music", "Musical instrument", "Singing", "Song",
                "Guitar", "Piano", "Drum", "Drum kit", "Bass guitar",
                "Violin, fiddle", "Background music", "Theme music"):
            continue
        zeilen.append({
            "start": ton["start"],
            "ende": ton["ende"],
            "text": "[%s]" % ton["was"],
            "person": 0,
            "geraeusch": True,
            "sicherheit": ton["sicherheit"],
        })

    zeilen.sort(key=lambda z: z["start"])
    return zeilen
