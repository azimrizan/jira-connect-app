const express = require('express');
const bodyParser = require('body-parser');
const ace = require('atlassian-connect-express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();

// Trust proxy is required for Render's HTTPS to be detected correctly
app.set('trust proxy', true);

const addon = ace(app);

// Use ACE's built-in middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(addon.middleware());

app.use(express.static(path.join(__dirname, 'public')));

// ✅ Health check
app.get('/health', (req, res) => {
    res.send('AAVA Jira Connect app running ✅');
});

/**
 * Custom authentication wrapper that skips QSH validation.
 * This is the most reliable way to authenticate AJAX calls from the frontend when 
 * using AP.context.getToken(), as QSH calculations often fail behind proxies like Render.
 */
const authenticateSkipQsh = (req, res, next) => {
    // Calling authenticate(true) tells ACE to skip the query string hash (qsh) check
    addon.authenticate(true)(req, res, (err) => {
        if (err) {
            console.error('Auth Error:', err);
            return res.status(401).json({
                success: false,
                error: 'Authentication failed: ' + (err.message || 'Unknown error')
            });
        }
        next();
    });
};

// 🔐 Jira Issue Panel (Button)
app.get('/render-panel', addon.authenticate(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public/panel.html'));
});

// 🔐 Refiner Dialog (Modal Content)
app.get('/render-refiner', addon.authenticate(), (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 🔐 Gemini enhancement
// We use skipQsh to resolve the persistent "query hash does not match" error
app.post('/enhance-description', authenticateSkipQsh, async (req, res) => {
    const { currentDescription } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not set' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `You are a professional Jira issue enhancer. Convert the following vague issue description into a comprehensive, structured JSON format.

Original Description: "${currentDescription}"

Return ONLY valid JSON (no markdown, no code blocks) with these fields:
{
  "Executive Summary": {"Overview": "...", "Key Outcomes": ["..."]},
  "Enhanced Jira Description": {"Title": "...", "Background": "...", "Impact Analysis": "...", "Additional Notes": ["..."]},
  "Steps to Reproduce": ["..."],
  "Actual Result": "...",
  "Expected Result": "...",
  "Acceptance Criteria": ["GIVEN...WHEN...THEN..."],
  "Issue Type": "Bug|Story|Task",
  "Priority": "Critical|High|Medium|Low",
  "Validation Report": {"QA Results": "...", "Improvement Suggestions": "...", "Compliance Checks": "..."},
  "Troubleshooting Guide": {"Common Issues": ["..."], "Solutions": ["..."]},
  "Recommendations": ["..."]
}

Return ONLY the JSON object, no other text.`
                        }]
                    }]
                })
            }
        );

        const data = await response.json();
        const enhanced = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!enhanced) throw new Error('Invalid Gemini response');

        // Clean and parse JSON response
        let cleanedText = enhanced.trim();
        if (cleanedText.startsWith('```json')) {
            cleanedText = cleanedText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        } else if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/```\s*/g, '');
        }

        // Validate it's valid JSON
        const jsonResult = JSON.parse(cleanedText);

        res.json({ success: true, enhancedDescription: JSON.stringify(jsonResult, null, 2) });
    } catch (e) {
        console.error('Gemini error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🔐 Update Jira description
app.put('/update-description', authenticateSkipQsh, (req, res) => {
    const { issueKey, newDescription } = req.body;
    const httpClient = addon.httpClient(req);

    httpClient.put({
        url: `/rest/api/3/issue/${issueKey}`,
        json: {
            fields: {
                description: {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { type: 'text', text: newDescription }
                            ]
                        }
                    ]
                }
            }
        }
    }, (err, response, body) => {
        if (err || response.statusCode >= 400) {
            console.error('Jira update error:', err || body);
            return res.status(500).json({ success: false, error: body });
        }
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
