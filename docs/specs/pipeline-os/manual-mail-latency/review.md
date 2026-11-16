# Revisión del cambio

Modo: revisión del diff propio contra FR/AC, tras pruebas; sin delegación. Inspeccionados worker/index, gmail sender, dispatcher, polling, SQL de claim y wrappers, ACL y candidatos previos B2. No se tocaron SQL históricos o fuentes de otros frentes.

Hallazgos corregidos: el nuevo helper debía conservar el mismo dueño que el claim previo para que sus ACL privadas no rompieran la llamada; se añadió preflight de dueño. Un envío lento de más de 30 s podía permitir un claim no manual del mismo buzón; se reprodujo con test rojo y se bloquea cualquier sending activo manteniendo el pacing de otros canales. Polling rápido durante una carga lenta podía abortarla repetidamente; se evita consultar mientras carga. La rotación evita monopolio de cuatro cuentas y el claim respeta manuales anteriores aplazados.

Sin defectos confirmados pendientes dentro del delta revisado. Límites: tres fallos previos de la suite amplia, integración sobre HEAD posterior y medición real tras autorización. No se certifica un SLA de Gmail o un resultado productivo por pruebas simuladas.
