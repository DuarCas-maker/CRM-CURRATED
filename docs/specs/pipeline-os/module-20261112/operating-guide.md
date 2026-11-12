# Guía de operación de Pipeline OS

Guía del módulo independiente · 12 de noviembre de 2026. La publicación y su reversa se describen en [publication-20261112.md](publication-20261112.md).

## Entrar y orientarse

En el menú del CRM, abrir **Pipeline OS**. La ruta es `/pipeline-os`; exige la misma sesión, invitación activa y MFA del CRM. El botón **CRM** vuelve a la aplicación anterior, cuyos módulos se conservan.

La demostración está en `/pipeline-os/demo`, con datos ficticios y cambios temporales, cuando el entorno permite demos. En producción requiere la configuración existente `DEMO_ENABLED=true`; esta publicación no modifica esa variable. No envía correos ni verifica contactos realmente. El directorio y las ofertas adicionales de esta demo son ejemplos propios del módulo, no importaciones de los HTML suministrados.

Inicio muestra tareas, campañas, indicadores, expedientes y clientes. Las tarjetas abren niveles debajo de Inicio. **Árbol** muestra la navegación completa. Cambiar un hermano reemplaza los niveles posteriores. La búsqueda encuentra negocios, contactos y lenders asociados a ofertas visibles. Las listas se filtran por responsable y se paginan de 50 en 50; el total se calcula antes de paginar. Al abrir/cerrar un expediente se conserva la lista.

En **Parámetros** se cambia idioma de esta vista y tema. Árbol/tema se recuerdan localmente; los expedientes no se guardan en localStorage. Marcas, cuentas, permisos, límites, horarios y configuración de UW se siguen administrando en Configuración del CRM.

## Recorrido diario

1. Abrir **Updates** y comprobar fecha de observación y ventana: 24/48 horas, 7/30 días.
2. Leer próximas tres acciones y revisar los expedientes que requieren intervención.
3. Abrir **Tareas abiertas** y la etapa correspondiente.
4. Abrir el expediente para revisar documentación, UW, tareas y evidencias.
5. Usar **Conversaciones** para consultar/responder al cliente o lender desde el hilo y remitente correctos.
6. Después de guardar, comprobar el estado persistido. **En cola** no equivale a enviado; un error de actualización posterior a guardar no autoriza repetir un envío.

Updates/recap muestran registros del CRM actualizados en la ventana seleccionada y su siguiente acción. No ejecutan una consulta nueva de los 18 buzones ni afirman que todos sus correos hayan sido clasificados. La recepción y los eventos siguen dependiendo de la sincronización existente. Los indicadores representan el ámbito autorizado y filtrado, no una tasa de conversión histórica.

## Las cinco vistas de trabajo

| Vista                | Significado                                                     | Acción habitual                                        |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Aplicación pendiente | Expediente todavía en preparación/contacto/documentación        | Pedir faltantes, incorporar y revisar documentos.      |
| Oferta pendiente     | Preparación/UW/gestión sin oferta vigente del proceso actual    | Revisar análisis y proponer lenders.                   |
| Ofertas              | Hay ofertas vigentes, ligadas al proceso actual cuando existe   | Comparar y seleccionar con intervención humana.        |
| Contratos enviados   | El proceso activo registra `contract_sent`                      | Abrir evidencia y dar seguimiento.                     |
| Contratos firmados   | El proceso activo registra `contract_signed` o `final_approval` | Completar requisitos y confirmar fondeo con evidencia. |

Una aplicación firmada no acredita firma de un contrato de lender. Un proceso histórico no sustituye al activo. Los registros sin evidencia de contrato no se colocan automáticamente en esas dos últimas vistas. Los expedientes perdidos/pausados siguen consultables en Expedientes. Clientes requiere fondeo registrado; los procesos no multiplican el importe del mismo expediente.

El progreso documental conserva el mínimo existente de aplicación más cuatro extractos y documentos adicionales requeridos. Archivos recibidos y aprobados son cantidades distintas; extractos duplicados no completan los cuatro requisitos.

## UW y revisión humana

**UW** abre el análisis existente del expediente. Se conservan configuración, presupuesto, estados y revisión humana del CRM. La pantalla recuerda revisar:

1. Datos de la aplicación y faltantes.
2. Flujo de caja y exclusiones, NSF, saldos, posiciones y pagos a RAM.
3. Lenders compatibles según guidelines del directorio vigente.
4. Pitch adecuado al comercio.
5. Próximo paso del expediente y documentación pendiente, incluido AR aging.

El recordatorio operacional no modifica el prompt ni garantiza por sí mismo que el proveedor haya extraído cada dato. Revisar el informe, sus fuentes y las advertencias antes de aprobar. El módulo no inicia UW ni presenta el expediente al abrir una pantalla.

En el panel de expediente se mantienen las pestañas de actividad, correo e histórico, documentos, análisis y lenders/ofertas según los permisos actuales. **Correo e histórico** permite trabajar con procesos y su evidencia usando los controles existentes.

## Ofertas, envíos y Conversaciones

La tabla distingue **Selección humana** y **Mayor monto**. Desplegar las ofertas para comparar importe frente a lo solicitado, plazo, costo, frecuencia, comisiones y requisitos disponibles. Datos ausentes se muestran pendientes; no se convierte texto de costo heterogéneo en una tasa inventada. Una oferta vencida/descartada no figura entre las vigentes.

**Revisar y elegir en el expediente** abre la gestión existente. El sistema conserva la aprobación humana y un envío separado por lender. La selección de destinatarios, paquete documental, remitente/marca y presupuesto sigue su revisión vigente. Se conservan los límites del compositor, que pueden requerir varios lotes para presentar a 40 lenders.

**Contactados** cuenta lenders únicos con presentación/envío confirmado según la evidencia del CRM, sobre el historial del expediente; no cuenta borradores, cola o resultados inciertos como enviados. Conversaciones conserva su módulo original: muestra hilos y categorías Cliente/Equipo/Lenders, con los filtros por proceso existentes. El número de hilos puede diferir del de lenders únicos.

Si una acción quedó guardada pero falló la lectura posterior, actualizar la vista. Los comandos conservan claves de idempotencia durante un reintento incierto. Revisar un envío incierto mediante el procedimiento existente; no reenviarlo a ciegas.

## Leads y campañas

En **Campañas → Preparar leads**:

1. Importar CSV/XLSX mediante el asistente existente, revisar mapeo y confirmar.
2. Consultar Por preparar, Convertidos o Inválidos/en riesgo.
3. Seleccionar únicamente contactos verificables. Una baja, resultado válido o verificación ya en curso no habilita una nueva verificación desde esta vista.
4. Revisar la confirmación y el consumo posible del proveedor antes de verificar.
5. Esperar resultados; un resultado incierto requiere revisión.

Importar no verifica ni activa campaña automáticamente. **Crear campaña** abre el creador existente con marca, remitente, plantilla, audiencia, límites y revisión. Las métricas del centro de campañas se consultan en su componente original; la demo no inventa métricas reales. La baja global detiene prospección de todas las marcas y canales conforme al CRM.

## Límites de esta entrega y recuperación

- El módulo es aditivo. Publicar su código no activa proveedores, aplica migraciones ni reanuda trabajos del worker; la ejecución de la publicación se registra por separado.
- Reutiliza capacidades ya presentes. No añade transporte SMS, conexión TextTorrent, autonomía nueva ni completa por sí solo los sprints pendientes de Instantly/asistente.
- La operativa con buzones/proveedores reales depende de su configuración y permisos vigentes; no fue ejercitada mediante envíos en este trabajo.
- La lectura del catálogo pagina las fuentes. Si faltan datos, cambian los conteos durante esa lectura o se repite un registro entre páginas, falla explícitamente y permite actualizar. No sustituye por demo.
- La lectura es una observación de varias fuentes, no una transacción financiera. Las actualizaciones simultáneas pueden requerir refrescar. El límite de lectura por fuente es 100.000 filas; ante él se requiere revisión del administrador, sin mostrar un total incompleto.
- Si una fuente del runtime de correo no existe, comprobar la instalación vigente con el procedimiento del coordinador. No repetir 048/049/050 por esta guía; este módulo no introduce SQL.

Para desarrollo local se mantienen Node 22 y pnpm 11.19.0: `pnpm dev`, luego abrir `/pipeline-os/demo`. No hace falta iniciar el worker para recorrer la demo. Rollback y evidencia técnica están en `rollout.md` y `verification.md`.
