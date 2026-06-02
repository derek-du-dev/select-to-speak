## Gemini chat configuration

The `/api/gemini-chat` endpoint reads the Gemini credential from the backend
environment, so the browser extension package does not expose the API key.

Create `apps/api/.env` or set the environment variable in your process manager:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MAX_OUTPUT_TOKENS=8192
```

Restart the FastAPI service after changing these values.
