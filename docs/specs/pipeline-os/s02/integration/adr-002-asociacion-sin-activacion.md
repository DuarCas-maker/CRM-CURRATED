# S02-ADR-002 — Asociar sin cambiar el escritor

31/10/2026 · Propuesta técnica para implementación posterior; reglas funcionales heredadas de S01 aprobadas. Preparar este ADR no autoriza código ni activación.

La cuenta del CRM, la marca y la conexión Composio son dimensiones distintas. I01 ya ofrece transporte compatible; S01 ofrece fundamento y separación por fuente/área. Falta persistencia revisada y coordinación de guardas.

Decisión: conservar `mail_accounts.id`; incorporar S01 por un delta finito; completar sus comandos/snapshots; guardar asociaciones técnicas revisables con revisión y evidencia de servidor. Una relación verificada permanece separada del selector activo. Conservar Gmail directo hasta un corte posterior por cuenta con cola conciliada y escritor único.

Alternativas descartadas: otra cuenta CRM por cada connected account duplica historia; usar dominio OAuth como marca contradice29B; IDs de env como mapeo productivo carecen de revisión/actor; activar al autorizar OAuth mezcla consentimiento técnico y permiso operativo; fallback directo tras error puede duplicar mensajes; solo sumar RLS permisiva no cierra021.

Consecuencias: A/B/C son tres entregables revisables. B debe completar reglas que I01/I02 no implementaron. Se añade persistencia mínima de binding; no otro motor de roles, proveedor, cola o interfaz de conversaciones. Migraciones finales necesitan catálogo/propiedad coordinados; no se publica SQL de sandbox. S02-I01 y aceptaciones funcionales existentes se conservan.

Revisión obligatoria si cambia la cardinalidad de marca por cuenta, se exige varios escritores simultáneos o una conexión para varias cuentas CRM. Son cambios funcionales, no opciones que este diseño asuma.
