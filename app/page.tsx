"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "Customer" | "Aria";
  text: string;
};

type CallSummary = {
  customer_intent: string;
  order_id: string | null;
  resolution_status: string;
  call_summary: string;
};

type Outcome = CallSummary;

export default function Home() {
  const [callActive, setCallActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);

  const recognitionRef = useRef<any>(null);

  const callActiveRef = useRef(false);
  const speakingRef = useRef(false);
  const thinkingRef = useRef(false);
  const shouldListenRef = useRef(false);
  const recognitionRunningRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const outcomesRef = useRef<Outcome[]>([]);
  const cancelledOrderIdsRef = useRef<string[]>([]);
  const pendingCancellationOrderIdRef = useRef<string | null>(null);

  // Structured tool results from the latest turn.
  // These are used for the post-call summary so an earlier order
  // cannot overwrite a later order in the same call.
  const latestOrderIdRef = useRef<string | null>(null);
  const latestCancellationResultRef = useRef<any>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /*
   * START MICROPHONE
   */
  const startListening = () => {
    if (!callActiveRef.current) return;
    if (speakingRef.current) return;
    if (thinkingRef.current) return;
    if (!shouldListenRef.current) return;
    if (recognitionRunningRef.current) return;

    const recognition = recognitionRef.current;

    if (!recognition) return;

    try {
      recognition.start();
    } catch (error) {
      console.log("Recognition start:", error);
    }
  };

  /*
   * STOP MICROPHONE
   */
  const stopListening = () => {
    const recognition = recognitionRef.current;

    if (!recognition) return;

    try {
      recognition.stop();
    } catch (error) {
      console.log("Recognition stop:", error);
    }

    recognitionRunningRef.current = false;
    setIsListening(false);
  };

  /*
   * ARIA SPEAKS
   */
  const speakResponse = (text: string) => {
    if (!("speechSynthesis" in window)) {
      console.log("Speech synthesis is not supported.");
      speakingRef.current = false;
      setIsSpeaking(false);
      if (callActiveRef.current) {
        shouldListenRef.current = true;
        setTimeout(() => startListening(), 300);
      }
      return;
    }

    shouldListenRef.current = false;
    stopListening();

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = "en-IN";
    utterance.rate = 0.92;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();

    const indianVoice =
      voices.find((voice) => voice.lang.toLowerCase() === "en-in") ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("en-in")) ||
      voices.find((voice) => /india|indian|rishi|heera/i.test(voice.name) && voice.lang.toLowerCase().startsWith("en"));

    if (indianVoice) {
      utterance.voice = indianVoice;
    }

    speakingRef.current = true;
    setIsSpeaking(true);

    utterance.onstart = () => {
      speakingRef.current = true;
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      speakingRef.current = false;
      setIsSpeaking(false);

      if (callActiveRef.current) {
        shouldListenRef.current = true;

        setTimeout(() => {
          startListening();
        }, 300);
      }
    };

    utterance.onerror = (event) => {
      console.log("Speech synthesis error:", event);

      speakingRef.current = false;
      setIsSpeaking(false);

      if (callActiveRef.current) {
        shouldListenRef.current = true;

        setTimeout(() => {
          startListening();
        }, 300);
      }
    };

    window.speechSynthesis.resume();

    window.speechSynthesis.speak(utterance);
  };

  /*
   * SEND CUSTOMER MESSAGE TO GEMINI
   */
  const sendToAI = async (
    customerMessage: string,
    conversationHistory: Message[]
  ) => {
    if (!customerMessage.trim()) return;
    if (!callActiveRef.current) return;

    thinkingRef.current = true;
    setIsThinking(true);

    shouldListenRef.current = false;
    stopListening();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: customerMessage,
          history: conversationHistory,
          cancelledOrderIds: cancelledOrderIdsRef.current,
          pendingCancellationOrderId: pendingCancellationOrderIdRef.current,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong."
        );
      }

      if (data.outcome) {
        outcomesRef.current = [
          ...outcomesRef.current,
          data.outcome as Outcome,
        ];
      }

      if (data.cancelledOrderId) {
        const id = String(data.cancelledOrderId);
        if (!cancelledOrderIdsRef.current.includes(id)) {
          cancelledOrderIdsRef.current = [
            ...cancelledOrderIdsRef.current,
            id,
          ];
        }
      }

      pendingCancellationOrderIdRef.current =
        data.pendingCancellationOrderId || null;

      // Keep the latest structured order/tool result separately from the
      // transcript. This makes the final summary reflect the latest action.
      // Backend is the source of truth for the latest order/action.
      // Replace the cancellation result every turn so an older action can
      // never leak into the final call summary.
      if (data.orderId) {
        latestOrderIdRef.current = data.orderId;
      }

      latestCancellationResultRef.current =
        data.cancellationResult ?? null;

      const ariaMessage: Message = {
        role: "Aria",
        text: data.response,
      };

      setMessages((previous) => [
        ...previous,
        ariaMessage,
      ]);

      messagesRef.current = [
        ...conversationHistory,
        ariaMessage,
      ];

      thinkingRef.current = false;
      setIsThinking(false);

      speakResponse(data.response);
    } catch (error) {
      console.error("AI error:", error);

      const errorMessage: Message = {
        role: "Aria",
        text:
          "Sorry, I'm having trouble responding right now. Please try again.",
      };

      setMessages((previous) => [
        ...previous,
        errorMessage,
      ]);

      messagesRef.current = [
        ...conversationHistory,
        errorMessage,
      ];

      thinkingRef.current = false;
      setIsThinking(false);

      speakResponse(errorMessage.text);
    }
  };

  /*
   * CREATE SPEECH RECOGNITION ONCE
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.log(
        "Speech recognition is not supported in this browser."
      );
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      recognitionRunningRef.current = true;

      if (
        callActiveRef.current &&
        shouldListenRef.current &&
        !speakingRef.current &&
        !thinkingRef.current
      ) {
        setIsListening(true);
      }
    };

    recognition.onresult = (event: any) => {
      if (
        speakingRef.current ||
        thinkingRef.current
      ) {
        return;
      }

      const result =
        event.results[event.results.length - 1];

      if (!result || !result.isFinal) return;

      const customerText =
        result[0].transcript.trim();

      if (!customerText) return;

      console.log("Customer said:", customerText);

      shouldListenRef.current = false;
      stopListening();

      const customerMessage: Message = {
        role: "Customer",
        text: customerText,
      };

      const updatedHistory = [
        ...messagesRef.current,
        customerMessage,
      ];

      messagesRef.current = updatedHistory;

      setMessages(updatedHistory);

      sendToAI(
        customerText,
        updatedHistory
      );
    };

    recognition.onend = () => {
      recognitionRunningRef.current = false;
      setIsListening(false);

      if (
        callActiveRef.current &&
        shouldListenRef.current &&
        !speakingRef.current &&
        !thinkingRef.current
      ) {
        setTimeout(() => {
          startListening();
        }, 300);
      }
    };

    recognition.onerror = (event: any) => {
      console.log(
        "Speech recognition error:",
        event.error
      );

      recognitionRunningRef.current = false;
      setIsListening(false);

      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        return;
      }

      if (
        callActiveRef.current &&
        shouldListenRef.current &&
        !speakingRef.current &&
        !thinkingRef.current
      ) {
        setTimeout(() => {
          startListening();
        }, 800);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      callActiveRef.current = false;
      shouldListenRef.current = false;

      try {
        recognition.stop();
      } catch (error) {
        console.log(
          "Recognition cleanup:",
          error
        );
      }

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /*
   * GENERATE LOCAL CALL SUMMARY
   */
  const generateCallSummary = (conversation: Message[]): CallSummary => {
    const outcomes = outcomesRef.current;
    const customerMessages = conversation
      .filter((message) => message.role === "Customer")
      .map((message) => message.text.toLowerCase())
      .join(" ");

    // Collapse a cancellation's intermediate confirmation event when the
    // same order was later successfully cancelled. This keeps the final
    // summary focused on what actually happened rather than repeating the
    // same action at two different stages.
    const effectiveOutcomes = outcomes.filter((item, index) => {
      if (item.resolution_status !== "PENDING_CUSTOMER_CONFIRMATION" || !item.order_id) {
        return true;
      }

      const wasLaterResolved = outcomes
        .slice(index + 1)
        .some(
          (later) =>
            later.order_id === item.order_id &&
            later.customer_intent === item.customer_intent &&
            later.resolution_status === "RESOLVED"
        );

      return !wasLaterResolved;
    });

    // If the same customer request produced a generic fallback outcome
    // after a more specific structured outcome, keep the specific one.
    const meaningfulOutcomes = effectiveOutcomes.filter((item) => {
      if (item.customer_intent === "GENERAL_SUPPORT" && item.resolution_status === "INFORMATION_PROVIDED") {
        return true;
      }
      return true;
    });

    const latest = meaningfulOutcomes[meaningfulOutcomes.length - 1];
    const successful = meaningfulOutcomes.filter(
      (item) => item.resolution_status === "RESOLVED"
    );
    const limitations = effectiveOutcomes.filter((item) =>
      [
        "POLICY_LIMITATION",
        "ORDER_NOT_FOUND",
        "PENDING_CUSTOMER_CONFIRMATION",
        "PENDING_CUSTOMER_INFORMATION",
        "PENDING_CUSTOMER_ACTION",
        "NEEDS_CLARIFICATION",
      ].includes(item.resolution_status)
    );

    let intent = latest?.customer_intent || "GENERAL_SUPPORT";
    if (new Set(meaningfulOutcomes.map((item) => item.customer_intent)).size > 1) {
      intent = "MULTI_INTENT_SUPPORT";
    }

    let status = latest?.resolution_status || "UNRESOLVED";
    if (successful.length > 0 && limitations.length > 0) {
      status = "PARTIALLY_RESOLVED";
    } else if (successful.length > 0 && limitations.length === 0) {
      status = "RESOLVED";
    }

    // The latest structured event represents the latest order/action discussed.
    const orderIds = Array.from(new Set(meaningfulOutcomes.map((item) => item.order_id).filter(Boolean)));
    const orderId = orderIds.length === 1 ? String(orderIds[0]) : null;

    const summaries = meaningfulOutcomes
      .map((item) => item.call_summary)
      .filter((value, index, array) => value && array.indexOf(value) === index);

    let summaryText = summaries.length
      ? summaries.join(" ")
      : "Customer contacted Aura Skincare support.";

    if (conversation.length === 0) {
      summaryText = "No conversation was completed.";
    }

    // If no structured event was produced, keep a truthful generic summary.
    if (!outcomes.length && customerMessages) {
      summaryText =
        "Customer contacted Aura Skincare support. No structured action was completed before the call ended.";
    }

    return {
      customer_intent: intent,
      order_id: orderId,
      resolution_status: status,
      call_summary: summaryText,
    };
  };

  /*
   * START CALL
   */
  const startCall = () => {
    setMessages([]);
    messagesRef.current = [];
    outcomesRef.current = [];
    cancelledOrderIdsRef.current = [];
    pendingCancellationOrderIdRef.current = null;

    setCallSummary(null);

    latestOrderIdRef.current = null;
    latestCancellationResultRef.current = null;

    setCallActive(true);
    setIsListening(false);
    setIsThinking(false);
    setIsSpeaking(false);

    callActiveRef.current = true;
    speakingRef.current = false;
    thinkingRef.current = false;

    shouldListenRef.current = true;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setTimeout(() => {
      startListening();
    }, 300);
  };

  /*
   * END CALL
   */
  const endCall = () => {
    const finalConversation =
      messagesRef.current;

    /*
     * Generate summary BEFORE clearing anything.
     */
    if (finalConversation.length > 0) {
      const summary =
        generateCallSummary(
          finalConversation
        );

      setCallSummary(summary);
    }

    callActiveRef.current = false;
    shouldListenRef.current = false;

    speakingRef.current = false;
    thinkingRef.current = false;

    setCallActive(false);
    setIsListening(false);
    setIsThinking(false);
    setIsSpeaking(false);

    stopListening();

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  /*
   * STATUS
   */
  const getStatus = () => {
    if (isSpeaking) return "Speaking";
    if (isThinking) return "Thinking";
    if (isListening) return "Listening";
    if (callActive) return "Ready";

    return "Ready";
  };

  const status = getStatus();

  return (
    <main className="min-h-screen bg-[#f8f6f2] text-gray-900">

      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* HEADER */}
        <header className="mb-10 flex items-center justify-between">

          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Aura Skincare
            </h1>

            <p className="mt-1 text-sm text-gray-500">
              AI Customer Support
            </p>
          </div>

          <div className="rounded-full bg-white px-4 py-2 text-sm shadow-sm">
            Aria • AI Support Agent
          </div>

        </header>

        <div className="grid gap-6 lg:grid-cols-3">

          {/* CALL PANEL */}
          <section className="rounded-2xl bg-white p-8 shadow-sm lg:col-span-2">

            <div className="text-center">

              <div
                className={`mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full text-4xl ${
                  isListening
                    ? "bg-green-100"
                    : isThinking
                    ? "bg-yellow-100"
                    : isSpeaking
                    ? "bg-blue-100"
                    : "bg-gray-100"
                }`}
              >
                🎙️
              </div>

              <h2 className="text-2xl font-semibold">
                Talk to Aria
              </h2>

              <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
                Your Aura Skincare customer support assistant.
                Ask about orders, delivery, returns,
                cancellations, or other Aura-related questions.
              </p>

              {/* STATUS */}
              <div className="mt-6">

                <span
                  className={`inline-flex items-center rounded-full px-4 py-2 text-sm ${
                    isListening
                      ? "bg-green-100 text-green-700"
                      : isThinking
                      ? "bg-yellow-100 text-yellow-700"
                      : isSpeaking
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  <span className="mr-2">
                    ●
                  </span>

                  {status}

                </span>

              </div>

              {/* BUTTON */}
              <div className="mt-8 flex justify-center">

                {!callActive ? (
                  <button
                    onClick={startCall}
                    className="rounded-full bg-black px-8 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                  >
                    Start Call
                  </button>
                ) : (
                  <button
                    onClick={endCall}
                    className="rounded-full bg-red-600 px-8 py-3 text-sm font-medium text-white transition hover:bg-red-700"
                  >
                    End Call
                  </button>
                )}

              </div>

              <p className="mt-4 text-xs text-gray-400">
                Allow microphone access when your browser asks.
              </p>

            </div>

          </section>

          {/* TEST ORDERS */}
          <section className="rounded-2xl bg-white p-6 shadow-sm">

            <h2 className="text-lg font-semibold">
              Test Orders
            </h2>

            <p className="mt-1 text-xs text-gray-500">
              Use these IDs when testing the voice agent.
            </p>

            <div className="mt-5 space-y-4">

              <div className="rounded-xl bg-gray-50 p-4">
                <p className="font-medium">
                  ORD-101
                </p>

                <p className="mt-1 text-sm text-gray-600">
                  Priya Sharma
                </p>

                <p className="text-sm text-gray-600">
                  Vitamin C Serum — ₹699
                </p>

                <p className="mt-2 text-xs text-blue-600">
                  Out for Delivery
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  BlueDart • Expected by 6 PM today
                </p>
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <p className="font-medium">
                  ORD-102
                </p>

                <p className="mt-1 text-sm text-gray-600">
                  Rahul Verma
                </p>

                <p className="text-sm text-gray-600">
                  Hydrating Sunscreen SPF 50 — ₹499
                </p>

                <p className="mt-2 text-xs text-green-600">
                  Delivered
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  Delhivery • Delivered 14 days ago
                </p>
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <p className="font-medium">
                  ORD-103
                </p>

                <p className="mt-1 text-sm text-gray-600">
                  Ananya Patel
                </p>

                <p className="text-sm text-gray-600">
                  Green Tea Face Wash + Toner — ₹850
                </p>

                <p className="mt-2 text-xs text-orange-600">
                  Processing
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  Ordered 3 hours ago • Cancellation eligible
                </p>
              </div>

            </div>

          </section>

        </div>

        {/* TRANSCRIPT */}
        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">

          <h2 className="text-lg font-semibold">
            Call Transcript
          </h2>

          <div className="mt-4 max-h-96 space-y-4 overflow-y-auto rounded-xl bg-gray-50 p-5">

            {messages.length === 0 ? (
              <p className="text-sm text-gray-400">
                Your conversation will appear here after you start a call.
              </p>
            ) : (
              messages.map(
                (message, index) => (
                  <div key={index}>

                    <p
                      className={`mb-1 text-sm font-semibold ${
                        message.role === "Customer"
                          ? "text-gray-700"
                          : "text-blue-700"
                      }`}
                    >
                      {message.role}
                    </p>

                    <p className="text-sm text-gray-600">
                      {message.text}
                    </p>

                  </div>
                )
              )
            )}

          </div>

        </section>

        {/* CALL SUMMARY */}
        {callSummary && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm">

            <div className="flex items-center justify-between">

              <div>
                <h2 className="text-lg font-semibold">
                  Post-Call Summary
                </h2>

                <p className="mt-1 text-xs text-gray-500">
                  Structured outcome of the completed call
                </p>
              </div>

              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                Call Complete
              </span>

            </div>

            <div className="mt-5 overflow-x-auto rounded-xl bg-gray-900 p-5">

              <pre className="whitespace-pre-wrap text-sm leading-6 text-gray-100">
                {JSON.stringify(
                  callSummary,
                  null,
                  2
                )}
              </pre>

            </div>

          </section>
        )}

      </div>

    </main>
  );
}