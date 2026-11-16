# Escenarios

1. Un análisis manual previo o informe draft/rejected/outdated no completa riesgo; un informe IA aprobado vigente sí. Rechazar uno no elimina la aprobación válida de otro.
2. No hay botón Registrar análisis ni check de entrega. El responsable puede continuar antes de handed_off_at, pero un usuario ajeno/inactivo/sin MFA no ve ni modifica el flujo.
3. Riesgo aprobado sin envíos → Pendiente de lenders; cola/incierto conserva esa lista; correo confirmado al lender → Oferta y negociación sin exigir oferta todavía.
4. Ofertas de A y B pueden coexistir; elegir A no retira B. Elegir B después deja una sola selección. Dos solicitudes concurrentes no dejan dos elegidos ni pierden una corrección sin avisar.
5. El monto final acordado no crea funded_at ni actual_funded_amount; cero/negativos/textos/conflictos/mezcla de casos se rechazan.
6. Un hito manual requiere motivo y respaldo del caso. Volver a automático conserva auditoría. No permite inventar un informe aprobado, una oferta, un lender elegido o desembolso.
7. Abrir/reabrir/cambiar de hilo no escribe registros ni dispara modelos/envíos. Respuestas viejas se abortan; errores no se convierten en estados vacíos.
8. Renovaciones y cuentas conservan su ámbito; no se cambian grants de envío. Mobile 360, tablet 768 y desktop 1280, foco y formularios sin perder cambios.
