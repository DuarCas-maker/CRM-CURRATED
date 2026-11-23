# Aplicación059 — pendiente de autorización específica

Objetivo: reemplazar solo la implementación de s01_i02.visible_conversations() en https://supabase.finlabinc.com (CRM https://crm.finlabinc.com), con respaldo privado de esa definición/atributos y verificación real. No modificar registros, grants, propietario, MFA, políticas, cuotas, worker, timeouts de la aplicación o configuración de infraestructura.

Antes:12 checks nuevos y TypeScript correctos, reversa probada. Registrar el fallo histórico de la suite I02 descrito en verification.md; no ocultarlo. Código7972157 desplegado healthy pero aún57014. Validar main actual antes de integrar únicamente los artefactos propios; no sobrescribir WIP o avances ajenos. El SQL059 sigue el patrón de release explícito de049/050; no se ejecuta automáticamente por el build web.

Después de nueva autorización, desde este worktree y con Node22 existente:

1. Ejecutar production-function.mjs --execute reutilizando --env-file del .env.local original en memoria, sin imprimir sus valores. El script valida destino y hash previo, guarda/valida un backup privado de la única definición/atributos en su .local, aplica una transacción con lock_timeout2s/statement_timeout10s y comprueba hash/atributos. Fuente distinta aborta antes de escribir. No es un dump de datos.
2. Comprobar GET autenticados Board/Master/Tareas/Workspace y tres entradas SSR, sin guardar registros de clientes. Anotar tiempos observados y errores/operaciones solamente. Comprobar que los logs nuevos no presenten57014 en estas lecturas. La sesión de usuario se reutiliza mediante el navegador, nunca extraer cookies/tokens.
3. Si hay una regresión atribuible al nuevo SQL, ejecutar production-function.mjs --execute --rollback solo cuando la aprobación incluya esa reversa, conservando de nuevo respaldo privado; el rollback exige el hash del candidato y restaura la definición original. No repetir ciegamente ni ampliar timeout si continúa lento.
4. Archivar receipt sanitizado y resultado de verificación. FR-003/006 solo done si la ruta real carga. Si sigue fallando, documentar la nueva operación y continuar con una hipótesis respaldada.

La autorización del diagnóstico no autoriza este runbook. AGENTS.md exige aprobación explícita para migraciones remotas y una excepción nueva para reutilizar env en esta operación. Esta es la única aprobación pendiente para ejecutar el resultado preparado.
