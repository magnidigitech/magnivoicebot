import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const apiKey = process.env.LLM_API_KEY;
const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

console.log(`Using Provider: ${provider}`);
console.log(`API Key configured: ${apiKey ? 'Yes (starts with ' + apiKey.slice(0, 10) + '...)' : 'No'}`);

if (!apiKey) {
  console.error('ERROR: LLM_API_KEY is not defined in .env');
  process.exit(1);
}

// Swathi LLM Response Generator
async function getLLMResponse(conversationHistory) {
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
  "speech": "ఓహ్, ఏసీ ప్రాబ్లం వచ్చిందా అండీ... జర్నీలో అది చాలా ఇబ్బంది కదా, సారీ అండీ. నేను ఈ కంప్లైంట్ ని మా మెయింటెనెన్స్ టీమ్ కి పంపిస్తున్నాను... నెక్స్ట్ ట్రిప్ కి ఆ బస్సు ని కంప్లీట్ గా check చేయిస్తాము అండీ.",
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
  let endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  let model = process.env.LLM_MODEL || 'gemini-flash-latest';

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/chat/completions';
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

// Sentiment Analyzer
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
  let model = process.env.LLM_MODEL || 'gemini-flash-latest';

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/chat/completions';
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

async function runTests() {
  console.log('\n--- Test 1: Two Problems (AC and Driver Behavior) ---');
  const history = [
    { role: 'assistant', content: JSON.stringify({ speech: "నమస్కారం అండీ, నేను మాగ్ని ట్రావెల్స్ నుంచి స్వాతిని మాట్లాడుతున్నాను... నిన్న మన బస్సులో ట్రావెల్ చేశారు కదా, జర్నీ ఎలా జరిగింది అండీ? అంతా ఓకేనా?", action_tag: "active_chat" }) },
    { role: 'user', content: "పర్లేదు కానీ ఏసీ పని చేయట్లేదు, పైగా డ్రైవర్ చాలా వేగంగా నిర్లక్ష్యంగా నడిపాడు." }
  ];
  console.log('Sending history:', JSON.stringify(history, null, 2));
  const reply1 = await getLLMResponse(history);
  console.log(`Swathi replies: "${reply1}"`);
}

runTests();
