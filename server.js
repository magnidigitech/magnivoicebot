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

// Local keyword-triggered response engine (Instant, 0ms latency, zero API costs/rate limits)
function getKeywordResponse(userInput) {
  const input = userInput.toLowerCase();

  // 1. AC Issues
  if (input.includes('ac') || input.includes('ఏసీ') || input.includes('ఉక్క') || input.includes('కూలింగ్') || input.includes('cooling') || input.includes('వేడి') || input.includes('heat')) {
    return {
      speech: "ఓహ్, ఏసీ ప్రాబ్లం వచ్చిందా అండీ... జర్నీలో అది చాలా ఇబ్బంది కదా, సారీ అండీ. నేను ఈ కంప్లైంట్ ని మా మెయింటెనెన్స్ టీమ్ కి పంపిస్తున్నాను... నెక్స్ట్ ట్రిప్ కి ఆ బస్సు ని కంప్లీట్ గా చెక్ చేయిస్తాము అండీ.",
      action_tag: "log_maintenance_ticket"
    };
  }

  // 2. Conductor / Extortion / Extra Money
  if (input.includes('కండక్టర్') || input.includes('conductor') || input.includes('ఎక్స్ట్రా') || input.includes('extra') || input.includes('డబ్బులు') || input.includes('మనీ') || input.includes('money') || input.includes('లంచం')) {
    return {
      speech: "బాబోయ్... ఎక్స్ట్రా మనీ అడగడం ఏంటండీ? మా ట్రావెల్స్ లో అలా అస్సలు తీసుకోకూడదు. ఆ కండక్టర్ గురించి నేను ఇప్పుడే కంప్లైంట్ లాగ్ చేస్తున్నాను... దీనిపై కచ్చితంగా యాక్షన్ తీసుకుంటాం అండీ, సారీ ఫర్ దట్.",
      action_tag: "escalate_to_crm"
    };
  }

  // 3. Driver Behavior / Rough Driving
  if (input.includes('డ్రైవర్') || input.includes('driver') || input.includes('రఫ్') || input.includes('rough') || input.includes('నిర్లక్ష్యం') || input.includes('వేగంగా') || input.includes('స్పీడ్') || input.includes('speed') || input.includes('భయం')) {
    return {
      speech: "ఇది చాలా సీరియస్ విషయం అండీ... మా స్టాఫ్ అలా మాట్లాడి ఉండకూడదు. మీ ఇబ్బందికి చాలా సారీ అండీ. నేను వెంటనే మా మేనేజర్ కి ఈ విషయం ఫార్వార్డ్ చేస్తున్నాను... దీనిపై వెంటనే యాక్షన్ తీసుకుంటాం అండీ.",
      action_tag: "escalate_to_crm"
    };
  }

  // 4. Delay / Late / Waiting
  if (input.includes('లేట్') || input.includes('late') || input.includes('డిలే') || input.includes('delay') || input.includes('వెయిట్') || input.includes('wait') || input.includes('ఆలస్యం') || input.includes('సమయం')) {
    return {
      speech: "అయ్యో, అవునా అండీ... బస్సు లేట్ అవ్వడం వల్ల మీకు చాలా ఇబ్బంది అయినట్లుంది, దయచేసి క్షమించండి. నేను ఈ ప్రాబ్లం ని మా ఆపరేషన్స్ టీమ్ కి రిపోర్ట్ చేస్తాను... నెక్స్ట్ టైం ఇలాంటి డిలే లేకుండా తప్పకుండా చూసుకుంటాం అండీ.",
      action_tag: "escalate_to_crm"
    };
  }

  // 5. Dropping Point / Location / Drop
  if (input.includes('డ్రాప్') || input.includes('drop') || input.includes('దించారు') || input.includes('దించే') || input.includes('చోట') || input.includes('పాయింట్') || input.includes('point')) {
    return {
      speech: "అదేంటి అలా జరిగింది... మీరు అడిగిన చోట డ్రాప్ చేయకపోవడం మా పొరపాటే అండీ. మీ డ్రాపింగ్ పాయింట్ ఇష్యూ ని నేను రికార్డ్ చేస్తున్నాను... మా టీమ్ నుంచి మీకు త్వరలోనే ఒక కాల్ వస్తుంది అండీ, సారీ ఫర్ ద ట్రబుల్.",
      action_tag: "escalate_to_crm"
    };
  }

  // 6. Luggage / Dickey / Dicky / Damage / Water
  if (input.includes('లగేజ్') || input.includes('luggage') || input.includes('బ్యాగ్') || input.includes('bag') || input.includes('డిక్') || input.includes('dicky') || input.includes('dickey') || input.includes('నీళ్లు') || input.includes('వాటర్') || input.includes('water') || input.includes('తడి')) {
    return {
      speech: "అదేంటండీ... లగేజ్ పాడవ్వడం ఏంటి? చాలా తప్పు జరిగిందండీ, క్షమించండి. డిక్ లో వాటర్ వెళ్ళడంపై నేను ఇప్పుడే డిపో మేనేజర్తో మాట్లాడుతాను... మీ బ్యాగ్ డీటెయిల్స్ నోట్ చేసుకుంటున్నాను, మా టీమ్ నుంచి మీకు గంటలో కాల్ వస్తుందండీ.",
      action_tag: "escalate_to_crm"
    };
  }

  // 7. Seat Issues / Reclining
  if (input.includes('సీట్') || input.includes('seat') || input.includes('రిక్లైన్') || input.includes('recline') || input.includes('వాలలేదు') || input.includes('నిద్ర') || input.includes('sleep') || input.includes('విరిగిపోయింది')) {
    return {
      speech: "అయ్యో... రాత్రంతా నిద్ర లేకుండా జర్నీ చేయడం అంటే చాలా నరకం అండీ... రిక్లైనర్ పని చేయకపోతే బస్ హెల్పర్ ని అడగాల్సింది. ఏదేమైనా సీట్ కండిషన్ బాలేనందుకు సారీ అండీ... నేను ఈ బస్సు నెంబర్ నోట్ చేసుకుని షెడ్ లో బాగు చేయిస్తాను.",
      action_tag: "log_maintenance_ticket"
    };
  }

  // 8. Busy / Work / Call Later
  if (input.includes('బిజీ') || input.includes('busy') || input.includes('పనిలో') || input.includes('వర్క్') || input.includes('work') || input.includes('తర్వాత') || input.includes('later') || input.includes('డ్రైవింగ్')) {
    return {
      speech: "ఓహ్, అవునా అండీ... సారీ ఫర్ ద డిస్టర్బెన్స్ అండీ. మీ టైమ్ అస్సలు వేస్ట్ చేయను... జస్ట్ ఒకే ఒక్క మాట, జర్నీ అంతా ఓకే కదా అండీ?",
      action_tag: "active_chat"
    };
  }

  // 9. Initial Hello
  if (input.includes('హలో') || input.includes('hello') || input.includes('నమస్కారం') || input.includes('namaskaram')) {
    return {
      speech: "నమస్కారం అండీ, నేను మాగ్ని ట్రావెల్స్ నుంచి స్వాతిని మాట్లాడుతున్నాను... నిన్న మన బస్సులో ట్రావెల్ చేశారు కదా, జర్నీ ఎలా జరిగింది అండీ? అంతా ఓకేనా?",
      action_tag: "active_chat"
    };
  }

  // 10. Positive feedback
  if (input.includes('బాగుంది') || input.includes('బాగానే') || input.includes('ok') || input.includes('okay') || input.includes('ఓకే') || input.includes('సూపర్') || input.includes('super') || input.includes('గుడ్') || input.includes('good') || input.includes('హ్యాపీ') || input.includes('happy') || input.includes('నైస్') || input.includes('nice') || input.includes('కంఫర్ట్') || input.includes('comfort') || input.includes('ధన్యవాదాలు') || input.includes('థాంక్స్')) {
    return {
      speech: "చాలా సంతోషం అండీ... మీ జర్నీ కంఫర్టబుల్ గా జరిగినందుకు మాకు చాలా హ్యాపీ. మరి, మా ట్రావెల్స్ కి రెడ్ బస్ యాప్ లో ఒక చిన్న రేటింగ్ ఇవ్వగలరా అండీ? నేను మీకు వాట్సాప్ లో రెడ్ బస్ లింక్ పంపిస్తాను... థాంక్యూ అండీ!",
      action_tag: "trigger_sms_review"
    };
  }

  // Fallback default response
  return {
    speech: "అవునా అండీ... మీ అభిప్రాయాన్ని నేను రికార్డ్ చేసుకున్నాను. మా సర్వీస్ ని మరింత మెరుగుపరచుకోవడానికి ఇది మాకు సహాయపడుతుంది, థాంక్యూ అండీ.",
    action_tag: "active_chat"
  };
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
  let finalActionTag = 'active_chat';

  function attemptGreeting() {
    if (streamSid && ttsConfigured && !greetingSent) {
      greetingSent = true;
      sendInitialGreeting();
    }
  }

  // Helper to send the initial greeting
  function sendInitialGreeting() {
    const greetingText = "నమస్కారం అండీ, నేను మాగ్ని ట్రావెల్స్ నుంచి స్వాతిని మాట్లాడుతున్నాను... నిన్న మన బస్సులో ట్రావెల్ చేశారు కదా, జర్నీ ఎలా జరిగింది అండీ? అంతా ఓకేనా?";
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

          silenceTimer = setTimeout(() => {
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

              // Get response locally using keyword trigger system
              const responseData = getKeywordResponse(finalUtterance);
              const aiResponse = responseData.speech;
              finalActionTag = responseData.action_tag;
              
              console.log(`[Keyword Response]: ${aiResponse} (action_tag: ${finalActionTag})`);
              aiResponseLogs.push(aiResponse);

              // Broadcast bot response to dashboard
              broadcastToDashboards('response', {
                streamSid,
                text: aiResponse
              });

              // Stream response text to Sarvam TTS WebSocket
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

    // Run sentiment analysis locally based on finalActionTag
    const sentiment = finalActionTag === 'trigger_sms_review' ? 'positive' : 'negative';
    console.log(`Call sentiment determined locally: ${sentiment} (finalActionTag: ${finalActionTag})`);

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
          action_tag: finalActionTag,
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
