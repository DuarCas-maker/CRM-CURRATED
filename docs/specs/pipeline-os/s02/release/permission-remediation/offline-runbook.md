# Uso local y siguiente lectura — PRM1 / VR1

**Entrega final vigente:** usar el [protocolo PRM-FINAL-r1](final/protocol.md) para preparar autorización, sin ejecutar todavía. SQL 048 revisable y postflight de lectura con hashes, 16/16 QA local. Dos scripts normales propuestos, máximo tres si se autoriza un ROLLBACK condicional de limpieza; cero retries. Gates operativos pendientes. El candidato de fixture y los pasos anteriores son históricos.

**Actualización VR1:** [resultado revisado](vr1-result-review.md), tres vistas aclaradas. La lectura única ya fue utilizada por el operador; no repetirla. Continúa la preparación PRM-T06 del SQL final y protocolo. Corrección, lectura postflight y despliegue no están autorizados. Las indicaciones de autorización pendiente que siguen son históricas.

Estado: implementado/probado offline, sin permiso remoto. [Evidencia](implementation-verification.md), [manifiesto](implementation-manifest.json), [diseño](implementation-design.md).

## Artefactos utilizables

- `scripts/pipeline-os/permission-remediation.ts`: render/comparación de archivos locales. Sin cliente de DB/red, credenciales, escritura de contadores o comando de ejecución.
- [permission-correction.local.sql](permission-correction.local.sql): candidato PRM1 con marcador externo exclusivo de fixture; transacción SERIALIZABLE, límites y verificación de preservación. **No pegar en Studio ni convertirlo en migración numerada todavía.**
- [view-review.sql](view-review.sql): un script BEGIN READ ONLY/SELECT/ROLLBACK, sin UDF o RPC. Allowlist campaign_workspace/opportunity_inbox/opportunity_tasks, metadata y hashes. Destino futuro: Supabase self-hosted del CRM; nunca Admin Charlom/otro proyecto.
- [local-view-reference.json](local-view-reference.json): metadata de ensayo base 001–047/PGlite18; antes de B2. Tres definiciones completas en ese fixture, no certificado de equivalencia real con PG15.

CLI local, desde la raíz, con el Node 22 y tsx existentes. La ejecución registrada utilizó además el guard de red local indicado en la evidencia:

```powershell
node --import tsx scripts/pipeline-os/permission-remediation.ts --render-review
node --import tsx scripts/pipeline-os/permission-remediation.ts --render-correction
node --import tsx scripts/pipeline-os/permission-remediation.ts --compare docs/specs/pipeline-os/s02/release/permission-remediation/local-view-reference.json <resultado-local.json>
```

Render imprime SQL; **no lo ejecuta**. Compare solo acepta JSON local acotado y devuelve flags/hashes de comparación, sin mostrar SQL, datos, secretos o contenido de entradas inválidas. No abrir env/keys/cookies como entrada. Un resultado `allViewsMatch=true` no aprueba permisos, servidor, despliegue o publicación; `unresolved` impide sustituir una vista para forzar equivalencia.

## Secuencia pendiente

1. Preparar autorización concreta de **una ejecución manual de VR1** con su SHA256/scope del manifiesto, verificando destino por metadatos. No instalar otro servidor o repetir el diagnóstico PD-R1. Hoy no hay autorización para esa lectura.
2. Tras recibir esa salida de catálogo, compararla offline. Si hay incompatibilidad/diferencia o lexer incompleto, detenerse y conservar solo evidencia saneada; no retry, DDL, CREATE OR REPLACE o consulta adicional automática.
3. Cerrar definición de vistas, revisar riesgos de locks/concurrencia y preparar SQL final numerado coordinado con preflight fresco dentro de su transacción, respaldo, ventana y recuperación. No reutilizar 046/047/048 por suposición ni modificar A/B/C para aprobar este diagnóstico.
4. Solo después, autorización de un script correctivo y una lectura postflight acotada. La autorización de lectura no autoriza ninguno de esos cambios.

Presupuesto: **0 real ahora**. Propuesto: **1 lectura VR1 + 1 script correctivo + 1 lectura postflight**, con alcance/autorizaciones separados y cero reintentos. Son ejecuciones SQL, no una estimación de peticiones HTTP del panel. Instantly permanece en **43**, Composio 0 peticiones nuevas, sin envíos/verificaciones pagas/despliegues.
