# CR-001 — Conciliar los tres lotes de hoy

El usuario aporta la captura de los IDs y pide corregir la discordancia de los totales. Amplía FR-003/004 a los lotes 6b048a409cc3326739fccf46 (52), 6b048a3f9cc3326739fccf31 (1.000) y 6b04890c0b2a81a3ff3c94be (502). Suma bruta esperada: 1.554 resultados; los correos únicos se comprobarán, sin inferir que los lotes sean disjuntos.

Se recuperan resultados existentes, se respeta la identidad por correo normalizado y se revisa la proyección del funnel frente a datos completos. Solo los registros demostrablemente correspondientes se pueden asociar. Resultados completados previos se conservan; no se crean contactos repetidos ni se reenvían verificaciones. Otras reservas sin correspondencia demostrada siguen bloqueadas. Se confirma también el despliegue del arreglo 92a2f1e.

AC-007: por cada lote, descarga GET, conteo/identidad únicos y clasificación del proveedor conciliados con la DB. AC-008: los totales de preparación se contrastan con la fuente completa, distinguiendo resultados válidos de disponibilidad operativa sin alterar las categorías aprobadas.

Impacto: conciliación de datos existentes adicional, sin cambio de esquema previsto; nivel STRICT y respaldo previo. La petición actual autoriza corregir estos tres lotes y continúa la publicación ya autorizada. No existe ambigüedad de alcance que requiera otra autorización.
