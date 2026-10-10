# Verificación de despliegue — 7 de octubre de 2026

Entorno local Windows, Node **22.23.3** (descarga oficial verificada con SHA-256) y pnpm **11.19.0**. Se conservó el código existente y se ajustaron runtime, tipos de Node, empaquetado y documentación. El lockfile corresponde a este proyecto y sus versiones están fijadas.

| Comprobación | Resultado |
|---|---|
| Instalación `pnpm install --frozen-lockfile --prod=false` | Correcta; se verificó nuevamente con el store local ya descargado, sin modificar el lockfile |
| `pnpm typecheck` | Correcto; genera tipos de rutas antes de ejecutar TypeScript |
| `pnpm test` | 8 pruebas de dominio correctas |
| `pnpm test:db` | 7 migraciones y 13 grupos de comprobaciones SQL correctos |
| `pnpm test:load` | 50.000 filas persistidas por RPC en bloques de 250; un bloque repetido no duplicó registros; carga en 29,7 s en PGlite |
| `pnpm build` | Build de producción Next.js 16.3.8 correcto, con salida standalone |
| Servidor standalone con Node 22 | Escucha en `0.0.0.0`; healthcheck HTTP 200 y JSON esperado; login, JavaScript, iconos, service worker y manifest accesibles |
| Acceso sin autenticación en producción | `/api/workspace` devuelve 401 y `/demo` devuelve 404 con demo deshabilitada |
| Dependencias del trabajador | Instalación congelada y `pnpm prune --prod` correctos en una copia aislada; dependencias de desarrollo excluidas; los siete módulos del trabajador cargan con esas dependencias |
| Marca y configuración | Curated Financial en metadata, manifest, iconos e interfaz; ejemplos externos usan dominios ficticios o documentación oficial |
| Revisión previa a publicación | Archivos preparados sin credenciales locales, firmas de tokens, `.env` reales ni carpetas generadas; todas las variables de `.env.example` documentadas; comprobación de whitespace correcta |
| Docker y contenedores | **No ejecutados:** Docker no está instalado en este equipo. Construir ambas imágenes y comprobar sus healthchecks en el servidor Coolify |

La prueba HTTP se ejecutó temporalmente en el puerto 3100 para no ocupar el 3000 de desarrollo; el Dockerfile fija **3000**. No se ejecutó el trabajador contra la cola real como parte de las pruebas de empaquetado ni se enviaron correos o verificaciones pagas.

Las pruebas SQL utilizan PGlite y esquemas simulados de Auth/Storage. No reemplazan las pruebas contra servicios reales ni el recorrido de [aceptación del piloto](ACCEPTANCE.md). El healthcheck web comprueba vida del proceso, no disponibilidad de Supabase, Gmail o Bouncer.

## Corrección de preparación de leads — 8 de octubre de 2026

- Separación persistente de leads y oportunidades; la importación no crea expedientes. Una confirmación válida de Bouncer convierte una sola vez y mantiene pendientes, inválidos, inciertos y bloqueados fuera del flujo comercial.
- Node 22: typecheck y build de producción correctos. Diez pruebas de dominio/migración y todos los grupos de aceptación SQL correctos.
- Prueba de 50.000 filas: 50.000 leads y cero oportunidades para ese lote, en bloques de 250 y con un replay sin duplicación; 17,1 s en PGlite.
- La actualización de 001–007 a 008 conserva el ID, estado, notas y cinco documentos de un caso anterior no verificado; permanece en preparación hasta validar y después recupera el mismo expediente.
- Navegador sobre el servidor standalone local: preparación muestra pendientes/inciertos, convertidos muestra los verificados con enlace al caso; un grupo ya convertido muestra cero verificaciones y no permite iniciar otra; etiquetas verificadas en español e inglés. No se consumieron créditos de Bouncer.
- En la instancia existente, aplicar únicamente `008_lead_preparation.sql` antes de actualizar/desplegar la web y el trabajador. No volver a ejecutar el instalador inicial.

## Validación en Coolify

1. Desplegar la web usando `/Dockerfile`, configurar variables públicas para Build y Runtime y secretos solo para Runtime.
2. Consultar el dominio HTTPS con `/api/health` y comprobar respuesta 200.
3. Desplegar el trabajador usando `/Dockerfile.worker`, sin dominio ni healthcheck HTTP; conservar el healthcheck de la imagen.
4. Comprobar logs de ambos recursos, login/MFA e importación pequeña que llegue a estado completado.
5. Completar las integraciones y validaciones de aceptación antes de enviar campañas a clientes reales.

## Primera etapa de Gmail histórico — 10 de octubre de 2026

- Instalación congelada con Node 22.23.3 y pnpm 11.19.0 correcta; lockfile conservado. Typecheck y build de producción standalone correctos.
- **25 pruebas correctas**, incluyendo la actualización atómica 009–015 desde 001–008, selección controlada, pausa/reanudación, deduplicación entre cuentas, excepción histórica sin Bouncer, traspasos, privacidad y conservación al deshacer. Se comprueba también que una respuesta antigua no cancela una campaña posterior y que los correos largos conservan su texto.
- Las 15 migraciones y los 16 grupos de aceptación SQL pasaron en PGlite con Auth/Storage simulados. Las pruebas no acceden a Supabase de producción.
- Servidor standalone local: `/api/health`, `/login` y `/demo` responden HTTP 200. Navegador: panel de importación y pestaña «Correo e histórico» visibles con datos ficticios. Esta prueba no valida OAuth ni un buzón real.
- Revisión de los archivos modificados y nuevos sin secretos locales ni material de credenciales; `.env.local`, `.local`, `.next` y `node_modules` continúan excluidos. `git diff --check` correcto.
- Docker no está instalado: quedan pendientes el build de las imágenes y sus healthchecks en Coolify. No se arrancó el worker contra datos reales ni se enviaron correos, verificaciones pagadas o llamadas de IA.
- `GMAIL_HISTORY_ENABLED` permanece desactivada por defecto. Aplicar [la actualización y el piloto](GMAIL-HISTORY.md) antes de habilitarla en web y trabajador. El análisis semántico/OCR, la atribución de rebotes por dirección y el modelo de riesgo automático siguen pendientes; no se presentan como verificados.

## Redirección de autorización Google — 10 de octubre de 2026

- Se confirmó en la web pública que la política contenía `form-action 'self'`. Una reproducción local en Chromium con el mismo formulario y la misma política mantiene la página quieta y registra `Bloqueado: form-action` al seguir la redirección hacia Google.
- Se añadió exclusivamente `https://accounts.google.com` como destino permitido de formularios y se explicitó `type="submit"` en ambos botones de autorización. Las validaciones de sesión, MFA, rol, estado OAuth y organización permanecen en las rutas existentes.
- Con la política corregida, la misma reproducción llega al dominio de autorización de Google. Se usó un Client ID ficticio, por lo que Google muestra `invalid_client`, como se esperaba; no se autorizaron cuentas ni se usaron secretos reales. Una redirección hacia otro origen de prueba permanece bloqueada.
- **33 pruebas correctas**, incluida la regresión de CSP; typecheck y compilación standalone correctos. La prueba HTTP del standalone comprueba el encabezado compilado y que `/api/gmail/connect` sigue devolviendo 401 sin sesión.
- Desplegar la web y recargar el navegador. Esta corrección no necesita una migración ni cambios del trabajador. Queda pendiente completar OAuth con la primera cuenta real en producción.

## Gmail sin Pub/Sub — 10 de octubre de 2026

- `GMAIL_SYNC_MODE=polling` en Runtime de web y trabajador desactiva la creación y renovación de watches. Los trabajos antiguos reclamados se completan sin llamadas a Gmail; las consultas periódicas y el archivo persistente continúan. La configuración ausente conserva el modo `pubsub`; una configuración inválida se rechaza antes de procesar trabajos.
- Instalación `pnpm install --frozen-lockfile --prod=false` con Node 22.23.3 y pnpm 11.19.0 correcta, conservando lockfile. Typecheck (`next typegen` y `tsc --noEmit`) y build de producción standalone correctos.
- **32 pruebas correctas**, incluidas siete nuevas para consultas sin watch, deduplicación de programación, recuperación de trabajos antiguos, notificaciones ignoradas sin efectos, compatibilidad y autenticación del modo Pub/Sub, y detección de errores de configuración. Las pruebas existentes de Gmail y actualización SQL continúan pasando en PGlite.
- Servidor standalone compilado con modo `polling` suministrado durante la ejecución y sin audience/identidad Pub/Sub: `/api/health` y `/login` responden 200, `/api/workspace` responde 401 y una notificación antigua sin autenticación/con JSON inválido recibe 204 sin procesarse. Se probó temporalmente en loopback:3100, conservando el puerto 3000 del Dockerfile.
- La instalación, Turbopack y la prueba HTTP se completaron fuera del entorno restringido de Windows, que bloqueó inicialmente consultas al registro, enlaces y conexiones loopback. Los fallos iniciales fueron limitaciones del entorno; no se modificó el stack ni se omitieron verificaciones para resolverlos.
- Cambio sin migraciones nuevas, sin credenciales reales versionadas y sin iniciar el worker contra producción. Docker no está instalado localmente; el build de imágenes y la conexión OAuth real quedan para Coolify y el piloto de la primera cuenta. Las restricciones OAuth de Workspace pueden requerir aprobación administrativa aunque no se use Pub/Sub.

## Recuperación ante límites de Gmail — 10 de octubre de 2026

- El usuario confirmó que el contador seguía avanzando después de `GMAIL_HTTP_403`. El código anterior almacenaba solo el estado HTTP y mantenía el error visible después de recuperar progreso; no permite confirmar el motivo original de Google.
- Las peticiones se distribuyen con un presupuesto conservador de 4.500 unidades por cuenta/minuto por proceso. Los errores conservan únicamente motivos conocidos y muestran explicaciones en español e inglés; `Retry-After` acepta segundos y fechas HTTP sin reducir la espera de Google. Los rechazos de autorización o política de dominio siguen pausando la cuenta.
- La espera por cuota pertenece al análisis persistente: el trabajo se completa y el programador lo retoma cuando corresponde, evitando agotar intentos de la cola por un límite temporal. El cursor y los mensajes se mantienen; una actualización exitosa del análisis limpia el error anterior.
- **37 pruebas correctas**, incluidas cuatro nuevas que distinguen cuotas de permisos, verifican el ritmo de peticiones y simulan una cuota a mitad de bloque, una reanudación y un rechazo de política. Los transportes OAuth, Gmail y Supabase están simulados; no se usan cuentas reales.
- Generación de tipos, TypeScript y compilación de producción standalone correctos. Prueba HTTP local: salud y login 200, rutas de conexión Gmail y workspace 401 sin sesión, callback Pub/Sub antiguo ignorado con 204 en modo polling. Revisión de secretos y `git diff --check` sin hallazgos.
- Desplegar web y trabajador por separado desde el mismo commit. No hay nuevas migraciones ni variables. El build Docker y la evolución del análisis real se comprueban en Coolify; no se garantiza una duración ni la ausencia de cuotas de otros procesos o clientes.
