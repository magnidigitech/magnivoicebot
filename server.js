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

// Exotel Outbound Call Helper
async function triggerExotelOutboundCall(phoneNumber) {
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const callerId = process.env.EXOTEL_VIRTUAL_NUMBER;
  const flowUrl = process.env.EXOTEL_FLOW_URL;
  const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

  if (!apiKey || !apiToken || !accountSid || !callerId || !flowUrl) {
    throw new Error('Exotel API credentials are not fully configured in environment variables.');
  }

  const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
  const endpoint = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/connect.json`;
  
  const params = new URLSearchParams();
  params.append('From', phoneNumber);
  params.append('CallerId', callerId);
  params.append('Url', flowUrl);
  params.append('CallType', 'trans');

  console.log(`Triggering Exotel outbound call to: ${phoneNumber} via ${endpoint}`);

  const response = await axios.post(endpoint, params.toString(), {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 10000
  });

  return response.data;
}

// Queue State
let callQueue = [];
let queueActive = false;
let currentQueueIndex = -1;

function phoneNumbersMatch(phone1, phone2) {
  if (!phone1 || !phone2) return false;
  const p1 = phone1.replace(/[+\s-]/g, '').slice(-10);
  const p2 = phone2.replace(/[+\s-]/g, '').slice(-10);
  return p1 === p2 && p1.length === 10;
}

function broadcastQueueState() {
  broadcastToDashboards('queue_state', {
    queue: callQueue,
    queueActive
  });
}

async function dialNextInQueue() {
  if (!queueActive) return;

  // Find the first pending item
  const nextItemIndex = callQueue.findIndex(item => item.status === 'pending');
  if (nextItemIndex === -1) {
    console.log('Queue dialer: No pending calls left in queue.');
    queueActive = false;
    broadcastQueueState();
    return;
  }

  currentQueueIndex = nextItemIndex;
  const item = callQueue[nextItemIndex];
  item.status = 'dialing';
  item.timestamp = new Date().toISOString();
  broadcastQueueState();

  try {
    console.log(`Queue dialer: Dialing next customer: ${item.phone}`);
    const data = await triggerExotelOutboundCall(item.phone);
    console.log(`Queue dialer: Successfully triggered call for ${item.phone}`);
    
    if (data && data.Call && data.Call.Sid) {
      item.callSid = data.Call.Sid;
    }
    broadcastQueueState();
  } catch (err) {
    console.error(`Queue dialer: Failed to dial ${item.phone}:`, err.message);
    item.status = 'failed';
    broadcastQueueState();

    // Auto dial next in queue after 5 seconds if queue remains active
    setTimeout(() => {
      dialNextInQueue();
    }, 5000);
  }
}

// Outbound Call Trigger Route
app.post('/api/trigger-call', async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  try {
    const data = await triggerExotelOutboundCall(phoneNumber);
    return res.status(200).json({ 
      success: true, 
      message: 'Call initiated successfully.', 
      data: data 
    });
  } catch (err) {
    console.error('Failed to trigger Exotel outbound call:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Upload phone numbers to the queue
app.post('/api/upload-queue', (req, res) => {
  const { numbers } = req.body;
  if (!Array.isArray(numbers)) {
    return res.status(400).json({ error: 'Payload must contain a "numbers" array.' });
  }

  const newItems = numbers.map(num => ({
    phone: num.trim(),
    status: 'pending',
    callSid: null,
    timestamp: null
  })).filter(item => item.phone.length > 0);

  callQueue = [...callQueue, ...newItems];
  console.log(`Uploaded ${newItems.length} numbers to the call queue. Total size: ${callQueue.length}`);
  broadcastQueueState();

  return res.status(200).json({ 
    success: true, 
    message: `Added ${newItems.length} numbers to the queue.`, 
    queue: callQueue 
  });
});

// Get current queue state
app.get('/api/queue', (req, res) => {
  return res.status(200).json({
    queue: callQueue,
    queueActive
  });
});

// Start the queue dialing
app.post('/api/queue/start', (req, res) => {
  if (callQueue.length === 0) {
    return res.status(400).json({ error: 'Queue is empty. Please upload numbers first.' });
  }
  queueActive = true;
  broadcastQueueState();
  
  // Start dialing
  dialNextInQueue();
  
  return res.status(200).json({ success: true, message: 'Queue dialing started.' });
});

// Pause the queue dialing
app.post('/api/queue/pause', (req, res) => {
  queueActive = false;
  broadcastQueueState();
  return res.status(200).json({ success: true, message: 'Queue dialing paused.' });
});

// Clear the queue
app.post('/api/queue/clear', (req, res) => {
  callQueue = [];
  queueActive = false;
  currentQueueIndex = -1;
  broadcastQueueState();
  return res.status(200).json({ success: true, message: 'Queue cleared.' });
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
      history: callHistory,
      queue: callQueue,
      queueActive
    }
  }));

  ws.on('close', () => {
    console.log('Dashboard client disconnected.');
    dashboardClients.delete(ws);
  });
});

// Issue categories configuration for dynamic multi-issue apologies
const ISSUE_CATEGORIES = [
  {
    id: 'ac',
    keywords: ['ac', 'ఏసీ', 'ఉక్క', 'కూలింగ్', 'cooling', 'వేడి', 'heat'],
    phrase: "ఏసీ పని చేయకపోవడం",
    action_tag: "log_maintenance_ticket",
    originalResponse: {
      speech: "అవునా అండీ, ఏసీ పని చేయలేదా... చాలా సారీ అండీ. నేను ఈ విషయాన్ని మా మెయింటెనెన్స్ టీమ్ కి చెప్తాను, నెక్స్ట్ టైం ఇలా కాకుండా చూసుకుంటాం అండీ.",
      action_tag: "log_maintenance_ticket"
    }
  },
  {
    id: 'conductor',
    keywords: ['కండక్టర్', 'conductor', 'ఎక్స్ట్రా', 'extra', 'డబ్బులు', 'మనీ', 'money', 'లంచం'],
    phrase: "కండక్టర్ ప్రవర్తన",
    action_tag: "escalate_to_crm",
    originalResponse: {
      speech: "అయ్యో, కండక్టర్ ఎక్స్ట్రా డబ్బులు అడిగారా అండీ... చాలా సారీ అండీ, మా దగ్గర అలా అడగకూడదు. నేను ఇప్పుడే దీనిపై కంప్లైంట్ నోట్ చేసుకుంటున్నాను, కచ్చితంగా యాక్షన్ తీసుకుంటాం అండీ.",
      action_tag: "escalate_to_crm"
    }
  },
  {
    id: 'driver',
    keywords: ['డ్రైవర్', 'driver', 'రఫ్', 'rough', 'నిర్లక్ష్యం', 'వేగంగా', 'స్పీడ్', 'speed', 'భయం'],
    phrase: "డ్రైవర్ రఫ్ డ్రైవింగ్",
    action_tag: "escalate_to_crm",
    originalResponse: {
      speech: "అవునా అండీ, డ్రైవర్ రఫ్ గా డ్రైవ్ చేశారా... చాలా సారీ అండీ. నేను వెంటనే దీనిపై మా మేనేజర్ కి ఇన్ఫర్మ్ చేస్తాను, కచ్చితంగా యాక్షన్ తీసుకుంటాం అండీ.",
      action_tag: "escalate_to_crm"
    }
  },
  {
    id: 'delay',
    keywords: ['లేట్', 'late', 'డిలే', 'delay', 'వెయిట్', 'wait', 'ఆలస్యం', 'సమయం'],
    phrase: "బస్సు లేట్ రావడం",
    action_tag: "escalate_to_crm",
    originalResponse: {
      speech: "అయ్యో, బస్సు లేట్ అయిందా అండీ... చాలా సారీ అండీ, మీకు ఆలస్యం అయినందుకు. నేను ఈ విషయాన్ని మా ఆపరేషన్స్ టీమ్ కి రిపోర్ట్ చేస్తాను, నెక్స్ట్ టైం టైం కి ఉండేలా చూసుకుంటాం అండీ.",
      action_tag: "escalate_to_crm"
    }
  },
  {
    id: 'drop',
    keywords: ['డ్రాప్', 'drop', 'దించారు', 'దించే', 'చోట', 'పాయింట్', 'point'],
    phrase: "కరెక్ట్ డ్రాపింగ్ పాయింట్ లో దించకపోవడం",
    action_tag: "escalate_to_crm",
    originalResponse: {
      speech: "అవునా అండీ, కరెక్ట్ పాయింట్ లో దించలేదా... చాలా సారీ అండీ. నేను ఈ డ్రాపింగ్ పాయింట్ ఇష్యూ ని నోట్ చేసుకుంటున్నాను, దీనిపై మా టీమ్ చెక్ చేస్తుంది అండీ.",
      action_tag: "escalate_to_crm"
    }
  },
  {
    id: 'luggage',
    keywords: ['లగేజ్', 'luggage', 'బ్యాగ్', 'bag', 'డిక్', 'dicky', 'dickey', 'నీళ్లు', 'వాటర్', 'water', 'తడి'],
    phrase: "లగేజ్ సమస్య",
    action_tag: "escalate_to_crm",
    originalResponse: {
      speech: "అయ్యో, లగేజ్ సమస్య వచ్చిందా అండీ... చాలా సారీ అండీ. నేను వెంటనే డిపో మేనేజర్ తో మాట్లాడి చెక్ చేయిస్తాను, మా టీమ్ నుంచి మీకు కాల్ వస్తుంది అండీ.",
      action_tag: "escalate_to_crm"
    }
  },
  {
    id: 'seat',
    keywords: ['సీట్', 'seat', 'రిక్లైన్', 'recline', 'వాలలేదు', 'నిద్ర', 'sleep', 'విరిగిపోయింది'],
    phrase: "సీట్ సరిగ్గా లేకపోవడం",
    action_tag: "log_maintenance_ticket",
    originalResponse: {
      speech: "అయ్యో, సీట్ కండిషన్ బాలేదా అండీ... చాలా సారీ అండీ. నేను ఈ బస్సు నెంబర్ నోట్ చేసుకుంటున్నాను, వెంటనే షెడ్ లో చెక్ చేయిస్తాం అండీ.",
      action_tag: "log_maintenance_ticket"
    }
  }
];

// All key domain keywords for verification checks
const KEYWORDS_LIST = [
  'ac', 'ఏసీ', 'ఉక్క', 'కూలింగ్', 'cooling', 'వేడి', 'heat',
  'కండక్టర్', 'conductor', 'ఎక్స్ట్రా', 'extra', 'డబ్బులు', 'మనీ', 'money', 'లంచం',
  'డ్రైవర్', 'driver', 'రఫ్', 'rough', 'నిర్లక్ష్యం', 'వేగంగా', 'స్పీడ్', 'speed', 'భయం',
  'లేట్', 'late', 'డిలే', 'delay', 'వెయిట్', 'wait', 'ఆలస్యం', 'సమయం',
  'డ్రాప్', 'drop', 'దించారు', 'దించే', 'చోట', 'పాయింట్', 'point',
  'లగేజ్', 'luggage', 'బ్యాగ్', 'bag', 'డిక్', 'dicky', 'dickey', 'నీళ్లు', 'వాటర్', 'water', 'తడి',
  'సీట్', 'seat', 'రిక్లైన్', 'recline', 'వాలలేదు', 'నిద్ర', 'sleep', 'విరిగిపోయింది',
  'బిజీ', 'busy', 'పనిలో', 'వర్క్', 'work', 'తర్వాత', 'later', 'డ్రైవింగ్',
  'హలో', 'hello', 'నమస్కారం', 'namaskaram',
  'బాగుంది', 'బాగానే', 'ok', 'okay', 'ఓకే', 'సూపర్', 'super', 'గుడ్', 'good', 'హ్యాపీ', 'happy', 'నైస్', 'nice', 'కంఫర్ట్', 'comfort', 'ధన్యవాదాలు', 'థాంక్స్',
  'బాగాలేదు', 'నచ్చలేదు', 'వేస్ట్', 'వరస్ట్', 'ప్రాబ్లం', 'problem', 'ఇబ్బంది', 'సరిగ్గా', 'చెత్త', 'ఖరాబ్', 'దారుణం', 'కష్టం'
];

// Filter out background noise, single syllables, and repetitive filler phrases
function isNoiseUtterance(text) {
  const clean = text.toLowerCase().trim().replace(/[.,?/#!$%^&*;:{}=\-_`~()]/g, "");
  if (!clean) return true;

  const words = clean.split(/\s+/);
  const noiseWords = [
    'um', 'umm', 'ummm', 'ummmm', 'ummmmm',
    'hm', 'hmm', 'hmmm', 'hmmmm', 'hmmmmm',
    'uh', 'uhh', 'oh', 'ohh',
    'ఉమ్', 'ఉమ్మ్', 'ఉమ్మ్మ్', 'ఉహ్', 'ఉహ్హ్',
    'ఒకే', 'ఓకే', 'ok', 'okay', 'okk',
    'హు', 'హుమ్', 'మ్మ్', 'మ్', 'మ్మ్మ్'
  ];

  return words.every(w => noiseWords.includes(w));
}

// Determines if an utterance is background noise / chatter
function isLikelyBackgroundNoise(text) {
  if (isNoiseUtterance(text)) return true;

  const clean = text.toLowerCase().trim().replace(/[.,?/#!$%^&*;:{}=\-_`~()]/g, "");
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return true;

  // Check if it matches any domain keyword
  const hasKeyword = KEYWORDS_LIST.some(kw => clean.includes(kw));
  if (hasKeyword) return false;

  // If no keywords matched and the utterance is very short, ignore it
  if (words.length <= 2 || clean.length < 10) {
    return true;
  }

  return false;
}

// Local keyword-triggered response engine (Supports composite multi-complaint apologies)
function getKeywordResponse(userInput) {
  const input = userInput.toLowerCase();

  // 1. Identify which negative categories are matched
  const matchedCategories = [];
  for (const cat of ISSUE_CATEGORIES) {
    const matched = cat.keywords.some(kw => input.includes(kw));
    if (matched) {
      matchedCategories.push(cat);
    }
  }

  // 2. If one or more negative categories match
  if (matchedCategories.length > 0) {
    // Determine overall action tag (Priority: escalate_to_crm > log_maintenance_ticket)
    const hasCrm = matchedCategories.some(cat => cat.action_tag === 'escalate_to_crm');
    const finalTag = hasCrm ? 'escalate_to_crm' : 'log_maintenance_ticket';

    if (matchedCategories.length === 1) {
      return {
        speech: matchedCategories[0].originalResponse.speech,
        action_tag: finalTag
      };
    } else {
      // Build dynamic composite apology
      const phrases = matchedCategories.map(cat => cat.phrase);
      let joinedIssues = '';
      if (phrases.length === 2) {
        joinedIssues = `${phrases[0]} మరియు ${phrases[1]}`;
      } else {
        const lastPhrase = phrases.pop();
        joinedIssues = `${phrases.join(', ')} మరియు ${lastPhrase}`;
      }

      const speech = `అయ్యో, అవునా అండీ... జర్నీలో ${joinedIssues} వల్ల మీకు ఇబ్బంది కలిగినందుకు చాలా సారీ అండీ. నేను ఇప్పుడే ఈ కంప్లైంట్స్ అన్నీ నోట్ చేసుకుంటున్నాను, కచ్చితంగా మా టీమ్ తో మాట్లాడి సాల్వ్ చేయిస్తాం అండీ.`;
      
      return {
        speech,
        action_tag: finalTag
      };
    }
  }

  // 3. Busy / Work / Call Later
  if (input.includes('బిజీ') || input.includes('busy') || input.includes('పనిలో') || input.includes('వర్క్') || input.includes('work') || input.includes('తర్వాత') || input.includes('later') || input.includes('డ్రైవింగ్')) {
    return {
      speech: "సరేనండీ, సారీ ఫర్ ద డిస్టర్బెన్స్. జస్ట్ ఒకే ఒక్క మాట, నిన్న జర్నీ అంతా ఓకే కదా అండీ?",
      action_tag: "active_chat"
    };
  }

  // 4. Initial Hello
  if (input.includes('హలో') || input.includes('hello') || input.includes('నమస్కారం') || input.includes('namaskaram')) {
    return {
      speech: "నమస్కారం అండీ, నేను మాగ్ని ట్రావెల్స్ నుంచి స్వాతిని మాట్లాడుతున్నాను. నిన్న మన బస్సులో మీ జర్నీ ఎలా జరిగింది అండీ? అంతా బాగుందా?",
      action_tag: "active_chat"
    };
  }

  // 5. Positive feedback
  if (input.includes('బాగుంది') || input.includes('బాగానే') || input.includes('ok') || input.includes('okay') || input.includes('ఓకే') || input.includes('సూపర్') || input.includes('super') || input.includes('గుడ్') || input.includes('good') || input.includes('హ్యాపీ') || input.includes('happy') || input.includes('నైస్') || input.includes('nice') || input.includes('కంఫర్ట్') || input.includes('comfort') || input.includes('ధన్యవాదాలు') || input.includes('థాంక్స్')) {
    return {
      speech: "చాలా థాంక్స్ అండీ. మీ జర్నీ బాగా జరిగినందుకు సంతోషం. కుదిరితే రెడ్ బస్ యాప్ లో మాకు రేటింగ్ ఇవ్వగలరా అండీ? వాట్సాప్ లో లింక్ పంపిస్తాను, థాంక్యూ అండీ.",
      action_tag: "trigger_sms_review"
    };
  }

  // Fallback default response
  return {
    speech: "అవునా అండీ, సరేనండీ. మీ అభిప్రాయాన్ని నోట్ చేసుకున్నాను, థాంక్యూ అండీ.",
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

  // Audio buffering and chunking state for Exotel compatibility
  let mediaBuffer = Buffer.alloc(0);
  let ttsFlushTimeout = null;

  function attemptGreeting() {
    if (streamSid && ttsConfigured && !greetingSent) {
      greetingSent = true;
      sendInitialGreeting();
    }
  }

  // Helper to send the initial greeting
  function sendInitialGreeting() {
    const greetingText = "నమస్కారం అండీ, నేను మాగ్ని ట్రావెల్స్ నుంచి స్వాతిని మాట్లాడుతున్నాను. నిన్న మన బస్సులో మీ జర్నీ ఎలా జరిగింది అండీ? అంతా బాగుందా?";
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

    const sttUrl = 'wss://api.sarvam.ai/speech-to-text/ws?model=saaras:v3&language-code=te-IN&mode=transcribe&sample_rate=8000&high_vad_sensitivity=true';
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
              // Ignore background noise, throat clearing, or filler-only phrases
              if (isLikelyBackgroundNoise(finalUtterance)) {
                console.log(`[STT Ignored Background/Noise/Filler]: "${finalUtterance}"`);
                return;
              }

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
              
              // Prevent negative tickets from being downgraded back to positive review tags
              const newActionTag = responseData.action_tag;
              const isCurrentTagNegative = finalActionTag === 'escalate_to_crm' || finalActionTag === 'log_maintenance_ticket';
              
              if (!isCurrentTagNegative) {
                finalActionTag = newActionTag;
              } else if (newActionTag === 'escalate_to_crm' || newActionTag === 'log_maintenance_ticket') {
                finalActionTag = newActionTag; // Allow switching between negative tags
              }
              
              console.log(`[Keyword Response]: ${aiResponse} (action_tag: ${finalActionTag})`);
              aiResponseLogs.push(aiResponse);

              // Broadcast bot response to dashboard
              broadcastToDashboards('response', {
                streamSid,
                text: aiResponse
              });

              // Stream response text to Sarvam TTS WebSocket
              if (sarvamTtsWs && sarvamTtsWs.readyState === WebSocket.OPEN) {
                // Clear any unsent buffered audio before starting a new turn
                mediaBuffer = Buffer.alloc(0);
                if (ttsFlushTimeout) {
                  clearTimeout(ttsFlushTimeout);
                  ttsFlushTimeout = null;
                }

                // Send clear event to Exotel to stop any currently playing audio immediately
                if (ws.readyState === WebSocket.OPEN && streamSid) {
                  const clearFrame = {
                    event: 'clear',
                    stream_sid: streamSid
                  };
                  ws.send(JSON.stringify(clearFrame));
                }

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
          const chunk = Buffer.from(audioPayload, 'base64');
          mediaBuffer = Buffer.concat([mediaBuffer, chunk]);

          // Clear any active flush timeout
          if (ttsFlushTimeout) {
            clearTimeout(ttsFlushTimeout);
            ttsFlushTimeout = null;
          }

          // Send audio in multiples of 320 bytes (20ms frames)
          const CHUNK_SIZE = 320;
          while (mediaBuffer.length >= CHUNK_SIZE) {
            const sendChunk = mediaBuffer.slice(0, CHUNK_SIZE);
            mediaBuffer = mediaBuffer.slice(CHUNK_SIZE);

            if (ws.readyState === WebSocket.OPEN && streamSid) {
              const responseFrame = {
                event: 'media',
                stream_sid: streamSid,
                media: {
                  payload: sendChunk.toString('base64')
                }
              };
              ws.send(JSON.stringify(responseFrame));
            }
          }

          // Schedule a timeout to flush residual bytes (padded) if no new chunks arrive for 100ms
          ttsFlushTimeout = setTimeout(() => {
            if (mediaBuffer.length > 0) {
              const paddingSize = CHUNK_SIZE - mediaBuffer.length;
              const paddedChunk = Buffer.concat([mediaBuffer, Buffer.alloc(paddingSize)]);
              mediaBuffer = Buffer.alloc(0);

              if (ws.readyState === WebSocket.OPEN && streamSid) {
                const responseFrame = {
                  event: 'media',
                  stream_sid: streamSid,
                  media: {
                    payload: paddedChunk.toString('base64')
                  }
                };
                ws.send(JSON.stringify(responseFrame));
              }
            }
          }, 100);
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
                  encoding: 'pcm_s16le'
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

    // Clear any active flush timeouts
    if (ttsFlushTimeout) {
      clearTimeout(ttsFlushTimeout);
      ttsFlushTimeout = null;
    }
    mediaBuffer = Buffer.alloc(0);

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

    // Update queue item if it belongs to the outbound dialing queue
    if (callerId) {
      const activeItem = callQueue.find(item => phoneNumbersMatch(item.phone, callerId) && item.status === 'dialing');
      if (activeItem) {
        activeItem.status = 'completed';
        broadcastQueueState();
      }
    }

    // Auto-dial next item in queue after 5 seconds if queue remains active
    if (queueActive) {
      console.log('Queue dialer: Call ended. Dialing next customer in 5 seconds...');
      setTimeout(() => {
        dialNextInQueue();
      }, 5000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`WebSocket server endpoint: ws://localhost:${PORT}/voice`);
});
