# PD-20261101 — especificación

Modo planificación; nivel STRICT por privilegios y futura lectura de catálogo de producción. Alcance confirmado por la instrucción del usuario: preparar diagnóstico sobre la instantánea recibida, conservar Instantly43 y no hacer llamadas reales ni cambios remotos. Se aplican SDD, supabase-engineer y systematic-debugging; no se diseña una corrección todavía.

## Contexto y clarificaciones resueltas

El destino self-hosted fue identificado por el usuario en Coolify y con `https://supabase.finlabinc.com/`; la sesión Cloud/Admin Charlom pertenece a otro proyecto y no se usa. El catálogo aportado tiene SHA256 `1b16483ac1a36328846121b5775fac0687b3fee8d59f82146ae68109e80b9f2b`. La fecha de recepción/revisión es 01/11/2026; no se inventa la hora de ejecución ni se atribuye la consulta al agente.

El alcance no introduce decisiones de negocio nuevas: preparar evidencia de ACL y diferencias, sin cambiar reglas D01–D24/S01, código, datos o permisos. La ronda se cierra con las restricciones ya respondidas; no se pregunta de nuevo por producción, marcas o activación. La identidad efectiva del futuro destino y las capacidades SQL se comprobarán al ejecutar, no se presuponen por el hostname.

## Requisitos y aceptación

| FR      | Requisito                                                                                                                                   | AC      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| PD-FR01 | Inventariar diferencias por objeto, campo y referencia, separando hecho, hipótesis y pendiente.                                             | PD-AC01 |
| PD-FR02 | Diseñar lectura del origen de ACL efectivas: directas/PUBLIC/herencia/owner, defaults del creador y privilegios de esquema, sin alterarlos. | PD-AC02 |
| PD-FR03 | Separar ACL de huellas, versiones PG15/18, metadata de Storage, FK/policies/vistas e historial no disponible.                               | PD-AC03 |
| PD-FR04 | Acotar contrato de salida a metadata y hashes; ningún cuerpo SQL real, secretos o filas de negocio; nunca invocar RPC de aplicación.        | PD-AC04 |
| PD-FR05 | Definir un script futuro READ ONLY, contexto/timeout/límites, sin retry automático, y criterios para detener promoción.                     | PD-AC05 |
| PD-FR06 | Conservar fuentes A/B/C, 47 migraciones, 49 hashes operativos, HEAD/index y comportamiento de proveedores.                                  | PD-AC06 |

No funcionales: compatibilidad de la consulta futura con PostgreSQL15; no nuevas dependencias. Salida determinista por clave y roles, de tamaño acotado, sin rutas locales privadas. Comparar ACL como mapas, no por orden de claves JSON. No utilizar igualdad de conteos, hashes o nombres como sustituto de permisos/comportamiento correctos.

## No objetivos

No preparar revocaciones masivas, corregir propietarios/defaults, sembrar marcas, migrar A/B/C, rehacer 046/047, reconstruir ledger supuesto, desplegar, usar credenciales, arrancar servicios/worker, repetir ensayos aceptados o activar Composio/Instantly. El informe recibido no convierte el diagnóstico futuro en autorizado. No hay FR de corrección o de explotación; no se demostrarán accesos destructivos en remoto.

Rollout: solo documentos y referencias del coordinador. Reutiliza la decisión de separar evidencia de activación del [diseño conjunto](../design.md); no hace falta ADR nuevo de arquitectura. Rollback documental y reversa futura de transacción figuran en el [protocolo](README.md).
