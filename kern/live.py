# -*- coding: utf-8 -*-
"""
Live-Mitschrift. Nimmt dauerhaft auf und erkennt blockweise nebenher.

Laeuft in eigenen Threads. Du kannst das Fenster zuklappen, ein anderes
Programm benutzen oder den Browser schliessen: die Aufnahme laeuft weiter,
solange das schwarze Fenster von START.bat offen ist.
"""

import queue
import threading
import time
import wave
from datetime import datetime
from pathlib import Path

import numpy as np

from kern import motor

AUFNAHME_ORDNER = Path(__file__).resolve().parent.parent / "aufnahmen"
ZIEL_RATE = 16000          # Whisper arbeitet mit 16 kHz Mono


# ----------------------------------------------------------------------
def geraete_auflisten():
    """
    Liefert alle Aufnahmequellen: echte Mikrofone plus, wenn moeglich,
    den PC-Ton (was aus den Lautsprechern kommt).
    """
    try:
        import sounddevice as sd
    except Exception as fehler:
        return [], "sounddevice fehlt oder laesst sich nicht laden: %s" % fehler

    liste = []
    try:
        geraete = sd.query_devices()
        standard_ein = sd.default.device[0]
    except Exception as fehler:
        return [], "Audiogeraete nicht lesbar: %s" % fehler

    # Windows meldet dieselbe Hardware oft mehrfach ueber verschiedene
    # Treiberwege. Das verwirrt nur, deshalb einmal aufraeumen.
    ALLERWELTSNAMEN = ("soundmapper", "primärer", "primarer", "primary sound")

    # So heisst auf verschiedenen Rechnern die Quelle, die mitschneidet,
    # was aus den Lautsprechern kommt.
    PC_TON_NAMEN = ("stereomix", "stereo mix", "stereomischung",
                    "what u hear", "what you hear", "wave out",
                    "aufnahmemix", "summe", "loopback")

    schon_da = set()

    for nummer, g in enumerate(geraete):
        if g.get("max_input_channels", 0) <= 0:
            continue

        name = g["name"].strip()
        klein = name.lower()

        if any(wort in klein for wort in ALLERWELTSNAMEN):
            continue
        if klein in schon_da:
            continue
        schon_da.add(klein)

        ist_pc_ton = any(wort in klein for wort in PC_TON_NAMEN)

        liste.append({
            "id": "ein:%d" % nummer,
            "name": ("PC-Ton: " + name) if ist_pc_ton else name,
            "art": "PC-Ton" if ist_pc_ton else "Mikrofon",
            "standard": nummer == standard_ein,
        })

    # Falls die Aufraeumaktion zu gruendlich war, lieber alles zeigen
    # als eine leere Auswahl.
    if not liste:
        for nummer, g in enumerate(geraete):
            if g.get("max_input_channels", 0) > 0:
                liste.append({
                    "id": "ein:%d" % nummer, "name": g["name"],
                    "art": "Mikrofon", "standard": nummer == standard_ein,
                })

    # Standardmikrofon zuerst, die Sonderquelle PC-Ton ans Ende.
    liste.sort(key=lambda g: (g["art"] == "PC-Ton", not g["standard"]))

    return liste, None


# ----------------------------------------------------------------------
def _umrechnen(bloecke, quell_rate):
    """Fuegt die Rohbloecke zusammen und bringt sie auf 16 kHz Mono."""
    ton = np.concatenate(bloecke, axis=0)
    return motor.auf_16k(ton, quell_rate)


# So viel Ton wird ueber die Blocklaenge hinaus gesammelt, damit ueberhaupt
# ein Suchbereich fuer eine Sprechpause da ist. Ohne diese Reserve wuerde
# stur bei der Blocklaenge geschnitten, oft mitten im Wort.
RESERVE_SEKUNDEN = 3.0


def _schnittstelle_finden(ton, mindestens):
    """
    Sucht im hinteren Teil des Blocks die leiseste Stelle, damit nicht
    mitten im Wort geschnitten wird. Gibt einen Index zurueck.
    """
    if len(ton) <= mindestens:
        return len(ton)

    suchbereich_start = mindestens
    fenster = int(0.25 * ZIEL_RATE)          # 250 ms
    if len(ton) - suchbereich_start < fenster * 2:
        return len(ton)

    bester_index = len(ton)
    beste_lautstaerke = None

    schritt = int(0.05 * ZIEL_RATE)          # alle 50 ms nachschauen
    for i in range(suchbereich_start, len(ton) - fenster, schritt):
        lautstaerke = float(np.abs(ton[i:i + fenster]).mean())
        if beste_lautstaerke is None or lautstaerke < beste_lautstaerke:
            beste_lautstaerke = lautstaerke
            bester_index = i + fenster // 2

    return bester_index


# ----------------------------------------------------------------------
class LiveAufnahme:
    """Eine laufende Live-Mitschrift."""

    def __init__(self, geraet_id, modell_name, sprache, orion_an,
                 block_sekunden, titel, melden):
        self.geraet_id = geraet_id
        self.modell_name = modell_name
        self.sprache = sprache
        self.orion_an = orion_an
        self.block_sekunden = max(8, int(block_sekunden))
        self.titel = titel or "Live-Mitschrift"
        self.melden = melden

        self.segmente = []
        self.laeuft = False
        self.pausiert = False
        self.fehler = None
        self.start_zeit = None
        self.aufgenommene_sekunden = 0.0
        self.erkannte_sekunden = 0.0
        self.korrekturen = 0
        self.pegel = 0.0

        self._warteschlange = queue.Queue()
        self._threads = []
        self._stopp = threading.Event()
        self._schloss = threading.Lock()

        self.wav_pfad = None
        self._wav = None

    # ------------------------------------------------------------------
    def starten(self):
        try:
            import sounddevice as sd
        except Exception as fehler:
            raise RuntimeError(
                "Mikrofon-Zugriff nicht moeglich (sounddevice fehlt): %s" % fehler
            )

        _, _, nummer_text = self.geraet_id.partition(":")
        nummer = int(nummer_text)
        geraet = sd.query_devices(nummer)

        kanaele = min(2, int(geraet["max_input_channels"])) or 1
        quell_rate = int(geraet.get("default_samplerate") or 48000)

        def rueckmeldung(daten, anzahl, zeit, status):
            if status:
                pass                     # Aussetzer nicht abbrechen lassen
            if not self.pausiert:
                self._warteschlange.put(daten.copy())

        try:
            self._strom = sd.InputStream(
                device=nummer,
                channels=kanaele,
                samplerate=quell_rate,
                dtype="float32",
                blocksize=int(quell_rate * 0.1),
                callback=rueckmeldung,
            )
            self._strom.start()
        except Exception as fehler:
            raise RuntimeError(
                "Aufnahme konnte nicht starten (%s): %s" % (geraet["name"], fehler)
            )

        AUFNAHME_ORDNER.mkdir(parents=True, exist_ok=True)
        stempel = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        self.wav_pfad = AUFNAHME_ORDNER / ("%s_live.wav" % stempel)
        self._wav = wave.open(str(self.wav_pfad), "wb")
        self._wav.setnchannels(1)
        self._wav.setsampwidth(2)
        self._wav.setframerate(ZIEL_RATE)

        self.laeuft = True
        self.start_zeit = time.time()
        self._quell_rate = quell_rate

        arbeiter = threading.Thread(target=self._arbeiten, daemon=True)
        arbeiter.start()
        self._threads.append(arbeiter)

        self.melden("Aufnahme laeuft: %s" % geraet["name"])

    # ------------------------------------------------------------------
    def _arbeiten(self):
        """Sammelt Ton und schickt fertige Bloecke zur Erkennung."""
        puffer = np.zeros(0, dtype=np.float32)
        roh = []
        versatz = 0.0
        mindest_laenge = self.block_sekunden * ZIEL_RATE
        # Erst schneiden, wenn auch Reserve da ist. Sonst gibt es keinen
        # Bereich, in dem eine Sprechpause gesucht werden koennte.
        ausloese_laenge = mindest_laenge + int(RESERVE_SEKUNDEN * ZIEL_RATE)

        try:
            # Modell schon mal vorladen, damit der erste Block nicht wartet.
            motor.modell_holen(self.modell_name, melden=self.melden)

            while not self._stopp.is_set():
                try:
                    stueck = self._warteschlange.get(timeout=0.5)
                    roh.append(stueck)
                except queue.Empty:
                    stueck = None

                if roh and (len(roh) >= 10 or stueck is None):
                    neu = _umrechnen(roh, self._quell_rate)
                    roh = []
                    if len(neu):
                        puffer = np.concatenate([puffer, neu])
                        self.pegel = float(np.abs(neu).mean())
                        self.aufgenommene_sekunden = versatz + len(puffer) / ZIEL_RATE
                        self._wav_schreiben(neu)

                if len(puffer) >= ausloese_laenge:
                    schnitt = _schnittstelle_finden(puffer, mindest_laenge)
                    block = puffer[:schnitt]
                    puffer = puffer[schnitt:]
                    self._block_erkennen(block, versatz)
                    versatz += len(block) / ZIEL_RATE

            # Nach dem Stopp: den Rest noch durchlaufen lassen.
            if roh:
                neu = _umrechnen(roh, self._quell_rate)
                if len(neu):
                    puffer = np.concatenate([puffer, neu])
                    self._wav_schreiben(neu)

            if len(puffer) > ZIEL_RATE * 0.5:
                self.melden("Letzter Block wird noch erkannt ...")
                self._block_erkennen(puffer, versatz)

        except Exception as fehler:
            self.fehler = str(fehler)
            self.melden("FEHLER im Live-Modus: %s" % fehler)
        finally:
            self._aufraeumen()

    # ------------------------------------------------------------------
    def _wav_schreiben(self, ton):
        if self._wav is None:
            return
        try:
            begrenzt = np.clip(ton, -1.0, 1.0)
            self._wav.writeframes((begrenzt * 32767).astype("<i2").tobytes())
        except Exception:
            pass

    # ------------------------------------------------------------------
    def _block_erkennen(self, block, versatz):
        if len(block) < ZIEL_RATE * 0.5:
            return
        try:
            neue, _ = motor.transkribieren(
                block, self.modell_name, sprache=self.sprache,
                orion_an=self.orion_an, melden=None, zeit_versatz=versatz,
            )
            neue, korrekturen = motor.nachbearbeiten(neue, orion_an=self.orion_an)
            with self._schloss:
                self.segmente.extend(neue)
                self.korrekturen += korrekturen
                self.erkannte_sekunden = versatz + len(block) / ZIEL_RATE
        except Exception as fehler:
            self.melden("Ein Block konnte nicht erkannt werden: %s" % fehler)

    # ------------------------------------------------------------------
    def _aufraeumen(self):
        try:
            if getattr(self, "_strom", None):
                self._strom.stop()
                self._strom.close()
        except Exception:
            pass
        try:
            if self._wav:
                self._wav.close()
                self._wav = None
        except Exception:
            pass
        self.laeuft = False

    # ------------------------------------------------------------------
    def stoppen(self):
        self.melden("Aufnahme wird beendet ...")
        self._stopp.set()
        for t in self._threads:
            t.join(timeout=180)
        self.laeuft = False
        self.melden("Aufnahme beendet.")

    def pause_umschalten(self):
        self.pausiert = not self.pausiert
        self.melden("Pause" if self.pausiert else "Weiter")
        return self.pausiert

    def stand(self):
        with self._schloss:
            return list(self.segmente)
