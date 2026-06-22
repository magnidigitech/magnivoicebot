import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import axios from 'axios';
import WebSocket from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());

// Serve static dashboard page at / or /dashboard
app.use(express.static(path.join(__dirname, 'public')));
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Basic health check route
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'OK', timestamp: new Date().toISOString() });
});

const server = http.createServer(app);

// Initialize WebSocket Servers
const wss = new WebSocketServer({ noServer: true });
const dashboardWss = new WebSocketServer({ noServer: true });

// Dashboard tracking state
const dashboardClients = new Set();
const stats = { active: 0, total: 0, positive: 0, negative: 0 };
const callHistory = [];

function broadcastToDashboards(event, data) {
  const payload = JSON.stringify({ event, data });
  for (const client of dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Handle dashboard connection
dashboardWss.on('connection', (ws) => {
  console.log('Dashboard client connected.');
  dashboardClients.add(ws);

  // Send initial state to the dashboard
  ws.send(JSON.stringify({
    event: 'init_state',
    data: {
      stats,
      history: callHistory
    }
  }));

  ws.on('close', () => {
    console.log('Dashboard client disconnected.');
    dashboardClients.delete(ws);
  });
});

// LLM Response Generator using Chosen Provider (Gemini/OpenAI)
async function getLLMResponse(conversationHistory) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    console.error('LLM_API_KEY is not defined in environment variables.');
    return 'క్షమించండి, సర్వర్ కనెక్ట్ కావడంలో ఇబ్బంది ఉంది.';
  }

  const systemInstruction = `You are "Swathi", a warm, polite, and professional customer service voice agent for a premier travel agency in Andhra Pradesh.
Your goal is to collect feedback on a recently completed ride and address any concerns professionally.

Conversation Flow:
1. Ask how the ride went (initial greeting).
2. If the feedback is positive, express enthusiastic gratitude and ask if they would be willing to leave a Google review ("చాలా సంతోషం అండీ! నేను మీకు వాట్సాప్ లో మా గూగుల్ రివ్యూ లింక్ పంపించనా?").
3. If the feedback is negative or mentions any problem (e.g. AC not working, delay, driver behavior), apologize sincerely for the concern and inconvenience caused, explain that you will register this complaint and escalate it immediately to the management team to get it resolved, and thank them for helping us improve. Do NOT mention any review link.

Style & Tone:
- Speak like a friendly, professional call center agent.
- Provide natural, complete, and narrative sentences (around 2 to 3 sentences). Do NOT reply with single words or extremely brief answers like "అయ్యో" or "అయ్యో, ఏసీ".
- Comprehend both pure Telugu and conversational "Telugish" (Telugu mixed with common English transit terms like AC, driver, ride, travel, agency, etc.).
- Always reply in warm, colloquial spoken Telugu. Avoid overly formal or dictionary-heavy bookish terms.`;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...conversationHistory
  ];

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

// Upgrade HTTP connection to appropriate WebSocket Server
server.on('upgrade', (request, socket, head) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/voice') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/dashboard-ws') {
      dashboardWss.handleUpgrade(request, socket, head, (ws) => {
        dashboardWss.emit('connection', ws, request);
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

  let greetingSent = false;
  let ttsConfigured = false;

  const conversationHistory = [];
  let silenceTimer = null;
  let currentTurnTranscript = '';

  function attemptGreeting() {
    if (streamSid && ttsConfigured && !greetingSent) {
      greetingSent = true;
      sendInitialGreeting();
    }
  }

  // Helper to send the initial greeting
  function sendInitialGreeting() {
    const greetingText = "నమస్కారం, నేను ట్రావెల్ ఏజెన్సీ నుండి స్వాతిని మాట్లాడుతున్నాను. మీ రైడ్ ఎలా సాగింది?";
    console.log(`[Swathi Greeting]: ${greetingText}`);
    aiResponseLogs.push(greetingText);
    conversationHistory.push({ role: 'assistant', content: greetingText });

    // Broadcast greeting to dashboard
    broadcastToDashboards('response', {
      streamSid,
      text: greetingText
    });

    if (sarvamTtsWs && sarvamTtsWs.readyState === WebSocket.OPEN) {
      const ttsMessage = {
        type: 'text',
        data: {
          text: greetingText
        }
      };
      sarvamTtsWs.send(JSON.stringify(ttsMessage));
      sarvamTtsWs.send(JSON.stringify({ type: 'flush' }));
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

    const sttUrl = 'wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language-code=te-IN&mode=transcribe&sample_rate=8000';
    console.log(`Connecting to Sarvam STT WebSocket at: ${sttUrl}`);

    sarvamSttWs = new WebSocket(sttUrl, {
      headers: {
        'api-subscription-key': sarvamApiKey
      }
    });

    sarvamSttWs.on('open', () => {
      console.log('Sarvam STT connection opened successfully.');
    });

    sarvamSttWs.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Handle different possible payload structures from Sarvam STT
        const text = msg.transcript || (msg.data && msg.data.transcript);

        if (text && text.trim()) {
          // Accumulate the current transcript (cumulative update)
          currentTurnTranscript = text;

          // Debounce with an 800ms silence timer
          if (silenceTimer) {
            clearTimeout(silenceTimer);
          }

          silenceTimer = setTimeout(async () => {
            const finalUtterance = currentTurnTranscript.trim();
            currentTurnTranscript = ''; // Reset for next turn

            if (finalUtterance) {
              console.log(`[STT Final Utterance]: ${finalUtterance}`);
              transcriptLogs.push(finalUtterance);

              // Broadcast user transcription to dashboard
              broadcastToDashboards('transcription', {
                streamSid,
                text: finalUtterance
              });

              // Add to LLM history
              conversationHistory.push({ role: 'user', content: finalUtterance });

              // Get response from LLM Intelligence Layer
              const aiResponse = await getLLMResponse(conversationHistory);
              console.log(`[LLM Response]: ${aiResponse}`);
              aiResponseLogs.push(aiResponse);
              conversationHistory.push({ role: 'assistant', content: aiResponse });

              // Broadcast bot response to dashboard
              broadcastToDashboards('response', {
                streamSid,
                text: aiResponse
              });

              // Stream LLM response text to Sarvam TTS WebSocket
              if (sarvamTtsWs && sarvamTtsWs.readyState === WebSocket.OPEN) {
                const ttsMessage = {
                  type: 'text',
                  data: {
                    text: aiResponse
                  }
                };
                sarvamTtsWs.send(JSON.stringify(ttsMessage));
                sarvamTtsWs.send(JSON.stringify({ type: 'flush' }));
              } else {
                console.warn('Cannot synthesize TTS: Sarvam TTS WebSocket is not open.');
              }
            }
          }, 800);
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
      
      const speaker = process.env.SARVAM_SPEAKER || 'neha';
      const pace = parseFloat(process.env.SARVAM_PACE || '1.2');
      const temperature = parseFloat(process.env.SARVAM_TEMPERATURE || '0.2');

      // Send configuration message
      const config = {
        type: 'config',
        data: {
          target_language_code: 'te-IN',
          speaker: speaker,
          output_audio_codec: 'linear16',
          speech_sample_rate: 8000,
          pace: pace,
          temperature: temperature
        }
      };
      console.log(`Sending TTS Config: speaker=${speaker}, pace=${pace}, temp=${temperature}`);
      sarvamTtsWs.send(JSON.stringify(config));
      ttsConfigured = true;
      attemptGreeting();
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
          
          // Update active stats and broadcast to dashboard
          stats.active = 1;
          stats.total += 1;
          broadcastToDashboards('call_start', {
            streamSid,
            callSid,
            callerId
          });

          // Trigger initial greeting logic
          attemptGreeting();
          break;

        case 'media':
          // Stream base64-encoded audio payloads wrapped in JSON to Sarvam STT
          if (msg.media && msg.media.payload) {
            if (sarvamSttWs && sarvamSttWs.readyState === WebSocket.OPEN) {
              const audioMessage = {
                audio: {
                  data: msg.media.payload,
                  sample_rate: 8000,
                  encoding: 'audio/wav'
                }
              };
              sarvamSttWs.send(JSON.stringify(audioMessage));
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

    // Run sentiment analysis and compile results
    let sentiment = 'negative';
    try {
      console.log('Analyzing call sentiment...');
      sentiment = await analyzeSentiment(transcriptLogs);
    } catch (e) {
      console.error('Error analyzing sentiment:', e.message);
    }

    // Update history tracking
    stats.active = 0;
    if (sentiment === 'positive') stats.positive += 1;
    else stats.negative += 1;

    const formattedTranscript = transcriptLogs.map((t, idx) => `User: ${t}\nSwathi: ${aiResponseLogs[idx] || ''}`).join('\n');
    callHistory.unshift({
      caller_id: callerId,
      stream_sid: streamSid,
      timestamp: new Date().toISOString(),
      sentiment,
      transcript: formattedTranscript
    });
    if (callHistory.length > 20) callHistory.pop();

    // Broadcast call end to dashboard
    broadcastToDashboards('call_close', {
      streamSid,
      sentiment
    });

    // Prepare and dispatch the call summary to N8N webhook
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (webhookUrl) {
      try {
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
