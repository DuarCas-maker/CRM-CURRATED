# Promoción y reversa

1. Pruebas SQL/HTTP/UI y build locales. Verificar SHA del SQL y ensayo PostgreSQL15, incluyendo reversa.
2. Producción: Supabase autoalojado `https://supabase.finlabinc.com`, app `https://crm.finlabinc.com`, web Coolify rv8rpfxhf0mbxprge6h6ki9c. Conexión API administrativa existente solo en memoria; ningún .env ni secreto nuevo.
3. Conciliar firmas/dependencias, ausencia de los dos objetos nuevos y hashes de funciones existentes. Crear archivo privado nuevo de respaldo en volumen DB; pg_restore --list y decodificación antes del SQL. No descargar datos.
4. Aplicar `up.sql` en una transacción con lock_timeout 3 s / statement_timeout 30 s. Verificar exactamente dos funciones añadidas, ninguna función previa modificada, ACL anon/service_role bloqueadas. No operaciones Auth, jobs ni proveedores.
5. Push no forzado a main tras conciliar origin; el pipeline existente publica web/worker. Verificar assets nuevos servidos, health200, sin sesión401/no-store y lectura acotada con MFA. Smoke sin comandos de campaña o Bouncer.
6. Reversa: desplegar commit anterior b861486, luego `down.sql` únicamente si se requiere retirar el lector; no hay backfill ni datos que restaurar. El respaldo es contingencia; listado/decodificación no constituyen un ensayo completo de desastre.

La autorización integral del usuario para desarrollar y publicar este módulo, sin nuevas solicitudes por incremento, se conserva. No cambia infraestructura, configuración, políticas existentes ni transporte.
