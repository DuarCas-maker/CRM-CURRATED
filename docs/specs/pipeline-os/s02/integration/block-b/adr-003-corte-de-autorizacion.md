# S02-ADR-003 — Snapshot de intención y corte final registrado

31/10/2026 · Propuesta técnica de B. Concreta la sección de concurrencia del diseño S01 aprobado; no cambia sus reglas de negocio ni autoriza implementación.

La cola y Gmail no comparten una transacción. El worker ya dispone de claim, reserva de cuota, hook final y Message-ID; una comprobación aislada de marca en UI o al crear campaña no cubre cambios posteriores ni escrituras de servicio.

Decisión: snapshot inmutable de la intención autorizada, revalidación SQL en claim y corte final con orden de locks común a revocación/asignación. Registrar admisión antes de HTTP: un intento por admisión y máximo uno en curso por intención. Un rechazo conocido por cuota conserva el diferimiento actual y puede dar lugar a otra admisión revalidada; una respuesta perdida no. Marca/membresía/reactivación cambian revisión y nunca refrescan automáticamente pendientes. El snapshot se deriva de estado y sesión/procedencia confiables, no de JSON del caller.

Garantía: revocación confirmada antes del corte bloquea el intento. Si el corte ocurrió primero, puede existir una petición en curso; una revocación posterior detiene nuevas admisiones, pero no permite afirmar que Gmail retiró la anterior. Expiración de admisión no implica «no enviado»: reconciliar por el mismo Message-ID, sin segundo POST o fallback directo/Composio. No mantener transacciones durante HTTP.

Alternativas descartadas: guardar solo brand_id en cuenta y consultar el pasado dinámicamente; aceptar un snapshot proporcionado por servicio sin comprobar origen; mantener un lock de DB mientras responde Gmail; marcar desconocido como fallo reintentable; globalizar marca dentro de can_case; proteger solo claim comercial y omitir notification o test de campaña.

Consecuencias: hay cambios tanto SQL como worker y fixtures. B1 no puede publicarse como protección de despacho completa. PGlite/transportes falsos verifican decisiones y órdenes controlados; PostgreSQL multiconexión y versiones reales son gate separado antes de promover. Reversión conserva el cierre de área A y evidencia, sin reinstalar021 o reanudar cola por cambiar un flag.
