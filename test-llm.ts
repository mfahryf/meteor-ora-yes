const key = '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';
const models = [
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'qwen/qwen3-30b-a3b:free',
    'microsoft/phi-4-multimodal-instruct:free',
];

for (const model of models) {
    try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
                'HTTP-Referer': 'https://meteor-ora-yes.com',
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Say hi in 5 words' }],
                max_tokens: 30
            })
        });
        const body = await r.text();
        const ok = r.status === 200 ? '✅' : '❌';
        console.log(`${ok} ${model} → ${r.status}`);
        if (r.status === 200) {
            const j = JSON.parse(body);
            console.log(`   Response: ${j.choices?.[0]?.message?.content?.substring(0, 60)}`);
        }
    } catch (e) {
        console.log(`❌ ${model} → ERROR`);
    }
}
