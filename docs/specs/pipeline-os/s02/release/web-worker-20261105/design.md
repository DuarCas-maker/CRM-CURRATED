# Diseño — candidato conjunto ABC-WW-20261105

## Fuente y aislamiento

El checkout coordinador conserva todos sus cambios. Se captura un inventario previo antes de escribir documentos de esta entrega. El payload de 100 fuentes y las 10 dependencias de build se cotejan con el manifiesto aceptado; ninguna fuente de producto se modifica por empaquetar. Los documentos de esta preparación quedan fuera del digest de las fuentes para evitar referencias circulares.

La copia privada y el archivo de fuentes contienen solo archivos públicos seleccionados: src, worker, public, scripts, tests, supabase, documentación previa y manifests/config de raíz. Excluyen .git, node_modules, .next, .local, credenciales, logs y env reales. El inventario guarda bytes y SHA256 por archivo, más el digest del listado ordenado. El archivo de fuentes no incluye dependencias instaladas ni se presenta como una imagen de producción. No se utiliza ningún otro checkout.

## Servicios y SQL instalado

Web usa Dockerfile, Next 16.3.8, Node22, pnpm11.19.0, standalone, static/public, no-root y health de proceso. Worker usa Dockerfile.worker, tsx, mismo código src, no-root y heartbeat. Ningún CMD instala migraciones. El despliegue actual solo actualiza binarios; no debe ejecutar 048, 049 ni los cinco candidatos local.sql.

049 fue comprobada en el catálogo del CRM con contrato e9b0928a… y huella 6bb4165d…. No se deduce un ledger ni se rellena uno. La carpeta supabase/migrations sigue con 47 archivos históricos: convertirla ahora a 49 rompería fixtures que componen A/B/C aparte y no hace falta para este destino. Para una base nueva se conserva la secuencia documentada 001–047 → 048 → 049, con sus condiciones propias; no se automatiza aquí.

## Build y seguridad

La preparación usa únicamente runtime y dependencias locales. Los comandos de análisis usan el preload que bloquea conexiones. Ningún comando inicia worker/index.ts o pnpm worker, que arrancan el scheduler y sus jobs. La comprobación del worker analiza/compila la entrada sin ejecutarla.

La nueva prueba de capacidad pudo crear directorios profundos, pero symlink sigue fallando EPERM. Docker no está disponible y WSL no devuelve una distribución utilizable. El build standalone anterior falló precisamente en enlaces de dependencias. No se cambia output, se parchea Next o se declara build Linux correcto por una compilación distinta. Los Dockerfiles y lockfile se preservan para el build real posterior autorizado.

## UI y decisiones operativas

Los fixtures locales usan CSP connect-src none, datos sintéticos y handlers sin mutaciones reales. Las capturas no pueden acreditar permisos de producción ni flujos de backend. Se conserva la distinción entre validación SSR, inspección visual y teclado. El primer canal CUA agotó su espera; se puede usar la API Windows disponible para abrir solo fixtures locales en una ventana separada.

La publicación futura requiere revisar el commit exacto, versiones de ambos recursos y el mecanismo que impida el autoarranque del worker. No basta con que el contenedor esté healthy. La app nueva exige marcas/membresías/asignaciones revisadas por MFA para nuevos envíos; no se infieren de dominios y el legado no se reanuda automáticamente. Se prefiere corrección hacia adelante: volver a fb9f201 no revierte 049 ni acredita compatibilidad con sus guardas.
