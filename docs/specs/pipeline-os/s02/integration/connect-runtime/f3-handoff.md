# Entrega revisable F3 — CW-I02 y R06-I03

08/11/2026. Continuidad documental de T-007-R1, sin mensaje enviado a otro chat. F3 conserva únicamente su carpeta `docs/specs/pipeline-os/operations-pilot/**` en el worktree ef2d; no hay cesión de fuentes compartidas, runtime, SQL ni configuración.

La base Git sigue en50d2f916788c73c831d6e0ebe1cf29a1e9d6340a; el delta público actual se identifica mediante [CW-I02](manifest.json), [R06](../../transport-selection/manifest.json), [CW-I01](../connect-worker/manifest.json) y [WC](../../worker-control/manifest.json). Leer las fuentes públicas indicadas desde la carpeta del coordinador sin copiar `.local`, env, cuentas/contadores privados o dependencias. No igualar worktrees ni afirmar que el HEAD histórico contiene el delta no publicado.

Revisión documental esperada:

- Contrastar CTRL-001–011 con WC, selección R06, ciclos de recepción/versiones y guardas OAuth/push/watch. Separar pruebas offline de pausa/drenado real, replicación y recuperación aún no acreditadas.
- Revisar las seis pruebas de composición de alta y la separación candidato/identidad, grants C2 y transporte. El store usado es simulado; T-009 sigue fuera de la integración actual y no debe darse por aprobado por un fixture.
- Registrar la QA visual de fixture ya ejecutada en R06 (ES/EN360/768/1280 y orden Tab del panel) como parcial: quedan modal/hidratación/auth y recorrido de la app completa. No reconstruir ni repetir pilotos aceptados de recepción, adjuntos o importación.
- Mantener el alcance piloto BUZON-01 de un envío CRM y una respuesta manual, adaptado a Composio; no heredar presupuesto Gmail20+1 ni las43 peticiones de Instantly.

Salida: matriz documental con cubierto localmente/parcial/no probado/requisito operativo, citando test y fuente exacta. Sin ejecutar servicios, API, OAuth, mensajes, SQL remoto, cambios reales, push/deploy ni reanudar worker por recibir este documento. Publicación, asignaciones, habilitación y piloto son etapas distintas.
