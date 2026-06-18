import React, { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://senygjjmynyyljetrylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlbnlnampteW55eWxqZXRyeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDQ4ODMsImV4cCI6MjA5NzEyMDg4M30.QDiY125PiPojVquV9LcdbfCJgBINfHvUu2s10MxrQDo";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── GOOGLE DRIVE ──────────────────────────────────────────────────────────────
// Integrazione OAuth con Google Identity Services per creare cartelle e caricare
// file direttamente sul Drive personale dell'utente collegato all'app.
const GOOGLE_CLIENT_ID = "68065169766-cfec98ppm2f5dnqu7pgvgkb0necor593.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_TOKEN_STORAGE = "ovs_drive_token";

// Struttura archivio condivisa: usata sia per la creazione cartelle su Drive
// sia per la classificazione AI nel tab Documenti (vedi STRUTTURA_ARCHIVIO sotto).
const SOTTOCARTELLE_COMMESSA = [
  "DOC INIZIALE/DOC FONDAMENTALI",
  "DOC INIZIALE/DOC ACCESSORI",
  "DOC INIZIALE/IMMOBILIARE/CORRISPONDENZA IMMOBILIARE",
  "DOC INIZIALE/IMMOBILIARE/CONTRATTO",
  "PROGETTO SD",
  "PROGETTI IMPIANTI/MECCANICO",
  "PROGETTI IMPIANTI/ELETTRICO",
  "PROGETTI IMPIANTI/VVF",
  "PROGETTI ST",
  "COMPUTI",
  "HP INVESTIMENTO",
  "CRONOPROGRAMMA",
  "CONTABILITA'",
  "PRATICHE EDILIZIE/INIZIO LAVORI",
  "PRATICHE EDILIZIE/FINE LAVORI",
  "PRATICHE INSEGNE",
  "SOPRALLUOGHI/REPORT",
  "FOTO/FOTO INIZIALI",
  "FOTO/FOTO CANTIERE",
  "FOTO/FOTO APERTURA",
];

// Cartelle che, al momento dell'upload, ricevono in più una sottocartella
// con la data del giorno (es. "2026-06-17") per separare le revisioni nel tempo.
const CARTELLE_CON_SOTTOCARTELLA_DATA = new Set([
  "DOC INIZIALE/DOC FONDAMENTALI",
  "DOC INIZIALE/DOC ACCESSORI",
  "DOC INIZIALE/IMMOBILIARE/CORRISPONDENZA IMMOBILIARE",
  "DOC INIZIALE/IMMOBILIARE/CONTRATTO",
  "PROGETTO SD",
  "PROGETTI IMPIANTI/MECCANICO",
  "PROGETTI IMPIANTI/ELETTRICO",
  "PROGETTI IMPIANTI/VVF",
  "COMPUTI",
  "HP INVESTIMENTO",
  "CRONOPROGRAMMA",
  "SOPRALLUOGHI/REPORT",
  "FOTO/FOTO INIZIALI",
  "FOTO/FOTO CANTIERE",
  "FOTO/FOTO APERTURA",
]);

// Formatta la data odierna come "AAAA-MM-GG" per il nome della sottocartella
const dataDiOggiPerCartella = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Carica la libreria SheetJS via CDN per leggere file Excel/CSV nel browser.
// Condivisa tra il tab Documenti (classificazione AI) e il tab Budget (import HP INV).
const loadSheetJS = () => new Promise((resolve, reject) => {
  if (window.XLSX) { resolve(window.XLSX); return; }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  script.onload = () => resolve(window.XLSX);
  script.onerror = () => reject(new Error("Impossibile caricare il lettore Excel"));
  document.head.appendChild(script);
});

const getStoredDriveToken = () => {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) return null;
    return parsed.token;
  } catch { return null; }
};
const setStoredDriveToken = (token, expiresInSeconds) => {
  try {
    localStorage.setItem(DRIVE_TOKEN_STORAGE, JSON.stringify({
      token,
      expiresAt: Date.now() + (expiresInSeconds - 60) * 1000, // margine di sicurezza di 60s
    }));
  } catch {}
};
const clearStoredDriveToken = () => { try { localStorage.removeItem(DRIVE_TOKEN_STORAGE); } catch {} };

const loadGoogleIdentityScript = () => new Promise((resolve, reject) => {
  if (window.google?.accounts?.oauth2) { resolve(); return; }
  const script = document.createElement("script");
  script.src = "https://accounts.google.com/gsi/client";
  script.onload = () => resolve();
  script.onerror = () => reject(new Error("Impossibile caricare Google Identity Services"));
  document.head.appendChild(script);
});

// Richiede un token Drive: usa quello salvato se ancora valido, altrimenti
// apre il popup di login Google e ne richiede uno nuovo.
const richiediTokenDrive = () => new Promise(async (resolve, reject) => {
  const cached = getStoredDriveToken();
  if (cached) { resolve(cached); return; }

  try {
    await loadGoogleIdentityScript();
  } catch (e) { reject(e); return; }

  // Timeout di sicurezza: se il popup di accesso Google viene bloccato dal
  // browser o non arriva mai una risposta (silenziosamente, senza errore),
  // senza questo timeout la richiesta resterebbe bloccata per sempre.
  let risolta = false;
  const timeoutId = setTimeout(() => {
    if (!risolta) {
      risolta = true;
      reject(new Error("Richiesta di accesso a Google Drive scaduta: controlla che il browser non abbia bloccato il popup, poi riprova."));
    }
  }, 30000);

  const client = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (response) => {
      if (risolta) return;
      risolta = true;
      clearTimeout(timeoutId);
      if (response.error) { reject(new Error("Accesso a Google Drive negato o annullato.")); return; }
      setStoredDriveToken(response.access_token, response.expires_in || 3600);
      resolve(response.access_token);
    },
  });
  client.requestAccessToken();
});

const driveFetch = async (url, options = {}) => {
  const token = await richiediTokenDrive();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("La richiesta a Google Drive non ha risposto in tempo. Controlla la connessione e riprova.");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (res.status === 401) {
    // token scaduto o revocato: lo scartiamo e propaghiamo l'errore per un nuovo tentativo
    clearStoredDriveToken();
    throw new Error("Sessione Google Drive scaduta, riprova.");
  }
  return res;
};

const creaCartellaDrive = async (nome, parentId = null) => {
  const metadata = {
    name: nome,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const res = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.id;
};

// Crea la cartella della commessa con dentro tutte le sottocartelle annidate
// definite in SOTTOCARTELLE_COMMESSA. Ritorna l'id della cartella radice.
const creaStrutturaCommessaSuDrive = async (nomeCommessa) => {
  const rootId = await creaCartellaDrive(nomeCommessa);
  const cache = { "": rootId }; // path -> id, "" = radice

  for (const percorso of SOTTOCARTELLE_COMMESSA) {
    const parti = percorso.split("/");
    let pathCorrente = "";
    for (const parte of parti) {
      const pathPadre = pathCorrente;
      pathCorrente = pathCorrente ? `${pathCorrente}/${parte}` : parte;
      if (cache[pathCorrente]) continue;
      const idPadre = cache[pathPadre];
      const idNuovo = await creaCartellaDrive(parte, idPadre);
      cache[pathCorrente] = idNuovo;
    }
  }
  return { rootId, mappaCartelle: cache };
};

// Carica un file in una cartella Drive specifica (upload multipart semplice)
const caricaFileSuDrive = async (file, folderId) => {
  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.id;
};

// Trova l'id di una sottocartella esistente cercando una singola cartella
// figlia per nome, dato l'id della cartella padre.
const trovaSottocartella = async (nome, parentId) => {
  const query = encodeURIComponent(`name = '${nome.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.files?.[0]?.id || null;
};

// Naviga dalla cartella radice della commessa fino alla sottocartella indicata
// dal percorso (es. "PROGETTI IMPIANTI/ELETTRICO"), seguendo i nomi un livello alla volta.
// Se il percorso è tra quelli con sottocartella a data, in più cerca/crea al volo
// la sottocartella con la data di oggi (creata solo al primo upload del giorno).
const trovaIdSottocartellaDaPercorso = async (rootId, percorso) => {
  const parti = percorso.split("/");
  let idCorrente = rootId;
  for (const parte of parti) {
    const idTrovato = await trovaSottocartella(parte, idCorrente);
    if (!idTrovato) throw new Error(`Sottocartella "${parte}" non trovata su Drive — la struttura potrebbe non essere stata creata correttamente.`);
    idCorrente = idTrovato;
  }

  if (CARTELLE_CON_SOTTOCARTELLA_DATA.has(percorso)) {
    const nomeData = dataDiOggiPerCartella();
    let idData = await trovaSottocartella(nomeData, idCorrente);
    if (!idData) idData = await creaCartellaDrive(nomeData, idCorrente);
    idCorrente = idData;
  }

  return idCorrente;
};

// ── DATA ──────────────────────────────────────────────────────────────────────

const FASI = ["IPOTESI", "DEFINIZIONE PROGETTO", "INIZIO ATTIVITA CANTIERE", "ATTIVITA' CANTIERE", "RACCOLTA CONTABILITA' FINALE", "RACCOLTA DOCUMENTI"];

const WORKFLOW = [
  { id:1,  fase:"IPOTESI",                    da:"UFFICIO IMMOBILIARE",                   a:"",                                      titolo:"Richiesta Ufficio Immobiliare",                           automazione:"Creazione scheda negozio", tipo:"AI" },
  { id:2,  fase:"IPOTESI",                    da:"UFFICIO IMMOBILIARE",                   a:"SERVIZI TECNICI",                        titolo:"Ricevo DWG o PDF dei locali",                             automazione:"Spunta su ricezione DWG e PDF" },
  { id:3,  fase:"IPOTESI",                    da:"SERVIZI TECNICI",                       a:"UFFICIO IMMOBILIARE",                    titolo:"Calcolo MQ ai fini dell'investimento",                    automazione:"Spunta quando si invia mail a ufficio immobiliare" },
  { id:4,  fase:"IPOTESI",                    da:"UFFICIO IMMOBILIARE",                   a:"SERVIZI TECNICI",                        titolo:"Ricezione documenti fondamentali (Check Pratiche Amm.)",  automazione:"Spunta su ogni documento ricevuto – alert se manca qualcosa" },
  { id:5,  fase:"IPOTESI",                    da:"UFFICIO IMMOBILIARE e SERVIZI TECNICI", a:"UFFICIO IMMOBILIARE e SERVIZI TECNICI",  titolo:"Definizione capitolato di consegna locali",               automazione:"" },
  { id:6,  fase:"IPOTESI",                    da:"SERVIZI TECNICI",                       a:"UFFICIO IMMOBILIARE e SERVIZI TECNICI",  titolo:"Definizione imprese, progettisti e DL",                   automazione:"" },
  { id:7,  fase:"IPOTESI",                    da:"SERVIZI TECNICI",                       a:"",                                      titolo:"Sopralluogo iniziale",                                    automazione:"Crea meet su calendario", tipo:"CALENDAR" },
  { id:8,  fase:"IPOTESI",                    da:"SOFTWARE",                              a:"",                                      titolo:"Analisi AI su foto e documenti – report",                 automazione:"Restituzione file report", tipo:"AI" },
  { id:9,  fase:"IPOTESI",                    da:"SERVIZI TECNICI",                       a:"UFFICIO IMMOBILIARE",                    titolo:"Bozza ipotesi di investimento (HP INV)",                  automazione:"Spunta su invio bozza a ufficio immobiliare" },
  { id:10, fase:"IPOTESI",                    da:"SERVIZI TECNICI",                       a:"",                                      titolo:"Ordine impianti speciali (se necessario)",                automazione:"" },
  { id:11, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"STORE DESIGN",                          titolo:"Invio DWG a Store Design per layout interno",             automazione:"Spunta su invio a store design" },
  { id:12, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"",                                      titolo:"Sopralluogo con Store Design e ditte coinvolte",          automazione:"Crea meet su calendario", tipo:"CALENDAR" },
  { id:13, fase:"DEFINIZIONE PROGETTO",       da:"SOFTWARE",                              a:"",                                      titolo:"Analisi AI su foto e riunione cantiere – report",         automazione:"Restituzione file report", tipo:"AI" },
  { id:14, fase:"DEFINIZIONE PROGETTO",       da:"STORE DESIGN",                          a:"SERVIZI TECNICI",                       titolo:"Ricezione progetto architettonico da Store Design",       automazione:"Spunta su ricezione documenti" },
  { id:15, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"DL",                                    titolo:"Definizione cronoprogramma con DL",                       automazione:"" },
  { id:16, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"FORNITORE SMALTIMENTI",                 titolo:"Richiesta preventivo raccolta rifiuti",                   automazione:"" },
  { id:17, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"UFFICIO SECURITY",                      titolo:"Invio progetto a Ufficio Security",                       automazione:"" },
  { id:18, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"FORNITORE AUDIO",                       titolo:"Richiesta progetto e preventivo impianto audio",          automazione:"" },
  { id:19, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"PROGETTISTI",                           titolo:"Invio progetti a progettisti (elettrico + meccanico)",    automazione:"Spunta su invio documenti" },
  { id:20, fase:"DEFINIZIONE PROGETTO",       da:"TECNICO VVF",                           a:"SERVIZI TECNICI",                       titolo:"Valutazione tecnico VVF",                                 automazione:"Spunta su invio documenti" },
  { id:21, fase:"DEFINIZIONE PROGETTO",       da:"SERVIZI TECNICI",                       a:"CONTROLLO GESTIONE",                    titolo:"Ipotesi d'investimento definitiva a Controllo Gestione",  automazione:"Spunta su invio ipotesi" },
  { id:22, fase:"DEFINIZIONE PROGETTO",       da:"UFFICIO IMMOBILIARE",                   a:"SERVIZI TECNICI",                       titolo:"Firma contratto",                                         automazione:"Spunta a mano (contratti riservati)" },
  { id:23, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"UTILITY E BARBARA",                     titolo:"Voltura o attivazione utenze",                            automazione:"" },
  { id:24, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"CAPO AREA",                             titolo:"Invio lista materiali a Capo Area",                       automazione:"" },
  { id:25, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"UFFICIO ACQUISTI",                      titolo:"Ricezione lista materiali e invio a Ufficio Acquisti",    automazione:"" },
  { id:26, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"FORNITORE ZERBINO",                     titolo:"Richiesta zerbino a fornitore",                           automazione:"" },
  { id:27, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"FORNITORE SCAFFALI",                    titolo:"Richiesta scaffali – progetto e proposta economica",      automazione:"" },
  { id:28, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"CAPO AREA",                             titolo:"Invio progetto scaffali a Capo Area per approvazione",    automazione:"" },
  { id:29, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"IMPRESE COINVOLTE",                     titolo:"Invio computi elettrico e meccanico alle imprese",        automazione:"" },
  { id:30, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"IMPRESE COINVOLTE",                     titolo:"Ricezione e invio progetto Security alle imprese",        automazione:"" },
  { id:31, fase:"INIZIO ATTIVITA CANTIERE",   da:"DL",                                    a:"",                                      titolo:"DL: PSC, notifica preliminare, autorizzazioni edilizie",  automazione:"" },
  { id:32, fase:"INIZIO ATTIVITA CANTIERE",   da:"DL",                                    a:"",                                      titolo:"DL assume ruoli RL, DL, CSP, CSE",                        automazione:"" },
  { id:33, fase:"INIZIO ATTIVITA CANTIERE",   da:"SERVIZI TECNICI",                       a:"",                                      titolo:"Presa in consegna locali (verbale)",                      automazione:"" },
  { id:34, fase:"ATTIVITA' CANTIERE",         da:"SERVIZI TECNICI",                       a:"",                                      titolo:"Inizio cantiere",                                         automazione:"" },
  { id:35, fase:"ATTIVITA' CANTIERE",         da:"DL",                                    a:"FORNITORE PULIZIE",                     titolo:"Contattare impresa pulizie per gestione cantiere",        automazione:"" },
  { id:36, fase:"ATTIVITA' CANTIERE",         da:"TUTTI",                                 a:"",                                      titolo:"Riunione settimanale cantiere + report AI",               automazione:"Report AI da foto e registrazione riunione", tipo:"AI" },
  { id:37, fase:"ATTIVITA' CANTIERE",         da:"DL",                                    a:"",                                      titolo:"Caricamento settimanale verbale di cantiere",             automazione:"" },
  { id:38, fase:"ATTIVITA' CANTIERE",         da:"SOFTWARE",                              a:"",                                      titolo:"Controllo settimanale con strumento report AI",           automazione:"Controllo settimanale in cantiere con strumento report AI", tipo:"AI" },
  { id:39, fase:"ATTIVITA' CANTIERE",         da:"SERVIZI TECNICI",                       a:"CAPO AREA",                             titolo:"Definire giorno consegna punto vendita a Capo Area",      automazione:"" },
  { id:40, fase:"ATTIVITA' CANTIERE",         da:"IMPRESE COINVOLTE",                     a:"SERVIZI TECNICI",                       titolo:"Collaudo impianti",                                       automazione:"" },
  { id:41, fase:"ATTIVITA' CANTIERE",         da:"IMPRESE COINVOLTE",                     a:"",                                      titolo:"Installazione cartellonistica e mezzi estinzione VVF",    automazione:"" },
  { id:42, fase:"ATTIVITA' CANTIERE",         da:"IMPRESE COINVOLTE",                     a:"",                                      titolo:"Assistenza tecnica durante allestimento",                 automazione:"" },
  { id:43, fase:"ATTIVITA' CANTIERE",         da:"",                                       a:"",                                      titolo:"⭐ APERTURA",                                              automazione:"", tipo:"APERTURA" },
  { id:44, fase:"RACCOLTA CONTABILITA' FINALE", da:"IMPRESE COINVOLTE",                   a:"SERVIZI TECNICI",                       titolo:"Ricezione consuntivi da caricare su gestionale",         automazione:"" },
  { id:45, fase:"RACCOLTA DOCUMENTI",         da:"SERVIZI TECNICI",                       a:"",                                      titolo:"Caricamento consuntivi su software AI – monitoraggio budget", automazione:"Monitoraggio budget residuo", tipo:"AI" },
  { id:46, fase:"RACCOLTA DOCUMENTI",         da:"IMPRESE COINVOLTE",                     a:"",                                      titolo:"Ricezione documentazione tecnica fine cantiere (DICO, VVF, ecc.)", automazione:"" },
];

const PRATICHE = [
  { categoria:"VIGILI DEL FUOCO",               voce:"CPI",                                                           priorita:"ASSOLUTA" },
  { categoria:"VIGILI DEL FUOCO",               voce:"DIA VVF con richiesta sopraluogo",                              priorita:"ASSOLUTA" },
  { categoria:"VIGILI DEL FUOCO",               voce:"Esame progetto approvato dai VVF",                              priorita:"ASSOLUTA" },
  { categoria:"VIGILI DEL FUOCO",               voce:"Relazione tecnica annessa all'esame progetto",                  priorita:"ASSOLUTA" },
  { categoria:"IMPIANTI ANTINCENDIO",           voce:"Dichiarazione conformità – rilevazione fumi",                   priorita:"MEDIA" },
  { categoria:"IMPIANTI ANTINCENDIO",           voce:"Dichiarazione conformità – idranti",                            priorita:"MEDIA" },
  { categoria:"IMPIANTI ANTINCENDIO",           voce:"Dichiarazione conformità – sprinkler",                          priorita:"MEDIA" },
  { categoria:"ASL",                            voce:"Pratica ASL o NOTS",                                            priorita:"ALTA" },
  { categoria:"ASL",                            voce:"Deroga piani interrati art. 65 TU 81/2008",                     priorita:"ASSOLUTA" },
  { categoria:"AMBIENTE",                       voce:"Dichiarazione mancata presenza amianto",                        priorita:"ASSOLUTA" },
  { categoria:"AMBIENTE",                       voce:"Dichiarazione assenza PCB (cabina MT)",                         priorita:"MEDIA" },
  { categoria:"AMBIENTE",                       voce:"Valutazione gas radon (piani interrati)",                       priorita:"ALTA" },
  { categoria:"AMBIENTE",                       voce:"Valutazione campi elettromagnetici (cabina MT)",                priorita:"BASSA" },
  { categoria:"AMBIENTE",                       voce:"Autorizzazione scarico in fogna",                               priorita:"MEDIA" },
  { categoria:"EDILIZIA",                       voce:"Certificato di Agibilità",                                      priorita:"ASSOLUTA" },
  { categoria:"EDILIZIA",                       voce:"File DWG stato di fatto tutti i piani",                         priorita:"ASSOLUTA" },
  { categoria:"EDILIZIA",                       voce:"Autorizzazione edilizia / Concessione originaria",              priorita:"ASSOLUTA" },
  { categoria:"EDILIZIA",                       voce:"Pratiche Genio Civile per strutture",                           priorita:"MEDIA" },
  { categoria:"EDILIZIA",                       voce:"Collaudo statico",                                              priorita:"ALTA" },
  { categoria:"EDILIZIA",                       voce:"Dichiarazione asseverata portata lastrico solare",               priorita:"ALTA" },
  { categoria:"EDILIZIA",                       voce:"Condoni e sanatorie",                                           priorita:"ALTA" },
  { categoria:"EDILIZIA",                       voce:"Autorizzazioni Soprintendenza BBAA",                            priorita:"ASSOLUTA" },
  { categoria:"CATASTO",                        voce:"Visura catastale e planimetrie",                                 priorita:"ALTA" },
  { categoria:"PUBBLICITA'",                    voce:"Autorizzazione insegne",                                        priorita:"ASSOLUTA" },
  { categoria:"ENERGIA",                        voce:"Contratto fornitura energia elettrica",                         priorita:"ASSOLUTA" },
  { categoria:"ENERGIA",                        voce:"Contratto fornitura gas",                                       priorita:"ASSOLUTA" },
  { categoria:"ENERGIA",                        voce:"Contratto fornitura acqua",                                     priorita:"ASSOLUTA" },
  { categoria:"ENERGIA",                        voce:"Bollette luglio-agosto energia elettrica (ultimi 3 anni)",      priorita:"ALTA" },
];

const BUDGET_VOCI = [
  { categoria:"A. IMMAGINE INTERNA", n:"1",   voce:"Arredo vendita",                          resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"2",   voce:"Arredo luce",                             resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"3",   voce:"Controsoffitto",                          resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"4",   voce:"Cartongessi",                             resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"5",   voce:"Immagine",                                resp:"VISUAL.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"5a",  voce:"Caratterizzazioni",                       resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"5b",  voce:"Altre caratterizzazioni",                 resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"6",   voce:"Fornitura pavimento",                     resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"6a",  voce:"Posa pavimento",                          resp:"SERV.TEC." },
  { categoria:"A. IMMAGINE INTERNA", n:"7",   voce:"Opere da pittore",                        resp:"STORE.D." },
  { categoria:"A. IMMAGINE INTERNA", n:"8",   voce:"Completamenti immagine",                  resp:"STORE.D." },
  { categoria:"B. IMMAGINE ESTERNA", n:"9",   voce:"Esterni",                                 resp:"SERV.TEC." },
  { categoria:"B. IMMAGINE ESTERNA", n:"10",  voce:"Insegne",                                 resp:"STORE.D." },
  { categoria:"C. IMPIANTI",         n:"11",  voce:"Condizionamento / Riscaldamento",         resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"12",  voce:"Idrico sanitario",                        resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"13",  voce:"Elettrico",                               resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"13a", voce:"Gruppi continuità e UPS",                 resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"14",  voce:"Impianti telefonici (rete dati e fonia)", resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"15",  voce:"Antincendio e sprinkler",                 resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"16",  voce:"Attrezzature elettriche e comunicazione", resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"17",  voce:"Attrezzature telefoniche (centralino)",   resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"17a", voce:"Contapersone",                            resp:"SERV.TEC." },
  { categoria:"C. IMPIANTI",         n:"18",  voce:"Security",                                resp:"SERV.TEC." },
  { categoria:"D. COLLEGAMENTI",     n:"19",  voce:"Impianti di sollevamento",                resp:"SERV.TEC." },
  { categoria:"E. OPERE EDILI",      n:"20",  voce:"Opere edili",                             resp:"SERV.TEC." },
  { categoria:"E. OPERE EDILI",      n:"21",  voce:"Assistenze",                              resp:"SERV.TEC." },
  { categoria:"F. UFFICI-RISERVE",   n:"22",  voce:"Stigliatpure",                            resp:"SERV.TEC." },
  { categoria:"F. UFFICI-RISERVE",   n:"23",  voce:"Arredo uffici/servizi",                   resp:"SERV.TEC." },
  { categoria:"F. UFFICI-RISERVE",   n:"24",  voce:"Controsoffitto",                          resp:"SERV.TEC." },
  { categoria:"F. UFFICI-RISERVE",   n:"25",  voce:"Pavimento",                               resp:"SERV.TEC." },
  { categoria:"F. UFFICI-RISERVE",   n:"26",  voce:"Opere da pittore",                        resp:"SERV.TEC." },
  { categoria:"G. COMPL. TECNICI",   n:"27",  voce:"Completamenti tecnici",                   resp:"SERV.TEC." },
  { categoria:"H. CONSULENZE",       n:"28",  voce:"Consulenze capitalizzate",                 resp:"" },
  { categoria:"SPESATO",             n:"29",  voce:"Consulenze spesate",                       resp:"SERV.TEC." },
  { categoria:"SPESATO",             n:"30",  voce:"Pulizie cantiere",                        resp:"SERV.TEC." },
  { categoria:"SPESATO",             n:"31",  voce:"Vigilanza",                               resp:"SERV.TEC." },
  { categoria:"SPESATO",             n:"32",  voce:"Smaltimenti e bonifiche",                 resp:"SERV.TEC." },
  { categoria:"SPESATO",             n:"32b", voce:"Smontaggi e smaltimento arredi",          resp:"STORE D." },
  { categoria:"SPESATO",             n:"33",  voce:"Rimozioni impianti e QE cantiere",        resp:"SERV.TEC." },
  { categoria:"SPESATO",             n:"34",  voce:"Varie – occupazione suolo pubblico",      resp:"VISUAL.D." },
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

const PRIORITA_COLOR = { ASSOLUTA:"#ef4444", ALTA:"#f97316", MEDIA:"#eab308", BASSA:"#22c55e" };
const TIPO_BADGE = {
  AI:       { label:"🤖 AI", bg:"#1e3a5f", color:"#7dd3fc" },
  CALENDAR: { label:"📅 Meet", bg:"#14532d", color:"#86efac" },
  APERTURA: { label:"🏪 APERTURA", bg:"#4c1d95", color:"#c4b5fd" },
};

function fmtEur(v) {
  if (!v && v !== 0) return "";
  return new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR", maximumFractionDigits:0 }).format(v);
}

const NOMI_MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

// Elenco brand gestiti, usato sia nella Scheda Negozio (creazione commessa)
// sia come filtro nei selettori "Commessa" degli altri tab.
const BRAND_LIST = ["OVS","UPIM","STEFANEL","GOLDEN POINT"];

// Formatta il periodo cantiere, salvato come "AAAA-MM", in forma leggibile
// (es. "Giugno 2026"). Usata nel riepilogo della Scheda Negozio.
function formattaPeriodo(periodo) {
  if (!periodo || !periodo.includes("-")) return periodo || "";
  const [anno, mese] = periodo.split("-");
  const nomeMese = NOMI_MESI[Number(mese) - 1];
  return nomeMese ? `${nomeMese} ${anno}` : periodo;
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────

function Badge({ tipo }) {
  if (!tipo || !TIPO_BADGE[tipo]) return null;
  const { label, bg, color } = TIPO_BADGE[tipo];
  return (
    <span style={{ background:bg, color, fontSize:"0.68rem", fontWeight:700, padding:"2px 8px", borderRadius:99, letterSpacing:"0.04em", whiteSpace:"nowrap" }}>
      {label}
    </span>
  );
}

function PrioritaBadge({ p }) {
  return (
    <span style={{ background: PRIORITA_COLOR[p] + "22", color: PRIORITA_COLOR[p], border:`1px solid ${PRIORITA_COLOR[p]}44`, fontSize:"0.68rem", fontWeight:700, padding:"2px 8px", borderRadius:99 }}>
      {p}
    </span>
  );
}

// ── TABS ──────────────────────────────────────────────────────────────────────

function TabWorkflow({ commessaIdGlobale, onCambiaCommessa }) {
  const [faseFiltro, setFaseFiltro] = useState("TUTTE");
  const [searchQ, setSearchQ] = useState("");
  const [commesse, setCommesse] = useState([]);
  const [commessaId, setCommessaId] = useState(commessaIdGlobale || "");
  const [caricamentoCommesse, setCaricamentoCommesse] = useState(true);
  const [filtroBrand, setFiltroBrand] = useState("TUTTI");
  const [completati, setCompletati] = useState(new Set()); // Set di workflow_id completati per la commessa selezionata
  const [caricamentoStati, setCaricamentoStati] = useState(false);
  const [erroreStati, setErroreStati] = useState("");
  const [aggiornamentoInCorso, setAggiornamentoInCorso] = useState(null); // workflow_id in fase di toggle, per disabilitare il click doppio

  const commesseFiltrate = filtroBrand === "TUTTI" ? commesse : commesse.filter(c => c.brand === filtroBrand);

  // Carica l'elenco commesse una sola volta
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("commesse").select("*").order("created_at", { ascending:false });
      if (!error && data) setCommesse(data);
      setCaricamentoCommesse(false);
    })();
  }, []);

  // Sincronizza con la selezione globale (es. se cambiata da un altro tab)
  useEffect(() => {
    if (commessaIdGlobale !== undefined && commessaIdGlobale !== commessaId) {
      setCommessaId(commessaIdGlobale || "");
    }
  }, [commessaIdGlobale]);

  const selezionaCommessaLocale = (id) => {
    setCommessaId(id);
    onCambiaCommessa?.(id || null);
  };

  // Ogni volta che cambia la commessa, carica da Supabase quali attività
  // sono già state completate per quella commessa.
  useEffect(() => {
    if (!commessaId) {
      setCompletati(new Set());
      return;
    }
    (async () => {
      setCaricamentoStati(true);
      setErroreStati("");
      try {
        const { data, error } = await supabase
          .from("workflow_completato")
          .select("workflow_id")
          .eq("commessa_id", commessaId);
        if (error) throw error;
        setCompletati(new Set((data || []).map(r => r.workflow_id)));
      } catch (e) {
        setErroreStati(e.message || "Errore durante il caricamento dello stato del workflow.");
      } finally {
        setCaricamentoStati(false);
      }
    })();
  }, [commessaId]);

  const filtered = WORKFLOW.filter(w =>
    (faseFiltro === "TUTTE" || w.fase === faseFiltro) &&
    (w.titolo.toLowerCase().includes(searchQ.toLowerCase()) || w.da.toLowerCase().includes(searchQ.toLowerCase()) || w.a.toLowerCase().includes(searchQ.toLowerCase()))
  );

  const numCompletati = completati.size;
  const pct = Math.round((numCompletati / WORKFLOW.length) * 100);

  // Spunta/togli un'attività: inserisce o elimina la riga corrispondente su
  // Supabase, così lo stato resta sempre legato alla commessa selezionata e
  // persistente tra sessioni.
  const toggle = async (workflowId) => {
    if (!commessaId) return;
    setAggiornamentoInCorso(workflowId);
    const eraCompletato = completati.has(workflowId);
    try {
      if (eraCompletato) {
        const { error } = await supabase.from("workflow_completato").delete().eq("commessa_id", commessaId).eq("workflow_id", workflowId);
        if (error) throw error;
        setCompletati(prev => { const next = new Set(prev); next.delete(workflowId); return next; });
      } else {
        const { error } = await supabase.from("workflow_completato").insert({ commessa_id: commessaId, workflow_id: workflowId });
        if (error) throw error;
        setCompletati(prev => new Set(prev).add(workflowId));
      }
    } catch (e) {
      setErroreStati(e.message || "Errore durante l'aggiornamento dello stato.");
    } finally {
      setAggiornamentoInCorso(null);
    }
  };

  return (
    <div>
      {/* selettore brand + commessa */}
      <div style={{ marginBottom:20 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Brand</label>
        <select
          value={filtroBrand}
          onChange={e => setFiltroBrand(e.target.value)}
          style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem", cursor:"pointer", marginBottom:10 }}
        >
          <option value="TUTTI">Tutti i brand</option>
          {BRAND_LIST.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Commessa</label>
        <select
          value={commessaId}
          onChange={e => selezionaCommessaLocale(e.target.value)}
          style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem", cursor:"pointer" }}
        >
          <option value="">Seleziona una commessa…</option>
          {commesseFiltrate.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {caricamentoCommesse && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Caricamento elenco commesse…</div>}
        {!caricamentoCommesse && commesseFiltrate.length === 0 && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Nessuna commessa trovata per questo brand.</div>}
        {!commessaId && !caricamentoCommesse && <div style={{ color:"#64748b", fontSize:"0.78rem", marginTop:6 }}>Seleziona una commessa per vedere e aggiornare l'avanzamento del workflow.</div>}
        {caricamentoStati && <div style={{ color:"#7dd3fc", fontSize:"0.78rem", marginTop:6 }}>⏳ Caricamento avanzamento…</div>}
        {erroreStati && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:6 }}>{erroreStati}</div>}
      </div>

      {commessaId && (
      <>
      {/* progress bar */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ color:"#94a3b8", fontSize:"0.85rem" }}>Avanzamento complessivo</span>
          <span style={{ color:"#e2e8f0", fontWeight:700 }}>{numCompletati} / {WORKFLOW.length} attività — {pct}%</span>
        </div>
        <div style={{ background:"#1e293b", borderRadius:99, height:8 }}>
          <div style={{ background:"linear-gradient(90deg,#3b82f6,#06b6d4)", borderRadius:99, height:8, width:`${pct}%`, transition:"width 0.4s" }} />
        </div>
      </div>

      {/* filtri */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        <input
          value={searchQ} onChange={e=>setSearchQ(e.target.value)}
          placeholder="Cerca attività…"
          style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"6px 12px", fontSize:"0.85rem", flex:1, minWidth:160, outline:"none" }}
        />
        {["TUTTE", ...FASI].map(f => (
          <button key={f} onClick={()=>setFaseFiltro(f)}
            style={{ background: faseFiltro===f ? "#3b82f6" : "#1e293b", color: faseFiltro===f ? "#fff" : "#94a3b8", border:`1px solid ${faseFiltro===f?"#3b82f6":"#334155"}`, borderRadius:8, padding:"6px 12px", fontSize:"0.78rem", cursor:"pointer", whiteSpace:"nowrap" }}>
            {f}
          </button>
        ))}
      </div>

      {/* lista attività per fase */}
      {FASI.filter(f => faseFiltro === "TUTTE" || f === faseFiltro).map(fase => {
        const items = filtered.filter(w => w.fase === fase);
        if (!items.length) return null;
        const doneInFase = items.filter(w => completati.has(w.id)).length;
        return (
          <div key={fase} style={{ marginBottom:24 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
              <div style={{ height:2, flex:1, background:"#334155" }} />
              <span style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.08em", whiteSpace:"nowrap" }}>{fase}</span>
              <span style={{ color:"#475569", fontSize:"0.75rem" }}>{doneInFase}/{items.length}</span>
              <div style={{ height:2, flex:1, background:"#334155" }} />
            </div>
            {items.map(w => {
              const fatto = completati.has(w.id);
              return (
                <div key={w.id} onClick={()=> aggiornamentoInCorso!==w.id && toggle(w.id)}
                  style={{ display:"flex", alignItems:"flex-start", gap:12, background: fatto?"#0f172a":"#1e293b", border:`1px solid ${fatto?"#1d4ed8":"#334155"}`, borderRadius:10, padding:"12px 14px", marginBottom:6, cursor: aggiornamentoInCorso===w.id ? "wait" : "pointer", transition:"border-color 0.2s, background 0.2s", opacity: aggiornamentoInCorso===w.id ? 0.6 : 1 }}>
                  {/* checkbox */}
                  <div style={{ width:20, height:20, borderRadius:6, border:`2px solid ${fatto?"#3b82f6":"#475569"}`, background:fatto?"#3b82f6":"transparent", flexShrink:0, marginTop:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    {fatto && <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                      <span style={{ color: fatto?"#64748b":"#e2e8f0", fontWeight:600, fontSize:"0.9rem", textDecoration:fatto?"line-through":"none" }}>{w.titolo}</span>
                      <Badge tipo={w.tipo} />
                    </div>
                    <div style={{ display:"flex", gap:12, flexWrap:"wrap", fontSize:"0.78rem", color:"#64748b" }}>
                      {w.da && <span>📤 {w.da}</span>}
                      {w.a  && <span>📥 {w.a}</span>}
                      {w.automazione && <span style={{ color:"#475569" }}>⚡ {w.automazione}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      </>
      )}
    </div>
  );
}

function TabPratiche({ commessaIdGlobale, onCambiaCommessa }) {
  const [stati, setStati] = useState(() => Object.fromEntries(PRATICHE.map((p,i) => [i, "—"])));
  const [filtroP, setFiltroP] = useState("TUTTE");
  const [commesse, setCommesse] = useState([]);
  const [commessaId, setCommessaId] = useState(commessaIdGlobale || "");
  const [caricamentoCommesse, setCaricamentoCommesse] = useState(true);
  const [filtroBrand, setFiltroBrand] = useState("TUTTI");
  const [documentiPerVoce, setDocumentiPerVoce] = useState({}); // voce -> [ {nome_file, riassunto, dati_chiave, data_caricamento}, ... ]
  const [caricamentoDocumenti, setCaricamentoDocumenti] = useState(false);
  const [erroreDocumenti, setErroreDocumenti] = useState("");
  const [voceSelezionata, setVoceSelezionata] = useState(null); // testo voce mostrata nel pannello dettaglio
  const [rimozioneInCorso, setRimozioneInCorso] = useState(null); // id del documento in fase di rimozione, per disabilitare il pulsante
  const [erroreRimozione, setErroreRimozione] = useState("");

  const cats = [...new Set(PRATICHE.map(p=>p.categoria))];
  const commesseFiltrate = filtroBrand === "TUTTI" ? commesse : commesse.filter(c => c.brand === filtroBrand);

  // Carica l'elenco commesse una sola volta
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("commesse").select("*").order("created_at", { ascending:false });
      if (!error && data) setCommesse(data);
      setCaricamentoCommesse(false);
    })();
  }, []);

  // Sincronizza con la selezione globale (es. se cambiata da un altro tab)
  useEffect(() => {
    if (commessaIdGlobale !== undefined && commessaIdGlobale !== commessaId) {
      setCommessaId(commessaIdGlobale || "");
    }
  }, [commessaIdGlobale]);

  const selezionaCommessaLocale = (id) => {
    setCommessaId(id);
    onCambiaCommessa?.(id || null);
  };

  // Ogni volta che cambia la commessa, carica da Supabase tutti i documenti
  // collegati a voci della checklist per quella commessa, raggruppati per voce.
  useEffect(() => {
    if (!commessaId) {
      setDocumentiPerVoce({});
      setVoceSelezionata(null);
      return;
    }
    (async () => {
      setCaricamentoDocumenti(true);
      setErroreDocumenti("");
      try {
        const { data, error } = await supabase
          .from("pratiche_amministrative_doc")
          .select("*")
          .eq("commessa_id", commessaId)
          .order("data_caricamento", { ascending:false });
        if (error) throw error;
        const raggruppati = {};
        (data || []).forEach(riga => {
          if (!raggruppati[riga.voce]) raggruppati[riga.voce] = [];
          raggruppati[riga.voce].push(riga);
        });
        setDocumentiPerVoce(raggruppati);
      } catch (e) {
        setErroreDocumenti(e.message || "Errore durante il caricamento dei documenti collegati.");
      } finally {
        setCaricamentoDocumenti(false);
      }
    })();
  }, [commessaId]);

  // Stato effettivo di una voce: se ha almeno un documento collegato da
  // Supabase, è automaticamente "presente" (spunta verde), indipendentemente
  // dal ciclo manuale — che resta utile per segnare NO / NP sulle voci senza
  // documento collegato.
  const statoEffettivo = (idx, voce) => {
    if (documentiPerVoce[voce]?.length > 0) return "PRESENTE";
    return stati[idx];
  };

  const pctSi = Math.round((PRATICHE.filter((p,i) => statoEffettivo(i,p.voce) === "PRESENTE" || statoEffettivo(i,p.voce) === "SI").length / PRATICHE.length)*100);

  const cycle = (i) => setStati(s => ({ ...s, [i]: s[i]==="—"?"SI":s[i]==="SI"?"NO":s[i]==="NO"?"NP":"—" }));
  const STATUS_STYLE = { "PRESENTE":{ bg:"#14532d", color:"#86efac" }, "SI":{ bg:"#14532d", color:"#86efac" }, "NO":{ bg:"#450a0a", color:"#fca5a5" }, "NP":{ bg:"#1e293b", color:"#7dd3fc" }, "—":{ bg:"#0f172a", color:"#475569" } };

  // Rimuove un collegamento documento-voce sbagliato (es. l'AI ha riconosciuto
  // male il documento). Se era l'unico documento della voce, la voce torna
  // al ciclo manuale —/SI/NO/NP come prima del collegamento.
  const rimuoviCollegamento = async (doc) => {
    setRimozioneInCorso(doc.id);
    setErroreRimozione("");
    try {
      const { error } = await supabase.from("pratiche_amministrative_doc").delete().eq("id", doc.id);
      if (error) throw error;
      setDocumentiPerVoce(prev => {
        const aggiornato = { ...prev };
        const rimasti = (aggiornato[doc.voce] || []).filter(d => d.id !== doc.id);
        if (rimasti.length > 0) aggiornato[doc.voce] = rimasti;
        else delete aggiornato[doc.voce];
        return aggiornato;
      });
      // Se non restano altri documenti per questa voce, chiude il pannello dettaglio
      setVoceSelezionata(prev => {
        const rimasti = documentiPerVoce[doc.voce]?.filter(d => d.id !== doc.id) || [];
        return rimasti.length > 0 ? prev : null;
      });
    } catch (e) {
      setErroreRimozione(e.message || "Errore durante la rimozione del collegamento.");
    } finally {
      setRimozioneInCorso(null);
    }
  };

  const docVoceSelezionata = voceSelezionata ? documentiPerVoce[voceSelezionata] : null;

  return (
    <div style={{ display:"grid", gridTemplateColumns: docVoceSelezionata ? "1fr 1.1fr" : "1fr", gap:20 }}>
      <div>
        {/* selettore commessa */}
        <div style={{ marginBottom:16 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Brand</label>
          <select
            value={filtroBrand}
            onChange={e => setFiltroBrand(e.target.value)}
            style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem", cursor:"pointer", marginBottom:10 }}
          >
            <option value="TUTTI">Tutti i brand</option>
            {BRAND_LIST.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Commessa</label>
          <select
            value={commessaId}
            onChange={e => selezionaCommessaLocale(e.target.value)}
            style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem", cursor:"pointer" }}
          >
            <option value="">Seleziona una commessa…</option>
            {commesseFiltrate.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          {caricamentoCommesse && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Caricamento elenco commesse…</div>}
          {!caricamentoCommesse && commesseFiltrate.length === 0 && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Nessuna commessa trovata per questo brand.</div>}
          {!commessaId && !caricamentoCommesse && <div style={{ color:"#64748b", fontSize:"0.78rem", marginTop:6 }}>Seleziona una commessa per vedere quali documenti sono già stati collegati automaticamente dal tab Documenti.</div>}
          {caricamentoDocumenti && <div style={{ color:"#7dd3fc", fontSize:"0.78rem", marginTop:6 }}>⏳ Caricamento documenti collegati…</div>}
          {erroreDocumenti && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:6 }}>{erroreDocumenti}</div>}
        </div>

        <div style={{ display:"flex", gap:16, marginBottom:20, flexWrap:"wrap" }}>
          {["TUTTE","ASSOLUTA","ALTA","MEDIA","BASSA"].map(f=>(
            <button key={f} onClick={()=>setFiltroP(f)}
              style={{ background:filtroP===f?"#1d4ed8":"#1e293b", color:filtroP===f?"#fff":"#94a3b8", border:`1px solid ${filtroP===f?"#3b82f6":"#334155"}`, borderRadius:8, padding:"5px 12px", fontSize:"0.78rem", cursor:"pointer" }}>
              {f}
            </button>
          ))}
          <span style={{ marginLeft:"auto", color:"#94a3b8", fontSize:"0.85rem", alignSelf:"center" }}>
            ✅ {PRATICHE.filter((p,i) => statoEffettivo(i,p.voce) === "PRESENTE" || statoEffettivo(i,p.voce) === "SI").length} / {PRATICHE.length} — {pctSi}%
          </span>
        </div>

        {cats.map(cat => {
          const items = PRATICHE.filter((p,i)=> p.categoria===cat && (filtroP==="TUTTE"||p.priorita===filtroP));
          if (!items.length) return null;
          return (
            <div key={cat} style={{ marginBottom:20 }}>
              <div style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.08em", marginBottom:8, paddingBottom:6, borderBottom:"1px solid #1e3a5f" }}>{cat}</div>
              {items.map((p) => {
                const idx = PRATICHE.indexOf(p);
                const s = statoEffettivo(idx, p.voce);
                const ss = STATUS_STYLE[s];
                const haDocumenti = documentiPerVoce[p.voce]?.length > 0;
                return (
                  <div key={idx}
                    onClick={() => haDocumenti && setVoceSelezionata(p.voce)}
                    style={{ display:"flex", alignItems:"center", gap:12, background: voceSelezionata===p.voce?"#1e3a5f":"#1e293b", border:`1px solid ${voceSelezionata===p.voce?"#3b82f6":"#334155"}`, borderRadius:8, padding:"10px 14px", marginBottom:5, cursor: haDocumenti ? "pointer" : "default" }}>
                    <PrioritaBadge p={p.priorita} />
                    <span style={{ flex:1, color:"#cbd5e1", fontSize:"0.88rem" }}>
                      {p.voce}
                      {haDocumenti && <span style={{ color:"#475569", fontSize:"0.75rem" }}> — {documentiPerVoce[p.voce].length} doc. collegato{documentiPerVoce[p.voce].length>1?"i":""} 👁</span>}
                    </span>
                    {haDocumenti ? (
                      <span style={{ background:ss.bg, color:ss.color, border:"none", borderRadius:8, padding:"4px 14px", fontWeight:700, fontSize:"0.8rem", minWidth:44, textAlign:"center" }}>
                        ✓
                      </span>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); cycle(idx); }}
                        style={{ background:ss.bg, color:ss.color, border:"none", borderRadius:8, padding:"4px 14px", fontWeight:700, fontSize:"0.8rem", cursor:"pointer", minWidth:44 }}>
                        {s}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <p style={{ color:"#475569", fontSize:"0.78rem", marginTop:8 }}>Le voci con un documento collegato dal tab Documenti si spuntano automaticamente (clicca per i dettagli). Per le altre, clicca sul pulsante per ciclare: — → SI → NO → NP.</p>
      </div>

      {/* pannello dettaglio documenti collegati */}
      {docVoceSelezionata && (
        <div style={{ background:"#1e293b", border:"1px solid #1e3a5f", borderRadius:12, padding:18, maxHeight:560, overflowY:"auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
            <div>
              <div style={{ color:"#475569", fontSize:"0.72rem", marginBottom:2 }}>VOCE CHECKLIST</div>
              <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.95rem" }}>{voceSelezionata}</div>
            </div>
            <button onClick={() => setVoceSelezionata(null)} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:"1.1rem" }}>✕</button>
          </div>
          {erroreRimozione && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginBottom:10 }}>{erroreRimozione}</div>}
          {docVoceSelezionata.map((doc, i) => (
            <div key={i} style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:10, padding:14, marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ color:"#e2e8f0", fontWeight:600, fontSize:"0.88rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>📄 {doc.nome_file}</div>
              </div>
              <div style={{ color:"#475569", fontSize:"0.72rem", marginBottom:8 }}>Caricato il {new Date(doc.data_caricamento).toLocaleString("it-IT")}</div>
              {doc.riassunto && (
                <div style={{ marginBottom:8 }}>
                  <div style={{ color:"#94a3b8", fontSize:"0.72rem", fontWeight:700, marginBottom:2 }}>RIASSUNTO</div>
                  <div style={{ color:"#cbd5e1", fontSize:"0.82rem", lineHeight:1.5 }}>{doc.riassunto}</div>
                </div>
              )}
              {doc.dati_chiave && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ color:"#94a3b8", fontSize:"0.72rem", fontWeight:700, marginBottom:2 }}>DATI CHIAVE</div>
                  <div style={{ color:"#cbd5e1", fontSize:"0.82rem", lineHeight:1.5 }}>{doc.dati_chiave}</div>
                </div>
              )}
              <button
                onClick={() => rimuoviCollegamento(doc)}
                disabled={rimozioneInCorso === doc.id}
                style={{ background:"#450a0a22", color:"#fca5a5", border:"1px solid #ef444433", borderRadius:6, padding:"5px 12px", cursor: rimozioneInCorso===doc.id ? "not-allowed":"pointer", fontSize:"0.75rem", fontWeight:700, opacity: rimozioneInCorso===doc.id ? 0.6 : 1 }}>
                {rimozioneInCorso === doc.id ? "Rimozione…" : "✕ Rimuovi collegamento (documento sbagliato)"}
              </button>
            </div>
          ))}
          <p style={{ color:"#475569", fontSize:"0.72rem", marginTop:4 }}>Per consultare il file originale, vai nella cartella DOC INIZIALE/DOC FONDAMENTALI su Google Drive.</p>
        </div>
      )}
    </div>
  );
}

// Legge un file .xls/.xlsx di ipotesi di investimento HP INV e ne estrae i
// valori Standard ed Extra capitolato per ciascuna voce numerata, riconoscendo
// il numero in colonna B e verificando che l'etichetta in colonna C corrisponda
// davvero alla voce nota (gestisce file con numeri duplicati in sezioni diverse,
// es. "NORMALE GESTIONE" con valori a zero, e abbreviazioni come "IMP." per "IMPIANTI").
// Condivisa tra TabBudget (import manuale) e TabDocumenti (import automatico
// quando un file viene classificato come HP INVESTIMENTO).
const estraiValoriBudgetDaFile = async (file) => {
  const XLSX = await loadSheetJS();
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const normalizza = (v) => v == null ? "" : String(v).trim().toUpperCase().replace(/\s+/g, " ");

  const valori = {};
  const trovate = [];
  rows.forEach(riga => {
    const numeroCella = normalizza(riga[1]); // colonna B (indice 1)
    if (!numeroCella || trovate.includes(numeroCella)) return;
    const vocePerNumero = BUDGET_VOCI.find(v => normalizza(v.n) === numeroCella);
    if (!vocePerNumero) return;

    const etichettaFile = normalizza(riga[2]); // colonna C (indice 2)
    const etichettaApp = normalizza(vocePerNumero.voce);
    const pulisci = (s) => s.replace(/[.,'’]/g, "").replace(/\s+/g, " ").trim();
    const fileSenzaPunt = pulisci(etichettaFile);
    const appSenzaPunt = pulisci(etichettaApp);
    const primaParolaFile = fileSenzaPunt.split(" ")[0] || "";
    const primaParolaApp = appSenzaPunt.split(" ")[0] || "";
    const prefissoComune = (a, b) => a && b && (a.startsWith(b.slice(0,5)) || b.startsWith(a.slice(0,5)));
    const corrispondeEtichetta = etichettaFile && etichettaApp && (
      prefissoComune(primaParolaFile, primaParolaApp) ||
      fileSenzaPunt.includes(appSenzaPunt.split(" ")[0]) ||
      appSenzaPunt.includes(fileSenzaPunt.split(" ")[0])
    );
    if (!corrispondeEtichetta) return;

    const std = Number(riga[8]) || 0;   // colonna I (indice 8)
    const extra = Number(riga[11]) || 0; // colonna L (indice 11)
    valori[vocePerNumero.n] = { std, extra };
    trovate.push(vocePerNumero.n);
  });

  if (trovate.length === 0) throw new Error("Nessuna voce riconosciuta nel file. Verifica che sia nel formato standard HP INV.");

  const nonTrovate = BUDGET_VOCI.map(v=>v.n).filter(n => !trovate.includes(n));
  return { valori, trovate, nonTrovate };
};

const valoriVuoti = () => Object.fromEntries(BUDGET_VOCI.map(v=>v.n).map(n=>[n, { std:0, extra:0 }]));

function TabBudget({ commessaIdGlobale, onCambiaCommessa }) {
  const [commesse, setCommesse] = useState([]);
  const [commessaId, setCommessaId] = useState(commessaIdGlobale || "");
  const [caricamentoCommesse, setCaricamentoCommesse] = useState(true);
  const [filtroBrand, setFiltroBrand] = useState("TUTTI");
  const [caricamentoBudget, setCaricamentoBudget] = useState(false);
  const [erroreCaricamento, setErroreCaricamento] = useState("");
  const [ultimoAggiornamento, setUltimoAggiornamento] = useState(null); // { updated_at, nome_file_origine } | null
  const [salvataggioManuale, setSalvataggioManuale] = useState("idle"); // idle | saving | saved | error
  const [mostraConfermaSvuota, setMostraConfermaSvuota] = useState(false);
  const [svuotamentoStato, setSvuotamentoStato] = useState("idle"); // idle | svuotando | fatto | errore
  const [erroreSvuotamento, setErroreSvuotamento] = useState("");

  const [mqVendita, setMqVendita] = useState(0);
  const [valori, setValori] = useState(valoriVuoti);
  const [importStato, setImportStato] = useState("idle"); // idle | loading | done | error
  const [importErrore, setImportErrore] = useState("");
  const [importRiepilogo, setImportRiepilogo] = useState(null); // { trovate, nonTrovate }

  const setVal = (n, campo, v) => setValori(prev=>({ ...prev, [n]:{ ...prev[n], [campo]: Number(v)||0 } }));
  const commessaSelezionata = commesse.find(c => c.id === commessaId);
  const commesseFiltrate = filtroBrand === "TUTTI" ? commesse : commesse.filter(c => c.brand === filtroBrand);

  const cats = [...new Set(BUDGET_VOCI.map(v=>v.categoria))];

  const totale = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.std||0) + (valori[v.n]?.extra||0), 0);
  const totaleStd = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.std||0), 0);
  const totaleExtra = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.extra||0), 0);

  const inputStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:6, padding:"5px 8px", width:110, textAlign:"right", fontSize:"0.82rem", outline:"none" };

  // Carica l'elenco commesse, una sola volta
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("commesse").select("*").order("created_at", { ascending:false });
      if (!error && data) setCommesse(data);
      setCaricamentoCommesse(false);
    })();
  }, []);

  // Tiene sincronizzata la selezione con lo stato globale (es. se l'utente
  // seleziona la commessa dal tab Documenti o dalla Scheda Negozio).
  useEffect(() => {
    if (commessaIdGlobale !== undefined && commessaIdGlobale !== commessaId) {
      setCommessaId(commessaIdGlobale || "");
    }
  }, [commessaIdGlobale]);

  const selezionaCommessaLocale = (id) => {
    setCommessaId(id);
    onCambiaCommessa?.(id || null);
  };

  // Ogni volta che cambia la commessa selezionata, carica da Supabase
  // l'ultima versione salvata del budget (sovrascrive sempre lo stato locale,
  // così il tab mostra sempre l'ultima ipotesi di investimento caricata).
  useEffect(() => {
    if (!commessaId) {
      setMqVendita(0);
      setValori(valoriVuoti());
      setUltimoAggiornamento(null);
      setErroreCaricamento("");
      return;
    }
    (async () => {
      setCaricamentoBudget(true);
      setErroreCaricamento("");
      try {
        const { data, error } = await supabase.from("budget_hp_inv").select("*").eq("commessa_id", commessaId).maybeSingle();
        if (error) throw error;
        if (data) {
          setValori({ ...valoriVuoti(), ...(data.valori || {}) });
          setMqVendita(data.mq_vendita || 0);
          setUltimoAggiornamento({ updated_at: data.updated_at, nome_file_origine: data.nome_file_origine });
        } else {
          setValori(valoriVuoti());
          setMqVendita(0);
          setUltimoAggiornamento(null);
        }
      } catch (e) {
        setErroreCaricamento(e.message || "Errore durante il caricamento del budget.");
      } finally {
        setCaricamentoBudget(false);
      }
    })();
  }, [commessaId]);

  // Salva manualmente lo stato corrente su Supabase (es. dopo modifiche a
  // mano ai singoli importi, o per aggiornare i mq vendita), sovrascrivendo
  // sempre l'unica riga "ultima versione" per questa commessa.
  const salvaSuSupabase = async () => {
    if (!commessaId) return;
    setSalvataggioManuale("saving");
    try {
      const { error } = await supabase.from("budget_hp_inv").upsert({
        commessa_id: commessaId,
        mq_vendita: mqVendita || null,
        valori,
        nome_file_origine: ultimoAggiornamento?.nome_file_origine || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "commessa_id" });
      if (error) throw error;
      setUltimoAggiornamento(prev => ({ ...prev, updated_at: new Date().toISOString() }));
      setSalvataggioManuale("saved");
      setTimeout(() => setSalvataggioManuale("idle"), 2000);
    } catch (e) {
      setSalvataggioManuale("error");
    }
  };

  // Svuota completamente il Budget HP INV della commessa selezionata: azzera
  // tutti i valori a video e cancella la riga su Supabase, così non resta
  // traccia di un'ipotesi caricata per errore (es. file della commessa sbagliata).
  // Non tocca il file eventualmente già caricato su Drive: quello va rimosso
  // manualmente dall'utente nella cartella HP INVESTIMENTO della commessa.
  const svuotaBudget = async () => {
    if (!commessaId) return;
    setSvuotamentoStato("svuotando");
    try {
      const { error } = await supabase.from("budget_hp_inv").delete().eq("commessa_id", commessaId);
      if (error) throw error;
      setValori(valoriVuoti());
      setMqVendita(0);
      setUltimoAggiornamento(null);
      setImportRiepilogo(null);
      setImportStato("idle");
      setSvuotamentoStato("fatto");
      setMostraConfermaSvuota(false);
      setTimeout(() => setSvuotamentoStato("idle"), 2500);
    } catch (e) {
      setSvuotamentoStato("errore");
      setErroreSvuotamento(e.message || "Errore durante l'eliminazione.");
    }
  };

  const importaFile = async (file) => {
    if (!commessaId) {
      setImportErrore("Seleziona prima una commessa.");
      setImportStato("error");
      return;
    }
    setImportStato("loading");
    setImportErrore("");
    setImportRiepilogo(null);
    try {
      const { valori: nuoviValori, trovate, nonTrovate } = await estraiValoriBudgetDaFile(file);
      const valoriUniti = { ...valori, ...nuoviValori };
      setValori(valoriUniti);
      const { error } = await supabase.from("budget_hp_inv").upsert({
        commessa_id: commessaId,
        mq_vendita: mqVendita || null,
        valori: valoriUniti,
        nome_file_origine: file.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: "commessa_id" });
      if (error) throw error;
      setUltimoAggiornamento({ updated_at: new Date().toISOString(), nome_file_origine: file.name });
      setImportRiepilogo({ trovate: trovate.length, nonTrovate: nonTrovate.length });
      setImportStato("done");
    } catch (e) {
      setImportErrore(e.message || "Errore durante la lettura del file.");
      setImportStato("error");
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (file) importaFile(file);
    e.target.value = "";
  };

  return (
    <div>
      {/* selettore commessa */}
      <div style={{ marginBottom:20 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Brand</label>
        <select
          value={filtroBrand}
          onChange={e => setFiltroBrand(e.target.value)}
          style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem", cursor:"pointer", marginBottom:10 }}
        >
          <option value="TUTTI">Tutti i brand</option>
          {BRAND_LIST.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Commessa</label>
        <select
          value={commessaId}
          onChange={e => selezionaCommessaLocale(e.target.value)}
          style={{ background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem", cursor:"pointer" }}
        >
          <option value="">Seleziona una commessa…</option>
          {commesseFiltrate.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {caricamentoCommesse && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Caricamento elenco commesse…</div>}
        {!caricamentoCommesse && commesseFiltrate.length === 0 && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Nessuna commessa trovata per questo brand.</div>}
        {!commessaId && !caricamentoCommesse && <div style={{ color:"#64748b", fontSize:"0.78rem", marginTop:6 }}>Seleziona una commessa per vedere o modificare il suo Budget HP INV.</div>}
        {caricamentoBudget && <div style={{ color:"#7dd3fc", fontSize:"0.78rem", marginTop:6 }}>⏳ Caricamento ultima versione del budget…</div>}
        {erroreCaricamento && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:6 }}>{erroreCaricamento}</div>}
        {commessaId && !caricamentoBudget && ultimoAggiornamento && (
          <div style={{ color:"#86efac", fontSize:"0.75rem", marginTop:6 }}>
            ✓ Versione del {new Date(ultimoAggiornamento.updated_at).toLocaleString("it-IT")}{ultimoAggiornamento.nome_file_origine ? ` — da "${ultimoAggiornamento.nome_file_origine}"` : ""}
          </div>
        )}
        {commessaId && !caricamentoBudget && !ultimoAggiornamento && (
          <div style={{ color:"#64748b", fontSize:"0.75rem", marginTop:6 }}>Nessuna ipotesi di investimento ancora caricata per questa commessa.</div>
        )}

        {commessaId && !caricamentoBudget && (ultimoAggiornamento || totale > 0) && (
          <div style={{ marginTop:10 }}>
            {!mostraConfermaSvuota ? (
              <button onClick={() => setMostraConfermaSvuota(true)}
                style={{ background:"none", color:"#fca5a5", border:"1px solid #ef444433", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:"0.75rem", fontWeight:700 }}>
                🗑 Svuota Budget HP INV di questa commessa
              </button>
            ) : (
              <div style={{ background:"#450a0a22", border:"1px solid #ef444455", borderRadius:8, padding:"10px 14px" }}>
                <div style={{ color:"#fca5a5", fontSize:"0.82rem", marginBottom:8 }}>
                  Sicuro di voler azzerare tutti i valori del Budget HP INV per "{commessaSelezionata?.nome}"? L'operazione non si può annullare. Il file eventualmente già caricato su Drive non viene toccato: se è nella cartella sbagliata, rimuovilo a mano da Google Drive.
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={svuotaBudget} disabled={svuotamentoStato==="svuotando"}
                    style={{ background:"#7f1d1d", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", cursor:"pointer", fontSize:"0.78rem", fontWeight:700, opacity: svuotamentoStato==="svuotando"?0.6:1 }}>
                    {svuotamentoStato==="svuotando" ? "Svuotamento…" : "Sì, svuota tutto"}
                  </button>
                  <button onClick={() => setMostraConfermaSvuota(false)} disabled={svuotamentoStato==="svuotando"}
                    style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"6px 14px", cursor:"pointer", fontSize:"0.78rem" }}>
                    Annulla
                  </button>
                </div>
              </div>
            )}
            {svuotamentoStato==="fatto" && <div style={{ color:"#86efac", fontSize:"0.78rem", marginTop:6 }}>✓ Budget svuotato.</div>}
            {svuotamentoStato==="errore" && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:6 }}>{erroreSvuotamento}</div>}
          </div>
        )}
      </div>

      {commessaId && (
      <>
      {/* import da file */}
      <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:16, marginBottom:20 }}>
        <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.82rem", marginBottom:8 }}>📥 IMPORTA DA FILE IPOTESI DI INVESTIMENTO</div>
        <label style={{ display:"inline-block", background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:"0.82rem" }}>
          {importStato==="loading" ? "Lettura file…" : "Scegli file .xls/.xlsx"}
          <input type="file" accept=".xls,.xlsx" onChange={handleImportFile} style={{ display:"none" }} disabled={importStato==="loading"} />
        </label>
        {importStato==="done" && importRiepilogo && (
          <div style={{ color:"#86efac", fontSize:"0.8rem", marginTop:8 }}>
            ✓ Importate {importRiepilogo.trovate} voci su {BUDGET_VOCI.length}{importRiepilogo.nonTrovate>0 ? ` (${importRiepilogo.nonTrovate} non trovate nel file, lasciate invariate)` : ""}. Salvato automaticamente.
          </div>
        )}
        {importStato==="error" && <div style={{ color:"#fca5a5", fontSize:"0.8rem", marginTop:8 }}>{importErrore}</div>}
        {importStato==="idle" && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:6 }}>Legge automaticamente i valori Standard ed Extra capitolato per ciascuna voce dal file Excel dell'ipotesi di investimento. Puoi anche caricarlo direttamente dal tab Documenti: verrà collegato qui in automatico.</div>}
      </div>

      {/* header dati */}
      <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"12px 18px", flex:1, minWidth:160 }}>
          <div style={{ color:"#64748b", fontSize:"0.75rem", marginBottom:4 }}>MQ Vendita Lordi</div>
          <input type="number" value={mqVendita||""} onChange={e=>setMqVendita(Number(e.target.value)||0)}
            placeholder="0" style={{ ...inputStyle, width:"100%", fontSize:"1.1rem", fontWeight:700, color:"#7dd3fc" }} />
        </div>
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"12px 18px", flex:1, minWidth:160 }}>
          <div style={{ color:"#64748b", fontSize:"0.75rem", marginBottom:4 }}>Totale Standard</div>
          <div style={{ color:"#86efac", fontWeight:700, fontSize:"1.1rem" }}>{fmtEur(totaleStd)}</div>
        </div>
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"12px 18px", flex:1, minWidth:160 }}>
          <div style={{ color:"#64748b", fontSize:"0.75rem", marginBottom:4 }}>Totale Extra</div>
          <div style={{ color:"#fbbf24", fontWeight:700, fontSize:"1.1rem" }}>{fmtEur(totaleExtra)}</div>
        </div>
        <div style={{ background:"#1e3a5f", border:"1px solid #3b82f6", borderRadius:10, padding:"12px 18px", flex:1, minWidth:160 }}>
          <div style={{ color:"#7dd3fc", fontSize:"0.75rem", marginBottom:4 }}>TOTALE GENERALE</div>
          <div style={{ color:"#fff", fontWeight:700, fontSize:"1.2rem" }}>{fmtEur(totale)}</div>
          {mqVendita>0 && <div style={{ color:"#94a3b8", fontSize:"0.75rem" }}>{fmtEur(Math.round(totale/mqVendita))}/mq</div>}
        </div>
      </div>


      {/* tabella */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.82rem" }}>
          <thead>
            <tr style={{ color:"#64748b", fontSize:"0.75rem", letterSpacing:"0.06em" }}>
              <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #334155" }}>N.</th>
              <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #334155" }}>VOCE</th>
              <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #334155" }}>RESP.</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>STANDARD (€)</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>EXTRA (€)</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>TOTALE (€)</th>
              {mqVendita>0 && <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>€/mq</th>}
            </tr>
          </thead>
          <tbody>
            {cats.map(cat => {
              const voci = BUDGET_VOCI.filter(v=>v.categoria===cat);
              const subStd = voci.reduce((a,v)=>a+(valori[v.n]?.std||0),0);
              const subExtra = voci.reduce((a,v)=>a+(valori[v.n]?.extra||0),0);
              const subTot = subStd + subExtra;
              return [
                <tr key={"cat-"+cat}>
                  <td colSpan={mqVendita>0?7:6} style={{ padding:"10px 10px 4px", color:"#7dd3fc", fontWeight:700, fontSize:"0.78rem", letterSpacing:"0.06em", borderTop:"1px solid #1e3a5f" }}>{cat}</td>
                </tr>,
                ...voci.map(v=>{
                  const tot=(valori[v.n]?.std||0)+(valori[v.n]?.extra||0);
                  return (
                    <tr key={v.n} style={{ borderBottom:"1px solid #0f172a" }}>
                      <td style={{ padding:"6px 10px", color:"#475569" }}>{v.n}</td>
                      <td style={{ padding:"6px 10px", color:"#cbd5e1" }}>{v.voce}</td>
                      <td style={{ padding:"6px 10px", color:"#64748b" }}>{v.resp}</td>
                      <td style={{ padding:"4px 10px", textAlign:"right" }}>
                        <input type="number" value={valori[v.n]?.std||""} onChange={e=>setVal(v.n,"std",e.target.value)} placeholder="0" style={inputStyle} />
                      </td>
                      <td style={{ padding:"4px 10px", textAlign:"right" }}>
                        <input type="number" value={valori[v.n]?.extra||""} onChange={e=>setVal(v.n,"extra",e.target.value)} placeholder="0" style={inputStyle} />
                      </td>
                      <td style={{ padding:"6px 10px", textAlign:"right", color: tot>0?"#86efac":"#475569", fontWeight:tot>0?700:400 }}>
                        {tot>0?fmtEur(tot):"—"}
                      </td>
                      {mqVendita>0 && <td style={{ padding:"6px 10px", textAlign:"right", color:"#64748b" }}>
                        {tot>0?fmtEur(Math.round(tot/mqVendita)):"—"}
                      </td>}
                    </tr>
                  );
                }),
                <tr key={"sub-"+cat} style={{ background:"#0f172a" }}>
                  <td colSpan={3} style={{ padding:"6px 10px", color:"#475569", fontSize:"0.78rem" }}>subtotale {cat}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#86efac", fontWeight:700 }}>{fmtEur(subStd)||"—"}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#fbbf24", fontWeight:700 }}>{fmtEur(subExtra)||"—"}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#e2e8f0", fontWeight:700 }}>{fmtEur(subTot)||"—"}</td>
                  {mqVendita>0 && <td style={{ padding:"6px 10px", textAlign:"right", color:"#64748b" }}>{subTot>0?fmtEur(Math.round(subTot/mqVendita)):"—"}</td>}
                </tr>
              ];
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop:20, display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={salvaSuSupabase} disabled={salvataggioManuale==="saving"}
          style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", cursor:"pointer", fontWeight:700, fontSize:"0.84rem", opacity: salvataggioManuale==="saving"?0.6:1 }}>
          {salvataggioManuale==="saving" ? "Salvataggio…" : "💾 Salva modifiche"}
        </button>
        {salvataggioManuale==="saved" && <span style={{ color:"#86efac", fontSize:"0.82rem" }}>✓ Salvato</span>}
        {salvataggioManuale==="error" && <span style={{ color:"#fca5a5", fontSize:"0.82rem" }}>Errore durante il salvataggio</span>}
      </div>
      </>
      )}
    </div>
  );
}

const FORM_VUOTO = { id:null, nome:"", brand:"OVS", responsabile:"", tecnico:"", periodo:"", indirizzo:"", citta:"", mq:0, note:"", drive_folder_id:null };

function TabScheda({ commessaIdGlobale, onCambiaCommessa }) {
  const [commesse, setCommesse] = useState([]);
  const [caricamentoLista, setCaricamentoLista] = useState(true);
  const [form, setForm] = useState(FORM_VUOTO);
  const [salvataggio, setSalvataggio] = useState("idle"); // idle | saving | saved | error
  const [erroreSalvataggio, setErroreSalvataggio] = useState("");
  const [driveStato, setDriveStato] = useState("idle"); // idle | creating | done | error
  const [erroreDrive, setErroreDrive] = useState("");

  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inpStyle = { background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem" };

  const caricaCommesse = async () => {
    setCaricamentoLista(true);
    const { data, error } = await supabase.from("commesse").select("*").order("created_at", { ascending:false });
    if (!error && data) setCommesse(data);
    setCaricamentoLista(false);
  };

  useEffect(() => { caricaCommesse(); }, []);

  const selezionaCommessa = (id) => {
    if (!id) { setForm(FORM_VUOTO); onCambiaCommessa?.(null); return; }
    const c = commesse.find(x => x.id === id);
    if (c) setForm({ ...FORM_VUOTO, ...c });
    onCambiaCommessa?.(id || null);
  };

  // Se la commessa selezionata globalmente cambia da un altro tab (es. da
  // Documenti), aggiorna anche il form della Scheda Negozio di conseguenza.
  useEffect(() => {
    if (commessaIdGlobale && commessaIdGlobale !== form.id && commesse.length > 0) {
      const c = commesse.find(x => x.id === commessaIdGlobale);
      if (c) setForm({ ...FORM_VUOTO, ...c });
    }
    if (!commessaIdGlobale && form.id) {
      setForm(FORM_VUOTO);
    }
  }, [commessaIdGlobale, commesse]);

  const salva = async () => {
    if (!form.nome.trim()) { setErroreSalvataggio("Il nome del negozio è obbligatorio."); setSalvataggio("error"); return; }
    setSalvataggio("saving");
    setErroreSalvataggio("");

    const payload = {
      nome: form.nome, brand: form.brand, responsabile: form.responsabile, tecnico: form.tecnico,
      periodo: form.periodo, indirizzo: form.indirizzo, citta: form.citta, mq: form.mq || null, note: form.note,
      updated_at: new Date().toISOString(),
    };

    try {
      if (form.id) {
        const { error } = await supabase.from("commesse").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("commesse").insert(payload).select().single();
        if (error) throw error;
        setForm(f => ({ ...f, id: data.id }));
        onCambiaCommessa?.(data.id);
      }
      setSalvataggio("saved");
      await caricaCommesse();
      setTimeout(() => setSalvataggio("idle"), 2500);
    } catch (e) {
      setErroreSalvataggio(e.message || "Errore durante il salvataggio.");
      setSalvataggio("error");
    }
  };

  const creaCartellaDriveCommessa = async () => {
    if (!form.id) { setErroreDrive("Salva prima la scheda negozio."); setDriveStato("error"); return; }
    setDriveStato("creating");
    setErroreDrive("");
    try {
      const { rootId } = await creaStrutturaCommessaSuDrive(form.nome);
      const { error } = await supabase.from("commesse").update({ drive_folder_id: rootId }).eq("id", form.id);
      if (error) throw error;
      setForm(f => ({ ...f, drive_folder_id: rootId }));
      setDriveStato("done");
      await caricaCommesse();
    } catch (e) {
      setErroreDrive(e.message || "Errore durante la creazione su Drive.");
      setDriveStato("error");
    }
  };

  return (
    <div style={{ maxWidth:640 }}>
      {/* selettore commessa esistente */}
      <div style={{ marginBottom:20 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Commessa</label>
        <div style={{ display:"flex", gap:8 }}>
          <select
            value={form.id || ""}
            onChange={e => selezionaCommessa(e.target.value || null)}
            style={{ ...inpStyle, flex:1, cursor:"pointer" }}
          >
            <option value="">➕ Nuova commessa</option>
            {commesse.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        {caricamentoLista && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Caricamento elenco commesse…</div>}
      </div>

      <div style={{ color:"#64748b", fontSize:"0.82rem", marginBottom:18 }}>Compila la scheda del negozio. Salvando, la commessa resta disponibile anche negli altri tab e dopo aver chiuso l'app.</div>
      {[
        { label:"Nome negozio / ID commessa", key:"nome" },
        { label:"Brand", key:"brand", type:"select", opts:BRAND_LIST },
        { label:"Responsabile commessa", key:"responsabile" },
        { label:"Tecnico", key:"tecnico" },
      ].map(f=>(
        <div key={f.key} style={{ marginBottom:14 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>{f.label}</label>
          {f.type==="select"
            ? <select value={form[f.key]} onChange={e=>set(f.key,e.target.value)} style={{ ...inpStyle, cursor:"pointer" }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            : <input type={f.type||"text"} value={form[f.key]} onChange={e=>set(f.key,e.target.value)} style={inpStyle} />
          }
        </div>
      ))}

      {/* periodo cantiere: mese + anno, usato come soglia per distinguere
          documentazione storica da pratiche nuove del cantiere attuale */}
      <div style={{ marginBottom:14 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Periodo cantiere (mese di inizio)</label>
        <div style={{ display:"flex", gap:8 }}>
          <select
            value={form.periodo ? form.periodo.split("-")[1] : ""}
            onChange={e => {
              const anno = form.periodo ? form.periodo.split("-")[0] : String(new Date().getFullYear());
              set("periodo", e.target.value ? `${anno}-${e.target.value}` : "");
            }}
            style={{ ...inpStyle, cursor:"pointer", flex:2 }}
          >
            <option value="">Mese…</option>
            {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,idx) => (
              <option key={m} value={m}>{["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"][idx]}</option>
            ))}
          </select>
          <select
            value={form.periodo ? form.periodo.split("-")[0] : ""}
            onChange={e => {
              const mese = form.periodo ? form.periodo.split("-")[1] : "01";
              set("periodo", e.target.value ? `${e.target.value}-${mese}` : "");
            }}
            style={{ ...inpStyle, cursor:"pointer", flex:1 }}
          >
            <option value="">Anno…</option>
            {Array.from({length:8}, (_,i) => String(new Date().getFullYear() - 2 + i)).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ color:"#475569", fontSize:"0.72rem", marginTop:4 }}>Usato per distinguere automaticamente la documentazione storica da quella nuova quando carichi pratiche edilizie nel tab Documenti.</div>
      </div>

      {[
        { label:"Indirizzo", key:"indirizzo" },
        { label:"Città", key:"citta" },
        { label:"MQ vendita lordi", key:"mq", type:"number" },
      ].map(f=>(
        <div key={f.key} style={{ marginBottom:14 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>{f.label}</label>
          {f.type==="select"
            ? <select value={form[f.key]} onChange={e=>set(f.key,e.target.value)} style={{ ...inpStyle, cursor:"pointer" }}>
                {f.opts.map(o=><option key={o}>{o}</option>)}
              </select>
            : <input type={f.type||"text"} value={form[f.key]} onChange={e=>set(f.key,e.target.value)} style={inpStyle} />
          }
        </div>
      ))}
      <div style={{ marginBottom:18 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Note / Peculiarità</label>
        <textarea value={form.note} onChange={e=>set("note",e.target.value)} rows={3} style={{ ...inpStyle, resize:"vertical" }} />
      </div>

      {/* salva */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={salva} disabled={salvataggio==="saving"}
          style={{ background: salvataggio==="saved"?"#14532d":"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontWeight:700, fontSize:"0.88rem" }}>
          {salvataggio==="saving" ? "Salvataggio…" : salvataggio==="saved" ? "✓ Salvato" : form.id ? "Salva modifiche" : "Salva nuova commessa"}
        </button>
        {salvataggio==="error" && <span style={{ color:"#fca5a5", fontSize:"0.8rem" }}>{erroreSalvataggio}</span>}
      </div>

      {/* drive */}
      {form.id && (
        <div style={{ background:"#0f172a", border:"1px solid #1e3a5f", borderRadius:12, padding:18, marginBottom:20 }}>
          <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.92rem", marginBottom:8 }}>📁 Archivio Google Drive</div>
          {form.drive_folder_id ? (
            <div style={{ color:"#86efac", fontSize:"0.82rem" }}>
              ✓ Cartella creata su Drive con tutte le sottocartelle pronte.{" "}
              <a href={`https://drive.google.com/drive/folders/${form.drive_folder_id}`} target="_blank" rel="noreferrer" style={{ color:"#7dd3fc" }}>Apri su Drive →</a>
            </div>
          ) : (
            <>
              <div style={{ color:"#64748b", fontSize:"0.8rem", marginBottom:10 }}>Crea la cartella "{form.nome}" sul tuo Drive con le 18 sottocartelle dell'archivio già pronte.</div>
              <button onClick={creaCartellaDriveCommessa} disabled={driveStato==="creating"}
                style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:"0.82rem" }}>
                {driveStato==="creating" ? "Creazione cartelle in corso…" : "Crea cartella su Drive"}
              </button>
              {driveStato==="error" && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:8 }}>{erroreDrive}</div>}
            </>
          )}
        </div>
      )}

      {/* riepilogo */}
      {form.nome && (
        <div style={{ background:"#0f172a", border:"1px solid #1e3a5f", borderRadius:12, padding:18, marginTop:8 }}>
          <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"1rem", marginBottom:10 }}>📋 Scheda negozio</div>
          {[["Brand", form.brand],["Commessa",form.nome],["Responsabile",form.responsabile],["Tecnico",form.tecnico],["Periodo",formattaPeriodo(form.periodo)],["Indirizzo",`${form.indirizzo}${form.citta?" – "+form.citta:""}`],["MQ vendita",form.mq?form.mq+" mq":""]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} style={{ display:"flex", gap:8, marginBottom:5 }}>
              <span style={{ color:"#475569", width:120, fontSize:"0.82rem", flexShrink:0 }}>{k}</span>
              <span style={{ color:"#e2e8f0", fontSize:"0.82rem" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── GEMINI API KEY — salvata in modo permanente nel browser ────────────────────
const GEMINI_KEY_STORAGE = "ovs_gemini_api_key";
const getStoredApiKey = () => {
  try { return localStorage.getItem(GEMINI_KEY_STORAGE) || ""; } catch { return ""; }
};
const setStoredApiKey = (key) => {
  try { localStorage.setItem(GEMINI_KEY_STORAGE, key); } catch {}
};

// ── TAB ANALISI AI ────────────────────────────────────────────────────────────

const TIPI_ANALISI = [
  { id:"sopralluogo",  label:"📸 Foto sopralluogo",       prompt:"Sei un esperto tecnico edile. Analizza queste foto di un sopralluogo iniziale per un punto vendita retail. Fornisci un report strutturato con: 1) STATO DEI LOCALI (condizioni generali, criticità visibili), 2) INTERVENTI NECESSARI (elenca per categoria: strutturale, impiantistico, estetico), 3) PUNTI DI ATTENZIONE (eventuali problemi che richiedono approfondimento), 4) NOTE PER IL PROGETTISTA. Sii preciso e tecnico." },
  { id:"cantiere",     label:"🏗 Foto cantiere",           prompt:"Sei un direttore lavori esperto. Analizza queste foto di avanzamento cantiere per un punto vendita retail. Fornisci un report con: 1) STATO AVANZAMENTO LAVORI (cosa è completato, cosa è in corso), 2) CONFORMITÀ AL PROGETTO (eventuali difformità visibili), 3) CRITICITÀ RISCONTRATE (problemi, ritardi, non conformità), 4) AZIONI RICHIESTE (cosa deve essere fatto prima della prossima visita), 5) VALUTAZIONE GENERALE (percentuale stimata di completamento)." },
  { id:"documento",    label:"📄 Documento tecnico",       prompt:"Sei un tecnico esperto in edilizia commerciale. Analizza questo documento tecnico relativo a un punto vendita retail. Fornisci: 1) TIPOLOGIA DOCUMENTO (cosa è e a cosa serve), 2) CONTENUTO PRINCIPALE (riassunto dei punti chiave), 3) DATI IMPORTANTI (misure, costi, date, nomi rilevanti), 4) AZIONI RICHIESTE (cosa bisogna fare in seguito a questo documento), 5) DOCUMENTI CORRELATI (quali altri documenti potrebbero essere necessari)." },
  { id:"preventivo",   label:"💶 Preventivo fornitore",    prompt:"Sei un esperto di gestione commesse edili retail. Analizza questo preventivo. Fornisci: 1) RIEPILOGO ECONOMICO (importo totale, suddivisione per categoria), 2) VOCI PRINCIPALI (le 5 voci di costo più significative), 3) VALUTAZIONE (il preventivo sembra congruo per un punto vendita retail? Cosa sembra fuori mercato?), 4) PUNTI DA NEGOZIARE (voci su cui è possibile trattare), 5) ELEMENTI MANCANTI (cosa non è incluso e potrebbe generare extra costi)." },
  { id:"verbale",      label:"📝 Verbale riunione",        prompt:"Sei un project manager esperto. Analizza questo verbale di riunione di cantiere. Fornisci: 1) PRESENTI (chi era alla riunione), 2) DECISIONI PRESE (elenco delle decisioni formali), 3) AZIONI ASSEGNATE (chi deve fare cosa e entro quando), 4) PROBLEMI APERTI (questioni non risolte), 5) PROSSIMI STEP (cosa succede prima della prossima riunione)." },
];

function TabAnalisiAI() {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(() => !!getStoredApiKey());
  const [tipoAnalisi, setTipoAnalisi] = useState(TIPI_ANALISI[0].id);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [storico, setStorico] = useState([]);

  const tipo = TIPI_ANALISI.find(t => t.id === tipoAnalisi);

  const handleFiles = (e) => {
    const selected = Array.from(e.target.files).slice(0, 5);
    setFiles(selected);
    setReport(null);
    setError(null);
  };

  const toBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Errore lettura file"));
    r.readAsDataURL(file);
  });

  const getMimeType = (file) => {
    if (file.type) return file.type;
    const ext = file.name.split(".").pop().toLowerCase();
    const map = { pdf:"application/pdf", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp" };
    return map[ext] || "application/octet-stream";
  };

  const analizza = async () => {
    if (!apiKey) { setError("Inserisci la API Key Gemini prima di procedere."); return; }
    if (!files.length) { setError("Carica almeno un file da analizzare."); return; }
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const parts = [{ text: tipo.prompt }];

      for (const file of files) {
        const b64 = await toBase64(file);
        const mime = getMimeType(file);
        if (mime === "application/pdf") {
          parts.push({ inline_data: { mime_type: mime, data: b64 } });
        } else {
          parts.push({ inline_data: { mime_type: mime, data: b64 } });
        }
        parts.push({ text: `File: ${file.name}` });
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts }] }),
        }
      );

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const testo = data.candidates?.[0]?.content?.parts?.[0]?.text || "Nessuna risposta ricevuta.";
      const nuovoReport = {
        id: Date.now(),
        tipo: tipo.label,
        data: new Date().toLocaleString("it-IT"),
        files: files.map(f => f.name),
        testo,
      };
      setReport(nuovoReport);
      setStorico(s => [nuovoReport, ...s].slice(0, 10));
    } catch (e) {
      setError("Errore: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const inpStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.88rem" };

  return (
    <div>
      {/* API Key */}
      <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:16, marginBottom:20 }}>
        <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.82rem", marginBottom:8 }}>🔑 GEMINI API KEY</div>
        <div style={{ display:"flex", gap:8 }}>
          <input
            type={apiKeySaved ? "password" : "text"}
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setApiKeySaved(false); }}
            placeholder="Incolla qui la tua API Key (AIza...)"
            style={{ ...inpStyle, flex:1 }}
          />
          <button onClick={() => { setStoredApiKey(apiKey); setApiKeySaved(true); }}
            style={{ background: apiKeySaved?"#14532d":"#1d4ed8", color: apiKeySaved?"#86efac":"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:"0.82rem", whiteSpace:"nowrap" }}>
            {apiKeySaved ? "✓ Salvata" : "Salva"}
          </button>
        </div>
        {!apiKeySaved && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:6 }}>Ottieni la chiave gratuita su aistudio.google.com → Get API Key. Verrà salvata in questo browser e usata automaticamente in tutti i tab.</div>}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {/* pannello sinistra */}
        <div>
          {/* tipo analisi */}
          <div style={{ marginBottom:16 }}>
            <div style={{ color:"#94a3b8", fontSize:"0.78rem", marginBottom:8 }}>TIPO DI ANALISI</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {TIPI_ANALISI.map(t => (
                <button key={t.id} onClick={() => { setTipoAnalisi(t.id); setReport(null); }}
                  style={{ background: tipoAnalisi===t.id?"#1e3a5f":"#1e293b", color: tipoAnalisi===t.id?"#7dd3fc":"#94a3b8", border:`1px solid ${tipoAnalisi===t.id?"#3b82f6":"#334155"}`, borderRadius:8, padding:"10px 14px", cursor:"pointer", textAlign:"left", fontSize:"0.88rem", fontWeight: tipoAnalisi===t.id?700:400 }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* upload */}
          <div style={{ marginBottom:16 }}>
            <div style={{ color:"#94a3b8", fontSize:"0.78rem", marginBottom:8 }}>CARICA FILE (max 5 — foto, PDF)</div>
            <label style={{ display:"block", background:"#0f172a", border:"2px dashed #334155", borderRadius:10, padding:"24px 16px", textAlign:"center", cursor:"pointer" }}>
              <input type="file" multiple accept="image/*,.pdf" onChange={handleFiles} style={{ display:"none" }} />
              <div style={{ fontSize:"1.8rem", marginBottom:6 }}>📎</div>
              <div style={{ color:"#64748b", fontSize:"0.82rem" }}>Clicca per selezionare file</div>
              <div style={{ color:"#475569", fontSize:"0.75rem" }}>JPG, PNG, WEBP, PDF</div>
            </label>
            {files.length > 0 && (
              <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
                {files.map((f,i) => (
                  <div key={i} style={{ background:"#1e293b", borderRadius:6, padding:"6px 10px", fontSize:"0.78rem", color:"#94a3b8", display:"flex", alignItems:"center", gap:6 }}>
                    <span>{f.type?.startsWith("image")?"🖼":"📄"}</span>
                    <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                    <span style={{ color:"#475569" }}>{(f.size/1024).toFixed(0)} KB</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={analizza} disabled={loading}
            style={{ width:"100%", background: loading?"#1e293b":"linear-gradient(135deg,#3b82f6,#06b6d4)", color: loading?"#475569":"#fff", border:"none", borderRadius:10, padding:"14px", fontWeight:700, fontSize:"0.95rem", cursor: loading?"not-allowed":"pointer", transition:"all 0.2s" }}>
            {loading ? "⏳ Analisi in corso…" : `🤖 Analizza con Gemini`}
          </button>

          {error && <div style={{ background:"#450a0a", border:"1px solid #ef4444", borderRadius:8, padding:"10px 14px", marginTop:12, color:"#fca5a5", fontSize:"0.82rem" }}>{error}</div>}
        </div>

        {/* pannello destra — report */}
        <div>
          <div style={{ color:"#94a3b8", fontSize:"0.78rem", marginBottom:8 }}>REPORT GENERATO</div>
          {loading && (
            <div style={{ background:"#1e293b", borderRadius:12, padding:32, textAlign:"center" }}>
              <div style={{ fontSize:"2rem", marginBottom:8 }}>🤖</div>
              <div style={{ color:"#7dd3fc", fontSize:"0.88rem" }}>Gemini sta analizzando i file…</div>
              <div style={{ color:"#475569", fontSize:"0.78rem", marginTop:4 }}>Può richiedere 10–30 secondi</div>
            </div>
          )}
          {!loading && !report && (
            <div style={{ background:"#1e293b", borderRadius:12, padding:32, textAlign:"center", color:"#475569", fontSize:"0.85rem" }}>
              Il report apparirà qui dopo l'analisi
            </div>
          )}
          {report && (
            <div style={{ background:"#1e293b", border:"1px solid #1e3a5f", borderRadius:12, padding:18, maxHeight:520, overflowY:"auto" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                <div>
                  <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.88rem" }}>{report.tipo}</div>
                  <div style={{ color:"#475569", fontSize:"0.75rem" }}>{report.data}</div>
                </div>
                <button onClick={() => navigator.clipboard.writeText(report.testo)}
                  style={{ background:"#0f172a", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.75rem" }}>
                  📋 Copia
                </button>
              </div>
              <div style={{ color:"#cbd5e1", fontSize:"0.85rem", lineHeight:1.7, whiteSpace:"pre-wrap" }}>
                {report.testo}
              </div>
            </div>
          )}

          {/* storico */}
          {storico.length > 1 && (
            <div style={{ marginTop:16 }}>
              <div style={{ color:"#94a3b8", fontSize:"0.78rem", marginBottom:8 }}>ANALISI PRECEDENTI</div>
              {storico.slice(1).map(r => (
                <div key={r.id} onClick={() => setReport(r)}
                  style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", marginBottom:5, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ color:"#94a3b8", fontSize:"0.82rem" }}>{r.tipo}</div>
                    <div style={{ color:"#475569", fontSize:"0.72rem" }}>{r.data} — {r.files.join(", ")}</div>
                  </div>
                  <span style={{ color:"#3b82f6", fontSize:"0.75rem" }}>Vedi →</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TAB EDITOR PDF ────────────────────────────────────────────────────────────

const STRUMENTI = [
  { id:"select",     label:"↖ Seleziona",  color:"#94a3b8" },
  { id:"highlight",  label:"🖊 Evidenzia",  color:"#fbbf24" },
  { id:"text",       label:"T Testo",       color:"#60a5fa" },
  { id:"draw",       label:"✏️ Disegna",    color:"#f87171" },
  { id:"rect",       label:"□ Rettangolo", color:"#34d399" },
  { id:"arrow",      label:"→ Freccia",    color:"#a78bfa" },
  { id:"stamp",      label:"📅 Timbro",    color:"#fb923c" },
  { id:"sign",       label:"✍️ Firma",     color:"#e879f9" },
];

const COLORI = ["#fbbf24","#f87171","#60a5fa","#34d399","#a78bfa","#000000","#ffffff"];

function TabEditorPDF() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfPages, setPdfPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [strumento, setStrumento] = useState("highlight");
  const [colore, setColore] = useState("#fbbf24");
  const [spessore, setSpessore] = useState(3);
  const [annotazioni, setAnnotazioni] = useState([]);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState(null);
  const [currentPath, setCurrentPath] = useState([]);
  const [testo, setTesto] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [textPos, setTextPos] = useState(null);
  const [nomeFile, setNomeFile] = useState("");
  const canvasRef = React.useRef(null);
  const overlayRef = React.useRef(null);

  const loadPDF = async (file) => {
    setLoading(true);
    setNomeFile(file.name);
    setPdfPages([]);
    setAnnotazioni([]);
    setCurrentPage(0);
    try {
      const pdfjsLib = window.pdfjsLib;
      if (!pdfjsLib) { alert("Libreria PDF non caricata. Ricarica la pagina."); setLoading(false); return; }
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push({ dataUrl: canvas.toDataURL(), width: viewport.width, height: viewport.height });
      }
      setPdfPages(pages);
    } catch(e) { alert("Errore caricamento PDF: " + e.message); }
    setLoading(false);
  };

  const getPos = (e) => {
    const canvas = overlayRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const onMouseDown = (e) => {
    if (!pdfPages.length) return;
    const pos = getPos(e);
    if (strumento === "text" || strumento === "stamp") {
      setTextPos(pos);
      setShowTextInput(true);
      if (strumento === "stamp") {
        const now = new Date().toLocaleDateString("it-IT");
        aggiungiAnnotazione({ tipo:"stamp", x:pos.x, y:pos.y, testo:`📅 ${now}`, colore, page:currentPage });
      }
      return;
    }
    if (strumento === "sign") {
      setTextPos(pos);
      setShowTextInput(true);
      return;
    }
    setDrawing(true);
    setStartPos(pos);
    if (strumento === "draw" || strumento === "highlight") setCurrentPath([pos]);
  };

  const onMouseMove = (e) => {
    if (!drawing) return;
    const pos = getPos(e);
    if (strumento === "draw" || strumento === "highlight") setCurrentPath(p => [...p, pos]);
  };

  const onMouseUp = (e) => {
    if (!drawing) return;
    const pos = getPos(e);
    setDrawing(false);
    if (strumento === "draw") aggiungiAnnotazione({ tipo:"draw", path:currentPath, colore, spessore, page:currentPage });
    if (strumento === "highlight") aggiungiAnnotazione({ tipo:"highlight", path:currentPath, colore, page:currentPage });
    if (strumento === "rect") aggiungiAnnotazione({ tipo:"rect", x:startPos.x, y:startPos.y, x2:pos.x, y2:pos.y, colore, spessore, page:currentPage });
    if (strumento === "arrow") aggiungiAnnotazione({ tipo:"arrow", x:startPos.x, y:startPos.y, x2:pos.x, y2:pos.y, colore, spessore, page:currentPage });
    setCurrentPath([]);
    setStartPos(null);
  };

  const aggiungiAnnotazione = (ann) => setAnnotazioni(a => [...a, { ...ann, id: Date.now() }]);

  const aggiungiTesto = () => {
    if (!testo.trim()) { setShowTextInput(false); return; }
    if (strumento === "sign") {
      aggiungiAnnotazione({ tipo:"sign", x:textPos.x, y:textPos.y, testo, colore:"#1d4ed8", page:currentPage });
    } else {
      aggiungiAnnotazione({ tipo:"text", x:textPos.x, y:textPos.y, testo, colore, page:currentPage });
    }
    setTesto("");
    setShowTextInput(false);
  };

  const undoAnnotazione = () => {
    setAnnotazioni(a => a.filter((_, i) => i !== a.length - 1));
  };

  React.useEffect(() => {
    if (!pdfPages.length || !overlayRef.current) return;
    const canvas = overlayRef.current;
    const ctx = canvas.getContext("2d");
    const pg = pdfPages[currentPage];
    canvas.width = pg.width;
    canvas.height = pg.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    annotazioni.filter(a => a.page === currentPage).forEach(ann => {
      ctx.save();
      if (ann.tipo === "highlight" && ann.path?.length > 1) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = ann.colore;
        ctx.lineWidth = 18;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ann.path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      } else if (ann.tipo === "draw" && ann.path?.length > 1) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ann.colore;
        ctx.lineWidth = ann.spessore;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ann.path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      } else if (ann.tipo === "rect") {
        ctx.strokeStyle = ann.colore;
        ctx.lineWidth = ann.spessore;
        ctx.strokeRect(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
      } else if (ann.tipo === "arrow") {
        ctx.strokeStyle = ann.colore;
        ctx.lineWidth = ann.spessore;
        ctx.beginPath();
        ctx.moveTo(ann.x, ann.y);
        ctx.lineTo(ann.x2, ann.y2);
        ctx.stroke();
        const angle = Math.atan2(ann.y2 - ann.y, ann.x2 - ann.x);
        const al = 18;
        ctx.beginPath();
        ctx.moveTo(ann.x2, ann.y2);
        ctx.lineTo(ann.x2 - al * Math.cos(angle - 0.4), ann.y2 - al * Math.sin(angle - 0.4));
        ctx.lineTo(ann.x2 - al * Math.cos(angle + 0.4), ann.y2 - al * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = ann.colore;
        ctx.fill();
      } else if (ann.tipo === "text") {
        ctx.fillStyle = ann.colore;
        ctx.font = "bold 18px Arial";
        ctx.fillText(ann.testo, ann.x, ann.y);
      } else if (ann.tipo === "stamp") {
        ctx.fillStyle = "#1d4ed8";
        ctx.font = "bold 16px Arial";
        ctx.fillText(ann.testo, ann.x, ann.y);
        ctx.strokeStyle = "#1d4ed8";
        ctx.lineWidth = 2;
        ctx.strokeRect(ann.x - 4, ann.y - 20, ctx.measureText(ann.testo).width + 8, 26);
      } else if (ann.tipo === "sign") {
        ctx.fillStyle = "#1d4ed8";
        ctx.font = "italic bold 22px Arial";
        ctx.fillText(ann.testo, ann.x, ann.y);
        ctx.strokeStyle = "#1d4ed8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ann.x, ann.y + 4);
        ctx.lineTo(ann.x + ctx.measureText(ann.testo).width, ann.y + 4);
        ctx.stroke();
      }
      ctx.restore();
    });

    // preview disegno in corso
    if (drawing && currentPath.length > 1) {
      ctx.save();
      ctx.globalAlpha = strumento === "highlight" ? 0.35 : 1;
      ctx.strokeStyle = colore;
      ctx.lineWidth = strumento === "highlight" ? 18 : spessore;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      currentPath.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.restore();
    }
  }, [annotazioni, currentPage, pdfPages, drawing, currentPath]);

  const scaricaPDF = () => {
    if (!pdfPages.length) return;
    const pg = pdfPages[currentPage];
    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = pg.width;
    finalCanvas.height = pg.height;
    const ctx = finalCanvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      if (overlayRef.current) ctx.drawImage(overlayRef.current, 0, 0);
      const link = document.createElement("a");
      link.download = nomeFile.replace(".pdf", "_annotato.png");
      link.href = finalCanvas.toDataURL("image/png");
      link.click();
    };
    img.src = pg.dataUrl;
  };

  const btnStyle = (id) => ({
    background: strumento === id ? "#1e3a5f" : "#1e293b",
    color: strumento === id ? "#7dd3fc" : "#94a3b8",
    border: `1px solid ${strumento === id ? "#3b82f6" : "#334155"}`,
    borderRadius: 7, padding: "6px 10px", cursor: "pointer",
    fontSize: "0.78rem", fontWeight: strumento === id ? 700 : 400,
    whiteSpace: "nowrap",
  });

  return (
    <div>
      {/* upload */}
      {!pdfPages.length && !loading && (
        <label style={{ display:"block", background:"#1e293b", border:"2px dashed #334155", borderRadius:14, padding:"48px 24px", textAlign:"center", cursor:"pointer", maxWidth:500, margin:"40px auto" }}>
          <input type="file" accept=".pdf" onChange={e => e.target.files[0] && loadPDF(e.target.files[0])} style={{ display:"none" }} />
          <div style={{ fontSize:"3rem", marginBottom:12 }}>📄</div>
          <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"1.1rem", marginBottom:6 }}>Carica un PDF</div>
          <div style={{ color:"#64748b", fontSize:"0.88rem" }}>Clicca o trascina un file PDF per iniziare ad annotarlo</div>
        </label>
      )}

      {loading && (
        <div style={{ textAlign:"center", padding:60, color:"#7dd3fc" }}>
          <div style={{ fontSize:"2rem", marginBottom:8 }}>⏳</div>
          <div>Caricamento PDF in corso…</div>
        </div>
      )}

      {pdfPages.length > 0 && (
        <div>
          {/* toolbar */}
          <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:"10px 14px", marginBottom:14, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            {/* strumenti */}
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {STRUMENTI.map(s => (
                <button key={s.id} onClick={() => setStrumento(s.id)} style={btnStyle(s.id)}>{s.label}</button>
              ))}
            </div>

            <div style={{ width:1, height:28, background:"#334155", margin:"0 4px" }} />

            {/* colori */}
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              {COLORI.map(c => (
                <div key={c} onClick={() => setColore(c)}
                  style={{ width:22, height:22, borderRadius:"50%", background:c, cursor:"pointer", border:`2px solid ${colore===c?"#7dd3fc":"#334155"}`, boxShadow:colore===c?"0 0 0 2px #3b82f6":undefined }} />
              ))}
            </div>

            <div style={{ width:1, height:28, background:"#334155", margin:"0 4px" }} />

            {/* spessore */}
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ color:"#64748b", fontSize:"0.75rem" }}>Spessore</span>
              <input type="range" min={1} max={12} value={spessore} onChange={e => setSpessore(Number(e.target.value))}
                style={{ width:70 }} />
              <span style={{ color:"#94a3b8", fontSize:"0.75rem", minWidth:14 }}>{spessore}</span>
            </div>

            <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
              <button onClick={undoAnnotazione}
                style={{ background:"#0f172a", color:"#f87171", border:"1px solid #334155", borderRadius:7, padding:"6px 12px", cursor:"pointer", fontSize:"0.78rem" }}>
                ↩ Annulla
              </button>
              <button onClick={scaricaPDF}
                style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:7, padding:"6px 14px", cursor:"pointer", fontSize:"0.78rem", fontWeight:700 }}>
                💾 Scarica
              </button>
              <button onClick={() => { setPdfPages([]); setAnnotazioni([]); setNomeFile(""); }}
                style={{ background:"#0f172a", color:"#94a3b8", border:"1px solid #334155", borderRadius:7, padding:"6px 10px", cursor:"pointer", fontSize:"0.78rem" }}>
                ✕ Chiudi
              </button>
            </div>
          </div>

          {/* info file + paginazione */}
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <span style={{ color:"#64748b", fontSize:"0.82rem" }}>📄 {nomeFile}</span>
            <span style={{ color:"#475569", fontSize:"0.78rem" }}>{annotazioni.filter(a=>a.page===currentPage).length} annotazioni su questa pagina</span>
            {pdfPages.length > 1 && (
              <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
                <button onClick={() => setCurrentPage(p => Math.max(0, p-1))} disabled={currentPage===0}
                  style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>‹</button>
                <span style={{ color:"#e2e8f0", fontSize:"0.85rem" }}>Pag. {currentPage+1} / {pdfPages.length}</span>
                <button onClick={() => setCurrentPage(p => Math.min(pdfPages.length-1, p+1))} disabled={currentPage===pdfPages.length-1}
                  style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>›</button>
              </div>
            )}
          </div>

          {/* canvas viewer */}
          <div style={{ position:"relative", display:"inline-block", width:"100%", border:"1px solid #334155", borderRadius:10, overflow:"hidden", background:"#0f172a" }}>
            <img src={pdfPages[currentPage].dataUrl} style={{ width:"100%", display:"block", userSelect:"none" }} alt="PDF page" />
            <canvas ref={overlayRef}
              style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", cursor: strumento==="text"||strumento==="stamp"||strumento==="sign"?"crosshair":strumento==="select"?"default":"crosshair" }}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
            />
            {/* input testo flottante */}
            {showTextInput && textPos && (
              <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:"#1e293b", border:"1px solid #3b82f6", borderRadius:10, padding:16, zIndex:10, minWidth:260 }}>
                <div style={{ color:"#7dd3fc", fontSize:"0.85rem", marginBottom:8 }}>
                  {strumento==="sign" ? "✍️ Inserisci firma" : strumento==="stamp" ? null : "T Inserisci testo"}
                </div>
                {strumento !== "stamp" && (
                  <>
                    <input autoFocus value={testo} onChange={e=>setTesto(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&aggiungiTesto()}
                      placeholder={strumento==="sign"?"Il tuo nome / firma":"Testo da inserire…"}
                      style={{ background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:6, padding:"7px 10px", width:"100%", outline:"none", fontSize:"0.9rem", marginBottom:8 }} />
                    <div style={{ display:"flex", gap:8 }}>
                      <button onClick={aggiungiTesto}
                        style={{ flex:1, background:"#1d4ed8", color:"#fff", border:"none", borderRadius:6, padding:"7px", cursor:"pointer", fontWeight:700 }}>
                        Aggiungi
                      </button>
                      <button onClick={()=>{setShowTextInput(false);setTesto("");}}
                        style={{ background:"#0f172a", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"7px 12px", cursor:"pointer" }}>
                        Annulla
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <p style={{ color:"#475569", fontSize:"0.75rem", marginTop:8 }}>
            💡 Strumento attivo: <strong style={{color:"#7dd3fc"}}>{STRUMENTI.find(s=>s.id===strumento)?.label}</strong> — Il download salva la pagina corrente con tutte le annotazioni
          </p>
        </div>
      )}
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────

// ── TAB DOCUMENTI — ARCHIVIO INTELLIGENTE ───────────────────────────────────────

// Struttura archivio: ogni voce è un percorso completo di cartella + descrizione
// usata dall'AI per decidere dove va classificato un documento.
const STRUTTURA_ARCHIVIO = [
  { path:"DOC INIZIALE/DOC FONDAMENTALI",                 desc:"Documenti della checklist Pratiche Amministrative già previsti dall'app (CPI, DIA VVF, agibilità, catastali, contratti energia, ecc.). Include anche pratiche edilizie STORICHE: se il documento è una pratica edilizia (CILA, SCIA, permesso di costruire, agibilità, certificati, ecc.) la cui data è ANTERIORE al periodo cantiere indicato, va qui come documentazione pregressa dell'immobile, non in PRATICHE EDILIZIE." },
  { path:"DOC INIZIALE/DOC ACCESSORI",                    desc:"Documenti non in checklist, ricevuti da corrispondenze varie, non fondamentali ma utili" },
  { path:"DOC INIZIALE/IMMOBILIARE/CORRISPONDENZA IMMOBILIARE", desc:"Mail e comunicazioni con l'ufficio immobiliare" },
  { path:"DOC INIZIALE/IMMOBILIARE/CONTRATTO",            desc:"Bozze di contratto e contratto di locazione definitivo" },
  { path:"PROGETTO SD",                                   desc:"Documenti, planimetrie o layout ricevuti da Store Design" },
  { path:"PROGETTI IMPIANTI/MECCANICO",                   desc:"SOLO elaborati tecnici di progetto dell'impianto meccanico/climatizzazione, come tavole, relazioni tecniche o schemi. NON includere computi metrici, preventivi o documenti con importi economici: quelli vanno sempre in COMPUTI anche se riguardano l'impianto meccanico." },
  { path:"PROGETTI IMPIANTI/ELETTRICO",                   desc:"SOLO elaborati tecnici di progetto dell'impianto elettrico, come tavole, relazioni tecniche o schemi. NON includere computi metrici, preventivi o documenti con importi economici: quelli vanno sempre in COMPUTI anche se riguardano l'impianto elettrico." },
  { path:"PROGETTI IMPIANTI/VVF",                         desc:"SOLO elaborati tecnici di progetto antincendio (sprinkler, rilevazione fumi, idranti). NON includere computi metrici o preventivi con importi: quelli vanno in COMPUTI." },
  { path:"PROGETTI ST",                                   desc:"Eventuali progetti elaborati direttamente dai Servizi Tecnici (solo elaborati di progetto, non economici)" },
  { path:"COMPUTI",                                       desc:"Computi metrici estimativi (CME) e preventivi di fornitore con importi economici legati a lavori o impianti — meccanico, elettrico, VVF, edile o altro. Riconoscibile da: presenza di voci di costo, importi in euro, totali, elenco prezzi, riferiti a UN singolo fornitore/impianto/lavorazione specifica. Questo vale anche se il file riguarda uno specifico impianto: un computo dell'impianto meccanico va qui, non in PROGETTI IMPIANTI. NON includere qui le ipotesi di investimento complessive (HP INV): quelle vanno in HP INVESTIMENTO." },
  { path:"HP INVESTIMENTO",                               desc:"Ipotesi di investimento complessiva del punto vendita (spesso nominata 'HP INV' nel file o nel nome del documento, con foglio Excel intitolato 'HP INV'). Riconoscibile da: elenco di voci numerate (es. 1, 2, 3, 5a, 13a...) che coprono l'intero progetto (arredo, impianti, opere edili, consulenze, ecc.) con colonne separate 'Standard' ed 'Extra capitolato' e un totale per voce — è un riepilogo budget complessivo dell'intera commessa, non il preventivo di un singolo fornitore. Diverso da COMPUTI, che riguarda un singolo computo/preventivo di una specifica lavorazione." },
  { path:"CRONOPROGRAMMA",                                desc:"Cronoprogramma di cantiere: diagramma di Gantt o tabella con le fasi/attività di lavoro pianificate nel tempo, con date di inizio e fine per ciascuna fase. Riconoscibile da: elenco di lavorazioni/fasi con barre temporali o colonne data inizio/data fine, organizzato per settimane o giorni di cantiere." },
  { path:"CONTABILITA'",                                  desc:"Consuntivi economici, fatture, Stati Avanzamento Lavori (SAL) già fatturati o liquidati, divisi per fornitore — diverso da COMPUTI che riguarda preventivi/computi non ancora a consuntivo" },
  { path:"PRATICHE EDILIZIE/INIZIO LAVORI",               desc:"Pratiche edilizie di inizio cantiere predisposte dal Direttore Lavori per QUESTO cantiere (PSC, notifica preliminare, CILA/SCIA): la data del documento deve essere SUCCESSIVA o pari al periodo cantiere indicato. Se la data è anteriore al periodo cantiere, è documentazione storica e va in DOC INIZIALE/DOC FONDAMENTALI, non qui." },
  { path:"PRATICHE EDILIZIE/FINE LAVORI",                 desc:"Pratiche edilizie di fine cantiere predisposte dal DL per QUESTO cantiere (fine lavori, collaudi, dichiarazioni): la data del documento deve essere successiva al periodo cantiere indicato." },
  { path:"PRATICHE INSEGNE",                              desc:"Pratiche e autorizzazioni per insegne e pubblicità esterna, ricevute dal DL" },
  { path:"SOPRALLUOGHI/REPORT",                           desc:"Report generati dall'AI partendo da foto e registrazioni di riunioni di cantiere" },
  { path:"FOTO/FOTO INIZIALI",                            desc:"Foto del sopralluogo iniziale, locali allo stato di fatto" },
  { path:"FOTO/FOTO CANTIERE",                            desc:"Foto di avanzamento durante i lavori di cantiere" },
  { path:"FOTO/FOTO APERTURA",                             desc:"Foto del negozio finito, pronto per l'apertura" },
];

const ARCHIVIO_STATUS_STYLE = {
  pending:   { bg:"#1e293b", color:"#94a3b8", label:"In coda" },
  analyzing: { bg:"#1e3a5f", color:"#7dd3fc", label:"Analisi in corso…" },
  done:      { bg:"#14532d", color:"#86efac", label:"Classificato" },
  error:     { bg:"#450a0a", color:"#fca5a5", label:"Errore" },
};

function TabDocumenti({ commessaIdGlobale, onCambiaCommessa }) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(() => !!getStoredApiKey());
  const [items, setItems] = useState([]); // { id, file, status, cartella, motivazione, riassunto, datiChiave, azioni, errore, driveStato, mappaCartelle }
  const [selectedId, setSelectedId] = useState(null);
  const [commesse, setCommesse] = useState([]);
  const [commessaId, setCommessaId] = useState(commessaIdGlobale || "");
  const [caricamentoCommesse, setCaricamentoCommesse] = useState(true);
  const [filtroBrand, setFiltroBrand] = useState("TUTTI");

  const inpStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.88rem" };

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("commesse").select("*").order("created_at", { ascending:false });
      if (!error && data) setCommesse(data);
      setCaricamentoCommesse(false);
    })();
  }, []);

  // Mantiene sincronizzata la selezione con lo stato globale, in entrambe le
  // direzioni: se l'utente cambia commessa qui, lo segnala in alto; se la
  // commessa globale cambia da un altro tab, si aggiorna anche qui.
  useEffect(() => {
    if (commessaIdGlobale !== undefined && commessaIdGlobale !== commessaId) {
      setCommessaId(commessaIdGlobale || "");
    }
  }, [commessaIdGlobale]);

  const selezionaCommessaLocale = (id) => {
    setCommessaId(id);
    onCambiaCommessa?.(id || null);
  };

  const commessaSelezionata = commesse.find(c => c.id === commessaId);
  const commesseFiltrate = filtroBrand === "TUTTI" ? commesse : commesse.filter(c => c.brand === filtroBrand);

  const toBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Errore lettura file"));
    r.readAsDataURL(file);
  });

  const getMimeType = (file) => {
    if (file.type) return file.type;
    const ext = file.name.split(".").pop().toLowerCase();
    const map = { pdf:"application/pdf", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp", dwg:"application/octet-stream" };
    return map[ext] || "application/octet-stream";
  };

  const isSpreadsheet = (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    return ["xls", "xlsx", "csv"].includes(ext);
  };

  // Gemini non accetta file Excel/CSV come allegato binario: li leggiamo
  // noi nel browser con SheetJS (loadSheetJS, definita a livello di modulo)
  // e ne mandiamo il contenuto come testo.
  const estraiTestoSpreadsheet = async (file) => {
    const XLSX = await loadSheetJS();
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    let testo = "";
    wb.SheetNames.forEach(nome => {
      const sheet = wb.Sheets[nome];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      testo += `--- FOGLIO: ${nome} ---\n${csv}\n\n`;
    });
    // Limite di sicurezza per non sovraccaricare la richiesta su file molto grandi
    return testo.slice(0, 30000);
  };

  const handleFiles = (e) => {
    const selected = Array.from(e.target.files).slice(0, 10);
    const nuovi = selected.map(file => ({
      id: Date.now() + Math.random(),
      file,
      status: "pending",
      cartella: null,
      motivazione: "",
      riassunto: "",
      datiChiave: "",
      azioni: "",
      errore: "",
    }));
    setItems(prev => [...nuovi, ...prev]);
    nuovi.forEach(item => classifica(item));
  };

  // Quando un'ipotesi di investimento (HP INV) viene classificata, estrae i
  // valori dal file con la stessa logica del tab Budget e li salva su Supabase,
  // sovrascrivendo sempre la versione precedente per quella commessa (upsert
  // su commessa_id, grazie al vincolo unique della tabella budget_hp_inv).
  // Così il tab Budget HP INV mostra sempre l'ultima ipotesi caricata.
  const salvaBudgetSuSupabase = async (item) => {
    if (!commessaSelezionata) return;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, budgetStato: "estrazione" } : i));
    try {
      const { valori, trovate, nonTrovate } = await estraiValoriBudgetDaFile(item.file);
      const { error } = await supabase.from("budget_hp_inv").upsert({
        commessa_id: commessaSelezionata.id,
        valori,
        nome_file_origine: item.file.name,
        updated_at: new Date().toISOString(),
      }, { onConflict: "commessa_id" });
      if (error) throw error;
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, budgetStato: "salvato", budgetRiepilogo: { trovate: trovate.length, nonTrovate: nonTrovate.length } } : i));
    } catch (e) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, budgetStato: "errore", budgetErrore: e.message } : i));
    }
  };

  const classifica = async (item) => {
    if (!apiKey) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status:"error", errore:"Inserisci prima la API Key Gemini." } : i));
      return;
    }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status:"analyzing" } : i));

    try {
      const elencoCartelle = STRUTTURA_ARCHIVIO.map((c, idx) => `${idx + 1}. "${c.path}" — ${c.desc}`).join("\n");
      const periodoLeggibile = commessaSelezionata?.periodo ? formattaPeriodo(commessaSelezionata.periodo) : null;
      const contestoPeriodo = periodoLeggibile
        ? `\n\nIl periodo cantiere di questa commessa inizia in: ${periodoLeggibile}. Usa questa informazione SOLO per le pratiche edilizie: se trovi una data nel documento (es. data del protocollo, data del titolo abilitativo) ANTERIORE a questo periodo, è documentazione storica/pregressa e va in DOC INIZIALE/DOC FONDAMENTALI; se la data è pari o successiva, è una pratica nuova relativa a questo cantiere e va in PRATICHE EDILIZIE/INIZIO LAVORI o FINE LAVORI secondo il contenuto.`
        : `\n\nNota: non è stato indicato un periodo cantiere per questa commessa, quindi per le pratiche edilizie usa il buon senso guardando il contesto generale del documento (se sembra riferirsi a una fase storica/pregressa o a lavori in corso).`;
      const elencoPratiche = PRATICHE.map(p => `"${p.voce}"`).join(", ");
      const promptText = `Sei un archivista esperto di pratiche edilizie e gestione commesse retail. Apri e analizza il documento allegato (file: "${item.file.name}"). Determina autonomamente di che tipo di documento si tratta guardando il contenuto, non solo il nome del file.

Devi scegliere UNA SOLA cartella di destinazione tra questo elenco esatto (rispondi usando esattamente uno di questi percorsi, copiato identico):
${elencoCartelle}${contestoPeriodo}

Se la cartella scelta è "DOC INIZIALE/DOC FONDAMENTALI", verifica anche se il documento corrisponde esattamente a una di queste voci della checklist pratiche amministrative: ${elencoPratiche}. Se sei RAGIONEVOLMENTE SICURO della corrispondenza, riporta il testo esatto della voce nel campo "pratica_voce" (copiato identico dall'elenco). Se non sei sicuro, o il documento non corrisponde chiaramente a nessuna voce, lascia "pratica_voce" vuoto: è preferibile lasciarlo vuoto piuttosto che indicare una voce sbagliata.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza backtick, con questa struttura esatta:
{
  "cartella": "il percorso esatto copiato dall'elenco",
  "pratica_voce": "il testo esatto della voce della checklist, oppure stringa vuota se non applicabile o non sicuro",
  "motivazione": "breve spiegazione di massimo 2 frasi sul perché questo documento va in quella cartella",
  "riassunto": "riassunto del contenuto del documento in 2-3 frasi",
  "dati_chiave": "eventuali dati importanti trovati: date, importi, nomi, misure (se non ce ne sono scrivi 'Nessun dato rilevante')",
  "azioni_richieste": "cosa bisogna fare con questo documento, se richiede un'azione (se nessuna azione scrivi 'Nessuna azione richiesta')"
}`;

      let parts;
      if (isSpreadsheet(item.file)) {
        const contenutoTestuale = await estraiTestoSpreadsheet(item.file);
        parts = [{ text: promptText + `\n\nContenuto del file (estratto come tabella):\n${contenutoTestuale}` }];
      } else {
        const b64 = await toBase64(item.file);
        const mime = getMimeType(item.file);
        parts = [{ text: promptText }, { inline_data: { mime_type: mime, data: b64 } }];
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts }] }) }
      );

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      let testo = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      testo = testo.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(testo);

      const cartellaValida = STRUTTURA_ARCHIVIO.find(c => c.path === parsed.cartella)?.path || "DOC INIZIALE/DOC ACCESSORI";
      // Verifica che la voce indicata dall'AI corrisponda esattamente a una
      // voce conosciuta della checklist; se non corrisponde (o l'AI l'ha
      // lasciata vuota perché non sicura) resta null e non viene collegata.
      const praticaVoceValida = parsed.pratica_voce && PRATICHE.find(p => p.voce === parsed.pratica_voce)
        ? parsed.pratica_voce
        : null;

      setItems(prev => prev.map(i => i.id === item.id ? {
        ...i,
        status: "done",
        cartella: cartellaValida,
        praticaVoce: praticaVoceValida,
        motivazione: parsed.motivazione || "",
        riassunto: parsed.riassunto || "",
        datiChiave: parsed.dati_chiave || "",
        azioni: parsed.azioni_richieste || "",
        driveStato: "idle",
      } : i));

      // Upload automatico su Drive se la commessa selezionata ha già la cartella pronta
      if (commessaSelezionata?.drive_folder_id) {
        caricaSuDrive({ ...item, cartella: cartellaValida });
      }

      // Se il documento è un'ipotesi di investimento, estrae i valori e li
      // salva automaticamente nel Budget HP INV della commessa selezionata.
      if (cartellaValida === "HP INVESTIMENTO" && commessaSelezionata) {
        salvaBudgetSuSupabase({ ...item, cartella: cartellaValida });
      }

      // Se l'AI ha riconosciuto con sicurezza una voce della checklist
      // Pratiche Amministrative, registra il collegamento su Supabase: la
      // voce comparirà spuntata nel tab Pratiche Amm. con il documento collegato.
      if (praticaVoceValida && commessaSelezionata) {
        await supabase.from("pratiche_amministrative_doc").insert({
          commessa_id: commessaSelezionata.id,
          voce: praticaVoceValida,
          nome_file: item.file.name,
          riassunto: parsed.riassunto || "",
          dati_chiave: parsed.dati_chiave || "",
        });
      }
    } catch (e) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status:"error", errore: e.message } : i));
    }
  };

  const caricaSuDrive = async (item) => {
    if (!commessaSelezionata?.drive_folder_id) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, driveStato:"error", driveErrore:"Seleziona una commessa con cartella Drive già creata." } : i));
      return;
    }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, driveStato:"uploading" } : i));
    try {
      const idSottocartella = await trovaIdSottocartellaDaPercorso(commessaSelezionata.drive_folder_id, item.cartella);
      await caricaFileSuDrive(item.file, idSottocartella);
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, driveStato:"done" } : i));
    } catch (e) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, driveStato:"error", driveErrore: e.message } : i));
    }
  };

  const selected = items.find(i => i.id === selectedId);
  const fmtSize = (bytes) => bytes > 1024*1024 ? (bytes/1024/1024).toFixed(1)+" MB" : (bytes/1024).toFixed(0)+" KB";

  return (
    <div>
      {/* API key */}
      <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:16, marginBottom:20 }}>
        <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.82rem", marginBottom:8 }}>🔑 GEMINI API KEY</div>
        <div style={{ display:"flex", gap:8 }}>
          <input
            type={apiKeySaved ? "password" : "text"}
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setApiKeySaved(false); }}
            placeholder="Incolla qui la tua API Key (AIza...)"
            style={{ ...inpStyle, flex:1 }}
          />
          <button onClick={() => { setStoredApiKey(apiKey); setApiKeySaved(true); }}
            style={{ background: apiKeySaved?"#14532d":"#1d4ed8", color: apiKeySaved?"#86efac":"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:"0.82rem", whiteSpace:"nowrap" }}>
            {apiKeySaved ? "✓ Salvata" : "Salva"}
          </button>
        </div>
        {!apiKeySaved && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:6 }}>Ottieni la chiave gratuita su aistudio.google.com → Get API Key. Verrà salvata in questo browser e usata automaticamente in tutti i tab.</div>}
      </div>

      {/* selettore commessa */}
      <div style={{ marginBottom:20 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Brand</label>
        <select value={filtroBrand} onChange={e => setFiltroBrand(e.target.value)} style={{ ...inpStyle, cursor:"pointer", marginBottom:10 }}>
          <option value="TUTTI">Tutti i brand</option>
          {BRAND_LIST.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Commessa di destinazione</label>
        <select value={commessaId} onChange={e => selezionaCommessaLocale(e.target.value)} style={{ ...inpStyle, cursor:"pointer" }}>
          <option value="">Seleziona una commessa…</option>
          {commesseFiltrate.map(c => <option key={c.id} value={c.id}>{c.nome}{!c.drive_folder_id ? " (cartella Drive non creata)" : ""}</option>)}
        </select>
        {caricamentoCommesse && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Caricamento elenco commesse…</div>}
        {!caricamentoCommesse && commesseFiltrate.length === 0 && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:4 }}>Nessuna commessa trovata per questo brand.</div>}
        {commessaSelezionata && !commessaSelezionata.drive_folder_id && (
          <div style={{ color:"#fbbf24", fontSize:"0.75rem", marginTop:4 }}>⚠ Questa commessa non ha ancora una cartella Drive. Crea la struttura dalla Scheda Negozio prima di caricare i documenti.</div>
        )}
      </div>

      {/* upload */}
      <label style={{ display:"block", background:"#0f172a", border:"2px dashed #334155", borderRadius:12, padding:"28px 16px", textAlign:"center", cursor:"pointer", marginBottom:20 }}>
        <input type="file" multiple accept="image/*,.pdf,.xls,.xlsx,.csv" onChange={handleFiles} style={{ display:"none" }} />
        <div style={{ fontSize:"2rem", marginBottom:8 }}>📂</div>
        <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.95rem", marginBottom:4 }}>Carica documenti per l'archivio</div>
        <div style={{ color:"#64748b", fontSize:"0.8rem" }}>L'AI apre ogni file, lo classifica e lo carica automaticamente su Drive nella cartella giusta — fino a 10 file insieme (immagini, PDF, Excel, CSV)</div>
      </label>

      <div style={{ display:"grid", gridTemplateColumns: selected ? "1fr 1.1fr" : "1fr", gap:20 }}>
        {/* lista documenti */}
        <div>
          {items.length === 0 && (
            <div style={{ color:"#475569", fontSize:"0.85rem", textAlign:"center", padding:30 }}>Nessun documento caricato ancora</div>
          )}
          {items.map(item => {
            const st = ARCHIVIO_STATUS_STYLE[item.status];
            return (
              <div key={item.id} onClick={() => setSelectedId(item.id)}
                style={{ background: selectedId===item.id?"#1e3a5f":"#1e293b", border:`1px solid ${selectedId===item.id?"#3b82f6":"#334155"}`, borderRadius:10, padding:"12px 14px", marginBottom:6, cursor:"pointer" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:"#e2e8f0", fontWeight:600, fontSize:"0.88rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {item.file.type?.startsWith("image")?"🖼":"📄"} {item.file.name}
                    </div>
                    <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:2 }}>{fmtSize(item.file.size)}</div>
                  </div>
                  <span style={{ background:st.bg, color:st.color, fontSize:"0.68rem", fontWeight:700, padding:"3px 9px", borderRadius:99, whiteSpace:"nowrap" }}>
                    {st.label}
                  </span>
                </div>
                {item.status === "done" && (
                  <div style={{ marginTop:8, background:"#0f172a", borderRadius:7, padding:"6px 10px" }}>
                    <div style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700 }}>📁 {item.cartella}</div>
                  </div>
                )}
                {item.status === "error" && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ color:"#fca5a5", fontSize:"0.75rem", marginBottom:6 }}>{item.errore}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); classifica(item); }}
                      style={{ background:"#1e293b", color:"#7dd3fc", border:"1px solid #334155", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:"0.75rem", fontWeight:700 }}
                    >
                      🔄 Riprova
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* dettaglio */}
        {selected && selected.status === "done" && (
          <div style={{ background:"#1e293b", border:"1px solid #1e3a5f", borderRadius:12, padding:18, maxHeight:560, overflowY:"auto" }}>
            <div style={{ color:"#475569", fontSize:"0.75rem", marginBottom:4 }}>{selected.file.name}</div>
            <div style={{ background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px", marginBottom:14 }}>
              <div style={{ color:"#64748b", fontSize:"0.72rem", marginBottom:2 }}>CARTELLA DI DESTINAZIONE</div>
              <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.92rem" }}>📁 {selected.cartella}</div>
            </div>

            <div style={{ marginBottom:14 }}>
              <div style={{ color:"#94a3b8", fontSize:"0.75rem", fontWeight:700, marginBottom:4 }}>PERCHÉ QUESTA CARTELLA</div>
              <div style={{ color:"#cbd5e1", fontSize:"0.85rem", lineHeight:1.6 }}>{selected.motivazione}</div>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ color:"#94a3b8", fontSize:"0.75rem", fontWeight:700, marginBottom:4 }}>RIASSUNTO CONTENUTO</div>
              <div style={{ color:"#cbd5e1", fontSize:"0.85rem", lineHeight:1.6 }}>{selected.riassunto}</div>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ color:"#94a3b8", fontSize:"0.75rem", fontWeight:700, marginBottom:4 }}>DATI CHIAVE</div>
              <div style={{ color:"#cbd5e1", fontSize:"0.85rem", lineHeight:1.6 }}>{selected.datiChiave}</div>
            </div>
            <div style={{ marginBottom:4 }}>
              <div style={{ color:"#94a3b8", fontSize:"0.75rem", fontWeight:700, marginBottom:4 }}>AZIONI RICHIESTE</div>
              <div style={{ color:"#fbbf24", fontSize:"0.85rem", lineHeight:1.6 }}>{selected.azioni}</div>
            </div>

            {selected.driveStato === "done" ? (
              <div style={{ background:"#14532d22", border:"1px solid #22c55e33", borderRadius:8, padding:"10px 14px", marginTop:14, color:"#86efac", fontSize:"0.82rem" }}>
                ✓ Caricato su Google Drive nella cartella giusta.
              </div>
            ) : (
              <div style={{ marginTop:14 }}>
                <button
                  onClick={() => caricaSuDrive(selected)}
                  disabled={selected.driveStato === "uploading" || !commessaSelezionata?.drive_folder_id}
                  style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", cursor: (!commessaSelezionata?.drive_folder_id) ? "not-allowed" : "pointer", fontWeight:700, fontSize:"0.84rem", opacity: (!commessaSelezionata?.drive_folder_id) ? 0.5 : 1 }}>
                  {selected.driveStato === "uploading" ? "Caricamento su Drive…" : "📤 Carica su Google Drive"}
                </button>
                {!commessaSelezionata && <div style={{ color:"#64748b", fontSize:"0.72rem", marginTop:6 }}>Seleziona prima una commessa qui sopra.</div>}
                {selected.driveStato === "error" && <div style={{ color:"#fca5a5", fontSize:"0.75rem", marginTop:6 }}>{selected.driveErrore}</div>}
              </div>
            )}

            {selected.cartella === "HP INVESTIMENTO" && (
              <div style={{ marginTop:14 }}>
                {selected.budgetStato === "estrazione" && (
                  <div style={{ background:"#1e3a5f", border:"1px solid #3b82f633", borderRadius:8, padding:"10px 14px", color:"#7dd3fc", fontSize:"0.82rem" }}>
                    ⏳ Estrazione valori e aggiornamento Budget HP INV in corso…
                  </div>
                )}
                {selected.budgetStato === "salvato" && (
                  <div style={{ background:"#14532d22", border:"1px solid #22c55e33", borderRadius:8, padding:"10px 14px", color:"#86efac", fontSize:"0.82rem" }}>
                    ✓ Budget HP INV aggiornato: {selected.budgetRiepilogo?.trovate} voci importate{selected.budgetRiepilogo?.nonTrovate > 0 ? ` (${selected.budgetRiepilogo.nonTrovate} non trovate nel file)` : ""}. Visibile nel tab Budget HP INV per questa commessa.
                  </div>
                )}
                {selected.budgetStato === "errore" && (
                  <div style={{ background:"#450a0a22", border:"1px solid #ef444433", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:"0.82rem" }}>
                    ⚠️ Non è stato possibile aggiornare il Budget HP INV: {selected.budgetErrore}
                  </div>
                )}
                {!commessaSelezionata && (
                  <div style={{ color:"#64748b", fontSize:"0.72rem" }}>Seleziona una commessa per aggiornare automaticamente il Budget HP INV.</div>
                )}
              </div>
            )}

            {selected.cartella === "DOC INIZIALE/DOC FONDAMENTALI" && (
              <div style={{ marginTop:14 }}>
                {selected.praticaVoce ? (
                  <div style={{ background:"#14532d22", border:"1px solid #22c55e33", borderRadius:8, padding:"10px 14px", color:"#86efac", fontSize:"0.82rem" }}>
                    ✓ Collegato alla voce "{selected.praticaVoce}" della checklist Pratiche Amm. — comparirà spuntata in quel tab.
                  </div>
                ) : (
                  <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", color:"#94a3b8", fontSize:"0.82rem" }}>
                    L'AI non ha trovato una corrispondenza sicura con una voce della checklist Pratiche Amm. Se questo documento copre una voce specifica, spuntala manualmente in quel tab.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <p style={{ color:"#475569", fontSize:"0.75rem", marginTop:16 }}>
        💡 L'AI legge il contenuto reale del documento (non solo il nome del file) per decidere la cartella più adatta tra le {STRUTTURA_ARCHIVIO.length} disponibili in archivio. Per computi, progetti, foto, documenti iniziali e sopralluoghi viene creata anche una sottocartella con la data odierna, così le revisioni successive restano separate.
      </p>
    </div>
  );
}

const TABS = [
  { id:"scheda",   label:"📋 Scheda Negozio" },
  { id:"workflow", label:"✅ Workflow" },
  { id:"pratiche", label:"📂 Pratiche Amm." },
  { id:"budget",   label:"💶 Budget HP INV" },
  { id:"ai",       label:"🤖 Analisi AI" },
  { id:"pdf",      label:"📝 Editor PDF" },
  { id:"documenti",label:"📁 Documenti" },
];

export default function App() {
  const [tab, setTab] = useState("workflow");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Commessa selezionata, condivisa tra Scheda Negozio, Documenti e Budget HP INV,
  // così cambiando tab non si perde la selezione e i dati restano coerenti.
  const [commessaIdGlobale, setCommessaIdGlobale] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // carica PDF.js da CDN
  React.useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      document.head.appendChild(script);
    }
  }, []);

  const handleLogout = async () => { await supabase.auth.signOut(); };

  if (authLoading) return (
    <div style={{ minHeight:"100vh", background:"#0a0f1e", display:"flex", alignItems:"center", justifyContent:"center", color:"#7dd3fc", fontSize:"1rem" }}>
      Caricamento…
    </div>
  );

  if (!session || !session.user) return <LoginScreen />;

  return (
    <div style={{ minHeight:"100vh", background:"#0a0f1e", color:"#e2e8f0", fontFamily:"'Inter',system-ui,sans-serif" }}>
      {/* header */}
      <div style={{ background:"linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)", borderBottom:"1px solid #1e3a5f", padding:"20px 24px 0" }}>
        <div style={{ maxWidth:1100, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ width:40, height:40, background:"linear-gradient(135deg,#3b82f6,#06b6d4)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem" }}>🏗</div>
            <div>
              <div style={{ fontWeight:800, fontSize:"1.15rem", letterSpacing:"-0.01em", color:"#f1f5f9" }}>Gestione Apertura Punti Vendita</div>
              <div style={{ color:"#64748b", fontSize:"0.78rem" }}>OVS / UPIM — Servizi Tecnici</div>
            </div>
          <button onClick={handleLogout} style={{ marginLeft:"auto", background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:"0.78rem" }}>
              🚪 Esci
            </button>
          </div>
          <div style={{ display:"flex", gap:2, overflowX:"auto" }}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{ background:tab===t.id?"#1e293b":"transparent", color:tab===t.id?"#e2e8f0":"#64748b", border:"none", borderBottom:tab===t.id?"2px solid #3b82f6":"2px solid transparent", padding:"10px 16px", cursor:"pointer", fontSize:"0.85rem", fontWeight:tab===t.id?600:400, transition:"all 0.15s", borderRadius:"8px 8px 0 0", whiteSpace:"nowrap" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* content */}
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"28px 24px" }}>
        {tab==="scheda"   && <TabScheda commessaIdGlobale={commessaIdGlobale} onCambiaCommessa={setCommessaIdGlobale} />}
        {tab==="workflow" && <TabWorkflow commessaIdGlobale={commessaIdGlobale} onCambiaCommessa={setCommessaIdGlobale} />}
        {tab==="pratiche" && <TabPratiche commessaIdGlobale={commessaIdGlobale} onCambiaCommessa={setCommessaIdGlobale} />}
        {tab==="budget"   && <TabBudget commessaIdGlobale={commessaIdGlobale} onCambiaCommessa={setCommessaIdGlobale} />}
        {tab==="ai"       && <TabAnalisiAI />}
        {tab==="pdf"      && <TabEditorPDF />}
        {tab==="documenti"&& <TabDocumenti commessaIdGlobale={commessaIdGlobale} onCambiaCommessa={setCommessaIdGlobale} />}
      </div>
    </div>
  );
}

// ── LOGIN COMPONENT ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!email || !password) { setError("Inserisci email e password."); return; }
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError("Credenziali non valide. Riprova.");
    else onLogin();
    setLoading(false);
  };

  const inp = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", width:"100%", outline:"none", fontSize:"0.95rem", boxSizing:"border-box" };

  return (
    <div style={{ minHeight:"100vh", background:"#0a0f1e", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#1e293b", border:"1px solid #1e3a5f", borderRadius:16, padding:40, width:"100%", maxWidth:380 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ width:56, height:56, background:"linear-gradient(135deg,#3b82f6,#06b6d4)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.6rem", margin:"0 auto 14px" }}>🏗</div>
          <div style={{ color:"#f1f5f9", fontWeight:800, fontSize:"1.2rem" }}>Gestione Aperture</div>
          <div style={{ color:"#64748b", fontSize:"0.82rem", marginTop:4 }}>OVS / UPIM — Servizi Tecnici</div>
        </div>

        <div style={{ marginBottom:14 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:5 }}>EMAIL</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="la-tua@email.com" style={inp} onKeyDown={e=>e.key==="Enter"&&handleLogin()} />
        </div>
        <div style={{ marginBottom:20 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:5 }}>PASSWORD</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={inp} onKeyDown={e=>e.key==="Enter"&&handleLogin()} />
        </div>

        {error && <div style={{ background:"#450a0a", border:"1px solid #ef4444", borderRadius:8, padding:"8px 12px", marginBottom:14, color:"#fca5a5", fontSize:"0.82rem" }}>{error}</div>}

        <button onClick={handleLogin} disabled={loading}
          style={{ width:"100%", background: loading?"#1e293b":"linear-gradient(135deg,#3b82f6,#06b6d4)", color: loading?"#475569":"#fff", border:"none", borderRadius:10, padding:"12px", fontWeight:700, fontSize:"0.95rem", cursor: loading?"not-allowed":"pointer" }}>
          {loading ? "Accesso in corso…" : "Accedi"}
        </button>

        <div style={{ color:"#475569", fontSize:"0.75rem", textAlign:"center", marginTop:16 }}>
          Accesso riservato al personale autorizzato OVS
        </div>
      </div>
    </div>
  );
}
