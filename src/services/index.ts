import axios from 'axios';

const API_KEY = import.meta.env.VITE_API_KEY; // Store this securely in .env
const ASSISTANT_ID = import.meta.env.VITE_ASSISTANT_ID; // Get this from OpenAI dashboard
const ThreadId = import.meta.env.VITE_THREAD_ID;
const BASE_URL = 'https://api.openai.com/v1';

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'OpenAI-Beta': 'assistants=v2',
  'Content-Type': 'application/json'
};

// Step 1: Create a Thread
export const createThread = async () => {
  try {
    const response = await axios.post(`${BASE_URL}/threads`, {}, { headers });
    return response.data.id;
  } catch (error) {
    console.error('Error creating thread:', error);
    return null;
  }
};

// Step 2: Send a Message to the Thread
export const sendMessage = async (message: string) => {
  try {
    await axios.post(
      `${BASE_URL}/threads/${ThreadId}/messages`,
      {
        role: 'user',
        content: message
      },
      { headers }
    );
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

// Step 3: Run the Assistant on the Thread
export const runAssistant = async () => {
  try {
    const response = await axios.post(
      `${BASE_URL}/threads/${ThreadId}/runs`,
      {
        assistant_id: ASSISTANT_ID
      },
      { headers }
    );
    return response.data.id;
  } catch (error) {
    console.error('Error running assistant:', error);
    return null;
  }
};

// Step 4: Check for a Response
export const getResponse = async () => {
  try {
    const response = await axios.get(`${BASE_URL}/threads/${ThreadId}/messages`, { headers });
    return response.data.data; // Returns an array of messages
  } catch (error) {
    console.error('Error fetching response:', error);
    return [];
  }
};
