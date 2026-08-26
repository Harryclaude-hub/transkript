/* ------------------------------------------------------------------
   Die Ablage.

   Transkripte samt Tonspur bleiben im Browser gespeichert, in der
   IndexedDB. Die haelt anders als localStorage auch groessere Mengen aus,
   was noetig ist: eine Stunde Ton sind rund 115 MB.
   ------------------------------------------------------------------ */

const NAME = 'transkript';
const FACH = 'aufnahmen';
let db = null;

function oeffnen() {
  if (db) return Promise.resolve(db);
  return new Promise((fertig, schiefgegangen) => {
    const anfrage = indexedDB.open(NAME, 1);
    anfrage.onupgradeneeded = () => {
      const d = anfrage.result;
      if (!d.objectStoreNames.contains(FACH)) {
        d.createObjectStore(FACH, { keyPath: 'kennung' });
      }
    };
    anfrage.onsuccess = () => { db = anfrage.result; fertig(db); };
    anfrage.onerror = () => schiefgegangen(anfrage.error);
  });
}

async function inFach(art, arbeit) {
  const d = await oeffnen();
  return new Promise((fertig, schiefgegangen) => {
    const vorgang = d.transaction(FACH, art);
    const fach = vorgang.objectStore(FACH);
    let ergebnis;
    try { ergebnis = arbeit(fach); } catch (f) { schiefgegangen(f); return; }
    vorgang.oncomplete = () => fertig(ergebnis && ergebnis.result !== undefined
      ? ergebnis.result : ergebnis);
    vorgang.onerror = () => schiefgegangen(vorgang.error);
  });
}

function neueKennung() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_`
       + `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_`
       + Math.random().toString(36).slice(2, 8);
}

/**
 * eintrag: { kennung?, titel, segmente, dauer, namen, ton (Int16Array|null),
 *            personenBestimmt, quelle }
 */
export async function speichern(eintrag) {
  const kennung = eintrag.kennung || neueKennung();
  const daten = {
    ...eintrag,
    kennung,
    angelegt: eintrag.angelegt || new Date().toISOString(),
    geaendert: new Date().toISOString(),
  };
  await inFach('readwrite', (fach) => fach.put(daten));
  return kennung;
}

export async function laden(kennung) {
  return inFach('readonly', (fach) => fach.get(kennung));
}

export async function loeschen(kennung) {
  await inFach('readwrite', (fach) => fach.delete(kennung));
  return true;
}

export async function liste() {
  const alle = await inFach('readonly', (fach) => fach.getAll());
  const raus = (alle || []).map((e) => {
    const segmente = e.segmente || [];
    const personen = new Set(segmente.filter((s) => !s.geraeusch && s.person > 0)
                                     .map((s) => s.person));
    return {
      kennung: e.kennung,
      titel: e.titel || 'Ohne Titel',
      dauer: e.dauer || 0,
      angelegt: e.angelegt || '',
      quelle: e.quelle || '',
      woerter: segmente.filter((s) => !s.geraeusch)
        .reduce((n, s) => n + (s.text || '').split(/\s+/).filter(Boolean).length, 0),
      personen: personen.size,
      hatTon: !!(e.ton && e.ton.length),
      groesse: e.ton ? e.ton.length * 2 : 0,
    };
  });
  raus.sort((a, b) => (b.angelegt || '').localeCompare(a.angelegt || ''));
  return raus;
}

/** Wie viel Platz die Ablage insgesamt belegt, grob. */
export async function platz() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const s = await navigator.storage.estimate();
      return { benutzt: s.usage || 0, frei: (s.quota || 0) - (s.usage || 0) };
    }
  } catch (f) { /* nicht ueberall vorhanden */ }
  return null;
}
