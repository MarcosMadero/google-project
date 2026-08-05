# Parte del día — panel matutino personal

PWA privada de uso personal, hosteada en GitHub Pages. Se abre desde el iPhone
(Safari → Compartir → Agregar a inicio) y funciona como una app.
El objetivo es que en sesenta segundos, a la mañana, quede claro qué cambió
mientras dormía.

## Qué muestra

- **Noticias**, solo de impacto real, sin relleno: mundo, tecnología, Argentina,
  economía y finanzas.
- **Deporte**: deportes de invierno, Fórmula 1, y en fútbol únicamente Selección
  Argentina y Boca Juniors. Nada más de fútbol.
- **Clima** de Buenos Aires y arco solar del día.
- **Agenda** del día desde Google Calendar.
- **Correo**: solo lo relevante, mostrando remitente, asunto y una línea de
  resumen. Nunca el mail completo; la idea es avisar que vale la pena abrir Gmail.

## Decisiones ya tomadas (no revisar salvo pedido explícito)

- Repo **público**. El código es público; los datos personales no viven acá:
  Calendar y Gmail se autentican en el navegador del teléfono.
- Filtro de relevancia **gratis**: puntaje por fuente y palabras clave. Sin API
  de pago, sin LLM en el pipeline.
- Sin servidor, sin backend. GitHub Actions + archivos estáticos.
- Idioma de toda la interfaz: **español rioplatense**.

## Diseño

Blanco con azul eléctrico, trabajado en tonos para jerarquía. Variables en
`:root`:

```
--paper #FFFFFF   --paper-2 #F1F4FF   --line #DCE3FB
--electric #1B34FF   --electric-soft #4E63FF
--deep #0A1550   --mid #5F6DA6
```

Tipografías: Bricolage Grotesque (títulos e interfaz), Newsreader (titulares de
noticias), Azeret Mono (rótulos, horas, datos).

El elemento firma es la **barra del amanecer** arriba de todo: el arco real de
sol de Buenos Aires con un punto en el momento actual del día. No reemplazarlo
por un header genérico.

Criterio general: se lee a las siete de la mañana, con una mano, en pantalla
chica. Densidad alta pero escaneable. Nada de tarjetas con sombras ni bordes
redondeados grandes.

## Estado actual

Hecho:

- `index.html` — frontend completo, con datos de ejemplo embebidos en `FALLBACK`
  que se usan si `data/brief.json` no existe todavía.
- `google.js` — OAuth del lado del cliente para Calendar y Gmail, solo lectura.
  `CLIENT_ID` ya cargado.
- Clima y arco solar ya funcionan en vivo contra Open-Meteo, sin API key.
- Botón de refresco al pie: compara con lo que ya había y responde
  "Hay novedades" o "Sin novedades".
- `scripts/build-brief.mjs` — lee feeds RSS (Mundo, Tecnología, Argentina,
  Economía y los cuatro focos de deporte), puntúa por fuente + palabras clave,
  arma `data/brief.json` con la forma que consume `index.html`. Agenda y correo
  quedan vacíos ahí a propósito: eso lo llena Google en el navegador.
- `.github/workflows/brief.yml` — cron a las **06:00, 13:00 y 19:00 hora
  argentina** (09:00, 16:00 y 22:00 UTC) + `workflow_dispatch`, corre el script
  y commitea el JSON si cambió.
- `manifest.webmanifest` + `icons/` (192, 512, apple-touch-icon), para que
  quede como app en el iPhone.
- `sw.js` — service worker: cache-first para el shell, network-first con
  fallback a caché para `data/brief.json`. Abre al instante y funciona sin
  señal con el último parte.
- Sección de deporte con datos reales (headlines de Olé/F1/Marca, no scores
  en vivo — no hay API gratuita para eso). Deportes de invierno puede salir
  vacío en ciclos sin novedad; es esperado.

Falta:

- Nada bloqueante para uso diario. Pendiente de validar en el teléfono real
  (agregar a inicio desde Safari) y de que la primera corrida del cron en
  GitHub Actions genere el `data/brief.json` real en producción.

## Notas técnicas

- Los feeds se leen **desde la Action**, no desde el navegador, para esquivar
  CORS.
- El `CLIENT_ID` de Google es público por diseño. Lo que protege la cuenta es la
  lista de orígenes autorizados de JavaScript en Google Cloud. No hay client
  secret porque no hay servidor.
- La app queda en modo *Testing* en Google Cloud, así que la autorización vence
  cada siete días y hay que volver a tocar "Conectar Google". Es el precio de no
  pasar por la verificación de Google, que para `gmail.readonly` exige auditoría
  CASA Tier 2. No intentar resolverlo, es una limitación aceptada.
- El filtro de correo se apoya en `category:primary` de Gmail, que ya deja
  afuera promociones, redes y novedades.
- Si Google no está conectado, la app tiene que seguir funcionando: clima,
  noticias y deporte no dependen de la sesión.
