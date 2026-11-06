# Especificación — identidad, permisos y asociación

C3 compuesto/probado offline31/10/2026 por continuación humana: [evidencia](block-c/c3-verification.md),14 nuevas/125 regresión/TS correctos. Un test nuevo, sin cambios a producto/SQL/fixtures C1/C2/A/B/I01. C1/C2/C3 funcionales locales; siguiente: preparar versión conjunta A/B/C y cierre de gates INT-T04/T00-02-I. QA visual/build/contención, catálogo y promoción siguen pendientes. Directo activo, Composio deshabilitado, Instantly43/0 nuevas; sin APIs/envíos/remoto/push/deploy. Las constancias anteriores conservan su alcance histórico.

C2 local implementado/probado31/10/2026 por autorización humana: [evidencia](block-c/c2-verification.md),28 nuevas/97 regresión/TS correctos. Dos fuentes C1 extendidas/dos adiciones; identidad/permisos y evidencia sellada con dependencias falsas, aprobación humana sin activar transporte. C3 y promoción pendientes; Gmail directo activo, Composio deshabilitado, Instantly43/0 nuevas. Sin env reales/API/envíos/SQL remoto/push/deploy o cambios del checkout S01. Las constancias previas conservan su alcance histórico.

Actualización C1 implementada31/10/2026: [entrega y límites](block-c/c1-verification.md),24 pruebas nuevas/73 regresión/TS correctos. Registro/API/panel/revocación de candidatos y SQL en memoria, sin evidencia positiva o selector Composio. I01/A/B/47 SQL/49 hashes operativos conservados fuera del único compartido permitido; Instantly43 y0 API/envíos/remoto/push/deploy. Siguiente incremento: C2, verificador inyectable offline y protocolo de evidencia, bajo solicitud; visual/build/contención/catálogo y promoción siguen pendientes.

Concreción C31/10/2026: [especificación C](block-c/spec.md) reutiliza decisiones D01–D24/25A–30 e INT-FR07–10; ninguna decisión funcional reabierta. B1/B2 ya funcionales localmente; C solo preparado, no implementado. [ADR004](block-c/adr-004-evidencia-sin-selector.md) separa revisión técnica, marca y escritor. El registro siguiente conserva la preparación histórica.

Actualización de alcance31/10/2026: el usuario autorizó implementar/probar **solo A**. [Concreción local y paths adicionales de QA](block-a-local.md). Se implementan identidad/fundamento S01 y área/fuente; administración/guardas completas de marca y asociación Composio de B/C continúan fuera de A. La clasificación STRICT y decisiones funcionales no cambian. El modo planificación del registro siguiente describe la preparación anterior.

31/10/2026 · STRICT por autorización, identidad y datos existentes. Modo planificación: documentos y diagnóstico local; no implementación de producto.

## Contexto y clarificación cerrada

S02-I01 conserva la fachada `gmail` y su camino directo. El adaptador Composio existe únicamente como transporte inyectable. S01 tiene I01 (fundamento de marcas) e I02 (área/fuente) probados en otro checkout, todavía sin integrar aquí. T01-02 completo, T01-03 y T01-04 no están terminados.

Se reutiliza la ronda de S01, sin volver a preguntar:25A membresías multimarcas explícitas;26A administración solo superadmin;27A histórico según expediente/área;28A una marca vigente por cuenta/campaña;29B mapeo revisado;30 alias M1/M2, piloto M1. D01–D24 siguen vigentes. Los alias de marcas no identifican los buzones M1/M2 de S00. No hay una decisión funcional nueva pendiente para preparar este paquete. Asignaciones reales, evidencia vigente del proveedor y destino del futuro corte son gates operativos pendientes, no valores supuestos.

Problema: cambiar el transporte sin trasladar permisos y procedencia puede mezclar cuentas, ampliar acceso o despachar pendientes con una identidad obsoleta. La integración preserva IDs y separa autorización humana, marca operadora y autenticación técnica.

## Requisitos y trazabilidad

| ID       | Regla verificable                                                                                                                                                                                                           | AC   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| INT-FR01 | Conservar `mail_accounts.id`, hilos/IDs Gmail, documentos, permisos explícitos y cola. No crear cuentas duplicadas por conectar/reconectar.                                                                                 | AC01 |
| INT-FR02 | Integrar I01/I02 como paquete coherente de datos y consumidores; no copiar lectores sin RPC ni promover SQL de sandbox directamente.                                                                                        | AC02 |
| INT-FR03 | Leer mensajes, archivos y derivados solo por expediente/área/fuente autorizados; la pertenencia a marca no amplía ese alcance.                                                                                              | AC03 |
| INT-FR04 | Solo superadmin activo/AAL2 administra marcas, membresías y asociaciones; mutaciones con origen, idempotencia, revisión y auditoría.                                                                                        | AC04 |
| INT-FR05 | Mantener una marca vigente por cuenta/campaña; no inferirla de dominio OAuth, permiso de envío o conexión Composio. Desconocidos/conflictos quedan separados.                                                               | AC05 |
| INT-FR06 | Antes de despachar exigir marca activa/asociación confirmada, membresía o excepción superadmin definida por S01, permiso de remitente y permisos de propósito/caso/área aplicables. Revalidar cambios y conservar snapshot. | AC06 |
| INT-FR07 | Asociar cuenta CRM a proyecto Composio, auth config, connected account, usuario Composio, buzón verificado y proyecto de cuota Google explícitos. Campos no intercambiables.                                                | AC07 |
| INT-FR08 | Separar candidato, verificación y selección activa. Registro/confirmación/reconexión no activa conector, no da `can_send`, no cambia marca ni reanuda campañas/trabajos.                                                    | AC08 |
| INT-FR09 | Rechazar identidad equivocada, duplicado, proyecto/config/usuario incoherentes o versión obsoleta; conservar historial de asociaciones y errores redactados.                                                                | AC09 |
| INT-FR10 | No permitir dos escritores por cuenta ni fallback automático; mantener Message-ID/uncertain y reserva de cuota. Reconectar invalida evidencia previa.                                                                       | AC10 |
| INT-FR11 | Preparar delta aditivo, lectura de catálogo/legado, corte web/worker y corrección hacia adelante; no restaurar permisos amplios de021 al revertir.                                                                          | AC11 |
| INT-FR12 | En esta preparación preservar fuentes de S01/S02-I01 y contadores; cero APIs, activaciones, env reales o cambios remotos.                                                                                                   | AC12 |

## Requisitos no funcionales

- Sin dependencias/infraestructura nuevas. Reutilizar Supabase/PostgreSQL, MFA, auditoría, cola y fachada existentes.
- Clave central solo servidor; nunca guardar tokens OAuth de Google extraídos de Composio. IDs privados/evidencias restringidos y sin cuerpos de clientes en logs/fixtures.
- Autorización efectiva en DB/RPC y servicio: `service_role` ignora RLS y no demuestra por sí solo permiso del actor.
- Filtrar antes de paginación, snippets, fechas, contadores, firma de URL o lectura de bytes. No atribuir área/marca a legado incierto sin evidencia.
- Límites/pacing actuales, un intento HTTP y resultados inciertos conservados. Sin prometer rendimiento o capacidad del proveedor desde pruebas offline.

## Flujo esperado y exclusiones

Integrar base → revisar marcas/membresías por superadmin → confirmar asignación explícita → registrar candidato Composio para la misma cuenta → verificar identidad técnica mediante servidor, con autorización independiente para las llamadas → revisión satisfactoria **sin seleccionar Composio**. El cambio de escritor es otro incremento.

Errores:401 sesión ausente;403 MFA/perfil/rol/ámbito;404 recurso no visible;400 entrada inválida;409 revisión/identidad/duplicado/idempotencia incompatible;503 dependencia/RPC/configuración ausente. No devolver texto libre del proveedor ni convertir veto de permisos en reintento de red.

Fuera de alcance: incorporación de código en este turno, asociación real de cuentas, migración/catálogo remoto, publicación, selector productivo, OAuth real, cambios de Google directo, nueva importación/verificación, SMS, Instantly C, entrenamiento de chatbot y terminación global de S01/S02/S00.
