import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

type HistoryMessage = { role: "Customer" | "Aria"; text: string };

type Order = {
  order_id: string;
  customer: string;
  product: string;
  value: string;
  status: string;
  carrier?: string;
  tracking?: string;
  notes: string;
  cancellation_eligible: boolean;
};

const orders: Record<string, Order> = {
  "ORD-101": { order_id: "ORD-101", customer: "Priya Sharma", product: "Vitamin C Serum (30ml)", value: "₹699", status: "Out for Delivery", carrier: "BlueDart", tracking: "BD-982103", notes: "Expected by 6 PM today", cancellation_eligible: false },
  "ORD-102": { order_id: "ORD-102", customer: "Rahul Verma", product: "Hydrating Sunscreen SPF 50", value: "₹499", status: "Delivered", carrier: "Delhivery", tracking: "DL-441029", notes: "Delivered 14 days ago", cancellation_eligible: false },
  "ORD-103": { order_id: "ORD-103", customer: "Ananya Patel", product: "Green Tea Face Wash + Toner", value: "₹850", status: "Processing", notes: "Ordered 3 hours ago. Eligible for cancellation", cancellation_eligible: true },
};

function normalizeSpeechText(text: string) {
  return text
    .replace(/\b[oO]\s+[rR]\s+[dD]\b/g, "ORD")
    .replace(/\b[iI]\s+[dD]\b/g, "ID")
    .replace(/\b[rR]\s+[dD]\b/g, "RD")
    .replace(/\b[oO]rder\s+[iI][dD]\b/g, "order ID")
    .trim();
}

function normalizeOrderId(value: string): string | null {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "");
  if (/^ORD-\d+$/.test(cleaned)) return cleaned;
  if (/^\d+$/.test(cleaned)) return `ORD-${cleaned}`;
  return null;
}

function detectOrderId(text: string): string | null {
  const t = normalizeSpeechText(text);
  const explicit = t.match(/\bORD[-\s]?(\d+)\b/i);
  if (explicit) return `ORD-${explicit[1]}`;
  const natural = t.match(/\border(?:\s+id)?(?:\s+is)?\s+(\d+)\b/i);
  if (natural) return `ORD-${natural[1]}`;
  const labeled = t.match(/\b(?:ID|RD)[-\s]?(\d+)\b/i);
  if (labeled) return `ORD-${labeled[1]}`;
  const bare = t.match(/^\s*(\d{3,})\s*[.!?]*\s*$/);
  if (bare) return `ORD-${bare[1]}`;
  if (/\b(?:cancel|cancellation|order|return|refund|track|tracking)\b/i.test(t)) {
    const number = t.match(/\b(\d{3,})\b/);
    if (number) return `ORD-${number[1]}`;
  }
  return null;
}

function explicitOrderReference(text: string) {
  const t = normalizeSpeechText(text);
  return /\bORD[-\s]?\d+\b/i.test(t) ||
    /\border(?:\s+id)?(?:\s+is)?\s+\d+\b/i.test(t) ||
    /\b(?:ID|RD)[-\s]?\d+\b/i.test(t) ||
    /\b(?:cancel|cancellation|order|return|refund|track|tracking)\b[\s\S]*?\b\d{3,}\b/i.test(t);
}

function isConfirmation(text: string) {
  const t = text.trim().toLowerCase().replace(/[,.!?]+/g, " ").replace(/\s+/g, " ").trim();

  // Short confirmations, including natural repeated confirmations such as
  // "yes yes" or "yeah, go ahead".
  if (/^(yes|yeah|yep|yup|sure|okay|ok|go ahead|please do|do it|confirm|confirmed)(\s+(yes|yeah|yep|yup|sure|okay|ok))?$/.test(t)) {
    return true;
  }

  // Natural cancellation confirmations. Keep this intentionally narrow so
  // ordinary questions containing the word "yes" are not treated as approval.
  return /^(yes|yeah|yep|yup|sure|okay|ok)(\s+please)?(\s+i would like you to cancel (it|this|that|the order))?$/.test(t) ||
    /^(yes|yeah|yep|yup|sure|okay|ok)(\s+please)?\s+(cancel|do it|go ahead)(\s+(it|this|that|the order))?$/.test(t);
}

function isGreeting(text: string) {
  return /^(hi|hello|hey|good morning|good afternoon|good evening)([\s!.]*)$/i.test(text.trim());
}

function isIncomplete(text: string) {
  return /^(i want to|i need to|can you|what about order|what about|um|uh|hmm)$/i.test(text.trim());
}

function discussedCancellation(history: HistoryMessage[]) {
  return history.some(m => m.role === "Customer" && /\bcancel(?:led|ling|lation)?\b/i.test(m.text));
}

function lastAriaAskedCancellation(history: HistoryMessage[]) {
  const last = history[history.length - 1];
  return !!last && last.role === "Aria" && /would you like me to cancel|confirm.*cancel/i.test(last.text);
}

type OrderLookupResult =
  | { success: true; order: Order }
  | { success: false; orderId: string; error: "ORDER_NOT_FOUND"; message: string };

function getOrderDetails(orderId: string, cancelledOrderIds: string[]): OrderLookupResult {
  const normalized = normalizeOrderId(orderId);
  if (!normalized || !orders[normalized]) {
    return { success: false, orderId: normalized || orderId, error: "ORDER_NOT_FOUND", message: "That order ID was not found in the Aura Skincare order database." };
  }
  const base = orders[normalized];
  if (cancelledOrderIds.includes(normalized)) {
    return { success: true, order: { ...base, status: "Cancelled", cancellation_eligible: false, notes: "Cancellation successfully processed" } };
  }
  return { success: true, order: base };
}

function cancelOrder(orderId: string, cancelledOrderIds: string[]) {
  const normalized = normalizeOrderId(orderId);
  if (!normalized || !orders[normalized]) return { success: false, orderId: normalized || orderId, error: "ORDER_NOT_FOUND", message: "The order could not be found." };
  if (cancelledOrderIds.includes(normalized)) return { success: false, orderId: normalized, error: "ALREADY_CANCELLED", message: "This order has already been cancelled." };
  const order = orders[normalized];
  if (!order.cancellation_eligible || order.status !== "Processing") {
    return { success: false, orderId: normalized, error: "CANCELLATION_NOT_ALLOWED", message: "Only Processing orders are eligible for cancellation." };
  }
  return { success: true, orderId: normalized, error: null, message: `Cancellation successfully processed for ${normalized}.` };
}

function outcome(customer_intent: string, order_id: string | null, resolution_status: string, call_summary: string) {
  return { customer_intent, order_id, resolution_status, call_summary };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = String(body.message || "").trim();
    const history: HistoryMessage[] = Array.isArray(body.history) ? body.history : [];
    const cancelledOrderIds: string[] = Array.isArray(body.cancelledOrderIds) ? body.cancelledOrderIds : [];
    const pendingCancellationOrderId = typeof body.pendingCancellationOrderId === "string" ? body.pendingCancellationOrderId : null;

    if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });

    const text = normalizeSpeechText(message);
    const cancellationRequest = /\bcancel(?:led|ling|lation)?\b/i.test(text);
    const returnRequest = /\b(return|refund)\b/i.test(text);
    const damageRequest = /\b(damage|damaged|defective|broken)\b/i.test(text);

    // Do not let an earlier cancellation in the same call hijack a new request.
    // Example: after cancelling ORD-103, "my order 102 arrived damaged" must
    // be handled as a damage case, not as another cancellation.
    const cancellationContext =
      cancellationRequest ||
      (!returnRequest && !damageRequest && discussedCancellation(history) &&
        /\b(cancel|cancellation|another order|that order|this order|it)\b/i.test(text));
    let orderId = detectOrderId(text);

    if (!orderId && !explicitOrderReference(text)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const found = detectOrderId(history[i].text);
        if (found && (/\b(it|that order|this order|my order)\b/i.test(text))) { orderId = found; break; }
      }
    }

    // Confirmation must act on the pending cancellation order, not an old order.
    if (isConfirmation(text) && (pendingCancellationOrderId || lastAriaAskedCancellation(history))) {
      const actionId = pendingCancellationOrderId || detectOrderId(history[history.length - 2]?.text || "");
      if (actionId) {
        const result = cancelOrder(actionId, cancelledOrderIds);
        if (result.success) {
          return NextResponse.json({
            response: `Certainly. Your ${result.orderId} order has been successfully cancelled.`,
            orderId: result.orderId,
            toolUsed: true,
            cancellationResult: result,
            orderToolResult: getOrderDetails(result.orderId, [...cancelledOrderIds, result.orderId]),
            pendingCancellationOrderId: null,
            cancelledOrderId: result.orderId,
            outcome: outcome("ORDER_CANCELLATION", result.orderId, "RESOLVED", `Customer requested cancellation of ${result.orderId}. The order was in Processing status and was successfully cancelled after customer confirmation.`),
          });
        }
        return NextResponse.json({
          response: result.error === "ALREADY_CANCELLED" ? `${result.orderId} has already been cancelled.` : `I'm sorry, I couldn't cancel ${result.orderId}. ${result.message}`,
          orderId: result.orderId,
          toolUsed: true,
          cancellationResult: result,
          orderToolResult: getOrderDetails(result.orderId, cancelledOrderIds),
          pendingCancellationOrderId: null,
          cancelledOrderId: null,
          outcome: outcome("ORDER_CANCELLATION", result.orderId, result.error === "ALREADY_CANCELLED" ? "ALREADY_RESOLVED" : "POLICY_LIMITATION", `Customer confirmed cancellation for ${result.orderId}, but the cancellation could not be processed.`),
        });
      }
    }

    // A general question about the cancellation policy should explain the
    // policy instead of asking for an order ID. If an order ID is present,
    // the order-specific cancellation branch below still applies.
    const cancellationPolicyQuestion =
      /\bcancellation\s+policy\b|\bpolicy\s+for\s+cancell(?:ation|ing)\b/i.test(text) && !orderId;

    if (cancellationPolicyQuestion) {
      return NextResponse.json({
        response: "Aura Skincare orders can be cancelled only while they are in Processing. Once an order is Shipped or Out for Delivery, it cannot be cancelled, although you may refuse the delivery at the doorstep.",
        orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null,
        pendingCancellationOrderId: null, cancelledOrderId: null,
        outcome: outcome("CANCELLATION_POLICY", null, "INFORMATION_PROVIDED", "Customer asked about Aura Skincare's cancellation policy. Aria explained that only Processing orders can be cancelled and that shipped or out-for-delivery orders cannot be cancelled.")
      });
    }

    // Return/refund and damage requests tied to a known order are also
    // deterministic so the model cannot invent eligibility.
    if (orderId && /\b(return|refund)\b/i.test(text)) {
      const toolResult = getOrderDetails(orderId, cancelledOrderIds);
      if (!toolResult.success) {
        return NextResponse.json({
          response: `I'm sorry, but ${orderId} was not found in our system. Could you please double-check the order ID?`,
          orderId, toolUsed: true, cancellationResult: null, orderToolResult: toolResult,
          pendingCancellationOrderId: null, cancelledOrderId: null,
          outcome: outcome("RETURN_OR_REFUND", orderId, "ORDER_NOT_FOUND", `Customer asked about a return or refund for ${orderId}, but the order was not found.`),
        });
      }
      const order = toolResult.order;
      if (order.status === "Delivered") {
        return NextResponse.json({
          response: `Your ${order.order_id} was delivered 14 days ago, so it is outside Aura Skincare's 7-day return window. Returns also require the product to be unopened, unused, and in its original packaging.`,
          orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult,
          pendingCancellationOrderId: null, cancelledOrderId: null,
          outcome: outcome("RETURN_OR_REFUND", order.order_id, "POLICY_LIMITATION", `Customer asked about a return or refund for ${order.order_id}. The order was delivered 14 days ago and is outside the 7-day return window.`),
        });
      }
      return NextResponse.json({
        response: `I can help with the return policy for ${order.order_id}. Returns are accepted within 7 days of delivery for unopened, unused products in original packaging.`,
        orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult,
        pendingCancellationOrderId: null, cancelledOrderId: null,
        outcome: outcome("RETURN_OR_REFUND", order.order_id, "INFORMATION_PROVIDED", `Customer asked about a return or refund for ${order.order_id}. Aria explained the 7-day return policy and product-condition requirements.`),
      });
    }

    if (damageRequest && orderId) {
      const toolResult = getOrderDetails(orderId, cancelledOrderIds);
      if (!toolResult.success) {
        return NextResponse.json({
          response: `I'm sorry, but ${orderId} was not found in our system. Could you please double-check the order ID?`,
          orderId, toolUsed: true, cancellationResult: null, orderToolResult: toolResult,
          pendingCancellationOrderId: null, cancelledOrderId: null,
          outcome: outcome("DAMAGED_PRODUCT", orderId, "ORDER_NOT_FOUND", `Customer reported a damaged or defective product for ${orderId}, but the order was not found.`),
        });
      }
      const order = toolResult.order;
      if (order.status === "Delivered") {
        return NextResponse.json({
          response: `I'm sorry to hear that. Aura Skincare requires damaged or defective products to be reported within 48 hours of delivery with photos for replacement. ${order.order_id} was delivered 14 days ago, so it is outside that reporting window.`,
          orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult,
          pendingCancellationOrderId: null, cancelledOrderId: null,
          outcome: outcome("DAMAGED_PRODUCT", order.order_id, "POLICY_LIMITATION", `Customer reported a damaged or defective ${order.order_id}. The order was delivered 14 days ago, outside the 48-hour reporting window.`),
        });
      }
      return NextResponse.json({
        response: `I'm sorry to hear that. Please report the issue within 48 hours of delivery and provide photos so Aura Skincare can assess it for replacement.`,
        orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult,
        pendingCancellationOrderId: null, cancelledOrderId: null,
        outcome: outcome("DAMAGED_PRODUCT", order.order_id, "PENDING_CUSTOMER_ACTION", `Customer reported a damaged or defective ${order.order_id}. Aria explained the 48-hour reporting window and photo requirement.`),
      });
    }

    // Order lookup is always deterministic.
    if (orderId) {
      const toolResult = getOrderDetails(orderId, cancelledOrderIds);
      if (!toolResult.success) {
        return NextResponse.json({
          response: `I'm sorry, but ${toolResult.orderId} was not found in our system. Could you please double-check the order ID?`,
          orderId,
          toolUsed: true,
          cancellationResult: null,
          orderToolResult: toolResult,
          pendingCancellationOrderId: null,
          cancelledOrderId: null,
          outcome: outcome(cancellationContext ? "ORDER_CANCELLATION" : "ORDER_TRACKING", orderId, "ORDER_NOT_FOUND", `Customer referred to ${orderId}, but that order was not found in the Aura Skincare order database.`),
        });
      }

      const order = toolResult.order;
      if (cancellationContext) {
        if (order.status === "Cancelled") {
          return NextResponse.json({ response: `${order.order_id} has already been cancelled.`, orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("ORDER_CANCELLATION", order.order_id, "ALREADY_RESOLVED", `Customer asked about cancelling ${order.order_id}, which has already been cancelled.`) });
        }
        if (order.cancellation_eligible && order.status === "Processing") {
          return NextResponse.json({ response: `${order.order_id} is currently processing and is eligible for cancellation. Would you like me to cancel it?`, orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult, pendingCancellationOrderId: order.order_id, cancelledOrderId: null, outcome: outcome("ORDER_CANCELLATION", order.order_id, "PENDING_CUSTOMER_CONFIRMATION", `Customer asked to cancel ${order.order_id}. The order is Processing and eligible for cancellation; Aria requested confirmation.`) });
        }
        const reason = order.status === "Delivered" ? "because it has already been delivered" : `because it is currently ${order.status}`;
        const doorstep = order.status === "Out for Delivery" || order.status === "Shipped" ? " You may refuse the delivery at the doorstep." : "";
        return NextResponse.json({ response: `I'm sorry, but ${order.order_id} cannot be cancelled ${reason}. ${doorstep}`.trim(), orderId: order.order_id, toolUsed: true, cancellationResult: { success: false, orderId: order.order_id, error: "CANCELLATION_NOT_ALLOWED", message: "Only Processing orders are eligible for cancellation." }, orderToolResult: toolResult, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("ORDER_CANCELLATION", order.order_id, "POLICY_LIMITATION", `Customer asked to cancel ${order.order_id}. The request could not be completed because the order is ${order.status}.`) });
      }

      const carrier = order.carrier ? ` It is with ${order.carrier}, tracking ${order.tracking}.` : "";
      const notes = order.notes ? ` ${order.notes}.` : "";
      return NextResponse.json({ response: `Your ${order.order_id} order for ${order.product} is currently ${order.status}.${carrier}${notes}`.replace(/\.\./g, "."), orderId: order.order_id, toolUsed: true, cancellationResult: null, orderToolResult: toolResult, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("ORDER_TRACKING", order.order_id, "RESOLVED", `Customer asked about ${order.order_id}. Aria provided the current order status and available delivery details.`) });
    }

    if (cancellationRequest) {
      return NextResponse.json({ response: "Of course. Could you please provide your order ID?", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("ORDER_CANCELLATION", null, "PENDING_CUSTOMER_INFORMATION", "Customer requested an order cancellation but did not provide an order ID." ) });
    }

    // Deterministic policy answers reduce hallucination risk.
    if (/flight|hotel|restaurant booking|unrelated|book.*goa|travel/i.test(text)) {
      return NextResponse.json({ response: "I’m sorry, but I can only assist with Aura Skincare products, orders, shipping, returns, refunds, and cancellations. How may I help with Aura today?", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("OUT_OF_SCOPE", null, "OUT_OF_SCOPE", "Customer asked for help outside Aura Skincare support scope." ) });
    }

    if (/\bCOD\b|cash on delivery|pay.*doorstep|upi/i.test(text)) {
      return NextResponse.json({ response: "Cash on Delivery is available for orders up to ₹2,500. You can pay by cash or UPI at the doorstep.", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("COD_INFORMATION", null, "INFORMATION_PROVIDED", "Customer asked about Cash on Delivery. Aria explained the ₹2,500 limit and cash or UPI payment options." ) });
    }

    if (/shipping|delivery fee|shipping fee|how long.*deliver|delivery.*take/i.test(text)) {
      return NextResponse.json({ response: "Aura Skincare offers free delivery on orders above ₹499. Orders below ₹499 have a ₹50 shipping fee, and standard delivery takes 3–5 business days.", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("SHIPPING_INFORMATION", null, "INFORMATION_PROVIDED", "Customer asked about shipping. Aria explained the shipping fee threshold and standard delivery time." ) });
    }

    if (/return|refund/i.test(text)) {
      if (/20\s*days?|14\s*days?|opened|used|unopened|packaging/i.test(text)) {
        return NextResponse.json({ response: "Aura Skincare accepts returns within 7 days of delivery, provided the product is unopened, unused, and in its original packaging. Based on the details you mentioned, the request would be outside that policy.", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("RETURN_OR_REFUND", null, "POLICY_LIMITATION", "Customer asked about a return or refund. Aria explained the 7-day return window and product-condition requirements." ) });
      }
      return NextResponse.json({ response: "Aura Skincare accepts returns within 7 days of delivery for unopened, unused products in their original packaging. I can help you check a specific order if you share its order ID.", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("RETURN_OR_REFUND", null, "INFORMATION_PROVIDED", "Customer asked about returns or refunds. Aria explained the applicable return policy." ) });
    }

    if (damageRequest) {
      return NextResponse.json({ response: "For a damaged or defective product, please report it within 48 hours of delivery and provide photos. Aura Skincare can then assess it for replacement eligibility.", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("DAMAGED_PRODUCT", null, "PENDING_CUSTOMER_ACTION", "Customer reported a damaged or defective product. Aria explained the 48-hour reporting window and photo requirement." ) });
    }

    if (isIncomplete(text)) {
      return NextResponse.json({ response: "Certainly. Please tell me what you’d like help with, and I’ll be happy to assist.", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("GENERAL_SUPPORT", null, "NEEDS_CLARIFICATION", "Customer's request was incomplete, so Aria asked for clarification." ) });
    }

    if (isGreeting(text)) {
      return NextResponse.json({ response: "Hello, I’m Aria from Aura Skincare. How may I assist you today?", orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("GENERAL_SUPPORT", null, "INFORMATION_PROVIDED", "Customer greeted Aria and Aria invited the customer to describe their Aura Skincare request." ) });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
    const historyText = history.map(item => `${item.role}: ${item.text}`).join("\n");
    const prompt = `You are Aria from Aura Skincare, a friendly, professional and concise Indian customer support specialist. Only answer Aura Skincare questions. Use these facts exactly: premium organic Indian skincare; free delivery above ₹499; below ₹499 shipping ₹50; standard delivery 3–5 business days; returns within 7 days only unopened/unused/original packaging; damaged or defective products must be reported within 48 hours with photos for replacement; cancellation only while Processing; shipped or out for delivery cannot be cancelled; COD up to ₹2,500 via cash or UPI. Never invent order details. If you do not have enough information, say so and ask a focused question. Keep the response to 1–3 natural sentences.\n\nConversation:\n${historyText || "(none)"}\nCustomer: ${text}`;
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    return NextResponse.json({ response, orderId: null, toolUsed: false, cancellationResult: null, orderToolResult: null, pendingCancellationOrderId: null, cancelledOrderId: null, outcome: outcome("GENERAL_SUPPORT", null, "INFORMATION_PROVIDED", "Customer asked an Aura Skincare support question and Aria provided a concise response." ) });
  } catch (error) {
    console.error("Aura chat error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unexpected server error." }, { status: 500 });
  }
}
