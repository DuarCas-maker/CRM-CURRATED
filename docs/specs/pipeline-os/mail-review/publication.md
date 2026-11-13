# Publicación de revisión de correo — G6

Autorización explícita del usuario: «Listo, valida primero en PG15 y luego aplica el SQL 053 y publica esta entrega en producción». SDD STRICT. Esta autorización amplía la entrega local e incluye el avance de main y los despliegues automáticos existentes. No habilita proveedores, cuentas, OAuth, envíos, consumo real de IA ni ejecución del worker.

## Candidato y destino

- Base de main verificada: `832136f8e0b783c4a68a3f88810ebfeff26b00f3`; repositorio `DuarCas-maker/CRM-CURRATED`.
- Coolify 4.7.5, proyecto CRM - CURRATED, entorno production, web `rv8rpfxhf0mbxprge6h6ki9c`, worker `vc4aybj4ucje7zstpsp3zboh`, Supabase `tzpxxufvp3zf6u7eyjdmxa4p`.
- URL web `https://crm.finlabinc.com`; SQL sobre la base `postgres` del contenedor PostgreSQL de ese mismo Supabase. No se guardan ni reaplican cambios pendientes de configuración de Coolify.
- Solo `migrations/053_pipeline_mail_review.sql` de esta carpeta. 048–052 permanecen instalados y no se repiten. Las 47 migraciones base y sus contratos congelados permanecen intactos.

## Requisitos y evidencia

| FR / AC / T | Criterio | Evidencia |
| --- | --- | --- |
| PUB-MR01 / AC01 / T01 | PG15 físico antes de mutación remota; permisos, contención, instalación/reversa/reinstalación | `tests/pipeline-os-mail-review-pg15.test.ts`: 10 aprobadas en PG15.19, clúster detenido; datos ficticios y funciones con propietario supabase_admin |
| PUB-MR02 / AC02 / T02 | Catálogo real compatible, 053 ausente, respaldo y reversa disponibles | Preflight y acta posterior; no registrar filas de clientes, secretos o credenciales |
| PUB-MR03 / AC03 / T03 | Solo 053, transacción completa, nuevas tablas RLS y ACL esperadas, catálogo previo conservado | Hash del SQL, postflight de catálogo y cero registros nuevos al instalar |
| PUB-MR04 / AC04 / T04 | Commit seleccionado sin WIP ajeno, main fast-forward, builds Linux de web y worker correctos | Manifiesto de publicación y acta posterior |
| PUB-MR05 / AC05 / T05 | Salud, API protegida, revisión disponible y worker paused | Lecturas de producción; no análisis/aprobaciones de correos reales durante smoke |

El ensayo nativo usa un clúster nuevo en loopback, las 47 migraciones y materialización sintética del DDL/ACL aceptado de 049, sin ejecutar su protocolo histórico. Las dependencias reales de 050–052 se concilian en el destino; no se afirma haber reproducido todo Supabase ni sus servicios en el clúster local. Binarios PG15.19 descargados por HTTPS de EnterpriseDB; SHA256 cotejado con el recibo público previo del repositorio, no con una firma o checksum publicado por el proveedor.

## Runbook

1. G5: reutilizar pruebas/build de `verification.md`; ejecutar el ensayo nativo opt-in y tipos del test añadido. Congelar fuentes y manifiesto por hash.
2. Confirmar base, recurso y versión PG15, propietario de esquema/funciones y dependencias de 053. Comprobar ausencia de las nuevas tablas/funciones. Obtener huella de definiciones/ACL existentes.
3. Confirmar worker paused, main/HEAD y la imagen anterior recuperable. No guardar cambios pendientes ni editar variables. Verificar respaldo reciente o crear uno en el mismo servidor, con permisos privados, sin volcar datos a consola; comprobar que puede leerse con pg_restore. Registrar ubicación y límites de restauración.
4. Aplicar el archivo 053 íntegro con ON_ERROR_STOP y timeouts, como supabase_admin. Su BEGIN/COMMIT asegura atomicidad. No reintentar a ciegas ante una salida incierta: primero inspeccionar catálogo.
5. Postflight: exactamente tres nuevas tablas vacías con RLS, cinco funciones con dueño esperado y grants limitados; helpers privados; catálogo previo idéntico. Confirmar health de la versión anterior compatible.
6. Seleccionar únicamente fuentes y documentos propios; cotejar base remota antes del avance fast-forward de main. Publicar el mismo commit mediante el pipeline existente, sin reconfigurarlo ni crear despliegues duplicados.
7. Observar ambos builds Linux y rolling update. Confirmar commit en ejecución, health, `/login` y `/api/health`, API de revisión protegida sin sesión y lectura autenticada si hay sesión disponible. No pulsar Analizar correo real.
8. Registrar resultados y captura de estado no sensible. Conservar acta posterior local para evitar otro despliegue solo por documentación.

## Reversa

Primero volver a la imagen anterior de web/worker conservada en Coolify. El código anterior es compatible con 053 instalado; no hace falta eliminar el esquema para recuperar la aplicación. El SQL rollback solo se ejecutaría si resulta necesario y con la evidencia nueva exportada previamente: elimina revisiones/requisitos y funciones nuevas, conserva ofertas/tareas/eventos ya aprobados. Una restauración completa del respaldo exige ventana y evaluación de escrituras posteriores; no sobrescribir producción automáticamente. No reiniciar Supabase, restaurar datos históricos o modificar flags por una falla de build.

## Límites

No se configura una nueva política de backups ni se acredita recuperación ante pérdida del servidor por crear un respaldo en el mismo volumen. El piloto de OpenAI/Gmail con presupuesto y decisiones humanas queda fuera de los smoke tests de publicación. El estado de cuentas y onboarding documentado en `spec.md` no cambia por esta entrega.
