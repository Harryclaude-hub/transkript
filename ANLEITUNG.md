# Transkript

Ein Mitschrift-Programm. Es hört zu, schreibt mit, erkennt **wer** spricht
und **was** sonst zu hören ist, und gibt das Ergebnis als PDF, Word-Datei
oder Text aus.

Alles läuft auf deinem Laptop. Kein Konto, keine Cloud, keine laufenden
Kosten. Kein Ton verlässt den Rechner.

---

## Starten

1. **Einmalig:** `installieren.bat` doppelklicken. Dauert 10 bis 25 Minuten.
2. **Ab dann immer:** `START.bat` doppelklicken.

Das schwarze Fenster ist das Programm und muss offen bleiben. Der Browser
ist nur die Fernbedienung.

Beim Start steht im Fenster, ob alles bereit ist:

```
Stimmenerkennung  :  bereit
Tonerkennung      :  bereit
```

Steht dort `Modelle fehlen`, einmal ausführen:

```bash
python C:\Users\Home\transkript\modelle_holen.py
```

---

## Die fünf Reiter

### Live

Aufnahmequelle wählen, Titel eintippen, **Aufnahme starten**.

Der Text erscheint blockweise. Du kannst den Browser zuklappen und
weiterarbeiten, die Aufnahme läuft im Hintergrund weiter.

Beim **Stoppen** geht das Programm die Tonspur noch einmal durch und
trennt die Stimmen. Das dauert einen Moment, dann stehen die Personen da.

| Aufnahmequelle | nimmt auf |
|---|---|
| Mikrofonarray ... | was im Raum gesprochen wird |
| **PC-Ton: Stereomix ...** | was aus deinen Lautsprechern kommt |

> Fehlt PC-Ton: Rechtsklick auf das Lautsprecher-Symbol, `Soundeinstellungen`,
> `Weitere Soundeinstellungen`, Reiter `Aufnahme`, Rechtsklick ins leere Feld,
> `Deaktivierte Geräte anzeigen`, dann `Stereomix` aktivieren.

### Datei

Audiodatei hineinziehen. Kurz oder stundenlang. Personen und Geräusche
werden gleich mit erkannt.

Funktioniert: **MP3, WAV, OGG, OPUS, FLAC, M4A, MP4, AAC** und mehr.

### Stimmen

Hier stellst du ein, wie genau hingehört wird.

**Empfindlichkeit 1 bis 5.** Das ist der wichtigste Regler.

| Stufe | wofür |
|---|---|
| 1 bis 2 | eine Person, ruhiger Raum, klare Stimme |
| 3 | normales Gespräch |
| **4** | **Standard.** Mehrere Personen, auch mal leiser |
| 5 | Gemurmel, Zwischenrufe, jemand weiter weg |

Hoch heißt: es geht nichts verloren. Dafür landet auch mal ein Husten
oder ein Rascheln im Text.

**Anzahl Personen.** Normalerweise auf `selbst herausfinden` lassen.
Wenn du sicher weißt, dass genau drei Leute reden, stell es fest ein,
das wird dann genauer.

**Wie schnell zwei Stimmen als verschiedene Personen gelten.** Werden
zwei ähnliche Stimmen zusammengeworfen, den Regler nach links. Wird
eine Person in zwei aufgeteilt, nach rechts.

**Geräusche erkennen.** Trägt in den Sprechpausen ein, was sonst zu hören
war: `[Musik]`, `[Hund]`, `[Applaus]`, `[Telefonklingeln]` und so weiter.

**Musik nicht eintragen.** Wenn dauernd Hintergrundmusik läuft und du
nicht alle zwei Minuten `[Musik]` im Text haben willst.

### Orion

Die Fachwort-Schicht und die Erkennungs-Einstellungen. Siehe unten.

### Ablage

Gespeicherte Transkripte und heruntergeladene Dateien.

**Aktuelles Transkript speichern** legt es mit Ton, Personen und Namen ab.
Später anklicken und es ist wieder da, samt Anhören.

**Neues Transkript** fängt frisch an, ohne das alte zu verlieren.

---

## Personen

Sind die Stimmen getrennt, steht über dem Transkript eine Leiste:

```
● Person 1  02:14      ● Person 2  01:37      ● Person 3  00:48
```

**Auf den Namen tippen** nimmt die Person beim Herunterladen mit oder
lässt sie weg. Ausgegraut heißt: kommt nicht mit. So lädst du ein
Transkript herunter, in dem nur Person 1 und 2 stehen.

**Auf den Stift tippen** benennt sie um. Aus `Person 2` wird `Sascha`.
Der Name steht dann überall, auch im PDF.

Die Anzahl ist nicht begrenzt. Reden zehn Leute, kommen zehn Personen
heraus.

---

## Sätze anhören

Jede Zeile im Transkript zeigt links den Sprecher, die Zeit und **wie
lange der Satz gedauert hat**:

```
Karam   00:14   7.6 s
Guten Morgen zusammen, ich habe mir die Quoten angeschaut.
```

**Auf die Zeile tippen spielt genau diesen Satz ab.** Nur diesen, danach
hört es von selbst auf. Nochmal tippen hält an.

So kannst du vor dem Herunterladen nachhören, ob wirklich das dasteht,
was gesagt wurde.

---

## Die Orion-Funktion

Der Schalter oben rechts. **An** heißt: das Programm kennt die Fachsprache
rund um Sportwetten, Wettbörsen und Quotenrechnung. **Aus** heißt: ganz
normale Transkription.

Gemessener Unterschied am selben Satz:

| Orion **AUS** | Orion **AN** |
|---|---|
| Poli**market** | Poly**market** |
| **Sourbet** | **Surebet** |
| Ge**bohren** | Ge**bühren** |

Zwei Stufen:

1. **Vorher:** die wichtigsten Begriffe gehen in die Erkennung.
2. **Nachher:** was trotzdem falsch ankam, wird geradegezogen.

### Eigene Begriffe

Im Reiter **Orion**. `Fachbegriffe` ist eine Liste, eine Zeile pro Begriff.
`Korrekturen` hat die Form `falsch gehört = richtig`:

```
schure bet = Surebet
poly market = Polymarket
```

Groß- und Kleinschreibung ist egal, Bindestriche auch: `bet fair` findet
auch `Bet-Fair` und `BetFair`.

Danach **Speichern und neu laden**. Sofort wirksam.

Für ein anderes Fachgebiet einfach die Listen austauschen. Am Programm
muss dafür nichts geändert werden.

### Was Orion absichtlich nicht tut

Gebeugte Formen bleiben unangetastet. Aus „Gebühren" wird nie „Gebühr",
aus „Quoten" nie „Quote". Ein korrekter Text darf durch die Korrektur
niemals schlechter werden.

---

## Herunterladen

**Als PDF**, **Als Word**, **Als Text**. Immer mit Sprecher-Namen und
echten Absätzen. Bei jedem Sprecherwechsel beginnt ein neuer Absatz.

Vorher in der Personen-Leiste auswählen, wer mitkommt.

Zeitstempel zuschaltbar im Reiter **Orion**.

---

## Vom Handy aus

Beim Start zeigt das schwarze Fenster zwei Adressen:

```
Auf diesem Laptop :  http://localhost:7345
Vom Handy aus     :  http://192.168.x.x:7345
```

Zweite Adresse im Handy-Browser, gleiches WLAN. Aufnahme starten, Sätze
anhören, PDF aufs Handy laden. Gerechnet wird immer auf dem Laptop.

---

## Tempo

Gemessen auf diesem Laptop (i5-10210U, keine Grafikkarte):

| Schritt | 1 Stunde Ton |
|---|---|
| Text mit `small` | ca. 40 min |
| Text mit `medium` | ca. 95 min |
| Stimmen trennen | ca. **8 min** |
| Geräusche erkennen | ca. 3 min |

Die Stimmentrennung ist der schnellste Teil, die kostet kaum etwas.

Zu langsam? Im Reiter **Orion** von `medium` auf `small` stellen.

---

## Die Fassung im Browser

Ohne Installation, auch am Handy:

**https://harryclaude-hub.github.io/transkript/**

Die kann seit dem Umbau fast alles, was die Laptop-Fassung kann, und
rechnet dabei **ebenfalls lokal**. Beim ersten Besuch werden rund 150 MB
Modelle geholt, danach bleiben sie im Browser und es geht auch ohne
Internet. Kein Ton geht an Google oder sonst wohin.

Drin: Aufnahme, Audiodateien, Wer-spricht, Sätze antippen und anhören,
nach Personen gefiltert herunterladen, Ablage.

Nicht drin, dafür bleibt der Laptop zuständig:

- **Hintergrundbetrieb.** Der Browser muss offen und sichtbar bleiben.
- **PC-Ton mitschneiden.**
- **Sehr lange Aufnahmen.** Der Browser hält den Ton im Arbeitsspeicher,
  rund 115 MB pro Stunde.
- **Die genaueren Modelle.**

Geräusche (Musik, Hund) sind im Browser ab Werk **aus**, weil dieser Teil
noch einmal 90 MB holt und der langsamste ist. Im Reiter **Stimmen**
zuschaltbar.

---

## Wo alles liegt

```
C:\Users\Home\transkript\
   START.bat            <- damit starten
   installieren.bat     <- einmalig
   modelle_holen.py     <- Modelle für Stimmen und Töne
   ergebnisse\          <- fertige PDFs, Word- und Textdateien
   aufnahmen\           <- roher Ton
   transkripte\         <- die Ablage
   begriffe\            <- die Orion-Listen
   modelle\             <- Spracherkennung (3,4 GB) + Stimmen (0,45 GB)
   weboberflaeche\
      stil.css          <- reines Design, darf gelöscht werden
      logik.js          <- Funktion
   kern\
      motor.py          <- Spracherkennung
      stimmen.py        <- wer spricht, was ist zu hören
      live.py           <- Aufnahme im Hintergrund
      orion.py          <- Fachbegriffe
      absaetze.py       <- Segmente zu Absätzen
      ausgabe.py        <- PDF / Word / Text
      ablage.py         <- gespeicherte Transkripte
```

Jede Live-Aufnahme wird als WAV in `aufnahmen\` gesichert. War ein
Transkript zu ungenau, lass die Datei im Reiter **Datei** noch einmal mit
dem genaueren Modell durchlaufen.

**Design und Funktion sind getrennt.** `stil.css` enthält kein Stück
Ablaufsteuerung. Die Datei darf gelöscht werden, das Programm rechnet
unverändert weiter.

---

## Wenn etwas klemmt

**„Es fehlen noch Programmteile"**
`installieren.bat` doppelklicken.

**Stimmenerkennung sagt „Modelle fehlen"**
`python modelle_holen.py` ausführen.

**Alle reden, aber es kommt nur eine Person heraus**
Im Reiter **Stimmen** den Regler *Wie schnell zwei Stimmen als
verschiedene Personen gelten* nach links. Oder die Anzahl fest einstellen.

**Eine Person wird in zwei aufgeteilt**
Denselben Regler nach rechts.

**Leise Stimmen fehlen im Text**
Empfindlichkeit auf 5.

**Zu viel Müll im Text (Husten, Rascheln)**
Empfindlichkeit auf 3.

**Die Erkennung startet nicht, Meldung über blockierte Dateien**
Auf diesem Laptop ist **Smart App Control** an. Deshalb ist in
`installieren.bat` `av==13.1.0` festgenagelt. Diese Zeile bitte nicht auf
eine neuere Version ändern.

Smart App Control abzuschalten empfehle ich nicht, das lässt sich ohne
Windows-Neuinstallation nicht rückgängig machen.

**Ein Satz lässt sich nicht anhören**
Zu dem Transkript gibt es keine Tondatei mehr. Prüfen, ob sie noch in
`aufnahmen\` liegt.
