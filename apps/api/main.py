import logging
import asyncio
import json
import os
import urllib.request
import urllib.parse
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import spacy
import edge_tts

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("select-to-speak-api")

def load_local_env():
    """
    Load simple KEY=VALUE entries from local .env files when running outside a
    process manager. Existing environment variables always win.
    """
    env_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env")),
    ]

    for env_path in env_paths:
        if not os.path.exists(env_path):
            continue

        try:
            with open(env_path, "r", encoding="utf-8") as env_file:
                for line in env_file:
                    stripped = line.strip()
                    if not stripped or stripped.startswith("#") or "=" not in stripped:
                        continue

                    key, value = stripped.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip("\"'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except Exception as e:
            logger.warning(f"Failed to load env file {env_path}: {e}")

load_local_env()

app = FastAPI(
    title="Select-to-Speak English Learning API",
    description="Backend API for sentence splitting and TTS generation",
    version="1.0.0"
)

# Enable CORS for the chrome-extension or any web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows extension origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load lightweight English sentence segmenter using spaCy
try:
    logger.info("Initializing spaCy English sentencizer...")
    nlp = spacy.blank("en")
    nlp.add_pipe("sentencizer")
    logger.info("spaCy sentencizer loaded successfully.")
except Exception as e:
    logger.error(f"Failed to initialize spaCy: {e}")
    # Fallback placeholder if spaCy fails to initialize
    nlp = None

class TextPayload(BaseModel):
    text: str

class ChatMessage(BaseModel):
    role: str
    text: str

class GeminiChatPayload(BaseModel):
    messages: list[ChatMessage]

@app.post("/api/split-sentences")
async def split_sentences(payload: TextPayload):
    """
    Split the input English text into sentences using spaCy.
    """
    if not payload.text.strip():
        return {"sentences": []}
    
    if nlp is None:
        # Simple fallback sentence splitter if spaCy is unavailable
        import re
        sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', payload.text) if s.strip()]
        return {"sentences": sentences}

    try:
        doc = nlp(payload.text)
        sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
        return {"sentences": sentences}
    except Exception as e:
        logger.error(f"Error during sentence splitting: {e}")
        raise HTTPException(status_code=500, detail=f"Sentence split failed: {str(e)}")

@app.get("/api/tts")
async def tts(
    text: str = Query(..., description="The English text to speak"),
    rate: str = Query("+0%", description="Speech rate adjustment, e.g. '+10%', '-5%'"),
    voice: str = Query("en-US-AvaNeural", description="Voice name to use")
):
    """
    Generate speech audio using edge-tts and stream the MP3 chunks back.
    """
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text parameter cannot be empty")
    
    # Sanitize rate: edge-tts accepts formats like "+10%", "-5%", "+0%"
    # If the rate doesn't start with + or -, and is not 0, default it.
    rate_clean = rate.strip()
    if rate_clean and not rate_clean.startswith(("+", "-")) and rate_clean != "0":
        # Add positive sign if missing and numeric
        rate_clean = f"+{rate_clean}"
    
    # Ensure it ends with %
    if rate_clean and not rate_clean.endswith("%"):
        rate_clean = f"{rate_clean}%"

    logger.info(f"Generating TTS for text: '{text[:30]}...' with rate: '{rate_clean}' and voice: '{voice}'")

    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate_clean)
        
        audio_data = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.extend(chunk["data"])

        from fastapi import Response
        return Response(
            content=bytes(audio_data),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "inline; filename=\"tts.mp3\"",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(audio_data))
            }
        )
    except Exception as e:
        logger.error(f"Error during edge-tts stream: {e}")
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")

@app.get("/api/voices")
async def get_voices():
    """
    List of standard English voices that are supported.
    """
    # High-quality natural English voices
    return {
        "voices": [
            {"id": "en-US-AvaNeural", "name": "Ava (Female, Natural)", "gender": "Female"},
            {"id": "en-US-AndrewNeural", "name": "Andrew (Male, Natural)", "gender": "Male"},
            {"id": "en-US-EmmaNeural", "name": "Emma (Female, Standard)", "gender": "Female"},
            {"id": "en-US-BrianNeural", "name": "Brian (Male, Standard)", "gender": "Male"},
            {"id": "en-GB-SoniaNeural", "name": "Sonia (UK, Female)", "gender": "Female"},
            {"id": "en-GB-RyanNeural", "name": "Ryan (UK, Male)", "gender": "Male"}
        ]
    }

@app.post("/api/gemini-chat")
async def gemini_chat(payload: GeminiChatPayload):
    """
    Proxy chat messages to Gemini so the browser extension never exposes the
    Gemini API key. The first message should already contain the teaching prompt.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    max_output_tokens = int(os.environ.get("GEMINI_MAX_OUTPUT_TOKENS", "8192"))

    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured on the API server")

    clean_messages = [
        message for message in payload.messages
        if message.text and message.text.strip() and message.role in {"user", "model"}
    ]

    if not clean_messages:
        raise HTTPException(status_code=400, detail="At least one chat message is required")

    contents = [
        {
            "role": message.role,
            "parts": [{"text": message.text.strip()}]
        }
        for message in clean_messages
    ]

    request_body = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.35,
            "topP": 0.9,
            "maxOutputTokens": max_output_tokens
        }
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{urllib.parse.quote(model)}:generateContent?key={urllib.parse.quote(api_key)}"

    def call_gemini():
        encoded_body = json.dumps(request_body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=encoded_body,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Gemini API returned {e.code}: {error_body}")

    try:
        data = await asyncio.to_thread(call_gemini)
        candidate = data.get("candidates", [{}])[0]
        parts = candidate.get("content", {}).get("parts", [])
        answer = "\n".join(part.get("text", "") for part in parts if part.get("text")).strip()
        finish_reason = candidate.get("finishReason", "")

        if not answer:
            raise RuntimeError(f"Gemini returned an empty response: {json.dumps(data, ensure_ascii=False)}")

        return {"reply": answer, "finishReason": finish_reason}
    except Exception as e:
        logger.error(f"Gemini chat failed: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini chat failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 18002))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
