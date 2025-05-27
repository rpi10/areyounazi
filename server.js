import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize Groq client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Training data storage
const TRAINING_FILE = 'training_data.json';
const FLAG_FILE = 'flagged_responses.json';

// Initialize or load training data
async function loadTrainingData() {
    try {
        const data = await fs.readFile(TRAINING_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function saveTrainingData(data) {
    await fs.writeFile(TRAINING_FILE, JSON.stringify(data, null, 2));
}

async function loadFlaggedData() {
    try {
        const data = await fs.readFile(FLAG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

async function saveFlaggedData(data) {
    await fs.writeFile(FLAG_FILE, JSON.stringify(data, null, 2));
}

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve the training page
app.get('/train', (req, res) => {
    res.sendFile(path.join(__dirname, 'train.html'));
});

// Handle the analysis endpoint
app.post('/analyze', async (req, res) => {
    try {
        const { word } = req.body;
        
        if (!word) {
            return res.status(400).json({ error: 'Word is required' });
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Groq API key not configured' });
        }

        // Check training data first
        const trainingData = await loadTrainingData();
        if (trainingData[word.toLowerCase()]) {
            const { value, confidence } = trainingData[word.toLowerCase()];
            if (confidence > 0.7) { // Use training data if confidence is high
                return res.json({ analysis: value, isTrained: true });
            }
        }

        const prompt = `You are a historical analysis system. Analyze the ideological connection of the word/phrase "${word}" to Nazi ideology and the Third Reich.

Rate it on a scale from -100 to +100 where:
+100: Direct Nazi terminology or concepts (e.g., "Aryan race", "Final Solution")
+75: Strong Nazi association (e.g., concentration camps, SS)
+50: Moderate Nazi alignment (e.g., extreme nationalism)
+25: Slight Nazi alignment
0: Neutral/unrelated concepts
-25: Slight opposition to Nazi ideology
-50: Moderate opposition (e.g., democracy)
-75: Strong opposition (e.g., resistance movements)
-100: Complete opposition (e.g., anti-fascism)

Consider:
- Historical usage during 1933-1945
- Role in Nazi propaganda/policies
- Modern historical understanding
- Direct vs indirect associations

Return ONLY a number between -100 and +100, with no other text.`;

        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1
        });

        const analysis = response.choices[0]?.message?.content.trim().toLowerCase() || '';
        const percentageMatch = analysis.match(/-?\d+(\.\d+)?/);
        const percentage = percentageMatch ? parseFloat(percentageMatch[0]) : 0;
        
        res.json({ analysis: percentage, isTrained: false });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle training data submission
app.post('/train-submit', async (req, res) => {
    try {
        const { word, userValue, aiValue, isAccurate } = req.body;
        
        if (!word || userValue === undefined || aiValue === undefined) {
            return res.status(400).json({ error: 'Missing required data' });
        }

        const trainingData = await loadTrainingData();
        const wordKey = word.toLowerCase();

        if (!trainingData[wordKey]) {
            trainingData[wordKey] = {
                value: userValue,
                confidence: 0.1,
                agreements: isAccurate ? 1 : 0,
                total: 1
            };
        } else {
            trainingData[wordKey].total++;
            if (isAccurate) {
                trainingData[wordKey].agreements++;
            }
            
            // Update confidence and value
            trainingData[wordKey].confidence = trainingData[wordKey].agreements / trainingData[wordKey].total;
            trainingData[wordKey].value = isAccurate ? 
                (trainingData[wordKey].value * 0.7 + userValue * 0.3) : // Weighted average if accurate
                trainingData[wordKey].value; // Keep existing value if inaccurate
        }

        await saveTrainingData(trainingData);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle flagging responses
app.post('/flag-response', async (req, res) => {
    try {
        const { word, userValue, aiValue, reason } = req.body;
        
        if (!word || !reason) {
            return res.status(400).json({ error: 'Missing required data' });
        }

        const flaggedData = await loadFlaggedData();
        flaggedData.push({
            word,
            userValue,
            aiValue,
            reason,
            timestamp: new Date().toISOString()
        });

        await saveFlaggedData(flaggedData);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});