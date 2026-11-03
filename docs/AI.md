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
