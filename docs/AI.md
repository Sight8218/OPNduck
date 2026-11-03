# AI in OPNduck

Everything here is **off until you choose a model** (Settings > AI), and every feature still has its normal way of working
without one. OPNduck does not train or ship its own model: it uses one you already run, or one you pay for with your own key.

## Where the model runs

| Choice | What leaves your computer |
| --- | --- |
| OPNduck's own model (download in Settings > AI, about 3 GB) | Nothing |
| Ollama or LM Studio on this computer | Nothing |
| Another computer (an OpenAI-compatible address, for example over Tailscale) | Your messages, to that computer |
| A cloud API (Anthropic, OpenAI, Google, Mistral, xAI, DeepSeek, OpenRouter, Groq, or a custom address) | Your messages, and whatever the feature needs (a transcript, a few frames, file names), to that provider |

API keys are kept under your system keyring when there is one (otherwise in a file only you can read), are never logged, and
are only ever sent to their own provider. Plain `http://` addresses are accepted only for this computer and Tailscale.
"Let the model see pictures" is off by default; off means no frame or picture is ever sent.

## What it can do

- **Chat** (top bar): ask for things in your own words. The assistant looks things up (jobs, file facts, recommended settings)
  and *proposes* jobs as cards. **Nothing starts until you press Run**, each job is checked again by OPNduck before it starts,
  and jobs it starts are tagged "via AI" in the Library. It can only use files you picked, attached or that are in the Library,
  makes at most 10 tool calls per request, and has no delete or shell tools.
- **Spoken words** (Library): transcripts of your videos are made on this computer with Whisper (automatically whenever
  Subtitles runs, or with "Make searchable" on a finished video) and stored under the app's data folder. Search them from the
  Library ("Spoken words"), click a hit to open the trimmer at that moment. With a model set up you can also summarize a video,
  get chapters (written into a copy of the file without re-encoding, or copied as a YouTube list) and ask it questions; answers
  come only from the transcript and cite the time. Delete a transcript any time.
- **Colour Grade**: the automatic fix, the looks, matching and the sliders use plain rules, no AI. The optional "Suggest" button
  asks the model for slider values from a description or the first frame; the values are applied by the same filters you can
  adjust by hand.
- **Why did this fail?** (the "Why?" button on a failed job): rules for the common errors answer first, with a fix button when
  there is one. Only when no rule matches is your model asked, and its answer is labelled as coming from the AI.
- **Auto settings** (the Auto buttons on the cards) are rules measured from the file, no AI.

## Using another computer's model

A desktop with "Share this PC's engine" on, or an OPNduck Server, also shares its model (only OPNduck's own, Ollama or LM Studio:
never a cloud key). On the other computer choose "Another computer" in Settings > AI, enter `http://<that computer>:47821/v1/ai`
(Tailscale or https) and the device token as the access token.

## Tips for small local models

Short, concrete requests work best ("make this under 25 MB"). A model that "thinks" can use most of its answer budget on
thinking: lower Effort in Settings > AI, or set Thinking to Never.

## Not built yet

The AI thumbnail picker.

## Thumbnail picker

In the Library, open a video's panel and choose **Thumbnail**. OPNduck samples frames across the video, skips dark, bright and blurry ones, and saves the best as `<name>-thumbnail.jpg` next to the video. If your model can see pictures (Settings > AI > vision) it looks at the six best candidates and picks one; it only answers with a frame number. Otherwise the sharpest, best lit frame wins.

## Evals

`AI_EVAL_URL=http://127.0.0.1:1234/v1 AI_EVAL_MODEL=<model> npm run ai:eval` runs the real prompts (summary, chapters, questions, grade looks, thumbnail choice) and checks the answers. Run it after changing a prompt or trying a model.

## Internet access

Off by default. Turn it on in Settings > AI assistant > "Let the assistant use the internet" and the assistant gets two look-ups: a web search and reading a page. Chat shows what it is searching or reading, and each look-up is in the "Looked up" notes under the answer.

Search sources:
- **Wikipedia** (default): no account, good for facts and explanations.
- **Brave Search**: the whole web, with your own free API key (kept like your other keys).
- **Your own SearXNG server**: the whole web, private. Give OPNduck its address.
- **DuckDuckGo**: no account, but it has no search API and often refuses automated searches, so it is best effort.

Safety:
- Only `http` and `https` links. It never opens addresses on this computer or your own network (`localhost`, `192.168.x.x`, Tailscale, your servers). This is checked on the address the connection really uses and after every redirect, so a web name that points inward is refused too. (Your own SearXNG server is the one exception, because you chose it.)
- Pages are limited to 1.5 MB and 10 seconds, and only text pages are read.
- What it reads is untrusted text: it is information, never instructions. Jobs and settings are still only proposals that you confirm, so a page cannot make it do anything.
- With a cloud model, what it reads goes to your cloud provider like the rest of the chat. With a model on this computer, only the search words leave it.
