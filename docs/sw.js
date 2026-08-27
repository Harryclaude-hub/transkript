/* ------------------------------------------------------------------
   Der Offline-Dienst.

   Legt die App-Dateien beiseite, damit die App auch ohne Internet
   startet. Die Sprachmodelle verwaltet transformers.js in einem eigenen
   Fach, die bleiben davon unberuehrt liegen.

   WICHTIG: Bei jeder Aenderung an den Dateien unten die FASSUNG
   hochzaehlen. Sonst benutzen Browser weiter die alte Fassung.
   ------------------------------------------------------------------ */

const FASSUNG = 'v5';
const FACH = 'transkript-' + FASSUNG;

/* Die eigenen Dateien. Ohne die startet die App nicht. */
const EIGENE = [
  './',
  './index.html',
  './stil.css?v=5',
  './begriffe.js?v=5',
  './orion.js?v=5',
  './pdf.js?v=5',
  './logik.js?v=5',
  './motor.js?v=5',
  './ton.js?v=5',
  './ablage.js?v=5',
  './manifest.json',
  './symbol-192.png',
  './symbol-512.png',
  './symbol-maske.png',
];

/* Der Rechenkern von aussen. Kommt vom CDN und wird ebenfalls behalten. */
const FREMDE = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers';

/* Die Modelle. Die verwaltet transformers.js selbst, hier nur durchlassen. */
const MODELLE = 'huggingface.co';


self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil((async () => {
    const fach = await caches.open(FACH);
    // Einzeln, damit eine fehlende Datei nicht die ganze Installation kippt.
    await Promise.all(EIGENE.map(async (adresse) => {
      try { await fach.add(new Request(adresse, { cache: 'reload' })); }
      catch (fehler) { console.warn('[sw] nicht gespeichert:', adresse, fehler); }
    }));
    await self.skipWaiting();
  })());
});


self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil((async () => {
    // Alte Fassungen aufraeumen, das Modell-Fach dabei in Ruhe lassen.
    const namen = await caches.keys();
    await Promise.all(namen
      .filter((n) => n.startsWith('transkript-') && n !== FACH)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});


self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET') return;

  const adresse = new URL(anfrage.url);

  // Modelle nicht anfassen, die haben ihr eigenes Fach.
  if (adresse.hostname.includes(MODELLE)) return;

  const eigen = adresse.origin === self.location.origin;
  const rechenkern = anfrage.url.startsWith(FREMDE);
  if (!eigen && !rechenkern) return;

  ereignis.respondWith((async () => {
    const fach = await caches.open(FACH);
    const beiseite = await fach.match(anfrage, { ignoreSearch: false });

    // Erst nachschauen, ob wir es schon haben. Das macht den Start schnell
    // und laesst die App auch ohne Internet laufen.
    if (beiseite) {
      // Im Hintergrund nachsehen, ob es etwas Neueres gibt.
      ereignis.waitUntil((async () => {
        try {
          const frisch = await fetch(anfrage);
          if (frisch && frisch.ok) await fach.put(anfrage, frisch.clone());
        } catch (fehler) { /* offline, macht nichts */ }
      })());
      return beiseite;
    }

    try {
      const antwort = await fetch(anfrage);
      if (antwort && antwort.ok) await fach.put(anfrage, antwort.clone());
      return antwort;
    } catch (fehler) {
      // Ohne Netz und ohne Vorrat: wenigstens die Startseite ausliefern.
      if (anfrage.mode === 'navigate') {
        const start = await fach.match('./index.html') || await fach.match('./');
        if (start) return start;
      }
      throw fehler;
    }
  })());
});


/* Die Seite kann fragen, was schon beiseite liegt. */
self.addEventListener('message', (ereignis) => {
  if (!ereignis.data) return;

  if (ereignis.data.was === 'fassung') {
    ereignis.source.postMessage({ was: 'fassung', fassung: FASSUNG });
  }

  if (ereignis.data.was === 'aufraeumen') {
    ereignis.waitUntil((async () => {
      const namen = await caches.keys();
      await Promise.all(namen.map((n) => caches.delete(n)));
      ereignis.source.postMessage({ was: 'aufgeraeumt' });
    })());
  }
});
