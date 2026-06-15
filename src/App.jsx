import React, { useState, useMemo } from "react";

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

function TabWorkflow() {
  const [faseFiltro, setFaseFiltro] = useState("TUTTE");
  const [stati, setStati] = useState(() => Object.fromEntries(WORKFLOW.map(w => [w.id, false])));
  const [searchQ, setSearchQ] = useState("");

  const filtered = WORKFLOW.filter(w =>
    (faseFiltro === "TUTTE" || w.fase === faseFiltro) &&
    (w.titolo.toLowerCase().includes(searchQ.toLowerCase()) || w.da.toLowerCase().includes(searchQ.toLowerCase()) || w.a.toLowerCase().includes(searchQ.toLowerCase()))
  );

  const completati = Object.values(stati).filter(Boolean).length;
  const pct = Math.round((completati / WORKFLOW.length) * 100);

  const toggle = (id) => setStati(s => ({ ...s, [id]: !s[id] }));

  return (
    <div>
      {/* progress bar */}
      <div style={{ marginBottom:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ color:"#94a3b8", fontSize:"0.85rem" }}>Avanzamento complessivo</span>
          <span style={{ color:"#e2e8f0", fontWeight:700 }}>{completati} / {WORKFLOW.length} attività — {pct}%</span>
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
        const doneInFase = items.filter(w => stati[w.id]).length;
        return (
          <div key={fase} style={{ marginBottom:24 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
              <div style={{ height:2, flex:1, background:"#334155" }} />
              <span style={{ color:"#7dd3fc", fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.08em", whiteSpace:"nowrap" }}>{fase}</span>
              <span style={{ color:"#475569", fontSize:"0.75rem" }}>{doneInFase}/{items.length}</span>
              <div style={{ height:2, flex:1, background:"#334155" }} />
            </div>
            {items.map(w => (
              <div key={w.id} onClick={()=>toggle(w.id)}
                style={{ display:"flex", alignItems:"flex-start", gap:12, background: stati[w.id]?"#0f172a":"#1e293b", border:`1px solid ${stati[w.id]?"#1d4ed8":"#334155"}`, borderRadius:10, padding:"12px 14px", marginBottom:6, cursor:"pointer", transition:"border-color 0.2s, background 0.2s" }}>
                {/* checkbox */}
                <div style={{ width:20, height:20, borderRadius:6, border:`2px solid ${stati[w.id]?"#3b82f6":"#475569"}`, background:stati[w.id]?"#3b82f6":"transparent", flexShrink:0, marginTop:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {stati[w.id] && <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                    <span style={{ color: stati[w.id]?"#64748b":"#e2e8f0", fontWeight:600, fontSize:"0.9rem", textDecoration:stati[w.id]?"line-through":"none" }}>{w.titolo}</span>
                    <Badge tipo={w.tipo} />
                  </div>
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap", fontSize:"0.78rem", color:"#64748b" }}>
                    {w.da && <span>📤 {w.da}</span>}
                    {w.a  && <span>📥 {w.a}</span>}
                    {w.automazione && <span style={{ color:"#475569" }}>⚡ {w.automazione}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function TabPratiche() {
  const [stati, setStati] = useState(() => Object.fromEntries(PRATICHE.map((p,i) => [i, "—"])));
  const [filtroP, setFiltroP] = useState("TUTTE");

  const cats = [...new Set(PRATICHE.map(p=>p.categoria))];
  const pctSi = Math.round((Object.values(stati).filter(v=>v==="SI").length / PRATICHE.length)*100);

  const cycle = (i) => setStati(s => ({ ...s, [i]: s[i]==="—"?"SI":s[i]==="SI"?"NO":s[i]==="NO"?"NP":"—" }));
  const STATUS_STYLE = { "SI":{ bg:"#14532d", color:"#86efac" }, "NO":{ bg:"#450a0a", color:"#fca5a5" }, "NP":{ bg:"#1e293b", color:"#7dd3fc" }, "—":{ bg:"#0f172a", color:"#475569" } };

  return (
    <div>
      <div style={{ display:"flex", gap:16, marginBottom:20, flexWrap:"wrap" }}>
        {["TUTTE","ASSOLUTA","ALTA","MEDIA","BASSA"].map(f=>(
          <button key={f} onClick={()=>setFiltroP(f)}
            style={{ background:filtroP===f?"#1d4ed8":"#1e293b", color:filtroP===f?"#fff":"#94a3b8", border:`1px solid ${filtroP===f?"#3b82f6":"#334155"}`, borderRadius:8, padding:"5px 12px", fontSize:"0.78rem", cursor:"pointer" }}>
            {f}
          </button>
        ))}
        <span style={{ marginLeft:"auto", color:"#94a3b8", fontSize:"0.85rem", alignSelf:"center" }}>
          ✅ {Object.values(stati).filter(v=>v==="SI").length} / {PRATICHE.length} — {pctSi}%
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
              const s = stati[idx];
              const ss = STATUS_STYLE[s];
              return (
                <div key={idx} style={{ display:"flex", alignItems:"center", gap:12, background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", marginBottom:5 }}>
                  <PrioritaBadge p={p.priorita} />
                  <span style={{ flex:1, color:"#cbd5e1", fontSize:"0.88rem" }}>{p.voce}</span>
                  <button onClick={()=>cycle(idx)}
                    style={{ background:ss.bg, color:ss.color, border:"none", borderRadius:8, padding:"4px 14px", fontWeight:700, fontSize:"0.8rem", cursor:"pointer", minWidth:44 }}>
                    {s}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      <p style={{ color:"#475569", fontSize:"0.78rem", marginTop:8 }}>Clicca sul pulsante per ciclare: — → SI → NO → NP</p>
    </div>
  );
}

function TabBudget() {
  const [mqVendita, setMqVendita] = useState(0);
  const [valori, setValori] = useState(() => Object.fromEntries(BUDGET_VOCI.map(v=>v.n).map(n=>[n, { std:0, extra:0 }])));

  const setVal = (n, campo, v) => setValori(prev=>({ ...prev, [n]:{ ...prev[n], [campo]: Number(v)||0 } }));

  const cats = [...new Set(BUDGET_VOCI.map(v=>v.categoria))];

  const totale = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.std||0) + (valori[v.n]?.extra||0), 0);
  const totaleStd = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.std||0), 0);
  const totaleExtra = BUDGET_VOCI.reduce((acc,v)=>acc + (valori[v.n]?.extra||0), 0);

  const inputStyle = { background:"#0f172a", color:"#e2e8f0", border:"1px solid #334155", borderRadius:6, padding:"5px 8px", width:110, textAlign:"right", fontSize:"0.82rem", outline:"none" };

  return (
    <div>
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
    </div>
  );
}

function TabScheda() {
  const [form, setForm] = useState({ nome:"", brand:"OVS", responsabile:"", tecnico:"", periodo:"", indirizzo:"", citta:"", mq:0, note:"" });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const inpStyle = { background:"#1e293b", color:"#e2e8f0", border:"1px solid #334155", borderRadius:8, padding:"8px 12px", width:"100%", outline:"none", fontSize:"0.9rem" };
  return (
    <div style={{ maxWidth:620 }}>
      <div style={{ color:"#64748b", fontSize:"0.82rem", marginBottom:18 }}>Compila la scheda del nuovo negozio. I dati saranno visibili nel pannello di riepilogo.</div>
      {[
        { label:"Nome negozio / ID commessa", key:"nome" },
        { label:"Brand", key:"brand", type:"select", opts:["OVS","UPIM"] },
        { label:"Responsabile commessa", key:"responsabile" },
        { label:"Tecnico", key:"tecnico" },
        { label:"Periodo (es. 1° 2025)", key:"periodo" },
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
      <div style={{ marginBottom:14 }}>
        <label style={{ color:"#94a3b8", fontSize:"0.78rem", display:"block", marginBottom:4 }}>Note / Peculiarità</label>
        <textarea value={form.note} onChange={e=>set("note",e.target.value)} rows={3} style={{ ...inpStyle, resize:"vertical" }} />
      </div>

      {/* riepilogo */}
      {form.nome && (
        <div style={{ background:"#0f172a", border:"1px solid #1e3a5f", borderRadius:12, padding:18, marginTop:8 }}>
          <div style={{ color:"#7dd3fc", fontWeight:700, fontSize:"1rem", marginBottom:10 }}>📋 Scheda negozio</div>
          {[["Brand", form.brand],["Commessa",form.nome],["Responsabile",form.responsabile],["Tecnico",form.tecnico],["Periodo",form.periodo],["Indirizzo",`${form.indirizzo}${form.citta?" – "+form.citta:""}`],["MQ vendita",form.mq?form.mq+" mq":""]].filter(([,v])=>v).map(([k,v])=>(
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

// ── TAB ANALISI AI ────────────────────────────────────────────────────────────

const TIPI_ANALISI = [
  { id:"sopralluogo",  label:"📸 Foto sopralluogo",       prompt:"Sei un esperto tecnico edile. Analizza queste foto di un sopralluogo iniziale per un punto vendita retail. Fornisci un report strutturato con: 1) STATO DEI LOCALI (condizioni generali, criticità visibili), 2) INTERVENTI NECESSARI (elenca per categoria: strutturale, impiantistico, estetico), 3) PUNTI DI ATTENZIONE (eventuali problemi che richiedono approfondimento), 4) NOTE PER IL PROGETTISTA. Sii preciso e tecnico." },
  { id:"cantiere",     label:"🏗 Foto cantiere",           prompt:"Sei un direttore lavori esperto. Analizza queste foto di avanzamento cantiere per un punto vendita retail. Fornisci un report con: 1) STATO AVANZAMENTO LAVORI (cosa è completato, cosa è in corso), 2) CONFORMITÀ AL PROGETTO (eventuali difformità visibili), 3) CRITICITÀ RISCONTRATE (problemi, ritardi, non conformità), 4) AZIONI RICHIESTE (cosa deve essere fatto prima della prossima visita), 5) VALUTAZIONE GENERALE (percentuale stimata di completamento)." },
  { id:"documento",    label:"📄 Documento tecnico",       prompt:"Sei un tecnico esperto in edilizia commerciale. Analizza questo documento tecnico relativo a un punto vendita retail. Fornisci: 1) TIPOLOGIA DOCUMENTO (cosa è e a cosa serve), 2) CONTENUTO PRINCIPALE (riassunto dei punti chiave), 3) DATI IMPORTANTI (misure, costi, date, nomi rilevanti), 4) AZIONI RICHIESTE (cosa bisogna fare in seguito a questo documento), 5) DOCUMENTI CORRELATI (quali altri documenti potrebbero essere necessari)." },
  { id:"preventivo",   label:"💶 Preventivo fornitore",    prompt:"Sei un esperto di gestione commesse edili retail. Analizza questo preventivo. Fornisci: 1) RIEPILOGO ECONOMICO (importo totale, suddivisione per categoria), 2) VOCI PRINCIPALI (le 5 voci di costo più significative), 3) VALUTAZIONE (il preventivo sembra congruo per un punto vendita retail? Cosa sembra fuori mercato?), 4) PUNTI DA NEGOZIARE (voci su cui è possibile trattare), 5) ELEMENTI MANCANTI (cosa non è incluso e potrebbe generare extra costi)." },
  { id:"verbale",      label:"📝 Verbale riunione",        prompt:"Sei un project manager esperto. Analizza questo verbale di riunione di cantiere. Fornisci: 1) PRESENTI (chi era alla riunione), 2) DECISIONI PRESE (elenco delle decisioni formali), 3) AZIONI ASSEGNATE (chi deve fare cosa e entro quando), 4) PROBLEMI APERTI (questioni non risolte), 5) PROSSIMI STEP (cosa succede prima della prossima riunione)." },
];

function TabAnalisiAI() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
          <button onClick={() => setApiKeySaved(true)}
            style={{ background: apiKeySaved?"#14532d":"#1d4ed8", color: apiKeySaved?"#86efac":"#fff", border:"none", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontWeight:700, fontSize:"0.82rem", whiteSpace:"nowrap" }}>
            {apiKeySaved ? "✓ Salvata" : "Salva"}
          </button>
        </div>
        {!apiKeySaved && <div style={{ color:"#475569", fontSize:"0.75rem", marginTop:6 }}>Ottieni la chiave gratuita su aistudio.google.com → Get API Key</div>}
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

const TABS = [
  { id:"scheda",   label:"📋 Scheda Negozio" },
  { id:"workflow", label:"✅ Workflow" },
  { id:"pratiche", label:"📂 Pratiche Amm." },
  { id:"budget",   label:"💶 Budget HP INV" },
  { id:"ai",       label:"🤖 Analisi AI" },
  { id:"pdf",      label:"📝 Editor PDF" },
];

export default function App() {
  const [tab, setTab] = useState("workflow");

  // carica PDF.js da CDN
  React.useEffect(() => {
    if (!window.pdfjsLib) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      document.head.appendChild(script);
    }
  }, []);

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
        {tab==="scheda"   && <TabScheda />}
        {tab==="workflow" && <TabWorkflow />}
        {tab==="pratiche" && <TabPratiche />}
        {tab==="budget"   && <TabBudget />}
        {tab==="ai"       && <TabAnalisiAI />}
        {tab==="pdf"      && <TabEditorPDF />}
      </div>
    </div>
  );
}
