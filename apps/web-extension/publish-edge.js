// publish-edge.js - Automatic publishing script for Microsoft Edge Add-ons
const fs = require('fs');
const path = require('path');

// Load local .env files if present (supports both extension folder and root folder)
const envPaths = [
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.substring(0, eqIdx).trim();
            let val = trimmed.substring(eqIdx + 1).trim();
            // Strip potential single or double quotes
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.substring(1, val.length - 1);
            }
            process.env[key] = val;
          }
        }
      });
    } catch (e) {
      console.warn(`[!] Failed to parse .env file at ${envPath}:`, e.message);
    }
  }
}

// Retrieve credentials and defensively trim any accidental leading/trailing spaces or newlines
const PRODUCT_ID = (process.env.EDGE_PRODUCT_ID || '').trim();
const CLIENT_ID = (process.env.EDGE_CLIENT_ID || '').trim();
const API_KEY = (process.env.EDGE_API_KEY || '').trim();
const ZIP_PATH = path.resolve(__dirname, '../../select-to-speak-extension.zip');

if (!PRODUCT_ID || !CLIENT_ID || !API_KEY) {
  console.error("❌ Error: Missing required environment variables.");
  console.log("\nPlease set the following environment variables before running this script:");
  console.log("  $env:EDGE_PRODUCT_ID = \"Your-Product-ID\"");
  console.log("  $env:EDGE_CLIENT_ID  = \"Your-Partner-Center-Client-ID\"");
  console.log("  $env:EDGE_API_KEY    = \"Your-Partner-Center-API-Key\"");
  console.log("\n(Or set them in your GitHub Actions Secrets as secrets.EDGE_PRODUCT_ID, etc.)");
  process.exit(1);
}

const API_ROOT = `https://api.addons.microsoftedge.microsoft.com/v1/products/${PRODUCT_ID}`;
const DRAFT_URL = `${API_ROOT}/submissions/draft`;

async function publish() {
  try {
    if (!fs.existsSync(ZIP_PATH)) {
      throw new Error(`Zip package not found at: ${ZIP_PATH}. Run 'npm run package' first to generate the zip!`);
    }

    console.log(`[+] Reading package: ${ZIP_PATH}...`);
    const zipBuffer = fs.readFileSync(ZIP_PATH);

    // 1. Upload the zip package
    console.log("[+] Uploading draft package to Edge Add-ons Store...");
    const uploadRes = await fetch(`${DRAFT_URL}/package`, {
      method: "POST",
      headers: {
        "Authorization": `ApiKey ${API_KEY}`,
        "X-ClientID": CLIENT_ID,
        "Content-Type": "application/zip"
      },
      body: zipBuffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Upload failed (${uploadRes.status}): ${errText}`);
    }

    // Retrieve operation ID from response header (Location contains the check-status URI)
    const operationId = uploadRes.headers.get("Location") || uploadRes.headers.get("operation-id");
    if (!operationId) {
      const body = await uploadRes.json().catch(() => ({}));
      throw new Error(`Missing operation tracking ID in headers. Response body: ${JSON.stringify(body)}`);
    }
    
    console.log(`[+] Upload successful. Tracking URL/ID: ${operationId}`);

    // 2. Poll for upload verification status
    const pollUrl = operationId.startsWith("http") 
      ? operationId 
      : `${DRAFT_URL}/package/operations/${operationId}`;

    console.log("[+] Polling package verification status (every 5 seconds)...");
    let verified = false;
    
    // Poll up to 30 times (2.5 minutes max)
    for (let attempt = 1; attempt <= 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds

      const pollRes = await fetch(pollUrl, {
        method: "GET",
        headers: {
          "Authorization": `ApiKey ${API_KEY}`,
          "X-ClientID": CLIENT_ID
        }
      });

      if (!pollRes.ok) {
        console.warn(`[!] Poll attempt ${attempt} failed with HTTP status ${pollRes.status}, retrying...`);
        continue;
      }

      const status = await pollRes.json();
      const operationStatus = status.status || status.operationStatus || 'In Progress';
      console.log(`  [Attempt ${attempt}] Status: ${operationStatus}`);

      if (operationStatus === "Succeeded") {
        verified = true;
        break;
      } else if (operationStatus === "Failed") {
        const failurePath = path.resolve(__dirname, `edge-verification-failure-${Date.now()}.json`);
        try {
          fs.writeFileSync(failurePath, JSON.stringify(status, null, 2), 'utf8');
        } catch (writeErr) {
          console.warn(`[!] Failed to write verification details: ${writeErr.message}`);
        }

        console.error("[!] Full verification response:");
        console.error(JSON.stringify(status, null, 2));
        console.error(`[!] Saved verification response to: ${failurePath}`);
        throw new Error(`Package verification failed: ${JSON.stringify(status.message || status.errors || status)}`);
      }
    }

    if (!verified) {
      throw new Error("Timeout waiting for package verification from Edge Webstore.");
    }

    console.log("✅ Package verified successfully!");

    // 3. Trigger publishing submission
    console.log("[+] Submitting draft for review...");
    const publishRes = await fetch(`${API_ROOT}/submissions`, {
      method: "POST",
      headers: {
        "Authorization": `ApiKey ${API_KEY}`,
        "X-ClientID": CLIENT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        notes: "Automated release update via Edge REST API v1.1."
      })
    });

    if (!publishRes.ok) {
      const errText = await publishRes.text();
      throw new Error(`Publish submission failed (${publishRes.status}): ${errText}`);
    }

    const publishLocation = publishRes.headers.get("Location") || publishRes.headers.get("operation-id");
    console.log("\n==================================================================");
    console.log("🎉 SUCCESS: Extension submitted for Microsoft Edge Store review!");
    console.log(`Tracking ID / URL: ${publishLocation}`);
    console.log("==================================================================");
    console.log("Note: Edge Add-ons typically take 1 to 7 business days to complete review.");
    console.log("You can track progress in Microsoft Partner Center dashboard.");

  } catch (error) {
    console.error(`\n❌ Publish failed: ${error.message}`);
    process.exit(1);
  }
}

publish();
