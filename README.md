# Transkript

Ein schlichtes Mitschrift-Programm für Windows. Es hört zu, schreibt mit und
gibt das Ergebnis als **PDF**, **Word-Datei** oder **Text** aus, mit echten
Absätzen statt einer Bleiwüste.

Alles läuft lokal auf dem eigenen Rechner. Kein Konto, keine Cloud, keine
laufenden Kosten. Kein Ton verlässt den Laptop.

> *A small local speech-to-text tool for Windows. Runs fully offline on
> faster-whisper, exports to PDF/DOCX/TXT, and has a toggleable domain
> vocabulary layer. German interface.*

---

## Zwei Fassungen

**Ohne Installation, direkt im Browser:**
### → [harryclaude-hub.github.io/transkript](https://harryclaude-hub.github.io/transkript/)

Aufnahme starten, mitschreiben lassen, als PDF, Word oder Text herunterladen.
Läuft auch am Handy. Die Spracherkennung kommt dabei vom Browser, Chrome und
Edge schicken den Ton dafür an Google.

**Für den Laptop**, weiter unten beschrieben: rechnet offline, nimmt im
Hintergrund auf, verarbeitet Audiodateien jeder Länge und kann den PC-Ton
mitschneiden.

| | Im Browser | Am Laptop |
|---|---|---|
| Installation | keine | einmalig, 5 bis 15 min |
| Erkennung läuft | bei Google | auf deinem Rechner |
| Audiodateien | nein | ja, beliebig lang |
| Im Hintergrund | nein, Fenster muss offen bleiben | ja |
| PC-Ton mitschneiden | nein | ja |
| Orion-Funktion | Korrektur danach | Vorspann **und** Korrektur |

---

## Was die Laptop-Fassung kann

| | |
|---|---|
| **Live-Mitschrift** | Läuft im Hintergrund weiter, auch wenn der Browser zu ist |
| **Audiodateien** | Kurz oder stundenlang, MP3 / WAV / M4A / MP4 / OGG / OPUS / FLAC |
| **Mikrofon oder PC-Ton** | Raumgespräch oder das, was aus den Lautsprechern kommt |
| **Ausgabe** | PDF, Word und Text, mit Absätzen nach Sprechpausen |
| **Vom Handy** | Bedienbar im Browser über das gleiche WLAN |
| **Orion-Funktion** | Abschaltbare Fachwort-Schicht, siehe unten |

---

## Installation

Vorausgesetzt wird **Python 3.10 oder neuer** ([python.org](https://www.python.org/downloads/),
beim Installieren *Add Python to PATH* ankreuzen).

1. Repo herunterladen oder klonen
2. `installieren.bat` doppelklicken, dauert 5 bis 15 Minuten
3. Ab dann immer `START.bat` doppelklicken

Beim ersten Start werden die Sprachmodelle geholt (rund 3,4 GB). Sie liegen
danach lokal in `modelle/` und werden nie wieder heruntergeladen.

Das schwarze Fenster ist das Programm und muss offen bleiben. Der Browser ist
nur die Fernbedienung.

---

## Die Orion-Funktion

Ein Schalter, der dem Programm eine Fachsprache mitgibt. In der mitgelieferten
Fassung ist das die Welt der Sportwetten, Wettbörsen und Quotenrechnung.
Ausgeschaltet transkribiert das Programm ganz normal, ohne jeden Einfluss.

Der Unterschied am selben Satz, gemessen:

| Orion **aus** | Orion **an** |
|---|---|
| Poli**market** | Poly**market** |
| **Sourbet** | **Surebet** |
| Ge**bohren** | Ge**bühren** |

Die Funktion arbeitet in zwei Stufen:

1. **Vorher** wandern die obersten Begriffe aus `begriffe/orion.txt` als
   Vorspann in die Erkennung. Sie hört dann eher „Surebet" als „sicher Bett".
2. **Nachher** zieht `begriffe/orion_korrekturen.txt` (`falsch = richtig`)
   plus ein vorsichtiger Ähnlichkeitsvergleich den fertigen Text gerade.

Beide Listen sind schlichte Textdateien und direkt in der Oberfläche
bearbeitbar. Speichern wirkt sofort, ohne Neustart.

**Für ein anderes Fachgebiet** einfach die beiden Dateien austauschen. Medizin,
Recht, Handwerk, was auch immer. Am Code muss dafür nichts geändert werden.

### Was der Korrektor absichtlich nicht tut

Gebeugte Formen bleiben unangetastet. Aus „Gebühren" wird nie „Gebühr", aus
„Quoten" nie „Quote". Ein korrekter Text darf durch die Korrektur niemals
schlechter werden. Umgesetzt über Präfix-Prüfung und eine Grenze für den
Längenunterschied.

---

## Tempo

Gemessen auf einem i5-10210U ohne Grafikkarte:

| Modell | 1 Stunde Ton | wofür |
|---|---|---|
| `small` | ca. **36 Minuten** | Live, Standard |
| `medium` | ca. **93 Minuten** | Dateien, Standard |
| `large-v3-turbo` | deutlich länger | nur wenn es drauf ankommt |

Umstellbar in der Oberfläche. Mit einer NVIDIA-Karte wird das ein Vielfaches
schneller, dann in `kern/motor.py` `GERAET = "cuda"` und
`RECHENART = "float16"` setzen.

---

## Aufbau

```
transkript/
   START.bat            <- damit starten
   installieren.bat     <- einmalig
   app.py               <- Server und Routen
   kern/
      motor.py          <- Spracherkennung, Dekoder-Kette
      live.py           <- Aufnahme im Hintergrund
      orion.py          <- Fachbegriffe und Korrektur
      absaetze.py       <- Segmente zu Absätzen
      ausgabe.py        <- PDF / Word / Text
      einstellungen.py
   weboberflaeche/
      index.html
      stil.css          <- reines Design, darf gelöscht werden
      logik.js          <- Funktion
   begriffe/            <- die Orion-Listen
```

**Design und Funktion sind getrennt.** `stil.css` enthält kein einziges Stück
Ablaufsteuerung. Die Datei darf gelöscht oder komplett umgeschrieben werden,
das Programm rechnet unverändert weiter. Geprüft: mit abgeschaltetem CSS
antwortet die Schnittstelle, wechseln die Reiter und schaltet der Orion-Schalter
weiterhin durch.

---

## Windows Smart App Control

Ist diese Schutzfunktion eingeschaltet, blockiert Windows manche unsignierten
Programmteile. Deshalb ist in `installieren.bat` bewusst `av==13.1.0`
festgenagelt. Neuere Fassungen werden blockiert, dann startet die Erkennung
nicht.

**Diese Zeile bitte nicht auf eine neuere Version ändern.**

Falls es doch klemmt, hat `kern/motor.py` eine Dekoder-Kette eingebaut und liest
MP3, WAV, OGG und FLAC über einen zweiten Weg. Nur M4A und MP4 brauchen
zwingend den ersten.

Smart App Control abzuschalten ist keine empfohlene Lösung, das lässt sich ohne
Windows-Neuinstallation nicht rückgängig machen.

---

## Womit gebaut

[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2),
[Flask](https://flask.palletsprojects.com/),
[sounddevice](https://python-sounddevice.readthedocs.io/),
[ReportLab](https://www.reportlab.com/),
[python-docx](https://python-docx.readthedocs.io/).

Ausführliche Bedienhinweise stehen in [ANLEITUNG.md](ANLEITUNG.md).
