# Curated Financial CRM

Aplicación interna en Next.js y TypeScript, con Supabase como fuente de verdad y un trabajador independiente para operaciones persistentes. Interfaz en español e inglés. Implementación inicial del PRD del 5 de octubre de 2026.

**Estado: implementación local para revisión y conexión de servicios; todavía no es un piloto validado en producción.** La demostración usa datos ficticios y memoria temporal. La aplicación real exige Supabase, invitación y MFA; no cambia a datos ficticios si una integración falla.

## Probar la interfaz

Requisitos: Node.js 22 (22.13 o posterior dentro de la rama 22) y pnpm 11.19.0. `.nvmrc` y `packageManager` fijan estas versiones; `pnpm-workspace.yaml` autoriza únicamente el script de instalación de esbuild.

```sh
pnpm install --frozen-lockfile --prod=false
pnpm dev
```

Abrir [la demostración](http://localhost:3000/demo). Permite recorrer los cinco roles, crear oportunidades, registrar notas, revisar documentación, analizar y gestionar lenders con datos ficticios. Los cambios se reinician al recargar. El formulario de muestra está en [/apply/demo](http://localhost:3000/apply/demo) y nunca confirma un envío real.

`/` es el CRM con persistencia. `/login` explica la configuración que falta cuando no se han conectado los servicios. En producción, `/demo` queda deshabilitada salvo que se configure expresamente `DEMO_ENABLED=true`.

## Conectar Supabase

1. Crear un proyecto dedicado. Aplicar, en orden, los siete archivos de `supabase/migrations/` sobre una base nueva. Incluyen tablas, funciones, políticas RLS, permisos y buckets privados. No ejecutar sobre una instalación ajena o una base con tablas homónimas.

   Para la instalación inicial de Daniel, `supabase/install/curated-initial.sql` reúne las migraciones 001–007 en una sola transacción y registra `daniel@curatedfinancial.com` como invitación pendiente de superadmin. Ejecutar el archivo completo en SQL Editor con el rol `postgres`, **en lugar de** ejecutar los siete archivos individuales. Rechaza un esquema `public` que ya tenga tablas. No crea el usuario en Auth ni envía correo; al usar este archivo, omitir el INSERT del paso 5 y continuar con la creación o invitación del usuario en Auth. El archivo es una copia de las migraciones al 6 de octubre de 2026, no una migración adicional.

2. Copiar `.env.example` a `.env.local`. Completar URL, clave pública, clave de servicio, `APP_ORIGIN` y una `INTEGRATION_ENCRYPTION_KEY` de 32 bytes aleatorios codificados en base64. Mantener la clave de servicio y la clave de cifrado exclusivamente en el servidor y el trabajador. Guardar una copia segura de la clave de cifrado: cambiarla sin migrar los datos vuelve ilegibles las credenciales y aplicaciones existentes.
3. En Supabase Auth: deshabilitar el registro público, habilitar TOTP, configurar el correo transaccional y el Site URL. Autorizar el destino `${APP_ORIGIN}/auth/password`.
4. Configurar la plantilla de invitación con `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`. El callback intercambia el token, permite crear la contraseña y luego exige TOTP. La recuperación admite el mismo callback con `type=recovery`.
5. Crear el primer superadmin: insertar primero su correo real en `public.invitations` desde el SQL Editor, después invitarlo desde Auth. El trigger crea su perfil. Ejemplo para sustituir:

```sql
insert into public.invitations(email, name, role)
values ('REEMPLAZAR@example.com', 'Administrador inicial', 'superadmin');
```

6. Ingresar, completar MFA e invitar al equipo desde Configuración. Los permisos de remitente se conceden por separado de la responsabilidad comercial.
7. Configurar el límite de filas de la API de Supabase en al menos 3.000 para las listas relacionadas de una página. Las oportunidades se paginan de 100 en 100 y los indicadores se agregan en Postgres sobre todos los casos autorizados.

Las políticas exigen un JWT `aal2` y un perfil activo. Las mutaciones internas pasan por `crm_command`, que verifica rol y caso y conserva recibos idempotentes. Los archivos se descargan mediante URLs de 60 segundos emitidas después de comprobar acceso. Las credenciales y el contenido original de la aplicación no tienen lectura directa para usuarios internos.

## Gmail por organización

En cada organización de Google Workspace:

1. Configurar un proyecto de Google Cloud, Gmail API y una aplicación OAuth interna. Registrar `${APP_ORIGIN}/api/gmail/callback` como URI autorizada.
2. Configurar los scopes `openid`, `email`, `gmail.readonly` y `gmail.send`. Autorizar la aplicación conforme a las políticas del administrador de esa organización.
3. Crear un topic de Pub/Sub **en el mismo proyecto de Google Cloud que el cliente OAuth**. Conceder publicación a `gmail-api-push@system.gserviceaccount.com`.
4. Crear una suscripción push a `${APP_ORIGIN}/api/gmail/push`, autenticada con la cuenta de servicio configurada en `GOOGLE_PUBSUB_SERVICE_ACCOUNT` y el audience de `GOOGLE_PUBSUB_AUDIENCE`. Varias suscripciones pueden usar el mismo endpoint y la identidad push autorizada.
5. Incluir en `GOOGLE_OAUTH_ORGANIZATIONS` cada objeto con `id`, `domain`, `clientId`, `clientSecret` y `pubsubTopic`. `GOOGLE_PUBSUB_TOPIC` es el valor alternativo para una instalación inicial con un solo proyecto.
6. Desde Configuración, conectar una cuenta, otorgar sus permisos y ajustar límites. Empezar con una cuenta y límites conservadores.

El worker renueva el watch antes de su vencimiento, reconcilia cada cinco minutos y recupera el historial expirado. Los mensajes enviados directamente desde Gmail también se incorporan. Los hilos ambiguos requieren asociación manual; los adjuntos requieren incorporación y revisión separadas. El permiso de cada mensaje se deriva de su fecha respecto al traspaso, aunque el hilo haya empezado en la fase seller.

Un resultado incierto de envío se busca por su `Message-ID`. No se reenvía a ciegas. Una reconexión reactiva trabajos pausados; los envíos inciertos mantienen su estado hasta conciliación. Referencia de configuración: [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push).

## Importaciones y Bouncer

Se aceptan CSV y XLSX, hasta 50 MB y 50.000 filas. Para archivos XLS antiguos, exportar a XLSX o CSV. Se puede seleccionar hoja y ajustar columnas antes de confirmar. Los archivos originales se guardan en un bucket privado. La carga crea un trabajo; el worker persiste bloques de 250 y conserva el progreso, las coincidencias y el informe descargable.

Configurar `BOUNCER_API_KEY`. La pantalla muestra el máximo previsto de verificaciones para los contactos pendientes o inciertos seleccionados en la página. La reserva de cada verificación se persiste antes de enviar la petición; reintentar el mismo trabajo no vuelve a cobrar automáticamente una solicitud incierta. Los errores técnicos no convierten el contacto en inválido. Un contacto válido deja de ser seleccionable para scrub inicial.

Si Bouncer recibió una petición pero no se pudo guardar su identificador, revisar el lote en Bouncer antes de cualquier reenvío. Vincular el `provider_batch_id` recuperado y cambiar únicamente esos registros a `submitted` mediante una operación administrativa auditada; el reconciliador recuperará los resultados. No restablecer indiscriminadamente `uncertain_request` a `queued`.

Debe ejecutarse la prueba de aceptación con una muestra de la base real antes de habilitar volumen. La implementación usa los endpoints oficiales de [creación de lote](https://docs.usebouncer.com/api-reference/batch/batch-create), [estado](https://docs.usebouncer.com/api-reference/batch/batch-status) y [resultados](https://docs.usebouncer.com/api-reference/batch/batch-results).

## Formulario, archivos y traspaso

La estructura inicial recoge empresa, propietarios, firma electrónica escrita y consentimiento. **Falta cotejarla con el formulario existente de Curated Financial, que no se proporcionó.** No se ha inventado el texto contractual ni se recoge SSN en esta versión. No habilitar recepción real hasta confirmar campos, firma y declaraciones del formulario de referencia.

Después de esa validación, definir `FORM_DECLARATION_TEXT`, `FORM_DECLARATION_VERSION` y `PUBLIC_FORM_ENABLED=true`. El mismo control bloquea la activación de campañas que llevarían a un formulario todavía deshabilitado.

Los enlaces tienen tokens aleatorios de 256 bits, caducidad y revocación. Los identificadores visibles de empresa o responsable no otorgan acceso. La aplicación queda cifrada e inmutable; el servidor confirma después de su transacción y el worker genera el PDF con firma, declaración y fecha. El checklist empieza con aplicación y cuatro extractos; los requisitos por producto y documentos adicionales se ajustan desde la interfaz. Recibir un archivo no equivale a aprobarlo.

Solo una aplicación completa y firmada, los documentos requeridos aprobados y el análisis con recomendaciones permiten el traspaso. El admin de closers asigna. Aceptación y desembolso son operaciones distintas. Cada lender mantiene su solicitud y ofertas; los documentos enviados conservan su ruta y hash de esa versión, aunque se carguen versiones posteriores.

## Trabajador y notificaciones

En desarrollo, ejecutar también:

```sh
pnpm worker
```

Los trabajos usan reservas con vencimiento, heartbeats y fencing al confirmar resultados. Los reintentos conservan las claves de deduplicación. Los errores finales se notifican a administradores sin incluir contenido financiero. El panel de configuración muestra trabajos y envíos que requieren revisión.

Las notificaciones internas funcionan sin push. Para notificaciones por correo, configurar `NOTIFICATION_GMAIL_ACCOUNT_ID` con una cuenta conectada; comparten su presupuesto de envío. Para push, configurar el par VAPID y `VAPID_SUBJECT`. Los avisos externos son genéricos. La aplicación explica el requisito de instalación en pantalla de inicio para push en iPhone. El service worker no almacena expedientes ni intercepta respuestas para ofrecer acceso offline.

## Docker y Coolify

El repositorio es independiente: [CRM-CURRATED](https://github.com/DuarCas-maker/CRM-CURRATED). La raíz contiene la aplicación App Router (`src/app`). `next.config.ts` utiliza `output: "standalone"`.

`Dockerfile` construye la **web** por defecto con Node 22 y pnpm 11.19.0, instala con lockfile congelado incluyendo dependencias de desarrollo para compilar y copia solamente el servidor standalone, los assets y `public` al contenedor final. Ejecuta como usuario sin privilegios, escucha en `0.0.0.0:3000` y comprueba `/api/health`.

### Crear la web en Coolify

1. En el proyecto deseado, crear **New Resource → Application** desde GitHub. Para un repositorio privado, usar la GitHub App de Coolify o una deploy key con permiso de lectura. Seleccionar `DuarCas-maker/CRM-CURRATED` y rama `main`.
2. Elegir **Build Pack: Dockerfile**. Configurar **Base Directory: `/`**, **Dockerfile Location: `/Dockerfile`** y **Ports Exposes / puerto interno: `3000`**. No hace falta un build command ni un start command personalizado; Dockerfile los define.
3. En **Environment Variables**, cargar las variables de [ENVIRONMENT.md](docs/ENVIRONMENT.md). Las dos `NEXT_PUBLIC_*` deben estar disponibles para **Build y Runtime**. Las credenciales privadas se configuran únicamente para **Runtime**. Como mínimo: URL Supabase, anon key, service role, `APP_ORIGIN` y la clave de cifrado existente.
4. Configurar el dominio como `https://crm.TU-DOMINIO.com`, **sin `:3000`**, y su DNS hacia el servidor Coolify. El puerto 3000 es interno; Coolify publica HTTPS mediante su proxy. `APP_ORIGIN` debe coincidir exactamente con ese origen.
5. Habilitar healthcheck HTTP: método **GET**, esquema **http**, host **127.0.0.1**, puerto **3000**, path **`/api/health`**, respuesta esperada **200**, intervalo **30 s**, timeout **5 s**, inicio **30 s**, reintentos **3**. El Dockerfile también contiene un healthcheck para ejecuciones Docker fuera de Coolify.
6. Guardar y desplegar. Verificar `https://crm.TU-DOMINIO.com/api/health`: debe devolver `{"status":"ok","service":"curated-crm"}`. Probar login/MFA, assets e importación pequeña después de crear el trabajador.

Las migraciones **no se ejecutan automáticamente** al desplegar. Si la instalación Supabase ya tiene 001–007, conservarla y no volver a ejecutar el instalador inicial. En Supabase Auth actualizar Site URL y redirects al dominio HTTPS del CRM, autorizar `${APP_ORIGIN}/auth/password` y conservar la plantilla de invitación descrita arriba.

### Crear el trabajador en Coolify

Crear una segunda aplicación desde **el mismo repositorio y rama `main`**. Usar **Build Pack Dockerfile**, **Base Directory `/`** y **Dockerfile Location `/Dockerfile.worker`**. No asignar dominio, puerto público ni healthcheck HTTP; conservar el healthcheck de latido incluido en la imagen.

Configurar las variables marcadas **T** en [ENVIRONMENT.md](docs/ENVIRONMENT.md), únicamente para Runtime. Reutilizar Supabase, clave de cifrado y `APP_ORIGIN` de la web. El trabajador no necesita `NEXT_PUBLIC_SUPABASE_ANON_KEY` ni variables de build. No copiar `WORKER_HEARTBEAT_FILE=.local-worker-heartbeat` del entorno local: el Dockerfile fija `/tmp/crm-worker-heartbeat`.

Desplegar y comprobar sus logs y el estado de las importaciones. Mantener ambos recursos activos. Antes de trabajar con datos reales, completar [las validaciones del piloto](docs/ACCEPTANCE.md), incluidas Gmail, Bouncer y formulario. Desplegar el código no conecta por sí solo esas integraciones.

### Comprobación Docker y alternativa Compose

Con Docker disponible, desde la raíz y con las variables públicas cargadas en el entorno de la terminal:

```sh
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY -t curated-crm:web .
docker run --rm -d --name curated-crm-web --env-file .env.local -p 127.0.0.1:3000:3000 curated-crm:web
docker exec curated-crm-web node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
docker stop curated-crm-web
docker build -f Dockerfile.worker -t curated-crm:worker .
```

El archivo `.env.local` no se incorpora al build; `--env-file` lo usa solo para ejecutar. Usar el `APP_ORIGIN` apropiado para cada entorno. Para ejecutar web y trabajador juntos en un servidor de pruebas, también se conserva `compose.yaml`:

```sh
docker compose --env-file .env.local up --build -d
```

Supabase es externo; estos Dockerfiles y Compose no provisionan Postgres, Auth, Storage ni Google Cloud. No compartir volúmenes con el despliegue Supabase.

Ajustar los límites de carga y tiempos del proxy para archivos de 50 MB. Configurar copias de seguridad, retención y protección de logs del proxy: los paths `/apply/*` y `/unsubscribe/*` contienen tokens de acceso y no deben registrarse completos. La PWA no conserva expedientes offline.

Este entorno local no dispone de Docker. La construcción de las imágenes y su healthcheck dentro de contenedores deben comprobarse en Coolify; las verificaciones locales de Node 22 se describen en [DEPLOYMENT-CHECKS.md](docs/DEPLOYMENT-CHECKS.md). El presupuesto de servicios se debe medir con el piloto.

## Verificación

```sh
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:load
pnpm build
```

- `test`: normalización, plantillas, permisos de dominio, CSV de 50.000 filas, XLSX con varias hojas, cifrado autenticado, MIME y PDF paginado.
- `test:db`: aplica las migraciones en PGlite y verifica políticas RLS, MFA, idempotencia, traspaso, separación de áreas, aceptación/desembolso, documentos, exclusión de campañas y reservas de trabajos. Simula únicamente los esquemas de Auth y Storage, no sus servicios HTTP.
- `test:load`: además persiste 50.000 registros sintéticos mediante el mismo RPC de importación, con replay de un bloque. No contacta Gmail ni Bouncer.

Consultar [el estado de aceptación y las pruebas del piloto](docs/ACCEPTANCE.md) antes de habilitar clientes reales.

## Estructura

| Ruta | Contenido |
|---|---|
| `src/app` | Pantallas, formulario público y endpoints de servidor |
| `src/components` | Interfaz adaptable, ficha, importación y administración |
| `src/lib/server` | Acceso, cifrado, importación, archivos y OAuth |
| `supabase/migrations` | Modelo de datos, RLS, comandos y colas persistentes |
| `worker` | Importaciones, scrub, Gmail, campañas, PDF y notificaciones |
| `tests` | Pruebas de dominio, SQL y carga local |

No incluye la evolución de IA, análisis automático de extractos, ranking, audio, enriquecimiento ni fidelización automática.
