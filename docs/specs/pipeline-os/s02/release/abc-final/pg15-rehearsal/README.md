# Ensayo aislado de049 — AF-PG15-r1

**Revisión de entradas AF-EOL-r1:** [LF/CRLF corregido y45 pruebas offline](../line-endings/verification.md). Nuevos hashes de049/postflight/contrato/preflight y pins del ejecutor;58 entradas de ensayo reseñadas sin cambiar el bootstrap o candidatos. No repetir la lectura real ni iniciar el modo nativo por esta corrección; PG-T02/04/05 continúan pendientes.12 pruebas del ejecutor volvieron a pasar; Instantly43.

**PG-EXEC-r1 vigente04/11/2026:** ejecutor/adaptador implementados y probados offline,12/12 tests nuevos y coordinación simulada de16 AC. [Uso seguro y requisitos](executor-runbook.md), [verificación](executor-verification.md), [contrato de implementación](executor-spec.md). PG-T03 completo; PG-T02 motor/dos clusters privados y PG-T04/05 nativos pendientes. No se instala/arranca PostgreSQL ni se consulta remoto. La descripción de preparación siguiente conserva su fecha; el siguiente incremento es habilitar el runtime local bajo alcance propio, no implementar de nuevo el ejecutor. Instantly43.

04/11/2026 · SDD STRICT · **Protocolo preparado, ejecución pendiente.** [Especificación](spec.md), [diseño](design.md), [casos/aceptación](acceptance.md), [tareas](tasks.md), [verificación](verification.md), [manifiesto](manifest.json).

El objetivo es comprobar que049 completa su transacción en PostgreSQL15 real y que el postflight independiente confirma lo instalado. Incluye aborto/recuperación y bloqueos entre conexiones físicas. Reutiliza la evidencia funcional ya aceptada; no vuelve a probar proveedores, importación, recepción o adjuntos.

El [resultado del preflight real](../preflight/result-review.json) queda aceptado: PG150008, contexto READ ONLY correcto, cero diferencias y todos los agregados de cola en cero. Corresponde a una lectura del operador ya consumida; no requiere otra consulta remota ni demuestra que049 se aplicó. Los documentos anteriores a este resultado conservan su fecha y alcance histórico.

## Qué necesitamos

Un runtime nativo PostgreSQL15 con postgres/initdb/pg_ctl/psql/pg_dump/pg_restore, versión y procedencia verificadas. **No está disponible** en PATH ni en las ubicaciones estándar revisadas; tampoco Docker/Podman. Existe wsl.exe, sin comprobar distribución/motor ni iniciarlo. Solo se encontró el toolchain Node22 ya usado. La inspección no descarta una ubicación diferente fuera de las examinadas.

Ruta técnica propuesta: paquete portable Windows en una carpeta privada del workspace, sin servicio permanente ni conexión al VPS. Se fijarán proveedor, versión menor y SHA256 antes de habilitarlo. No se ha seleccionado/descargado un paquete ni verificado su licencia/procedencia/disponibilidad. Si no existe un paquete confiable y compatible, revisar esta decisión antes de elegir Docker/WSL u otro entorno. No hay descarga, instalación o arranque autorizado por esta preparación.

## Secuencia del ensayo futuro

1. **Congelar entradas y destino local.** Comprobar hashes del manifiesto, runtime15.x, directorio de datos privado, identificación del cluster y base descartable. Conexión explícita a127.0.0.1 y puerto55449 propuesto; si está ocupado, detener antes de arrancar. No usar credenciales/variables/DSN del CRM.
2. **Construir una base sintética.** Adaptar únicamente el soporte de fixture al motor nativo: auth/storage mínimos, roles/owner y grants observados,001–047 exactos y048 exacto en esta base nueva. Esta inicialización local no reaplica048 en el CRM. Preparar datos ficticios, intenciones legacy y referencias para comprobar preservación.
3. **Aplicar los artefactos exactos.** En clon limpio, preflight local de control;049 completo mediante psql con ON_ERROR_STOP y sin envolver otra transacción; código de salida cero. Abrir otra conexión para postflight READ ONLY y comparar contratos/huellas con el recibo. No aprobar por stage=checked_before_commit solamente.
4. **Ejecutar los casos de aceptación.** Usar clones limpios para cada caso de la [matriz](acceptance.md): deriva/instalación parcial/sending, aborto tardío, contención y DDL concurrente, permisos/MFA, preservación y recuperación. Nada de worker, web o proveedores reales.
5. **Cerrar evidencia y cluster.** Conservar versiones, hashes, resultados y límites; detener solo el cluster verificado del ensayo. Mantener respaldos/resultados en su directorio privado hasta revisión; no borrar otras bases o procesos. Sin push/deploy o publicación implícita.

Hoy: **0 ejecuciones SQL nuevas,0 llamadas de proveedor,0 cambios remotos**, Instantly43/0 nuevas, Gmail directo conservado y Composio deshabilitado. El siguiente incremento es implementar y probar offline el ejecutor/adaptador de este protocolo. La adquisición del runtime y la ejecución local se delimitan después; preparar documentos no los ejecuta.
