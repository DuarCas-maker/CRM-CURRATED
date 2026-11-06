# S02-I01 — Frontera de transporte compatible y adaptador Composio

31/10/2026: el usuario autoriza implementar y probar offline el manifiesto de S02-I01, manteniendo Gmail directo activo y Composio sin selección productiva. No autoriza llamadas reales, envíos, cambios remotos o gasto de las43 peticiones Instantly. La preparación siguiente conserva su contexto histórico; esta autorización habilita T03–06 locales, no un corte de cuenta.

31/10/2026 · STRICT · **Modo implementación local**, autorizado después de la preparación. Se mantiene el alcance finito de ocho archivos y la aceptación existente; no autoriza merge, commit/push, despliegue, SQL remoto, OAuth o llamadas a proveedores.

## Problema y objetivo

El correo de producto llama a `gmail(accountId, path, init, beforeRequest?)` en `src/lib/server/google.ts`. Ese módulo reúne OAuth directo, reserva de cuota, callback final y HTTP Gmail. Composio ya tiene pruebas de proveedor S00, pero sus ejecutores no son el conector de la aplicación. Reutilizar el mismo acceso por cuenta exige separar el transporte sin duplicar reglas, colas, mensajes o permisos.

I01 preparará una frontera común, extraerá la ejecución HTTP directa y añadirá un adaptador Composio verificable por inyección. **La fachada de producto seguirá usando exclusivamente Gmail directo en este incremento.** No habrá selector por variable de entorno que cambie todas las cuentas ni conexión real activable por terminar el código.

## Aclaraciones y base aceptada

La revisión de aclaraciones reutiliza D01–D06/D23, RF27, las respuestas S01 25A/26A/27A/28A/29B/30 y la instrucción actual. No se crean decisiones humanas nuevas ni se vuelve a preguntar lo resuelto: migración gradual, identidad estable, caso/área/remitente separados, marcas revisadas y permisos reales independientes del acceso central Composio. El corte por cuenta está en RF27/T02-04; el mapa de decisiones humanas raíz termina en D24.

Aceptación heredada, sin reensayo: envío/recepción, conversaciones, adjuntos, descarga y vista previa según confirmación del usuario; importación/normalización y conversión posterior según las comprobaciones operativas registradas en [README](README.md). La prueba del transporte nuevo no reabre esos recorridos manuales ni los ensayos S00.

S01: T01-01 aprobado; I01 fundamento e I02 área/fuentes implementados localmente. No están en este checkout y T01-02 no está completo. T01-03 (correo opcional/canales) y T01-04 (baja de grupo) siguen pendientes. No confundir I02 de S01 con un futuro I02 de S02. Las marcas M1/M2 de S01 y los buzones M1/M2 de S00 son **alias de ámbitos distintos**, sin equivalencia asumida.

## Requisitos y trazabilidad

| FR | Requisito | Origen | AC |
|---|---|---|---|
| S02I01-FR01 | Conservar la firma pública de gmail y su camino directo por defecto; no cambiar IDs, cola, datos ni interfaces operativas. | RF07/RF14/RF27, aceptación humana | AC01/02 |
| S02I01-FR02 | Separar ejecución HTTP directa y proxy Composio con contrato de request/resultado común, sin un segundo motor comercial. | T02-01, AT02 | AC02/03 |
| S02I01-FR03 | Mantener cuota/API pacing y callback final fuera del proveedor, una sola vez por intento; no eludir permisos de S01 o del despliegue vigente. | D02, RF11/RF27/RNF01 | AC04/05 |
| S02I01-FR04 | Proxy ligado a la conexión exacta y su propietario de Composio; destino Gmail fijo y métodos/recursos limitados. Ninguna elección automática entre cuentas. | RF06/RF07, T00-03 | AC03/06 |
| S02I01-FR05 | Distinguir rechazo Google de fallo externo Composio y de resultado incierto; no fallback ni reenvío automático. | RF27/RF30, S00 | AC07/08 |
| S02I01-FR06 | Conservar MIME/raw, threadId, Message-ID, paginación, adjuntos y firma; no traducir IDs por proveedor ni reescribir cursores. | RF07/RF08/RF14/RF17 | AC02/09 |
| S02I01-FR07 | No introducir llamadas reales, migraciones, cambios de configuración/credenciales o dependencias; nuevos módulos solo servidor. | Alcance actual, RNF01/RNF07 | AC01/06/10 |
| S02I01-FR08 | Acotar la cobertura al transporte nuevo y documentar dependencias S01, propiedad y condiciones del corte futuro. | SDD, D24, coordinación | AC04/10 |

NFR: errores y logs con códigos fijos, sin cuerpos, destinatarios, secretos o IDs privados; fetch inyectable; abort/timeout y límites de lectura explícitos en Composio; sin red al importar módulos; Node22/TS/Zod y gestor existentes; ningún token Google sale de la capa servidor ni se extrae de Composio.

## Flujo previsto

1. Los comandos actuales siguen comprobando sesión/MFA, expediente, área y remitente, y encolando en el mismo outbox.
2. La fachada conserva OAuth directo, pacing/reserva actuales y el callback de recheck justo antes de HTTP. Solo cambia dónde reside la ejecución HTTP.
3. Composio implementa el mismo contrato para tests con bindings y fetch ficticios. I01 no lo selecciona desde rutas, worker, UI o variables reales.
4. Un incremento posterior resolverá el binding persistido/autorizado y el proyecto de cuota antes de poder cambiar una cuenta. No leerá el journal S00 como registro productivo ni recuperará un ID revocado desde env histórico.

## Casos especiales

Conexión equivocada/no confirmada: rechazar antes del proxy. Clave Composio rechazada: fallo de proveedor, no desconectar todos los buzones como si Google hubiera revocado su autorización. Outer200 con envelope inválido o timeout tras despacho: resultado desconocido, nunca repetir messages.send. Revocación de permiso durante reserva: callback veta antes de HTTP. Cuota limitada: mantener razón/origen y esperar a la política de cola existente; el adaptador no implementa retries propios. Identidad/proyecto desconocidos, IDs malformados o recurso no admitido: fallo cerrado.

## Fuera de I01 y condición de salida

No incluye S01 completo, UI de conexión Composio, migración/mapeo operativo, nuevas marcas, corrección de políticas de S01, cambios de campañas, automatización multicanal, cambios de histórico, SMS, triggers/webhooks Composio, Pub/Sub Composio o fase C Instantly. El módulo directo conserva watch/stop anteriores; el adaptador Composio inicial cubre polling y no promete compatibilidad de watch sin contrato posterior.

I01 está implementado y comprobado localmente contra los escenarios de [aceptación](acceptance.md), con Gmail directo activo y Composio sin selección productiva. [Evidencia](verification.md):33/33 pruebas nuevas y TypeScript/formato correctos. No se declara S02 ni el piloto Composio completados. Activar una cuenta requerirá integrar los contratos S01 y una autorización separada para el corte, sus costos y verificaciones nuevas.
