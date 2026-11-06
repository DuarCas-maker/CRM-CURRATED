# C3 — composición y recuperación local

31/10/2026 · SDD STRICT por permisos y despacho. La continuación solicitada tras la entrega C2 se aplica al siguiente incremento local ya definido: C3/C-T08. Mantener todas las restricciones actuales. Clarificación heredada sin decisiones nuevas; no promoción, APIs, cambios remotos, envíos o activación. Un test nuevo del manifiesto y documentación propia; **cero cambios de código productivo/SQL/fixtures anteriores**.

## Alcance y diseño previo

- Montar001–047+A+B1+B2+C en PGlite con los fixtures existentes, dos cuentas/marcas y roles reales del modelo. Registrar candidato, comprobar identidad falsa errónea, recuperar con otra comprobación satisfactoria, confirmar, reemplazar y revocar mediante helpers/RPC reales. Comparar datos y preparación de envío directo antes/después; auditoría/recibos y las tres tablas C son los únicos cambios atribuibles a C.
- Componer la fachada Gmail real con OAuth, Supabase y fetch enteramente falsos, sin clientes/credenciales de red. Únicamente una lectura `profile` simulada, usando la barrera B2 del ensayo; ningún `messages/send`. Comprobar orden OAuth→reserva de cuota directa→guarda final→wire falso y la permanencia de IDs/Message-ID/snapshots. Verified C nunca satisface status active del adaptador ni altera el proyecto de cuota de Gmail directo.
- Verificar que C no concede capacidades de remitente, acceso a cuenta/caso, administración o membresías. Con C verificado, revocación S01 antes del corte bloquea B2; reotorgar no rejuvenece la intención anterior y exige preparar otra. Sin pausas/reintentos reales.
- Escenario uncertain en memoria: registrar/verificar/reemplazar/revocar C no cambia el intento directo ni libera una segunda admisión. Guardar el resultado recibido se modela con funciones existentes, sin otro HTTP; preservar historia y procedencia. El test no redefine la conciliación ni corrige datos productivos.
- Comparar catálogo, definiciones/ACL/RLS/constraints/triggers previos a C, aplicar candidato en transacción y revertir con historia C existente, conservando todas las filas comerciales de base. No SQL remoto o numeración final.
- Recorrer imports relativos de fachada/worker/transporte con el parser AST Babel incluido en Next: no dependencia del registro/verificador C ni selector activo nuevo. TypeScript7 instalado no expone la antigua API AST; esta concreción no añade dependencias ni cambia los AC. Mantener los hashes de fuentes C1/C2/A/B/I01/47 migraciones,49 registros JSON operativos y HEAD.

## Verificación y límites

Pruebas nuevas de composición, regresión pertinente C1/C2/B, TypeScript, formato/enlaces/diff y revisión propia. Si una prueba confirma un defecto productivo, registrar evidencia antes de ampliar el delta; no ocultarlo relajando tests. QA visual/teclado/build standalone Windows y contención PostgreSQL independiente siguen pendientes; no se acredita una operación externa por pasar PGlite/mocks.

Entregar evidencia FR/AC/T y un siguiente paso finito para promoción posterior. C3 no implementa fuente real de configuración, UI de verificación real, selector/escritor único o corte. Rollback del incremento: retirar únicamente el test/documentación C3 tras preservar su evidencia; no reset/stash/clean/revert del WIP previo. Gmail directo activo, Composio deshabilitado, Instantly43/0 nuevas.
