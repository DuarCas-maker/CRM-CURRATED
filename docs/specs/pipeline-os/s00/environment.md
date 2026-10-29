# Ambiente de pruebas de S00

## Decisión vigente

El 24 de octubre de 2026 el usuario indicó que se use el ambiente actual, que todavía no está en uso y puede modificarse. Esta decisión reemplaza la propuesta de preparar otro Supabase de QA. No se crearán proyectos, servidores, workspaces ni suscripciones adicionales como requisito de S00.

La autorización cubre cambios reversibles necesarios para S00 sobre ese ambiente identificado. No identifica por sí sola qué proyecto remoto corresponde a este checkout. Falta registrar su URL o referencia, y las cuentas de proveedores disponibles. No se presume que cualquier destino encontrado en una configuración privada sea el autorizado. La documentación anterior de instalación menciona producción; se conserva como antecedente, no como identificación del destino de estas pruebas.

## Estado comprobado

| Elemento              | Evidencia actual                                                                     | Próxima acción                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Repositorio y runtime | Node 22.23.4 portátil, dependencias existentes; sin cambios de lockfile.             | Mantener el runtime compatible del proyecto.                                                         |
| Base desechable       | PGlite aplica 001–045; aceptación SQL y carga de 50.000 filas ficticias correctas.   | No confundir estos resultados con el estado del Supabase actual.                                     |
| Supabase actual       | Sin acceso autenticado en esta continuación ni referencia confirmada por el usuario. | Identificar el proyecto actual; obtener lectura de esquema/migraciones por un canal seguro.          |
| Proveedores           | Sin prueba autenticada de Composio, Instantly o TextTorrent.                         | Registrar los IDs de proyecto/workspace/cuenta y comprobar permisos disponibles.                     |
| Docker y Supabase CLI | No disponibles en el PATH comprobado; no existe `supabase/config.toml` local.        | No se requiere instalarlos para continuar la validación offline.                                     |
| Compose existente     | Arranca web y worker con `.env.local`; no provisiona Supabase local.                 | No ejecutarlo como supuesto entorno aislado ni arrancar trabajos pendientes antes de inventariarlos. |

## Secuencia para el ambiente actual

1. **Identificar destino.** Registrar referencia Supabase, origen de la aplicación y ámbitos de Composio/Instantly/TextTorrent. Por chat solo nombres/IDs o estado de alta; no claves, contraseñas ni datos de clientes.
2. **Proveer acceso seguro.** El usuario prepara credenciales en un gestor seguro o en el proceso de pruebas, sin incluirlas en argumentos, logs o respuestas. Las reglas Duarte prohíben al agente abrir archivos `.env` con valores reales. El archivo privado preparado anteriormente no se abre. No se necesita reemplazar `.env.local` ni cambiar la clave de cifrado existente.
3. **Leer antes de modificar.** Consultar metadatos de esquema, migraciones y colas; comprobar cuentas, capacidades y permisos de los proveedores. Reportar estados y contadores, sin cuerpos de mensajes o respuestas completas de API. Una lectura no valida envío, recepción ni restauración.
4. **Preparar cambios concretos.** Comparar las migraciones realmente instaladas con el repositorio; no reaplicar 001–045 a ciegas ni usar el instalador inicial. Documentar el delta, respaldo y reversión antes de modificar una base remota. Los cambios reversibles de S00 pueden realizarse sobre el ambiente actual una vez identificado y con acceso disponible; no requieren volver a pedir un ambiente nuevo.
5. **Ejecutar contratos controlados.** Usar registros ficticios etiquetados y conservar sus IDs. No arrancar el worker general para un simple chequeo de conexión: puede consumir trabajos existentes. No habilitar todas las campañas para probar una sola cuenta.
6. **Probar efectos externos delimitados.** Antes de correo/SMS, acordar destinatarios controlados, contenido, cantidad máxima y presupuesto. La autorización del ambiente no autoriza mensajes a terceros, compras de números ni verificaciones pagas. La recepción cercana a un minuto se medirá en buzón, ingreso del evento, persistencia y visibilidad; las pruebas locales no la acreditan.

El acceso específico de cada proveedor está en [access.md](access.md). Para Composio se prioriza lectura de Auth configs, Connected accounts y Triggers; la ejecución de herramientas y el proxy tienen permisos distintos según su [documentación oficial](https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions). No se requiere otra clave por buzón; cada propietario sí debe conceder el acceso OAuth correspondiente.

Para Instantly y TextTorrent se comprueban el plan, alcance y capacidades reales antes de crear campañas o enviar. No se presupone que exista sandbox gratuito, que el plan actual incluya todas las operaciones o que una clave permita actuar sobre cualquier subcuenta.

## Recuperación y salida

Si falla un contrato, detener únicamente la prueba identificada, conservar sus IDs y conciliar operaciones con resultado incierto antes de reintentar. Revertir cambios de configuración específicos; no borrar campañas, volúmenes, cuentas o bases como limpieza automática. Una restauración se ensaya en una base desechable y no sobrescribe el ambiente actual sin autorización concreta.

El cierre de S00 requiere evidencia real de las capacidades que habilitarán cada integración. La ausencia de un entorno separado ya no es bloqueo; faltan identificar el destino y disponer de acceso seguro. Las fichas de proveedores y pruebas de entrega/latencia siguen pendientes. No se han creado recursos, cambiado infraestructura ni enviado mensajes en esta continuación.

## Destino aportado durante la preparación del respaldo

El usuario indicó el origen de Studio https://supabase.finlabinc.com y una ruta /project/default/sql/. El dominio propio y default apuntan a self-hosted; la administración concreta (Coolify, Docker/SSH u otra) todavía debe confirmarse antes de elegir comandos de backup. El enlace privado no pudo leerse con la herramienta web; no se presume acceso autenticado ni confirmación del servidor. No se almacena el identificador del snippet SQL ni se leen archivos privados. La autorización de respaldo y aplicación posterior de 030 está registrada en lender-management-recovery.md. Respaldo y migración remota todavía no ejecutados.

### Respaldo omitido por instrucción explícita

El usuario decidió continuar sin respaldo en el ambiente actual, con datos mayoritariamente de prueba y sin eliminar información. Se detiene la preparación del backup y el acceso a Coolify deja de ser necesario para este paso. 030 está autorizada para el mismo Studio; aplicación y postvalidación siguen pendientes. No se extiende esta decisión a producción ni a operaciones destructivas.
