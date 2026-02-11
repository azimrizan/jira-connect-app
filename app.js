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
                            text: `You are a professional Jira issue enhancer. Transform the vague description below into a comprehensive, enterprise-grade bug report.

Original Description: "${currentDescription}"

IMPORTANT GUIDELINES:
1. Executive Summary Overview: Write a detailed paragraph explaining how you transformed the vague description into a comprehensive report. Mention what was unclear and how you clarified it.
2. Key Outcomes: List 3-4 specific achievements (e.g., "Transformed a vague report into...", "Established clear, testable Acceptance Criteria...")
3. Enhanced Description Title: ALWAYS start with "Bug:" followed by a specific, technical description
4. Background: Provide detailed context about the feature, its purpose, and current state. Be narrative and thorough (3-5 sentences).
5. Impact Analysis: Explain business impact in detail - mention service outage, SLAs, user trust, productivity. Use phrases like "critical-level incident", "complete service outage". (3-5 sentences)
6. Additional Notes: Provide 3 actionable investigation steps (e.g., "Initial investigation should focus on...", "It is recommended to check...")
7. Steps to Reproduce: Number them as "1. Navigate to...", "2. Enter...", etc.
8. Actual Result: Describe what happens now in detail (2-3 sentences)
9. Expected Result: Describe desired behavior with specifics like timing ("within 3-5 seconds")
10. Acceptance Criteria: Use Gherkin format "GIVEN...WHEN...THEN" for each criterion (4-5 criteria)
11. Priority: Use "Critical", "High", "Medium", or "Low" ONLY
12. Validation Report: Write detailed paragraphs for QA Results, Improvement Suggestions, Compliance Checks
13. Troubleshooting Guide Common Issues: List 4-5 general reporting problems ("Ambiguous Titles...", "Missing Steps...")
14. Troubleshooting Guide Solutions: List 4-5 general solutions ("Standardize Titles...", "Enforce Required Fields...")
15. Recommendations: Provide 4 process improvement recommendations

Write in a professional, detailed, explanatory style. Be thorough and specific.`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        response_mime_type: "application/json",
                        response_schema: {
                            type: "object",
                            properties: {
                                "Executive Summary": {
                                    type: "object",
                                    properties: {
                                        Overview: { type: "string" },
                                        "Key Outcomes": { type: "array", items: { type: "string" } }
                                    }
                                },
                                "Enhanced Jira Description": {
                                    type: "object",
                                    properties: {
                                        Title: { type: "string" },
                                        Background: { type: "string" },
                                        "Impact Analysis": { type: "string" },
                                        "Additional Notes": { type: "array", items: { type: "string" } }
                                    }
                                },
                                "Steps to Reproduce": { type: "array", items: { type: "string" } },
                                "Actual Result": { type: "string" },
                                "Expected Result": { type: "string" },
                                "Acceptance Criteria": { type: "array", items: { type: "string" } },
                                "Issue Type": { type: "string" },
                                Priority: { type: "string" },
                                "Validation Report": {
                                    type: "object",
                                    properties: {
                                        "QA Results": { type: "string" },
                                        "Improvement Suggestions": { type: "string" },
                                        "Compliance Checks": { type: "string" }
                                    }
                                },
                                "Troubleshooting Guide": {
                                    type: "object",
                                    properties: {
                                        "Common Issues": { type: "array", items: { type: "string" } },
                                        Solutions: { type: "array", items: { type: "string" } }
                                    }
                                },
                                Recommendations: { type: "array", items: { type: "string" } }
                            },
                            required: ["Executive Summary", "Enhanced Jira Description", "Steps to Reproduce", "Actual Result", "Expected Result", "Acceptance Criteria", "Issue Type", "Priority"]
                        }
                    }
                })
            }
        );

        const data = await response.json();
        const enhanced = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!enhanced) throw new Error('Invalid Gemini response');

        // With response_mime_type, Gemini should return pure JSON
        // But let's still clean it just in case
        let cleanedText = enhanced.trim();
        if (cleanedText.startsWith('```json')) {
            cleanedText = cleanedText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        } else if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/```\s*/g, '');
        }

        // Parse and validate JSON
        const jsonResult = JSON.parse(cleanedText);

        console.log('✅ Gemini returned valid JSON:', Object.keys(jsonResult));

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
