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
