# ADR004 — evidencia de asociación separada del escritor

C1 implementado localmente tras autorización posterior, sin cambiar esta decisión. [Evidencia C1](c1-verification.md). C2 implementado offline sin cambiar esta decisión: [evidencia C2](c2-verification.md). C3 compuesto/probado offline sin cambiar esta decisión: [evidencia](c3-verification.md). QA pendiente y cualquier activación/promoción siguen abiertas; el alcance de preparación original siguiente se conserva como registro histórico.

31/10/2026 · Concreción técnica propuesta para C sobre ADR002, S01 y B2. Solo preparación; no autoriza implementación o uso externo.

## Contexto

I01 exige `ResolvedComposioBinding.status="active"`; B2 protege el egreso con revisión de marca/cuenta/actor. Confundir verified con active habilitaría un transporte antes de conciliar cola/escritor. Reutilizar `mail_accounts.brand_revision` como revisión técnica de cada candidato también invalidaría correos Gmail directos aunque no haya cambiado la marca.

## Decisión

Conservar los tres ejes: revisión de marca B, revisión técnica de asociación C y selección de escritor posterior. C tendrá persistencia restringida del candidato, una cabecera CAS por cuenta y comprobaciones ligadas a versiones. El verificador usa dependencias explícitas falsas; la evidencia no llega del navegador. La aprobación humana posterior produce verified, nunca active. No se modifica fachada, worker, factory ni se agrega un resolvedor activo.

Una cabecera técnica propia evita el CAS ambiguo sobre «ninguna fila» y conserva monotonicidad tras revocar/reemplazar, sin tocar la revisión comercial B2. La comprobación separada permite terminar/rechazar una respuesta tardía sin adulterar otro candidato y preservar evidencia mínima; no es otra cola ni sistema de permisos.

## Alternativas descartadas

- IDs en s00.env como persistencia: carecen de revisión, permisos y relación estable con el CRM; son solo configuración del ensayo aceptado.
- Registrar otra cuenta CRM o reautorizar los buzones por preparar C: duplica historia o efectos sin necesidad.
- Extender `brand_revision` para cada candidato técnico: pausaría intenciones directas por un cambio que no selecciona proveedor.
- Crear binding activo desde JSON verified o mapear al adaptador existente: confunde asociación y corte operativo.
- Revisar conectividad con firma/envío de prueba: no aporta prueba de asociación que justifique repetir pilotos ni está autorizado.

## Consecuencias y revisión

C puede implementarse/probarse aislado conservando A/B/I01; añade persistencia mínima y un panel pequeño. El camino real de verificación y el corte de escritor tendrán sus protocolos posteriores. Proyecto Google no demostrable, contrato externo cambiado o identidad desconocida bloquean; no se resuelven infiriendo datos.

Reabrir solo si se pide activar Composio, permitir varios escritores, compartir conexión entre cuentas CRM o delegar administración. Cambiar alguno requiere decisión funcional nueva y actualizar especificación/presupuesto antes de implementar.
