const required = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_APP_URL',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Faltan variables públicas de release: ${missing.join(', ')}`);
}

const supabaseUrl = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL);
const appUrl = new URL(process.env.EXPO_PUBLIC_APP_URL);
if (supabaseUrl.protocol !== 'https:' || appUrl.protocol !== 'https:') {
  throw new Error('Las URLs de release deben utilizar HTTPS.');
}
if (['localhost', '127.0.0.1'].includes(appUrl.hostname)) {
  throw new Error('EXPO_PUBLIC_APP_URL no puede apuntar a localhost en release.');
}
if (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim().length < 20) {
  throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY no parece válida.');
}
