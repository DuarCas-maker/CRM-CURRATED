# Evidencia de preparación PD

Constancia histórica de preparación. El usuario autorizó después implementar y probar offline: [resultado actual](implementation-verification.md),32/32 pruebas nuevas y TypeScript correctos en PGlite18; ejecución nativaPG15 sigue pendiente. Este documento y preparation-checks no se reescriben como si hubieran ejecutado SQL remoto.

01/11/2026 · Planificación SDD STRICT. [Protocolo](README.md). Revisado el resultado aportado por el usuario; no hay una sesión DB activa del agente.

## Checks nuevos de preparación

- Input JSON válido, clave `pipeline_os_abc_catalog`, READ ONLY on; contexto con lectura suficiente para la consulta informada. Metadata de206 funciones/93 relaciones comparada con referencia creada desde las47 migraciones del repositorio en PGlite descartable y sin conexión.
- 28 diferencias ACL públicas desglosadas en22 tablas/6 vistas.70 funciones con EXECUTE extra solo para service_role; ningún cambio humano/PUBLIC en la comparación recibida. No significa exposición de filas demostrada o grants aceptados.
- Las619 constraints que faltan respecto al fixture son todas tipo n. Columnas públicas no difieren en metadata respecto al fixture; una huella FK sigue abierta.205 huellas funcionales difieren; normalizar únicamente CRLF→LF en la definición sintética no resolvió ninguna adicional (1/206 coincide antes y después). Hipótesis solo-CRLF no aceptada.
- Ocho huellas de policies/tres de vistas y objetos extra de Storage inventariados, sin inventar expresiones reales a partir de hashes.
- Inventario público derivado sin cuerpos de funciones, input privado copiado, DSN, identificadores de clientes o direcciones; conserva únicamente metadata/hashes/conteos agregados de la consulta ya recibida.

Estos checks son análisis nuevo de catálogo, no reejecución ni suma de las139 pruebas funcionales aceptadas. Los ensayos usan un preload offline que bloquea red de negocio; no se iniciaron worker, servidores o servicios. La documentación primaria consultada sobre PostgreSQL no es una llamada al Supabase/Instantly/Composio del proyecto.

## Alcance de la conservación y checks de entrega

El baseline de este incremento contiene651 archivos públicos y49 hashes operativos del coordinador. Se permite únicamente este directorio nuevo y enlaces de estado en `release/runbook.md`, `release/tasks.md`, `release/verification.md`. No se modifica código, tests del producto, fuentes SQL finales/locales, manifests/lockfiles, fixtures, AGENTS, checkout S01, HEAD o index. El hash de las100 fuentes del payload debe seguir siendo el de ABC-20261031-prep1. La auditoría de formato/enlaces/JSON/hashes se registra en `preparation-checks.json` al cerrar; ninguna línea PASS en este documento sustituye ese reporte.

## Sin ejecutar

PD-R1, runner/comparación final y fixtures de fuentes ACL todavía no implementados; no se presentan pruebas de esos componentes como aprobadas. No PostgreSQL15 independiente, lectura remota de defaults/membresías/definiciones, grants/revokes/SQL de aplicación, corrección, bootstrap, commit/push/deploy, QA visual/build/worker o consultas a proveedores. No se volvió a confirmar el estado remoto de flags/colas.

G0–G3 del protocolo cubiertos; implementación/QA de PD pendientes. REL-T03 parcial, promoción G5/G6 sin aprobar. Instantly43/0 nuevas, Gmail directo activo y Composio deshabilitado por alcance preservado. No existen cambios de datos que revertir; rollback documental/ROLLBACK futuro en README. Siguiente paso T03/04 offline mediante instrucción posterior, no ejecutar remoto.
