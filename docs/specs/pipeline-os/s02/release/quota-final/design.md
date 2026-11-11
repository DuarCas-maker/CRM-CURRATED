# Diseño y ADR-I05-01

Expandir primero la base con052 y publicar luego web/worker del mismo commit,
con todos los flags nuevos apagados. La ausencia de una política publicada permite
la compatibilidad de Gmail directo; no cerrar la cabeza de cuotas al instalar,
porque eso impediría publicar la política y bloquearía los callers que habiliten la fachada v2. El reservador SQL legado no se modifica. Publicar la política es otro corte.

El generador compone los tres candidatos sellados de I02/I03/I04. Sustituye solo
las guardas de fixture/loopback y las transacciones exteriores por guardas finales;
conserva validadores, límites, permisos, nonces, CAS y guardas de emisión. No edita
los candidatos ni usa datos/configuración de otro checkout.

El contrato se obtiene en PostgreSQL15 real de un fixture propio con base001–051.
048/049/050 solo forman la base sintética, nunca se proponen otra vez al CRM.
Los objetos se comparan por metadatos y fuentes normalizadas LF/CRLF; los permisos
se ordenan por nombre y no por OID. El contrato final cubre el delta y dependencias
existentes referenciadas; el resto del catálogo se preserva dinámicamente durante
la misma transacción. El postflight no afirma esa preservación retrospectiva.

La huella de datos compara multiconjuntos de filas en tablas operativas; excluye
solo las tres columnas añadidas al binding. Solo se emiten huellas, nunca claves,
tokens, correos o filas de clientes. No se carga ninguna política ni presupuesto.

La reversa posterior conserva esquema/historial y revoca las RPC nuevas si el
incremento sigue sin utilizarse. Si una política o binding v2 ya se utilizó, se
detiene: su reversa requiere el protocolo de corte y conciliación correspondiente.
No se borra esquema, se restablecen contadores o se conmuta un envío incierto.

La preparación permite generar y probar artefactos locales. Los Dockerfiles
actuales se conservan; Docker Linux no está disponible en este host. La prueba de
imagen y despliegue se hará en los recursos existentes, después de autorización.
