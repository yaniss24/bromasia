
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
app.post('/api/generar', upload.fields([{name:'imagen',maxCount:1},{name:'referencia',maxCount:1}]), async (req, res) => {
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
          if (req.files?.['imagen']?.[0]) fs.unlinkSync(req.files['imagen'][0].path);
          return res.status(403).json({ error: 'Sin créditos. Recarga para continuar.' });
        }
      }
    }

    if (!req.files?.['imagen']?.[0]) return res.status(400).json({ error: 'No se recibió foto' });

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
            content: 'You are an expert at writing prompts for AI image editing (flux-kontext-pro model). Convert this Spanish user request into a detailed technical English prompt. IMPORTANT: Never remove or delete objects from the image. Always MODIFY or ADD to existing objects. Keep the same scene, same objects, just transform them realistically. Under 80 words. Only respond with the prompt, nothing else. User request: ' + promptOriginal
          }]
        })
      });
      const claudeData = await claudeRes.json();
      if (claudeData.content?.[0]?.text) promptMejorado = claudeData.content[0].text.trim();
    } catch(e) { console.log('Claude prompt error:', e.message); }
    const prompt = promptMejorado;
    const imageData = fs.readFileSync(req.files['imagen'][0].path);
    const base64 = imageData.toString('base64');
    const mime = req.files['imagen'][0].mimetype || 'image/jpeg';
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
    fs.unlinkSync(req.files['imagen'][0].path); if(req.files?.['referencia']?.[0]) fs.unlinkSync(req.files['referencia'][0].path);

    const imagen = Array.isArray(data.output) ? data.output[0] : data.output;
    if (!imagen) return res.status(500).json({ error: data.error || 'Sin output de Replicate' });

    // Guardar imagen en Supabase Storage
    let imagenFinal = imagen;
    try {
      const fetch2 = (...args) => import('node-fetch').then(({default: f}) => f(...args));
      const imgRes = await fetch2(imagen);
      const imgBuffer = await imgRes.buffer();
      const fileName = 'broma_' + Date.now() + '.jpg';
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('bromas')
        .upload(fileName, imgBuffer, { contentType: 'image/jpeg', upsert: false });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('bromas').getPublicUrl(fileName);
        imagenFinal = urlData.publicUrl;
      }
    } catch(e) { console.log('Storage error:', e.message); }

    // Descontar crédito y guardar broma
    if (userId) {
      await supabase.from('usuarios').update({ creditos: creditos - 10 }).eq('id', userId);
      await supabase.from('bromas').insert({ user_id: userId, imagen_url: imagenFinal, prompt: prompt });
    }

    res.json({ url: imagenFinal, imagen: imagenFinal });
  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Webhook Whop
app.get('/api/comprar', (req, res) => {
  const { pack, email } = req.query;
  const links = {
    starter: 'https://whop.com/bromasia/starter-200-creditos/',
    pro: 'https://whop.com/bromasia/pro-500-creditos/',
    max: 'https://whop.com/bromasia/max-1000-creditos/',
    mensual: 'https://whop.com/bromasia/suscripcion-mensual-350-creditos/'
  };
  const base = links[pack] || links.mensual;
  const url = email ? base + '?email=' + encodeURIComponent(email) : base;
  res.redirect(url);
});

app.post('/api/webhook-whop', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const email = payload?.data?.metadata?.email || payload?.data?.user?.email;
    const productId = payload?.data?.product_id || payload?.data?.plan?.product_id;

    const creditosMap = {
      'starter-200-creditos': 200,
      'pro-500-creditos': 500,
      'max-1000-creditos': 1000,
      'suscripcion-mensual-350-creditos': 350,
    };

    if (email && (evento === 'membership.went_valid' || evento === 'payment.succeeded')) {
      const slug = payload?.data?.product?.slug || payload?.data?.plan?.slug || '';
      const creditsToAdd = Object.entries(creditosMap).find(([key]) => slug.includes(key))?.[1] || 200;
      const { data: usuario } = await supabase.from('usuarios').select('id, creditos').eq('email', email).single();
      if (usuario) {
        await supabase.from('usuarios').update({ creditos: (usuario.creditos || 0) + creditsToAdd }).eq('id', usuario.id);
      }
    }
    res.sendStatus(200);
  } catch(err) {
    console.log('Whop webhook error:', err.message);
    res.sendStatus(200);
  }
});

// Webhook Paddle
app.post('/api/webhook-paddle', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const evento = payload?.event_type;
    const email = payload?.data?.customer?.email || payload?.data?.items?.[0]?.price?.custom_data?.email;
    const priceId = payload?.data?.items?.[0]?.price?.id;

    // Mapa de price IDs a créditos
    const creditosMap = {
      'pri_01ksfqh72fqwgsdd320n00gqr0': 200,  // Starter
      'pri_01ksfqzfc8f2e0nfqvab4ywq2e': 500,  // Pro
      'pri_01ksfr1e0z56w2v0f6m8qkr4p6': 1000, // Max
      'pri_01ksfr30nkmkx2gefqkfz758ap': 350,  // Suscripción
    };

    if (email && (evento === 'transaction.completed' || evento === 'subscription.activated')) {
      const creditsToAdd = creditosMap[priceId] || 200;
      const { data: usuario } = await supabase.from('usuarios').select('id, creditos').eq('email', email).single();
      if (usuario) {
        await supabase.from('usuarios').update({ creditos: (usuario.creditos || 0) + creditsToAdd }).eq('id', usuario.id);
      }
    }
    res.sendStatus(200);
  } catch(err) {
    res.sendStatus(200);
  }
});

app.listen(3000, () => console.log('BromasIA corriendo en http://localhost:3000'));
