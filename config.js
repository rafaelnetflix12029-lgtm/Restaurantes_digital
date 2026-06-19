/* =====================================================================
   config.js  —  Credenciales del proyecto.
   Claves públicas por diseño (van en el frontend). La seguridad la dan
   las políticas RLS de Supabase y el preset Unsigned de Cloudinary.
   NUNCA pongas aquí la "Secret key" de Supabase (sb_secret_...).
   ===================================================================== */
window.APP_CONFIG = {
  // --- Supabase ---
  SUPABASE_URL:  "https://eygaylmlmulclleoncuq.supabase.co",
  SUPABASE_ANON: "sb_publishable_lZnI-fkOhRwGkW5MwYoqVg_dY0u0k9m",

  // --- Cloudinary ---
  CLOUDINARY_CLOUD:  "dkxcysx1f",
  CLOUDINARY_PRESET: "restaurante",
};
