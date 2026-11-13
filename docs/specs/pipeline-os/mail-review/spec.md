# Correo → revisión humana → acción comercial

12/11/2026 · STRICT · implementación local · base 832136f.

## Contexto y decisiones confirmadas

Pipeline OS reutiliza expedientes, asociación de hilos, procesos, evaluaciones de lenders, ofertas, tareas y permisos del CRM. Falta una revisión estructurada de un correo que produzca registros persistentes. El documento externo `arquitectura-datos-santiago-composio.md` es referencia, no autorización operativa. Se conservan D01–D24, baja global, envíos independientes, selección humana y directorio del CRM.

Ronda cerrada: 1A: analizar un correo por acción explícita con IA, propuesta editable y aprobación humana. 2A: asociación dudosa queda pendiente hasta elegir expediente/proceso existentes. 3A: responsable y vencimiento editables, responsable actual propuesto. 4A: reutilizar OpenAI existente. No se crea clave ni se abren env reales. Se reutilizan A_OPENAI_API_KEY/modelo del CRM como extracción, con consumo atribuido a su servicio existente y propósito documentado en el registro de revisión.

## Requisitos y aceptación

| FR / AC | Comportamiento comprobable |
| --- | --- |
| MR01 / AC01 | Desde un expediente en Pipeline OS elegir un mensaje entrante persistido, proceso confirmado y evaluación existente. Reutilizar Pendientes de Conversaciones para asociar hilos; nunca crear expedientes ni unir por nombre. |
| MR02 / AC02 | Analizar solo al pulsar; extraer oferta, requisito o desconocido desde texto nuevo legible, sin adjuntos ni barrido externo. Propuesta con evidencia literal. No escribir oferta/tarea/update antes de aprobación. |
| MR03 / AC03 | Revisar/corregir tipo, importe/términos o requisito, resumen, tarea, responsable y fecha. Datos faltantes no se inventan; oferta requiere importe positivo y requisito texto. |
| MR04 / AC04 | Aprobar transaccionalmente oferta o requisito + tarea + actividad/evento/update con fuente, actor y fecha. Ningún envío, selección de oferta, firma, fondeo ni aprobación documental. |
| MR05 / AC05 | Doble clic, recarga o reintento no duplican análisis ni efectos. Correo/contexto cambiado invalida la aprobación. Fallo/resultado incierto no repite IA automáticamente; reintento explícito separado. |
| MR06 / AC06 | MFA, usuario activo, acceso comercial al expediente y al mensaje en servidor/DB. Seller, ajeno, anónimo y usuario inactivo no acceden a esta revisión de ofertas/requisitos de lenders. |
| MR07 / AC07 | Lista de correos paginada, estados vacíos/carga/error, revisión conservada al fallar aprobación, uso con teclado y móvil; demo ficticia sin llamadas externas. |
| MR08 / AC08 | Registrar estado de cuentas y disponibilidad observados sin credenciales/datos de clientes. |

No objetivos: reconstrucción histórica masiva, nuevas cuentas, OAuth, activar Composio/worker, migraciones remotas, push/merge/deploy, Hunter/Chase ni clasificación autónoma de contratos/fondeos.

## Inventario observado (solo lectura, sesión del CRM)

Un buzón CRM: Daniel, estado registrado connected, propietario Daniel, histórico confirmado. No se verificó nuevamente Gmail. El documento de Claude describe 18 buzones consultados: 17 no aparecen en CRM tomando ese universo como referencia; no es inventario definitivo y tres reps tienen cobertura contradictoria. Direcciones externas anonimizadas: falta conciliar inventario por responsable/marca.

Google directo ofrece solo organización Curated y marca Curated Financial; Continuar con Google se habilita al elegir marca. No se inició OAuth. Composio muestra alta deshabilitada, asociación y comprobación de Daniel ausentes, política/presupuesto pendientes y comprobaciones bloqueadas. Conectar no equivale a habilitar transporte. No se cambió configuración persistente.
