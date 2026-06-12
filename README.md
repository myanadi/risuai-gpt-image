# 🎨 GPT Image — RisuAI Plugin

A direct OpenAI image generation plugin for [RisuAI](https://github.com/kwaroran/Risuai). 
Extracts the latest AI response, organizes scene tags via LLM, then generates contextual 
images through OpenAI's `gpt-image-2` API.

## ✨ Features

- **Direct API call** — Bypasses RisuAI's built-in image rendering limitations
- **Scene tag generation** — Auto-extracts scene/character/outfit/composition tags from RP output
- **Two modes** — Scene shot (full scene) or character shot (single subject)
- **Style reference** — Optional reference image for art style consistency
- **Draggable floating window** — Image displayed in a movable overlay
- **PNG export** — Save generated images locally
- **4 default presets** — Daily / Romance / Action / Cinematic style packs

## 🚀 Installation

1. Download `GPTImage.js`
2. In RisuAI: **Settings → Plugins → Import Plugin**
3. Add your OpenAI API key in plugin settings
4. Enable

## 🛠️ Tech Stack

- Vanilla JavaScript
- OpenAI API (`gpt-image-2` endpoint)
- RisuAI Plugin API v3.0
- Developed with AI-assisted workflow (Claude/GPT)

## 📝 Why This Plugin

RisuAI's built-in image generation had model compatibility issues at the time of 
development. Rather than wait for upstream fixes, this plugin implements a direct 
API call workaround — bypassing the internal image module and calling OpenAI's 
endpoint directly. Demonstrates a "gap-found → spec → build" approach to plugin 
development.

## 🇰🇷 한국어 요약

RisuAI 내장 이미지 생성의 신규 모델 호환 오류를 우회하기 위해 OpenAI API를 직접 호출하는 
이미지 생성 플러그인입니다. RP 출력에서 장면·캐릭터·복식·구도 태그를 자동 추출하고, 
드래그 플로팅 창에 이미지를 표시하며 PNG로 저장합니다. 장면샷·1인샷 모드와 화풍 참조 
이미지를 지원합니다.

## 📜 License

MIT — see [LICENSE](LICENSE)

## 🔗 Links

- Author Portfolio: https://app.notion.com/p/Portfolio-377742607f3c811fb73ce8226a96ae64
- RisuAI: https://github.com/kwaroran/Risuai
- OpenAI Images API: https://platform.openai.com/docs/api-reference/images
