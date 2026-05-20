// publish-edge.js - Automatic publishing script for Microsoft Edge Add-ons
const fs = require('fs');
const path = require('path');

// Retrieve credentials from environment variables
const PRODUCT_ID = process.env.EDGE_PRODUCT_ID;
const CLIENT_ID = process.env.EDGE_CLIENT_ID;
const API_KEY = process.env.EDGE_API_KEY;
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

const BASE_URL = `https://api.addons.microsoftedge.microsoft.com/v1/products/${PRODUCT_ID}/submissions/draft`;

async function publish() {
  try {
    if (!fs.existsSync(ZIP_PATH)) {
      throw new Error(`Zip package not found at: ${ZIP_PATH}. Run 'npm run package' first to generate the zip!`);
    }

    console.log(`[+] Reading package: ${ZIP_PATH}...`);
    const zipBuffer = fs.readFileSync(ZIP_PATH);

    // 1. Upload the zip package
    console.log("[+] Uploading draft package to Edge Add-ons Store...");
    const uploadRes = await fetch(`${BASE_URL}/package`, {
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
      : `${BASE_URL}/package/operations/${operationId}`;

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
        throw new Error(`Package verification failed: ${JSON.stringify(status.message || status.errors || status)}`);
      }
    }

    if (!verified) {
      throw new Error("Timeout waiting for package verification from Edge Webstore.");
    }

    console.log("✅ Package verified successfully!");

    // 3. Trigger publishing submission
    console.log("[+] Submitting draft for review...");
    const publishRes = await fetch(`${BASE_URL}/publish`, {
      method: "POST",
      headers: {
        "Authorization": `ApiKey ${API_KEY}`,
        "X-ClientID": CLIENT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalNotes: "Automated release update via Edge REST API v1.1."
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
