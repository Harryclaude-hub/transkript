# -*- coding: utf-8 -*-
"""
Der Erkennungsmotor. Haelt die Whisper-Modelle und wandelt Ton in Text.

Laeuft komplett auf diesem Laptop. Nichts wird ins Internet geschickt.
Nur beim allerersten Start wird das Modell einmalig heruntergeladen.

Hinweis zu Windows Smart App Control:
Diese Windows-Schutzfunktion blockiert manchmal einzelne Programmteile.
Damit das Programm dadurch nicht komplett stehenbleibt, gibt es beim
Einlesen von Audiodateien mehrere Wege hintereinander. Faellt einer aus,
uebernimmt der naechste.
"""

import os
import sys
import threading
import wave
from pathlib import Path

import numpy as np

from kern.orion import orion

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

MODELL_ORDNER = Path(__file__).resolve().parent.parent / "modelle"
ZIEL_RATE = 16000

_geladen = {}
_schloss = threading.Lock()

# Auf einem Laptop ohne NVIDIA-Karte ist int8 auf der CPU die schnellste
# Variante, die noch anstaendige Qualitaet liefert.
GERAET = "cpu"
RECHENART = "int8"


# ----------------------------------------------------------------------
# Notnagel, falls Windows den Audio-Dekoder "av" blockiert.
# Ohne diesen Platzhalter wuerde schon das Laden von faster-whisper scheitern.
# ----------------------------------------------------------------------
class _Platzhalter:
    def __getattr__(self, name):
        return _Platzhalter()

    def __call__(self, *args, **kwargs):
        return _Platzhalter()


AV_VERFUEGBAR = True
try:
    import av  # noqa: F401
except Exception:
    AV_VERFUEGBAR = False
    modul = type(sys)("av")
    modul.__getattr__ = lambda name: _Platzhalter()
    sys.modules.setdefault("av", modul)
    sys.modules.setdefault("av.audio", _Platzhalter())
    print("[Motor] Hinweis: Audio-Dekoder 'av' ist blockiert. "
          "Dateien werden ueber den Ersatzweg gelesen.")


# ----------------------------------------------------------------------
def auf_16k(ton, quell_rate):
    """Mischt auf Mono und rechnet auf 16 kHz herunter."""
    ton = np.asarray(ton, dtype=np.float32)

    if ton.ndim > 1:
        ton = ton.mean(axis=1)

    if quell_rate == ZIEL_RATE or len(ton) == 0:
        return ton

    # Vor dem Verkleinern die hohen Frequenzen daempfen,
    # sonst entstehen Stoergeraeusche.
    faktor = max(1, int(round(quell_rate / float(ZIEL_RATE))))
    if faktor > 1 and len(ton) > faktor:
        fenster = np.ones(faktor, dtype=np.float32) / faktor
        ton = np.convolve(ton, fenster, mode="same").astype(np.float32)

    anzahl_neu = int(round(len(ton) * ZIEL_RATE / float(quell_rate)))
    if anzahl_neu < 1:
        return np.zeros(0, dtype=np.float32)

    alt = np.linspace(0.0, 1.0, num=len(ton), endpoint=False, dtype=np.float64)
    neu = np.linspace(0.0, 1.0, num=anzahl_neu, endpoint=False, dtype=np.float64)
    return np.interp(neu, alt, ton).astype(np.float32)


# ----------------------------------------------------------------------
def _lesen_mit_wave(pfad):
    """Nur unkomprimierte WAV-Dateien, dafuer immer verfuegbar."""
    with wave.open(str(pfad), "rb") as datei:
        if datei.getsampwidth() != 2:
            raise RuntimeError("WAV-Datei ist nicht 16 Bit.")
        rohdaten = datei.readframes(datei.getnframes())
        ton = np.frombuffer(rohdaten, dtype="<i2").astype(np.float32) / 32768.0
        if datei.getnchannels() > 1:
            ton = ton.reshape(-1, datei.getnchannels())
        return auf_16k(ton, datei.getframerate())


def _lesen_mit_soundfile(pfad):
    """WAV, MP3, OGG, OPUS, FLAC, AIFF und weitere."""
    import soundfile as sf
    ton, rate = sf.read(str(pfad), dtype="float32", always_2d=False)
    return auf_16k(ton, rate)


def _lesen_mit_av(pfad):
    """Der breiteste Weg: kann praktisch alles, auch M4A und MP4."""
    from faster_whisper.audio import decode_audio
    return decode_audio(str(pfad), sampling_rate=ZIEL_RATE)


BREITE_FORMATE = {".m4a", ".mp4", ".aac", ".wma", ".webm", ".mkv",
                  ".mov", ".amr", ".3gp"}


def ton_laden(pfad):
    """
    Liest eine Audiodatei und gibt sie als 16-kHz-Mono zurueck.
    Probiert mehrere Wege, damit ein blockierter Programmteil nicht alles
    lahmlegt. Scheitern alle, kommt eine verstaendliche Meldung.
    """
    pfad = Path(pfad)
    if not pfad.exists():
        raise RuntimeError("Datei nicht gefunden: %s" % pfad)

    wege = []
    if AV_VERFUEGBAR:
        wege.append(("av", _lesen_mit_av))
    wege.append(("soundfile", _lesen_mit_soundfile))
    if pfad.suffix.lower() == ".wav":
        wege.append(("wave", _lesen_mit_wave))

    probleme = []
    for name, weg in wege:
        try:
            ton = weg(pfad)
            if ton is not None and len(ton) > 0:
                return ton
            probleme.append("%s: Datei war leer" % name)
        except Exception as fehler:
            probleme.append("%s: %s" % (name, str(fehler)[:120]))

    endung = pfad.suffix.lower()
    zusatz = ""
    if endung in BREITE_FORMATE and not AV_VERFUEGBAR:
        zusatz = (" Fuer %s wird der Dekoder 'av' gebraucht, den Windows "
                  "gerade blockiert. Wandle die Datei in MP3 oder WAV um, "
                  "dann geht es sofort." % endung)

    raise RuntimeError(
        "Die Datei liess sich nicht einlesen.%s (Details: %s)"
        % (zusatz, " | ".join(probleme))
    )


# ----------------------------------------------------------------------
def modell_holen(name, melden=None):
    """Laedt ein Modell (und holt es beim ersten Mal aus dem Netz)."""
    with _schloss:
        if name in _geladen:
            return _geladen[name]

        if melden:
            melden("Modell '%s' wird geladen. Beim ersten Mal dauert das "
                   "ein paar Minuten (Download)." % name)

        try:
            from faster_whisper import WhisperModel
        except ImportError as fehler:
            raise RuntimeError(
                "faster-whisper laesst sich nicht laden (%s). "
                "Bitte einmal installieren.bat ausfuehren." % fehler
            )

        MODELL_ORDNER.mkdir(parents=True, exist_ok=True)

        modell = WhisperModel(
            name,
            device=GERAET,
            compute_type=RECHENART,
            download_root=str(MODELL_ORDNER),
            cpu_threads=0,          # 0 = alle verfuegbaren Kerne nutzen
        )

        _geladen[name] = modell
        if melden:
            melden("Modell '%s' ist bereit." % name)
        return modell


# ----------------------------------------------------------------------
# Wie lang ein Stueck hoechstens sein darf, das am Stueck erkannt wird.
# Whisper arbeitet intern mit 30-Sekunden-Fenstern, darunter zu bleiben
# kostet nichts und haelt die Bloecke uebersichtlich.
MAX_BLOCK_SEKUNDEN = 24.0

# Ab dieser Sprechpause faengt ein neuer Block an.
# Kurze Gespraechspausen bleiben im selben Block, damit die Bloecke gut
# gefuellt sind. Erst eine richtig lange Pause trennt.
MAX_LUECKE_IM_BLOCK = 6.0


def sprechstellen(ton, empfindlichkeit=3):
    """
    Findet die Stellen, an denen ueberhaupt jemand spricht.
    Rueckgabe: Liste von (start_sekunde, ende_sekunde).
    """
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    from kern.stimmen import stufe

    s = stufe(empfindlichkeit)
    roh = get_speech_timestamps(ton, VadOptions(
        threshold=s["vad"],
        min_speech_duration_ms=s["min_sprache_ms"],
        min_silence_duration_ms=int(s["min_aus"] * 1000),
        speech_pad_ms=300,
    ))
    return [(x["start"] / ZIEL_RATE, x["end"] / ZIEL_RATE) for x in roh]


def _bloecke_bilden(stellen):
    """
    Fasst benachbarte Sprechstellen zu Bloecken zusammen.

    Warum ueberhaupt Bloecke: wird die ganze Tonspur in einem Rutsch
    erkannt, reicht EIN Aussetzer, damit der komplette Rest fehlt. Genau
    das passiert zum Beispiel, wenn zwischendrin Musik laeuft oder die
    Sprache wechselt. Mit Bloecken kann ein Aussetzer immer nur ein
    Stueck kosten, nie den Rest der Aufnahme.
    """
    bloecke = []
    von = bis = None

    for start, ende in stellen:
        if von is None:
            von, bis = start, ende
            continue

        zu_lang = (ende - von) > MAX_BLOCK_SEKUNDEN
        grosse_luecke = (start - bis) > MAX_LUECKE_IM_BLOCK

        if zu_lang or grosse_luecke:
            bloecke.append((von, bis))
            von, bis = start, ende
        else:
            bis = ende

    if von is not None:
        bloecke.append((von, bis))

    # Sehr lange Einzelstuecke noch einmal aufteilen.
    fertig = []
    for von, bis in bloecke:
        while bis - von > MAX_BLOCK_SEKUNDEN:
            fertig.append((von, von + MAX_BLOCK_SEKUNDEN))
            von += MAX_BLOCK_SEKUNDEN
        fertig.append((von, bis))

    return fertig


def transkribieren(quelle, modell_name, sprache="de", orion_an=True,
                   melden=None, fortschritt=None, zeit_versatz=0.0,
                   empfindlichkeit=3):
    """
    Wandelt Ton in Text.

    quelle          : Dateipfad ODER numpy-Array mit 16000 Hz Mono float32
    modell_name     : z.B. "small" oder "medium"
    sprache         : "de" oder "auto"
    orion_an        : True = Fachbegriffe werden beruecksichtigt
    melden          : Funktion fuer Statustexte
    fortschritt     : Funktion(sekunden_erkannt) waehrend der Erkennung
    zeit_versatz    : wird auf alle Zeitangaben addiert (fuer Live-Bloecke)
    empfindlichkeit : 1 bis 5. Hoch heisst, auch leise Stimmen und kurze
                      Zwischenrufe werden mitgeschrieben.

    Rueckgabe: (segmente, info)
      segmente = Liste von {"start", "ende", "text"}
    """
    from kern.stimmen import stufe

    modell = modell_holen(modell_name, melden=melden)

    if not isinstance(quelle, np.ndarray):
        if melden:
            melden("Tondatei wird eingelesen ...")
        quelle = ton_laden(quelle)

    vorspann = orion.vorspann() if orion_an else None

    gesamt = len(quelle) / ZIEL_RATE
    stellen = sprechstellen(quelle, empfindlichkeit)
    bloecke = _bloecke_bilden(stellen)

    if melden:
        melden("%d Sprechstellen, daraus %d Bloecke."
               % (len(stellen), len(bloecke)))

    segmente = []
    letzte_info = None
    gescheitert = 0

    for nummer, (von, bis) in enumerate(bloecke, 1):
        stueck = quelle[int(von * ZIEL_RATE):int(bis * ZIEL_RATE)]
        if len(stueck) < ZIEL_RATE * 0.2:
            continue

        try:
            roh, info = modell.transcribe(
                stueck,
                language=None if sprache == "auto" else sprache,
                initial_prompt=vorspann,
                beam_size=5,
                vad_filter=False,          # die Stellen stehen schon fest
                condition_on_previous_text=False,
                temperature=[0.0, 0.2, 0.4, 0.6],
            )
            letzte_info = info

            for seg in roh:                # Generator, laeuft hier los
                text = (seg.text or "").strip()
                if not text:
                    continue
                segmente.append({
                    "start": float(seg.start) + von + zeit_versatz,
                    "ende": float(seg.end) + von + zeit_versatz,
                    "text": text,
                })

        except Exception as fehler:
            # Ein kaputter Block darf nie den Rest der Aufnahme kosten.
            gescheitert += 1
            if melden:
                melden("Block %d (%.0f-%.0f s) uebersprungen: %s"
                       % (nummer, von, bis, str(fehler)[:80]))

        if fortschritt:
            fortschritt(bis)

    if gescheitert and melden:
        melden("%d von %d Bloecken sind ausgefallen." % (gescheitert, len(bloecke)))

    segmente.sort(key=lambda s: s["start"])

    class _Info:
        duration = gesamt
        language = getattr(letzte_info, "language", sprache)
        language_probability = getattr(letzte_info, "language_probability", 0.0)

    return segmente, _Info()


def nachbearbeiten(segmente, orion_an=True):
    """
    Zieht die Fachbegriffe gerade, wenn die Orion-Funktion an ist.
    Rueckgabe: (segmente, anzahl_korrekturen)
    """
    if not orion_an:
        return segmente, 0

    gesamt = 0
    for seg in segmente:
        seg["text"], anzahl = orion.korrigieren(seg["text"])
        gesamt += anzahl
    return segmente, gesamt
