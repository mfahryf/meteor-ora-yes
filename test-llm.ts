const models = [
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-r1-0528:free',
    'qwen/qwen3-235b-a22b:free',
];

for (const model of models) {
    try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer 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'
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
            console.log(`   Response: ${j.choices?.[0]?.message?.content}`);
        }
    } catch (e) {
        console.log(`❌ ${model} → ERROR: ${e}`);
    }
}
