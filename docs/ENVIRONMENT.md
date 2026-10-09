# Variables de entorno

Copiar `.env.example` a `.env.local` solo para desarrollo. En Coolify, guardar los valores en **Environment Variables** de cada recurso. Nunca subir el archivo local ni incluir claves privadas en argumentos de build.

**B** = build de la web; **W** = ejecución de la web; **T** = ejecución del trabajador. Los ejemplos son ficticios. «Opcional» indica que puede omitirse mientras esa integración no se utilice.

| Variable | Propósito | Ejemplo | Momento / recurso | Requisito |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL HTTPS de Kong/API de la instancia Supabase | `https://supabase.example.com` | B + W + T | Obligatoria; en la web activar Build y Runtime en Coolify |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública `anon` para Auth y peticiones bajo RLS | `<clave anon de esta instancia>` | B + W | Obligatoria; activar Build y Runtime; nunca usar service role |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso privilegiado del backend y trabajos persistentes | `<clave service_role de esta instancia>` | W + T | Obligatoria y secreta; solo Runtime |
| `APP_ORIGIN` | Origen público del CRM para callbacks, enlaces y comprobación de origen | `https://crm.example.com` | W + T | Obligatoria en producción; sin `/` final ni `:3000` |
| `INTEGRATION_ENCRYPTION_KEY` | Cifrado de credenciales y datos originales de aplicaciones | `<32 bytes aleatorios en base64>` | W + T | Obligatoria y secreta; conservar la clave existente |
| `BOUNCER_API_KEY` | Autenticación de verificación de correos | `<clave de Bouncer>` | W + T | Opcional hasta conectar scrub; secreta |
| `GOOGLE_OAUTH_ORGANIZATIONS` | Configuración OAuth interna por organización | Ver JSON más abajo; inicial `[]` | W + T | Requerida para Gmail; contiene secretos |
| `GOOGLE_PUBSUB_TOPIC` | Topic alternativo cuando la organización no define `pubsubTopic` | `projects/my-google-project/topics/gmail-events` | T | Opcional si cada organización ya define su topic |
| `GOOGLE_PUBSUB_AUDIENCE` | Audience que valida el token de la suscripción push de Gmail | `https://crm.example.com/api/gmail/push` | W | Requerida para Gmail push; debe coincidir con la suscripción |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT` | Identidad autorizada para firmar notificaciones Pub/Sub | `gmail-push@my-google-project.iam.gserviceaccount.com` | W | Requerida para Gmail push |
| `VAPID_PUBLIC_KEY` | Clave pública de suscripciones web push | `<clave pública VAPID>` | W + T | Opcional; se sirve desde `/api/push`, no requiere build |
| `VAPID_PRIVATE_KEY` | Firma de notificaciones web push | `<clave privada VAPID>` | T | Opcional; secreta; configurar junto a la pública y subject |
| `VAPID_SUBJECT` | Contacto del operador del servicio push | `mailto:admin@example.com` | T | Requerida si se habilita push |
| `NOTIFICATION_GMAIL_ACCOUNT_ID` | UUID de la cuenta conectada que envía alertas por correo | `<UUID de mail_accounts>` | W + T | Opcional; no es una dirección de correo |
| `DEMO_ENABLED` | Permite `/demo` en producción | `false` | W | Mantener `false` en el CRM real |
| `PUBLIC_FORM_ENABLED` | Habilita formulario real y campañas que lo necesitan | `false` | W + T | Mantener `false` hasta validar el formulario original |
| `FORM_DECLARATION_VERSION` | Versión del texto de consentimiento conservado con la aplicación | `2026-10-07-v1` | W + T | Requerida cuando el formulario se habilite |
| `FORM_DECLARATION_TEXT` | Declaración contractual aprobada que firma el cliente | `<texto aprobado en inglés>` | W + T | Requerida cuando el formulario se habilite; no inventar su contenido |
| `WORKER_HEARTBEAT_FILE` | Archivo de latido del proceso usado por el healthcheck | `/tmp/crm-worker-heartbeat` | T | Dockerfile.worker ya establece este valor; no sobrescribirlo con el valor local |

## Build de Next.js

Las dos variables `NEXT_PUBLIC_*` quedan incorporadas al JavaScript del navegador y a la configuración de la imagen. Cambiarlas solo en Runtime **no** actualiza ese código: modificar también Build y volver a desplegar reconstruyendo la imagen. El Dockerfile falla si falta alguna de las dos. La URL también se usa para generar la política CSP durante el build.

`SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `BOUNCER_API_KEY`, el JSON OAuth y las claves privadas VAPID son exclusivamente de ejecución. No activar Build para estas variables. La clave `anon` es pública por diseño; la protección de datos depende de Auth, MFA, RLS y permisos de Storage.

Configurar las mismas URL, `APP_ORIGIN` y clave de cifrado en web y trabajador. Para la instalación existente, reutilizar **todos** los valores de Supabase y la clave de cifrado de `.env.local`; no generar otra clave al publicar.

`APP_ORIGIN` debe corresponder al entorno donde se abre el CRM: `http://localhost:3000` para desarrollo local y `https://crm.finlabinc.com` para esta instalación de producción en Coolify. Sustituir el valor local al configurar **Production/Runtime** de la web y del trabajador. El valor es una URL, no una clave secreta; no debe incluir rutas, parámetros ni credenciales. Guardar y desplegar los recursos para aplicar cambios de variables. La comprobación normaliza espacios y la barra final; conserva la coincidencia de protocolo, host y puerto y rechaza orígenes externos.

Si la verificación muestra «Invalid request origin», la web rechazó la acción antes de crear el trabajo y antes de consultar Bouncer: revisar primero `APP_ORIGIN` en la **web**. La clave `BOUNCER_API_KEY` debe estar disponible en Runtime tanto en web como en trabajador; su presencia no corrige una discrepancia de origen.

## Gmail por organización

Guardar el siguiente JSON en una sola línea al configurarlo en Coolify, sustituyendo cada marcador. El topic debe pertenecer al mismo proyecto de Google Cloud que el cliente OAuth.

```json
[
  {
    "id": "curated",
    "domain": "example.com",
    "clientId": "CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "REEMPLAZAR",
    "pubsubTopic": "projects/my-google-project/topics/gmail-events"
  }
]
```

El callback autorizado es `${APP_ORIGIN}/api/gmail/callback`. Configurar además Pub/Sub con el audience y la identidad autorizada de la tabla. Esta configuración es independiente de conectar y asignar permisos a una cuenta Gmail dentro del CRM.

## Variables automáticas y de pruebas

| Variable | Propósito | Valor | Momento |
|---|---|---|---|
| `NODE_ENV` | Modo de producción de Next.js y cookies OAuth seguras | `production` | W + T; establecido por ambos Dockerfiles, Next build lo configura para compilar |
| `HOSTNAME` | Interfaz de escucha del servidor standalone | `0.0.0.0` | W; establecido por Dockerfile, no sobrescribir |
| `PORT` | Puerto interno de la web | `3000` | W; establecido por Dockerfile; no añadir al dominio público |
| `NEXT_TELEMETRY_DISABLED` | Desactiva telemetría de Next.js | `1` | B + W + T; establecido por Dockerfiles |
| `CRM_LOAD_ROWS` | Activa la carga sintética de 50.000 filas en las pruebas SQL | `50000` | Solo pruebas; `pnpm test:load` lo establece, no configurar en Coolify |

`/api/health` comprueba que la web responde; no consulta la base ni prueba Gmail/Bouncer. El trabajador tiene un healthcheck de proceso basado en su archivo de latido. Validar por separado una importación pequeña y revisar la cola después del despliegue.
