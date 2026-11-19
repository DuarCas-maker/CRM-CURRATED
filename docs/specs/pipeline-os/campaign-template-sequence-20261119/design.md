# Diseño / ADR

Causa: presets incluyen identidad fija en :::signature; renderCampaignContent produce data-crm-signature y el sender omite la firma de Gmail. El editor oculta steps aunque FlowComposer los consume si hay cuatro.

Se conserva el sender existente: quitar el bloque de firma del contenido versionado permite que cada envío use settings/sendAs del mismo account_id. El preview consulta ese mismo recurso con una ruta fija y cuenta validada; firma en iframe sandbox/CSP, sin imágenes remotas. Nunca se construye una identidad desde el operador que crea la campaña.

Un módulo puro centraliza defaults ingleses, intervalos y normalización. Editor por cinco pasos reutiliza CampaignEditor; el servidor valida y normaliza al guardar. Una migración aditiva añade un RPC de contexto humano para preview, con controles de marca/MFA y revisión de ruta. No concede credenciales ni capacidades de envío. El scope Node es local a esa lectura, revalidado antes de credenciales/cuotas/wire.

Migración de contenido: versiones actuales con firma explícita o sin secuencia reciben cuerpo sin bloque y cuatro defaults ingleses cuando steps está vacío. Se conservan secuencias personalizadas; cada cambio crea una versión e historial, con journal privado de before/after. Reversa exige que la versión actual siga siendo la aplicada; no sobrescribe ediciones posteriores. Campañas existentes retienen sus snapshots.
