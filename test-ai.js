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
        timeout: 10000
      }
    );

    return response.data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('LLM API error:', err.response ? err.response.data : err.message);
    return 'Error connecting to LLM';
  }
}

// Sentiment Analyzer
async function analyzeSentiment(transcriptArray) {
  const conversationText = transcriptArray.join('\n');
  const systemPrompt = `You are a sentiment analyzer. Analyze the user's overall satisfaction from the following call transcript. 
Output exactly one word: either "positive" or "negative". Do not include any punctuation, formatting, or other words.`;

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
        timeout: 10000
      }
    );

    return response.data?.choices?.[0]?.message?.content?.trim().toLowerCase() || 'negative';
  } catch (err) {
    console.error('Sentiment analysis API error:', err.response ? err.response.data : err.message);
    return 'error';
  }
}

async function runTests() {
  console.log('\n--- Test 1: Two Problems (AC and Driver Behavior) ---');
  const history = [
    { role: 'assistant', content: "నమస్కారం, నేను ట్రావెల్ ఏజెన్సీ నుండి స్వాతిని మాట్లాడుతున్నాను. మీ రైడ్ ఎలా సాగింది?" },
    { role: 'user', content: "పర్లేదు కానీ ఏసీ పని చేయట్లేదు, పైగా డ్రైవర్ చాలా వేగంగా నిర్లక్ష్యంగా నడిపాడు." }
  ];
  console.log('Sending history:', JSON.stringify(history, null, 2));
  const reply1 = await getLLMResponse(history);
  console.log(`Swathi replies: "${reply1}"`);
}

runTests();
