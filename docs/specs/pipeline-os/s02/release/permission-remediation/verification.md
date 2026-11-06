# Evidencia de preparación PRM

**Constancia de preparación histórica:** la implementación posterior tiene [evidencia propia](implementation-verification.md) y [manifiesto](implementation-manifest.json), con 42 pruebas nuevas correctas. La constancia siguiente registra el estado anterior sin implementación y no se reescribe como si sus checks fueran esos tests.

01/11/2026 · SDD STRICT/planificación. Se analizó la salida PD-R1 ya aportada y las fuentes locales; no se hicieron llamadas reales ni se cargaron env. [Plan y límites](README.md).

## Evidencia nueva

- 28 objetivos únicos, todos anon vacío. authenticated: 23 SELECT, 2 CRUD y 3 sin acceso directo. Se conserva exactamente CRUD de mail_drafts y mail_recipient_selections según 021/040 y los handlers con sesión; derechos del worker por service_role fuera del recorte.
- 70 firmas de función inventariadas con menciones literales `.rpc`/referencias SQL y límite explícito de llamadas dinámicas/indirectas. Ninguna se marca prescindible por ausencia de literal. No revocación de funciones o defaults incluida en PRM1.
- Las seis dependencias sobrantes de PD-R1 coinciden con MD5 del descriptor self-relación de la vista usando el algoritmo del diagnóstico. Este check local explica metadata, no prueba predicados de vistas. Las tres definiciones siguen pendientes.
- Fuentes vigentes de vistas verificadas: 007/024/043. Se detectó que B2 local modifica campaign_workspace, por lo que esa definición futura no se usa como referencia de la base actual.
- Rutas userClient y worker/serviceClient examinadas: workspace, borradores, selecciones y uso Gmail. La matriz conserva evidencias de paths y migraciones, sin claves, cookies, IDs de clientes o contenido de mensajes.

La preparación no ejecutó pruebas funcionales nuevas ni reejecutó las 32 de PD/139 anteriores. Los checks son de datos de catálogo ya recibidos, cardinalidades/derivación de hashes, JSON/enlaces/formato/conservación. Los ensayos DCL/DML/tokenizer de PRM-T04 son futuros y todavía no existen.

## Revisión y límites

Revisión propia frente al alcance: no código productivo, SQL final, migración numerada, UDF, cambio de defaults, Storage o helpers de PD-R1. RLS/TRUNCATE y defaults de funciones se tratan por operación y origen; no se propone una revocación general por esquema. No se afirma identidad del servidor o frescura distinta de la evidencia aportada por el operador.

La [auditoría final](preparation-manifest.json) comprueba que se conservan las 100 fuentes ABC, código/SQL/tests de PD-R1, 47 migraciones, 49 hashes operativos, HEAD/index y todos los archivos públicos ajenos salvo referencias documentales explícitas del coordinador. Las matrices generadas son metadata pública derivada, no copia de archivos privados. Los hashes comparativos MD5/SHA no son firmas de autenticación.

G0–G3 del plan cubiertos; G4/QA de PRM y promoción G5/G6 pendientes. Sin cambios remotos, implementación de PRM, consultas, instalaciones, servicios, push/deploy o envíos. Gmail directo activo, Composio deshabilitado por alcance conservado; Instantly 43/0 nuevas. El runbook de recuperación está definido, no ejecutado. Siguiente paso PRM-T03/04 offline por instrucción posterior.
