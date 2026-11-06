# Especificación C — vínculo técnico sin activación

31/10/2026 · STRICT por identidad, permisos y persistencia de asociaciones. C1 implementado/probado localmente tras autorización posterior; [evidencia](c1-verification.md). C2 implementado y probado offline según [evidencia C2](c2-verification.md); C3 probado offline según [evidencia C3](c3-verification.md); QA visual/build/contención y promoción pendientes. La preparación original y las decisiones confirmadas se conservan; el alcance concreto C1 está en [c1-local](c1-local.md). Sin APIs/envíos/remoto o activación.

## Objetivo y problema

Registrar una relación revisada entre `mail_accounts.id` y una conexión Composio exacta. Hoy el adaptador I01 solo acepta un binding inyectado; no existe persistencia de asociación productiva ni resolvedor. Usar variables S00 o un ID de conexión como sustituto de cuenta/configuración/propietario/proyecto puede mezclar buzones. C debe conservar la cuenta estable y separar esa relación técnica de marca, permisos y escritor activo.

## Clarificación cerrada y decisiones reutilizadas

No se repiten preguntas respondidas. D01–D24, S01 25A–30, INT-FR07–10 y ADR002 ya establecen estas reglas; [fuente](../spec.md), [diseño aprobado](../design.md). La revisión de categorías de clarificación de C queda así:

| Categoría                 | Respuesta confirmada / evidencia                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuarios y administración | Solo superadmin activo con MFA/AAL2; S01 26A. No delegación implícita a seller_admin, closer, propietario Composio o service_role.                                                              |
| Identidad y datos         | Cuenta CRM estable, marca vigente y conexión técnica separadas; asociación exacta con proyecto/auth config/connected account/usuario/buzón primario/proyecto Google explícitos. INT-FR01/07/09. |
| Flujo y estados           | Candidato → evidencia servidor → revisión; verified separado de active. Reconexión invalida evidencia, sin nuevo escritor. ADR002 e INT-FR08/10.                                                |
| Casos límite              | Conflicto, identidad errónea, revisión anterior, clave reutilizada o dato no comprobable bloquean; no reasignar ni inferir por alias/dominio. INT-FR09.                                         |
| Interfaz                  | Sección mínima en Configuración existente; mostrar transporte directo y estado de asociación por separado. Diseño de integración, sin rediseño global.                                          |
| Calidad y entrega         | Sin nuevas dependencias; incrementos offline, fixtures, 0 APIs/envíos/remoto, Instantly43. Instrucción actual.                                                                                  |

No quedan decisiones de negocio nuevas para preparar C. Nombres de tablas/funciones y protocolo de evidencia son concreciones técnicas. Valores reales de proyectos/cuentas, fuente del proyecto de cuota, cupo y credenciales vigentes son gates operativos posteriores; no se inventan ni se piden claves hoy. Los alias M1/M2 de marcas S01 y de buzones S00 no identifican automáticamente la misma entidad.

## Requisitos funcionales

| ID     | Regla                                                                                                                                                                                                                    | AC     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| C-FR01 | Preservar cuenta CRM, OAuth directo, marca, miembros, mail_permissions, mensajes, hilos, documentos y cola. Registrar/revisar/revocar un binding no encola ni modifica el transporte.                                    | C-AC01 |
| C-FR02 | Administración solo superadmin activo/AAL2, con Origin en HTTP, autorización en DB antes de replay y DML humano/servicio directo cerrado.                                                                                | C-AC02 |
| C-FR03 | Registrar un candidato con tuple técnica exacta y revisión esperada; correo esperado se deriva de la cuenta, no del navegador. No intercambiar IDs ni inferir identidad por nombre/dominio/alias.                        | C-AC03 |
| C-FR04 | Mantener una asociación corriente por cuenta y exclusividad de proyecto+conexión entre asociaciones corrientes. Nueva tuple produce otra versión; conservar la anterior, sin hard delete.                                | C-AC04 |
| C-FR05 | Aplicar CAS, idempotencia y auditoría transaccional con revisión técnica monotónica independiente de la marca B2. Payload distinto o actualización concurrente incompatible409.                                          | C-AC05 |
| C-FR06 | Verificar con evidencia generada por servidor: proyecto/config/owner/toolkit/estado/identidad primaria y permisos requeridos; proyecto de cuota Google con procedencia explícita. Dato ausente no equivale a comprobado. | C-AC06 |
| C-FR07 | Vincular cada comprobación a candidato, revisión, contexto de cuenta/marca/actor y configuración técnica; fin de una comprobación obsoleta no sobrescribe la actual. Cliente no escribe evidencia, timestamps o status.  | C-AC07 |
| C-FR08 | Marcar verified solo tras evidencia satisfactoria vigente para esa revisión y aprobación explícita de un superadmin autorizado. Verified no es active ni construye `ResolvedComposioBinding`.                            | C-AC08 |
| C-FR09 | Mostrar estado y motivo saneados por cuenta: sin candidato/pendiente/bloqueado/verificado/revocado/obsoleto, con transporte Gmail directo separado. IDs completos y credenciales no salen en DTO de consulta/logs.       | C-AC09 |
| C-FR10 | Cambios de identidad, tuple, marca o autorización invalidan comprobación/aprobación efectiva; reemplazo/revocación no alteran historia o despachos directos ni ejecutan reconexión real.                                 | C-AC10 |
| C-FR11 | Probar SQL aditivo y rollback aislado sobre001–047+A+B1+B2, sin editar candidatos anteriores o numerar migración remota. Fallo de dependencia cierra la mutación C sin fallback a servicio amplio.                       | C-AC11 |
| C-FR12 | Proteger fuentes/huellas A/B/I01 y contadores; 0 llamadas/envíos/costos/cambios remotos en preparación y QA offline. Ningún selector/flag/env habilita Composio por terminar C.                                          | C-AC12 |

## Requisitos no funcionales

- Reutilizar Next/Supabase/Zod, requireUser/MFA/checkOrigin, lectura acotada, auditoría y command_receipts; sin SDK, cola o sistema de roles nuevo.
- Identificadores y correo esperado se conservan en persistencia restringida; no tokens OAuth, API keys o respuestas completas del proveedor. Fixtures exclusivamente ficticios.
- Peticiones administrativas acotadas, sin caché; historial con cursor por cuenta y máximo100 elementos. Datos filtrados antes de paginar/contar; campos y errores cerrados ES/EN.
- Unicidad/CAS en DB y orden de locks compatible con B; no confiar en RLS para service_role. Evidencia inconclusa requiere revisión, sin éxito supuesto ni retry oculto.
- Solo verificador inyectable offline en C2; no fetch global ni selección de claves/configuración real desde UI o env. El acceso externo futuro requiere otro gate.

## Flujos y errores

Superadmin abre cuenta → consulta estado técnico y marca revisada → registra tuple candidata con revisión esperada → futura comprobación offline produce evidencia normalizada → revisión explícita → verified, **transporte Gmail directo**. Cambiar tuple crea una versión candidata nueva y supersede la anterior; no reusar su evidencia. Revocar es local al vínculo, no revocar consentimiento Google/Composio.

Errores:401 sin sesión;403 MFA/rol/activo;404 cuenta no accesible;400 campos inválidos;409 conflicto/CAS/evidencia/revisión;503 SQL o contexto de verificación no disponible. Reintentar lectura no muta; repetir mutación idéntica usa el recibo y vuelve a comprobar autorización. Timeout de verificación conserva resultado incompleto y no aprueba nada.

## Fuera de alcance

Activación y verificación real; C1 mantiene su alcance histórico y C2 añade evidencia positiva exclusivamente con fixtures; asociaciones/correos/IDs reales; OAuth o revocación real; nuevos enlaces; selector activo o epoch de escritor; cambios a google.ts/factory/worker; sync/watch/webhooks; pruebas reales de identidad, firma, envío/recepción/adjuntos; SMS/Instantly C; SQL remoto, release o despliegue. Build/visual/catálogo/contención reales permanecen gates separados. No repetir pilotos aceptados por trámite.
