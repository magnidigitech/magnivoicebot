import dotenv from 'dotenv';
import WebSocket from 'ws';

// Load environment variables
dotenv.config();

const apiKey = process.env.SARVAM_API_KEY;

console.log(`Checking Sarvam API Key: ${apiKey ? 'Yes (starts with ' + apiKey.slice(0, 10) + '...)' : 'No'}`);

if (!apiKey) {
  console.error('ERROR: SARVAM_API_KEY is not defined in .env');
  process.exit(1);
}

const sttUrl = 'wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language-code=te-IN&mode=transcribe&sample_rate=8000';
console.log(`Connecting to Sarvam STT WebSocket at: ${sttUrl}`);

const ws = new WebSocket(sttUrl, {
  headers: {
    'api-subscription-key': apiKey
  }
});

ws.on('open', () => {
  console.log('SUCCESS: Connected to Sarvam STT WebSocket.');
  
  // Send a JSON frame with base64-encoded audio
  setTimeout(() => {
    const dummyAudio = Buffer.alloc(320).toString('base64');
    const audioMessage = {
      audio: {
        data: dummyAudio,
        sample_rate: 8000,
        encoding: 'audio/wav'
      }
    };
    console.log('Sending JSON audio message:', JSON.stringify(audioMessage));
    ws.send(JSON.stringify(audioMessage));
  }, 1000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log('Received Message:', JSON.stringify(msg));
  } catch (err) {
    console.error('Error parsing message:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
});
