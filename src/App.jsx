import React, { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://senygjjmynyyljetrylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlbnlnampteW55eWxqZXRyeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDQ4ODMsImV4cCI6MjA5NzEyMDg4M30.QDiY125PiPojVquV9LcdbfCJgBINfHvUu2s10MxrQDo";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // mantiene la sessione nel browser tra le riaperture
    autoRefreshToken: true,    // rinnova automaticamente il token prima che scada
    detectSessionInUrl: true,  // gestisce il ritorno dai link (es. reset password)
  },
});

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

// Trova (o crea, se non esiste) una cartella nella radice del Drive per nome.
// Usata per le macro-cartelle APERTURE / RISTRUTTURAZIONI che contengono le
// rispettive commesse. Cerca solo tra le cartelle nella root ("My Drive").
const trovaOCreaCartellaRoot = async (nome) => {
  const query = encodeURIComponent(`name = '${nome.replace(/'/g, "\\'")}' and 'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  if (data.files && data.files.length > 0) return data.files[0].id;
  return await creaCartellaDrive(nome); // creata nella root
};

// Nome della macro-cartella in base al tipo di commessa
const macroCartellaPerTipo = (tipo) => (tipo === "ristrutturazione" ? "RISTRUTTURAZIONI" : "APERTURE");

// Crea la cartella della commessa con dentro tutte le sottocartelle annidate
// definite in SOTTOCARTELLE_COMMESSA. La commessa viene creata dentro la
// macro-cartella APERTURE o RISTRUTTURAZIONI in base al tipo. Ritorna l'id
// della cartella radice della commessa.
const creaStrutturaCommessaSuDrive = async (nomeCommessa, tipo = "apertura") => {
  const macroId = await trovaOCreaCartellaRoot(macroCartellaPerTipo(tipo));
  const rootId = await creaCartellaDrive(nomeCommessa, macroId);
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

// Sposta una cartella commessa già esistente dentro la macro-cartella giusta
// (APERTURE/RISTRUTTURAZIONI) in base al tipo. Rimuove i parent precedenti e
// aggiunge il nuovo. Ritorna l'id della macro-cartella di destinazione.
const spostaCommessaInMacroCartella = async (driveFolderId, tipo) => {
  const macroId = await trovaOCreaCartellaRoot(macroCartellaPerTipo(tipo));
  // Recupera i parent attuali della cartella commessa
  const infoRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFolderId}?fields=parents`);
  const info = await infoRes.json();
  if (info.error) throw new Error(info.error.message);
  const vecchiParent = (info.parents || []).join(",");
  // Se è già dentro la macro-cartella giusta, non fa nulla
  if (info.parents && info.parents.length === 1 && info.parents[0] === macroId) return macroId;
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFolderId}?addParents=${macroId}${vecchiParent ? `&removeParents=${vecchiParent}` : ""}&fields=id,parents`, {
    method: "PATCH",
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return macroId;
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

// Salva (o sovrascrive) un file a nome fisso dentro una cartella Drive: se
// esiste già un file con quel nome nella cartella, ne aggiorna il contenuto
// (PATCH media), altrimenti lo crea. Usato per il file Excel unico della
// Gestione Quotidiana, che si riscrive a ogni aggiornamento.
const upsertFileFissoSuDrive = async (nomeFile, blob, folderId, mimeType) => {
  // Cerca un file con quel nome nella cartella
  const query = encodeURIComponent(`name = '${nomeFile.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`);
  const ricerca = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
  const datiRicerca = await ricerca.json();
  if (datiRicerca.error) throw new Error(datiRicerca.error.message);
  const esistente = datiRicerca.files?.[0]?.id || null;

  if (esistente) {
    // Aggiorna solo il contenuto del file esistente (mantiene lo stesso id/link)
    const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${esistente}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": mimeType },
      body: blob,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
  } else {
    // Crea nuovo file nella cartella
    const metadata = { name: nomeFile, parents: [folderId] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", blob);
    const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.id;
  }
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

// Cache/lock condivisa per la creazione delle sottocartelle-data. Evita che
// caricando più file insieme vengano create più cartelle con la stessa data:
// il primo upload che ha bisogno della cartella avvia la sua creazione e
// memorizza la promessa; gli altri upload in parallelo riusano la stessa
// promessa invece di crearne una propria. Chiave: rootId|percorso|data.
const _lockCartelleData = new Map();

const trovaOCreaCartellaDataConLock = async (idPadre, nomeData, chiave) => {
  if (_lockCartelleData.has(chiave)) {
    // Un altro upload sta già creando/ha creato questa cartella: riusa il risultato
    return _lockCartelleData.get(chiave);
  }
  const promessa = (async () => {
    let idData = await trovaSottocartella(nomeData, idPadre);
    if (!idData) idData = await creaCartellaDrive(nomeData, idPadre);
    return idData;
  })();
  _lockCartelleData.set(chiave, promessa);
  try {
    return await promessa;
  } catch (e) {
    // In caso di errore, libera il lock così un retry può ritentare
    _lockCartelleData.delete(chiave);
    throw e;
  }
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
    const chiave = `${idCorrente}|${percorso}|${nomeData}`;
    idCorrente = await trovaOCreaCartellaDataConLock(idCorrente, nomeData, chiave);
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

function TabWorkflow({ commessaIdGlobale, commesse, commessaSelezionata }) {
  const [faseFiltro, setFaseFiltro] = useState("TUTTE");
  const [searchQ, setSearchQ] = useState("");
  const commessaId = commessaIdGlobale || "";
  const [completati, setCompletati] = useState(new Set()); // Set di workflow_id completati per la commessa selezionata
  const [caricamentoStati, setCaricamentoStati] = useState(false);
  const [erroreStati, setErroreStati] = useState("");
  const [aggiornamentoInCorso, setAggiornamentoInCorso] = useState(null); // workflow_id in fase di toggle, per disabilitare il click doppio

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
      {/* indicazione commessa attiva (selezionata dall'header) */}
      <div style={{ marginBottom:20 }}>
        {!commessaId && <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per vedere e aggiornare l'avanzamento del workflow.</div>}
        {commessaId && commessaSelezionata && (
          <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>
        )}
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

function TabPratiche({ commessaIdGlobale, commesse, commessaSelezionata }) {
  const [stati, setStati] = useState(() => Object.fromEntries(PRATICHE.map((p,i) => [i, "—"])));
  const [filtroP, setFiltroP] = useState("TUTTE");
  const commessaId = commessaIdGlobale || "";
  const [documentiPerVoce, setDocumentiPerVoce] = useState({}); // voce -> [ {nome_file, riassunto, dati_chiave, data_caricamento}, ... ]
  const [caricamentoDocumenti, setCaricamentoDocumenti] = useState(false);
  const [erroreDocumenti, setErroreDocumenti] = useState("");
  const [voceSelezionata, setVoceSelezionata] = useState(null); // testo voce mostrata nel pannello dettaglio
  const [rimozioneInCorso, setRimozioneInCorso] = useState(null); // id del documento in fase di rimozione, per disabilitare il pulsante
  const [erroreRimozione, setErroreRimozione] = useState("");

  const cats = [...new Set(PRATICHE.map(p=>p.categoria))];

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
        {/* indicazione commessa attiva (selezionata dall'header) */}
        <div style={{ marginBottom:16 }}>
          {!commessaId && <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per vedere quali documenti sono già stati collegati automaticamente dal tab Documenti.</div>}
          {commessaId && commessaSelezionata && (
            <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>
          )}
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

const valoriVuoti = () => Object.fromEntries(BUDGET_VOCI.map(v=>v.n).map(n=>[n, { std:0, extra:0, sal:[] }]));

// Somma degli importi SAL registrati per una voce (il "fatturato/avanzato")
const sommaSal = (voce) => (voce?.sal || []).reduce((a, s) => a + (Number(s?.importo) || 0), 0);

function TabBudget({ commessaIdGlobale, commesse, commessaSelezionata }) {
  const commessaId = commessaIdGlobale || "";
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

  // Gestione SAL (stati avanzamento) multipli per voce
  const [salVoceAperta, setSalVoceAperta] = useState(null); // numero voce con pannello SAL aperto
  const [nuovoSal, setNuovoSal] = useState({ importo:"", data:"", nota:"" });

  const aggiungiSal = (n) => {
    const importo = Number(nuovoSal.importo) || 0;
    if (importo <= 0) return;
    setValori(prev => {
      const voce = prev[n] || { std:0, extra:0, sal:[] };
      const sal = [...(voce.sal || []), { importo, data: nuovoSal.data || new Date().toISOString().slice(0,10), nota: nuovoSal.nota || "" }];
      return { ...prev, [n]: { ...voce, sal } };
    });
    setNuovoSal({ importo:"", data:"", nota:"" });
  };

  const rimuoviSal = (n, idx) => {
    setValori(prev => {
      const voce = prev[n] || { std:0, extra:0, sal:[] };
      const sal = (voce.sal || []).filter((_, i) => i !== idx);
      return { ...prev, [n]: { ...voce, sal } };
    });
  };

  const cats = [...new Set(BUDGET_VOCI.map(v=>v.categoria))];

  const totale = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.std||0) + (valori[v.n]?.extra||0), 0);
  const totaleStd = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.std||0), 0);
  const totaleExtra = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.extra||0), 0);
  const totaleFatturato = BUDGET_VOCI.reduce((acc,v)=>acc + sommaSal(valori[v.n]), 0);
  const totaleSospeso = totale - totaleFatturato;

  const inputStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:6, padding:"5px 8px", width:110, textAlign:"right", fontSize:"0.82rem", outline:"none" };

  // Stili per le prime due colonne (N. e VOCE) che restano fisse mentre si
  // scorre orizzontalmente verso le colonne SAL/Sospeso. Servono position
  // sticky + un background opaco per coprire il contenuto che scorre sotto.
  const COL_N_W = 44;   // larghezza colonna N.
  const stickyN = (bg) => ({ position:"sticky", left:0, zIndex:2, background:bg, minWidth:COL_N_W, width:COL_N_W });
  const stickyVoce = (bg) => ({ position:"sticky", left:COL_N_W, zIndex:2, background:bg, boxShadow:"2px 0 4px -2px rgba(0,0,0,0.5)" });

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
          // Normalizza: ogni voce deve avere un array sal (le versioni vecchie
          // salvate prima dei SAL hanno solo std/extra).
          const base = valoriVuoti();
          const caricati = data.valori || {};
          const uniti = { ...base };
          Object.keys(caricati).forEach(n => {
            uniti[n] = { std:0, extra:0, ...caricati[n], sal: caricati[n].sal || [] };
          });
          setValori(uniti);
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
      // Unisce i nuovi valori std/extra importati, ma preserva i SAL già
      // registrati per ciascuna voce (l'import aggiorna gli importi previsti,
      // non deve cancellare gli stati avanzamento inseriti a mano).
      const valoriUniti = { ...valori };
      Object.keys(nuoviValori).forEach(n => {
        valoriUniti[n] = { ...nuoviValori[n], sal: valori[n]?.sal || [] };
      });
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
      {/* indicazione commessa attiva (selezionata dall'header) */}
      <div style={{ marginBottom:20 }}>
        {!commessaId && <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per vedere o modificare il suo Budget HP INV.</div>}
        {commessaId && commessaSelezionata && (
          <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>
        )}
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
        <div style={{ background:"#1e293b", border:"1px solid #92400e", borderRadius:10, padding:"12px 18px", flex:1, minWidth:160 }}>
          <div style={{ color:"#fbbf24", fontSize:"0.75rem", marginBottom:4 }}>FATTURATO (SAL)</div>
          <div style={{ color:"#fbbf24", fontWeight:700, fontSize:"1.2rem" }}>{fmtEur(totaleFatturato)}</div>
        </div>
        <div style={{ background:"#1e293b", border:`1px solid ${totaleSospeso>0?"#7f1d1d":"#14532d"}`, borderRadius:10, padding:"12px 18px", flex:1, minWidth:160 }}>
          <div style={{ color: totaleSospeso>0?"#fca5a5":"#86efac", fontSize:"0.75rem", marginBottom:4 }}>SOSPESO (RESIDUO)</div>
          <div style={{ color: totaleSospeso>0?"#fca5a5":"#86efac", fontWeight:700, fontSize:"1.2rem" }}>{fmtEur(totaleSospeso)}</div>
        </div>
      </div>


      {/* tabella */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.82rem" }}>
          <thead>
            <tr style={{ color:"#64748b", fontSize:"0.75rem", letterSpacing:"0.06em" }}>
              <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #334155", ...stickyN("#0a0f1e"), zIndex:3 }}>N.</th>
              <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #334155", ...stickyVoce("#0a0f1e"), zIndex:3 }}>VOCE</th>
              <th style={{ textAlign:"left", padding:"8px 10px", borderBottom:"1px solid #334155" }}>RESP.</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>STANDARD (€)</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>EXTRA (€)</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>TOTALE (€)</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>SAL FATTURATO (€)</th>
              <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>SOSPESO (€)</th>
              {mqVendita>0 && <th style={{ textAlign:"right", padding:"8px 10px", borderBottom:"1px solid #334155" }}>€/mq</th>}
            </tr>
          </thead>
          <tbody>
            {cats.map(cat => {
              const voci = BUDGET_VOCI.filter(v=>v.categoria===cat);
              const subStd = voci.reduce((a,v)=>a+(valori[v.n]?.std||0),0);
              const subExtra = voci.reduce((a,v)=>a+(valori[v.n]?.extra||0),0);
              const subTot = subStd + subExtra;
              const subFatt = voci.reduce((a,v)=>a+sommaSal(valori[v.n]),0);
              const subSosp = subTot - subFatt;
              return [
                <tr key={"cat-"+cat}>
                  <td colSpan={mqVendita>0?9:8} style={{ padding:"10px 10px 4px", color:"#7dd3fc", fontWeight:700, fontSize:"0.78rem", letterSpacing:"0.06em", borderTop:"1px solid #1e3a5f" }}>{cat}</td>
                </tr>,
                ...voci.flatMap(v=>{
                  const std = valori[v.n]?.std||0;
                  const extra = valori[v.n]?.extra||0;
                  const tot = std + extra;
                  const fatt = sommaSal(valori[v.n]);
                  const sosp = tot - fatt;
                  const salList = valori[v.n]?.sal || [];
                  const aperta = salVoceAperta === v.n;
                  const righe = [
                    <tr key={v.n} style={{ borderBottom:"1px solid #0f172a" }}>
                      <td style={{ padding:"6px 10px", color:"#475569", ...stickyN("#0a0f1e") }}>{v.n}</td>
                      <td style={{ padding:"6px 10px", color:"#cbd5e1", ...stickyVoce("#0a0f1e") }}>{v.voce}</td>
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
                      <td style={{ padding:"6px 10px", textAlign:"right" }}>
                        <button onClick={()=> setSalVoceAperta(aperta?null:v.n)}
                          style={{ background: aperta?"#1e3a5f":"transparent", color: fatt>0?"#fbbf24":"#64748b", border:`1px solid ${aperta?"#3b82f6":"#334155"}`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.8rem", fontWeight: fatt>0?700:400, minWidth:90, textAlign:"right" }}>
                          {fatt>0?fmtEur(fatt):"+ SAL"}{salList.length>0?` (${salList.length})`:""}
                        </button>
                      </td>
                      <td style={{ padding:"6px 10px", textAlign:"right", color: sosp>0?"#fca5a5":(tot>0?"#86efac":"#475569"), fontWeight: tot>0?700:400 }}>
                        {tot>0?fmtEur(sosp):"—"}
                      </td>
                      {mqVendita>0 && <td style={{ padding:"6px 10px", textAlign:"right", color:"#64748b" }}>
                        {tot>0?fmtEur(Math.round(tot/mqVendita)):"—"}
                      </td>}
                    </tr>
                  ];
                  if (aperta) {
                    righe.push(
                      <tr key={v.n+"-sal"} style={{ background:"#0c1424" }}>
                        <td colSpan={mqVendita>0?9:8} style={{ padding:"10px 16px" }}>
                          <div style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700, marginBottom:8 }}>Stati avanzamento — {v.voce}</div>
                          {salList.length===0 && <div style={{ color:"#64748b", fontSize:"0.8rem", marginBottom:8 }}>Nessun SAL registrato. Aggiungi il primo importo fatturato qui sotto.</div>}
                          {salList.map((s,idx)=>(
                            <div key={idx} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:5, fontSize:"0.82rem" }}>
                              <span style={{ color:"#94a3b8", minWidth:60 }}>SAL {idx+1}</span>
                              <span style={{ color:"#fbbf24", fontWeight:700, minWidth:90, textAlign:"right" }}>{fmtEur(Number(s.importo)||0)}</span>
                              <span style={{ color:"#64748b" }}>{s.data ? new Date(s.data).toLocaleDateString("it-IT") : ""}</span>
                              {s.nota && <span style={{ color:"#64748b" }}>— {s.nota}</span>}
                              <button onClick={()=>rimuoviSal(v.n,idx)} style={{ marginLeft:"auto", background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:"0.95rem" }}>✕</button>
                            </div>
                          ))}
                          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end", marginTop:10, paddingTop:10, borderTop:"1px solid #1e293b" }}>
                            <div>
                              <label style={{ color:"#64748b", fontSize:"0.7rem", display:"block", marginBottom:2 }}>Importo SAL (€)</label>
                              <input type="number" value={nuovoSal.importo} onChange={e=>setNuovoSal(v2=>({...v2,importo:e.target.value}))} placeholder="0" style={{ ...inputStyle, width:110 }} />
                            </div>
                            <div>
                              <label style={{ color:"#64748b", fontSize:"0.7rem", display:"block", marginBottom:2 }}>Data</label>
                              <input type="date" value={nuovoSal.data} onChange={e=>setNuovoSal(v2=>({...v2,data:e.target.value}))} style={{ ...inputStyle, width:140, textAlign:"left" }} />
                            </div>
                            <div style={{ flex:1, minWidth:120 }}>
                              <label style={{ color:"#64748b", fontSize:"0.7rem", display:"block", marginBottom:2 }}>Nota (opz.)</label>
                              <input type="text" value={nuovoSal.nota} onChange={e=>setNuovoSal(v2=>({...v2,nota:e.target.value}))} placeholder="es. fattura n. 12" style={{ ...inputStyle, width:"100%", textAlign:"left" }} />
                            </div>
                            <button onClick={()=>aggiungiSal(v.n)} style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:6, padding:"7px 14px", cursor:"pointer", fontSize:"0.8rem", fontWeight:700 }}>+ Aggiungi</button>
                          </div>
                          <div style={{ marginTop:10, display:"flex", gap:20, fontSize:"0.82rem" }}>
                            <span style={{ color:"#94a3b8" }}>Previsto: <strong style={{ color:"#86efac" }}>{fmtEur(tot)}</strong></span>
                            <span style={{ color:"#94a3b8" }}>Fatturato: <strong style={{ color:"#fbbf24" }}>{fmtEur(fatt)}</strong></span>
                            <span style={{ color:"#94a3b8" }}>Sospeso: <strong style={{ color: sosp>0?"#fca5a5":"#86efac" }}>{fmtEur(sosp)}</strong></span>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return righe;
                }),
                <tr key={"sub-"+cat} style={{ background:"#0f172a" }}>
                  <td colSpan={3} style={{ padding:"6px 10px", color:"#475569", fontSize:"0.78rem", position:"sticky", left:0, zIndex:2, background:"#0f172a" }}>subtotale {cat}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#86efac", fontWeight:700 }}>{fmtEur(subStd)||"—"}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#fbbf24", fontWeight:700 }}>{fmtEur(subExtra)||"—"}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#e2e8f0", fontWeight:700 }}>{fmtEur(subTot)||"—"}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color:"#fbbf24", fontWeight:700 }}>{subFatt>0?fmtEur(subFatt):"—"}</td>
                  <td style={{ padding:"6px 10px", textAlign:"right", color: subSosp>0?"#fca5a5":"#86efac", fontWeight:700 }}>{subTot>0?fmtEur(subSosp):"—"}</td>
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

const FORM_VUOTO = { id:null, nome:"", brand:"OVS", tipo:"apertura", responsabile:"", tecnico:"", periodo:"", indirizzo:"", citta:"", mq_vendita:0, mq_riserva:0, mq_totali:0, note:"", drive_folder_id:null };

function TabScheda({ commessaIdGlobale, onCambiaCommessa, commesse, onCommessaSalvata, tipoDefault }) {
  const [form, setForm] = useState(FORM_VUOTO);
  const [salvataggio, setSalvataggio] = useState("idle"); // idle | saving | saved | error
  const [erroreSalvataggio, setErroreSalvataggio] = useState("");
  const [driveStato, setDriveStato] = useState("idle"); // idle | creating | done | error
  const [erroreDrive, setErroreDrive] = useState("");
  const [confermaElimina, setConfermaElimina] = useState(false); // primo click arma la conferma
  const [eliminazioneStato, setEliminazioneStato] = useState("idle"); // idle | eliminando | errore
  const [erroreEliminazione, setErroreEliminazione] = useState("");
  const [spostaStato, setSpostaStato] = useState("idle"); // idle | spostando | done | error
  const [erroreSposta, setErroreSposta] = useState("");

  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inpStyle = { background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem" };

  // Form vuoto per una nuova commessa, con il tipo (apertura/ristrutturazione)
  // preimpostato in base al filtro attivo nell'header.
  const formVuoto = () => ({ ...FORM_VUOTO, tipo: tipoDefault || "apertura" });

  const selezionaCommessa = (id) => {
    setConfermaElimina(false);
    setErroreEliminazione("");
    if (!id) { setForm(formVuoto()); onCambiaCommessa?.(null); return; }
    const c = commesse.find(x => x.id === id);
    if (c) setForm({ ...FORM_VUOTO, ...c, tipo: c.tipo || "apertura" });
    onCambiaCommessa?.(id || null);
  };

  // Se la commessa selezionata globalmente cambia da un altro tab o dal
  // menu nell'header, aggiorna anche il form della Scheda Negozio di conseguenza.
  useEffect(() => {
    if (commessaIdGlobale && commessaIdGlobale !== form.id && commesse.length > 0) {
      const c = commesse.find(x => x.id === commessaIdGlobale);
      if (c) setForm({ ...FORM_VUOTO, ...c, tipo: c.tipo || "apertura" });
    }
    if (!commessaIdGlobale && form.id) {
      setForm(formVuoto());
    }
  }, [commessaIdGlobale, commesse]);

  const salva = async () => {
    if (!form.nome.trim()) { setErroreSalvataggio("Il nome del negozio è obbligatorio."); setSalvataggio("error"); return; }
    setSalvataggio("saving");
    setErroreSalvataggio("");

    const payload = {
      nome: form.nome, brand: form.brand, tipo: form.tipo || "apertura", responsabile: form.responsabile, tecnico: form.tecnico,
      periodo: form.periodo, indirizzo: form.indirizzo, citta: form.citta,
      mq_vendita: form.mq_vendita || null, mq_riserva: form.mq_riserva || null, mq_totali: form.mq_totali || null,
      note: form.note,
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
      await onCommessaSalvata?.();
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
      const { rootId } = await creaStrutturaCommessaSuDrive(form.nome, form.tipo || "apertura");
      const { error } = await supabase.from("commesse").update({ drive_folder_id: rootId }).eq("id", form.id);
      if (error) throw error;
      setForm(f => ({ ...f, drive_folder_id: rootId }));
      setDriveStato("done");
      await onCommessaSalvata?.();
    } catch (e) {
      setErroreDrive(e.message || "Errore durante la creazione su Drive.");
      setDriveStato("error");
    }
  };

  // Sposta una commessa già esistente (con cartella Drive) dentro la macro-cartella
  // APERTURE o RISTRUTTURAZIONI corretta in base al tipo selezionato.
  const spostaInMacroCartella = async () => {
    if (!form.drive_folder_id) return;
    setSpostaStato("spostando");
    setErroreSposta("");
    try {
      await spostaCommessaInMacroCartella(form.drive_folder_id, form.tipo || "apertura");
      setSpostaStato("done");
      setTimeout(() => setSpostaStato("idle"), 3000);
    } catch (e) {
      setErroreSposta(e.message || "Errore durante lo spostamento su Drive.");
      setSpostaStato("error");
    }
  };

  // Elimina definitivamente la commessa selezionata da Supabase. Le tabelle
  // collegate (workflow_completato, pratiche_amministrative_doc, budget_hp_inv,
  // ecc.) hanno foreign key con "on delete cascade", quindi i loro dati vengono
  // rimossi automaticamente. Il file/cartella su Google Drive NON viene toccato:
  // va eventualmente rimosso a mano. Richiede doppio click (conferma) per sicurezza.
  const eliminaCommessa = async () => {
    if (!form.id) return;
    if (!confermaElimina) { setConfermaElimina(true); return; } // primo click: arma la conferma
    setEliminazioneStato("eliminando");
    setErroreEliminazione("");
    try {
      const { error } = await supabase.from("commesse").delete().eq("id", form.id);
      if (error) throw error;
      setConfermaElimina(false);
      setEliminazioneStato("idle");
      setForm(formVuoto());
      onCambiaCommessa?.(null);
      await onCommessaSalvata?.();
    } catch (e) {
      setErroreEliminazione(e.message || "Errore durante l'eliminazione della commessa.");
      setEliminazioneStato("errore");
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
      </div>

      <div style={{ color:"#64748b", fontSize:"0.82rem", marginBottom:18 }}>Compila la scheda del negozio. Salvando, la commessa resta disponibile anche negli altri tab e dopo aver chiuso l'app.</div>
      {[
        { label:"Nome negozio / ID commessa", key:"nome" },
        { label:"Aperture / Ristrutturazioni", key:"tipo", type:"select", opts:[{v:"apertura",l:"Apertura"},{v:"ristrutturazione",l:"Ristrutturazione"}] },
        { label:"Brand", key:"brand", type:"select", opts:BRAND_LIST },
        { label:"Responsabile commessa", key:"responsabile" },
        { label:"Tecnico", key:"tecnico" },
      ].map(f=>(
        <div key={f.key} style={{ marginBottom:14 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>{f.label}</label>
          {f.type==="select"
            ? <select value={form[f.key]} onChange={e=>set(f.key,e.target.value)} style={{ ...inpStyle, cursor:"pointer" }}>
                {f.opts.map(o => typeof o === "object"
                  ? <option key={o.v} value={o.v}>{o.l}</option>
                  : <option key={o}>{o}</option>)}
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

      {/* MQ: vendita, riserva e totali come campi indipendenti */}
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        {[
          { label:"MQ area vendita", key:"mq_vendita" },
          { label:"MQ riserva", key:"mq_riserva" },
          { label:"MQ totali", key:"mq_totali" },
        ].map(f=>(
          <div key={f.key} style={{ flex:1, minWidth:120 }}>
            <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>{f.label}</label>
            <input type="number" value={form[f.key]} onChange={e=>set(f.key,e.target.value)} style={inpStyle} />
          </div>
        ))}
      </div>
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
            <div>
              <div style={{ color:"#86efac", fontSize:"0.82rem", marginBottom:10 }}>
                ✓ Cartella creata su Drive con tutte le sottocartelle pronte.{" "}
                <a href={`https://drive.google.com/drive/folders/${form.drive_folder_id}`} target="_blank" rel="noreferrer" style={{ color:"#7dd3fc" }}>Apri su Drive →</a>
              </div>
              <div style={{ color:"#64748b", fontSize:"0.78rem", marginBottom:8 }}>
                Sposta questa commessa nella macro-cartella <strong>{form.tipo==="ristrutturazione"?"RISTRUTTURAZIONI":"APERTURE"}</strong> su Drive (utile per le commesse create prima delle macro-cartelle, o se hai cambiato il tipo).
              </div>
              <button onClick={spostaInMacroCartella} disabled={spostaStato==="spostando"}
                style={{ background:"#1e293b", color:"#7dd3fc", border:"1px solid #334155", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontWeight:700, fontSize:"0.8rem", opacity: spostaStato==="spostando"?0.6:1 }}>
                {spostaStato==="spostando" ? "Spostamento…" : `📂 Sposta in ${form.tipo==="ristrutturazione"?"RISTRUTTURAZIONI":"APERTURE"}`}
              </button>
              {spostaStato==="done" && <span style={{ color:"#86efac", fontSize:"0.8rem", marginLeft:10 }}>✓ Spostata</span>}
              {spostaStato==="error" && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:8 }}>{erroreSposta}</div>}
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
          {[["Tipo", form.tipo==="ristrutturazione"?"Ristrutturazione":"Apertura"],["Brand", form.brand],["Commessa",form.nome],["Responsabile",form.responsabile],["Tecnico",form.tecnico],["Periodo",formattaPeriodo(form.periodo)],["Indirizzo",`${form.indirizzo}${form.citta?" – "+form.citta:""}`],["MQ vendita",form.mq_vendita?form.mq_vendita+" mq":""],["MQ riserva",form.mq_riserva?form.mq_riserva+" mq":""],["MQ totali",form.mq_totali?form.mq_totali+" mq":""]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} style={{ display:"flex", gap:8, marginBottom:5 }}>
              <span style={{ color:"#475569", width:120, fontSize:"0.82rem", flexShrink:0 }}>{k}</span>
              <span style={{ color:"#e2e8f0", fontSize:"0.82rem" }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* eliminazione commessa: solo su commessa esistente, con doppio click */}
      {form.id && (
        <div style={{ marginTop:20, paddingTop:16, borderTop:"1px solid #1e293b" }}>
          {!confermaElimina ? (
            <button onClick={eliminaCommessa}
              style={{ background:"none", color:"#fca5a5", border:"1px solid #ef444433", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:"0.82rem", fontWeight:700 }}>
              🗑 Elimina questa commessa
            </button>
          ) : (
            <div style={{ background:"#450a0a22", border:"1px solid #ef444455", borderRadius:8, padding:"12px 16px" }}>
              <div style={{ color:"#fca5a5", fontSize:"0.85rem", marginBottom:10 }}>
                Eliminare definitivamente la commessa "{form.nome}"? Verranno rimossi anche tutti i dati collegati (workflow, pratiche, budget). L'operazione non si può annullare. La cartella su Google Drive resta e va eventualmente rimossa a mano.
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={eliminaCommessa} disabled={eliminazioneStato==="eliminando"}
                  style={{ background:"#7f1d1d", color:"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:"0.82rem", fontWeight:700, opacity: eliminazioneStato==="eliminando"?0.6:1 }}>
                  {eliminazioneStato==="eliminando" ? "Eliminazione…" : "Sì, elimina definitivamente"}
                </button>
                <button onClick={() => { setConfermaElimina(false); setErroreEliminazione(""); }} disabled={eliminazioneStato==="eliminando"}
                  style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:"0.82rem" }}>
                  Annulla
                </button>
              </div>
              {eliminazioneStato==="errore" && <div style={{ color:"#fca5a5", fontSize:"0.78rem", marginTop:8 }}>{erroreEliminazione}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
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

function TabDocumenti({ commessaIdGlobale, commesse, commessaSelezionata }) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(() => !!getStoredApiKey());
  const [items, setItems] = useState([]); // { id, file, status, cartella, motivazione, riassunto, datiChiave, azioni, errore, driveStato, mappaCartelle }
  const [selectedId, setSelectedId] = useState(null);

  const inpStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.88rem" };

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
      // Recupera i SAL già registrati per questa commessa, per non perderli
      // quando si ricarica un'ipotesi di investimento dal tab Documenti.
      let valoriDaSalvare = valori;
      try {
        const { data: esistente } = await supabase.from("budget_hp_inv").select("valori").eq("commessa_id", commessaSelezionata.id).maybeSingle();
        if (esistente?.valori) {
          valoriDaSalvare = { ...valori };
          Object.keys(valori).forEach(n => {
            valoriDaSalvare[n] = { ...valori[n], sal: esistente.valori[n]?.sal || [] };
          });
        }
      } catch (_) { /* se non esiste riga precedente, si procede con i soli nuovi valori */ }
      const { error } = await supabase.from("budget_hp_inv").upsert({
        commessa_id: commessaSelezionata.id,
        valori: valoriDaSalvare,
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

      {/* indicazione commessa attiva (selezionata dall'header) */}
      <div style={{ marginBottom:20 }}>
        {!commessaSelezionata && (
          <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per caricare e classificare documenti.</div>
        )}
        {commessaSelezionata && (
          <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>
        )}
        {commessaSelezionata && !commessaSelezionata.drive_folder_id && (
          <div style={{ color:"#fbbf24", fontSize:"0.75rem", marginTop:6 }}>⚠ Questa commessa non ha ancora una cartella Drive. Crea la struttura dalla Scheda Negozio prima di caricare i documenti.</div>
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

// ── TAB VOCALE ────────────────────────────────────────────────────────────

// Prompt condiviso che spiega all'AI cosa fare con la trascrizione, dato un
// elenco di attività Workflow (con stato attuale) e le richieste libere già
// esistenti per la commessa. Usato sia in modalità singola che multipla.
const costruisciPromptVocale = (contestoCommesse) => {
  const elencoAttivita = WORKFLOW.map(w => `${w.id}. ${w.titolo}`).join("\n");
  const blocchiCommesse = contestoCommesse.map(c => {
    const fatte = (c.workflowCompletati || []).join(", ") || "nessuna";
    const richiesteAperte = (c.richiesteAperte || []).map(r => `- "${r.testo}" (aperta dal ${new Date(r.creato_il).toLocaleDateString("it-IT")})`).join("\n") || "nessuna richiesta aperta";
    const richiesteFatte = (c.richiesteFatte || []).map(r => `- "${r.testo}" (fatta il ${new Date(r.creato_il).toLocaleDateString("it-IT")})`).join("\n") || "nessuna";
    return `### Commessa "${c.nome}" (id: ${c.id})\nAttività Workflow già completate (id): ${fatte}\nRichieste libere ancora aperte per questa commessa:\n${richiesteAperte}\nRichieste libere già segnate come fatte per questa commessa (usa questo elenco per capire se qualcosa nel vocale è un duplicato):\n${richiesteFatte}`;
  }).join("\n\n");

  return `Sei un assistente che aggiorna lo stato di avanzamento di una o più commesse di apertura punti vendita retail, a partire dalla trascrizione di un vocale registrato da un tecnico.

ELENCO ATTIVITÀ STANDARD DEL WORKFLOW (id e titolo):
${elencoAttivita}

CONTESTO ATTUALE DELLE COMMESSE COINVOLTE:
${blocchiCommesse}

Ascolta l'audio fornito e fai quanto segue:
1. Trascrivi fedelmente l'audio in italiano.
2. Per ciascuna commessa coinvolta nel discorso, individua quali attività standard del Workflow (dall'elenco sopra) risultano completate secondo quanto detto, riportando il loro id numerico. Riporta SOLO le attività NON già presenti nell'elenco "già completate" per quella commessa.
3. Individua eventuali richieste o task specifici menzionati (es. "bisogna ordinare X", "il cliente ha chiesto Y", "manca ancora Z") che NON sono attività standard del Workflow. Per ciascuna, scrivi una frase breve e chiara che riassuma la richiesta.
4. Per ogni richiesta individuata al punto 3, confronta con le "richieste già segnate come fatte" per quella commessa: se sembra riferirsi alla STESSA richiesta (anche con parole diverse) e questo vocale la conferma come fatta o ne parla di nuovo, imposta "possibile_duplicato": true e riporta il testo esatto della richiesta precedente in "duplicato_di_testo". Se invece è chiaramente una richiesta nuova, imposta "possibile_duplicato": false.
5. Se non sei sicuro a quale commessa si riferisce una parte del discorso (capita solo se ci sono più commesse), assegnala alla commessa più plausibile in base al contesto; se è genuinamente ambigua, ometti quella parte piuttosto che indovinare a caso.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza backtick, con questa struttura esatta:
{
  "trascrizione": "trascrizione completa e fedele dell'audio",
  "aggiornamenti": [
    {
      "commessa_id": "id esatto copiato dal contesto sopra",
      "attivita_completate": [elenco di id numerici del Workflow risultati completati, solo i nuovi],
      "nuove_richieste": [
        { "testo": "descrizione breve della richiesta", "stato": "aperta oppure fatta, secondo quanto detto nel vocale", "possibile_duplicato": true o false, "duplicato_di_testo": "testo della richiesta precedente se possibile_duplicato è true, altrimenti stringa vuota" }
      ]
    }
  ]
}
Se il vocale non riguarda nessuna commessa specifica o non contiene aggiornamenti utili, restituisci comunque la trascrizione con "aggiornamenti": [].`;
};

function TabVocale({ commessaIdGlobale, commesse, commessaSelezionata }) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(() => !!getStoredApiKey());
  const [modalita, setModalita] = useState("singola"); // "singola" | "multipla"
  const [commesseMultiple, setCommesseMultiple] = useState([]); // array di id, per la modalità multipla
  const [registrazione, setRegistrazione] = useState("idle"); // idle | recording | elaborazione | fatto | errore
  const [erroreVocale, setErroreVocale] = useState("");
  const [ultimoRisultato, setUltimoRisultato] = useState(null); // { trascrizione, aggiornamentiPerCommessa: [{nome, attivitaNuove, richiesteNuove}] }
  const [richiesteVisualizzate, setRichiesteVisualizzate] = useState([]);
  const [caricamentoRichieste, setCaricamentoRichieste] = useState(false);

  const mediaRecorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);

  const commesseSelezionateAttuali = modalita === "singola"
    ? (commessaSelezionata ? [commessaSelezionata] : [])
    : commesse.filter(c => commesseMultiple.includes(c.id));

  // Carica le richieste libere della commessa attiva (solo modalità singola,
  // dove ha senso mostrare la tabella di una commessa specifica) per
  // mostrarle nella tabella interattiva sotto.
  useEffect(() => {
    if (modalita !== "singola" || !commessaIdGlobale) {
      setRichiesteVisualizzate([]);
      return;
    }
    (async () => {
      setCaricamentoRichieste(true);
      const { data, error } = await supabase
        .from("richieste_libere")
        .select("*")
        .eq("commessa_id", commessaIdGlobale)
        .order("creato_il", { ascending:false });
      if (!error && data) setRichiesteVisualizzate(data);
      setCaricamentoRichieste(false);
    })();
  }, [commessaIdGlobale, modalita, ultimoRisultato]);

  const ricaricaRichieste = async () => {
    if (!commessaIdGlobale) return;
    const { data, error } = await supabase
      .from("richieste_libere")
      .select("*")
      .eq("commessa_id", commessaIdGlobale)
      .order("creato_il", { ascending:false });
    if (!error && data) setRichiesteVisualizzate(data);
  };

  const toBase64Blob = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Errore lettura audio registrato"));
    r.readAsDataURL(blob);
  });

  const avviaRegistrazione = async () => {
    setErroreVocale("");
    if (!apiKey) { setErroreVocale("Inserisci prima la chiave API Gemini qui sotto."); return; }
    if (commesseSelezionateAttuali.length === 0) {
      setErroreVocale(modalita === "singola" ? "Seleziona una commessa dal menu in alto." : "Seleziona almeno una commessa per la modalità multipla.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRegistrazione("recording");
    } catch (e) {
      setErroreVocale("Impossibile accedere al microfono: " + (e.message || "permesso negato.") + " Controlla i permessi del browser.");
      setRegistrazione("errore");
    }
  };

  const fermaRegistrazione = () => {
    if (!mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      await elaboraVocale(blob);
    };
    recorder.stop();
    setRegistrazione("elaborazione");
  };

  const elaboraVocale = async (blob) => {
    try {
      const audioB64 = await toBase64Blob(blob);
      const mime = blob.type || "audio/webm";

      // Per ogni commessa coinvolta, recupera lo stato attuale (attività
      // workflow completate e richieste libere) per dare contesto all'AI e
      // permetterle di individuare duplicati e attività nuove.
      const contestoCommesse = [];
      for (const c of commesseSelezionateAttuali) {
        const { data: wf } = await supabase.from("workflow_completato").select("workflow_id").eq("commessa_id", c.id);
        const { data: ric } = await supabase.from("richieste_libere").select("*").eq("commessa_id", c.id);
        contestoCommesse.push({
          id: c.id,
          nome: c.nome,
          workflowCompletati: (wf || []).map(r => r.workflow_id),
          richiesteAperte: (ric || []).filter(r => r.stato === "aperta"),
          richiesteFatte: (ric || []).filter(r => r.stato === "fatta"),
        });
      }

      const promptText = costruisciPromptVocale(contestoCommesse);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: mime, data: audioB64 } }] }] }) }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      let testo = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      testo = testo.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(testo);

      // Salva il log del vocale
      const idsCommesse = commesseSelezionateAttuali.map(c => c.id);
      const { data: logSalvato } = await supabase.from("vocali_log").insert({
        trascrizione: parsed.trascrizione || "",
        modalita,
        commesse_coinvolte: idsCommesse,
      }).select().single();

      const riepilogoPerCommessa = [];

      for (const agg of (parsed.aggiornamenti || [])) {
        const commessaRif = commesseSelezionateAttuali.find(c => c.id === agg.commessa_id);
        if (!commessaRif) continue;

        // 1) Spunta le attività Workflow risultate completate
        const nuoveAttivita = (agg.attivita_completate || []).filter(id => WORKFLOW.some(w => w.id === id));
        for (const wId of nuoveAttivita) {
          await supabase.from("workflow_completato").insert({ commessa_id: commessaRif.id, workflow_id: wId }).select();
        }

        // 2) Aggiunge le nuove richieste libere, con flag duplicato se segnalato
        const richiesteInserite = [];
        for (const r of (agg.nuove_richieste || [])) {
          if (!r.testo) continue;
          let duplicatoDiId = null;
          if (r.possibile_duplicato && r.duplicato_di_testo) {
            const { data: match } = await supabase
              .from("richieste_libere")
              .select("id")
              .eq("commessa_id", commessaRif.id)
              .eq("testo", r.duplicato_di_testo)
              .limit(1);
            if (match && match[0]) duplicatoDiId = match[0].id;
          }
          const { data: inserita } = await supabase.from("richieste_libere").insert({
            commessa_id: commessaRif.id,
            testo: r.testo,
            stato: r.stato === "fatta" ? "fatta" : "aperta",
            possibile_duplicato: !!r.possibile_duplicato,
            duplicato_di: duplicatoDiId,
            vocale_id: logSalvato?.id || null,
          }).select().single();
          if (inserita) richiesteInserite.push(inserita);
        }

        riepilogoPerCommessa.push({
          nome: commessaRif.nome,
          attivitaNuove: nuoveAttivita.map(id => WORKFLOW.find(w => w.id === id)?.titolo).filter(Boolean),
          richiesteNuove: richiesteInserite,
        });
      }

      setUltimoRisultato({ trascrizione: parsed.trascrizione || "", aggiornamentiPerCommessa: riepilogoPerCommessa });
      setRegistrazione("fatto");
      await ricaricaRichieste();
    } catch (e) {
      setErroreVocale(e.message || "Errore durante l'elaborazione del vocale.");
      setRegistrazione("errore");
    }
  };

  const segnaStato = async (richiesta, nuovoStato) => {
    await supabase.from("richieste_libere").update({ stato: nuovoStato }).eq("id", richiesta.id);
    setRichiesteVisualizzate(prev => prev.map(r => r.id === richiesta.id ? { ...r, stato: nuovoStato } : r));
  };

  const eliminaRichiesta = async (richiesta) => {
    await supabase.from("richieste_libere").delete().eq("id", richiesta.id);
    setRichiesteVisualizzate(prev => prev.filter(r => r.id !== richiesta.id));
  };

  const esportaExcel = async () => {
    const XLSX = await loadSheetJS();
    const wb = XLSX.utils.book_new();

    // Foglio 1: attività Workflow standard, con stato per la commessa attiva
    if (commessaIdGlobale) {
      const { data: wf } = await supabase.from("workflow_completato").select("workflow_id").eq("commessa_id", commessaIdGlobale);
      const completatiSet = new Set((wf || []).map(r => r.workflow_id));
      const righeWorkflow = WORKFLOW.map(w => ({ Fase: w.fase, Attività: w.titolo, Stato: completatiSet.has(w.id) ? "FATTO" : "DA FARE" }));
      const wsWorkflow = XLSX.utils.json_to_sheet(righeWorkflow);
      XLSX.utils.book_append_sheet(wb, wsWorkflow, "Workflow");
    }

    // Foglio 2: richieste libere
    const righeRichieste = richiesteVisualizzate.map(r => ({
      Richiesta: r.testo,
      Stato: r.stato === "fatta" ? "FATTA" : "APERTA",
      "Possibile duplicato": r.possibile_duplicato ? "SI — verificare" : "",
      "Creata il": new Date(r.creato_il).toLocaleString("it-IT"),
    }));
    const wsRichieste = XLSX.utils.json_to_sheet(righeRichieste);
    XLSX.utils.book_append_sheet(wb, wsRichieste, "Richieste");

    const nomeFile = `Avanzamento_${(commessaSelezionata?.nome || "commessa").replace(/[^a-zA-Z0-9]/g,"_")}.xlsx`;
    XLSX.writeFile(wb, nomeFile);
  };

  const inpStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.88rem" };

  return (
    <div>
      {/* chiave API */}
      <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:14, marginBottom:20 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:6 }}>Chiave API Gemini</label>
        <div style={{ display:"flex", gap:8 }}>
          <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Incolla qui la tua chiave API" style={inpStyle} />
          <button onClick={() => { setStoredApiKey(apiKey); setApiKeySaved(true); }} style={{ background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:"0.85rem", fontWeight:600, whiteSpace:"nowrap" }}>Salva</button>
        </div>
        {!apiKeySaved && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:6 }}>Ottieni la chiave gratuita su aistudio.google.com → Get API Key.</div>}
      </div>

      {/* modalità */}
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <button onClick={() => setModalita("singola")}
          style={{ flex:1, background: modalita==="singola" ? "#3b82f6" : "#1e293b", color: modalita==="singola" ? "#fff" : "#94a3b8", border:`1px solid ${modalita==="singola"?"#3b82f6":"#334155"}`, borderRadius:8, padding:"10px 14px", cursor:"pointer", fontSize:"0.85rem", fontWeight:600 }}>
          🎯 Vocale su commessa singola
        </button>
        <button onClick={() => setModalita("multipla")}
          style={{ flex:1, background: modalita==="multipla" ? "#3b82f6" : "#1e293b", color: modalita==="multipla" ? "#fff" : "#94a3b8", border:`1px solid ${modalita==="multipla"?"#3b82f6":"#334155"}`, borderRadius:8, padding:"10px 14px", cursor:"pointer", fontSize:"0.85rem", fontWeight:600 }}>
          🗂 Vocale su più commesse
        </button>
      </div>

      {modalita === "singola" && (
        <div style={{ marginBottom:16 }}>
          {!commessaSelezionata
            ? <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per registrare un aggiornamento vocale.</div>
            : <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>
          }
        </div>
      )}

      {modalita === "multipla" && (
        <div style={{ marginBottom:16 }}>
          <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:6 }}>Seleziona le commesse coinvolte nel vocale (l'AI capirà da sola a quale parte del discorso si riferisce ognuna)</label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {commesse.map(c => {
              const attiva = commesseMultiple.includes(c.id);
              return (
                <button key={c.id}
                  onClick={() => setCommesseMultiple(prev => attiva ? prev.filter(x=>x!==c.id) : [...prev, c.id])}
                  style={{ background: attiva ? "#1d4ed8" : "#1e293b", color: attiva ? "#fff" : "#94a3b8", border:`1px solid ${attiva?"#3b82f6":"#334155"}`, borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:"0.8rem" }}>
                  {attiva ? "✓ " : ""}{c.nome}
                </button>
              );
            })}
          </div>
          {commesse.length === 0 && <div style={{ color:"#475569", fontSize:"0.78rem", marginTop:6 }}>Nessuna commessa disponibile per il brand selezionato in alto.</div>}
        </div>
      )}

      {/* registrazione */}
      <div style={{ background:"#0f172a", border:"2px dashed #334155", borderRadius:12, padding:"24px 16px", textAlign:"center", marginBottom:20 }}>
        {registrazione !== "recording" ? (
          <button onClick={avviaRegistrazione}
            style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:99, width:64, height:64, fontSize:"1.6rem", cursor:"pointer", marginBottom:10 }}>
            🎙
          </button>
        ) : (
          <button onClick={fermaRegistrazione}
            style={{ background:"#dc2626", color:"#fff", border:"none", borderRadius:16, width:64, height:64, fontSize:"1.6rem", cursor:"pointer", marginBottom:10, animation:"pulse 1.5s infinite" }}>
            ⏹
          </button>
        )}
        <div style={{ color:"#94a3b8", fontSize:"0.85rem" }}>
          {registrazione === "idle" && "Tocca per iniziare a registrare"}
          {registrazione === "recording" && "🔴 Registrazione in corso — tocca per fermare e analizzare"}
          {registrazione === "elaborazione" && "⏳ Trascrizione e analisi AI in corso…"}
          {registrazione === "fatto" && "✓ Vocale elaborato — vedi il riepilogo sotto"}
          {registrazione === "errore" && "⚠ Si è verificato un errore"}
        </div>
        {erroreVocale && <div style={{ color:"#fca5a5", fontSize:"0.8rem", marginTop:10 }}>{erroreVocale}</div>}
      </div>

      {/* riepilogo ultimo vocale */}
      {ultimoRisultato && (
        <div style={{ background:"#1e293b", border:"1px solid #1e3a5f", borderRadius:10, padding:16, marginBottom:20 }}>
          <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.9rem", marginBottom:10 }}>📝 Trascrizione</div>
          <div style={{ color:"#cbd5e1", fontSize:"0.85rem", lineHeight:1.5, marginBottom:14, fontStyle:"italic" }}>"{ultimoRisultato.trascrizione}"</div>
          {ultimoRisultato.aggiornamentiPerCommessa.length === 0 && (
            <div style={{ color:"#64748b", fontSize:"0.82rem" }}>Nessun aggiornamento riconosciuto in questo vocale.</div>
          )}
          {ultimoRisultato.aggiornamentiPerCommessa.map((agg, i) => (
            <div key={i} style={{ borderTop: i>0 ? "1px solid #334155" : "none", paddingTop: i>0 ? 12 : 0, marginTop: i>0 ? 12 : 0 }}>
              <div style={{ color:"#e2e8f0", fontWeight:600, fontSize:"0.88rem", marginBottom:6 }}>📁 {agg.nome}</div>
              {agg.attivitaNuove.length > 0 && (
                <div style={{ marginBottom:8 }}>
                  <div style={{ color:"#86efac", fontSize:"0.78rem", marginBottom:4 }}>✓ Attività Workflow spuntate:</div>
                  {agg.attivitaNuove.map((t,j) => <div key={j} style={{ color:"#cbd5e1", fontSize:"0.82rem", marginLeft:12 }}>• {t}</div>)}
                </div>
              )}
              {agg.richiesteNuove.length > 0 && (
                <div>
                  <div style={{ color:"#7dd3fc", fontSize:"0.78rem", marginBottom:4 }}>+ Nuove richieste registrate:</div>
                  {agg.richiesteNuove.map((r,j) => (
                    <div key={j} style={{ color:"#cbd5e1", fontSize:"0.82rem", marginLeft:12, marginBottom:2 }}>
                      • {r.testo} {r.stato==="fatta" && <span style={{ color:"#86efac" }}>(fatta)</span>}
                      {r.possibile_duplicato && <span style={{ color:"#fbbf24" }}> ⚠ possibile duplicato — verificare</span>}
                    </div>
                  ))}
                </div>
              )}
              {agg.attivitaNuove.length === 0 && agg.richiesteNuove.length === 0 && (
                <div style={{ color:"#64748b", fontSize:"0.8rem" }}>Nessun aggiornamento per questa commessa.</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* tabella richieste libere della commessa attiva */}
      {modalita === "singola" && commessaIdGlobale && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.9rem" }}>📋 Stato avanzamento — {commessaSelezionata?.nome}</div>
            <button onClick={esportaExcel} style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:"0.78rem" }}>
              📥 Scarica Excel
            </button>
          </div>
          {caricamentoRichieste && <div style={{ color:"#475569", fontSize:"0.78rem", marginBottom:8 }}>Caricamento…</div>}
          {richiesteVisualizzate.length === 0 && !caricamentoRichieste && (
            <div style={{ color:"#64748b", fontSize:"0.82rem" }}>Nessuna richiesta libera ancora registrata per questa commessa. Registra un vocale per iniziare.</div>
          )}
          {richiesteVisualizzate.map(r => (
            <div key={r.id} style={{ display:"flex", alignItems:"flex-start", gap:10, background: r.possibile_duplicato ? "#451a0322" : "#1e293b", border:`1px solid ${r.possibile_duplicato ? "#f59e0b55" : "#334155"}`, borderRadius:10, padding:"10px 14px", marginBottom:6 }}>
              <div style={{ flex:1 }}>
                <div style={{ color: r.stato==="fatta" ? "#64748b" : "#e2e8f0", fontSize:"0.88rem", textDecoration: r.stato==="fatta" ? "line-through" : "none" }}>{r.testo}</div>
                <div style={{ display:"flex", gap:10, marginTop:4, flexWrap:"wrap" }}>
                  <span style={{ color:"#475569", fontSize:"0.72rem" }}>{new Date(r.creato_il).toLocaleDateString("it-IT")}</span>
                  {r.possibile_duplicato && <span style={{ color:"#fbbf24", fontSize:"0.72rem", fontWeight:700 }}>⚠ possibile duplicato — verificare</span>}
                </div>
              </div>
              <button onClick={() => segnaStato(r, r.stato==="fatta" ? "aperta" : "fatta")}
                style={{ background: r.stato==="fatta" ? "#14532d" : "#1e293b", color: r.stato==="fatta" ? "#86efac" : "#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.75rem", whiteSpace:"nowrap" }}>
                {r.stato==="fatta" ? "✓ Fatta" : "Segna fatta"}
              </button>
              <button onClick={() => eliminaRichiesta(r)}
                style={{ background:"none", color:"#64748b", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.75rem" }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TAB ATTIVITÀ COMMESSA — lista piatta attività per singola commessa ──────────
// con aggiornamento vocale tramite Gemini (segna FATTO / aggiunge nuove).
function TabAttivitaCommessa({ commessaIdGlobale, commessaSelezionata }) {
  const commessaId = commessaIdGlobale || "";
  const [attivita, setAttivita] = useState([]);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [nuova, setNuova] = useState({ descrizione:"", scadenza:"", note:"" });
  const [salvando, setSalvando] = useState(false);
  const apiKey = getStoredApiKey();

  // stato registrazione vocale
  const [registrazione, setRegistrazione] = useState("idle"); // idle | recording | elaborazione | done | errore
  const [erroreVocale, setErroreVocale] = useState("");
  const [riepilogoVocale, setRiepilogoVocale] = useState(null); // { fatte:[], nuove:[] }
  const mediaRecorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);

  const inp = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", outline:"none", fontSize:"0.88rem", width:"100%" };

  const carica = async () => {
    if (!commessaId) { setAttivita([]); return; }
    setCaricamento(true);
    setErrore("");
    try {
      const { data, error } = await supabase.from("attivita_commessa").select("*").eq("commessa_id", commessaId).order("created_at", { ascending:true });
      if (error) throw error;
      setAttivita(data || []);
    } catch (e) {
      setErrore(e.message || "Errore durante il caricamento delle attività.");
    } finally {
      setCaricamento(false);
    }
  };

  useEffect(() => { carica(); setRiepilogoVocale(null); }, [commessaId]);

  const aggiungiManuale = async () => {
    if (!nuova.descrizione.trim() || !commessaId) return;
    setSalvando(true);
    try {
      const { data, error } = await supabase.from("attivita_commessa").insert({
        commessa_id: commessaId,
        descrizione: nuova.descrizione.trim(),
        stato: "DA FARE",
        scadenza: nuova.scadenza || null,
        note: nuova.note || null,
        origine: "manuale",
      }).select().single();
      if (error) throw error;
      setAttivita(prev => [...prev, data]);
      setNuova({ descrizione:"", scadenza:"", note:"" });
    } catch (e) {
      setErrore(e.message || "Errore durante l'aggiunta.");
    } finally {
      setSalvando(false);
    }
  };

  const toggleStato = async (a) => {
    const nuovoStato = a.stato === "FATTO" ? "DA FARE" : "FATTO";
    setAttivita(prev => prev.map(x => x.id === a.id ? { ...x, stato: nuovoStato } : x));
    try {
      await supabase.from("attivita_commessa").update({ stato: nuovoStato, updated_at: new Date().toISOString() }).eq("id", a.id);
    } catch (e) {
      setErrore(e.message || "Errore durante l'aggiornamento."); carica();
    }
  };

  const elimina = async (id) => {
    setAttivita(prev => prev.filter(x => x.id !== id));
    try { await supabase.from("attivita_commessa").delete().eq("id", id); }
    catch (e) { setErrore(e.message || "Errore durante l'eliminazione."); carica(); }
  };

  // Scarica un Excel con le attività di questa commessa (da fare + fatte).
  const scaricaExcel = async () => {
    const XLSX = await loadSheetJS();
    const righe = attivita.map(a => ({
      Attività: a.descrizione,
      Stato: a.stato === "FATTO" ? "FATTO" : "DA FARE",
      Scadenza: a.scadenza ? new Date(a.scadenza).toLocaleDateString("it-IT") : "",
      Note: a.note || "",
      Origine: a.origine === "vocale" ? "Vocale" : "Manuale",
    }));
    if (righe.length === 0) righe.push({ Attività:"(nessuna attività)", Stato:"", Scadenza:"", Note:"", Origine:"" });
    const ws = XLSX.utils.json_to_sheet(righe);
    ws["!cols"] = [{ wch:50 }, { wch:12 }, { wch:14 }, { wch:40 }, { wch:12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attività");
    const nomeFile = `Attivita_${(commessaSelezionata?.nome || "commessa").replace(/[^a-zA-Z0-9]/g,"_")}.xlsx`;
    XLSX.writeFile(wb, nomeFile);
  };

  // ── registrazione vocale ──
  const toBase64Blob = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Errore lettura audio"));
    r.readAsDataURL(blob);
  });

  const avviaRegistrazione = async () => {
    setErroreVocale(""); setRiepilogoVocale(null);
    if (!apiKey) { setErroreVocale("Inserisci prima la API Key Gemini nel tab Documenti o Analisi AI."); setRegistrazione("errore"); return; }
    if (!commessaId) { setErroreVocale("Seleziona una commessa dal menu in alto."); setRegistrazione("errore"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRegistrazione("recording");
    } catch (e) {
      setErroreVocale("Impossibile accedere al microfono: " + (e.message || "permesso negato.")); setRegistrazione("errore");
    }
  };

  const fermaRegistrazione = () => {
    if (!mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      await elaboraVocale(blob);
    };
    recorder.stop();
    setRegistrazione("elaborazione");
  };

  const elaboraVocale = async (blob) => {
    try {
      const audioB64 = await toBase64Blob(blob);
      const mime = blob.type || "audio/webm";
      const elencoAttuali = attivita.map(a => `- (id:${a.id}) [${a.stato}] ${a.descrizione}`).join("\n") || "(nessuna attività ancora presente)";

      const promptText = `Sei un assistente che gestisce la lista di attività di un cantiere/negozio per un project manager tecnico. Ascolta l'audio allegato (in italiano) e aggiorna la lista delle attività di questa commessa.

ATTIVITÀ ATTUALI di questa commessa:
${elencoAttuali}

Regole:
- Se nell'audio si dice che un'attività esistente è stata completata/fatta/finita, marcala come FATTA (usa il suo id).
- Se si parla di qualcosa di nuovo da fare, crea una nuova attività con una descrizione SINTETICA e PROFESSIONALE (non trascrivere parola per parola: riformula in modo pulito e conciso, come una voce di to-do).
- Se si menziona una scadenza o data per una nuova attività, includila (formato AAAA-MM-GG).
- Ignora il parlato irrilevante (saluti, esitazioni).

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza backtick, con questa struttura esatta:
{
  "completate": ["id1", "id2"],
  "nuove": [
    { "descrizione": "testo sintetico attività", "scadenza": "AAAA-MM-GG oppure stringa vuota", "note": "eventuale nota breve oppure stringa vuota" }
  ]
}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ contents:[{ parts:[{ text: promptText }, { inline_data:{ mime_type: mime, data: audioB64 } }] }] }) }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      let testo = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      testo = testo.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(testo);

      const completate = Array.isArray(parsed.completate) ? parsed.completate : [];
      const nuove = Array.isArray(parsed.nuove) ? parsed.nuove : [];

      // Applica: segna fatte
      for (const id of completate) {
        await supabase.from("attivita_commessa").update({ stato:"FATTO", updated_at:new Date().toISOString() }).eq("id", id).eq("commessa_id", commessaId);
      }
      // Applica: aggiungi nuove
      const nuoveInserite = [];
      for (const n of nuove) {
        if (!n.descrizione || !n.descrizione.trim()) continue;
        const { data: ins } = await supabase.from("attivita_commessa").insert({
          commessa_id: commessaId,
          descrizione: n.descrizione.trim(),
          stato: "DA FARE",
          scadenza: n.scadenza || null,
          note: n.note || null,
          origine: "vocale",
        }).select().single();
        if (ins) nuoveInserite.push(ins);
      }

      await carica();
      setRiepilogoVocale({
        fatte: completate.length,
        nuove: nuoveInserite.map(a => a.descrizione),
      });
      setRegistrazione("done");
      setTimeout(() => setRegistrazione("idle"), 500);
    } catch (e) {
      setErroreVocale(e.message || "Errore durante l'elaborazione del vocale.");
      setRegistrazione("errore");
    }
  };

  const daFare = attivita.filter(a => a.stato !== "FATTO");
  const fatte = attivita.filter(a => a.stato === "FATTO");

  return (
    <div>
      <div style={{ marginBottom:8, color:"#94a3b8", fontSize:"0.9rem" }}>
        Lista attività e note di questa commessa. Aggiorna a mano oppure con un vocale: l'AI segna come fatte le attività completate e aggiunge quelle nuove, riformulandole in modo sintetico.
      </div>

      {/* indicazione commessa attiva */}
      <div style={{ marginBottom:18 }}>
        {!commessaId && <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per gestire le sue attività.</div>}
        {commessaId && commessaSelezionata && <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>}
      </div>

      {commessaId && (
        <>
          {/* registrazione vocale */}
          <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:16, marginBottom:18 }}>
            <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.82rem", marginBottom:10 }}>🎙 AGGIORNA CON UN VOCALE</div>
            {registrazione !== "recording" ? (
              <button onClick={avviaRegistrazione} disabled={registrazione==="elaborazione"}
                style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", cursor: registrazione==="elaborazione"?"wait":"pointer", fontWeight:700, fontSize:"0.84rem", opacity: registrazione==="elaborazione"?0.6:1 }}>
                {registrazione==="elaborazione" ? "Elaborazione in corso…" : "● Avvia registrazione"}
              </button>
            ) : (
              <button onClick={fermaRegistrazione}
                style={{ background:"#7f1d1d", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", cursor:"pointer", fontWeight:700, fontSize:"0.84rem" }}>
                ■ Ferma e elabora
              </button>
            )}
            {registrazione==="recording" && <span style={{ color:"#fca5a5", fontSize:"0.82rem", marginLeft:12 }}>🔴 Registrazione in corso… parla pure</span>}
            {erroreVocale && <div style={{ color:"#fca5a5", fontSize:"0.8rem", marginTop:8 }}>{erroreVocale}</div>}
            {riepilogoVocale && (
              <div style={{ color:"#86efac", fontSize:"0.82rem", marginTop:10, background:"#14532d22", border:"1px solid #22c55e33", borderRadius:8, padding:"8px 12px" }}>
                ✓ Aggiornamento applicato: {riepilogoVocale.fatte} attività segnate come fatte, {riepilogoVocale.nuove.length} nuove aggiunte.
                {riepilogoVocale.nuove.length > 0 && <div style={{ marginTop:4, color:"#cbd5e1" }}>Nuove: {riepilogoVocale.nuove.join(" · ")}</div>}
              </div>
            )}
          </div>

          {/* aggiunta manuale */}
          <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:14, marginBottom:18 }}>
            <input value={nuova.descrizione} onChange={e=>setNuova(v=>({...v,descrizione:e.target.value}))} placeholder="Nuova attività…" style={{ ...inp, marginBottom:8 }} />
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
              <div style={{ flex:1, minWidth:140 }}>
                <label style={{ color:"#64748b", fontSize:"0.72rem", display:"block", marginBottom:2 }}>Scadenza (opzionale)</label>
                <input type="date" value={nuova.scadenza} onChange={e=>setNuova(v=>({...v,scadenza:e.target.value}))} style={inp} />
              </div>
              <div style={{ flex:2, minWidth:160 }}>
                <label style={{ color:"#64748b", fontSize:"0.72rem", display:"block", marginBottom:2 }}>Nota (opzionale)</label>
                <input value={nuova.note} onChange={e=>setNuova(v=>({...v,note:e.target.value}))} placeholder="" style={inp} />
              </div>
            </div>
            <button onClick={aggiungiManuale} disabled={salvando || !nuova.descrizione.trim()}
              style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"7px 16px", cursor: nuova.descrizione.trim()?"pointer":"not-allowed", fontSize:"0.82rem", fontWeight:700, opacity: nuova.descrizione.trim()?1:0.5 }}>
              {salvando ? "Aggiunta…" : "+ Aggiungi attività"}
            </button>
          </div>

          {errore && <div style={{ color:"#fca5a5", fontSize:"0.82rem", marginBottom:10 }}>{errore}</div>}
          {caricamento && <div style={{ color:"#7dd3fc", fontSize:"0.82rem" }}>Caricamento…</div>}

          {/* intestazione lista + scarica excel */}
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
            <button onClick={scaricaExcel} disabled={attivita.length===0}
              style={{ background:"#0f172a", color:"#7dd3fc", border:"1px solid #334155", borderRadius:8, padding:"6px 14px", cursor: attivita.length===0?"not-allowed":"pointer", fontSize:"0.8rem", fontWeight:700, opacity: attivita.length===0?0.5:1 }}>
              📥 Scarica Excel
            </button>
          </div>

          {/* da fare */}
          <div style={{ color:"#fca5a5", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.06em", marginBottom:8 }}>DA FARE ({daFare.length})</div>
          {daFare.length===0 && <div style={{ color:"#64748b", fontSize:"0.85rem", marginBottom:14 }}>Nessuna attività da fare.</div>}
          {daFare.map(a => (
            <div key={a.id} style={{ display:"flex", alignItems:"flex-start", gap:10, background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"10px 14px", marginBottom:6 }}>
              <button onClick={()=>toggleStato(a)} title="Segna come fatta" style={{ width:20, height:20, borderRadius:6, border:"2px solid #475569", background:"transparent", cursor:"pointer", flexShrink:0, marginTop:2 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:"#e2e8f0", fontSize:"0.9rem", fontWeight:600 }}>{a.descrizione}{a.origine==="vocale" && <span style={{ color:"#7dd3fc", fontSize:"0.7rem", marginLeft:6 }}>🎙</span>}</div>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", fontSize:"0.75rem", color:"#64748b", marginTop:2 }}>
                  {a.scadenza && <span>📅 {new Date(a.scadenza).toLocaleDateString("it-IT")}</span>}
                  {a.note && <span>📝 {a.note}</span>}
                </div>
              </div>
              <button onClick={()=>elimina(a.id)} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:"0.95rem" }}>✕</button>
            </div>
          ))}

          {/* fatte */}
          {fatte.length > 0 && (
            <>
              <div style={{ color:"#86efac", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.06em", margin:"16px 0 8px" }}>FATTE ({fatte.length})</div>
              {fatte.map(a => (
                <div key={a.id} style={{ display:"flex", alignItems:"flex-start", gap:10, background:"#0f172a", border:"1px solid #1e293b", borderRadius:10, padding:"10px 14px", marginBottom:6 }}>
                  <button onClick={()=>toggleStato(a)} title="Riporta da fare" style={{ width:20, height:20, borderRadius:6, border:"2px solid #3b82f6", background:"#3b82f6", cursor:"pointer", flexShrink:0, marginTop:2, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
                  </button>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:"#64748b", fontSize:"0.9rem", fontWeight:600, textDecoration:"line-through" }}>{a.descrizione}</div>
                  </div>
                  <button onClick={()=>elimina(a.id)} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:"0.95rem" }}>✕</button>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── AREA GESTIONE QUOTIDIANA — Progetti tematici e loro attività ────────────────
const STATI_ATTIVITA = ["DA FARE", "IN CORSO", "FATTO"];
const STATO_STYLE_ATT = {
  "DA FARE": { bg:"#450a0a", color:"#fca5a5" },
  "IN CORSO": { bg:"#422006", color:"#fcd34d" },
  "FATTO": { bg:"#14532d", color:"#86efac" },
};
const COLORI_PROGETTO = ["#3b82f6","#06b6d4","#8b5cf6","#ec4899","#f59e0b","#10b981","#ef4444","#14b8a6"];

function TabProgetti() {
  const [progetti, setProgetti] = useState([]);
  const [attivita, setAttivita] = useState([]); // tutte le attività di tutti i progetti
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState("");
  const [progettoSelezionato, setProgettoSelezionato] = useState(null); // id
  const [nuovoProgettoNome, setNuovoProgettoNome] = useState("");
  const [mostraNuovoProgetto, setMostraNuovoProgetto] = useState(false);
  const [confermaEliminaProgetto, setConfermaEliminaProgetto] = useState(null); // id progetto in conferma

  // form nuova attività
  const [nuovaAtt, setNuovaAtt] = useState({ descrizione:"", scadenza:"", preavviso_giorni:"", note:"" });
  const [salvandoAtt, setSalvandoAtt] = useState(false);

  // vocale
  const apiKey = getStoredApiKey();
  const [modalitaVocale, setModalitaVocale] = useState("generale"); // generale | singolo
  const [registrazione, setRegistrazione] = useState("idle"); // idle | recording | elaborazione | done | errore
  const [erroreVocale, setErroreVocale] = useState("");
  const [riepilogoVocale, setRiepilogoVocale] = useState(null);
  const mediaRecorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);

  // excel su drive
  const [excelStato, setExcelStato] = useState("idle"); // idle | generando | done | errore
  const [excelErrore, setExcelErrore] = useState("");
  const [excelLink, setExcelLink] = useState(null);

  const inp = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", outline:"none", fontSize:"0.88rem", width:"100%" };

  const carica = async () => {
    setCaricamento(true);
    setErrore("");
    try {
      const [pRes, aRes] = await Promise.all([
        supabase.from("progetti").select("*").order("created_at", { ascending:true }),
        supabase.from("progetto_attivita").select("*").order("created_at", { ascending:true }),
      ]);
      if (pRes.error) throw pRes.error;
      if (aRes.error) throw aRes.error;
      setProgetti(pRes.data || []);
      setAttivita(aRes.data || []);
      // se non c'è un progetto selezionato, seleziona il primo
      if (!progettoSelezionato && pRes.data && pRes.data.length > 0) {
        setProgettoSelezionato(pRes.data[0].id);
      }
    } catch (e) {
      setErrore(e.message || "Errore durante il caricamento.");
    } finally {
      setCaricamento(false);
    }
  };

  useEffect(() => { carica(); }, []);

  const creaProgetto = async () => {
    if (!nuovoProgettoNome.trim()) return;
    const colore = COLORI_PROGETTO[progetti.length % COLORI_PROGETTO.length];
    try {
      const { data, error } = await supabase.from("progetti").insert({ nome: nuovoProgettoNome.trim(), colore }).select().single();
      if (error) throw error;
      setProgetti(prev => [...prev, data]);
      setProgettoSelezionato(data.id);
      setNuovoProgettoNome("");
      setMostraNuovoProgetto(false);
    } catch (e) {
      setErrore(e.message || "Errore durante la creazione del progetto.");
    }
  };

  const eliminaProgetto = async (id) => {
    try {
      const { error } = await supabase.from("progetti").delete().eq("id", id);
      if (error) throw error;
      setProgetti(prev => prev.filter(p => p.id !== id));
      setAttivita(prev => prev.filter(a => a.progetto_id !== id));
      setConfermaEliminaProgetto(null);
      if (progettoSelezionato === id) {
        const rimasti = progetti.filter(p => p.id !== id);
        setProgettoSelezionato(rimasti.length > 0 ? rimasti[0].id : null);
      }
    } catch (e) {
      setErrore(e.message || "Errore durante l'eliminazione del progetto.");
    }
  };

  const aggiungiAttivita = async () => {
    if (!nuovaAtt.descrizione.trim() || !progettoSelezionato) return;
    setSalvandoAtt(true);
    try {
      const payload = {
        progetto_id: progettoSelezionato,
        descrizione: nuovaAtt.descrizione.trim(),
        stato: "DA FARE",
        scadenza: nuovaAtt.scadenza || null,
        preavviso_giorni: nuovaAtt.preavviso_giorni ? Number(nuovaAtt.preavviso_giorni) : null,
        note: nuovaAtt.note || null,
      };
      const { data, error } = await supabase.from("progetto_attivita").insert(payload).select().single();
      if (error) throw error;
      setAttivita(prev => [...prev, data]);
      setNuovaAtt({ descrizione:"", scadenza:"", preavviso_giorni:"", note:"" });
    } catch (e) {
      setErrore(e.message || "Errore durante l'aggiunta dell'attività.");
    } finally {
      setSalvandoAtt(false);
    }
  };

  const cambiaStatoAttivita = async (att) => {
    const idx = STATI_ATTIVITA.indexOf(att.stato);
    const nuovoStato = STATI_ATTIVITA[(idx + 1) % STATI_ATTIVITA.length];
    setAttivita(prev => prev.map(a => a.id === att.id ? { ...a, stato: nuovoStato } : a));
    try {
      await supabase.from("progetto_attivita").update({ stato: nuovoStato, updated_at: new Date().toISOString() }).eq("id", att.id);
    } catch (e) {
      setErrore(e.message || "Errore durante l'aggiornamento.");
      carica();
    }
  };

  const eliminaAttivita = async (id) => {
    setAttivita(prev => prev.filter(a => a.id !== id));
    try {
      await supabase.from("progetto_attivita").delete().eq("id", id);
    } catch (e) {
      setErrore(e.message || "Errore durante l'eliminazione.");
      carica();
    }
  };

  // ── EXCEL su Drive: rigenera il file fisso Gestione_Quotidiana.xlsx ──
  // Legge progetti+attività freschi da Supabase, costruisce il workbook e lo
  // sovrascrive nella cartella "GESTIONE QUOTIDIANA" nella root del Drive.
  const rigeneraExcelSuDrive = async () => {
    setExcelStato("generando");
    setExcelErrore("");
    try {
      const XLSX = await loadSheetJS();
      // dati freschi
      const [pRes, aRes] = await Promise.all([
        supabase.from("progetti").select("*").order("created_at", { ascending:true }),
        supabase.from("progetto_attivita").select("*").order("created_at", { ascending:true }),
      ]);
      if (pRes.error) throw pRes.error;
      if (aRes.error) throw aRes.error;
      const prog = pRes.data || [];
      const att = aRes.data || [];

      const wb = XLSX.utils.book_new();
      // Foglio riepilogo: tutte le attività con il progetto di appartenenza
      const righe = [];
      prog.forEach(p => {
        const sue = att.filter(a => a.progetto_id === p.id);
        if (sue.length === 0) {
          righe.push({ Progetto: p.nome, Attività: "(nessuna attività)", Stato: "", Scadenza: "", Note: "" });
        } else {
          sue.forEach(a => righe.push({
            Progetto: p.nome,
            Attività: a.descrizione,
            Stato: a.stato || "",
            Scadenza: a.scadenza ? new Date(a.scadenza).toLocaleDateString("it-IT") : "",
            Note: a.note || "",
          }));
        }
      });
      if (righe.length === 0) righe.push({ Progetto:"(nessun progetto)", Attività:"", Stato:"", Scadenza:"", Note:"" });
      const ws = XLSX.utils.json_to_sheet(righe);
      ws["!cols"] = [{ wch:22 }, { wch:50 }, { wch:12 }, { wch:14 }, { wch:40 }];
      XLSX.utils.book_append_sheet(wb, ws, "Gestione Quotidiana");

      // genera come blob
      const wbArray = XLSX.write(wb, { type:"array", bookType:"xlsx" });
      const blob = new Blob([wbArray], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      // carica/sovrascrivi su Drive nella cartella fissa
      const folderId = await trovaOCreaCartellaRoot("GESTIONE QUOTIDIANA");
      const fileId = await upsertFileFissoSuDrive("Gestione_Quotidiana.xlsx", blob, folderId, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setExcelLink(`https://drive.google.com/file/d/${fileId}/view`);
      setExcelStato("done");
      setTimeout(() => setExcelStato("idle"), 3000);
    } catch (e) {
      setExcelErrore(e.message || "Errore durante la generazione/salvataggio dell'Excel su Drive.");
      setExcelStato("errore");
    }
  };

  // ── VOCALE ──
  const toBase64Blob = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Errore lettura audio"));
    r.readAsDataURL(blob);
  });

  const avviaRegistrazione = async () => {
    setErroreVocale(""); setRiepilogoVocale(null);
    if (!apiKey) { setErroreVocale("Inserisci prima la API Key Gemini (es. nel tab Documenti o Analisi AI)."); setRegistrazione("errore"); return; }
    if (modalitaVocale === "singolo" && !progettoSelezionato) { setErroreVocale("Seleziona un progetto a sinistra per la modalità su singolo progetto."); setRegistrazione("errore"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRegistrazione("recording");
    } catch (e) {
      setErroreVocale("Impossibile accedere al microfono: " + (e.message || "permesso negato.")); setRegistrazione("errore");
    }
  };

  const fermaRegistrazione = () => {
    if (!mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      await elaboraVocale(blob);
    };
    recorder.stop();
    setRegistrazione("elaborazione");
  };

  const elaboraVocale = async (blob) => {
    try {
      const audioB64 = await toBase64Blob(blob);
      const mime = blob.type || "audio/webm";

      // Contesto: progetti esistenti e relative attività (per id)
      const contesto = progetti.map(p => {
        const sue = attivita.filter(a => a.progetto_id === p.id);
        const elenco = sue.map(a => `    - (id:${a.id}) [${a.stato}] ${a.descrizione}`).join("\n") || "    (nessuna attività)";
        return `Progetto "${p.nome}" (id:${p.id}):\n${elenco}`;
      }).join("\n");

      const vincoloModalita = modalitaVocale === "singolo" && progettoSelezionato
        ? `\nIMPORTANTE: l'utente sta parlando SOLO del progetto con id "${progettoSelezionato}". Assegna tutte le nuove attività e gli aggiornamenti a quel progetto, non ad altri.`
        : `\nL'utente può parlare di più progetti diversi nello stesso audio: assegna ogni cosa al progetto giusto in base a ciò che dice. Se nomina un progetto che non esiste tra quelli elencati, crealo.`;

      const promptText = `Sei un assistente che gestisce le attività di gestione quotidiana di un project manager tecnico, organizzate per progetto/tema (es. Cloud, Telefonia, Sicurezza, Chiusure PV, Spagna, UPIM). Ascolta l'audio in italiano e aggiorna progetti e attività.

PROGETTI E ATTIVITÀ ATTUALI:
${contesto || "(nessun progetto ancora)"}
${vincoloModalita}

Regole:
- Se si dice che un'attività esistente è stata completata/fatta/finita, marcala come FATTA (usa il suo id).
- Se si parla di qualcosa di nuovo da fare, crea una nuova attività con descrizione SINTETICA e PROFESSIONALE (non trascrivere parola per parola: riformula in modo pulito e conciso).
- Assegna ogni nuova attività al progetto giusto (per nome). Se il progetto non esiste, indicane il nome in "nuovo_progetto".
- Se viene menzionata una scadenza, includila in formato AAAA-MM-GG.
- Ignora il parlato irrilevante.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza backtick:
{
  "completate": ["idAttività1", "idAttività2"],
  "nuove": [
    { "progetto_id": "id del progetto esistente, oppure stringa vuota se nuovo", "nuovo_progetto": "nome nuovo progetto se non esiste, altrimenti stringa vuota", "descrizione": "testo sintetico", "scadenza": "AAAA-MM-GG o vuoto", "note": "nota breve o vuoto" }
  ]
}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ contents:[{ parts:[{ text: promptText }, { inline_data:{ mime_type: mime, data: audioB64 } }] }] }) }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      let testo = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      testo = testo.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(testo);

      const completate = Array.isArray(parsed.completate) ? parsed.completate : [];
      const nuove = Array.isArray(parsed.nuove) ? parsed.nuove : [];

      // applica completate
      for (const id of completate) {
        await supabase.from("progetto_attivita").update({ stato:"FATTO", updated_at:new Date().toISOString() }).eq("id", id);
      }

      // mappa nome->progetto per creare al volo i progetti nuovi
      let progettiCorrenti = [...progetti];
      const trovaOCreaProgettoPerNome = async (nome) => {
        const esiste = progettiCorrenti.find(p => p.nome.toLowerCase() === nome.toLowerCase());
        if (esiste) return esiste.id;
        const colore = COLORI_PROGETTO[progettiCorrenti.length % COLORI_PROGETTO.length];
        const { data: nuovoP } = await supabase.from("progetti").insert({ nome, colore }).select().single();
        if (nuovoP) { progettiCorrenti.push(nuovoP); return nuovoP.id; }
        return null;
      };

      let contNuove = 0;
      const nomiNuoviProgetti = new Set();
      for (const n of nuove) {
        if (!n.descrizione || !n.descrizione.trim()) continue;
        let pid = n.progetto_id || null;
        if ((!pid || !progettiCorrenti.find(p => p.id === pid)) && n.nuovo_progetto && n.nuovo_progetto.trim()) {
          pid = await trovaOCreaProgettoPerNome(n.nuovo_progetto.trim());
          nomiNuoviProgetti.add(n.nuovo_progetto.trim());
        }
        if (!pid && modalitaVocale === "singolo" && progettoSelezionato) pid = progettoSelezionato;
        if (!pid) continue; // senza progetto non si può inserire
        await supabase.from("progetto_attivita").insert({
          progetto_id: pid,
          descrizione: n.descrizione.trim(),
          stato: "DA FARE",
          scadenza: n.scadenza || null,
          note: n.note || null,
        });
        contNuove++;
      }

      await carica();
      setRiepilogoVocale({ fatte: completate.length, nuove: contNuove, nuoviProgetti: Array.from(nomiNuoviProgetti) });
      setRegistrazione("done");
      setTimeout(() => setRegistrazione("idle"), 500);

      // rigenera l'Excel fisso su Drive con i dati aggiornati
      rigeneraExcelSuDrive();
    } catch (e) {
      setErroreVocale(e.message || "Errore durante l'elaborazione del vocale.");
      setRegistrazione("errore");
    }
  };

  const progettoCorrente = progetti.find(p => p.id === progettoSelezionato);
  const attivitaProgetto = attivita.filter(a => a.progetto_id === progettoSelezionato);
  const contaAttivita = (pid) => attivita.filter(a => a.progetto_id === pid).length;
  const contaDaFare = (pid) => attivita.filter(a => a.progetto_id === pid && a.stato !== "FATTO").length;

  if (caricamento) return <div style={{ color:"#7dd3fc", fontSize:"0.9rem" }}>Caricamento progetti…</div>;

  return (
    <div>
      <div style={{ marginBottom:8, color:"#94a3b8", fontSize:"0.9rem" }}>
        Organizza le attività di gestione quotidiana per progetto/tema (Cloud, Telefonia, Sicurezza, Chiusure PV, Spagna, UPIM…).
      </div>
      {errore && <div style={{ color:"#fca5a5", fontSize:"0.82rem", marginBottom:12, background:"#450a0a22", border:"1px solid #ef444433", borderRadius:8, padding:"8px 12px" }}>{errore}</div>}

      {/* blocco vocale + excel */}
      <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:16, marginBottom:18 }}>
        <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.82rem", marginBottom:10 }}>🎙 AGGIORNA CON UN VOCALE</div>
        <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
          <button onClick={()=>setModalitaVocale("generale")}
            style={{ flex:1, minWidth:180, background: modalitaVocale==="generale"?"#3b82f6":"#0f172a", color: modalitaVocale==="generale"?"#fff":"#94a3b8", border:`1px solid ${modalitaVocale==="generale"?"#3b82f6":"#334155"}`, borderRadius:8, padding:"8px 12px", cursor:"pointer", fontSize:"0.82rem", fontWeight:700 }}>
            🗂 Vocale generale (più progetti)
          </button>
          <button onClick={()=>setModalitaVocale("singolo")}
            style={{ flex:1, minWidth:180, background: modalitaVocale==="singolo"?"#3b82f6":"#0f172a", color: modalitaVocale==="singolo"?"#fff":"#94a3b8", border:`1px solid ${modalitaVocale==="singolo"?"#3b82f6":"#334155"}`, borderRadius:8, padding:"8px 12px", cursor:"pointer", fontSize:"0.82rem", fontWeight:700 }}>
            🎯 Vocale sul progetto selezionato
          </button>
        </div>
        {modalitaVocale==="singolo" && !progettoSelezionato && <div style={{ color:"#fbbf24", fontSize:"0.78rem", marginBottom:8 }}>Seleziona un progetto a sinistra per usare questa modalità.</div>}
        {registrazione !== "recording" ? (
          <button onClick={avviaRegistrazione} disabled={registrazione==="elaborazione"}
            style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", cursor: registrazione==="elaborazione"?"wait":"pointer", fontWeight:700, fontSize:"0.84rem", opacity: registrazione==="elaborazione"?0.6:1 }}>
            {registrazione==="elaborazione" ? "Elaborazione in corso…" : "● Avvia registrazione"}
          </button>
        ) : (
          <button onClick={fermaRegistrazione}
            style={{ background:"#7f1d1d", color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", cursor:"pointer", fontWeight:700, fontSize:"0.84rem" }}>
            ■ Ferma e elabora
          </button>
        )}
        {registrazione==="recording" && <span style={{ color:"#fca5a5", fontSize:"0.82rem", marginLeft:12 }}>🔴 Registrazione in corso… parla pure</span>}
        {erroreVocale && <div style={{ color:"#fca5a5", fontSize:"0.8rem", marginTop:8 }}>{erroreVocale}</div>}
        {riepilogoVocale && (
          <div style={{ color:"#86efac", fontSize:"0.82rem", marginTop:10, background:"#14532d22", border:"1px solid #22c55e33", borderRadius:8, padding:"8px 12px" }}>
            ✓ {riepilogoVocale.fatte} attività segnate come fatte, {riepilogoVocale.nuove} nuove aggiunte{riepilogoVocale.nuoviProgetti?.length>0 ? `, nuovi progetti: ${riepilogoVocale.nuoviProgetti.join(", ")}` : ""}.
          </div>
        )}

        {/* excel su drive */}
        <div style={{ marginTop:14, paddingTop:12, borderTop:"1px solid #334155", display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <button onClick={rigeneraExcelSuDrive} disabled={excelStato==="generando"}
            style={{ background:"#0f172a", color:"#7dd3fc", border:"1px solid #334155", borderRadius:8, padding:"7px 14px", cursor: excelStato==="generando"?"wait":"pointer", fontSize:"0.8rem", fontWeight:700 }}>
            {excelStato==="generando" ? "Aggiornamento Excel…" : "📊 Aggiorna Excel su Drive"}
          </button>
          {excelStato==="done" && <span style={{ color:"#86efac", fontSize:"0.8rem" }}>✓ Salvato su Drive (cartella GESTIONE QUOTIDIANA)</span>}
          {excelLink && <a href={excelLink} target="_blank" rel="noreferrer" style={{ color:"#7dd3fc", fontSize:"0.8rem" }}>Apri il file ↗</a>}
          {excelStato==="errore" && <span style={{ color:"#fca5a5", fontSize:"0.8rem" }}>{excelErrore}</span>}
        </div>
        <div style={{ color:"#475569", fontSize:"0.72rem", marginTop:8 }}>Dopo ogni vocale l'Excel "Gestione_Quotidiana.xlsx" viene riscritto automaticamente nella cartella GESTIONE QUOTIDIANA su Drive.</div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:18 }}>
        {/* colonna progetti */}
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.06em" }}>PROGETTI</span>
            <button onClick={() => setMostraNuovoProgetto(v => !v)} style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:6, padding:"3px 10px", cursor:"pointer", fontSize:"0.78rem", fontWeight:700 }}>+ Nuovo</button>
          </div>

          {mostraNuovoProgetto && (
            <div style={{ marginBottom:10, background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:10 }}>
              <input value={nuovoProgettoNome} onChange={e => setNuovoProgettoNome(e.target.value)} placeholder="Nome progetto (es. Cloud)" style={{ ...inp, marginBottom:8 }} onKeyDown={e => e.key==="Enter" && creaProgetto()} />
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={creaProgetto} style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:"0.78rem", fontWeight:700 }}>Crea</button>
                <button onClick={() => { setMostraNuovoProgetto(false); setNuovoProgettoNome(""); }} style={{ background:"#0f172a", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:"0.78rem" }}>Annulla</button>
              </div>
            </div>
          )}

          {progetti.length === 0 && !mostraNuovoProgetto && (
            <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"12px 14px" }}>Nessun progetto. Creane uno con "+ Nuovo".</div>
          )}

          {progetti.map(p => (
            <div key={p.id}
              onClick={() => setProgettoSelezionato(p.id)}
              style={{ display:"flex", alignItems:"center", gap:10, background: progettoSelezionato===p.id?"#1e3a5f":"#1e293b", border:`1px solid ${progettoSelezionato===p.id?"#3b82f6":"#334155"}`, borderRadius:8, padding:"10px 12px", marginBottom:6, cursor:"pointer" }}>
              <div style={{ width:10, height:10, borderRadius:3, background:p.colore, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:"#e2e8f0", fontSize:"0.88rem", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.nome}</div>
                <div style={{ color:"#64748b", fontSize:"0.72rem" }}>{contaDaFare(p.id)} da fare · {contaAttivita(p.id)} totali</div>
              </div>
            </div>
          ))}
        </div>

        {/* colonna attività del progetto selezionato */}
        <div>
          {!progettoCorrente ? (
            <div style={{ color:"#64748b", fontSize:"0.88rem", background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"20px" }}>Seleziona o crea un progetto per gestire le sue attività.</div>
          ) : (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:14, height:14, borderRadius:4, background:progettoCorrente.colore }} />
                  <span style={{ color:"#f1f5f9", fontSize:"1.05rem", fontWeight:700 }}>{progettoCorrente.nome}</span>
                </div>
                {confermaEliminaProgetto === progettoCorrente.id ? (
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span style={{ color:"#fca5a5", fontSize:"0.78rem" }}>Eliminare il progetto e tutte le sue attività?</span>
                    <button onClick={() => eliminaProgetto(progettoCorrente.id)} style={{ background:"#7f1d1d", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.75rem", fontWeight:700 }}>Sì</button>
                    <button onClick={() => setConfermaEliminaProgetto(null)} style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.75rem" }}>No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfermaEliminaProgetto(progettoCorrente.id)} style={{ background:"none", color:"#fca5a5", border:"1px solid #ef444433", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:"0.75rem", fontWeight:700 }}>🗑 Elimina progetto</button>
                )}
              </div>

              {/* form aggiungi attività */}
              <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:14, marginBottom:16 }}>
                <input value={nuovaAtt.descrizione} onChange={e => setNuovaAtt(v => ({ ...v, descrizione:e.target.value }))} placeholder="Nuova attività…" style={{ ...inp, marginBottom:8 }} />
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                  <div style={{ flex:1, minWidth:140 }}>
                    <label style={{ color:"#64748b", fontSize:"0.72rem", display:"block", marginBottom:2 }}>Scadenza (opzionale)</label>
                    <input type="date" value={nuovaAtt.scadenza} onChange={e => setNuovaAtt(v => ({ ...v, scadenza:e.target.value }))} style={inp} />
                  </div>
                  <div style={{ flex:1, minWidth:140 }}>
                    <label style={{ color:"#64748b", fontSize:"0.72rem", display:"block", marginBottom:2 }}>Preavviso (giorni prima)</label>
                    <input type="number" value={nuovaAtt.preavviso_giorni} onChange={e => setNuovaAtt(v => ({ ...v, preavviso_giorni:e.target.value }))} placeholder="es. 90" style={inp} />
                  </div>
                </div>
                <input value={nuovaAtt.note} onChange={e => setNuovaAtt(v => ({ ...v, note:e.target.value }))} placeholder="Note (opzionale)" style={{ ...inp, marginBottom:8 }} />
                <button onClick={aggiungiAttivita} disabled={salvandoAtt || !nuovaAtt.descrizione.trim()} style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"7px 16px", cursor: nuovaAtt.descrizione.trim()?"pointer":"not-allowed", fontSize:"0.82rem", fontWeight:700, opacity: nuovaAtt.descrizione.trim()?1:0.5 }}>
                  {salvandoAtt ? "Aggiunta…" : "+ Aggiungi attività"}
                </button>
              </div>

              {/* lista attività */}
              {attivitaProgetto.length === 0 ? (
                <div style={{ color:"#64748b", fontSize:"0.85rem" }}>Nessuna attività in questo progetto.</div>
              ) : (
                attivitaProgetto.map(a => {
                  const ss = STATO_STYLE_ATT[a.stato] || STATO_STYLE_ATT["DA FARE"];
                  return (
                    <div key={a.id} style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:10, padding:"12px 14px", marginBottom:7 }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:"#e2e8f0", fontSize:"0.9rem", fontWeight:600, textDecoration: a.stato==="FATTO"?"line-through":"none", marginBottom:4 }}>{a.descrizione}</div>
                          <div style={{ display:"flex", gap:12, flexWrap:"wrap", fontSize:"0.75rem", color:"#64748b" }}>
                            {a.scadenza && <span>📅 {new Date(a.scadenza).toLocaleDateString("it-IT")}</span>}
                            {a.preavviso_giorni && <span>🔔 {a.preavviso_giorni} gg prima</span>}
                            {a.note && <span>📝 {a.note}</span>}
                          </div>
                        </div>
                        <button onClick={() => cambiaStatoAttivita(a)} style={{ background:ss.bg, color:ss.color, border:"none", borderRadius:8, padding:"4px 12px", cursor:"pointer", fontSize:"0.75rem", fontWeight:700, whiteSpace:"nowrap" }}>
                          {a.stato}
                        </button>
                        <button onClick={() => eliminaAttivita(a.id)} style={{ background:"none", color:"#64748b", border:"none", cursor:"pointer", fontSize:"0.95rem" }}>✕</button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── TAB CRONOPROGRAMMA — caricamento e storico versioni per commessa ───────────
function TabCronoprogramma({ commessaIdGlobale, commessaSelezionata }) {
  const commessaId = commessaIdGlobale || "";
  const [versioni, setVersioni] = useState([]);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [uploadStato, setUploadStato] = useState("idle"); // idle | uploading | done | error
  const [uploadErrore, setUploadErrore] = useState("");
  const [notaNuova, setNotaNuova] = useState("");
  const [confermaElimina, setConfermaElimina] = useState(null); // id versione

  const tipoDaNome = (nome) => {
    const n = nome.toLowerCase();
    if (n.endsWith(".pdf")) return "pdf";
    if (n.endsWith(".xls") || n.endsWith(".xlsx") || n.endsWith(".csv")) return "excel";
    if (n.match(/\.(png|jpg|jpeg|gif|webp|bmp)$/)) return "immagine";
    return "altro";
  };
  const iconaTipo = (tipo) => tipo==="pdf" ? "📄" : tipo==="excel" ? "📊" : tipo==="immagine" ? "🖼" : "📎";

  const carica = async () => {
    if (!commessaId) { setVersioni([]); return; }
    setCaricamento(true);
    setErrore("");
    try {
      const { data, error } = await supabase
        .from("cronoprogrammi")
        .select("*")
        .eq("commessa_id", commessaId)
        .order("caricato_il", { ascending:false });
      if (error) throw error;
      setVersioni(data || []);
    } catch (e) {
      setErrore(e.message || "Errore durante il caricamento dello storico.");
    } finally {
      setCaricamento(false);
    }
  };

  useEffect(() => { carica(); }, [commessaId]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permette di ricaricare lo stesso file
    if (!file || !commessaSelezionata) return;
    if (!commessaSelezionata.drive_folder_id) {
      setUploadStato("error");
      setUploadErrore("Questa commessa non ha ancora una cartella Drive. Creala dalla Scheda Negozio.");
      return;
    }
    setUploadStato("uploading");
    setUploadErrore("");
    try {
      // Trova/crea la sottocartella CRONOPROGRAMMA su Drive e carica il file lì
      const idCartella = await trovaIdSottocartellaDaPercorso(commessaSelezionata.drive_folder_id, "CRONOPROGRAMMA");
      const driveFileId = await caricaFileSuDrive(file, idCartella);
      const driveLink = `https://drive.google.com/file/d/${driveFileId}/view`;
      // Registra la versione nello storico su Supabase
      const { data, error } = await supabase.from("cronoprogrammi").insert({
        commessa_id: commessaSelezionata.id,
        nome_file: file.name,
        drive_file_id: driveFileId,
        drive_link: driveLink,
        tipo_file: tipoDaNome(file.name),
        note: notaNuova || null,
      }).select().single();
      if (error) throw error;
      setVersioni(prev => [data, ...prev]);
      setNotaNuova("");
      setUploadStato("done");
      setTimeout(() => setUploadStato("idle"), 2500);
    } catch (e) {
      setUploadStato("error");
      setUploadErrore(e.message || "Errore durante il caricamento del file.");
    }
  };

  const eliminaVersione = async (id) => {
    // Rimuove solo il riferimento dallo storico; il file su Drive resta.
    try {
      const { error } = await supabase.from("cronoprogrammi").delete().eq("id", id);
      if (error) throw error;
      setVersioni(prev => prev.filter(v => v.id !== id));
      setConfermaElimina(null);
    } catch (e) {
      setErrore(e.message || "Errore durante l'eliminazione.");
    }
  };

  return (
    <div>
      <div style={{ marginBottom:8, color:"#94a3b8", fontSize:"0.9rem" }}>
        Carica e consulta il cronoprogramma di cantiere della commessa. Ogni caricamento viene aggiunto allo storico, così tieni traccia di tutte le versioni nel tempo. I file vengono salvati nella cartella CRONOPROGRAMMA su Google Drive.
      </div>

      {/* indicazione commessa attiva */}
      <div style={{ marginBottom:18 }}>
        {!commessaId && <div style={{ color:"#64748b", fontSize:"0.82rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px" }}>Seleziona una commessa dal menu in alto per gestire il cronoprogramma.</div>}
        {commessaId && commessaSelezionata && (
          <div style={{ color:"#7dd3fc", fontSize:"0.82rem", background:"#0c3547", border:"1px solid #1e3a5f", borderRadius:8, padding:"10px 14px" }}>📁 Commessa attiva: <strong>{commessaSelezionata.nome}</strong></div>
        )}
        {commessaId && commessaSelezionata && !commessaSelezionata.drive_folder_id && (
          <div style={{ color:"#fbbf24", fontSize:"0.75rem", marginTop:6 }}>⚠ Questa commessa non ha ancora una cartella Drive. Creala dalla Scheda Negozio prima di caricare.</div>
        )}
      </div>

      {commessaId && (
        <>
          {/* upload nuova versione */}
          <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:16, marginBottom:20 }}>
            <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"0.82rem", marginBottom:10 }}>📅 CARICA NUOVA VERSIONE DEL CRONOPROGRAMMA</div>
            <input value={notaNuova} onChange={e=>setNotaNuova(e.target.value)} placeholder="Nota sulla versione (opzionale, es. 'rev. 2 post sopralluogo')" style={{ background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.85rem", marginBottom:10 }} />
            <label style={{ display:"inline-block", background: uploadStato==="uploading"?"#475569":"#1d4ed8", color:"#fff", borderRadius:8, padding:"8px 16px", cursor: uploadStato==="uploading"?"wait":"pointer", fontWeight:700, fontSize:"0.82rem" }}>
              {uploadStato==="uploading" ? "Caricamento su Drive…" : "Scegli file (PDF, Excel, immagine)"}
              <input type="file" accept=".pdf,.xls,.xlsx,.csv,image/*" onChange={handleFile} style={{ display:"none" }} disabled={uploadStato==="uploading" || !commessaSelezionata?.drive_folder_id} />
            </label>
            {uploadStato==="done" && <div style={{ color:"#86efac", fontSize:"0.8rem", marginTop:8 }}>✓ Versione caricata e aggiunta allo storico.</div>}
            {uploadStato==="error" && <div style={{ color:"#fca5a5", fontSize:"0.8rem", marginTop:8 }}>{uploadErrore}</div>}
          </div>

          {/* storico versioni */}
          <div style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.06em", marginBottom:10 }}>STORICO VERSIONI</div>
          {caricamento && <div style={{ color:"#7dd3fc", fontSize:"0.82rem" }}>Caricamento storico…</div>}
          {errore && <div style={{ color:"#fca5a5", fontSize:"0.82rem", marginBottom:10 }}>{errore}</div>}
          {!caricamento && versioni.length===0 && <div style={{ color:"#64748b", fontSize:"0.85rem", background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"12px 14px" }}>Nessun cronoprogramma caricato per questa commessa.</div>}

          {versioni.map((v, idx) => (
            <div key={v.id} style={{ display:"flex", alignItems:"center", gap:12, background:"#1e293b", border:`1px solid ${idx===0?"#3b82f6":"#334155"}`, borderRadius:10, padding:"12px 14px", marginBottom:7 }}>
              <div style={{ fontSize:"1.4rem" }}>{iconaTipo(v.tipo_file)}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:"#e2e8f0", fontWeight:600, fontSize:"0.9rem", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v.nome_file}</span>
                  {idx===0 && <span style={{ background:"#1e3a5f", color:"#7dd3fc", fontSize:"0.68rem", fontWeight:700, padding:"2px 8px", borderRadius:99 }}>PIÙ RECENTE</span>}
                </div>
                <div style={{ color:"#64748b", fontSize:"0.75rem", marginTop:2 }}>
                  {new Date(v.caricato_il).toLocaleString("it-IT")}{v.note ? ` — ${v.note}` : ""}
                </div>
              </div>
              {v.drive_link && (
                <a href={v.drive_link} target="_blank" rel="noopener noreferrer" style={{ background:"#0f172a", color:"#7dd3fc", border:"1px solid #334155", borderRadius:6, padding:"5px 12px", fontSize:"0.78rem", fontWeight:700, textDecoration:"none", whiteSpace:"nowrap" }}>
                  Apri ↗
                </a>
              )}
              {confermaElimina === v.id ? (
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <button onClick={()=>eliminaVersione(v.id)} style={{ background:"#7f1d1d", color:"#fff", border:"none", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:"0.75rem", fontWeight:700 }}>Elimina</button>
                  <button onClick={()=>setConfermaElimina(null)} style={{ background:"#0f172a", color:"#94a3b8", border:"1px solid #334155", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:"0.75rem" }}>Annulla</button>
                </div>
              ) : (
                <button onClick={()=>setConfermaElimina(v.id)} title="Rimuovi dallo storico (il file su Drive resta)" style={{ background:"none", color:"#64748b", border:"none", cursor:"pointer", fontSize:"0.95rem" }}>✕</button>
              )}
            </div>
          ))}
          {versioni.length>0 && <div style={{ color:"#475569", fontSize:"0.72rem", marginTop:8 }}>La ✕ rimuove la versione solo dallo storico nell'app; il file rimane su Google Drive nella cartella CRONOPROGRAMMA.</div>}
        </>
      )}
    </div>
  );
}

const TABS_APERTURE = [
  { id:"scheda",   label:"📋 Scheda Negozio" },
  { id:"workflow", label:"✅ Workflow" },
  { id:"pratiche", label:"📂 Pratiche Amm." },
  { id:"budget",   label:"💶 Budget HP INV" },
  { id:"attivita", label:"🗒 Attività" },
  { id:"crono",    label:"📅 Cronoprogramma" },
  { id:"ai",       label:"🤖 Analisi AI" },
  { id:"documenti",label:"📁 Documenti" },
];

const TABS_GESTIONE = [
  { id:"progetti", label:"🗂 Progetti & Attività" },
];

// Primo tab di ciascuna area, usato quando si cambia interruttore
const TAB_DEFAULT = { aperture:"workflow", gestione:"progetti" };

export default function App() {
  const [area, setArea] = useState("aperture"); // aperture | gestione
  const [tab, setTab] = useState("workflow");
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Cambia area (Aperture/Gestione) e porta al primo tab di quell'area
  const cambiaArea = (nuovaArea) => {
    setArea(nuovaArea);
    setTab(TAB_DEFAULT[nuovaArea]);
  };

  // Commessa selezionata, condivisa da tutti i tab tramite il selettore unico
  // nell'header: cambiando tab la selezione resta la stessa.
  const [commessaIdGlobale, setCommessaIdGlobale] = useState(null);
  const [commesseGlobali, setCommesseGlobali] = useState([]);
  const [caricamentoCommesseGlobali, setCaricamentoCommesseGlobali] = useState(true);
  const [filtroBrandGlobale, setFiltroBrandGlobale] = useState("TUTTI");
  const [filtroTipoGlobale, setFiltroTipoGlobale] = useState("TUTTI"); // TUTTI | apertura | ristrutturazione

  const caricaCommesseGlobali = async () => {
    setCaricamentoCommesseGlobali(true);
    const { data, error } = await supabase.from("commesse").select("*").order("created_at", { ascending:false });
    if (!error && data) setCommesseGlobali(data);
    setCaricamentoCommesseGlobali(false);
  };

  useEffect(() => { caricaCommesseGlobali(); }, []);

  const commesseFiltrateGlobali = commesseGlobali.filter(c => {
    const okBrand = filtroBrandGlobale === "TUTTI" || c.brand === filtroBrandGlobale;
    const tipoCommessa = c.tipo || "apertura"; // le commesse senza tipo sono aperture
    const okTipo = filtroTipoGlobale === "TUTTI" || tipoCommessa === filtroTipoGlobale;
    return okBrand && okTipo;
  });
  const commessaSelezionataGlobale = commesseGlobali.find(c => c.id === commessaIdGlobale);

  // Selezionare "+ Nuova commessa" dal menu in alto azzera la selezione e
  // porta dritti alla Scheda Negozio, pronta per compilare una commessa nuova.
  const selezionaNuovaCommessa = () => {
    setCommessaIdGlobale(null);
    setTab("scheda");
  };

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

  // Stato connessione Google Drive: true se c'è un token valido in cache.
  const [driveConnesso, setDriveConnesso] = useState(() => !!getStoredDriveToken());
  const [driveConnessione, setDriveConnessione] = useState("idle"); // idle | connecting | error
  const [driveConnErrore, setDriveConnErrore] = useState("");

  // Mantiene il pulsante allineato allo stato reale del token: se scade o
  // viene rimosso (es. dopo un 401), torna a mostrare "Connetti Drive".
  useEffect(() => {
    const id = setInterval(() => {
      setDriveConnesso(!!getStoredDriveToken());
    }, 10000);
    return () => clearInterval(id);
  }, []);

  // Connessione esplicita a Google Drive, innescata dal click sul pulsante:
  // così il popup di autorizzazione Google nasce da un'azione diretta
  // dell'utente e non viene bloccato dal browser. Dopo, il token resta in
  // cache e gli upload (anche automatici) funzionano senza altri popup.
  const connettiDrive = async () => {
    setDriveConnessione("connecting");
    setDriveConnErrore("");
    try {
      clearStoredDriveToken();           // forza una nuova autorizzazione pulita
      await richiediTokenDrive();        // apre il popup Google (da click utente)
      setDriveConnesso(true);
      setDriveConnessione("idle");
    } catch (e) {
      setDriveConnesso(false);
      setDriveConnessione("error");
      setDriveConnErrore(e.message || "Connessione a Google Drive non riuscita.");
    }
  };

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
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={connettiDrive} disabled={driveConnessione==="connecting"}
              title={driveConnesso ? "Google Drive collegato" : "Collega Google Drive per archiviare i documenti"}
              style={{ background: driveConnesso ? "#14532d" : "#1e293b", color: driveConnesso ? "#86efac" : "#fbbf24", border:`1px solid ${driveConnesso ? "#22c55e55" : "#92400e"}`, borderRadius:8, padding:"6px 14px", cursor: driveConnessione==="connecting" ? "wait" : "pointer", fontSize:"0.78rem", fontWeight:700 }}>
              {driveConnessione==="connecting" ? "Connessione…" : (driveConnesso ? "✓ Drive collegato" : "🔗 Connetti Drive")}
            </button>
            <button onClick={handleLogout} style={{ background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:"0.78rem" }}>
              🚪 Esci
            </button>
          </div>
          </div>

          {!driveConnesso && (
            <div style={{ background:"#422006", border:"1px solid #92400e", borderRadius:8, padding:"8px 14px", marginBottom:14, color:"#fbbf24", fontSize:"0.8rem" }}>
              ⚠ Google Drive non collegato. Clicca <strong>🔗 Connetti Drive</strong> in alto a destra per poter archiviare i documenti. Va fatto una volta per sessione/dispositivo.
            </div>
          )}
          {driveConnessione==="error" && (
            <div style={{ background:"#450a0a", border:"1px solid #ef4444", borderRadius:8, padding:"8px 14px", marginBottom:14, color:"#fca5a5", fontSize:"0.8rem" }}>{driveConnErrore}</div>
          )}

          {/* interruttore tra le due aree */}
          <div style={{ display:"flex", gap:6, marginBottom:16 }}>
            <button onClick={() => cambiaArea("aperture")}
              style={{ flex:1, background: area==="aperture"?"linear-gradient(135deg,#3b82f6,#06b6d4)":"#0f172a", color: area==="aperture"?"#fff":"#94a3b8", border:`1px solid ${area==="aperture"?"#3b82f6":"#334155"}`, borderRadius:10, padding:"10px 16px", cursor:"pointer", fontSize:"0.88rem", fontWeight:700, transition:"all 0.15s" }}>
              🏗 Aperture & Ristrutturazioni
            </button>
            <button onClick={() => cambiaArea("gestione")}
              style={{ flex:1, background: area==="gestione"?"linear-gradient(135deg,#3b82f6,#06b6d4)":"#0f172a", color: area==="gestione"?"#fff":"#94a3b8", border:`1px solid ${area==="gestione"?"#3b82f6":"#334155"}`, borderRadius:10, padding:"10px 16px", cursor:"pointer", fontSize:"0.88rem", fontWeight:700, transition:"all 0.15s" }}>
              📋 Gestione Quotidiana
            </button>
          </div>

          {/* selettore globale tipo + brand + commessa: solo nell'area Aperture */}
          {area==="aperture" && (
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <select
              value={filtroTipoGlobale}
              onChange={e => { setFiltroTipoGlobale(e.target.value); setCommessaIdGlobale(null); }}
              style={{ background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"7px 12px", outline:"none", fontSize:"0.85rem", cursor:"pointer" }}
            >
              <option value="TUTTI">Aperture e Ristrutturazioni</option>
              <option value="apertura">Aperture</option>
              <option value="ristrutturazione">Ristrutturazioni</option>
            </select>
            <select
              value={filtroBrandGlobale}
              onChange={e => setFiltroBrandGlobale(e.target.value)}
              style={{ background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"7px 12px", outline:"none", fontSize:"0.85rem", cursor:"pointer" }}
            >
              <option value="TUTTI">Tutti i brand</option>
              {BRAND_LIST.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={commessaIdGlobale || ""}
              onChange={e => { if (e.target.value === "__nuova__") selezionaNuovaCommessa(); else setCommessaIdGlobale(e.target.value || null); }}
              style={{ background:"#0f172a", color:"#e2e8f0", border:"1px solid #3b82f6", borderRadius:8, padding:"7px 12px", outline:"none", fontSize:"0.85rem", cursor:"pointer", flex:1, minWidth:200, fontWeight:600 }}
            >
              <option value="">Seleziona commessa…</option>
              <option value="__nuova__">➕ Nuova commessa</option>
              {commesseFiltrateGlobali.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          )}
          {area==="aperture" && caricamentoCommesseGlobali && <div style={{ color:"#475569", fontSize:"0.72rem", marginTop:-10, marginBottom:10 }}>Caricamento commesse…</div>}

          <div style={{ display:"flex", gap:2, overflowX:"auto" }}>
            {(area==="aperture" ? TABS_APERTURE : TABS_GESTIONE).map(t=>(
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
        {tab==="scheda"   && <TabScheda commessaIdGlobale={commessaIdGlobale} onCambiaCommessa={setCommessaIdGlobale} commesse={commesseGlobali} onCommessaSalvata={caricaCommesseGlobali} tipoDefault={filtroTipoGlobale === "ristrutturazione" ? "ristrutturazione" : "apertura"} />}
        {tab==="workflow" && <TabWorkflow commessaIdGlobale={commessaIdGlobale} commesse={commesseFiltrateGlobali} commessaSelezionata={commessaSelezionataGlobale} />}
        {tab==="pratiche" && <TabPratiche commessaIdGlobale={commessaIdGlobale} commesse={commesseFiltrateGlobali} commessaSelezionata={commessaSelezionataGlobale} />}
        {tab==="budget"   && <TabBudget commessaIdGlobale={commessaIdGlobale} commesse={commesseFiltrateGlobali} commessaSelezionata={commessaSelezionataGlobale} />}
        {tab==="crono"    && <TabCronoprogramma commessaIdGlobale={commessaIdGlobale} commessaSelezionata={commessaSelezionataGlobale} />}
        {tab==="attivita" && <TabAttivitaCommessa commessaIdGlobale={commessaIdGlobale} commessaSelezionata={commessaSelezionataGlobale} />}
        {tab==="ai"       && <TabAnalisiAI />}
        {tab==="documenti"&& <TabDocumenti commessaIdGlobale={commessaIdGlobale} commesse={commesseFiltrateGlobali} commessaSelezionata={commessaSelezionataGlobale} />}
        {tab==="progetti" && <TabProgetti />}
      </div>
    </div>
  );
}

// ── LOGIN COMPONENT ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  // Pre-compila l'email con l'ultima usata (salvata nel browser dopo un login
  // riuscito). La password non viene mai memorizzata.
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem("ovs_ultima_email") || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetInviato, setResetInviato] = useState(false); // mostra conferma invio mail
  const [resetLoading, setResetLoading] = useState(false);
  const [infoMsg, setInfoMsg] = useState("");

  const handleLogin = async () => {
    if (!email || !password) { setError("Inserisci email e password."); return; }
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError("Credenziali non valide. Riprova.");
    else {
      try { localStorage.setItem("ovs_ultima_email", email); } catch {}
      onLogin();
    }
    setLoading(false);
  };

  // Invia la mail di reset password tramite Supabase. L'utente riceve un link
  // per impostare una nuova password. Richiede solo l'email.
  const handleResetPassword = async () => {
    setError(""); setInfoMsg("");
    if (!email) { setError("Inserisci prima la tua email qui sopra, poi premi di nuovo \"Password dimenticata?\"."); return; }
    setResetLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setResetLoading(false);
    if (err) {
      setError("Non è stato possibile inviare la mail di reset. Controlla l'email e riprova.");
    } else {
      setResetInviato(true);
      setInfoMsg(`Se l'email ${email} è registrata, riceverai un messaggio con il link per reimpostare la password. Controlla anche la cartella spam.`);
    }
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
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" style={inp} autoFocus={!!email} onKeyDown={e=>e.key==="Enter"&&handleLogin()} />
        </div>

        {error && <div style={{ background:"#450a0a", border:"1px solid #ef4444", borderRadius:8, padding:"8px 12px", marginBottom:14, color:"#fca5a5", fontSize:"0.82rem" }}>{error}</div>}
        {infoMsg && <div style={{ background:"#14532d22", border:"1px solid #22c55e55", borderRadius:8, padding:"8px 12px", marginBottom:14, color:"#86efac", fontSize:"0.82rem" }}>{infoMsg}</div>}

        <button onClick={handleLogin} disabled={loading}
          style={{ width:"100%", background: loading?"#1e293b":"linear-gradient(135deg,#3b82f6,#06b6d4)", color: loading?"#475569":"#fff", border:"none", borderRadius:10, padding:"12px", fontWeight:700, fontSize:"0.95rem", cursor: loading?"not-allowed":"pointer" }}>
          {loading ? "Accesso in corso…" : "Accedi"}
        </button>

        <div style={{ textAlign:"center", marginTop:14 }}>
          <button onClick={handleResetPassword} disabled={resetLoading}
            style={{ background:"none", border:"none", color:"#7dd3fc", fontSize:"0.82rem", cursor: resetLoading?"wait":"pointer", textDecoration:"underline" }}>
            {resetLoading ? "Invio in corso…" : (resetInviato ? "Invia di nuovo il link" : "Password dimenticata?")}
          </button>
        </div>

        <div style={{ color:"#475569", fontSize:"0.75rem", textAlign:"center", marginTop:16 }}>
          Accesso riservato al personale autorizzato OVS
        </div>
      </div>
    </div>
  );
}
