# Corrección de hidratación — publicación de seguimiento

13/11/2026 UTC. Solicitud del usuario: «corrige ese error de hidratación y luego hagamos el piloto con un correo real». Corrección LITE de presentación; publicación de seguimiento de la entrega en producción para ejecutar el piloto solicitado. Se conserva el destino y pipeline de `publication.md`, con base `22e84f206201831493ac4e15cf56d84ce13b152a`. El piloto real tiene una selección/revisión separada; este cambio no lo ejecuta.

## Diagnóstico y diseño

H1 confirmada: `Intl.DateTimeFormat` en el encabezado se ejecutaba durante SSR y primera renderización del cliente sin zona explícita. Para `2026-11-13T04:00:00.000Z`, el mismo componente produce viernes 13 en UTC y jueves 12 en Bogotá. La nueva prueba de render completo falló con esos textos y huellas diferentes antes del arreglo. La función no depende de una nueva consulta o registro de correo.

H2 descartada como causa de este caso: respuestas de correo o cambios entre consultas; la reproducción usa exactamente el mismo snapshot sintético en ambos entornos. H3 descartada para la reproducción: extensiones del navegador o HTML modificado, porque se reproduce en React server renderer sin navegador.

El estado `ready` ya existente permanece false durante SSR y primera renderización del cliente, y pasa a true en el efecto de montaje. El encabezado ahora emite `<time datetime=...>—</time>` inicialmente y, al montar, muestra la fecha local con el locale actual. No se fija una zona comercial global, se silencia React ni se cambia el formateador compartido. El resto de fechas en tablas/informes aparece tras navegación cliente; no forma parte del SSR inicial de esta pantalla.

## Requisitos, tareas y verificación

| FR / AC / T | Criterio | Evidencia |
| --- | --- | --- |
| HYD01 / AC01 / T01 | HTML inicial idéntico con el mismo snapshot al cambiar zona horaria | Prueba nueva de `pipeline-os-module-ui.test.ts`: UTC frente a Bogotá/Nueva York/Tokio, ES/EN; falla antes y pasa después |
| HYD02 / AC02 / T02 | Fecha local e interacción conservadas tras activar la pantalla | Demo del build con servidor TZ=UTC en navegador real: jueves 12 visible, recarga sin errores/advertencias observados |
| HYD03 / AC03 / T03 | Sin impacto en análisis/aprobación, permisos, esquema o worker | 28 pruebas relacionadas aprobadas; TypeScript y build Next 16.3.8/Node22 aprobados; solo componente y test modificados |
| HYD04 / AC04 / T04 | Corrección disponible en producción antes del piloto, worker paused | Gates y acta posterior; no SQL ni variables nuevas |

QA aislada sin env/credenciales/proveedores; todas las fuentes src cotejadas por hash contra la copia QA. Build webpack de 50 páginas completado; no se afirma equivalencia con el build Linux/Turbopack de Coolify. Navegador: recarga y fecha correctas, cero entradas error/warn, 360/768/1280 CSS px sin desbordamiento. Revisión del diff: montaje reutiliza estado existente; sin cambios a autorización, APIs, persistencia o dependencias.

## Runbook y reversa

1. Revalidar main remoto en `22e84f2`, web/worker del mismo recurso, worker paused e imagen `22e84f2` recuperable. No guardar la configuración pendiente de Coolify.
2. Seleccionar únicamente componente, test y documentación/manifiesto propios; preservar actas y WIP previos. Commit y avance fast-forward de main por el pipeline existente. No force, SQL, cuentas, OAuth o cambios de infraestructura.
3. Observar ambos builds Linux y healthy/Finished; confirmar log nuevo del worker paused. Reversa de código: imagen `22e84f2` en Coolify; SQL 053 permanece instalado.
4. Abrir una pestaña nueva autenticada de Pipeline OS y recargar; esperar DOMContentLoaded y la interfaz interactiva. Confirmar fecha local, ausencia de nuevas entradas React #418/error/warn y lectura de revisión. Salud/login 200 y APIs protegidas 401 sin sesión.
5. Registrar resultado de producción localmente para no disparar otro despliegue solo por completar el acta. El piloto empieza después de esta verificación y selección concreta de un correo; reutiliza la configuración de OpenAI confirmada por el usuario, sin crear/copiar claves.

No hay cambios de datos por esta corrección; el respaldo pre053 sigue documentado en el acta anterior y no se restaura. Una llamada real de IA y la aprobación de sus datos se registrarán por separado; no se ocultan fallos ni se reintenta automáticamente un consumo incierto.
