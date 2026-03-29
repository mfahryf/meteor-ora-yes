import { defaultConfig } from "./src/config/defaults";
import { loadConfig } from "./src/config/loader";

async function run() {
    const config = loadConfig();
    const model = config.llm.screeningModel || config.llm.model;
    const url = `${config.llm.baseUrl}/chat/completions`;
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.llm.apiKey}`,
        "HTTP-Referer": "https://meteor-ora-yes.com",
        "X-Title": "MeteorOraYes Simulator",
    };
    const bodyObj = {
        model,
        messages: [
            { role: "system", content: "Say hello in JSON" },
            { role: "user", content: "Hi" },
        ],
        temperature: config.llm.temperature || 0.3,
        max_tokens: 50,
    };
    
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyObj),
    });

    const fs = require("fs");
    fs.writeFileSync("out.json", JSON.stringify({
        url,
        headers,
        bodyModelHex: Buffer.from(bodyObj.model).toString('hex'),
        authHex: Buffer.from(headers.Authorization).toString('hex'),
        status: response.status,
        response: await response.text()
    }, null, 2));
}

run();
