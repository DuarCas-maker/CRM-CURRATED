# Evidencia de preparación

## Bloque A integrado localmente — actualización posterior31/10/2026

Usuario autorizó implementar/probar únicamente A. [Alcance y adaptación](block-a-local.md), [manifiesto del resultado](block-a-implementation.json). Se incorporaron28 existentes/siete nuevos de S01; cuatro SQL originales son fixtures de prueba, dos candidatos locales no numerados materializan29 definiciones existentes y dos tests nuevos verifican composición. El checkout S01 no se editó. Sus29 archivos de producto incorporados son equivalentes al origen tras normalizar formato; las diferencias restantes de tests son rutas locales y45→47.

Resultados ejecutados con Node22, `tsx` y preload que bloquea fetch/http/https/socket/tls/DNS reales:

| Check                                                                                             | Resultado y límite                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuatro suites S01 integradas, flag `--experimental-test-module-mocks`, concurrencia1              | 37/37, cero fallos/omisiones/cancelaciones; ahora sobre001–047 en este checkout.                                                                                                                                                       |
| Regresión afectada de37 archivos correo/conversaciones/documentos/delivery/señales, concurrencia2 | 111/111, cero fallos/omisiones/cancelaciones. No son pilotos de proveedor ni pruebas del entorno.                                                                                                                                      |
| Dos suites nuevas `pipeline-os-s02-block-a*.test.ts`                                              | 7/7: marcador local; equivalencia completa de catálogo con fixtures;046/047/cola/IDs preservados; privacidad por área; worker real + fachada directa real + SQL estático con dependencias externas falsas, éxito/revocación/uncertain. |
| TypeScript `tsc --noEmit --incremental false`                                                     | Correcto, incluidos todos los tests nuevos.                                                                                                                                                                                            |
| Prettier del manifiesto35 + dos tests                                                             | Correcto tras normalizar cuatro fuentes importadas y los tests nuevos; sin cambio de comportamiento respecto a S01.                                                                                                                    |

Total de estas tres selecciones disjuntas: **155 pruebas offline**; no sumar de nuevo las anteriores de S00/S01/I01. No se repitieron los ensayos reales de correo/adjuntos ni PRUEBA.csv/Bouncer. No se ejecutó ningún worker como servicio.

Auditoría final:39 fuentes públicas del checkout S01, ocho archivos de código/tests S02-I01,47 SQL existentes,49 JSON operativos propios y HEAD fb9f201 conservados.524 archivos públicos anteriores sin cambios; los37 anteriores que cambiaron pertenecen al alcance A/documentación autorizada. Los archivos añadidos están enumerados en el manifiesto y las referencias de documentación. No hay script de lint configurado; no se inventa una ejecución de ESLint. Formato y `git diff --check` se usan como controles disponibles, además de TS/tests.

El catálogo comparado entre bases independientes incluye definiciones/ACL/owners de funciones, tablas/vistas/RLS/grants, columnas y privilegios de columna, constraints, índices, triggers y políticas. El candidato no captura catálogo de sesión ni reescribe funciones al aplicarse. Esto prueba equivalencia con el delta S01 en la base sintética actual, no con Supabase remoto.

Incidencias de QA corregidas: el materializador inicial interpretaba sustituciones `$` al insertar cuerpos SQL; se cambió a reemplazo mediante callback y el contraste de catálogo pasó. El primer test nuevo asumía cola vacía, pero la base ya contiene dos jobs programados: ahora exige igualdad exacta de los jobs antes/después, sin relajar la condición de no crear trabajos. Se añadieron tipos de resultado explícitos a seis consultas del test. Ninguno requirió relajar permisos o editar código funcional fuera de la entrega S01.

Build aislado: fuentes públicas copiadas sin env ni credenciales, dependencias locales del ancestro, red bloqueada y telemetría deshabilitada. La configuración real mantiene `output: standalone`. El intento completo alcanzó compilación/tipos/generación y falló al empaquetar symlinks de dependencias por **EPERM de Windows**; no es un PASS de empaquetado. La copia QA con solo `output` desactivado también terminó en EPERM al crear `.next/server/app/api/auth`; la causa específica de esa negativa de mkdir no quedó confirmada. No hay build completo aprobado ni artefacto de release. No se cambia next.config.ts del proyecto. El primer camino largo también produjo EPERM; acortarlo permitió avanzar en otro intento, pero no demuestra por sí solo que la longitud fuera la causa. No se insiste con cambios del sistema, dependencias o permisos. No hubo solicitud/rechazo de aprobación automática ni cambio de permisos del sistema.

Cobertura A: FR01/02/03 y preservación FR12 verificados localmente; AC01/02/03/11/12 cubiertos para este subconjunto. AC04–10 de administración/marca/binding/corte siguen parcialmente pendientes de B/C, aunque las guardas de área y la composición de transporte ya tienen pruebas negativas. G4 de A implementado y pruebas/TS/formato de G5 correctos; la verificación de build completo de G5 sigue pendiente por la limitación Windows. G6 y T00-02-I no se convalidan. Sin SQL final/remoto, APIs, envíos, Composio, commit/push o despliegue. Instantly43 se conserva.

La evidencia de preparación original siguiente es histórica; sus estados pendientes de implementación no describen este resultado posterior.

31/10/2026 · Modo planificación STRICT. G0–G3 cubiertos para este diseño y orden; implementación G4/G5 del producto, T00-02-I y activación/publicación G6 pendientes. B/C requieren congelar sus paths exactos antes del código.

## Ejecutado en este turno

- Lectura de instrucciones, coordinación, SDD/Supabase, manifiestos y fuentes públicas S01; contraste de modelos, rutas OAuth, MFA/origen y guarda final del worker. No edición del checkout S01 ni acceso a sus privados.
- Revalidación SHA-256 de39 archivos públicos S01 y ocho de código/tests S02-I01;45 SQL comunes byte a byte. Coinciden con la revisión anterior; no se afirma Git limpio de S01.
- **Nueva comprobación de compatibilidad**, no repetición de suites aceptadas: Node22 + `tsx`, `tests/feature-database.ts`, PGlite en memoria con001–047 y marcadores explícitos de sandbox I01/I02. Red bloqueada por preload local existente (fetch/http/https/socket/tls/DNS). Aplicación de ambos SQL preliminares correcta; cuatro vistas seguras y tres columnas de área presentes.
- Snapshot de definiciones/ACL/owners de funciones y tablas, constraints y políticas de Instantly046/047: idéntico antes/después de los deltas y después de la reversa I02→I01. Hash del catálogo y resultado en [reporte](compatibility-report.json). Solo comprueba esos objetos en la base sintética; no todo el comportamiento de aplicación.
  -49 JSON operativos de la raíz privada propia: comparación de hashes antes/después sin mostrar contenido; intactos. Cero `.env` leídos. Instantly43 preservadas; sin llamadas Composio ni otro proveedor.

No ejecutados: integración de fuentes, suites cruzadas de app, nuevas guardas de marca/binding, SQL definitivo, typecheck/build de producto, catálogo o smoke remoto. No hubo cambios de código que justificaran repetir TS/build o pruebas de envío/respuesta/PDF/importación ya aceptadas. No hay resultado productivo nuevo implícito en esta preparación.

QA documental: formato Prettier del paquete nuevo, enlaces locales y consistencia del manifiesto28+7+4 comprobados; `git diff --check` correcto. La revisión conserva separados resultado local, capacidades pendientes y autorizaciones futuras; ningún AC de producto se declara aprobado por redactarlo.

## Resultado y pendientes

Preparación de FR01–12 trazada a AC01–12 y tareas. AC02/11 tienen evidencia **parcial** de coexistencia SQL; AC12 preservación local comprobada. Los escenarios funcionales AC01–11 permanecen por implementar/verificar en su conjunto. No se cierran S01/T01-02/S02/S00.

Siguiente incremento concreto: **A, incorporación local de I01/I02 con revisión del manifiesto y prueba cruzada sobre la base actual**, conservando directo fijo. No incluir B/C en esa autorización por arrastre. La publicación y numeración final se condicionan al catálogo/privilegios/legado efectivos y recuperación; no se hacen llamadas para obtenerlos hoy.
