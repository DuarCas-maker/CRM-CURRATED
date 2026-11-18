# CR-01 — Responsable creador

El usuario respondió 1A/2A/3B/4B y aclaró expresamente que conserva los cuatro intervalos +2/+3/+3/+5, sin domingos. 4B reemplaza la decisión inicial de conservar al asesor: los expedientes seleccionados por las campañas nuevas se asignan al usuario que crea la campaña.

STRICT: la asignación modifica acceso al expediente. Autorización de desarrollo/publicación integral vigente; no nueva aprobación por archivo. Solo cambia el lanzamiento futuro; no reasignar campañas, recibos ni casos históricos. El responsable se obtiene de auth.uid(), nunca de un seller_id del cliente. Se mantienen roles administrativos, MFA, selección exacta, marca y revalidación transaccional.

AC-CR01: audiencia seleccionada termina asignada al creador; payload no puede designar otro usuario; leads no seleccionados e historia intactos; cuatro intervalos intactos; replay conserva el resultado; reversa solo cambia lanzamientos futuros; ACL y rechazo de aal1/rol indebido permanecen.

Diseño: reemplazo acotado de public.campaign_flow_launch. Reutiliza la asignación que ya hace la activación heredada y retira la restitución del asesor. Conserva bloqueo de oportunidades, calendario y pasos. No tablas ni nuevos permisos. SQL up/down con hash de fuente antes de reemplazar. Nota visible en la configuración, sin añadir campos.

T-CR01-1 implementación local y T-CR01-2 pruebas completadas. T-CR01-3: respaldo reciente y SQL aplicados y verificados; publicación del cliente y lectura final pendientes. Ver verification.md.
