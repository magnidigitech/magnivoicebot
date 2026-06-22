import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import axios from 'axios';
import WebSocket from 'ws';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

// Basic health check route
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'OK', timestamp: new Date().toISOString() });
});

const server = http.createServer(app);

// Initialize a raw WebSocket Server
const wss = new WebSocketServer({ noServer: true });

// LLM Response Generator using Chosen Provider (Gemini/OpenAI)
async function getLLMResponse(userInput, transcriptArray) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    console.error('LLM_API_KEY is not defined in environment variables.');
    return 'క్షమించండి, సర్వర్ కనెక్ట్ కావడంలో ఇబ్బంది ఉంది.';
  }

  const systemInstruction = `You are "Swathi", a warm, polite customer service voice agent for a premier travel agency in Andhra Pradesh.
Your goal is to collect feedback on a recently completed ride. Keep responses exceptionally brief (1–2 sentences max) so voice latency stays sub-second.

Conversation Flow:
1. Ask how the ride went.
2. If the feedback is positive, express gratitude and ask if they would be willing to leave a Google review ("నేను మీకు వాట్సాప్లో రివ్యూ లింక్ పంపించనా?").
3. If the feedback is negative, apologize sincerely, ask for the reason, and do NOT mention a review link.

Language:
- Comprehend both pure Telugu and conversational "Telugish" (Telugu mixed with common English transit terms).
- Always reply in natural, colloquial spoken Telugu. Avoid overly formal or bookish dictionary words.`;

  const messages = [
    { role: 'system', content: systemInstruction }
  ];

  // Reconstruct conversation history from transcriptArray
  if (transcriptArray && transcriptArray.length > 0) {
    for (const pastInput of transcriptArray) {
      if (pastInput && pastInput !== userInput) {
        messages.push({ role: 'user', content: pastInput });
      }
    }
  }

  // Add the current user input
  messages.push({ role: 'user', content: userInput });

  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  let endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let model = 'gemini-2.5-flash';

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    model = 'gpt-4o-mini';
  }

  try {
    const response = await axios.post(
      endpoint,
      {
        model: model,
        messages: messages,
        temperature: 0.3,
        max_tokens: 150
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 5000
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    return reply ? reply.trim() : '';
  } catch (err) {
    console.error('LLM API error:', err.message);
    return 'క్షమించండి, సర్వర్ కనెక్ట్ కావడంలో ఇబ్బంది ఉంది.';
  }
}

// Post-call sentiment analyzer
async function analyzeSentiment(transcriptArray) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey || !transcriptArray || transcriptArray.length === 0) {
    return 'negative';
  }

  const conversationText = transcriptArray.join('\n');
  const systemPrompt = `You are a sentiment analyzer. Analyze the user's overall satisfaction from the following call transcript. 
Output exactly one word: either "positive" or "negative". Do not include any punctuation, formatting, or other words.`;

  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  let endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let model = 'gemini-2.5-flash';

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/chat/completions';
    model = 'gpt-4o-mini';
  }

  try {
    const response = await axios.post(
      endpoint,
      {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Transcript:\n${conversationText}` }
        ],
        temperature: 0.1,
        max_tokens: 10
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 5000
      }
    );

    const result = response.data?.choices?.[0]?.message?.content?.trim().toLowerCase();
    if (result && (result.includes('positive') || result.includes('negative'))) {
      return result.includes('positive') ? 'positive' : 'negative';
    }
    return 'negative';
  } catch (err) {
    console.error('Sentiment analysis API error:', err.message);
    return 'negative';
  }
}

// Upgrade HTTP connection on /voice to WebSocket
server.on('upgrade', (request, socket, head) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/voice') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch (error) {
    console.error('Upgrade handling error:', error);
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log('Incoming Exotel media stream connection established.');

  let streamSid = null;
  let callSid = null;
  let callerId = null;
  const transcriptLogs = [];
  const aiResponseLogs = [];
  let isSessionClosed = false;

  let sarvamSttWs = null;
  let sarvamTtsWs = null;

  // Helper to send the initial greeting
  function sendInitialGreeting() {
    const greetingText = "నమస్కారం, నేను ట్రావెల్ ఏజెన్సీ నుండి స్వాతిని మాట్లాడుతున్నాను. మీ రైడ్ ఎలా సాగింది?";
    console.log(`[Swathi Greeting]: ${greetingText}`);
    aiResponseLogs.push(greetingText);

    if (sarvamTtsWs && sarvamTtsWs.readyState === WebSocket.OPEN) {
      const ttsMessage = {
        type: 'text',
        data: {
          text: greetingText
        }
      };
      sarvamTtsWs.send(JSON.stringify(ttsMessage));
    } else {
      console.warn('Cannot send initial greeting: Sarvam TTS WebSocket is not open.');
    }
  }

  const sarvamApiKey = process.env.SARVAM_API_KEY;

  if (!sarvamApiKey) {
    console.error('ERROR: SARVAM_API_KEY is not defined in environment variables.');
  }

  // Connects to Sarvam Speech-to-Text (STT) WebSocket
  function initSarvamStt() {
    if (!sarvamApiKey) return;

    const sttUrl = 'wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3';
    console.log(`Connecting to Sarvam STT WebSocket at: ${sttUrl}`);

    sarvamSttWs = new WebSocket(sttUrl, {
      headers: {
        'api-subscription-key': sarvamApiKey
      }
    });

    sarvamSttWs.on('open', () => {
      console.log('Sarvam STT connection opened successfully.');
      // Send initial configuration payload
      const config = {
        model: 'saaras:v3',
        language_code: 'te-IN',
        mode: 'transcribe'
      };
      sarvamSttWs.send(JSON.stringify(config));
    });

    sarvamSttWs.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Handle different possible payload structures from Sarvam STT
        const text = msg.transcript || (msg.data && msg.data.transcript);

        if (text && text.trim()) {
          console.log(`[STT Transcription]: ${text}`);
          transcriptLogs.push(text);

          // Get response from LLM Intelligence Layer
          const aiResponse = await getLLMResponse(text, transcriptLogs);
          console.log(`[LLM Response]: ${aiResponse}`);
          aiResponseLogs.push(aiResponse);

          // Stream LLM response text to Sarvam TTS WebSocket
          if (sarvamTtsWs && sarvamTtsWs.readyState === WebSocket.OPEN) {
            const ttsMessage = {
              type: 'text',
              data: {
                text: aiResponse
              }
            };
            sarvamTtsWs.send(JSON.stringify(ttsMessage));
          } else {
            console.warn('Cannot synthesize TTS: Sarvam TTS WebSocket is not open.');
          }
        }
      } catch (err) {
        console.error('Error processing Sarvam STT message:', err);
      }
    });

    sarvamSttWs.on('error', (err) => {
      console.error('Sarvam STT connection error:', err.message);
    });

    sarvamSttWs.on('close', (code, reason) => {
      console.log(`Sarvam STT connection closed. Code: ${code}, Reason: ${reason}`);
    });
  }

  // Connects to Sarvam Text-to-Speech (TTS) WebSocket
  function initSarvamTts() {
    if (!sarvamApiKey) return;

    const ttsUrl = 'wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v3';
    console.log(`Connecting to Sarvam TTS WebSocket at: ${ttsUrl}`);

    sarvamTtsWs = new WebSocket(ttsUrl, {
      headers: {
        'api-subscription-key': sarvamApiKey
      }
    });

    sarvamTtsWs.on('open', () => {
      console.log('Sarvam TTS connection opened successfully.');
      // Send configuration message
      const config = {
        type: 'config',
        data: {
          target_language_code: 'te-IN',
          speaker: 'priya',
          output_audio_codec: 'linear16',
          speech_sample_rate: 8000
        }
      };
      sarvamTtsWs.send(JSON.stringify(config));
    });

    sarvamTtsWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Handle TTS audio chunk
        if (msg.type === 'audio' && msg.data && msg.data.audio) {
          const audioPayload = msg.data.audio; // This is a base64 encoded audio string
          
          if (ws.readyState === WebSocket.OPEN && streamSid) {
            const responseFrame = {
              event: 'media',
              stream_sid: streamSid,
              media: {
                payload: audioPayload
              }
            };
            ws.send(JSON.stringify(responseFrame));
          }
        }
      } catch (err) {
        console.error('Error processing Sarvam TTS message:', err);
      }
    });

    sarvamTtsWs.on('error', (err) => {
      console.error('Sarvam TTS connection error:', err.message);
    });

    sarvamTtsWs.on('close', (code, reason) => {
      console.log(`Sarvam TTS connection closed. Code: ${code}, Reason: ${reason}`);
    });
  }

  // Connect to Sarvam STT and TTS concurrently
  initSarvamStt();
  initSarvamTts();

  // Listen for media stream messages from Exotel
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      switch (msg.event) {
        case 'start':
          streamSid = msg.stream_sid;
          callSid = msg.start ? msg.start.call_sid : null;
          callerId = msg.start ? msg.start.from : null;
          console.log(`Exotel Call Start detected: stream_sid=${streamSid}, call_sid=${callSid}, callerId=${callerId}`);
          
          // Trigger initial greeting from Swathi once connection starts
          setTimeout(() => {
            sendInitialGreeting();
          }, 1500);
          break;

        case 'media':
          // Stream raw binary audio payloads directly to Sarvam STT
          if (msg.media && msg.media.payload) {
            if (sarvamSttWs && sarvamSttWs.readyState === WebSocket.OPEN) {
              const audioBuffer = Buffer.from(msg.media.payload, 'base64');
              sarvamSttWs.send(audioBuffer);
            }
          }
          break;

        case 'dtmf':
          console.log(`DTMF Event received: ${msg.dtmf ? msg.dtmf.digit : 'unknown'}`);
          break;

        case 'stop':
          console.log(`Exotel Call Stop detected: stream_sid=${streamSid}`);
          break;

        default:
          console.log(`Unhandled Exotel event: ${msg.event}`);
      }
    } catch (err) {
      console.error('Error processing Exotel message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('Exotel WebSocket connection error:', err.message);
  });

  // Handle call disconnection
  ws.on('close', async (code, reason) => {
    if (isSessionClosed) return;
    isSessionClosed = true;
    console.log(`Exotel WebSocket connection closed. Code: ${code}, Reason: ${reason}`);

    // Gracefully close STT connection
    if (sarvamSttWs) {
      try {
        sarvamSttWs.close();
      } catch (e) {
        console.error('Failed to close Sarvam STT WebSocket:', e.message);
      }
    }

    // Gracefully close TTS connection
    if (sarvamTtsWs) {
      try {
        sarvamTtsWs.close();
      } catch (e) {
        console.error('Failed to close Sarvam TTS WebSocket:', e.message);
      }
    }

    // Prepare and dispatch the call summary to N8N webhook
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        console.log('Analyzing call sentiment...');
        const sentiment = await analyzeSentiment(transcriptLogs);

        const payload = {
          caller_id: callerId,
          stream_sid: streamSid,
          call_sid: callSid,
          timestamp: new Date().toISOString(),
          transcript: transcriptLogs.join(' '),
          ai_responses: aiResponseLogs.join(' '),
          sentiment: sentiment,
          status: 'completed'
        };
        console.log(`Forwarding call summary to N8N webhook...`);
        await axios.post(webhookUrl, payload, { timeout: 5000 });
        console.log('Successfully posted call summary to N8N.');
      } catch (err) {
        console.error(`Failed to post call summary to N8N webhook: ${err.message}`);
      }
    } else {
      console.log('N8N_WEBHOOK_URL is not set. Skipping webhook posting.');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`WebSocket server endpoint: ws://localhost:${PORT}/voice`);
});
