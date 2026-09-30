# Aura Skincare — AI Voice Customer Support Agent

A browser-based AI voice customer support agent built for the Datastraw Technologies AI + Tech Intern assessment.

The agent, **Aria**, acts as a friendly and concise customer support specialist for Aura Skincare. Customers can speak naturally through their browser microphone, receive spoken responses, check mock order information, ask about brand policies, and receive a structured post-call summary.

---

## 1. Project Overview

Aura Skincare is a fictional premium organic Indian skincare brand.

The application provides a browser-based voice customer support experience without requiring telephony or a phone number.

The customer can:

- Start a voice conversation with Aria.
- Ask about Aura Skincare products and policies.
- Look up order information.
- Ask about delivery status.
- Request cancellations.
- Check return/refund policies.
- Report damaged or defective products.
- Ask about Cash on Delivery.
- Receive appropriate responses for invalid orders or missing information.
- Ask out-of-scope questions and receive a graceful response.
- End the call and view the complete transcript and structured JSON summary.

---

## 2. Architecture

The application uses a browser-based voice pipeline:

```text
Customer
   ↓
Browser Microphone
   ↓
Browser Speech Recognition
   ↓
Text
   ↓
Next.js API Route
   ↓
Deterministic Policy / Order Logic
   ↓
Gemini LLM for General Aura Support
   ↓
Response Text
   ↓
Browser Speech Synthesis
   ↓
Customer



Order-related requests are handled using a mock order database and order lookup/cancellation functions.

The application also stores the conversation during the call so that context is maintained and a structured post-call summary can be generated.

3. Technology Stack
Next.js — React-based application framework
React — User interface
TypeScript — Type-safe application code
Gemini API — LLM responses for general Aura Skincare support
Web Speech API — Browser speech recognition and speech synthesis
JSON / in-memory mock data — Order database
CSS / Tailwind CSS — Interface styling
GitHub — Source-code repository
Vercel — Public deployment

The architecture was intentionally kept simple so that the application can run directly in the browser without requiring a telephony provider.

4. Voice Pipeline
Speech-to-Text

The browser's Speech Recognition API listens to the customer's microphone and converts spoken English into text.

The application uses an Indian-English speech recognition setting where supported by the browser.

AI / Business Logic

The text is sent to the Next.js backend.

The backend first checks whether the request can be handled deterministically, such as:

Order lookup
Order cancellation
Return/refund policy
Damaged/defective product policy
Shipping information
Cash on Delivery
Out-of-scope requests

For general Aura Skincare questions, Gemini is used to generate a concise response.

Text-to-Speech

The response text is sent to the browser's Speech Synthesis API so that Aria can speak the response back to the customer.

Speech recognition is paused while Aria is speaking to prevent the agent's own voice from being captured as customer input.

5. Agent Persona

The agent is:

Aria from Aura Skincare — friendly, professional and concise Indian customer support specialist.

The goal is to keep responses natural and short enough for a voice conversation rather than producing long chatbot-style responses.

6. Aura Skincare Policies

The application uses the following provided brand information:

Shipping
Free delivery for orders above ₹499.
Orders below ₹499 have a ₹50 shipping fee.
Standard delivery takes 3–5 business days.
Returns and Refunds
Returns are accepted within 7 days of delivery.
Products must be unopened and unused.
Products must be in their original packaging.
Damaged / Defective Products
Damaged or defective products must be reported within 48 hours of delivery.
Photos are required for replacement.
Cancellation
Orders can be cancelled while they are in Processing.
Shipped or Out for Delivery orders cannot be cancelled.
Customers may refuse delivery at the doorstep.
Cash on Delivery
COD is available for orders up to ₹2,500.
Customers can pay by cash or UPI at the doorstep.
7. Mock Order Database

The application contains the three sample orders provided for the assessment.

Order	Customer	Product	Value	Status
ORD-101	Priya Sharma	Vitamin C Serum (30ml)	₹699	Out for Delivery
ORD-102	Rahul Verma	Hydrating Sunscreen SPF 50	₹499	Delivered
ORD-103	Ananya Patel	Green Tea Face Wash + Toner	₹850	Processing
ORD-101
BlueDart
Tracking: BD-982103
Expected by 6 PM today
Cannot be cancelled because it is Out for Delivery
ORD-102
Delhivery
Tracking: DL-441029
Delivered 14 days ago
Outside the 7-day return window
Also outside the 48-hour damaged-product reporting window
ORD-103
Ordered 3 hours ago
Processing
Eligible for cancellation
8. Order Lookup and Tool Handling

The application implements an order lookup function:

get_order_details(order_id)

The agent uses this when an order-specific request requires information from the mock order database.

The system handles:

Valid order IDs
Invalid order IDs
Missing order IDs
Orders that are not eligible for a requested action
Cancellation confirmation

A cancellation function is also used when a customer confirms that they want to cancel an eligible Processing order.

9. Brand Guardrails

The agent does not simply agree with every customer request.

Policy-related requests are checked against the provided Aura Skincare rules before a response is given.

For example, if a customer asks to return an order delivered 14 days ago, the agent explains that it is outside the 7-day return window instead of promising a refund.

Similarly, an Out for Delivery order is not cancelled even if the customer asks for cancellation.

For unclear or invalid order information, the agent asks the customer to provide or verify the order ID.

For unrelated requests, such as booking a flight, the agent explains that it can only assist with Aura Skincare-related support.

10. Post-Call Summary

When a call ends, the application displays:

Call Transcript

A chronological transcript containing:

Customer messages
Aria's responses
Structured Outcome

The application generates a JSON object containing:

{
  "customer_intent": "ORDER_TRACKING",
  "order_id": "ORD-101",
  "resolution_status": "RESOLVED",
  "call_summary": "Customer asked about the delivery status of ORD-101."
}

The actual summary is generated from the conversation and can represent multiple intents when several issues were discussed during the same call.

11. User Interface

The testing interface provides:

Start Call button
End Call button
Live voice state indicator
Listening / Thinking / Speaking states
Sample order helper information
Live conversation transcript
Post-call structured summary

The interface was designed to prioritize functionality and ease of testing rather than visual complexity.

12. Local Setup
Prerequisites

Install:

Node.js
npm
A modern browser with microphone and Web Speech API support
Clone the repository
git clone YOUR_GITHUB_REPOSITORY_URL
cd aura-voice-agent
Install dependencies
npm install
Configure environment variables

Create:

.env.local

Add:

GEMINI_API_KEY=your_gemini_api_key_here

The .env.local file should never be committed to GitHub.

A .env.example file is included in the repository as a template.

Run locally
npm run dev

Open:

http://localhost:3000

Allow microphone access when prompted.

13. Environment Variables
Variable	Purpose
GEMINI_API_KEY	API key used by the Gemini backend integration



14. Tell Us How You Think
1. Why did you choose this architecture and technology stack?

I chose a browser-based architecture because the assignment specifically allows the complete voice experience to run without telephony. Browser Speech Recognition and Speech Synthesis allow the application to handle microphone input and spoken responses without requiring a separate paid voice provider. Next.js provides both the user interface and backend API route, while Gemini handles general conversational support. Deterministic policy and order logic is used for important business rules so that the agent does not rely on an LLM to decide whether an order is eligible for cancellation or return.

2. What was the most difficult part of the assignment, and how did you solve it?

The most difficult part was making the voice conversation reliable while also enforcing deterministic business rules. Voice input can vary in how customers phrase requests, so the application normalizes order IDs and recognizes different confirmation phrases. I separated policy-sensitive operations such as order lookup, cancellation, returns, and damaged-product handling from general LLM responses so that the agent could follow the provided brand rules consistently.

3. If you had one more week to work on this, what would you improve first and why?

I would improve the voice interaction layer first, particularly interruption handling and lower response latency. Allowing customers to interrupt Aria while she is speaking would make the conversation feel more natural. I would also evaluate a streaming speech-to-speech or streaming STT/TTS architecture to reduce the delay between the customer finishing a sentence and Aria responding.

4. Imagine this agent is handling 1,000 customer conversations a day. What do you think would need to change or improve?

At that scale, I would separate the application into more independent services and replace the in-memory/mock order data with a production database and authenticated order-service API. I would also add rate limiting, request monitoring, structured logging, error tracking, caching for frequently requested policy information, and stronger API-key/security controls. Voice processing and LLM requests would need monitoring for latency, failures, usage limits, and cost. Conversation data would also need appropriate privacy and retention controls.

15. Deployment

The application is intended to be publicly deployed so that evaluators can open the application and test the voice agent directly.

Public Application
TODO: Add deployed application URL
GitHub Repository
TODO: Add GitHub repository URL
Demo Video
TODO: Add 3–5 minute demo video URL
LinkedIn
TODO: Add LinkedIn profile URL
16. Demo

The demonstration covers:

Starting a voice call
Looking up an order
Cancelling an eligible Processing order
Applying a policy restriction
Handling an invalid order
Handling an out-of-scope request
Ending the call
Reviewing the transcript
Reviewing the structured JSON summary
17. Project Status

The core browser-based voice customer support agent is implemented and tested against the main assignment scenarios.

The application is intended as an assessment prototype rather than a production-ready customer support platform.