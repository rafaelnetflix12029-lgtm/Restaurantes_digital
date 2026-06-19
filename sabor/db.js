/* =====================================================================
   db.js — Capa de datos del restaurante (Supabase + Cloudinary)
   ---------------------------------------------------------------------
   Requiere que el HTML cargue, EN ESTE ORDEN, antes que este archivo:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="config.js"></script>
     <script src="db.js"></script>

   Uso: todas las funciones devuelven Promesas. Reemplazan la mutación de
   arrays en memoria del prototipo. Ej:
     const platos = await db.getPlatos();           // antes: leía el array
     await db.crearPlato({...});                     // antes: platos.push(...)
     db.escucharPedidos(p => render(p));             // realtime (admin)
   ===================================================================== */
(function () {
  const C = window.APP_CONFIG || {};
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON);

  /* ---------- LECTURAS PÚBLICAS (vista cliente) ---------- */
  async function getConfig() {
    const { data, error } = await sb.from("restaurante_config").select("*").eq("id", 1).single();
    if (error) throw error;
    return data;
  }
  async function getPlatos({ soloActivos = true } = {}) {
    let q = sb.from("platos").select("*").order("creado_en", { ascending: false });
    if (soloActivos) q = q.eq("activo", true);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async function getStories() {
    const { data, error } = await sb.from("stories").select("*")
      .eq("activo", true).order("creado_en", { ascending: false });
    if (error) throw error;
    // filtra las expiradas en cliente (por si expira_en ya pasó)
    return (data || []).filter(s => !s.expira_en || new Date(s.expira_en) > new Date());
  }
  async function getQR() {
    const { data, error } = await sb.from("configuracion_qr").select("*").order("hora_inicio");
    if (error) throw error;
    return data;
  }

  /* ---------- AUTENTICACIÓN ADMIN (Supabase Auth) ---------- */
  async function login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }
  async function logout() { await sb.auth.signOut(); }
  async function sesionActual() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user : null;
  }

  /* ---------- SUBIDA DE MEDIOS A CLOUDINARY ---------- */
  // Sube mp4/jpg/png/gif/pdf y devuelve { url, tipo }. Usa unsigned preset.
  async function subirMedia(file, onProgress) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", C.CLOUDINARY_PRESET);
    const endpoint = `https://api.cloudinary.com/v1_1/${C.CLOUDINARY_CLOUD}/auto/upload`;

    // fetch no da progreso; usamos XHR para barra de progreso opcional
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const r = JSON.parse(xhr.responseText);
          const ext = (r.format || "").toLowerCase();
          resolve({ url: r.secure_url, tipo: ext || r.resource_type });
        } else reject(new Error("Cloudinary: " + xhr.status + " " + xhr.responseText));
      };
      xhr.onerror = () => reject(new Error("Error de red al subir a Cloudinary"));
      xhr.send(fd);
    });
  }

  /* ---------- PLATOS (admin) ---------- */
  async function crearPlato(p) {
    const { data, error } = await sb.from("platos").insert({
      nombre: p.nombre, descripcion: p.descripcion, precio: p.precio,
      categoria: p.categoria, archivo_url: p.archivo_url || null,
      tipo_archivo: p.tipo_archivo || null, emoji: p.emoji || "🍽️",
      stock: (p.stock === "" || p.stock === undefined) ? null : p.stock, activo: true
    }).select().single();
    if (error) throw error;
    return data;
  }
  async function actualizarPlato(id, patch) {
    const { data, error } = await sb.from("platos").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  async function borrarPlato(id) {
    const { error } = await sb.from("platos").delete().eq("id", id);
    if (error) throw error;
  }

  /* ---------- STORIES (admin) ---------- */
  async function crearStory(s) {
    const expira = new Date(); expira.setHours(23, 59, 59); // expira al final del día
    const { data, error } = await sb.from("stories").insert({
      archivo_url: s.archivo_url || null, tipo_archivo: s.tipo_archivo || null,
      emoji: s.emoji || "📸", texto_descripcion: s.texto, activo: true,
      expira_en: s.expira_en || expira.toISOString()
    }).select().single();
    if (error) throw error;
    return data;
  }
  async function borrarStory(id) {
    const { error } = await sb.from("stories").delete().eq("id", id);
    if (error) throw error;
  }

  /* ---------- PEDIDOS ---------- */
  // Cliente: crea pedido vía RPC atómica. Lanza error 'FRANJA_LLENA' si no hay cupo.
  async function crearPedido(o) {
    const { data, error } = await sb.rpc("crear_pedido", {
      p_cliente_nombre: o.nombre, p_cliente_telefono: o.tel,
      p_items: o.items, p_total: o.total, p_franja: o.franja,
      p_lat: o.lat, p_lng: o.lng, p_metodo_pago: o.metodoPago,
      p_operacion: o.operacion || null
    });
    if (error) {
      if ((error.message || "").includes("FRANJA_LLENA"))
        throw new Error("Esa franja horaria acaba de llenarse, elige otra.");
      throw error;
    }
    return data; // fila del pedido, con numero_pedido
  }
  // Admin: lista pedidos del día
  async function getPedidos() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const { data, error } = await sb.from("pedidos").select("*")
      .gte("creado_en", hoy.toISOString()).order("creado_en", { ascending: false });
    if (error) throw error;
    return data;
  }
  // cuántos cupos quedan por franja (para pintar el selector)
  async function ocupacionFranjas() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const { data, error } = await sb.from("pedidos")
      .select("franja_horaria, estado").gte("creado_en", hoy.toISOString())
      .neq("estado", "entregado");
    if (error) throw error;
    const conteo = {};
    (data || []).forEach(p => { conteo[p.franja_horaria] = (conteo[p.franja_horaria] || 0) + 1; });
    return conteo;
  }
  async function setEstadoPedido(id, estado) {
    return actualizarPedido(id, { estado });
  }
  async function setEstadoPago(id, estado_pago) {
    return actualizarPedido(id, { estado_pago });
  }
  async function actualizarPedido(id, patch) {
    const { data, error } = await sb.from("pedidos").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------- CONFIG (admin) ---------- */
  async function guardarConfig(patch) {
    const { data, error } = await sb.from("restaurante_config").update(patch).eq("id", 1).select().single();
    if (error) throw error;
    return data;
  }

  /* ---------- REALTIME (admin) ---------- */
  // Llama al callback cada vez que cambian los pedidos (insert/update/delete).
  function escucharPedidos(callback) {
    return sb.channel("pedidos-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, payload => callback(payload))
      .subscribe();
  }
  // Cliente: escucha cambios de platos (stock/agotado en vivo).
  function escucharPlatos(callback) {
    return sb.channel("platos-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "platos" }, payload => callback(payload))
      .subscribe();
  }

  /* ---------- API pública ---------- */
  window.db = {
    sb,
    getConfig, getPlatos, getStories, getQR,
    login, logout, sesionActual,
    subirMedia,
    crearPlato, actualizarPlato, borrarPlato,
    crearStory, borrarStory,
    crearPedido, getPedidos, ocupacionFranjas, setEstadoPedido, setEstadoPago,
    guardarConfig,
    escucharPedidos, escucharPlatos,
  };
})();
