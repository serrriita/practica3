

// Elementos DOM 
const roomInput   = document.getElementById('room-input');
const joinBtn     = document.getElementById('join-btn');
const statusEl    = document.getElementById('status');
const roomPanel   = document.getElementById('room-panel');
const videosPanel = document.getElementById('videos-panel');
const controlsEl  = document.getElementById('controls');
const chatPanel   = document.getElementById('chat-panel');
const aiPanel     = document.getElementById('ai-panel');
const localVideo  = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const muteBtn     = document.getElementById('mute-btn');
const camBtn      = document.getElementById('cam-btn');
const hangBtn     = document.getElementById('hang-btn');
const chatLog     = document.getElementById('chat-log');
const chatInput   = document.getElementById('chat-input');
const chatSend    = document.getElementById('chat-send');
const aiBtn       = document.getElementById('ai-btn');
const aiOutput    = document.getElementById('ai-output');
const _log = console.log.bind(console);
console.log = (...args) => {
  _log(...args);
  const el = document.getElementById('debug-log');
 if (el) el.style.display = 'block';
 if (el) {
    el.innerHTML += args.join(' ') + '<br>';
    el.scrollTop = el.scrollHeight;
  }
};
//  Estado 
let socket        = null;
let roomId        = null;
let localStream   = null;
let peerConn      = null;
let dataChannel   = null;
let isMuted       = false;
let isCamOff      = false;
let sessionLog    = [];
let mediaRecorder = null;
let audioChunks   = [];

// ICE config 
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:global.relay.metered.ca:443?transport=tcp',
      username: '83e09682a747de7c22192c97',
      credential: '1bmH2JVE2GbPvI4q'
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: '83e09682a747de7c22192c97',
      credential: '1bmH2JVE2GbPvI4q'
    }
  ]
};
// Utilidades UI 
function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className   = 'status ' + type;
  const dot = document.getElementById('status-dot');
  if (dot) {
    dot.className = 'status-dot';
    if (type === 'connected') dot.classList.add('on');
    if (type === 'error')     dot.classList.add('err');
  }
  console.log('[Status]', msg);
  sessionLog.push(msg);
}

function addChatMsg(text, type = '') {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + type;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

//Iniciar grabación 
function startRecording() {
  if (!localStream || !window.MediaRecorder) return;
  audioChunks = [];
  const audioStream = new MediaStream(localStream.getAudioTracks());
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  try {
    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start(1000); // chunk cada segundo
    console.log('[MediaRecorder] Grabación iniciada');
  } catch(e) {
    console.warn('[MediaRecorder] No soportado:', e.message);
  }

  // Visualizador de audio
  try {
    const audioCtx = new AudioContext();
    const source   = audioCtx.createMediaStreamSource(audioStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const bars      = document.querySelectorAll('.meter-bar');
    function drawMeter() {
      requestAnimationFrame(drawMeter);
      analyser.getByteFrequencyData(dataArray);
      const avg    = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const active = Math.round((avg / 255) * bars.length);
      bars.forEach((bar, i) => {
        bar.classList.toggle('active', i < active);
        bar.classList.toggle('peak',   i < active && i >= active - 2);
      });
    }
    drawMeter();
  } catch(e) {
    console.warn('[AudioMeter] No soportado:', e.message);
  }
}

function showCallUI() {
  videosPanel.style.display = 'grid';
  controlsEl.style.display  = 'flex';
  chatPanel.style.display   = 'flex';
  aiPanel.style.display     = 'flex';

  if (!document.getElementById('audio-meter')) {
    const meter = document.createElement('div');
    meter.id = 'audio-meter';
    meter.innerHTML = `
      <span class="meter-label">🎤 MIC</span>
      <div class="meter-bars" id="meter-bars">
        ${Array(20).fill('<div class="meter-bar"></div>').join('')}
      </div>`;
    controlsEl.after(meter);
  }

  startRecording();
}

// 1. Join 
joinBtn.addEventListener('click', async () => {
  roomId = roomInput.value.trim();
  if (!roomId) { setStatus('Introduce un nombre de sala.', 'error'); return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    setStatus('Cámara activa. Conectando al servidor...', '');
  } catch (err) {
    setStatus('Error al acceder a la cámara/micrófono: ' + err.message, 'error');
    return;
  }

  socket = io("https://gdie2608.ltim.uib.es");
  bindSocketEvents();
  socket.emit('join', roomId);
  joinBtn.disabled = true;
  setStatus(`Uniéndose a la sala "${roomId}"...`);
});

// 2. Socket.IO 
function bindSocketEvents() {
  socket.on('connect', () => console.log('[Socket.IO] Conectado:', socket.id));

  socket.on('room-full', (room) => {
    setStatus(`Sala "${room}" llena. Prueba con otro nombre.`, 'error');
    joinBtn.disabled = false;
  });

  socket.on('ready', async (room) => {
    setStatus(`Sala "${room}" lista. Iniciando llamada...`, 'connected');
    showCallUI();
    await createPeerConnection();
    await createAndSendOffer();
  });

  socket.on('offer', async ({ offer }) => {
    console.log('[Socket.IO] offer recibida');
    setStatus('Oferta recibida. Conectando...', '');
    await createPeerConnection();
    await peerConn.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConn.createAnswer();
    await peerConn.setLocalDescription(answer);
    socket.emit('answer', { roomId, answer });
    console.log('[Socket.IO] answer enviada');
    showCallUI();
});

  socket.on('answer', async ({ answer }) => {
    console.log('[Socket.IO] answer recibida');
    await peerConn.setRemoteDescription(new RTCSessionDescription(answer));
    setStatus('Conectado con el otro peer.', 'connected');
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    if (!candidate) return;
    try {
      await peerConn.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('[ICE] Candidato remoto añadido');
    } catch (e) {
      console.error('[ICE] Error añadiendo candidato:', e);
    }
  });

  socket.on('peer-left', () => {
    setStatus('El otro usuario ha abandonado la sala.', 'error');
    addChatMsg('⚠ El otro usuario se desconectó.', 'system');
    remoteVideo.srcObject = null;
  });
}

//  3. RTCPeerConnection 
async function createPeerConnection() {
  peerConn = new RTCPeerConnection(ICE_CONFIG);

  localStream.getTracks().forEach(track => peerConn.addTrack(track, localStream));

  peerConn.ontrack = (event) => {
    console.log('[WebRTC] Track remoto recibido');
    remoteVideo.srcObject = event.streams[0];
    const ph = document.getElementById('remote-placeholder');
    if (ph) ph.style.display = 'none';
    setStatus('Videollamada activa.', 'connected');
  };

  peerConn.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('[ICE] Enviando candidato:', event.candidate.type, event.candidate.candidate);;
      socket.emit('ice-candidate', { roomId, candidate: event.candidate });
    }
  };

  peerConn.oniceconnectionstatechange = () => {
    console.log('[ICE] Estado:', peerConn.iceConnectionState);
    if (peerConn.iceConnectionState === 'disconnected' ||
        peerConn.iceConnectionState === 'failed') {
      setStatus('Conexión ICE perdida.', 'error');
    }
  };

  peerConn.ondatachannel = (event) => {
    setupDataChannel(event.channel);
    addChatMsg('Canal de datos establecido.', 'system');
  };

  console.log('[WebRTC] RTCPeerConnection creada');
}

// 4. Oferta 
async function createAndSendOffer() {
  dataChannel = peerConn.createDataChannel('chat');
  setupDataChannel(dataChannel);
  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);
  socket.emit('offer', { roomId, offer });
  console.log('[Socket.IO] offer enviada');
}

//5. DataChannel 
function setupDataChannel(channel) {
  dataChannel = channel;
  channel.onopen    = () => { console.log('[DataChannel] Abierto'); addChatMsg('✅ Canal de datos listo.', 'system'); };
  channel.onmessage = (e) => { addChatMsg('Remoto: ' + e.data); sessionLog.push('Remoto: ' + e.data); };
  channel.onclose   = () => { addChatMsg('Canal de datos cerrado.', 'system'); };
  channel.onerror   = (e) => { console.error('[DataChannel] Error:', e); };
}

chatSend.addEventListener('click', sendChatMsg);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMsg(); });

function sendChatMsg() {
  const msg = chatInput.value.trim();
  if (!msg || !dataChannel || dataChannel.readyState !== 'open') return;
  dataChannel.send(msg);
  addChatMsg('Tú: ' + msg, 'mine');
  sessionLog.push('Tú: ' + msg);
  chatInput.value = '';
}

// 6. Controles 
muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.textContent = isMuted ? '🔇 Activar micro' : '🎤 Silenciar';
});

camBtn.addEventListener('click', () => {
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  camBtn.textContent = isCamOff ? '📷 Activar cámara' : '📷 Apagar cámara';
});

hangBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (peerConn)     { peerConn.close(); peerConn = null; }
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); }
  if (socket)       { socket.emit('leave', roomId); socket.disconnect(); }
  remoteVideo.srcObject = null;
  localVideo.srcObject  = null;
  videosPanel.style.display = 'none';
  controlsEl.style.display  = 'none';
  chatPanel.style.display   = 'none';
  aiPanel.style.display     = 'none';
  chatLog.innerHTML = '';
  audioChunks       = [];
  joinBtn.disabled  = false;
  setStatus('Llamada finalizada.', '');
});

//  7. IA 
aiBtn.addEventListener('click', async () => {
  if (sessionLog.length === 0) {
    aiOutput.textContent = 'No hay actividad de sesión para resumir.';
    return;
  }

  aiBtn.disabled       = true;
  aiOutput.textContent = 'Transcribiendo audio...';

  // Parar grabación y esperar a que termine
  await new Promise((resolve) => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.addEventListener('stop', resolve, { once: true });
      mediaRecorder.stop();
    } else {
      resolve();
    }
  });

  console.log('[Audio] Chunks:', audioChunks.length);

  if (audioChunks.length > 0) {
    try {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const formData  = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      const transcResp = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const transcData = await transcResp.json();
      if (transcData.transcript) {
        sessionLog.push('🎤 Transcripción: ' + transcData.transcript);
        console.log('[Whisper] Transcripción añadida:', transcData.transcript);
      }
    } catch(err) {
      console.warn('[Whisper] Error:', err.message);
    }
  }

  aiOutput.textContent = 'Generando resumen con IA...';

  try {
    const response = await fetch('/api/ai-summary', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ sessionLog })
    });
    const data = await response.json();
    aiOutput.textContent = data.error ? 'Error: ' + data.error : data.summary;
  } catch (err) {
    aiOutput.textContent = 'Error al conectar con el servidor: ' + err.message;
  } finally {
    aiBtn.disabled = false;
    // Reiniciar grabación para la próxima vez
    startRecording();
  }
});
