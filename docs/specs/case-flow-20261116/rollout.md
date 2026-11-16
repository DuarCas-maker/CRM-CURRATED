# Entrega y reversión

Candidato local; no push, SQL remoto ni despliegue autorizados en esta solicitud. Tras pruebas y evidencia, presentar para revisión. La aprobación del checklist anterior no se transfiere al nuevo cambio de reglas/permisos.

Orden futuro: conciliar 054 del frente de usuarios, backup del destino, probar/applicar 055 aditiva, publicar web y verificar sin acciones reales. No activar proveedores ni cambiar worker. Guardas de disponibilidad deben impedir escrituras parciales si falta la migración.

Rollback: restaurar la web anterior y aplicar `rollback.sql` solo con autorización operativa. Restaura los predicados de acceso/actor y el propietario de nuevas evaluaciones; retira la RPC nueva y su helper. Conserva columnas, valores financieros, eventos, auditoría y la selección compatible que mantiene alternativas. Reaplicar 055 es idempotente y fue probado. No borrar hechos de negocio ni restaurar una base entera sobre actividad concurrente.

Antes de integrar, revisar el WIP actual del coordinador en `next.config.ts`, `src/app/layout.tsx`, `src/components/crm.tsx`, `src/lib/server/supabase.ts` y gestión de usuarios. Esos archivos no forman parte de este cambio; no se copiaron ni sustituyeron. La rama permanece sin commit/push/merge. La integración debe conservarlos y contrastar las definiciones remotas 048–054, sin ejecutar otra importación o activar envíos.
