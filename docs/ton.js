/* ------------------------------------------------------------------
   Tonaufnahme und Wiedergabe.

   Nimmt den Ton als rohe Werte auf, nicht als fertige Datei. Nur so
   lassen sich einzelne Saetze punktgenau wieder abspielen und dieselben
   Werte gleichzeitig an die Spracherkennung geben.

   Gespeichert wird als 16-Bit-Ganzzahl bei 16 kHz Mono. Das sind rund
   115 MB pro Stunde, deutlich weniger als Fliesskomma.
   ------------------------------------------------------------------ */

export const RATE = 16000;

/* Der kleine Helfer, der im Tonstrang mitlaeuft und die Werte weiterreicht. */
const WERK = `
class Sammler extends AudioWorkletProcessor {
  process(eingang) {
    const kanal = eingang[0] && eingang[0][0];
    if (kanal && kanal.length) this.port.postMessage(kanal.slice(0));
    return true;
  }
}
registerProcessor('sammler', Sammler);
`;

export class Tonband {
  constructor() {
    this.stuecke = [];        // Int16Array je Haeppchen
    this.anzahl = 0;          // wie viele Werte insgesamt
    this.laeuft = false;
    this.pausiert = false;
    this.pegel = 0;
    this._ctx = null;
    this._strom = null;
    this._knoten = null;
    this._abspielCtx = null;
    this._quelle = null;
  }

  get sekunden() { return this.anzahl / RATE; }

  async starten() {
    this._strom = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false,
               noiseSuppression: false, autoGainControl: true },
    });

    // Der Browser rechnet selbst auf 16 kHz herunter, wenn man ihn darum bittet.
    this._ctx = new AudioContext({ sampleRate: RATE });
    if (this._ctx.state === 'suspended') await this._ctx.resume();

    const adresse = URL.createObjectURL(new Blob([WERK], { type: 'text/javascript' }));
    await this._ctx.audioWorklet.addModule(adresse);
    URL.revokeObjectURL(adresse);

    const eingang = this._ctx.createMediaStreamSource(this._strom);
    this._knoten = new AudioWorkletNode(this._ctx, 'sammler');

    this._knoten.port.onmessage = (e) => {
      if (this.pausiert) return;
      const werte = e.data;

      let summe = 0;
      const haeppchen = new Int16Array(werte.length);
      for (let i = 0; i < werte.length; i++) {
        const x = Math.max(-1, Math.min(1, werte[i]));
        haeppchen[i] = x < 0 ? x * 32768 : x * 32767;
        summe += Math.abs(x);
      }
      this.pegel = summe / werte.length;

      this.stuecke.push(haeppchen);
      this.anzahl += haeppchen.length;
    };

    eingang.connect(this._knoten);
    // Ohne Ziel laeuft der Strang in manchen Browsern nicht. Stumm anhaengen.
    const stumm = this._ctx.createGain();
    stumm.gain.value = 0;
    this._knoten.connect(stumm);
    stumm.connect(this._ctx.destination);

    this.laeuft = true;
    this.pausiert = false;
  }

  pause(an) {
    this.pausiert = !!an;
    if (an) this.pegel = 0;
  }

  stoppen() {
    this.laeuft = false;
    this.pegel = 0;
    try { if (this._knoten) this._knoten.port.onmessage = null; } catch (e) {}
    try { if (this._strom) this._strom.getTracks().forEach((s) => s.stop()); } catch (e) {}
    try { if (this._ctx) this._ctx.close(); } catch (e) {}
    this._ctx = null; this._strom = null; this._knoten = null;
  }

  /* ---------- Werte herausgeben ---------- */

  /** Alles als Float32Array, so wie die Erkennung es braucht. */
  alsFloat(vonSekunde = 0, bisSekunde = null) {
    const von = Math.max(0, Math.round(vonSekunde * RATE));
    const bis = bisSekunde === null ? this.anzahl
      : Math.min(this.anzahl, Math.round(bisSekunde * RATE));
    if (bis <= von) return new Float32Array(0);

    const raus = new Float32Array(bis - von);
    let gelesen = 0, geschrieben = 0;

    for (const stueck of this.stuecke) {
      const ende = gelesen + stueck.length;
      if (ende > von && gelesen < bis) {
        const a = Math.max(0, von - gelesen);
        const b = Math.min(stueck.length, bis - gelesen);
        for (let i = a; i < b; i++) raus[geschrieben++] = stueck[i] / 32768;
      }
      gelesen = ende;
      if (gelesen >= bis) break;
    }
    return raus;
  }

  /** Alles in EIN Int16Array, zum Speichern. */
  alsInt16() {
    const raus = new Int16Array(this.anzahl);
    let stelle = 0;
    for (const stueck of this.stuecke) { raus.set(stueck, stelle); stelle += stueck.length; }
    return raus;
  }

  /** Aus gespeicherten Werten wiederherstellen. */
  static ausInt16(werte) {
    const band = new Tonband();
    band.stuecke = [werte];
    band.anzahl = werte.length;
    return band;
  }

  leeren() {
    this.stuecke = [];
    this.anzahl = 0;
  }

  /* ---------- Abspielen ---------- */

  /**
   * Spielt genau einen Ausschnitt. Gibt eine Funktion zum Anhalten zurueck.
   * beiEnde wird gerufen, wenn der Ausschnitt durch ist.
   */
  abspielen(vonSekunde, bisSekunde, beiEnde) {
    this.abspielenStoppen();

    const werte = this.alsFloat(vonSekunde, bisSekunde);
    if (!werte.length) { if (beiEnde) beiEnde(); return () => {}; }

    if (!this._abspielCtx || this._abspielCtx.state === 'closed') {
      this._abspielCtx = new AudioContext();
    }
    const ctx = this._abspielCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const puffer = ctx.createBuffer(1, werte.length, RATE);
    puffer.copyToChannel(werte, 0);

    const quelle = ctx.createBufferSource();
    quelle.buffer = puffer;
    quelle.connect(ctx.destination);
    quelle.onended = () => {
      if (this._quelle === quelle) { this._quelle = null; if (beiEnde) beiEnde(); }
    };
    quelle.start();
    this._quelle = quelle;

    return () => this.abspielenStoppen();
  }

  abspielenStoppen() {
    if (this._quelle) {
      const q = this._quelle;
      this._quelle = null;
      try { q.onended = null; q.stop(); } catch (e) {}
    }
  }

  get spieltGerade() { return !!this._quelle; }
}


/* ---------- WAV schreiben ---------- */

export function alsWav(werte, rate = RATE) {
  const kopf = new ArrayBuffer(44);
  const sicht = new DataView(kopf);
  const text = (stelle, s) => {
    for (let i = 0; i < s.length; i++) sicht.setUint8(stelle + i, s.charCodeAt(i));
  };

  const daten = werte.length * 2;
  text(0, 'RIFF');
  sicht.setUint32(4, 36 + daten, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  sicht.setUint32(16, 16, true);
  sicht.setUint16(20, 1, true);          // PCM
  sicht.setUint16(22, 1, true);          // Mono
  sicht.setUint32(24, rate, true);
  sicht.setUint32(28, rate * 2, true);
  sicht.setUint16(32, 2, true);
  sicht.setUint16(34, 16, true);
  text(36, 'data');
  sicht.setUint32(40, daten, true);

  return new Blob([kopf, werte.buffer.slice(werte.byteOffset,
                                            werte.byteOffset + werte.byteLength)],
                  { type: 'audio/wav' });
}


/* ---------- Datei einlesen ---------- */

/** Wandelt eine beliebige Audiodatei in ein Tonband um. */
export async function dateiLesen(datei) {
  const roh = await datei.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const dekodiert = await ctx.decodeAudioData(roh);

  let werte = dekodiert.getChannelData(0);

  // Mehrere Kanaele zu Mono mischen
  if (dekodiert.numberOfChannels > 1) {
    const gemischt = new Float32Array(dekodiert.length);
    for (let k = 0; k < dekodiert.numberOfChannels; k++) {
      const kanal = dekodiert.getChannelData(k);
      for (let i = 0; i < kanal.length; i++) gemischt[i] += kanal[i];
    }
    for (let i = 0; i < gemischt.length; i++) gemischt[i] /= dekodiert.numberOfChannels;
    werte = gemischt;
  }

  // Auf 16 kHz bringen, falls der Browser eine andere Rate geliefert hat
  if (dekodiert.sampleRate !== RATE) {
    const anzahl = Math.round(werte.length * RATE / dekodiert.sampleRate);
    const neu = new Float32Array(anzahl);
    const schritt = werte.length / anzahl;
    for (let i = 0; i < anzahl; i++) {
      const stelle = i * schritt;
      const a = Math.floor(stelle);
      const b = Math.min(werte.length - 1, a + 1);
      const rest = stelle - a;
      neu[i] = werte[a] * (1 - rest) + werte[b] * rest;
    }
    werte = neu;
  }

  const ganz = new Int16Array(werte.length);
  for (let i = 0; i < werte.length; i++) {
    const x = Math.max(-1, Math.min(1, werte[i]));
    ganz[i] = x < 0 ? x * 32768 : x * 32767;
  }
  return Tonband.ausInt16(ganz);
}
