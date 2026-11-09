# Construcción controlada A/B/C — CB-20261106-r1

06/11/2026 · SDD STRICT · modo planificación. [Protocolo](protocol.md), [diseño y decisión](design.md), [aceptación](acceptance.md), [tareas](tasks.md), [verificación](verification.md), [manifiesto](manifest.json).

## Contexto, objetivo y alcance

Preparar dos imágenes Linux/amd64 del candidato ABC-WW-20261105 en el VPS existente del CRM, sin publicar ni arrancar aplicaciones. El operador aportó evidencia de Docker29.7.2, cuatro CPU, RAM5.8GiB/available2.4GiB, swap4GiB/usada1.7GiB y disco disponible76GB, con33 contenedores activos. Es una instantánea aportada, no una consulta del agente ni una garantía de capacidad futura. El uso de swap no prueba actividad actual de paginación.

El responsable de ejecución futuro será el operador del servidor; el coordinador revisa fuentes y evidencias. Los chats F2/F3 conservan sus ámbitos documentales. No se cambia producto, Dockerfiles, dependencias, infraestructura o configuración en vivo por preparar este protocolo.

Flujo futuro: preflight → autorización exacta → traslado verificado → constructor acotado → web → control intermedio → worker → inspección sin arrancar → cierre/evidencia. Dos builds exitosos no acreditan QA visual, permisos de producción, piloto o preparación de despliegue.

## Requisitos y trazabilidad

| FR / AC        | Requisito verificable                                                                                                                                                                             | Tarea     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| CB-FR01 / AC01 | Usar el archivo sellado de776 fuentes y su inventario; distinguirlo del commit WIP50d2f91 y de la documentación posterior.                                                                        | CB-T01    |
| CB-FR02 / AC02 | Preservar payload100/soporte10/operativos49; Gmail directo, Composio apagado e Instantly43. Ningún SQL048/049 ni API de negocio.                                                                  | CB-T01/06 |
| CB-FR03 / AC03 | Constructor propio con memoria/CPU verificadas, un solver y un build a la vez; no alterar el builder predeterminado ni contenedores ajenos.                                                       | CB-T02/04 |
| CB-FR04 / AC04 | Admitir la ejecución solo con capacidad reciente, vigilancia y cancelación concretas. Fallar cerrado sin aumentar límites ni liberar recursos ajenos.                                             | CB-T02/04 |
| CB-FR05 / AC05 | Autorizar por separado descargas públicas y egress restringido; no copiar env/secretos ni habilitar proveedores. Web incorpora solo sus dos variables públicas reales, revisadas por el operador. | CB-T03    |
| CB-FR06 / AC06 | Registrar logs, resultado, versiones/digests, configuración pública por huella e inspección de imágenes; cero procesos de aplicación iniciados.                                                   | CB-T05    |

## Calidad, reglas y límites

- NFR01: una imagen por vez; máximo45 minutos por imagen y2 intentos totales, uno por Dockerfile. Un fallo requiere revisión antes de cualquier reintento.
- NFR02: política inicial propuesta de2GiB RAM, sin swap adicional para el constructor, cuota de1 CPU y paralelismo1. Son límites de este ensayo, no requisitos universales de Next ni garantía de que el build quepa.
- NFR03: fuente pública exacta, sin secretos de servicio o datos personales; logs guardados fuera del contexto, sin compartir valores de configuración.
- No objetivos: instalar software en host, cambiar Docker/WSL/Coolify/firewall global, detener servicios existentes, construir hoy, despliegue, pruebas C/D de Instantly, QA visual o repetir aceptación de correo/adjuntos/importación.
- No se solicita respaldo nuevo ni se reabre la decisión histórica del usuario. No hay migraciones ni cambios a volúmenes de negocio en este incremento.

## Clarificación y decisiones existentes

La ronda se cierra con las instrucciones expresas ya recibidas: VPS existente, preparar únicamente el protocolo, sin construir/instalar/desplegar, con Gmail directo y43 preservados. No hay nueva decisión funcional que preguntar. Los límites técnicos se proponen en el diseño, no se presentan como parámetros aprobados para ejecutar. Acceso, ventana, configuración pública, egress y capacidad son precondiciones futuras verificables; ninguna se presume resuelta.

No se elige otra cuenta/proyecto, máquina pagada o servicio cloud por este documento. Modelo de datos, interfaz nueva y permisos de usuarios de la app: no aplica; se conserva lo existente.

## Estados y casos negativos

`prepared` → `preflight_passed` → `authorized` → `web_built` → `worker_built` → `inspected` → `closed`. Falta de capacidad/egress/plugin/huellas produce `blocked_before_build`; fallo/OOM/presión produce `stopped`, sin avanzar a la siguiente imagen. La autorización debe cubrir el constructor temporal, descargas, imágenes locales e inspección de contenedores detenidos. No se heredan permisos de pruebas anteriores.
