# p12-twentytour-model-bench

## Question

Which cheap model should run the TwentyTour WhatsApp assistant (a walking-tour company: free tip-based and private tours)? Measured on synthetic customer messages, not on public benchmarks.

## Date

2026-09-30 first round on OpenRouter, 2026-10-08 round through the Experiential Labs gateway, 2026-10-09 Jev intent run.

## What it measures

- `classify`: 15 messages, 7 intents, 6 languages; right intent and language.
- `extract`: 8 private-tour requests; city, date, time, people and language, null when the customer did not say it.
- `draft`: 6 FAQ replies, graded on language, facts and never inventing a price.
- `conv`: 9 scripted WhatsApp chats with a simulated tourist, tools over an in-memory booking world (`world.py`).
- Cost and latency per model.

All customers, emails and bookings in `fixtures/` are invented (`@example` addresses). OpenRouter calls send `data_collection: deny` and `zdr: true`.

## How it runs

Python, own venv:

```
python -m venv .venv && .venv/bin/pip install -r requirements.txt
LLM_API_KEY=... .venv/bin/python run_bench.py --models all --tracks classify,extract,draft --reps 3
```

`--config models-xpl.json` with `LLM_BASE_URL` points it at another OpenAI-compatible gateway. Results land in `runs/`.

## Results

| Model | classify /45 | extract /24 | draft /18 | conv /9 | Bench cost | Latency |
|---|---|---|---|---|---|---|
| minimax-m3 | 45 | 23 | 18 | 9 | USD 0.028 | 2.1 s |
| deepseek-v4.1-flash | 45 | 24 | 18 | 8 | USD 0.033 | 3.3 s |
| gpt-6-luna | 45 | 24 | 18 | 7 | USD 0.009 | 3 s |
| claude-haiku-5.5 | 45 | 21 | 18 | 7 | not reported | 1.5 s |
| gemma-4-31b-it | 45 | 15 | 18 | 8 | USD 0.009 | |

- qwen3.8-27b scored 0/24 on extract only because it returns `pax` as a string; values were right 24/24.
- Extraction misses are almost all invented times when the customer gave none ("in the afternoon" became 14:00).
- `typesafe/jev-1.13` (`runs/jev-2026-10-09/`): 45/45 intent, 0.6 s, about 20x cheaper, but its own endpoint, not a drop-in.

## Verdict

**minimax-m3, deepseek-v4.1-flash as fallback.** Every model classifies right; the difference is extraction and multi-turn chats. Because no model is safe on dates and times, the model only classifies and extracts: a value is accepted only if it is literally in the message, missing values are asked back, and the customer confirms a summary before anything is booked.
