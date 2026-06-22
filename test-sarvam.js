import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const apiKey = process.env.SARVAM_API_KEY;

console.log(`Checking Sarvam API Key: ${apiKey ? 'Yes (starts with ' + apiKey.slice(0, 10) + '...)' : 'No'}`);

if (!apiKey) {
  console.error('ERROR: SARVAM_API_KEY is not defined in .env');
  process.exit(1);
}

async function testSarvamTTS() {
  try {
    console.log('Sending text-to-speech request to Sarvam AI...');
    const response = await axios.post(
      'https://api.sarvam.ai/text-to-speech',
      {
        text: "నమస్కారం, నేను స్వాతిని మాట్లాడుతున్నాను. మీ రైడ్ ఎలా సాగింది?",
        target_language_code: "te-IN",
        speaker: "shubh",
        model: "bulbul:v3"
      },
      {
        headers: {
          'api-subscription-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('HTTP Status Code:', response.status);
    console.log('Response Data:', JSON.stringify(response.data).slice(0, 500));
  } catch (err) {
    console.error('Sarvam API test failed!');
    if (err.response) {
      console.error('HTTP Error Status:', err.response.status);
      console.error('HTTP Error Body:', JSON.stringify(err.response.data));
    } else {
      console.error('Error message:', err.message);
    }
  }
}

testSarvamTTS();
