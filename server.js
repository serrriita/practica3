const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const fs         = require('fs');
const Groq       = require('groq-sdk');
const multer     = require('multer');

const app    = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || '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' });

// Multer guardar audio en /tmp
const upload = multer({ dest: 'tmp/' });


app.use(express.json());

//  Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Servir la app WebRTC desde /webrtc
app.get('/webrtc', (req, res) => {
  res.sendFile(path.join(__dirname, 'webrtc', 'index.html'));
});

//  Endpoint transcripción de audio con Whisper 
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió audio.' });
  }

  // Renombrar el archivo con extensión .webm para que Whisper lo acepte
  const tmpPath  = req.file.path;
  const webmPath = tmpPath + '.webm';
  fs.renameSync(tmpPath, webmPath);
console.log('[Whisper] Tamaño archivo:', fs.statSync(webmPath).size, 'bytes');

  try {
    const transcription = await groq.audio.transcriptions.create({
      file:     fs.createReadStream(webmPath),
      model:    'whisper-large-v3',
      language: 'es'
    });

    console.log('[Whisper] Transcripción:', transcription.text);
    res.json({ transcript: transcription.text });

  } catch (err) {
    console.error('[Whisper] Error:', err.message);
    res.status(500).json({ error: 'Error en transcripción: ' + err.message });
  } finally {
    // Limpiar archivo temporal
    try { fs.unlinkSync(webmPath); } catch(_) {}
  }
});


app.post('/api/ai-summary', async (req, res) => {
  const { sessionLog } = req.body;

  if (!sessionLog || sessionLog.length === 0) {
    return res.status(400).json({ error: 'No hay actividad de sesión.' });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente que resume sesiones de videollamada WebRTC en español.'
        },
        {
          role: 'user',
          content: `Esta es la actividad registrada durante la sesión:
${sessionLog.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Genera un resumen breve incluyendo:
- Estado de la conexión
- Mensajes intercambiados
- Incidencias si las hubo`
        }
      ]
    });

    const text = completion.choices[0].message.content;
    console.log('[IA] Resumen generado con Groq');
    res.json({ summary: text });

  } catch (err) {
    console.warn('[IA] Groq no disponible, usando resumen local:', err.message);

    const conexion    = sessionLog.find(l => l.includes('activa') || l.includes('Conectado'));
    const mensajes    = sessionLog.filter(l => l.startsWith('Tú:') || l.startsWith('Remoto:'));
    const incidencias = sessionLog.filter(l => l.includes('Error') || l.includes('perdida') || l.includes('abandonado'));

    const summary = [
      '📋 RESUMEN DE SESIÓN WebRTC',
      '─────────────────────────────',
      `• Conexión: ${conexion ? '✅ Establecida correctamente' : '⚠ No completada'}`,
      `• Mensajes: ${mensajes.length > 0 ? mensajes.map(m => '\n    - ' + m).join('') : ' Ninguno'}`,
      `• Incidencias: ${incidencias.length > 0 ? incidencias.map(i => '\n    - ' + i).join('') : ' Ninguna'}`,
      `• Eventos registrados: ${sessionLog.length}`,
      '─────────────────────────────',
      '(Resumen generado localmente — API no disponible)'
    ].join('\n');

    res.json({ summary });
  }
});

// Gestión de salas y señalización WebRTC 
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Usuario conectado: ${socket.id}`);

  socket.on('join', (roomId) => {
    const room = rooms[roomId];

    if (room && room.size >= 2) {
      socket.emit('room-full', roomId);
      console.log(`[Socket.IO] Sala llena: ${roomId}`);
      return;
    }

    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(socket.id);

    console.log(`[Socket.IO] ${socket.id} se unió a sala: ${roomId} (${rooms[roomId].size}/2)`);

    if (rooms[roomId].size === 2) {
      socket.emit('ready', roomId);
      console.log(`[Socket.IO] Sala lista para WebRTC: ${roomId}`);
    }
  });

  socket.on('offer', ({ roomId, offer }) => {
    console.log(`[Socket.IO] offer de ${socket.id} en sala ${roomId}`);
    socket.to(roomId).emit('offer', { offer });
  });

  socket.on('answer', ({ roomId, answer }) => {
    console.log(`[Socket.IO] answer de ${socket.id} en sala ${roomId}`);
    socket.to(roomId).emit('answer', { answer });
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    console.log(`[Socket.IO] ICE candidate de ${socket.id} en sala ${roomId}`);
    socket.to(roomId).emit('ice-candidate', { candidate });
  });

  socket.on('leave', (roomId) => {
    if (!roomId || !rooms[roomId]) return;
    rooms[roomId].delete(socket.id);
    socket.to(roomId).emit('peer-left', socket.id);
    socket.leave(roomId);
    console.log(`[Socket.IO] ${socket.id} abandonó sala ${roomId}`);
    if (rooms[roomId].size === 0) {
      delete rooms[roomId];
      console.log(`[Socket.IO] Sala eliminada: ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Usuario desconectado: ${socket.id}`);

    for (const roomId in rooms) {
      if (rooms[roomId].has(socket.id)) {
        rooms[roomId].delete(socket.id);
        socket.to(roomId).emit('peer-left', socket.id);
        console.log(`[Socket.IO] ${socket.id} salió de sala ${roomId}`);

        if (rooms[roomId].size === 0) {
          delete rooms[roomId];
          console.log(`[Socket.IO] Sala eliminada: ${roomId}`);
        }
        break;
      }
    }
  });
});

// ── Arrancar servidor ────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Reproductor (P1): http://localhost:${PORT}/index.html`);
  console.log(`WebRTC (P3):      http://localhost:${PORT}/webrtc`);
});
