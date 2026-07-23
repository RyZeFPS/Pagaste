# Pagaste

**Escanea, reparte y cobra.** Pagaste convierte un ticket o un gasto manual en solicitudes de cobro individuales. La persona que adelantó el dinero usa la app universal; cada invitado revisa únicamente su parte desde un enlace web privado, sin instalar nada ni crear una cuenta.

Pagaste no procesa dinero ni se integra con Bizum o con bancos. El invitado paga fuera de Pagaste y no tiene que regresar ni marcar nada; quien adelantó el dinero comprueba su propia cuenta y registra manualmente el cobro como recibido. La aplicación no detecta ni verifica pagos.

## Estado del proyecto

El repositorio contiene un MVP funcional para iOS, Android y web con Expo Router, un backend Supabase versionado y pruebas automatizadas del dominio monetario y de los recorridos principales. Incluye:

- registro, acceso y recuperación mediante correo y contraseña con confirmación de correo;
- alta manual de gastos y captura/selección de tickets;
- OCR reproducible con proveedor `mock` y adaptador HTTP configurable;
- revisión de líneas, cantidades y reparto por persona;
- enlaces privados para cobrar sin exigir cuenta al invitado;
- registro manual de cobros recibidos por el receptor, recordatorios y resolución de disputas;
- grupos e invitaciones autenticadas;
- fotos privadas de grupo con recorte y compresión en el dispositivo;
- perfil con reputación y racha basadas en cuándo el receptor registra cada cobro como recibido;
- teléfono de cobro opcional, visible en enlaces privados solo con consentimiento expreso;
- catálogo local de comercios para reconocer el historial sin peticiones a terceros;
- notificaciones push nativas opt-in;
- exportación local de un resumen de los datos visibles;
- eliminación de cuenta mediante una Edge Function autenticada;
- pantallas públicas de privacidad y condiciones de uso.

El código de despliegue está preparado, pero este repositorio no demuestra que las migraciones, funciones, secretos o ajustes de Auth se hayan aplicado a un proyecto Supabase alojado. Tampoco implica QA en dispositivos físicos ni publicación en tiendas.

## Arquitectura

```text
src/app/                 rutas Expo Router públicas y protegidas
src/components/          sistema visual y componentes de dominio
src/domain/              funciones puras de dinero, OCR y estados
src/lib/                 cliente Supabase, repositorio, storage y analítica
src/providers/           sesión, TanStack Query, tema e i18n
src/types/               contratos de dominio y DTO públicos
supabase/migrations/     esquema, RPC, índices, grants, triggers y RLS
supabase/functions/      Edge Functions y utilidades compartidas
supabase/templates/      plantillas locales de confirmación, recuperación y avisos de Auth
supabase/seed.sql        escenario «Cena del viernes»
supabase/tests/          comprobaciones pgTAP de base de datos
tests/unit/              exactitud monetaria y validaciones
tests/integration/       contratos de backend y flujos de claims
tests/e2e/               recorridos web deterministas con Playwright
```

Decisiones importantes:

- Los importes viajan como enteros en céntimos. El cliente rechaza números fuera de `Number.MAX_SAFE_INTEGER` y usa `bigint` internamente al ponderar o repartir restos.
- El estado remoto vive en TanStack Query; React Hook Form y Zod validan formularios. No se usa Redux.
- Los tickets están en un bucket privado. Su ruta incluye usuario y gasto; se muestran mediante descargas autenticadas o URLs firmadas breves.
- Las fotos de grupo usan otro bucket privado, rutas inmutables y lectura limitada a miembros activos.
- Los enlaces públicos contienen tokens aleatorios. La base de datos guarda solo su hash y las Edge Functions devuelven un DTO mínimo.
- Las tablas expuestas tienen `GRANT` explícitos y RLS. La accesibilidad mediante Data API y la autorización por fila se configuran por separado.
- Las operaciones multi-fila sensibles se realizan mediante RPC transaccionales. Storage, Auth y notificaciones son sistemas externos a esas transacciones.
- Secure Store conserva la sesión y valores pequeños en móvil. Web usa `localStorage`; fotos y OCR no se guardan ahí.
- La capa de analítica es desacoplada y `noop` por defecto; prohíbe nombres, correos, teléfonos, tickets, productos, notas y tokens.

## Requisitos

- Node.js `22.x` (`22.17.1` en CI).
- pnpm `11.7.0`, fijado en `package.json`, Vercel y CI.
- Docker Desktop o un motor compatible para ejecutar Supabase local y pgTAP.
- Xcode en macOS para Simulator/iOS local, o EAS Build desde cualquier sistema operativo.
- Android Studio para un emulador Android.

## Instalación

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
```

Copia las variables de ejemplo:

```powershell
Copy-Item .env.example .env.local
```

En macOS/Linux:

```bash
cp .env.example .env.local
```

## Variables de entorno

### Cliente Expo

| Variable                               | Descripción                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | URL del proyecto Supabase. Debe usar HTTPS en release.                                                                     |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable `sb_publishable_...` o clave `anon` local/legacy de bajo privilegio.                                      |
| `EXPO_PUBLIC_APP_URL`                  | Origen web canónico para enlaces, Auth y configuración de deep links. Debe usar HTTPS y no puede ser localhost en release. |
| `EXPO_PUBLIC_EAS_PROJECT_ID`           | UUID real del proyecto EAS usado para obtener tokens push nativos.                                                         |

Toda variable con `EXPO_PUBLIC_` se incorpora al bundle y debe considerarse pública. Nunca expongas una clave `sb_secret_...`, `service_role`, credenciales OCR ni otros secretos con ese prefijo.

### Edge Functions y secretos

| Variable                    | Procedencia/uso                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Inyectada por Supabase en las Edge Functions.                                                              |
| `SUPABASE_PUBLISHABLE_KEYS` | Mapa JSON inyectado en proyectos alojados, por ejemplo `{"default":"sb_publishable_..."}`.                 |
| `SUPABASE_SECRET_KEYS`      | Mapa JSON inyectado en proyectos alojados, por ejemplo `{"default":"sb_secret_..."}`. Nunca va al cliente. |
| `SUPABASE_PUBLISHABLE_KEY`  | Override singular opcional para entornos locales o controlados.                                            |
| `SUPABASE_SECRET_KEY`       | Override singular opcional para entornos locales o controlados. Nunca va al cliente.                       |
| `SUPABASE_ANON_KEY`         | Fallback legacy de bajo privilegio.                                                                        |
| `SUPABASE_SERVICE_ROLE_KEY` | Fallback legacy elevado. Nunca va al cliente.                                                              |
| `APP_URL`                   | Origen canónico usado por las Edge Functions al crear enlaces.                                             |
| `ALLOWED_ORIGINS`           | Orígenes CORS separados por comas; no uses `*` en producción.                                              |
| `OCR_PROVIDER`              | `mock` o `http`.                                                                                           |
| `OCR_API_URL`               | Endpoint del proveedor OCR HTTP.                                                                           |
| `OCR_API_KEY`               | Credencial privada del proveedor OCR.                                                                      |
| `TOKEN_HASH_SECRET`         | Secreto aleatorio, distinto por entorno, de al menos 32 bytes UTF-8.                                       |

La resolución de claves del backend prioriza los overrides singulares, después los mapas JSON modernos inyectados por Supabase y, por último, las variables legacy. Las claves modernas y legacy pueden coexistir durante la migración; consulta [Environment Variables](https://supabase.com/docs/guides/functions/secrets) y [Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

## Supabase local

```bash
pnpm supabase:start
pnpm exec supabase status -o env
pnpm supabase:reset
```

Después de `status`, copia `API_URL` a `EXPO_PUBLIC_SUPABASE_URL`. Para desarrollo local, copia la clave pública/anon local a `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Studio: `http://127.0.0.1:54323`. Bandeja de correo local: `http://127.0.0.1:54324`.

Para servir funciones con secretos de desarrollo:

```bash
pnpm exec supabase functions serve --env-file supabase/.env.local
```

No confirmes `supabase/.env.local` ni ningún archivo de secretos en Git.

### Contraseñas, correo y Auth alojado

Pagaste usa correo y contraseña mediante `signInWithPassword` y `signUp`. Los usuarios confirman su correo y pueden recuperar la contraseña mediante enlaces de un solo uso. En local, los mensajes se inspeccionan en la bandeja indicada arriba; las plantillas versionadas están en `supabase/templates`.

Esa configuración local **no actualiza automáticamente** un proyecto Supabase alojado al desplegar migraciones o Edge Functions. Antes de probar staging, configura manualmente en el Dashboard del proyecto:

1. **Authentication → Email Templates**: copia las plantillas `confirmation.html`, `recovery.html` y `password_changed_notification.html`. Las dos primeras envían `{{ .TokenHash }}` a `/auth/confirm`; no las sustituyas por enlaces que expongan tokens de sesión en el fragmento.
2. **Authentication → URL Configuration**: define el `Site URL` HTTPS canónico y permite únicamente los redirects web exactos necesarios. Los correos de Auth vuelven siempre al dominio HTTPS de Pagaste; no añadas hosts dinámicos de Expo ni callbacks arbitrarios.
3. **Authentication → SMTP Settings**: configura un SMTP propio para cualquier entorno real. El SMTP compartido de Supabase tiene restricciones y no está pensado para producción; un SMTP propio también permite controlar remitente, entregabilidad y plantillas.
4. **Authentication → Providers → Email**: exige confirmación de correo, un mínimo de 8 caracteres y letras mayúsculas, minúsculas y números. Activa también la protección de contraseñas filtradas si el plan la incluye.
5. Registra una cuenta de prueba, confirma el correo y valida tanto el acceso web como los enlaces de recuperación en móvil.

Referencias: [Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) y [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

> **No ejecutes `supabase config push` contra un proyecto alojado mientras `supabase/config.toml` conserve `site_url = "http://127.0.0.1:8081"`.** Primero crea una configuración revisada para ese entorno y comprueba `site_url`, `additional_redirect_urls`, SMTP, plantillas y proveedores. Un `config push` sin adaptar podría sobrescribir Auth alojado con valores locales.

## Migraciones y seed

Crea una migración mediante la CLI, no inventando el nombre del archivo:

```bash
pnpm exec supabase migration new nombre_descriptivo
```

Aplica todo desde cero y carga el seed local:

```bash
pnpm exec supabase db reset --local
```

El seed crea a Alex, Ferran, David y Marta, el gasto «Cena del viernes» de 40 €, productos por 40 €, parte propia de 15 € y solicitudes por 8,50 €, 11 € y 5,50 € en distintos estados del flujo de cobro.

## Ejecutar la aplicación

```bash
pnpm start
pnpm web
pnpm android
pnpm ios
```

`pnpm ios` necesita macOS. La cámara, las notificaciones y Secure Store deben verificarse en un development build; el navegador permite probar el gasto manual y los enlaces públicos. Para push, vincula el proyecto EAS, define su UUID real en `EXPO_PUBLIC_EAS_PROJECT_ID` y genera un development/preview build. El permiso del sistema solo se solicita cuando el usuario activa los avisos.

## Pruebas y calidad

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build:web
```

Vitest ejecuta pruebas unitarias y contratos de integración sin servicios remotos. `pnpm test:db` valida funciones SQL, RLS, triggers y almacenamiento con pgTAP, y requiere Supabase local activo.

`pnpm test:e2e` inicia Metro/Expo en el puerto 8081 y prueba Chromium móvil y de escritorio contra un contrato HTTP determinista de Supabase. No es una integración con un proyecto remoto.

Para validar el artefacto que se publicaría:

```bash
pnpm build:web:release
pnpm test:e2e:production
```

`build:web:release` exige las tres variables públicas de release, comprueba HTTPS y rechaza un `EXPO_PUBLIC_APP_URL` local. `test:e2e:production` sirve el `dist/` ya generado con fallback SPA y repite los recorridos de Playwright; sigue usando el backend simulado, por lo que no sustituye un smoke test contra staging.

Los recursos de marca se regeneran desde los SVG versionados con:

```bash
pnpm assets:brand
```

## Build web y Vercel

El build de desarrollo se genera con:

```bash
pnpm build:web
```

Para staging o producción usa siempre:

```bash
pnpm build:web:release
```

La salida queda en `dist/`. `vercel.json` fija pnpm 11.7.0, ejecuta el build de release, configura fallback SPA para rutas arbitrarias como `/c/{token}`, sirve `.well-known` como JSON y añade cabeceras defensivas. Actualmente también publica `noindex`; debe revisarse de forma intencionada antes de hacer indexable una web pública.

## Despliegue de staging

No se ha realizado un despliegue remoto desde este repositorio. Una puesta en staging reproducible debería seguir este orden:

1. Crea un proyecto Supabase exclusivo de staging y revisa que la versión mayor de Postgres coincida con la configuración local.
2. Configura manualmente Auth, las plantillas de confirmación y recuperación, Site URL, Redirect URLs y SMTP como se describe arriba. No hagas `config push` con los valores locales.
3. Prepara `supabase/.env.staging` únicamente con secretos propios de la aplicación (`APP_URL`, `ALLOWED_ORIGINS`, `TOKEN_HASH_SECRET` y, si aplica, OCR). No copies claves elevadas al cliente ni reemplaces sin necesidad las variables que Supabase inyecta.
4. Autentica, enlaza, revisa el dry-run y aplica el esquema:

   ```bash
   pnpm exec supabase login
   pnpm exec supabase link --project-ref TU_PROJECT_REF_STAGING
   pnpm exec supabase db push --linked --dry-run
   pnpm exec supabase db push --linked
   ```

5. Carga secretos y despliega las Edge Functions:

   ```bash
   pnpm exec supabase secrets set --env-file supabase/.env.staging
   pnpm exec supabase functions deploy --use-api
   ```

6. Configura en Vercel staging `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_APP_URL` y, si el mismo artefacto se usa en móvil, `EXPO_PUBLIC_EAS_PROJECT_ID`. Construye con `pnpm build:web:release`.
7. Ejecuta Security Advisor y Performance Advisor, comprueba logs sin PII y realiza un smoke test real con al menos dos usuarios, un enlace invitado, revocación, disputa, borrado de cuenta y un ticket privado.

No uses `--include-seed` en staging compartido ni en producción salvo que el entorno haya sido creado expresamente para datos de demostración.

## EAS: iOS y Android

```bash
pnpm dlx eas-cli login
pnpm dlx eas-cli build --profile development --platform android
pnpm dlx eas-cli build --profile preview --platform ios
pnpm dlx eas-cli build --profile production --platform all
```

Vincula primero el slug `pagaste` con el proyecto EAS correcto y define su UUID como `EXPO_PUBLIC_EAS_PROJECT_ID` en cada entorno EAS. `app.config.ts` lo incorpora a `extra.eas.projectId`, que Expo Notifications necesita para obtener el token push. Las variables `EXPO_PUBLIC_` son públicas; los secretos pertenecen a Supabase/EAS Secrets, no al bundle Expo.

Estos perfiles están configurados, pero el repositorio no acredita builds firmados, envío a App Store/Play Console ni pruebas en dispositivos físicos.

## Deep links y dominio

- Scheme: `pagaste`
- iOS bundle ID: `app.pagaste.mobile`
- Android package: `app.pagaste.mobile`
- Dominio previsto: `pagaste.app`
- Rutas: `/c/*` y `/invite/*`

Para activar enlaces verificados:

1. Reemplaza `REPLACE_WITH_APPLE_TEAM_ID` en `public/.well-known/apple-app-site-association`.
2. Reemplaza `REPLACE_WITH_RELEASE_SHA256_FINGERPRINT` en `public/.well-known/assetlinks.json` con la huella real de EAS/Play Console.
3. Publica ambos archivos por HTTPS con `Content-Type: application/json` y sin redirecciones.
4. Añade las URLs necesarias a la lista permitida de Supabase Auth.
5. Construye de nuevo la app; Associated Domains e intent filters se incorporan al binario.
6. Prueba en dispositivos un token real, uno revocado y uno inválido. Las respuestas inválidas deben ser genéricas.

## OCR

Por defecto:

```env
OCR_PROVIDER=mock
```

El mock solo sustituye el servicio OCR externo, no la base de datos. Para un proveedor real:

```env
OCR_PROVIDER=http
OCR_API_URL=https://proveedor.example/v1/receipt
OCR_API_KEY=...
```

El adaptador envía una URL firmada breve desde la Edge Function, exige JSON estructurado, valida con Zod, normaliza céntimos y guarda únicamente el resultado necesario. La interfaz obliga a revisar y corregir el ticket antes de repartir. Cada proveedor real requiere mapear y probar su contrato, además de revisar retención y condiciones de privacidad.

## Seguridad y privacidad

La reputación no se guarda en `profiles` ni puede editarla el cliente. Empieza únicamente en
cobros nuevos ligados a una cuenta y usa como referencia el momento en que el receptor registra el
cobro como recibido; no representa la hora bancaria del pago. La racha suma cobros registrados en
menos de 24 horas y se reinicia en cuanto existe un cobro vencido. Los recordatorios solo se habilitan
después de 24 horas; las disputas y los invitados anónimos no alteran la nota. Hasta tres pagos se
muestra «Nuevo en Pagaste», evitando presentar una precisión falsa con una muestra mínima.

- RLS está activa en cada tabla expuesta; invitados sin cuenta nunca consultan tablas directamente.
- Los endpoints públicos aplican hash de token, estado permitido, rate limiting y respuestas genéricas.
- Las claves secretas/`service_role` solo se usan en Edge Functions.
- Las políticas de actualización incluyen `USING` y `WITH CHECK`; las columnas usadas por RLS y las claves foráneas están indexadas.
- Un trigger impide cambiar silenciosamente importes, participantes, recibos o estados monetarios después de enviar un gasto.
- El bucket de tickets es privado, limitado a imágenes y protegido por propietario.
- No se registran tokens completos, fotos, respuestas OCR crudas ni secretos.
- El ticket es privado por defecto; el DTO invitado contiene únicamente su desglose normalizado.
- El teléfono de cobro solo forma parte del DTO invitado si su titular lo ha guardado y mantiene
  activo el consentimiento para mostrarlo en enlaces privados.
- No se usan tickets para entrenar modelos y el MVP no solicita credenciales bancarias.

## CI

`.github/workflows/ci.yml` se ejecuta en pull requests y en pushes a `main`/`master` con Node 22.17.1 y pnpm 11.7.0.

El job `quality` realiza instalación congelada, compatibilidad de dependencias con Expo SDK 57, lint, TypeScript, Vitest, comprobación estática de todas las Edge Functions con Deno 2, Playwright contra el servidor de desarrollo, `build:web:release` con variables no sensibles de CI y `test:e2e:production` sobre `dist/`. Si Playwright falla, conserva diagnósticos durante siete días.

El job `database` levanta un Supabase local reducido, aplica migraciones y seed, ejecuta pgTAP y detiene el stack incluso si falla una comprobación. Ninguno de los dos jobs despliega recursos remotos.

## Limitaciones reales del MVP

- No procesa ni verifica pagos, no abre un deep link bancario inventado, no lee notificaciones
  bancarias y no confirma Bizum automáticamente.
- No se han desplegado ni validado de extremo a extremo las migraciones, Edge Functions, secretos, Auth, SMTP o Storage en un proyecto alojado desde este repositorio.
- Playwright usa un contrato Supabase simulado; falta una suite de integración/smoke contra staging real.
- La cámara, notificaciones push, Secure Store, enlaces universales/App Links y comportamiento offline requieren QA en dispositivos físicos y builds firmados.
- Apple Team ID y la huella Android de release siguen siendo placeholders; también faltan credenciales operativas de dominio, tiendas, SMTP, push y OCR.
- El OCR HTTP es un contrato genérico; no hay un proveedor real validado.
- La eliminación de cuenta está implementada en UI y backend, pero debe desplegarse y ensayarse en staging, incluidos fallos parciales entre Storage, base de datos y Auth.
- La exportación actual es un resumen local de perfil, gastos y grupos visibles; no es una exportación legal completa ni incluye tickets. Las exportaciones avanzadas siguen reservadas para Plus.
- Pagaste Plus es una pantalla informativa: no hay compras, facturación ni recordatorios automáticos operativos.
- Apple y Google Auth permanecen desactivados hasta añadir credenciales y revisar sus callbacks.
- Catalán e inglés tienen cobertura parcial; la persistencia y revisión lingüística necesitan completarse.
- Los textos legales y `legal@pagaste.app` necesitan revisión y datos definitivos del responsable antes de producción.
- Las cabeceras web mantienen `noindex`; la indexación pública no está habilitada.

## Próximos pasos técnicos

1. Desplegar en Supabase staging, configurar Auth/SMTP manualmente y ejecutar Security/Performance Advisors.
2. Probar el backend real con dos usuarios y enlaces invitados pendientes, recibidos, disputados, resueltos, revocados e inválidos.
3. Ensayar exportación y eliminación de cuenta en staging, documentando recuperación ante fallos parciales.
4. Conectar un proveedor OCR con contrato, precisión, coste y retención revisados.
5. Completar Team ID, huellas, EAS project ID, credenciales push y pruebas de universal links en dispositivos físicos.
6. Completar traducciones, revisión legal, accesibilidad y monitorización sin PII.
7. Diseñar y validar compras, límites y recordatorios antes de habilitar Pagaste Plus.

## Licencia

MIT. Consulta `LICENSE`.
