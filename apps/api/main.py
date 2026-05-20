import logging
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

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 18002))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
