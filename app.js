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
                            text: `You are a professional Jira issue enhancer. Transform this vague description into a comprehensive bug report.

Original: "${currentDescription}"

Return ONLY this exact JSON structure with detailed, professional content:

{
  "Executive Summary": {
    "Overview": "[Write 3-5 sentences explaining how you transformed the vague description into a comprehensive report, what was unclear, and how you clarified it. Start with 'The original issue description...' and explain the transformation.]",
    "Key Outcomes": [
      "Transformed a vague report into a detailed, actionable bug ticket.",
      "Established clear, testable Acceptance Criteria for QA validation.",
      "Assigned an appropriate Issue Type (Bug) and Priority (Critical) to reflect business impact.",
      "Provided a full-fledged report including validation, troubleshooting, and recommendations for future improvements."
    ]
  },
  "Enhanced Jira Description": {
    "Title": "Bug: [Specific technical title]",
    "Background": "[3-5 sentences: What is this feature? What is its purpose? What is the current state? Be detailed and narrative.]",
    "Impact Analysis": "[3-5 sentences: Explain this is a critical-level incident, complete service outage, mentions SLAs, user trust, productivity impact. Use business language.]",
    "Additional Notes": [
      "Initial investigation should focus on [specific component/area].",
      "It is recommended to check [specific log/tool] for [specific errors].",
      "The report is missing [specific details]. The development team should [action]."
    ]
  },
  "Steps to Reproduce": [
    "1. Navigate to [specific page/URL].",
    "2. Enter [specific input] into [specific field].",
    "3. Enter [specific input] into [specific field].",
    "4. Click the '[button name]' button."
  ],
  "Actual Result": "[2-3 sentences: What happens currently when performing the steps? Be specific about lack of response, no errors shown, user remains on page, etc.]",
  "Expected Result": "[2-3 sentences: What should happen? Include specifics like 'within 3-5 seconds', specific redirects, etc.]",
  "Acceptance Criteria": [
    "GIVEN a user is on [page] with [condition], WHEN they [action], THEN they [expected outcome].",
    "GIVEN [condition], THEN [expected outcome].",
    "GIVEN a user [action with invalid data], WHEN they [action], THEN [error message should display].",
    "GIVEN a user [action], THEN the [UI element] provides [specific feedback]."
  ],
  "Issue Type": "Bug",
  "Priority": "Critical",
  "Validation Report": {
    "QA Results": "[2-3 sentences: Assessment of description completeness, whether it passes 'Ready for Development', what components it contains.]",
    "Improvement Suggestions": "[2-3 sentences: Recommendations for reporters - include environment details, console logs, screen recordings, bug-reporting tools, Jira templates.]",
    "Compliance Checks": "[1-2 sentences: Whether ticket structure complies with organizational standards, mentions specific components like title, background, steps, acceptance criteria.]"
  },
  "Troubleshooting Guide": {
    "Common Issues": [
      "Ambiguous Titles: Titles like 'It's broken' lack context.",
      "Missing Steps to Reproduce: Without clear steps, developers and QA cannot verify the issue.",
      "Unclear Outcomes: Vague descriptions of 'not working' prevent effective debugging and testing.",
      "Lack of Impact Analysis: Issues without a clear business impact are often deprioritized incorrectly."
    ],
    "Solutions": [
      "Standardize Titles: Use a 'Type: Feature/Component - Brief Description' format (e.g., 'Bug: Login Page - Button Unresponsive').",
      "Enforce Required Fields: Make 'Steps to Reproduce', 'Actual Result', and 'Expected Result' mandatory fields in Jira.",
      "Define Acceptance Criteria: Use the Gherkin (Given/When/Then) syntax to define specific, testable outcomes.",
      "Quantify Impact: Explain the effect on users, business operations, or revenue to ensure proper prioritization."
    ]
  },
  "Recommendations": [
    "Implement standardized Jira issue templates for common issue types like Bugs and Stories to guide reporters in providing complete information.",
    "Conduct brief, periodic training sessions for teams on what constitutes a high-quality Jira description.",
    "Establish a 'Definition of Ready' for development teams, which requires tickets to meet specific quality criteria before being accepted into a sprint.",
    "Promote a culture of clear communication where developers and QA are empowered to ask for clarification and push back on incomplete tickets."
  ]
}

Follow this EXACT structure and field order. Make content specific to the original description.`
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
