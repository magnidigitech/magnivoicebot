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
async function getLLMResponse(userInput, transcriptArray) {
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

  if (transcriptArray && transcriptArray.length > 0) {
    for (const pastInput of transcriptArray) {
      if (pastInput && pastInput !== userInput) {
        messages.push({ role: 'user', content: pastInput });
      }
    }
  }

  messages.push({ role: 'user', content: userInput });

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
  console.log('\n--- Test 1: Positive Feedback ---');
  const userFeedbackPositive = "రైడ్ చాలా బాగుంది, డ్రైవర్ చాలా బాగా నడిపాడు.";
  console.log(`User says: "${userFeedbackPositive}"`);
  const reply1 = await getLLMResponse(userFeedbackPositive, []);
  console.log(`Swathi replies: "${reply1}"`);

  console.log('\n--- Test 2: Negative Feedback ---');
  const userFeedbackNegative = "Driver was driving rashly and the AC was not working.";
  console.log(`User says: "${userFeedbackNegative}"`);
  const reply2 = await getLLMResponse(userFeedbackNegative, [userFeedbackPositive]);
  console.log(`Swathi replies: "${reply2}"`);

  console.log('\n--- Test 3: Sentiment Analysis (Positive Context) ---');
  const transcript1 = ["రైడ్ చాలా బాగుంది, డ్రైవర్ చాలా బాగా నడిపాడు.", "నమస్కారం, అవును నేను రివ్యూ ఇస్తాను"];
  const sentiment1 = await analyzeSentiment(transcript1);
  console.log(`Transcript: ${JSON.stringify(transcript1)}`);
  console.log(`Evaluated Sentiment: "${sentiment1}"`);

  console.log('\n--- Test 4: Sentiment Analysis (Negative Context) ---');
  const transcript2 = ["worst experience, delay in pickup", "driver was rude"];
  const sentiment2 = await analyzeSentiment(transcript2);
  console.log(`Transcript: ${JSON.stringify(transcript2)}`);
  console.log(`Evaluated Sentiment: "${sentiment2}"`);
}

runTests();
