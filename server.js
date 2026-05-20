const express = require('express');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer({ dest: '/tmp/' });

app.use(express.static('.'));

app.post('/api/generar', upload.single('foto'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibio foto' });
    if (!req.body.broma) return res.status(400).json({ error: 'No se recibio descripcion' });

    const prompt = req.body.broma;
    const imageData = fs.readFileSync(req.file.path);
    const base64 = imageData.toString('base64');
    const mime = req.file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${base64}`;

    const response = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}`,
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
    console.log('Replicate response status:', data.status);

    fs.unlinkSync(req.file.path);

    const imagen = Array.isArray(data.output) ? data.output[0] : data.output;
    if (!imagen) return res.status(500).json({ error: data.error || 'Sin output' });

    res.json({ imagen });
  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('BromasIA corriendo en http://localhost:3000'));
