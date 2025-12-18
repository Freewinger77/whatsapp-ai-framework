# WhatsApp AI Framework (Community Edition)

> **A production-ready WhatsApp automation framework featuring Anti-Ban protection, n8n integration, and RAG support.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-stable-green.svg)

**Note:** This is the open-source community edition of the internal framework used by [GX Automation Tech](https://gxautomation.tech). For enterprise-grade, fully compliant WhatsApp solutions (Green Tick verification), please contact us for our official **respond.io** implementation services.

---

## ⚠️ Disclaimer & Risk Warning

**This project uses the unofficial WhatsApp Web API (`@whiskeysockets/baileys`).**

1.  **Ban Risk:** Using this library creates a risk of your WhatsApp phone number being permanently banned.
2.  **Anti-Ban Logic:** While this project includes sophisticated "human-like" behavior simulation (variable typing delays, rate limiting, sleep cycles), **no protection is 100% foolproof**.
3.  **Liability:** The authors are not responsible for any banned numbers, lost data, or business interruption resulting from the use of this software.
4.  **Recommendation:** For business-critical numbers, use the official [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp) (or our managed service).

---

## Key Features

*   **🛡️ Advanced Anti-Ban System:** Simulates human typing speed, reading time, and variable delays based on message length and time of day.
*   **🧠 n8n Integration:** Seamlessly offload logic to n8n workflows for AI processing, RAG (Retrieval Augmented Generation), and database lookups.
*   **🔌 Plug-and-Play Architecture:** Built on Node.js + Express.
*   **📊 Web Admin Panel:** Monitor connection status, scan QR codes, and view logs via a browser interface.
*   **🌍 Multi-Language Support:** Ready for English, Bahasa Malaysia, and Mandarin.

## Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/whatsapp-ai-framework.git
    cd whatsapp-ai-framework
    ```

2.  **Install dependencies:**
    ```bash
    cd app
    npm install
    ```

3.  **Configure environment:**
    ```bash
    cp .env.example .env
    # Edit .env and add your n8n Webhook URL
    ```

4.  **Run the bot:**
    ```bash
    npm start
    ```
    Access the admin panel at `http://localhost:3000`.

## Architecture

This framework acts as a bridge between **WhatsApp** and **n8n**:

```
[WhatsApp User] <---> [This Bot (Baileys)] <---> [n8n Workflow] <---> [OpenAI / Gemini / RAG]
```

1.  **Bot receives message.**
2.  **Bot sends "Typing..." status.**
3.  **Bot forwards payload to n8n Webhook.**
4.  **n8n processes logic (AI, Database, etc.) and returns text.**
5.  **Bot calculates "Human Reading Time" + "Typing Time" delay.**
6.  **Bot sends reply.**

## License

MIT License. Free to use and modify.