# QGR-I03 — admisión Gmail y verificación v2 (STRICT)

Actualización10/11 posterior a este diseño: [CR-TI01](i03-tokeninfo.md) concreta la
fuente efectiva mediante Google tokeninfo por proxy. El retorno null incondicional
descrito abajo es histórico; su reemplazo conserva el cierre ante falta de prueba,
el gate de activación y la compatibilidad real pendiente. Ver evidencia TI.

10/11/2026. Implementación y pruebas offline autorizadas. Gmail directo conservado,
Composio apagado, Instantly43. Sin remoto, API de negocio, env reales o despliegue.
SDD + automation-engineer; supabase-engineer para los RPC locales. Las decisiones de
negocio ya están aclaradas en CR-QGR01; no se infiere una respuesta nueva del operador.

## Inventario y diseño concreto

1. `google.ts` es la entrada web/worker para lecturas, adjuntos, firma, envío, watch y
   stop. Sus dos ramas (compatibilidad/routing) deben usar la misma admisión. OAuth
   refresh y callback ID token no llaman Gmail API y no consumen unidades Gmail.
2. `runtime-context.ts` conserva intentos/capacidades/escritor único; entrega deadline,
   provider e ID del intento a la reserva. Después del pacing revalida scope/admisión.
3. Los transportes de bajo nivel no son una entrada alternativa con v2: necesitan una
   prueba efímera del intento admitido, limitada a provider/path/method y una emisión.
4. Connect lee perfil directamente por proxy. Su host debe interceptar esa operación,
   reservar y releer sesión/intent/config antes de emitir. Ni GET conexión/Auth Config
   ni OAuth/link se contabilizan como unidades Gmail; su presupuesto Composio sigue separado.
5. C2 existente queda compatible v1 cuando v2 está apagado; con v2 activo se rechaza
   antes de leer proveedores para impedir un bypass. Un verificador v2 separado usa política interna,
   tuple exacta y evidencia versionada. No rellena Google ni facts.quota v1. No se
   modifica el protocolo049/050, UI, writer o confirmación SQL antigua para aceptarlo.

Módulo de admisión inyectable con contexto AsyncLocalStorage: política del servidor,
RPC, reloj, sleep, UUID. En producto `MAIL_QUOTA_POLICY_ENABLED` está ausente/false por
defecto: no consulta esquema v2 y conserva RPC039. Con flag true, snapshot ausente o
inválido falla cerrado; disabled permite solo directo legado. Composio exige enabled.
El reservador entrega una lease con `emit`: revalida política, deadline, scope y
admite una vez en DB inmediatamente antes del proveedor. No reintenta HTTP.

SQL I03 aditivo/local: snapshot de política y admisión única de recibo, con control
de not-before/deadline en DB. RLS/ACL del
I02 conservados; no cambia reservas/contadores históricos. Recibos admitidos no se
vuelven a emitir y un cambio de generación/cuenta/plazo cancela. Reversa cierra antes
de retirar los RPC; no elimina recibos ni estados de admisión.

## Contrato externo y límite confirmado

Se consultó documentación pública, sin credenciales ni API de negocio:

- [GET conexión v3.1](https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid): identidad, estado, configuración y requested_scopes; estos últimos no son grants efectivos.
- [Control de scopes](https://docs.composio.dev/docs/authentication/controlling-scopes): cambiar Auth Config afecta nuevas conexiones; las existentes conservan sus permisos previos.
- [Connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts): credenciales en state.val redactadas; no extraer tokens.

No se ha acreditado una procedencia de grants efectivos en esas respuestas. Esta es
una inferencia conservadora del contrato revisado, no una afirmación de que Composio
no pueda ofrecerla por otra interfaz. El adaptador
wire no convierte requested_scopes, declared_scopes ni un campo arbitrario effective_grants
en evidencia. Su resultado es permission_unproven antes de consultar perfil cuando
falten grants. El verificador normalizado admite evidencia solo a través de un puerto
servidor explícito, revisado y ligado a tuple/revisión/deadline; pruebas positivas de
ese puerto son sintéticas y no habilitan aceptación externa. El gate de grants sigue
abierto: QGR-T03 no se declarará completamente done solo con esos mocks.

El adaptador incluye el GET perfil por proxy de endpoint fijo, protegido por prueba
de admisión v2 y lectura acotada. No se usa en el flujo normal mientras el puerto de
grants devuelva null. No se necesita falsear un binding ya verificado para consultar
identidad; esa consulta sigue requiriendo autorización y cuota del intento.

Reuso de conexión existente no genera links, refresh, revoke, complete_auth ni cambia
owner. La ruta/UI/registro v2 siguen en I04. Connect nuevo sin cuenta CRM materializada
no puede usar la FK de reservas I02: con v2 activo queda cerrado antes de perfil; su
scope previo a materialización debe resolverse en I04, sin inventar cuenta o proyecto.

La proyección Connect contiene un UUID reservado incluso antes de materializar:
la reserva I02 exige una fila real connected y lo rechaza. No se interpreta el UUID
proyectado como prueba de que esa fila ya existe. I04 también debe conectar comandos,
DTOs y persistencia v2 a este verificador; el resultado puro no cambia candidato ni
sustituye tickets, confirmación humana o evidencia SQL. La constraint I02 sigue cerrada.

## Aceptación y pruebas

FR03/06/09, partes AC05–07/12/13/15/18/19: apagado compatible; reserva/costo exactos;
misma lease para directo/runtime/perfil; tras esperar, política/sesión/plazo revocados
impiden wire; replay/timeout/response inválida no envían ni cambian proveedor; incertidumbre
no reintenta. FR04/05/07, partes AC08–11/14/15: owner intacto, ningún OAuth extra,
sin Google obligatorio en v2; evidencia ajena/declarada/antigua bloquea; v1 intacto.

Pruebas nuevas con fake fetch que rechaza destinos inesperados y cero red real;
regresiones de las superficies modificadas, TypeScript/formato/preservación. RPC con
PG15 aislado propio usando solo binarios ya autorizados. No repetir pilotos aceptados.
Manifest I03 conserva baseline previo; los archivos compartidos tocados se enumeran
explícitamente y sus huellas anteriores se guardan antes de editar. I01/I02 y SQL sellado
permanecen intactos. Habilitación/transición/cuota externa/producción no están autorizadas.
