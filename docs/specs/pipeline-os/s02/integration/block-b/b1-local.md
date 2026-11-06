# B1 — ventana de implementación local

31/10/2026. Usuario autoriza B1 local y pruebas offline, sobre el manifiesto de seis existentes/ocho nuevos. Coordinador edita solo este checkout; B2, Composio, worker,47 migraciones, credenciales reales, APIs, mensajes, remoto, commit/push y publicación quedan excluidos. A43 e I01 ocho archivos quedan protegidos; baseline inicial589 públicos/49 JSON operativos.

Concreciones técnicas previas al código:

- El candidato B1 aplica tras001–047+A y exige marcador `pipeline_os.block_b1_local=in_memory_test`; no tiene ordinal final. Wrapper CRM explícito delega comandos previos, con alias sin EXECUTE humano. Recibos/auditoría y CAS son transaccionales, autorización superadmin/AAL2 antes del replay.
- La propuesta incorpora revisión de marca objetivo y huella de conflictos/pendientes, además de la revisión de cuenta ya modelada. Si cambian antes de confirmar se exige volver a revisar; conflicto visible requiere confirmación explícita. Campos nuevos de soporte en la revisión son aditivos, sin recatalogar mensajes o pausar/reanudar outbox en B1.
- OAuth usa RPC begin/claim/finish: intención firmada, claim de uso único y finalización transaccional de cuenta/credencial/propuesta/trabajos técnicos. SQL finish revalida identidad/revisiones antes de escribir. Cuenta nueva coincide con existente→reiniciar como reconexión; cuenta existente sin marca confirmada→revisar primero. No otorgar membresías o reasignar desde callback. Google y cookies se falsean en tests.
- Reducir DML de servicio sobre marcas/revisiones y columnas comerciales de cuenta; conservar actualizaciones técnicas actuales de cuenta. Solo funciones acotadas con propietario controlado modifican asociaciones. No se afirma que RLS limite service_role.
- GET por colección y cursor UUID, páginas acotadas. Panel ES/EN en Configuración y campos OAuth reutilizados en ambos formularios, con estado vacío/cargando/error y sin elección automática de la primera marca. Datos de usuario/cuenta solo para administración legítima.
- Reutilizar los tres parsers A cuando corresponda; DTO de comandos B no acepta auditoría/estado autorizado suministrados por cliente. Respuestas de error cerradas y sin valores externos.

Verificar SQL/RLS de cinco roles, CAS/replay/conflictos/inmutabilidad, OAuth correcto/identidad equivocada/cambio de marca/actor/replay y rollback de transacciones, API/origen/falta de SQL y panel/estados. TS/formato y regresiones de las seis superficies cambiadas; build solo aislado y sin env/red, limitación EPERM heredada documentada. No repetir pruebas de proveedor o A155 por trámite. B1 por sí solo no es release de protección comercial completa.
