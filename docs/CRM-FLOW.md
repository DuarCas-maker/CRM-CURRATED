# Los seis puntos del CRM

## Activación

El flujo de documentos (025) ya está incorporado. Las migraciones 027–031 añaden análisis, configuración, campañas, lenders y seguimiento. Conservar la migración 026 de adjuntos Gmail y aplicar **solo las pendientes, en orden**. No repetir migraciones instaladas; probar primero sobre una copia de la base.

Configurar `R_OPENAI_API_KEY` como secreto de Runtime en **web y worker** para análisis manual / underwriting de riesgo, sin prefijo `NEXT_PUBLIC_` y sin argumento de build. Conservar `OPENAI_API_KEY` en la web para clasificación de documentos y extracción de aplicaciones; underwriting no utiliza esa clave como respaldo. Desplegar web y worker juntos; el worker incorpora trabajos `underwriting`. La migración 029 crea el bucket privado `campaign-assets`. Conservar la clave de cifrado, OAuth, permisos de remitente y cuotas de correo actuales.

El despliegue conserva los flujos anteriores si aún faltan las migraciones 027–031. La web muestra un aviso de activación y no consulta las tablas nuevas; los endpoints nuevos devuelven 503 y el worker conserva la programación anterior. La fila de configuración de la migración 031 activa el conjunto, por lo que es necesario aplicar todas las migraciones anteriores en orden. Se comprobó por HTTP de solo lectura que la base configurada todavía no tenía estas tablas antes del push.

Esta entrega se verificó con PGlite, build e interfaz demo. No se aplicaron migraciones a Supabase remoto ni se desplegó producción. Se hizo una petición real a OpenAI con cinco PDFs ficticios; no se enviaron documentos de clientes ni correos reales. El equipo local tiene Node 24; la versión prevista de despliegue sigue siendo Node 22 y pnpm 11.19.0.

## 1. Documentos

Conversaciones permite previsualizar un adjunto e incorporarlo a un requisito del expediente. La revisión guarda período, resultado, notas, usuario y versión revisada. Una corrección requiere notas. Reemplazar el archivo elimina su aprobación anterior; la procedencia impide incorporar dos veces el mismo adjunto. Véase [DOCUMENT-REVIEW.md](DOCUMENT-REVIEW.md).

## 2. Análisis con IA

Oportunidad → Análisis permite solicitar un borrador cuando la aplicación y los documentos obligatorios están aprobados, incluidos los últimos cuatro meses de estados bancarios. Cada ejecución conserva documentos/hash, prompt/modelo/criterios y catálogo con versiones de guidelines. Admite PDF, PNG y JPEG: máximo 10 archivos, 20 MB por archivo y 40 MB totales. Convertir otros formatos a PDF antes de utilizarlos como fuentes.

El reporte contiene posiciones/pagos MCA, fondeos, posibles interrupciones/defaults, riesgos, balances diarios, días de saldo negativo, días con débitos superiores a depósitos, ingresos reales, ratios deuda/ingresos e ingresos/deuda, flujo disponible, crédito, antigüedad, screening SBA, tiers/reverse, estrategia, pitch en inglés y notas copiables al CRM. Las cifras confirmadas necesitan documento/página/extracto; los datos ausentes permanecen sin confirmar.

Ingresos reales = depósitos menos fondeos, transferencias internas y otros ingresos no operativos. Flujo disponible = ingresos reales menos débitos operativos y deuda. Cuatro estados no prueban por sí solos crédito, rentabilidad fiscal o todas las posiciones de doce meses. Los criterios SBA/tier aportados por el propietario son filtros internos; no certifican elegibilidad vigente.

**La consulta NYSCEF continúa como revisión manual pendiente**, con enlace en el reporte. No se afirma que una búsqueda judicial automática se haya realizado ni que no existan demandas. El resultado comprobado puede anotarse durante la revisión humana. El catálogo por tiers tampoco confirma condiciones comerciales actuales.

La IA produce un borrador. Un usuario revisa y edita resumen, conclusión, observaciones y recomendaciones antes de registrar el análisis. La IA no aprueba documentos, transfiere expedientes ni decide financiación. Cambiar una fuente deja el reporte desactualizado y bloquea su uso como análisis vigente para handoff.

Solicitudes duplicadas devuelven la misma ejecución. Una llamada de resultado incierto no se reintenta automáticamente. Se registra consumo de tokens y se aplica un límite diario global, incluyendo ejecuciones fallidas/reservadas; este límite no representa un presupuesto monetario. Revisar un resultado incierto antes de solicitar otra ejecución.

La integración usa [Responses con archivos](https://developers.openai.com/api/docs/guides/file-inputs) y [salidas estructuradas](https://developers.openai.com/api/docs/guides/structured-outputs), con `store: false`. Esto no afirma retención cero en todas las capas del proveedor.

## 3. Configuración

Configuración → Análisis y underwriting permite editar prompt, modelo, activación, tokens máximos, límite diario y criterios numéricos SBA/tiers/reverse. Solo superadmin puede modificarla. Cada guardado conserva una versión auditable y rechaza una edición basada en una versión anterior. Los análisis antiguos retienen sus reglas. Desactivar cancela trabajos en cola/preparación; una petición ya enviada puede terminar.

Configuración → Seguimiento ajusta horas calendario: respuesta del equipo (24 inicialmente), seguimiento al cliente/lender (120) y aviso de vencimiento de oferta (48). Cambiar los plazos modifica alertas, sin enviar correos automáticamente.

## 4. Campañas y plantillas

Campañas → Plantillas guarda, edita y previsualiza mensajes, secuencias y adjuntos. Variables: `name`, `company`, `amount`, `industry`, `phone`, `application_url`, `unsubscribe_url`. Cada mensaje necesita el marcador exacto `{{unsubscribe_url}}`. Los mensajes son texto plano; las plantillas finales se pueden incorporar posteriormente.

Los adjuntos son **generales: se envían a todos los destinatarios**. Hasta cinco PDF/PNG/JPEG, 10 MB individuales y 15 MB totales; el envío mantiene además el límite existente de 18 MB en conjunto. Se verifica el hash y se conserva copia de la selección para consultar lo enviado.

Crear desde plantilla copia mensajes/secuencia y congela versión/adjuntos. Editar la plantilla no cambia campañas creadas. Las campañas nacen como borrador. Se mantienen permisos, contactos verificados, exclusiones, secuencia única, pausas por respuesta, cuotas/horario y revisión de envíos inciertos. Las tarjetas cuentan enviados, pendientes, respuestas y fallos/incertidumbre; no miden aperturas.

Las campañas con `application_url` requieren configurar/habilitar el formulario público en web y worker. Una campaña general sin esa variable funciona independientemente del formulario. La demo nunca activa envíos.

La [referencia conceptual de Google](https://developers.google.com/apps-script/samples/automations/mail-merge?hl=es-419) personaliza correos desde datos y plantillas. Esta implementación usa el CRM y su worker.

## 5. Lenders y guidelines

Importar lenders acepta CSV/XLSX, primera hoja, hasta 1.000 filas/5 MB. Se pueden mapear Empresa, Correo, Contacto, Canal, Portal URL, Productos y Notas. Cada fila representa una empresa/contacto. La vista previa muestra empresas nuevas/existentes, correos nuevos, duplicados y conflictos.

La agrupación usa el nombre exacto de empresa, normalizado en espacios exteriores/mayúsculas. No fusiona nombres parecidos ni empresas por dominio. Un correo de otra empresa o un nombre ambiguo bloquea toda la importación. La operación es atómica e idempotente. Conserva datos existentes, añade contactos faltantes y completa nombres vacíos; las correcciones se hacen en la edición del directorio. La tarjeta muestra sus contactos/correos.

Guidelines conserva tier, crédito, antigüedad, posiciones máximas, industrias, defaults, ciudadanía, reverse, notas, fuente, fecha y confirmación. Superadmin/closer_admin guardan versiones; confirmar exige fuente y fecha. Hay historial. Nuevos análisis reciben estos criterios/versiones; los antiguos retienen su snapshot. Incompatibilidades entre criterios confirmados y crédito/antigüedad/posiciones/defaults/industria comprobados rechazan el matching generado.

El catálogo PDF incluye tiers 1–5, reverse y notas especiales del prompt. No inventa una lista para tier 6. El export conectado añade el directorio y guidelines guardados. La demo ofrece la referencia estática `public/lender-tiers-reference.pdf`.

## 6. Seguimiento operativo

Resumen → Seguimiento de clientes muestra una fila por oportunidad activa, prioridad, plazo, responsable, etapa, lender, parte que espera, documentos y próxima acción. Filtros: necesitan atención, por responder, vencidas, documentos, análisis, con lender, negociación y ofertas por vencer/vencidas. Un caso se cuenta una sola vez por categoría aunque tenga varias tareas/respuestas.

Las esperas se obtienen de `mail_waits`, respetando procesos activos. Conversaciones anteriores utilizan su último mensaje efectivamente recibido/enviado y marca de atención. Negociación procede del pipeline; no se infiere una respuesta o negociación por el tiempo transcurrido. Se excluyen casos pausados, perdidos y desembolsados.

Postgres aplica acceso al caso/área y filtros antes de ordenar/paginar (50 filas). Los totales cubren todo el conjunto autorizado. Compartir remitente no concede casos ni datos de negociación. Abrir ficha lleva a los controles existentes para responder, revisar documentos, fijar próximo paso o completar tareas.

## Piloto

1. Incorporar/revisar un adjunto ficticio, comprobar que aparece en Documentos y reemplazarlo: debe perder aprobación.
2. Aprobar aplicación + cuatro meses correctos, generar un borrador y revisar fuentes/cálculos/notas. Registrar revisión humana y modificar una fuente: debe marcarse desactualizado.
3. Guardar prompt/criterios nuevos, comprobar versión en una ejecución nueva y edición denegada al seller.
4. Guardar plantilla con seguimiento/folleto ficticio y crear campaña en borrador. El piloto de envío real a una audiencia interna debe aprobarlo y activarlo un administrador; este trabajo no envió correos.
5. Importar dos correos de una empresa y repetir: debe haber una empresa/dos contactos. Probar conflicto y verificar rollback; guardar dos versiones de guidelines y exportar PDF.
6. Verificar respuestas, tareas vencidas, espera de lender, negociación, oferta próxima a vencer, plazos/responsable, conteo único, filtros, permisos y segunda página.

Comandos: `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm build`. Las pruebas de base aplican todas las migraciones desde cero y cubren permisos/MFA, snapshots, idempotencia, leases, reintentos inciertos, importación atómica, versiones, cálculos, paginación y conteos. Las pruebas visuales utilizan `/demo` y datos ficticios.
