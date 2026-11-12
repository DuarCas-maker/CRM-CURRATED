# DV-PUB-r1 — publicación preparada de controles del verificador

11/11/2026 · SDD STRICT · modo preparación. Base publicada2730d27.
La solicitud actual prepara esta entrega; no autoriza push, deploy, SQL remoto,
cambios de variables, publicación de política, presupuesto o check real.

## Alcance confirmado y diseño

El incremento es DV-LIMIT-UI, ya implementado y probado offline. Reutiliza052
aplicada: **no necesita migración nueva ni repetir052**. Se publica apagado por
defecto; Gmail directo se conserva y la operación Composio sigue false en código.
Instantly permanece en43. Workerpaused, routing y webhook permanecen apagados.
No hay decisiones de negocio nuevas: cuenta/marca/Hobby y máximo4 ya confirmados.

DV-PUB-ADR01: publicar el código y habilitar su configuración son etapas distintas.
Esta entrega propone el mismo commit para web y curated-worker, por el flujo
existente de main. El worker no gana comportamiento nuevo; el repositorio y sus
fuentes src se reconstruyen con el mismo identificador. No arrancar sus trabajos.
La UI de administración solo aparecerá en una fase limitada posterior cuando sus
flags estén autorizados; publicar el código no certifica el cupo del proveedor.

No cambian Dockerfiles, dependencias, lock, worker, transportes o SQL. Los13 paths
del manifiesto de implementación son el delta de código/tests/preview/env.example.
Se incluyen sus documentos públicos de Daniel y publicación de este directorio.
El acta pendiente `quota-final/publication-result-20261111.md` queda fuera de esta
selección y se conserva como WIP independiente. No incorporar otros chats/archivos.
No crear commit por preparar; proponer el commit local después de la revisión final.

## Requisitos, aceptación y tareas

| FR / AC / T | Aceptación y evidencia |
| --- | --- |
| PUB01 / AC01 / T01 | HEAD y13 fuentes coinciden con controls-manifest.json; inventario explícito y SHA256, sin env/privados ni WIP ajeno. |
| PUB02 / AC02 / T02 | Revisión de rutas, DTO, UI, presupuesto4/TTL10min y autorización humana; evidencia27 pruebas y4 escenarios PG15 reutilizada si no cambió código. |
| PUB03 / AC03 / T03 | Compilar copia local de fuentes con valores ficticios y red bloqueada; distinguir compilación Windows de imágenes Linux pendientes. |
| PUB04 / AC04 / T04 | Tabla de flags, destino, preflight, presupuesto de smoke, criterios de éxito y rollback definidos antes del push. |
| PUB05 / AC05 / T05 | Preservar052, Gmail directo, Composio apagado, Instant43, WIP e índice Git. Cero solicitudes externas/cambios remotos en esta preparación. |

T01–05 se registran en controls-publication-verification.md. Los gates de ejecución
remota no se convierten en aprobados por terminar estos documentos.

## Destino y observaciones históricas

Repositorio `DuarCas-maker/CRM-CURRATED`, rama de destino main, dominio
`https://crm.finlabinc.com`. Coolify existente, proyecto CRM - CURRATED / production:
web `rv8rpfxhf0mbxprge6h6ki9c`; curated-worker `vc4aybj4ucje7zstpsp3zboh`.
La última publicación aceptada observó ambos en2730d2731ec871e80d3393f5c48d059496d95bb2,
healthy, con despliegue automático al push. Son datos históricos de la misma fecha,
no una lectura remota nueva. Revalidarlos antes de ejecutar el futuro push.

Dockerfiles existentes: Node22-alpine, pnpm11.19.0, frozen-lockfile, multistage,
usuario crm no-root. Web standalone3000 y health `/api/health`; worker con heartbeat
local. `.dockerignore` excluye env reales, .local, node_modules y .next. Tags de
Node con major flotante son una característica previa, no un pin por digest ni
un cambio introducido aquí. No ampliar esta entrega para cambiarlos.

## Configuración de publicación: todo temporal apagado

Revisar nombres/estados en ambos recursos, sin exportar ni compartir secretos.
**Esta preparación no escribe esos valores.** Si un guard está activo al momento
de publicar, detenerse y conciliar el estado; no cambiarlo sin autorización.

| Variable o guarda | Web | Worker |
| --- | --- | --- |
| COMPOSIO_VERIFIER_SETUP_ENABLED | ausente o false | ausente o false |
| COMPOSIO_VERIFIER_ACCOUNT_ID | ausente/vacía; sin asignar en esta entrega | no requerida |
| COMPOSIO_BINDING_V2_ENABLED | conservar apagado/ausente para este rollout | apagado/ausente |
| COMPOSIO_BINDING_CHECKS_ENABLED | false/ausente | false/ausente |
| MAIL_QUOTA_POLICY_ENABLED | false/ausente | false/ausente |
| COMPOSIO_CONNECT_ENABLED | false/ausente | false/ausente |
| MAIL_TRANSPORT_ROUTING_ENABLED | false/ausente | false/ausente |
| INSTANTLY_WEBHOOK_ENABLED | false/ausente | false/ausente |
| WORKER_EXECUTION_MODE | conservar su configuración actual | paused |
| composioProductOperationEnabled | false literal, sin cambio | false literal, sin cambio |

No copiar clave Composio, descriptor, OAuth, cookies ni credenciales nuevas. Las
dos variables nuevas son runtime, no NEXT_PUBLIC ni argumentos del build. Para
publicar apagado no es necesario crearlas en Coolify. Las variables públicas
Supabase de build y secretos existentes conservan su configuración actual.

## Protocolo futuro — propuesto, no ejecutado

1. Revisar candidato y checks locales. Acordar el SHA del commit local que se
   publicará y comprobar su árbol contra el manifiesto. Selección explícita de
   rutas, sin `git add .`, sin incluir .local/env. La preparación no crea el commit.
2. Con autorización posterior de publicación, consultar main remoto de Git y los
   dos recursos correctos de Coolify: repositorio/rama, guardas de la tabla, worker
   paused e imagen2730d27 recuperable. Sin claves en outputs. Detenerse ante drift;
   no hacer force-push, merge/rebase automático o guardar variables para resolverlo.
3. Push del candidato exacto a main solo con autorización explícita para ambos
   despliegues automáticos. No añadir un tag/release ni disparar Redeploy extra.
4. Observar ambos builds Linux existentes: mismo SHA, Success/Finished y health.
   Conservar orden/cola de Coolify; no forzar builds paralelos sobre este VPS.
   Registrar el nuevo log del worker paused, sin reanudar jobs ni llamar proveedores.
5. Ejecutar únicamente el smoke anónimo acotado siguiente, si queda autorizado
   junto con la publicación. No ejecutar los POST humanos de política/presupuesto.
6. Registrar SHA, IDs de despliegue, health, smoke y preservación del contador.
   No declarar verificación real de Daniel por estos resultados técnicos.

### Presupuesto propuesto del smoke

Máximo6 peticiones HTTP a la app, una por fila, sin cookies, secretos, reintentos
automáticos o redirecciones seguidas. Composio/Gmail/Instantly: **0 peticiones**.
Las dos peticiones nuevas de preparación usan solo UUID ficticio y flagoff, que
responde antes de sesión/descriptor/servicio. No hay autorización real del ensayo.

| Petición a crm.finlabinc.com | Esperado |
| --- | --- |
| GET `/api/health` | 200; statusok |
| GET `/login` | 200; HTML |
| GET `/api/workspace` sin sesión | 401 |
| GET `/api/mail/accounts/11111111-1111-4111-8111-111111111111/composio/verification-setup` | 404, no-store, control apagado |
| POST a esa misma ruta, Origin del CRM, Content-Type application/json y cuerpo `{}` | 404, no-store, control apagado; ninguna escritura |
| GET `/api/mail/composio/connect` sin sesión | 403; ningún OAuth |

Un status inesperado detiene el resto del smoke; conservar diagnóstico saneado,
sin repetir peticiones para buscar una variante que pase. La navegación humana
MFA y la configuración/check real quedan fuera de estas6 peticiones técnicas.

### Éxito, detención y reversa

Éxito de publicación: ambos recursos en el SHA autorizado y healthy, workerpaused,
guardas off, smoke6/6 y cero operaciones de proveedor. Linux/build/health todavía
pendientes hoy: la compilación local no los sustituye.

Ante fallo de build, conservar imagen previa; no borrar caches/volúmenes ni
instalar nada. Ante un despliegue parcial, detener las acciones posteriores y
mantener el workerpaused; registrar qué recurso avanzó. Reversa propuesta:
imagen2730d27 previamente recuperable de ambos recursos, confirmada otra vez en
preflight. No repetir052 ni ejecutar rollback SQL, borrar políticas/recibos o
resetear contadores. Si apareciera uso del control fuera de alcance, conciliarlo
antes de decidir una reversa; no asumir estado sin uso.

El respaldo/restauración DB no se vuelve a ensayar en este delta de código apagado
sin migraciones o escrituras. La imagen recuperable es la reversa pertinente;
no se declara que exista un backup remoto reciente por esta preparación.

Después: configurar una única cuenta de forma limitada y autorizada, confirmar
cupo incluido actual (al menos2 Proxy Execute, costo adicional0), publicar política
y conceder presupuesto desde superadmin/MFA. Check real máximo4 y transporte son
etapas separadas; publicar esta versión no consume esas peticiones.
