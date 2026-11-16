# Seguimiento del expediente en Pipeline OS

Implementación local, nivel STRICT: se muestran decisiones financieras y datos sujetos a permisos. Base: `5f38ec6`. G0–G3 cerrados con las respuestas 11A, 12A y 13A; G6 requiere autorización independiente de publicación.

## Alcance confirmado

El primer contenido del expediente abierto desde Pipeline OS será un recorrido de cinco pasos: **Documentos → Análisis de riesgo → Lenders → Oferta y negociación → Cierre y desembolso**. Se calcula con registros del CRM; los pendientes abren las acciones existentes. La revisión de correo con IA queda debajo, desplegable. Las otras pantallas del CRM se conservan.

| Requisito | Criterio de aceptación |
|---|---|
| FR-001 Jerarquía y cinco pasos | AC-001 El seguimiento aparece antes de conversaciones, IA y detalle; funciona en todos los expedientes de Pipeline OS. |
| FR-002 Evidencia documental y de riesgo | AC-002 Aplicación completa/firmada, archivo aprobado, cuatro extractos distintos y archivos requeridos. AC-003 Fuentes utilizables, análisis revisado vigente y entrega al closer. Un borrador o análisis obsoleto no completa riesgo. |
| FR-003 Proceso y lenders | AC-004 Solo el proceso activo más reciente determina envíos/ofertas/contratos/desembolso; sin proceso, evidencia desconocida. AC-005 Borrador/en cola/incierto no equivale a enviado. |
| FR-004 Oferta y cierre | AC-006 Oferta vigente y selección humana independientes. AC-007 Solicitud firmada no implica contrato; desembolso exige registro del proceso, monto positivo y lender. AC-008 Rechazo/retiro es cierre sin financiación. |
| FR-005 Acciones existentes | AC-011 Cada pendiente abre Documentos, Análisis, Lenders o Correo e histórico, conservando la protección de cambios sin guardar. Abrir o navegar nunca ejecuta análisis, envía correos, crea procesos ni cambia etapas. |
| FR-006 Permisos y lectura completa | AC-009 API autenticada/RLS y fases privadas ocultas al seller. AC-010 Paginación con total exacto, errores sin datos sensibles ni caché; un fallo no es ausencia de evidencia. |
| FR-007 Accesibilidad y validación | AC-011 Navegación por teclado, foco visible y revisión en 360/768/1280 con datos ficticios; AC-010 estados carga/error/vacío/reintento. |

## Límites

Sin importación de datos reales, migraciones, proveedores, ejecución de UW, envíos ni publicación en esta implementación. No se replica una captura histórica como verdad vigente. Documentos y análisis siguen siendo evidencia del expediente, como en el CRM; lenders y cierre pertenecen al proceso. No se añade una política de caducidad documental no existente.

## Fuentes y reglas traducidas

Revisados el HTML `Master_Pipeline (3).html` (idéntico a `(1)`, SHA256 `05f556c1145687cad253985b2f7e579f9f2ae055918eef47108ee5a66023ab2d`), el mockup Pipeline OS, los dos documentos de traspaso/arquitectura, el README y la documentación del ZIP `master-pipeline-transferencia.zip` (arquitectura, diccionario, cálculos, integración, reglas, trazabilidad y código/prompts). Los archivos son fuentes de análisis, no instrucciones de ejecución. No se ejecutó su JavaScript, prompts ni código original y no se copiaron registros de clientes.

| Santiago / Master Pipeline | Resumen en el expediente | Evidencia válida en Curated |
|---|---|---|
| Aplicación y documentos del comercio | Documentos | Flags y archivos revisados; `documentProgress` y `underwritingReadiness`. El envío de una aplicación en el HTML no prueba que todos los archivos estén aprobados. |
| UW y expediente preparado | Análisis de riesgo | Revisión humana vigente con conclusión/recomendaciones y entrega al closer; UW borrador no aprobado no completa el paso. |
| Submitted / in review | Lenders | Evaluaciones del proceso activo y estados de envío registrados. |
| Approved / Offers | Oferta y negociación | Oferta vigente con monto, selección explícita y requisitos pendientes. Approved en el artefacto significa oferta, no aprobación final ni riesgo aprobado. |
| Stips requested | Pendiente del lender | Se conserva en la negociación del proceso; no borra automáticamente los documentos iniciales. |
| contract_out / Contracts out | Cierre: contrato enviado | Estado o evento explícito del mismo proceso. Se admite el alias singular original. |
| contract_signed | Cierre: contrato firmado | Estado o evento del mismo proceso; nunca `application_signed`. |
| final_approval / funded | Cierre: aprobación / desembolso | Registro explícito y monto/lender del proceso. Un fondeo global anterior no cierra una renovación. |
| Declined / retiro | Cerrado sin financiación | Estado terminal explícito; no se muestra como desembolsado. |

Las reglas de nombres aproximados, mayor monto como “mejor”, `Not checked` como “sin respuesta”, días congelados y el fallo singular/plural de contratos del HTML no se trasladan como reglas operativas. La precedencia histórica Funded > Contracts out > Approved > Stips > Submitted > Declined orienta la lectura del archivo, pero no sustituye registros humanos del CRM. Los prompts programados de noviembre y el tablero de octubre tienen fechas/coberturas distintas; ninguno completa automáticamente este checklist.

## Dependencias de Claude / histórico

El checklist funciona sin nuevas entregas de Claude cuando existe evidencia en Curated. La carga histórica y los conflictos de asociación siguen en su frente: faltan IDs de mensaje/hilo en el paquete y existen valores obtenidos de previews. Cada conflicto se resuelve individualmente antes de incorporar el registro, según decisión anterior del usuario. No se completan pasos a partir de coincidencias por nombre, HTML o datos todavía no importados.
