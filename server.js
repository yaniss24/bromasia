const express = require('express');
const multer = require('multer');
const fs = require('fs');
const app = express();
const upload = multer({ dest: '/tmp/' });

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static('.', { etag: false, lastModified: false, setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); } }));
app.use(express.json());

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const LEMON_API_KEY = process.env.LEMON_API_KEY;
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Rutas páginas
app.get('/privacidad', (req, res) => res.sendFile(__dirname + '/privacidad.html'));
app.get('/terminos', (req, res) => res.sendFile(__dirname + '/terminos.html'));
app.get('/aviso-legal', (req, res) => res.sendFile(__dirname + '/aviso-legal.html'));
app.get('/login', (req, res) => res.sendFile(__dirname + '/login.html'));
app.get('/registro', (req, res) => res.sendFile(__dirname + '/registro.html'));
app.get('/categorias', (req, res) => res.sendFile(__dirname + '/categorias.html'));
app.get('/perfil', (req, res) => res.sendFile(__dirname + '/perfil.html'));
app.get('/generador', (req, res) => res.sendFile(__dirname + '/generador.html'));
app.get('/precios', (req, res) => res.sendFile(__dirname + '/precios.html'));
app.get('/gracias', (req, res) => res.sendFile(__dirname + '/gracias.html'));

// API créditos
app.get('/api/creditos', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.json({ creditos: null });
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.json({ creditos: null });
    const { data } = await supabase.from('usuarios').select('creditos').eq('id', user.id).single();
    res.json({ creditos: data?.creditos ?? 0 });
  } catch(err) {
    res.json({ creditos: 0 });
  }
});

// API generar
app.post('/api/generar', upload.single('imagen'), async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userId = null;
    let creditos = 0;

    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        userId = user.id;
        const { data } = await supabase.from('usuarios').select('creditos').eq('id', userId).single();
        creditos = data?.creditos ?? 0;
        if (creditos < 10) {
          if (req.file) fs.unlinkSync(req.file.path);
          return res.status(403).json({ error: 'Sin créditos. Recarga para continuar.' });
        }
      }
    }

    if (!req.file) return res.status(400).json({ error: 'No se recibió foto' });

    const prompt = req.body.prompt || req.body.broma || 'Transforma esta foto de forma sorprendente y realista';
    const imageData = fs.readFileSync(req.file.path);
    const base64 = imageData.toString('base64');
    const mime = req.file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${base64}`;

    const response = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: { prompt, input_image: dataUri, output_format: 'jpg', safety_tolerance: 5 }
      })
    });

    const data = await response.json();
    fs.unlinkSync(req.file.path);

    const imagen = Array.isArray(data.output) ? data.output[0] : data.output;
    if (!imagen) return res.status(500).json({ error: data.error || 'Sin output de Replicate' });

    // Descontar crédito y guardar broma
    if (userId) {
      await supabase.from('usuarios').update({ creditos: creditos - 10 }).eq('id', userId);
      await supabase.from('bromas').insert({ user_id: userId, imagen_url: imagen, prompt: prompt });
    }

    res.json({ url: imagen, imagen });
  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Webhook Lemon Squeezy
app.post('/api/webhook-lemon', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const email = payload?.data?.attributes?.user_email;
    const evento = payload?.meta?.event_name;
    if (email && (evento === 'order_created' || evento === 'subscription_created')) {
      const { data: usuario } = await supabase.from('usuarios').select('id, creditos').eq('email', email).single();
      if (usuario) {
        await supabase.from('usuarios').update({ creditos: (usuario.creditos || 0) + 10 }).eq('id', usuario.id);
      }
    }
    res.sendStatus(200);
  } catch(err) {
    res.sendStatus(200);
  }
});

app.listen(3000, () => console.log('BromasIA corriendo en http://localhost:3000'));
