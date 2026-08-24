# Transkript

Ein schlichtes Mitschrift-Programm. Es hoert zu, schreibt mit und spuckt
das Ergebnis als PDF, Word-Datei oder Text aus.

Alles laeuft auf deinem Laptop. Kein Konto, keine Cloud, keine laufenden
Kosten. Kein Ton verlaesst den Rechner.

---

## Starten

1. **Einmalig:** `installieren.bat` doppelklicken. Dauert 5 bis 15 Minuten.
2. **Ab dann immer:** `START.bat` doppelklicken.

Es geht ein schwarzes Fenster auf und der Browser oeffnet sich.
**Das schwarze Fenster muss offen bleiben.** Es ist das Programm selbst.
Der Browser ist nur die Fernbedienung.

---

## Die vier Reiter

### Live

Aufnahmequelle waehlen, Titel eintippen, **Aufnahme starten**.

Der Text erscheint blockweise, etwa alle 25 bis 30 Sekunden. Ein kleiner
Rueckstand ist normal, das Programm rechnet dem Ton hinterher.

Du kannst den Browser zuklappen, ein anderes Programm benutzen oder den
Laptop weiterverwenden. **Die Aufnahme laeuft im Hintergrund weiter**,
solange das schwarze Fenster offen ist.

Bei **Aufnahmequelle** stehen zwei Sorten:

| Sorte | Was es aufnimmt |
|---|---|
| Mikrofonarray ... | Was im Raum gesprochen wird |
| **PC-Ton: Stereomix ...** | Was aus deinen Lautsprechern kommt |

PC-Ton ist der richtige Weg, wenn du ein Video, eine Sprachnachricht oder
einen Anruf mitschreiben willst, der auf dem Laptop laeuft.

> Falls PC-Ton nicht in der Liste steht: Rechtsklick auf das
> Lautsprecher-Symbol unten rechts, `Soundeinstellungen`, ganz nach unten
> zu `Weitere Soundeinstellungen`, Reiter `Aufnahme`, Rechtsklick ins
> leere Feld, `Deaktivierte Geraete anzeigen`, dann `Stereomix` aktivieren.

### Datei

Audiodatei ins Feld ziehen, fertig. Kurz oder stundenlang, beides geht.
Du kannst mehrere Dateien nacheinander ablegen, sie werden der Reihe nach
abgearbeitet.

Funktioniert direkt: **MP3, WAV, OGG, OPUS, FLAC, M4A, MP4, AAC** und mehr.
WhatsApp-Sprachnachrichten und Handy-Aufnahmen laufen damit.

### Orion

Der Reiter fuer die Fachsprache. Siehe naechster Abschnitt.

### Ablage

Alle fertigen Dateien. `Ordner oeffnen` springt in den Windows-Ordner.

---

## Die Orion-Funktion

Der Schalter oben rechts. **An** heisst: das Programm kennt die Fachsprache
rund um Sportwetten, Wettboersen und Quotenrechnung. **Aus** heisst: ganz
normale Transkription, ohne jeden Fachwort-Einfluss.

Der Unterschied ist kein Kleinkram. Derselbe Satz, gemessen:

| | Orion **AUS** | Orion **AN** |
|---|---|---|
| | Poli**market** | Poly**market** |
| | **Sourbet** | **Surebet** |
| | Ge**bohren** | Ge**buehren** |

Die Funktion arbeitet in zwei Stufen:

1. **Vorher:** Die wichtigsten Fachbegriffe werden der Erkennung
   mitgegeben. Sie hoert dann eher "Surebet" als "sicher Bett".
2. **Nachher:** Was trotzdem falsch ankam, wird ueber die Korrekturliste
   geradegezogen.

### Eigene Begriffe ergaenzen

Im Reiter **Orion** stehen zwei Felder:

**Fachbegriffe** ist eine schlichte Liste, eine Zeile pro Begriff.
Je weiter oben, desto staerker zieht der Begriff bei der Erkennung.

**Korrekturen** hat die Form `falsch gehoert = richtig`:

```
schure bet = Surebet
poly market = Polymarket
```

Gross- und Kleinschreibung ist beim Suchen egal. Bindestriche und
Leerzeichen auch: `bet fair` findet auch `Bet-Fair` und `BetFair`.

Danach auf **Speichern und neu laden** druecken. Sofort wirksam, ohne
Neustart.

Die Listen liegen auch als normale Textdateien in `begriffe\`, falls du
sie lieber im Editor bearbeitest.

### Was Orion absichtlich NICHT tut

Gebeugte Formen bleiben unangetastet. Aus "Gebuehren" wird nie "Gebuehr",
aus "Quoten" nie "Quote". Ein korrekter Text darf durch die Korrektur
niemals schlechter werden.

---

## Speichern

Unter dem Transkript sitzen die Knoepfe: **Als PDF**, **Als Word**,
**Als Text**. Die Datei wird geschrieben und gleich heruntergeladen.

Alle drei Formate haben echte Absaetze. Das Programm bricht dort um, wo
im Gespraech eine Pause war, nicht stur nach Zeichenzahl.

Oben im Dokument steht eine Kopfzeile mit Datum, Laenge, Wortzahl und ob
Orion an war.

Zeitstempel kannst du im Reiter **Orion** unter Einstellungen zuschalten.

---

## Vom Handy aus

Beim Start zeigt das schwarze Fenster zwei Adressen:

```
Auf diesem Laptop :  http://localhost:7345
Vom Handy aus     :  http://192.168.x.x:7345
```

Die zweite Adresse im Handy-Browser eingeben. Handy und Laptop muessen im
gleichen WLAN sein. Dann kannst du vom Sofa aus die Aufnahme starten und
stoppen, Dateien hochladen und das PDF aufs Handy laden.

Die Erkennung passiert immer auf dem Laptop, nie auf dem Handy.

---

## Tempo

Gemessen auf diesem Laptop (i5-10210U, keine Grafikkarte):

| Modell | 1 Stunde Ton braucht | wofuer |
|---|---|---|
| `small` | ca. **36 Minuten** | Live, Standard |
| `medium` | ca. **93 Minuten** | Dateien, Standard |
| `large-v3-turbo` | sehr lang | nur wenn es drauf ankommt |

Umstellen im Reiter **Orion** unter Einstellungen. Wenn dir eine lange
Datei zu lange dauert: `medium` auf `small` stellen, das ist rund
zweieinhalbmal schneller.

Das Programm rechnet auf allen 8 Kernen. Es laeuft weiter, auch wenn du
nebenher arbeitest, dann halt etwas langsamer.

---

## Wo alles liegt

```
C:\Users\Home\transkript\
   START.bat            <- damit starten
   installieren.bat     <- einmalig
   ergebnisse\          <- fertige PDFs, Word- und Textdateien
   aufnahmen\           <- roher Ton, auch von den Live-Aufnahmen
   begriffe\            <- die Orion-Listen zum Selbstbearbeiten
   modelle\             <- die Spracherkennung, rund 3,4 GB
   weboberflaeche\
      stil.css          <- reines Design, darf geloescht werden
      logik.js          <- Funktion
   kern\                <- Funktion
```

Jede Live-Aufnahme wird zusaetzlich als WAV in `aufnahmen\` gesichert.
Falls dir ein Transkript zu ungenau war, kannst du diese Datei spaeter im
Reiter **Datei** noch einmal mit dem genaueren Modell durchlaufen lassen.

**Design und Funktion sind getrennt.** `stil.css` enthaelt kein einziges
Stueck Ablaufsteuerung. Du kannst die Datei loeschen oder komplett
umschreiben, das Programm rechnet unveraendert weiter.

---

## Wenn etwas klemmt

**"Es fehlen noch Programmteile"**
`installieren.bat` doppelklicken.

**Die Seite laedt nicht / "Keine Verbindung zum Programm"**
Das schwarze Fenster wurde geschlossen. `START.bat` neu starten.

**Kein Mikrofon in der Liste**
Windows-Einstellungen, `Datenschutz und Sicherheit`, `Mikrofon`, dort den
Zugriff fuer Desktop-Apps erlauben.

**Die Erkennung startet nicht, Meldung ueber blockierte Dateien**
Auf diesem Laptop ist **Smart App Control** eingeschaltet. Diese
Windows-Schutzfunktion blockiert manche Programmteile. Deshalb ist in
`installieren.bat` die Zeile `"av==13.1.0"` festgenagelt. Neuere Fassungen
werden blockiert. Diese Zeile bitte nicht auf eine neuere Version aendern.

Falls es doch einmal klemmt: das Programm hat einen zweiten Weg eingebaut
und liest MP3, WAV, OGG und FLAC dann trotzdem. Nur M4A und MP4 brauchen
zwingend den ersten Weg.

**Smart App Control abschalten ist keine Loesung, die ich empfehle:**
Das laesst sich ohne Windows-Neuinstallation nicht rueckgaengig machen.
Wir brauchen es nicht, das Programm laeuft auch so.

**Aufnahme laeuft, aber der Pegelbalken bleibt leer**
Falsche Quelle gewaehlt. Bei PC-Ton muss auch wirklich Ton aus den
Lautsprechern kommen, bei Stummschaltung nimmt er nichts auf.
