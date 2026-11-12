# Daniel — preparación de configuración y verificación existente

11/11/2026 · SDD STRICT · preparación autorizada. Base publicada2730d27 y052
aceptada. Reutiliza I04-A/R y la decisión Hobby. No cambia producto ni configuración
en vivo y no autoriza peticiones a Composio, mensajes u operación del proveedor.

| FR / AC | Resultado aceptable |
| --- | --- |
| DV-FR01 / AC01 | Buzón CRM existente de Curated Financial; comparar su email por hash con la evidencia histórica, sin publicar direcciones ni inferir M1/M2. |
| DV-FR02 / AC02 | Completar privadamente proyecto, Auth Config, conexión original, owner y referencia de credencial; conservar la clave en su archivo original. Datos faltantes permanecen explícitos. |
| DV-FR03 / AC03 | Proponer política compartida sin Google Project ID obligatorio, dentro del contrato; no publicarla ni resetear consumo. |
| DV-FR04 / AC04 | Separar metadatos de preparación y check real; máximo5 peticiones nuevas propuestas,0 autorizadas actualmente,0 retries/OAuth/mensajes. |
| DV-FR05 / AC05 | Registrar la captura de consumo y la tarifa oficial separadamente del saldo restante desconocido; no afirmar que27,3K equivale a proxy disponible. |
| DV-FR06 / AC06 | Validar con los schemas existentes, bloquear ejecución incompleta y preservar Gmail directo, workerpaused, controles apagados e Instantly43. |

No objetivos: OAuth nuevo, diez buzones, históricos, lectura de mensajes/adjuntos,
envío, migración, push, despliegue, publicación de política o selección de transporte.
No se vuelve a pedir marca, plan o buzón: esas decisiones ya están confirmadas.

## Aceptación verificable

- Una lectura CRM sin escritura permite fijar una sola cuenta connected, marca
  activa/revisión confirmed; no consulta mail_credentials ni mensajes.
- La cuenta corresponde a la alias histórica2 y a su ID original guardado; no se
  reutiliza la reconexión corregida de M1 por tener estado ACTIVE.
- El descriptor no se declara ejecutable mientras falte last_updated_at exacto
  del Auth Config o la política no esté publicada/revisada.
- Un check posterior requiere presupuesto humano/MFA vigente y evidencia real;
  el candidato y el transporte son estados diferentes. Gmail directo permanece.
- Las capturas Last30days y su cifra abreviada se registran tal como aparecen,
  sin convertirlas en un estado de facturación mensual o saldo de proxy.
