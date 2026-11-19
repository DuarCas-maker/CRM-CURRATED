# Publicación autorizada — 18/11/2026

Autorización explícita del usuario: «Sí, por favor, despliega estas mejoras en producción y verifica después que la aplicación cargue más rápido y sin errores». No hace falta repetir la confirmación del mismo despliegue.

## Destino y versión

CRM existente https://crm.finlabinc.com, repositorio DuarCas-maker/CRM-CURRATED, main; web Coolify rv8rpfxhf0mbxprge6h6ki9c y pipeline/webhook ya existente. Base remota verificada dadf98b593d467f8cc154ae99ebe35bf387b51d8. Integración aislada en rama codex/application-performance-release-20261118; conserva campañas, conexiones y usuarios ya publicados. El checkout coordinador y su WIP no se restauran ni se adelantan.

El candidato incorpora las optimizaciones de lecturas/recargas y la corrección de fechas que causaba React418 en Resumen. Sin SQL, variables nuevas, cambios de roles, transportes, infraestructura ni datos de negocio. Dockerfile existente: Node22, build reproducible, standalone, usuario sin privilegios y healthcheck HTTP. No se acredita Docker local porque no hay CLI disponible; compilación pública aislada Node22 y build Linux del pipeline son verificaciones distintas.

## Preflight y ejecución

1. Integrar solo archivos propios; revisar diff contra dadf98b, tipos, pruebas y build Node22. Hashes en integration.json. La conciliación de crm.tsx solo resolvió el import nuevo junto a los imports de Usuarios existentes.
2. Registrar baseline productivo autenticado sin guardar filas: lecturas GET de Workspace overview/pipeline/leads, tiempo observado por navegador, longitud del JSON y presencia de error. No son tiempos SQL aislados ni p95. La recarga anterior del Resumen llegó al error genérico con digest4193365490; la consola mostraba React418 antes del candidato.
3. Comprobar main de nuevo. Crear commit del candidato y ejecutar push fast-forward a main usando la autenticación Git existente. Ante avance concurrente, conciliar y repetir checks afectados; nunca force push.
4. Esperar el webhook existente y la nueva versión; no activar un redeploy duplicado. El mismo pipeline puede reconstruir el worker: conservar su modo/configuración y no ejecutar pilotos, reintentos de jobs ni llamadas de negocio.
5. Smoke HTTP anónimo: health200, login200, workspace401/no-store, Pipeline401, Master401. Confirmar recursos públicos de la versión nueva. No se recopilan claves públicas/privadas ni cookies.
6. Sesión humana existente con MFA: repetir GET anteriores y abrir Resumen, Oportunidades, Leads y Pipeline; observar carga completa, avisos y nuevos errores de consola. Comprobar desaparición de React418 y recargas sucesivas. Medir antes/después con el mismo mecanismo; informar variación y límites.

## Detención y reversa

Detener ante build fallido, pérdida de autenticación, errores nuevos de datos o versión incorrecta. Preferir rollback de imagen web a dadf98b; alternativamente revertir exclusivamente el delta propio en un commit posterior, conservando cambios concurrentes. Sin reversa SQL/restauración de datos. No borrar volúmenes, cambiar secretos, modos del worker ni ramas protegidas. No se necesita un dump nuevo para este cambio de lectura; no se acredita un nuevo ensayo de restauración.

## Evidencia y límites

El build local incluye todo el estado actual de main más este delta; no incluye archivos históricos/importación sin publicar del coordinador. Node22.23.4 disponible en toolchain local público y utilizado. Las pruebas que importan estilos necesitan loader CSS para render SSR en Node; el fallo basal de crm-readiness por case-flow-controls.css se comprobó con fuentes de prueba/Underwriting/CaseFlow idénticas a HEAD. El loader no cambia aserciones ni estilos del build.
