# Aceptación

AC01: dados los hashes del recibo F2, copiar solo archivos coincidentes y volver a comprobarlos; fallar ante un destino diferente.

AC02: dados A/B/C ficticios, instalar alta y control WC en ambos órdenes, comprobar conservación del catálogo y ausencia de acceso directo a ambos esquemas. Revertir DDL en memoria sin alterar la cola base.

AC03: con sesión AAL2 ficticia, iniciar/observar/materializar alta deja cuenta disconnected, live/sync false, sin credencial ni trabajos nuevos; un piloto de otra cuenta mantiene la selección exacta. Sin sesión válida se rechaza el alta.

AC04: dada una generación superior intercalada tras la validación inicial, la publicación inferior se rechaza CONNECT_STALE sin cambios. La entrega original debe demostrar la regresión. No se describe este test como concurrencia física.

AC05: regresión y typecheck sin red; fuentes protegidas y contador conservados. Rutas OAuth, operación Composio y PG15 combinada se declaran pendientes.
