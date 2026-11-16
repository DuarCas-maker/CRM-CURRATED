# ADR-001 — Texto privado separado y cifrado

Aceptado para implementación local · 2026-11-16 · FR-001/006/007/008

## Contexto

`profiles` se consulta desde el workspace de todos los roles autorizados. El texto debe ser consultable únicamente por superadmin y no equivale a la contraseña de Auth.

## Decisión

Usar una tabla separada sin acceso directo para usuarios, cifrada con AES-256-GCM mediante el helper existente y vinculada al ID del usuario dentro del payload autenticado. Descifrar solo tras acción explícita y guard/auditoría de servidor y DB. Mantener contraseña exclusivamente en Supabase Auth.

## Alternativas

Campo en profiles: menor código, riesgo de filtración por select('*'); descartado. Cifrado solo visual: no protege persistencia/API; descartado. Gestor externo: añade dependencia/costo no solicitado; descartado. Tabla privada: revocación simple, sin nuevo servicio; elegida.

## Consecuencias

Requiere migración aditiva, conservación de clave y autorización por lectura. Rollback recomendado conserva tabla/cifrado hasta respaldo; reversa SQL solo en copia o con aprobación. Revisar si se requieren claves independientes/rotación o auditoría normativa específica.
