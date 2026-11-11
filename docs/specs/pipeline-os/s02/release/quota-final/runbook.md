# I05 — publicación conjunta propuesta

11/11/2026 · preparación, **ninguna operación remota ejecutada**. Destino previsto:
CRM Qrated, Supabase self-hosted en `https://supabase.finlabinc.com` y web en
`https://crm.finlabinc.com`, sobre el Coolify existente. No usar Admin Charles ni
un proyecto Supabase cloud diferente. Se conservan Gmail directo y las43 de Instantly.

## Paquete y orden

1. Leer [manifest.json](manifest.json), [verificación](verification.md) y el
   contrato052. Confirmar que las fuentes actuales y el ordinal no cambiaron.
   La base Git actual es00b0093; el WIP de I01–I04 y el archivo051 aún requieren
   un commit público revisado. No se ha creado un commit ni se ha hecho push.
2. Antes de autorizar operaciones remotas, revisar en los recursos existentes la
   imagen recuperable y los flags. El usuario confirmó antes worker paused y
   routing/Composio/webhook apagados; esta preparación no revalida la instancia.
   Conservar esos estados, sin reanudar campañas, sync, verificaciones o envíos.
   La decisión previa del operador sobre respaldo se conserva; no se afirma que
   exista una copia o restauración nueva. Registrar el punto recuperable real.
3. Con autorización específica, ejecutar **preflight.sql**, una vez y solo lectura,
   en el SQL Editor del Supabase self-hosted del CRM. Requiere PostgreSQL15,
   `supabase_admin`, base051 y ausencia de quota. Esperar `catalogOk:true`,
   `queueOk:true`, `mismatchCount:0`. `publicationReady:false` es deliberado: una
   lectura no acredita pausa de procesos, build Linux o permiso de publicación.
4. Con web/worker y otros escritores sin producir cambios, y aprobación concreta,
   ejecutar **052_integrate_mail_quota_and_existing_bindings.sql** COMPLETO,
   de BEGIN a COMMIT, una sola vez. No ejecutar I02/I03/I04 locales,048–051,
   prepare.mjs o los fragmentos de prueba en producción. La salida
   `checked_before_commit` se comprueba además con el paso siguiente.
5. Ejecutar **postflight.sql**, una vez y solo lectura. Esperar `targetsOk:true`,
   `initialStateOk:true`, `mismatchCount:0`. El script052 notifica la recarga del
   catálogo a PostgREST al COMMIT. No configura políticas, presupuesto, binding
   v2, rutas de proveedor ni flags. Ante fallo: conservar DETAIL, ejecutar
   únicamente `cleanup.sql` si la sesión quedó fallida y diagnosticar; no repetir052.
6. Antes del push autorizado: revisar remoto, rama, ancestro y diff sin force-push;
   incorporar SOLO fuentes públicas del manifiesto y las constancias de051,
   conservando WIP. Crear un commit nuevo que contenga la web y el worker juntos.
   El push a main puede disparar ambos despliegues automáticos: forma parte del
   permiso de publicación. No hacer push para obtener solamente una revisión.
7. Publicar ese mismo SHA en ambos recursos existentes y observar el build Linux,
   Success/Finished y health de cada contenedor. Mantener worker paused antes,
   durante y después. No instalar Docker/Postgres ni crear otro VPS. Si Coolify
   inicia los dos builds, observar recursos y no lanzar un tercer build/redeploy.
   Si falta memoria, detener y revisar el build afectado; no cambiar infraestructura
   o límites automáticamente. La revisión previa de RAM/disco es histórica.
8. Hacer el smoke acotado que se autorice: web carga/login/MFA, Configuración,
   preparación, Oportunidades y Conversaciones solo lectura; worker healthy y
   heartbeat reciente en modo paused, sin jobs ni llamadas de proveedor. No repetir
   pilotos ya aceptados de importación, adjuntos o recepción. Registrar SHA,
   despliegue y health de CADA recurso, junto con booleans de los controles.

Metadatos históricos del recurso, que deben contrastarse al publicar: proyecto
`gzbzm9radjjsrbgtufhi7x53`, entorno `xldygmbiax9prff0pgldqu5a`, web
`rv8rpfxhf0mbxprge6h6ki9c`, worker `vc4aybj4ucje7zstpsp3zboh` / `curated-worker`.
No se han consultado ni actualizado por API en esta preparación.

## Variables: solo nombres y estados previstos

| Variable                                                    | Web                        | Worker                  | Tratamiento                           |
| ----------------------------------------------------------- | -------------------------- | ----------------------- | ------------------------------------- |
| `WORKER_EXECUTION_MODE`                                     | no necesaria               | `paused`                | conservar, no arrancar operación      |
| `MAIL_TRANSPORT_ROUTING_ENABLED`                            | `false`                    | `false`                 | conservar                             |
| `MAIL_QUOTA_POLICY_ENABLED`                                 | `false`                    | `false`                 | nueva política aún no publicada       |
| `COMPOSIO_CONNECT_ENABLED`                                  | `false`                    | `false`                 | conservar                             |
| `COMPOSIO_BINDING_V2_ENABLED`                               | `false`                    | `false`/ausente         | panel v2 no expuesto todavía          |
| `COMPOSIO_BINDING_CHECKS_ENABLED`                           | `false`                    | `false`/ausente         | ningún check real autorizado          |
| `INSTANTLY_WEBHOOK_ENABLED`                                 | `false`/ausente            | `false`/ausente         | conservar                             |
| `COMPOSIO_MAIL_CONTEXT`                                     | privado, pendiente         | privado, pendiente      | no inventar ni compartir valores      |
| `COMPOSIO_EXISTING_AUTH_CONFIG_ID`                          | privado, pendiente         | privado, pendiente      | no completar por screenshots antiguos |
| `COMPOSIO_API_KEY`                                          | privado, pendiente         | privado, pendiente      | no leer/copiar en este turno          |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build y runtime existentes | según cliente existente | conservar el proyecto CRM correcto    |

La constante `composioProductOperationEnabled=false` se conserva en código. No hay
una variable que la cambie. Las credenciales Google directas y su organización
no se revocan. Los Dockerfiles existentes, usuario no-root, healthchecks y lockfile
se conservan; no ejecutan SQL al arrancar. Valores reales siempre en Coolify, no
en Git ni en el contexto Docker (`.dockerignore` excluye `.env*` y `.local`).

## Reversa

- Antes de COMMIT: ROLLBACK revierte052 íntegramente. El ensayo nativo lo verifica.
- Después de COMMIT, antes de uso: mantener flags apagados y worker paused; recuperar
  las imágenes revisadas de AMBOS recursos si hace falta. El esquema expandido es
  compatible con v1. No borrar tablas o restaurar funciones sobre datos nuevos.
- `rollback-disabled-unused.sql` es una opción acotada, que necesita autorización
  propia: verifica que no se publicó política ni se usaron checks/budgets/bindings
  v2, luego revoca las nuevas RPC. Conserva la cabeza sin política, el wrapper
  legado, todos los datos y contadores. No cierra la cuota global ni borra esquema.
- Si el incremento ya se utilizó, ese script falla; preparar la reversa operativa
  por buzón con conciliación. No hay fallback automático de un envío incierto.

## Qué cierra esta publicación y qué sigue

La publicación se acepta únicamente con052/postflight, mismo commit web/worker,
build Linux y ambos health verificados, controles apagados y smoke aprobado.
Entonces preparar la configuración privada/cupo y hasta4 consultas para Daniel,
sin enviar; después un corte piloto autorizado por separado. Publicar I05 no
activa Composio ni completa I04-B o Instantly C/D.
