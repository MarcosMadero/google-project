// ---------------------------------------------------------------
// Conexión con Google Calendar y Gmail, todo del lado del cliente.
// El CLIENT_ID es público por diseño: lo que protege la cuenta es la
// lista de orígenes autorizados en Google Cloud, no ocultar este valor.
// ---------------------------------------------------------------

const CLIENT_ID = "575020844712-akvtdbqa8ptptovfqkav9g7uh58j6c28.apps.googleusercontent.com";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly"
].join(" ");

const STORE = "gbrief.token";

let tokenClient = null;
let token = null;

// ---------- guardado del token (dura 1 hora) ----------
function saveToken(t, expiresIn){
  token = { value: t, exp: Date.now() + (expiresIn - 60) * 1000 };
  try{ localStorage.setItem(STORE, JSON.stringify(token)); }catch(e){}
}
function loadToken(){
  try{
    const raw = localStorage.getItem(STORE);
    if(!raw) return null;
    const t = JSON.parse(raw);
    return t.exp > Date.now() ? t : null;
  }catch(e){ return null; }
}
function clearToken(){
  token = null;
  try{ localStorage.removeItem(STORE); }catch(e){}
}

// ---------- arranque ----------
function init(){
  token = loadToken();
  if(!window.google?.accounts?.oauth2) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {}          // se reemplaza en cada pedido
  });
  return true;
}

function isConnected(){
  if(!token) token = loadToken();
  return !!token;
}

// prompt "" intenta renovar en silencio; "consent" muestra la pantalla
function getToken(mode){
  return new Promise((resolve, reject) => {
    if(!tokenClient) return reject(new Error("Google no cargó"));
    tokenClient.callback = (res) => {
      if(res.error) return reject(new Error(res.error));
      saveToken(res.access_token, res.expires_in || 3600);
      resolve(token.value);
    };
    tokenClient.requestAccessToken({ prompt: mode });
  });
}

// Pedido explícito del usuario: muestra la pantalla de permisos
const connect = () => getToken("consent");

// Renueva solo; si Google necesita que el usuario intervenga, avisa
async function ensure(){
  if(isConnected()) return token.value;
  return getToken("");
}

const disconnect = () => clearToken();

// ---------- llamadas a la API ----------
async function api(url){
  const t = await ensure();
  const r = await fetch(url, { headers: { Authorization: "Bearer " + t } });
  if(r.status === 401){ clearToken(); throw new Error("Sesión vencida"); }
  if(!r.ok) throw new Error("Google respondió " + r.status);
  return r.json();
}

const pad = n => String(n).padStart(2, "0");

// ---------- agenda del día ----------
async function fetchAgenda(){
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);

  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    + "?timeMin=" + encodeURIComponent(start.toISOString())
    + "&timeMax=" + encodeURIComponent(end.toISOString())
    + "&singleEvents=true&orderBy=startTime&maxResults=12";

  const d = await api(url);
  return (d.items || [])
    .filter(e => e.status !== "cancelled")
    .map(e => {
      const s = e.start?.dateTime ? new Date(e.start.dateTime) : null;
      return {
        time: s ? pad(s.getHours()) + ":" + pad(s.getMinutes()) : "todo el día",
        title: e.summary || "Sin título",
        where: e.location ? e.location.split(",")[0] : ""
      };
    });
}

// ---------- correo que vale la pena ----------
// Primary excluye promociones, redes y novedades: ahí está el filtro.
const MAIL_QUERY = "newer_than:1d category:primary -in:chats -from:me";

async function fetchMail(){
  const list = await api(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages"
    + "?maxResults=6&q=" + encodeURIComponent(MAIL_QUERY)
  );
  if(!list.messages?.length) return [];

  const msgs = await Promise.all(list.messages.map(m =>
    api("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + m.id
      + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject")
  ));

  return msgs.map(m => {
    const h = Object.fromEntries(
      (m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value])
    );
    const from = (h.from || "").replace(/<.*>/, "").replace(/"/g, "").trim();
    return {
      from: from || h.from || "Desconocido",
      subject: h.subject || "(sin asunto)",
      snippet: (m.snippet || "").slice(0, 140)
    };
  });
}

window.GoogleFeed = { init, connect, disconnect, isConnected, fetchAgenda, fetchMail };
