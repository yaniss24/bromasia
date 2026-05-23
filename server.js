const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function enviarBienvenida(email) {
  try {
    await resend.emails.send({
      from: 'BromasIA <hola@bromasia.com>',
      to: email,
      subject: '¡Bienvenido a BromasIA! 🎭',
      html: `
        <div style="background:#0D0D14;color:white;font-family:Inter,sans-serif;padding:40px;max-width:600px;margin:0 auto;border-radius:16px;">
          <h1 style="font-size:2rem;font-weight:900;margin-bottom:8px;">Bromas<span style="color:#8A5CFF">IA</span></h1>
          <h2 style="font-size:1.4rem;margin-bottom:16px;">¡Ya eres parte del caos! 😈</h2>
          <p style="color:#9B9BB4;line-height:1.7;margin-bottom:24px;">Bienvenido a BromasIA, la IA de las bromas más realistas de España. Ya tienes tus créditos listos para empezar.</p>
          <a href="https://bromasia.com/categorias" style="background:#8A5CFF;color:white;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700;font-size:1rem;display:inline-block;margin-bottom:24px;">🎭 Lanzar mi primera broma</a>
          <p style="color:#666;font-size:12px;margin-top:32px;">© 2026 BromasIA · <a href="https://bromasia.com/privacidad" style="color:#666;">Privacidad</a></p>
        </div>
      `
    });
  } catch(e) { console.log('Email error:', e.message); }
}
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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

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
app.get('/historial', (req, res) => res.sendFile(__dirname + '/historial.html'));

app.get('/api/download', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('No URL');
    const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
    const response = await fetch(url);
    const buffer = await response.buffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="bromasia.jpg"');
    res.send(buffer);
  } catch(err) {
    res.status(500).send('Error');
  }
});

// API créditos
app.get('/api/creditos', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.json({ creditos: null });
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.json({ creditos: null });
    let { data } = await supabase.from('usuarios').select('creditos').eq('id', user.id).single();
    if (!data) {
      await supabase.from('usuarios').insert({ id: user.id, email: user.email, creditos: 0 });
      data = { creditos: 0 };
      enviarBienvenida(user.email);
    }
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

    const promptOriginal = (req.body.prompt || req.body.broma || '').trim();

    // Mejorar prompt con Claude
    let promptMejorado = promptOriginal;
    try {
      const fetch2 = (...args) => import('node-fetch').then(({default: f}) => f(...args));
      const claudeRes = await fetch2('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: 'You are an expert at writing prompts for AI image editing models. Convert this user request into a detailed technical prompt in English for realistic photo editing. Keep it under 100 words. Only respond with the prompt, nothing else. User request: ' + promptOriginal
          }]
        })
      });
      const claudeData = await claudeRes.json();
      if (claudeData.content?.[0]?.text) promptMejorado = claudeData.content[0].text.trim();
    } catch(e) { console.log('Claude prompt error:', e.message); }
    const prompt = promptMejorado;
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
        input: { prompt, input_image: dataUri, output_format: 'jpg', safety_tolerance: 6 }
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
