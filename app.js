const express = require('express');
const bodyParser = require('body-parser');
const ace = require('atlassian-connect-express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const addon = ace(app);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(addon.middleware());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Local health check (NO auth)
app.get('/', (req, res) => {
  res.send('AAVA Jira Connect app running ✅');
});

// ✅ Required lifecycle endpoint
app.post('/installed', (req, res) => {
  res.sendStatus(200);
});

// 🔐 Jira Issue Panel
app.get('/render-refiner', addon.authenticate(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 🔐 Gemini AI enhancement
app.post('/enhance-description', addon.authenticate(), async (req, res) => {
  const { currentDescription } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: 'GEMINI_API_KEY not set'
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Improve and expand this Jira issue description clearly and professionally:\n\n${currentDescription}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    const enhanced =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!enhanced) {
      throw new Error('Invalid Gemini response');
    }

    res.json({
      success: true,
      enhancedDescription: enhanced.trim()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// 🔐 Update Jira issue description
app.put('/update-description', addon.authenticate(), (req, res) => {
  const { issueKey, newDescription } = req.body;
  const httpClient = addon.httpClient(req);

  httpClient.put(
    {
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
    },
    (err, response, body) => {
      if (err || response.statusCode >= 400) {
        return res.status(500).json({
          success: false,
          error: body
        });
      }
      res.json({ success: true });
    }
  );
});

// ✅ Render + local compatible port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
