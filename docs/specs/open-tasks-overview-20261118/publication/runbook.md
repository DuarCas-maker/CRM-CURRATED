# Publicación autorizada — tareas abiertas

2026-11-18, America/Bogota. SDD STRICT para G6, sobre implementación STANDARD con G5 local completado.

## Autorización y objetivo

El usuario autoriza explícitamente: «Sí, despliega estos cambios en producción para que la tabla y los filtros ya aparezcan en el CRM». Cierra la aclaración de alcance de publicación: mismo CRM existente, tabla/filtros aprobados en esta conversación. No se solicita otra confirmación de esa misma operación.

Destino verificado: https://crm.finlabinc.com/pipeline-os, repositorio DuarCas-maker/CRM-CURRATED, main. Web Coolify rv8rpfxhf0mbxprge6h6ki9c y webhook existentes; worker vc4aybj4ucje7zstpsp3zboh puede reconstruirse por el mismo push. No se cambian sus modos, proveedores, colas, variables o infraestructura. No se ejecutan envíos ni migraciones.

## Candidato y compatibilidad

Base inicial observada: 8866e84. Antes de publicar llegó 7dde2e8c6414fc404dc3bc05655b9ad09aa9975a, corrección del receptor nativo de fetch; se incorporó por fast-forward y es la base final y versión anterior recuperable. Release propio aislado en `.local/open-tasks-release-20261118`, rama `codex/open-tasks-release-20261118`; no se modifica HEAD, índice o WIP del coordinador.

Se reciben únicamente las seis fuentes nuevas, seis fuentes de pruebas/fixtures, dos scripts y documentación propia. Los dos compartidos se integran por diff de tres vías, preservando CampaignFlowPanel, plantillas, flujo actual de etapas y optimizaciones ya publicadas. El único conflicto fue la coincidencia de imports LenderTemplateLibrary/OpenTasksOverview; ambos se conservan. La prueba del lector se adapta al RPC campaign_flow_cases ya presente en producción, conservando las aserciones de permisos. La fuente actual de Campañas agrupa contactos únicos: se limitan campañas a campaign_group_members visible y se deduplican contact_id en total/responsable/cuenta, reutilizando campaign_contact_facts. FR-002 conserva su intención de coincidir con la pantalla existente.

Dockerfile existente: Node22, pnpm 11.19.0 con lockfile congelado, standalone, usuario sin privilegios y healthcheck /api/health. Sin nuevas variables, dependencias ni SQL. No se necesita un nuevo respaldo de datos: este incremento solo publica código de lectura; la versión anterior queda identificada para recuperación.

## Secuencia

1. Comprobar sesión y salud productivas sin registrar filas de clientes. Registrar ausencia previa del nuevo endpoint y tabla.
2. Congelar el delta de release contra la base actual y verificar que solo incluye tareas abiertas. Ejecutar tipos, pruebas relevantes y build aislado; no copiar env ni material privado. Verificar que el WIP del coordinador conserva sus huellas.
3. Registrar commit local y comprobar de nuevo main. Publicar mediante fast-forward al pipeline existente. Ante avance concurrente, conciliar y repetir checks afectados; nunca force push.
4. Esperar el webhook, sin redeploy duplicado. Comprobar HTTP health200/login200, nuevo GET anónimo401/no-store y filtros inválidos400.
5. Recargar la sesión humana existente con MFA, abrir Tareas abiertas, observar tabla/cuentas/etapas y alternar responsables/cuenta/estados. Guardar solo agregados y evidencia sin filas de clientes, cookies o credenciales. Comprobar consola y lecturas después de estabilizar el rolling update.
6. Registrar commit, estado efectivo, smoke, limitaciones y reversa en result.md. Si no hay acceso a logs de Coolify, no inventar UUID ni estado del worker; distinguir evidencia HTTP/UI de inspección del contenedor.

## Aceptación de publicación

- PUB-AC01: rama main conserva la base y únicamente añade el delta previsto; WIP del coordinador intacto.
- PUB-AC02: build/tipos/regresión de la base integrada pasan sin alterar permisos ni contratos publicados.
- PUB-AC03: endpoint nuevo protegido; salud pública estable y recursos nuevos efectivos.
- PUB-AC04: tabla inicial y filtro de responsables/cuentas se observan con la sesión existente, sin crear datos de negocio.
- PUB-AC05: evidencia sin secretos ni datos de clientes; pendientes reales declarados.

## Detención y recuperación

Detener la promoción ante errores de build, diferencias fuera de alcance o pérdida de autenticación. Si hay un defecto tras publicar, volver a la imagen web de 7dde2e8 conservando configuración y datos; alternativamente publicar un revert exclusivo del delta propio sobre el main actual. No restablecer main por force, no restaurar toda la base ni revertir SQL/roles/transportes. La aprobación actual cubre este despliegue; cambios de infraestructura o migraciones siguen fuera de alcance.
