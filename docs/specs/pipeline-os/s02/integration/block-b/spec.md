# Especificación del bloque B

STRICT por identidad, autorización, datos existentes y concurrencia. Preparación original seguida de autorizaciones explícitas de implementación local B1 y B2. [Resultado B2](b2-verification.md); alcance funcional aquí conservado, sin autorización de red, SQL remoto o promoción. Las cuentas/membresías reales y los gates de publicación siguen pendientes.

## Objetivo y decisiones confirmadas

Permitir administrar marcas y revisar asignaciones sin que una conexión técnica, una membresía o el acceso al expediente se conviertan por sí solos en permiso de envío. Completar las reglas de marca que el bloque A todavía no aplica.

Clarificación cerrada con decisiones previas:25A membresías explícitas multimarcas;26A solo superadmin administra;27A historial según expediente/área, incluso entre marcas;28A una marca vigente por cuenta y por campaña;29B mapeo revisado con desconocidos separados;30 alias M1/M2, piloto M1. No se asocian esos alias con los buzones S00. Se reutiliza el diseño S01 aceptado para OAuth, notificaciones y corte final; no hay preguntas funcionales nuevas pendientes para preparar B. Las cuentas/membresías reales se revisarán antes de operar, no se inventan aquí.

Base inspeccionada: A incorporó catálogo/membresías/revisiones y permisos por fuente/área. Sus candidatos SQL son locales. No existen comandos de administración ni snapshots completos de marca. La API actual recibe `{kind,payload,idempotency_key}` y llama RPC con `{kind,p,request_key}`. El scheduler y las notificaciones escriben outbox desde servicio; controles solo en formularios serían insuficientes.

## Requisitos

| ID     | Resultado requerido                                                                                                                                                                                                                                                                                                                             | AC     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| B-FR01 | Crear marcas inactivas por defecto, renombrar nombre y cambiar estado por superadmin activo/AAL2. Código estable, sin hard delete. Desactivar no borra historia ni reactiva trabajos al revertir estado.                                                                                                                                        | B-AC01 |
| B-FR02 | Asignar/revocar membresías explícitas con revisión; ninguna herencia desde rol, dominio OAuth o mail_permission. Los cuatro roles operativos conservan sus límites previos.                                                                                                                                                                     | B-AC02 |
| B-FR03 | Proponer/revisar/confirmar/descartar la marca de una cuenta con evidencia mínima, versiones y auditoría. Confirmados inmutables; reasignación produce otra revisión. NULL/conflicto no permite despachar.                                                                                                                                       | B-AC03 |
| B-FR04 | Idempotencia actor+clave+kind+payload normalizado, autorización vigente antes de devolver replay y comparación de revisión dentro de la transacción. Origen validado; ningún actor/estado de revisión confiado al cliente.                                                                                                                      | B-AC04 |
| B-FR05 | Configuración muestra marcas/asignaciones/estados y controles accesibles ES/EN. Miembros ven solo catálogo propio; histórico autorizado muestra etiqueta mínima, sin abrir configuración ajena.                                                                                                                                                 | B-AC05 |
| B-FR06 | OAuth directo conserva ID/marca al reconectar; intención ligada al state, actor, cuenta cuando exista y revisiones. Una cuenta nueva no puede ser asignada silenciosamente por dominio ni por callback.                                                                                                                                         | B-AC06 |
| B-FR07 | Preparar campaña/correo con cuenta y marca coherentes y revisión explícita. Congelar snapshot de marca, etiqueta, revisiones, autor y procedencia de autorización; registrar evidencia humana AAL2 desde sesión, nunca un booleano del payload.                                                                                                 | B-AC07 |
| B-FR08 | Aplicar conjunción de marca activa/confirmada, membresía o superadmin, permiso de remitente y caso/área/propósito vigente. Mantener bajas, cuota, audiencia, horarios y reglas039/043. No ampliar closer a campañas de prospección.                                                                                                             | B-AC08 |
| B-FR09 | Validar también escrituras directas de servicio: scheduler, campañas de prueba y notificaciones legítimas; caso/actor NULL no es bypass. Prueba de campaña conserva destinatario del operador.                                                                                                                                                  | B-AC09 |
| B-FR10 | Revalidar en claim y corte final; serializar con mutaciones de autorización, registrar admisión y un solo intento HTTP por admisión, con máximo uno en curso por intención. Revocación anterior al corte impide HTTP; posterior puede encontrar un intento en curso, sin reenvío ciego. Conservar diferimiento/backoff para rechazos conocidos. | B-AC10 |
| B-FR11 | Conservar IDs, Message-ID, conversación, área, documentos y snapshots históricos. Legado sin preparación válida se pausa para revisión; nada se rellena desde la cuenta actual para enviarlo automáticamente.                                                                                                                                   | B-AC11 |
| B-FR12 | Mantener fachada/directo y Composio sin activación,47 SQL históricos y046/047 intactos; cero APIs/envíos/remoto/credenciales en esta preparación.                                                                                                                                                                                               | B-AC12 |

## Reglas y flujos

Administración: crear marca → asignar usuarios explícitamente → proponer marca de cuenta → revisar evidencia/impacto/versión → confirmar. Asignación no concede can_send ni cambia credencial, proveedor o campañas. Restaurar una marca/membresía incrementa revisión; no reanuda cola.

Operación futura: elegir remitente/marca disponible → revisar preparación vigente → comando transaccional autorizado → snapshot → scheduler/claim → reserva de cuota actual → recheck/admisión final → HTTP directo → resultado enviado o incierto. El cambio de permisos invalida preparaciones anteriores aunque se restaure luego el mismo valor.

Histórico: leer por caso/área/fuente como A; no exigir membresía actual de la marca histórica. Etiqueta de dispatch se conserva. Sin atribución fiable se muestra «Marca sin confirmar». Un período histórico aprobado se registra con fuente; esta preparación no autoriza backfill real o actualización masiva de mensajes.

Errores cerrados:401 sesión;403 MFA/rol/permisos;404 recurso ajeno;400 entrada inválida;409 revisión obsoleta, conflicto, clave reutilizada, preparación ausente/invalidada;503 contrato SQL no disponible. Motivos de pausa distintos de errores de red; nunca retry de una negativa de permisos.

## No funcionales y exclusiones

- Reutilizar catálogo A, RPC/recibos/auditoría, componentes y cola existentes. Sin nuevas dependencias, roles, infraestructura o segundo motor de permisos.
- RLS por operación y grants mínimos; servicio revalida propósito/actor/procedencia porque ignora RLS. Fuentes sensibles y snapshots protegidos, sin respuestas libres del proveedor o cuerpos en logs.
- Revisiones enteras seguras, FK/UNIQUE/CHECK, índices ligados a consultas; filtros antes de paginar/agregar. Presupuesto de pruebas con datos sintéticos; rendimiento real no acreditado por PGlite.
- Fuera: implementar B hoy; asociación Composio C; SMS/Instantly C; nuevas etapas; importar/verificar leads; operaciones reales; migración final/publicación; resolver permisos del Windows; reenviar pendientes o modificar preferencias de notificación.
