const express = require('express');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer({ dest: '/tmp/' });

app.use(express.static('.'));
app.use(express.json());

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const LEMON_API_KEY = process.env.LEMON_API_KEY;

// IPs que ya usaron su broma gratis
const ipUsadas = new Set();

app.post('/api/generar', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibio foto' });
    if (!req.body.broma) return res.status(400).json({ error: 'No se recibio descripcion' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

    if (ipUsadas.has(ip)) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'limite', mensaje: 'Ya usaste tu broma gratis. ¡Desbloquea para generar más!' });
    }

    const prompt = req.body.broma;
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
        input: {
          prompt,
          input_image: dataUri,
          output_format: 'jpg',
          safety_tolerance: 5
        }
      })
    });

    const data = await response.json();
    fs.unlinkSync(req.file.path);

    const imagen = Array.isArray(data.output) ? data.output[0] : data.output;
    if (!imagen) return res.status(500).json({ error: data.error || 'Sin output' });

    // Marcar IP como usada
    ipUsadas.add(ip);

    res.json({ imagen });
  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/verificar-pago', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false });

    const response = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions?filter[user_email]=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${LEMON_API_KEY}`,
        'Accept': 'application/vnd.api+json'
      }
    });

    const data = await response.json();
    const subs = data.data || [];
    const activa = subs.some(s => s.attributes.status === 'active');

    // Si tiene suscripción activa, resetear su IP
    if (activa) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
      ipUsadas.delete(ip);
    }

    res.json({ ok: activa });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.listen(3000, () => console.log('BromasIA corriendo en http://localhost:3000'));
