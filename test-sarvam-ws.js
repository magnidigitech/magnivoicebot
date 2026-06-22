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

const ttsUrl = 'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3';
console.log(`Connecting to Sarvam TTS WebSocket at: ${ttsUrl}`);

const ws = new WebSocket(ttsUrl, {
  headers: {
    'api-subscription-key': apiKey
  }
});

ws.on('open', () => {
  console.log('SUCCESS: Connected to Sarvam TTS WebSocket.');
  
  // Send configuration message with speech_sample_rate set to 8000
  const config = {
    type: 'config',
    data: {
      target_language_code: 'te-IN',
      speaker: 'shubh',
      output_audio_codec: 'linear16',
      speech_sample_rate: 8000 // Set to 8000 Hz for Exotel
    }
  };
  console.log('Sending config:', JSON.stringify(config));
  ws.send(JSON.stringify(config));

  // Send a test synthesis text message after config is sent
  setTimeout(() => {
    const textMessage = {
      type: 'text',
      data: {
        text: 'నమస్కారం, నేను స్వాతిని మాట్లాడుతున్నాను. మీ రైడ్ ఎలా సాగింది?'
      }
    };
    console.log('Sending text message:', JSON.stringify(textMessage));
    ws.send(JSON.stringify(textMessage));
  }, 1000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    console.log('Received Message Type:', msg.type);
    if (msg.type === 'audio' && msg.data && msg.data.audio) {
      console.log('SUCCESS: Received audio chunk. Base64 length:', msg.data.audio.length);
      ws.close();
    } else {
      console.log('Received message:', JSON.stringify(msg).slice(0, 500));
    }
  } catch (err) {
    console.error('Error parsing received message:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket Error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
});
