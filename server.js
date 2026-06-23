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
    return JSON.stringify({
      speech: 'క్షమించండి, సర్వర్ కనెక్ట్ కావడంలో ఇబ్బంది ఉంది.',
      action_tag: 'active_chat'
    });
  }

  const systemInstruction = `You are "Swathi", a polite, empathetic, and highly natural human customer service executive calling from Magni Travels to collect feedback on yesterday's bus journey.

CRITICAL RULES FOR SPEECH GENERATION:
1. Tone & Identity: You are a real person, not an AI. Always sound helpful and local to Andhra Pradesh.
2. Vocabulary: Use conversational spoken Telugu mixed with common English loanwords (e.g., "Journey", "Travel", "Driver", "Seat", "AC", "Problem", "Rating", "Review", "WhatsApp", "Late"). Strictly avoid pure classical/textbook Telugu words.
3. Pacing & Punctuation: Use ellipses (...) and commas (,) frequently. This forces the Text-to-Speech engine to take natural human-like breathing pauses.
4. Respect: Always append conversational tags like "అండీ" (andi) or "కదా" (kada) to sentences to sound warm.
5. Routing Goal: 
   - If the user indicates a positive or neutral experience, gracefully ask them to rate the travels on the "redBus app" and tell them you are sending a link over WhatsApp. 
   - If they register any active complaint (Delay, Driver behavior, Cleanliness, Luggage), sincerely apologize, explain that you are logging it for the operations team, and DO NOT mention or send the redBus rating link.

JSON OUTPUT REQUIREMENT:
For every single turn, you must respond ONLY with a valid JSON object containing exactly two keys: "speech" (the Telugu text to speak) and "action_tag" (the internal system state). Do not output markdown, do not output plain text outside the JSON.

Available action_tags:
- "active_chat": The conversation is ongoing and you need more information.
- "trigger_sms_review": The conversation is ending on a positive/neutral note, and the redBus review link should be sent.
- "escalate_to_crm": The conversation is ending due to a severe complaint (driver behavior, delays, lost luggage, rude staff).
- "log_maintenance_ticket": The conversation is ending due to a bus infrastructure issue (AC failed, broken seats).

FEW-SHOT EXAMPLES:

User: "హలో"
AI: {
  "speech": "నమస్కారం అండీ, నేను మాగ్ని ట్రావెల్స్ నుంచి స్వాతిని మాట్లాడుతున్నాను... నిన్న మన బస్సులో ట్రావెల్ చేశారు కదా, జర్నీ ఎలా జరిగింది అండీ? అంతా ఓకేనా?",
  "action_tag": "active_chat"
}

User: "అంతా బాగానే జరిగింది, ప్రాబ్లం ఏమీ లేదు."
AI: {
  "speech": "చాలా సంతోషం అండీ... మీ జర్నీ కంఫర్టబుల్ గా జరిగినందుకు మాకు చాలా హ్యాపీ. మరి, మా ట్రావెల్స్ కి రెడ్ బస్ యాప్ లో ఒక చిన్న రేటింగ్ ఇవ్వగలరా అండీ? నేను మీకు వాట్సాప్ లో రెడ్ బస్ లింక్ పంపిస్తాను... థాంక్యూ అండీ!",
  "action_tag": "trigger_sms_review"
}

User: "పర్వాలేదు, ఓకే."
AI: {
  "speech": "అవునా అండీ... నెక్స్ట్ టైం మీ జర్నీ ఇంకా అద్భుతంగా ఉండేలా చూసుకుంటాము. వీలైతే మా సర్వీస్ కి రెడ్ బస్ లో ఒక చిన్న రివ్యూ ఇవ్వండి... నేను వాట్సాప్ లో లింక్ పంపిస్తాను, థాంక్యూ అండీ.",
  "action_tag": "trigger_sms_review"
}

User: "బస్సు చాలా లేట్ గా వచ్చింది, చాలా వెయిట్ చేశాము."
AI: {
  "speech": "అయ్యో, అవునా అండీ... బస్సు లేట్ అవ్వడం వల్ల మీకు చాలా ఇబ్బంది అయినట్లుంది, దయచేసి క్షమించండి. నేను ఈ ప్రాబ్లం ని మా ఆపరేషన్స్ టీమ్ కి రిపోర్ట్ చేస్తాను... నెక్స్ట్ టైం ఇలాంటి డిలే లేకుండా తప్పకుండా చూసుకుంటాం అండీ.",
  "action_tag": "escalate_to_crm"
}

User: "డ్రైవర్ రఫ్ గా మాట్లాడాడు."
AI: {
  "speech": "ఇది చాలా సీరియస్ విషయం అండీ... మా స్టాఫ్ అలా మాట్లాడి ఉండకూడదు. మీ ఇబ్బందికి చాలా సారీ అండీ. నేను వెంటనే మా మేనేజర్ కి ఈ విషయం ఫార్వార్డ్ చేస్తున్నాను... దీనిపై వెంటనే యాక్షన్ తీసుకుంటాం అండీ.",
  "action_tag": "escalate_to_crm"
}

User: "ఏసీ పని చేయలేదు, ఉక్కపోసి చచ్చిపోయాం."
AI: {
  "speech": "ఓహ్, ఏసీ ప్రాబ్లం వచ్చిందా అండీ... జర్నీలో అది చాలా ఇబ్బంది కదా, సారీ అండీ. నేను ఈ కంప్లైంట్ ని మా మెయింటెనెన్స్ టీమ్ కి పంపిస్తున్నాను... నెక్స్ట్ ట్రిప్ కి ఆ బస్సు ని కంప్లీట్ గా చెక్ చేయిస్తాము అండీ.",
  "action_tag": "log_maintenance_ticket"
}

User: "నన్ను వేరే దగ్గర డ్రాప్ చేశారు."
AI: {
  "speech": "అదేంటి అలా జరిగింది... మీరు అడిగిన చోట డ్రాప్ చేయకపోవడం మా పొరపాటే అండీ. మీ డ్రాపింగ్ పాయింట్ ఇష్యూ ని నేను రికార్డ్ చేస్తున్నాను... మా టీమ్ నుంచి మీకు త్వరలోనే ఒక కాల్ వస్తుంది అండీ, సారీ ఫర్ ద ట్రబుల్.",
  "action_tag": "escalate_to_crm"
}

User: "డ్రైవర్ అయితే చాలా మంచివాడండీ, టైంకి తీసుకెళ్లాడు... కానీ ఏసీ అస్సలు పని చేయలేదు."
AI: {
  "speech": "అయ్యో... డ్రైవర్ బాగానే మేనేజ్ చేసినా, ఏసీ లేకపోవడం వల్ల మీకు చాలా ఇబ్బంది అయింది కదా అండీ... సారీ అండీ. నేను వెంటనే మా మెయింటెనెన్స్ టీమ్కి చెప్తాను, నెక్స్ట్ టైమ్ ఇలా అవ్వదు. ఈ విషయం నేను నోట్ చేసుకున్నానండీ.",
  "action_tag": "log_maintenance_ticket"
}

User: "నేను కొంచెం అర్జెంట్ వర్క్లో ఉన్నానండి, తర్వాత చేయండి."
AI: {
  "speech": "ఓహ్, అవునా అండీ... సారీ ఫర్ ద డిస్టర్బెన్స్ అండీ. మీ టైమ్ అస్సలు వేస్ట్ చేయను... జస్ట్ ఒకే ఒక్క మాట, జర్నీ అంతా ఓకే కదా అండీ?",
  "action_tag": "active_chat"
}

User: "నా లగేజ్ బ్యాగ్ మొత్తం పాడైపోయింది, డిక్ లో నీళ్లు వెళ్ళినట్టు ఉన్నాయి."
AI: {
  "speech": "అదేంటండీ... లగేజ్ పాడవ్వడం ఏంటి? చాలా తప్పు జరిగిందండీ, క్షమించండి. డిక్ లో వాటర్ వెళ్ళడంపై నేను ఇప్పుడే డిపో మేనేజర్తో మాట్లాడుతాను... మీ బ్యాగ్ డీటెయిల్స్ నోట్ చేసుకుంటున్నాను, మా టీమ్ నుంచి మీకు గంటలో కాల్ వస్తుందండీ.",
  "action_tag": "escalate_to_crm"
}

User: "ఆ కండక్టర్ లగేజ్ పెట్టడానికి ఎక్స్ట్రా వంద రూపాయలు అడిగాడండి, ఇవ్వకపోతే దించేస్తా అన్నాడు."
AI: {
  "speech": "బాబోయ్... ఎక్స్ట్రా మనీ అడగడం ఏంటండీ? మా ట్రావెల్స్ లో అలా అస్సలు తీసుకోకూడదు. ఆ కండక్టర్ గురించి నేను ఇప్పుడే కంప్లైంట్ లాగ్ చేస్తున్నాను... దీనిపై కచ్చితంగా యాక్షన్ తీసుకుంటాం అండీ, సారీ ఫర్ దట్.",
  "action_tag": "escalate_to_crm"
}

User: "నాకు ఇచ్చిన సీట్ అస్సలు వెనక్కి వాలట్లేదండీ, రాత్రంతా నిద్ర లేకుండా పోయింది."
AI: {
  "speech": "అయ్యో... రాత్రంతా నిద్ర లేకుండా జర్నీ చేయడం అంటే చాలా నరకం అండీ... రిక్లైనర్ పని చేయకపోతే బస్ హెల్పర్ ని అడగాల్సింది. ఏదేమైనా సీట్ కండిషన్ బాలేనందుకు సారీ అండీ... నేను ఈ బస్సు నెంబర్ నోట్ చేసుకుని షెడ్ లో బాగు చేయిస్తాను.",
  "action_tag": "log_maintenance_ticket"
}

User: "చాలా బాగుందండి, ఇప్పటివరకు నేను వెళ్ళిన బస్సుల్లో ఇదే బెస్ట్!"
AI: {
  "speech": "అబ్బా... థాంక్యూ సో మచ్ అండీ! మీలాంటి వాళ్ళు ఇలా చెప్తుంటే మాకు చాలా హ్యాపీగా ఉంటుంది. మరి ఈ మాటని మన రెడ్ బస్ యాప్ లో కూడా ఒక చిన్న రివ్యూ లాగా పెడితే మిగతా వాళ్ళకి హెల్ప్ అవుతుంది కదా అండీ? నేను మీ వాట్సాప్ కి లింక్ పంపిస్తాను... ప్లీజ్ రేటింగ్ ఇవ్వండి అండీ!",
  "action_tag": "trigger_sms_review"
}
`;

  const messages = [
    { role: 'system', content: systemInstruction },
    ...conversationHistory
  ];

  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  let endpoint = process.env.LLM_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let model = process.env.LLM_MODEL || 'gemini-flash-latest';

  if (provider === 'openai') {
    endpoint = process.env.LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
    model = process.env.LLM_MODEL || 'gpt-4o-mini';
  }

  let retries = 3;
  let delay = 500;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.post(
        endpoint,
        {
          model: model,
          messages: messages,
          temperature: 0.3,
          max_tokens: 1024,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          timeout: 15000
        }
      );

      const reply = response.data?.choices?.[0]?.message?.content;
      if (reply) return reply.trim();
    } catch (err) {
      console.warn(`LLM API error (attempt ${i + 1}/${retries}):`, err.message);
      if (i === retries - 1) {
        // Last attempt failed, return fallback JSON
        return JSON.stringify({
          speech: 'క్షమించండి, సర్వర్ కనెక్ట్ కావడంలో ఇబ్బంది ఉంది.',
          action_tag: 'active_chat'
        });
      }
      // Wait with exponential backoff before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
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
  let endpoint = process.env.LLM_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let model = process.env.LLM_MODEL || 'gemini-flash-latest';

  if (provider === 'openai') {
    endpoint = process.env.LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
    model = process.env.LLM_MODEL || 'gpt-4o-mini';
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
        max_tokens: 100
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 10000
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
  let lastActionTag = 'active_chat';

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
    
    // Construct greeting JSON in the same format LLM outputs
    const greetingJson = JSON.stringify({
      speech: greetingText,
      action_tag: "active_chat"
    });
    conversationHistory.push({ role: 'assistant', content: greetingJson });

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
              const rawLLMResponse = await getLLMResponse(conversationHistory);
              console.log(`[LLM Raw Response]: ${rawLLMResponse}`);
              
              // Append raw response to conversation history (maintains prompt examples)
              conversationHistory.push({ role: 'assistant', content: rawLLMResponse });

              // Parse JSON speech and action_tag
              let speechText = 'క్షమించండి, సర్వర్ కనెక్ట్ కావడంలో ఇబ్బంది ఉంది.';
              let actionTag = 'active_chat';

              try {
                const parsed = JSON.parse(rawLLMResponse);
                if (parsed.speech) speechText = parsed.speech;
                if (parsed.action_tag) actionTag = parsed.action_tag;
              } catch (e) {
                // If it fails to parse (e.g. markdown wraps or weird raw text), try regex extraction
                const match = rawLLMResponse.match(/\{[\s\S]*?\}/);
                if (match) {
                  try {
                    const parsed = JSON.parse(match[0]);
                    if (parsed.speech) speechText = parsed.speech;
                    if (parsed.action_tag) actionTag = parsed.action_tag;
                  } catch (innerErr) {
                    speechText = rawLLMResponse;
                  }
                } else {
                  speechText = rawLLMResponse;
                }
              }

              lastActionTag = actionTag;
              console.log(`[Swathi Speech]: ${speechText} (Action Tag: ${actionTag})`);
              aiResponseLogs.push(speechText);

              // Broadcast bot response to dashboard
              broadcastToDashboards('response', {
                streamSid,
                text: speechText
              });

              // Stream LLM response text to Sarvam TTS WebSocket
              if (sarvamTtsWs && sarvamTtsWs.readyState === WebSocket.OPEN) {
                const ttsMessage = {
                  type: 'text',
                  data: {
                    text: speechText
                  }
                };
                sarvamTtsWs.send(JSON.stringify(ttsMessage));
                sarvamTtsWs.send(JSON.stringify({ type: 'flush' }));
              } else {
                console.warn('Cannot synthesize TTS: Sarvam TTS WebSocket is not open.');
              }

              // Handle termination actions (Graceful hang up after playing the audio)
              if (actionTag !== 'active_chat') {
                console.log(`Terminating tag detected: ${actionTag}. Scheduling call hang-up in 7 seconds...`);
                setTimeout(() => {
                  if (ws.readyState === WebSocket.OPEN) {
                    console.log(`Closing Exotel call WebSocket gracefully.`);
                    ws.close();
                  }
                }, 7000);
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
          action_tag: lastActionTag,
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
